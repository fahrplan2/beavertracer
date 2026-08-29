//@ts-check

import { encodeUTF8, decodeUTF8 } from "../../lib/helpers.js";

/**
 * SIP message (RFC 3261) — structural parse / serialize only.
 *
 * SIP is a text protocol shaped like HTTP: a start line, CRLF-folded headers,
 * a blank line, then an optional body. Wireshark's "sip" dissector reads the
 * raw UTF-8 out of the UDP payload, so BeaverTracer needs no custom dissector
 * here — this class just gives the SipStack a typed handle on the start line,
 * the (multi-valued, case-insensitive) header set and the body.
 *
 * Dialog / transaction logic (branch generation, CSeq bookkeeping, retransmit
 * timers, dialog state) lives in SipStack.js, not here.
 */

const CRLF = "\r\n";

/** Compact header forms (RFC 3261 §20) → canonical names. */
const COMPACT = {
  i: "Call-ID",
  m: "Contact",
  e: "Content-Encoding",
  l: "Content-Length",
  c: "Content-Type",
  f: "From",
  s: "Subject",
  k: "Supported",
  t: "To",
  v: "Via",
};

/** Canonical capitalization for the headers the stack emits. */
const CANONICAL = [
  "Via", "Max-Forwards", "From", "To", "Call-ID", "CSeq", "Contact",
  "Route", "Record-Route", "Expires", "Allow", "Supported", "User-Agent",
  "Content-Type", "Content-Length", "WWW-Authenticate", "Authorization",
];
const CANONICAL_LC = new Map(CANONICAL.map(h => [h.toLowerCase(), h]));

/** @param {string} name */
function canonicalName(name) {
  const lc = name.trim().toLowerCase();
  if (lc.length === 1 && COMPACT[/** @type {keyof typeof COMPACT} */ (lc)]) {
    return COMPACT[/** @type {keyof typeof COMPACT} */ (lc)];
  }
  return CANONICAL_LC.get(lc) ?? name.trim();
}

export class SIPMessage {

  /** @type {"request"|"response"} */
  kind = "request";

  // request line
  /** @type {string} */ method = "";
  /** @type {string} */ requestUri = "";

  // status line
  /** @type {number} */ statusCode = 0;
  /** @type {string} */ reasonPhrase = "";

  /** @type {string} */ version = "SIP/2.0";

  /**
   * Ordered header list. Names are canonical-cased; a header that appears
   * multiple times (Via, Route, …) keeps one entry per occurrence, in order.
   * @type {Array<{ name: string, value: string }>}
   */
  headers = [];

  /** @type {Uint8Array} */
  body = new Uint8Array(0);

  /**
   * @param {object} [opts]
   * @param {"request"|"response"} [opts.kind]
   * @param {string} [opts.method]
   * @param {string} [opts.requestUri]
   * @param {number} [opts.statusCode]
   * @param {string} [opts.reasonPhrase]
   * @param {string} [opts.version]
   * @param {Array<[string, string]>} [opts.headers]
   * @param {Uint8Array|string} [opts.body]
   */
  constructor(opts = {}) {
    if (opts.kind) this.kind = opts.kind;
    if (opts.method != null) { this.method = opts.method; this.kind = "request"; }
    if (opts.requestUri != null) this.requestUri = opts.requestUri;
    if (opts.statusCode != null) { this.statusCode = opts.statusCode; this.kind = "response"; }
    if (opts.reasonPhrase != null) this.reasonPhrase = opts.reasonPhrase;
    if (opts.version) this.version = opts.version;
    for (const [n, v] of opts.headers ?? []) this.addHeader(n, v);
    if (opts.body != null) this.setBody(opts.body);
  }

  // ── construction helpers ────────────────────────────────────────────────

  /**
   * @param {string} method
   * @param {string} requestUri
   * @param {Array<[string, string]>} [headers]
   * @param {Uint8Array|string} [body]
   */
  static request(method, requestUri, headers = [], body) {
    return new SIPMessage({ method, requestUri, headers, body });
  }

  /**
   * @param {number} statusCode
   * @param {string} reasonPhrase
   * @param {Array<[string, string]>} [headers]
   * @param {Uint8Array|string} [body]
   */
  static response(statusCode, reasonPhrase, headers = [], body) {
    return new SIPMessage({ statusCode, reasonPhrase, headers, body });
  }

  // ── header access ───────────────────────────────────────────────────────

  /** First value for a header, or null. @param {string} name */
  getHeader(name) {
    const cn = canonicalName(name).toLowerCase();
    for (const h of this.headers) if (h.name.toLowerCase() === cn) return h.value;
    return null;
  }

  /** All values for a header, in order. @param {string} name @returns {string[]} */
  getHeaders(name) {
    const cn = canonicalName(name).toLowerCase();
    return this.headers.filter(h => h.name.toLowerCase() === cn).map(h => h.value);
  }

  /** Append a header occurrence. @param {string} name @param {string} value */
  addHeader(name, value) {
    this.headers.push({ name: canonicalName(name), value: String(value).trim() });
    return this;
  }

  /**
   * Replace every occurrence of a header with a single value (or drop it when
   * value is null). @param {string} name @param {string|null} value
   */
  setHeader(name, value) {
    const cn = canonicalName(name).toLowerCase();
    this.headers = this.headers.filter(h => h.name.toLowerCase() !== cn);
    if (value != null) this.addHeader(name, value);
    return this;
  }

  /** @param {string} name */
  removeHeader(name) {
    const cn = canonicalName(name).toLowerCase();
    this.headers = this.headers.filter(h => h.name.toLowerCase() !== cn);
    return this;
  }

  /** Insert a header occurrence at the front (used for Via / Record-Route). @param {string} name @param {string} value */
  prependHeader(name, value) {
    this.headers.unshift({ name: canonicalName(name), value: String(value).trim() });
    return this;
  }

  // ── body ────────────────────────────────────────────────────────────────

  /** @param {Uint8Array|string} body */
  setBody(body) {
    this.body = typeof body === "string" ? encodeUTF8(body) : new Uint8Array(body);
    return this;
  }

  /** @returns {string} */
  get bodyText() {
    return this.body.length ? decodeUTF8(this.body) : "";
  }

  // ── convenience parsers for common headers ──────────────────────────────

  /** CSeq as { seq, method }, or null. */
  get cseq() {
    const raw = this.getHeader("CSeq");
    if (!raw) return null;
    const m = raw.trim().match(/^(\d+)\s+(\S+)$/);
    return m ? { seq: Number(m[1]), method: m[2].toUpperCase() } : null;
  }

  /** The `branch=` value of the topmost Via, or null. */
  get topViaBranch() {
    const via = this.getHeader("Via");
    const m = via && via.match(/;branch=([^;\s]+)/i);
    return m ? m[1] : null;
  }

  /** The `tag=` parameter of a From/To header value. @param {string} headerValue */
  static tagOf(headerValue) {
    const m = headerValue && headerValue.match(/;tag=([^;\s]+)/i);
    return m ? m[1] : null;
  }

  /** The addr-spec (URI) inside a name-addr / addr-spec header value. @param {string} headerValue */
  static uriOf(headerValue) {
    if (!headerValue) return null;
    const angle = headerValue.match(/<([^>]+)>/);
    if (angle) return angle[1];
    // bare addr-spec: strip any header parameters after the first ';'
    return headerValue.split(";")[0].trim() || null;
  }

  // ── wire format ─────────────────────────────────────────────────────────

  /** @returns {string} start line without CRLF */
  startLine() {
    return this.kind === "request"
      ? `${this.method} ${this.requestUri} ${this.version}`
      : `${this.version} ${this.statusCode} ${this.reasonPhrase}`;
  }

  /**
   * Serialize to bytes. Content-Length is always rewritten to match the body.
   * @returns {Uint8Array}
   */
  pack() {
    this.setHeader("Content-Length", String(this.body.length));

    let head = this.startLine() + CRLF;
    for (const h of this.headers) head += `${h.name}: ${h.value}${CRLF}`;
    head += CRLF;

    const headBytes = encodeUTF8(head);
    if (this.body.length === 0) return headBytes;

    const out = new Uint8Array(headBytes.length + this.body.length);
    out.set(headBytes, 0);
    out.set(this.body, headBytes.length);
    return out;
  }

  /** @returns {string} full message as text (for UI display / logging) */
  toString() {
    const bin = this.pack();
    return decodeUTF8(bin);
  }

  /**
   * Parse a SIP message from bytes or text.
   * @param {Uint8Array|string} input
   * @returns {SIPMessage}
   */
  static parse(input) {
    const bytes = typeof input === "string" ? encodeUTF8(input) : input;

    // locate the CRLF CRLF (or LF LF) that ends the header block
    let sep = -1, sepLen = 0;
    for (let i = 0; i + 1 < bytes.length; i++) {
      if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a && bytes[i + 2] === 0x0d && bytes[i + 3] === 0x0a) {
        sep = i; sepLen = 4; break;
      }
      if (bytes[i] === 0x0a && bytes[i + 1] === 0x0a) { sep = i; sepLen = 2; break; }
    }
    const headEnd = sep === -1 ? bytes.length : sep;
    const bodyStart = sep === -1 ? bytes.length : sep + sepLen;

    const headText = decodeUTF8(bytes.slice(0, headEnd));
    const rawLines = headText.split(/\r\n|\n/);
    if (rawLines.length === 0 || rawLines[0].trim() === "") throw new Error("Empty SIP message");

    // unfold continuation lines (RFC 3261 §7.3.1: LWS after CRLF continues the header)
    /** @type {string[]} */
    const lines = [rawLines[0]];
    for (let i = 1; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line === "") continue;
      if (/^[ \t]/.test(line) && lines.length > 1) {
        lines[lines.length - 1] += " " + line.trim();
      } else {
        lines.push(line);
      }
    }

    const msg = new SIPMessage();
    const start = lines[0].trim();

    if (/^SIP\/2\.0\s+\d{3}/.test(start)) {
      const m = start.match(/^(SIP\/2\.0)\s+(\d{3})\s*(.*)$/);
      if (!m) throw new Error(`Malformed status line: ${start}`);
      msg.kind = "response";
      msg.version = m[1];
      msg.statusCode = Number(m[2]);
      msg.reasonPhrase = m[3];
    } else {
      const m = start.match(/^(\S+)\s+(\S+)\s+(SIP\/2\.0)$/);
      if (!m) throw new Error(`Malformed request line: ${start}`);
      msg.kind = "request";
      msg.method = m[1].toUpperCase();
      msg.requestUri = m[2];
      msg.version = m[3];
    }

    for (let i = 1; i < lines.length; i++) {
      const idx = lines[i].indexOf(":");
      if (idx === -1) throw new Error(`Malformed header line: ${lines[i]}`);
      const name = lines[i].slice(0, idx);
      const value = lines[i].slice(idx + 1).trim();
      // a comma-separated Via/Route list is legal as one line — split it out
      const cn = canonicalName(name);
      if ((cn === "Via" || cn === "Route" || cn === "Record-Route") && value.includes(",")) {
        for (const part of splitCommaList(value)) msg.addHeader(cn, part);
      } else {
        msg.addHeader(cn, value);
      }
    }

    const clRaw = msg.getHeader("Content-Length");
    let body = bytes.slice(bodyStart);
    if (clRaw != null) {
      const cl = Number(clRaw);
      if (Number.isFinite(cl) && cl >= 0 && cl <= body.length) body = body.slice(0, cl);
    }
    msg.body = body;

    return msg;
  }
}

/**
 * Split a comma-separated header value, ignoring commas inside quotes or
 * angle brackets (e.g. multiple Via values on one line).
 * @param {string} value
 * @returns {string[]}
 */
function splitCommaList(value) {
  const out = [];
  let depth = 0, quoted = false, cur = "";
  for (const ch of value) {
    if (ch === '"' ) quoted = !quoted;
    else if (!quoted && ch === "<") depth++;
    else if (!quoted && ch === ">") depth--;
    if (ch === "," && !quoted && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
