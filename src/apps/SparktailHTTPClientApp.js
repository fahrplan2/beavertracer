//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { SimTimer, simTimer } from "../lib/SimTimer.js";

import startPageTemplate from "./assets/about-start.html?raw";
import logoSvg from "./assets/sparktail-logo.svg?raw";
import beaverPage from "./assets/about-beaver.html?raw";
import { t } from "../i18n/index.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { nowStamp, encodeUTF8, decodeUTF8 } from "../lib/helpers.js";
import { TlsSession, TlsCertUntrustedError, TlsCertExpiredError, TlsCertNameMismatchError } from "../net/TlsSession.js";
import { Http2Connection, Http2Error } from "../net/Http2.js";

const startPage = startPageTemplate.replace("<!--SPARKTAIL_LOGO-->", logoSvg);

/**
 * @param {Uint8Array} data
 */
function hexPreview(data) {
  const max = 24;
  const slice = data.slice(0, max);
  let s = "";
  for (let i = 0; i < slice.length; i++) {
    s += slice[i].toString(16).padStart(2, "0");
    if (i < slice.length - 1) s += " ";
  }
  if (data.length > max) s += " …";
  return s;
}

/**
 * @param {string} host
 * @param {(name:string)=>Promise<any>} dnsResolve
 * @returns {Promise<IPAddress>}
 */
async function resolveHostToIP(host, dnsResolve) {
  const s = host.trim();

  // raw uint32 (3232235521)
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) return new IPAddress(4, n >>> 0);
  }

  // dotted IPv4 (1.2.3.4)
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
    if ([a, b, c, d].every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) {
      const n = (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0;
      return new IPAddress(4, n);
    }
  }

  // IPv6 literal (contains colons)
  if (s.includes(":")) {
    try { return IPAddress.fromString(s); } catch { /* fall through to error */ }
    throw new Error(t("app.sparktail.err.cannotResolveHost", { host: s }));
  }

  // hostname -> dns
  const r = await dnsResolve(s);

  if (r instanceof IPAddress) return r;
  if (typeof r === "number") return new IPAddress(4, r >>> 0);
  if (typeof r === "string") {
    try { return IPAddress.fromString(r); } catch { /* fall through */ }
  }

  throw new Error(t("app.sparktail.err.cannotResolveHost", { host: s }));
}

/**
 * Minimal URL parser for http:// only.
 * Supports IPv4, hostname, and IPv6 bracket notation: http://[2001:db8::1]:8080/path
 * @param {string} url
 */
function parseHttpUrl(url) {
  const s = url.trim();
  const lower = s.toLowerCase();
  const isHttps = lower.startsWith("https://");
  const isHttp  = lower.startsWith("http://");
  if (!isHttps && !isHttp) {
    return { ok: false, error: t("app.sparktail.err.onlyHttp") };
  }
  const scheme = isHttps ? "https" : "http";

  const rest = s.slice(scheme.length + 3);
  const slash = rest.indexOf("/");
  const authority = slash >= 0 ? rest.slice(0, slash) : rest;
  const path = slash >= 0 ? rest.slice(slash) : "/";

  if (!authority) return { ok: false, error: t("app.sparktail.err.missingHostInUrl") };

  let host = authority;
  let port = isHttps ? 443 : 80;

  if (authority.startsWith("[")) {
    // IPv6 bracketed: [2001:db8::1] or [2001:db8::1]:port
    const close = authority.indexOf("]");
    if (close < 0) return { ok: false, error: t("app.sparktail.err.invalidIpv6Bracket") };
    host = authority.slice(1, close);
    const after = authority.slice(close + 1);
    if (after.startsWith(":")) {
      const p = Number(after.slice(1));
      if (Number.isInteger(p) && p >= 1 && p <= 65535) port = p;
    }
  } else {
    // IPv4 or hostname: split on last colon for optional port
    const colon = authority.lastIndexOf(":");
    if (colon > 0 && colon < authority.length - 1) {
      const maybePort = authority.slice(colon + 1);
      if (/^\d+$/.test(maybePort)) {
        const p = Number(maybePort);
        if (Number.isInteger(p) && p >= 1 && p <= 65535) {
          host = authority.slice(0, colon);
          port = p;
        }
      }
    }
  }

  host = host.trim();
  if (!host) return { ok: false, error: t("app.sparktail.err.hostEmpty") };

  return { ok: true, scheme, host, port, path };
}

/**
 * @param {Uint8Array[]} chunks
 */
function concatChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Small helper to search for a byte pattern in a Uint8Array.
 * @param {Uint8Array} hay
 * @param {Uint8Array} needle
 */
function indexOfBytes(hay, needle) {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Parse HTTP headers into a map-like object (lowercased keys).
 * @param {string} headerText
 */
function parseHeaders(headerText) {
  /** @type {Record<string,string>} */
  const headers = {};
  const lines = headerText.split("\r\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const k = line.indexOf(":");
    if (k <= 0) continue;
    const key = line.slice(0, k).trim().toLowerCase();
    const val = line.slice(k + 1).trim();
    if (!key) continue;
    if (headers[key]) headers[key] = headers[key] + ", " + val;
    else headers[key] = val;
  }
  return headers;
}

/**
 * Promise wrapper with simulation-time timeout.
 * Uses simTimer so the timeout pauses with the simulation.
 * @template T
 * @param {Promise<T>} p
 * @param {number} ms  simulated milliseconds
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    let done = false;
    const id = simTimer.schedule(() => {
      if (!done) { done = true; reject(new Error(t("app.sparktail.err.timeout", { label, ms }))); }
    }, ms);
    p.then(
      (v) => { if (!done) { done = true; simTimer.cancel(id); resolve(v); } },
      (e) => { if (!done) { done = true; simTimer.cancel(id); reject(e); } },
    );
  });
}

/**
 * @param {Record<string,string>} headers
 */
function isHtml(headers) {
  const ct = (headers["content-type"] || "").toLowerCase();
  return ct.includes("text/html") || ct.includes("application/xhtml+xml");
}

/**
 * Firefox-style browser error page.
 * @param {string} title
 * @param {string} detail
 */
function internalErrorPage(title, detail) {
  /** @param {string} s */
  const esc = (s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f9f9fa;display:flex;justify-content:center;padding:48px 20px;min-height:100%}
.c{max-width:460px;width:100%}
.ico{position:relative;display:inline-block;margin-bottom:20px;line-height:1}
.ico svg{display:block;width:56px;height:56px}
.ico-x{position:absolute;bottom:-2px;right:-6px;font-size:1.1rem;line-height:1}
h1{font-size:1.15rem;font-weight:600;color:#15141a;margin-bottom:12px}
.d{color:#5b5b66;font-size:.875rem;line-height:1.65;white-space:pre-wrap}
</style></head>
<body><div class="c">
<div class="ico">${logoSvg}<span class="ico-x">❌</span></div>
<h1>${esc(title)}</h1>
<p class="d">${esc(detail)}</p>
</div></body></html>`;
}

/**
 * Firefox-style "Your connection is not secure" page with a "Proceed anyway" button.
 * @param {import("../net/models/TlsCertificate.js").TlsCertificate|null} cert
 * @param {string} url
 * @param {{ title:string, detail:string, subject:string, issuer:string,
 *            fingerprint:string, expiry:string, selfSigned:string, proceed:string }} i18n
 */
function certErrorPage(cert, url, i18n) {
  /** @param {string} s */
  const esc = (s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const subject = cert?.subject ?? "?";
  const issuer  = cert?.issuer  ?? "?";
  const fp      = cert ? cert.fingerprint() : "?";
  const expiry  = cert ? new Date(cert.notAfter).toLocaleDateString() : "?";
  const selfSignedNote = cert?.selfSigned ? ` (${esc(i18n.selfSigned)})` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(i18n.title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f9f9fa;display:flex;justify-content:center;padding:48px 20px;min-height:100%;color:#15141a}
.c{max-width:500px;width:100%}
.ico{position:relative;display:inline-block;margin-bottom:20px;line-height:1}
.ico svg{display:block;width:56px;height:56px}
.ico-x{position:absolute;bottom:-2px;right:-6px;font-size:1.1rem;line-height:1}
h1{font-size:1.15rem;font-weight:600;margin-bottom:12px}
.d{color:#5b5b66;font-size:.875rem;line-height:1.65;margin-bottom:20px}
.cert-box{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:.8rem}
.cert-row{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid #f0f0f0}
.cert-row:last-child{border-bottom:none}
.cert-lbl{color:#888;min-width:90px;flex-shrink:0}
.cert-val{color:#333;font-family:monospace;word-break:break-all}
.proceed{background:#e9e9eb;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:.875rem;color:#333}
.proceed:hover{background:#d8d8da}
</style></head>
<body><div class="c">
<div class="ico">${logoSvg}<span class="ico-x">❌</span></div>
<h1>${esc(i18n.title)}</h1>
<p class="d">${esc(i18n.detail)}</p>
<div class="cert-box">
<div class="cert-row"><span class="cert-lbl">${esc(i18n.subject)}</span><span class="cert-val">${esc(subject)}</span></div>
<div class="cert-row"><span class="cert-lbl">${esc(i18n.issuer)}</span><span class="cert-val">${esc(issuer)}${selfSignedNote}</span></div>
<div class="cert-row"><span class="cert-lbl">${esc(i18n.fingerprint)}</span><span class="cert-val">${esc(fp)}</span></div>
<div class="cert-row"><span class="cert-lbl">${esc(i18n.expiry)}</span><span class="cert-val">${esc(expiry)}</span></div>
</div>
<script>var _url=${JSON.stringify(url)};</script>
<button class="proceed" onclick="parent.postMessage({__sparktail:true,type:'certProceed',url:_url},'*')">${esc(i18n.proceed)}</button>
</div></body></html>`;
}

/**
 * Normalize user input:
 * - allow about:* untouched
 * - allow http:// untouched
 * - bare IPv6 (2+ colons, no brackets): wrap in brackets then prefix http://
 * - otherwise prefix http://
 * @param {string} input
 */
function normalizeUrlInput(input) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (low.startsWith("about:")) return s;
  if (low.startsWith("http://") || low.startsWith("https://")) return s;
  // Bare IPv6 literal (at least two colons, not already bracketed)
  if (!s.startsWith("[") && (s.match(/:/g)?.length ?? 0) >= 2) {
    const slash = s.indexOf("/");
    return slash < 0
      ? `http://[${s}]`
      : `http://[${s.slice(0, slash)}]${s.slice(slash)}`;
  }
  return "http://" + s;
}

// Helper: buffered TCP reader on top of recvTCPConn (stream semantics)
export class TcpBufferedReader {
  /**
   * @param {{
   *   recv: () => Promise<Uint8Array|null>,
   *   isCancelled: () => boolean,
   *   timeoutMs: number
   * }} opt
   */
  constructor(opt) {
    this._recv = opt.recv;
    this._isCancelled = opt.isCancelled;
    this._timeoutMs = opt.timeoutMs;

    /** @type {Uint8Array} */
    this.buf = new Uint8Array(0);

    /** @type {boolean} */
    this.closed = false;

    /** recv() started while the connection sat idle (see watchIdle). @type {Promise<Uint8Array|null>|null} */
    this._pending = null;
  }

  /**
   * Keep one recv() outstanding while the connection is idle in the pool, so
   * a close by the server (keep-alive timeout) is noticed: `onEnd` runs when
   * that read reports EOF. Data arriving meanwhile is kept for the next read.
   * @param {() => void} onEnd
   */
  watchIdle(onEnd) {
    if (this.closed || this._pending) return;
    const p = this._recv();
    this._pending = p;
    p.then((chunk) => { if (chunk == null && this._pending === p) onEnd(); }, () => { /* reported on next read */ });
  }

  /** @param {Uint8Array} chunk */
  _append(chunk) {
    if (chunk.length === 0) return;
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
  }

  /** @returns {Promise<void>} */
  async _fill() {
    if (this.closed) return;
    if (this._isCancelled()) throw new Error(t("app.sparktail.err.cancelled"));

    const p = this._pending ?? this._recv();
    this._pending = null;
    const chunk = await withTimeout(p, this._timeoutMs, t("app.sparktail.label.recv"));
    if (chunk == null) {
      this.closed = true;
      return;
    }
    this._append(chunk);
  }

  /**
   * Read until delimiter occurs (delimiter included).
   * @param {Uint8Array} needle
   * @param {number} maxBytes
   * @returns {Promise<Uint8Array>}
   */
  async readUntil(needle, maxBytes = 2 * 1024 * 1024) {
    while (true) {
      const idx = indexOfBytes(this.buf, needle);
      if (idx >= 0) {
        const end = idx + needle.length;
        const out = this.buf.subarray(0, end);
        this.buf = this.buf.subarray(end);
        return out;
      }
      if (this.buf.length > maxBytes) throw new Error(t("app.sparktail.err.readUntilExceeded", { maxBytes }));
      await this._fill();
      if (this.closed) throw new Error(t("app.sparktail.err.eof"));
    }
  }

  /**
   * Read exactly n bytes (throws on EOF).
   * @param {number} n
   * @returns {Promise<Uint8Array>}
   */
  async readExactly(n) {
    while (this.buf.length < n) {
      await this._fill();
      if (this.closed) throw new Error(t("app.sparktail.err.eof"));
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  /**
   * Read a CRLF-terminated line, returning bytes excluding CRLF.
   * @param {number} maxLineBytes
   * @returns {Promise<Uint8Array>}
   */
  async readLine(maxLineBytes = 64 * 1024) {
    const CRLF = encodeUTF8("\r\n");
    const block = await this.readUntil(CRLF, maxLineBytes + 2);
    return block.subarray(0, block.length - 2);
  }

  /**
   * Read until remote closes (fallback).
   * @param {number} limit
   * @returns {Promise<Uint8Array>}
   */
  async readToClose(limit = 2 * 1024 * 1024) {
    while (!this.closed) {
      if (this.buf.length > limit) throw new Error(t("app.sparktail.err.bodyTooLarge"));
      await this._fill();
    }
    const out = this.buf;
    this.buf = new Uint8Array(0);
    return out;
  }
}

/**
 * May the connection carry another request after this response?
 * RFC 9112 §9.3: HTTP/1.1 persists unless "Connection: close"; HTTP/1.0 only
 * with "keep-alive". The body must also be delimited by Content-Length or
 * chunked coding, otherwise its end is the connection close (§6.3).
 * @param {string} statusLine
 * @param {Record<string,string>} headers lower-case names
 */
export function isReusableResponse(statusLine, headers) {
  const tokens = (headers["connection"] || "").toLowerCase().split(",").map(x => x.trim());
  if (tokens.includes("close")) return false;
  const http11 = /^HTTP\/1\.1\s/.test(statusLine);
  if (!http11 && !tokens.includes("keep-alive")) return false;
  const te = (headers["transfer-encoding"] || "").toLowerCase();
  return te.includes("chunked") || /^\d+$/.test((headers["content-length"] || "").trim());
}

/**
 * Read one HTTP/1.x response (status line, headers, body) from `r`.
 * @param {TcpBufferedReader} r
 * @param {number} bodyLimit
 * @param {string} [method]
 * @returns {Promise<{ statusLine: string, statusCode: number, reason: string, headerText: string,
 *                     headers: Record<string,string>, body: Uint8Array, reusable: boolean }>}
 */
export async function readHttpResponse(r, bodyLimit, method = "GET") {
  const headerBlock = await r.readUntil(encodeUTF8("\r\n\r\n"), 2 * 1024 * 1024);
  const headerText = decodeUTF8(headerBlock.subarray(0, headerBlock.length - 4));
  const firstLineEnd = headerText.indexOf("\r\n");
  const statusLine = firstLineEnd >= 0 ? headerText.slice(0, firstLineEnd) : headerText;

  const m = /^HTTP\/\d+\.\d+\s+(\d{3})\s*(.*)$/.exec(statusLine);
  const statusCode = m ? Number(m[1]) : 0;
  const reason = m ? (m[2] || "").trim() : "";
  const headers = parseHeaders(headerText);

  const te = (headers["transfer-encoding"] || "").toLowerCase();
  const cl = headers["content-length"];
  /** @type {Uint8Array} */
  let body = new Uint8Array(0);

  // RFC 9112 §6.3: no body for HEAD, 1xx, 204, 304 whatever the headers say
  const noBody = method === "HEAD" || statusCode === 204 || statusCode === 304 || (statusCode >= 100 && statusCode < 200);
  if (noBody) {
    // nothing to read
  } else if (te.includes("chunked")) {
    /** @type {Uint8Array[]} */
    const out = [];
    let total = 0;

    while (true) {
      const line = decodeUTF8(await r.readLine(64 * 1024)).trim();
      const semi = line.indexOf(";");
      const hex = (semi >= 0 ? line.slice(0, semi) : line).trim();

      if (!/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error(t("app.sparktail.err.chunkedInvalidChunkSize", { line }));
      }
      const size = parseInt(hex, 16);
      if (!Number.isFinite(size) || size < 0) {
        throw new Error(t("app.sparktail.err.chunkedInvalidSize", { hex }));
      }

      if (size === 0) {
        // Trailer headers until empty line
        while ((await r.readLine(64 * 1024)).length !== 0) { /* skip trailer */ }
        break;
      }

      const chunk = await r.readExactly(size);
      out.push(chunk);
      total += chunk.length;
      if (total > bodyLimit) throw new Error(t("app.sparktail.err.bodyLimitExceeded", { bodyLimit }));

      const crlf = await r.readExactly(2);
      if (crlf[0] !== 13 || crlf[1] !== 10) throw new Error(t("app.sparktail.err.chunkedMissingCrlf"));
    }

    body = concatChunks(out);
  } else if (cl && /^\d+$/.test(cl.trim())) {
    const want = Number(cl.trim());
    if (!Number.isFinite(want) || want < 0) throw new Error(t("app.sparktail.err.invalidContentLength"));
    if (want > bodyLimit) throw new Error(t("app.sparktail.err.bodyLimitExceeded", { bodyLimit }));
    body = await r.readExactly(want);
  } else {
    // Fallback: no length known. Read until close.
    body = await r.readToClose(bodyLimit + 256 * 1024);
    if (body.length > bodyLimit) throw new Error(t("app.sparktail.err.bodyLimitExceeded", { bodyLimit }));
  }

  // copy: the reader hands out views into its buffer
  return { statusLine, statusCode, reason, headerText, headers, body: body.slice(), reusable: isReusableResponse(statusLine, headers) };
}

/**
 * A browser connection: HTTP/1.1 (one request at a time, keep-alive) or
 * HTTP/2 (`h2` set: shared, requests multiplexed as streams).
 * @typedef {{
 *   origin: string,
 *   key: string,
 *   tls: TlsSession|null,
 *   send: (d: Uint8Array) => void|Promise<void>,
 *   reader: TcpBufferedReader,
 *   h2: Http2Connection|null,
 *   proto: string,
 *   peerCert: import("../net/models/TlsCertificate.js").TlsCertificate|null,
 *   bypass: boolean,
 *   requests: number,
 *   closing: boolean,
 * }} BrowserConn
 *
 * @typedef {{ statusLine: string, statusCode: number, reason: string, headerText: string,
 *             headers: Record<string,string>, body: Uint8Array, reusable: boolean, streamId: number }} BrowserResponse
 */

/** Parallel HTTP/1.1 connections per origin, as in common browsers. */
const MAX_CONNS_PER_ORIGIN = 6;

/** "auto": HTTP/2 via ALPN for https (like browsers); "h2" over http:// is h2c with prior knowledge. */
const PROTOCOL_MODES = /** @type {const} */ (["auto", "http1", "h2"]);

const CONF_PATH = "/etc/sparktail.conf";

/** @param {string} scheme @param {string} host @param {number} port */
function originKey(scheme, host, port) {
  return `${scheme}://${host.toLowerCase()}:${port}`;
}

export class SparktailHTTPClientApp extends LoggedProcess {
  get title() {
    return t("app.sparktail.title");
  }

  icon="fa-globe";

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {string} */
  url = "about:start";

  /** @type {boolean} */
  loading = false;

  /** @type {string|null} */
  connKey = null;

  /** Idle HTTP/1.1 keep-alive connections per pool key (origin + trust mode). @type {Map<string, BrowserConn[]>} */
  _pool = new Map();

  /** Shared HTTP/2 connections per pool key. @type {Map<string, BrowserConn>} */
  _h2 = new Map();

  /** Connections being opened that may turn out to be HTTP/2. @type {Map<string, Promise<BrowserConn>>} */
  _opening = new Map();

  /** @type {"auto"|"http1"|"h2"} */
  protocolMode = "auto";

  /** @type {HTMLSelectElement|null} */
  protoEl = null;

  /** @type {HTMLInputElement|null} */
  urlEl = null;

  /** @type {HTMLButtonElement|null} */
  goBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;

  /** @type {HTMLButtonElement|null} */
  backBtn = null;

  /** @type {HTMLButtonElement|null} */
  fwdBtn = null;

  /** @type {HTMLButtonElement|null} */
  reloadBtn = null;

  /** @type {HTMLElement|null} */
  throbberEl = null;

  /** @type {HTMLElement|null} */
  statusEl = null;

  /** @type {HTMLIFrameElement|null} */
  previewFrame = null;

  /** @type {HTMLTextAreaElement|null} */
  sourceEl = null;

  /** @type {HTMLTextAreaElement|null} */
  headersEl = null;

  /** @type {"preview"|"source"|"headers"|"log"} */
  tab = "preview";

  /** @type {((id: string) => void)|null} */
  _setTabActive = null;

  /** @type {number} */
  requestSeq = 0;

  /** @type {import("../net/TlsSession.js").TlsSession|null} */
  _activeTls = null;

  /** Set true after "Proceed anyway"; consumed (reset) at start of next _fetchUrl. */
  _bypassCertCheck = false;

  /** @type {HTMLElement|null} */ _lockEl = null;
  /** @type {HTMLElement|null} */ _certPopupEl = null;
  /** @type {import("../net/models/TlsCertificate.js").TlsCertificate|null} */ _serverCert = null;
  /** @type {boolean} */ _certTrusted = false;

  /** @type {string[]} */
  history = [];

  /** @type {number} */
  historyIndex = -1;

  run() {
    this.root.classList.add("app", "app-sparktail-http");
    this._loadConfig();
  }

  _loadConfig() {
    try {
      const json = JSON.parse(this.os.fs?.readFile(CONF_PATH) ?? "");
      if (PROTOCOL_MODES.includes(json.protocol)) this.protocolMode = json.protocol;
    } catch { /* defaults */ }
  }

  _saveConfig() {
    try { this.os.fs?.writeFile(CONF_PATH, JSON.stringify({ protocol: this.protocolMode }, null, 2) + "\n"); } catch { /* ignore */ }
  }

  /** @param {string} mode */
  _setProtocolMode(mode) {
    if (!PROTOCOL_MODES.includes(/** @type {any} */ (mode)) || mode === this.protocolMode) return;
    this.protocolMode = /** @type {any} */ (mode);
    this._saveConfig();
    // connections negotiated under the old setting must not be reused
    this._closePool();
    this._appendLog(t("app.sparktail.log.protocolMode", { time: nowStamp(), mode: t(`app.sparktail.proto.${mode}`) }));
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const urlInput = UI.input({
      placeholder: t("app.sparktail.placeholder.url"),
      value: String(this.url),
    });
    this.urlEl = urlInput;

    urlInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") this._goFromUI();
    });

    /** @type {HTMLButtonElement} */
    const back = UI.button(t("app.sparktail.button.back"), () => this._navTo(this.historyIndex - 1), {});
    /** @type {HTMLButtonElement} */
    const fwd = UI.button(t("app.sparktail.button.forward"), () => this._navTo(this.historyIndex + 1), {});
    /** @type {HTMLButtonElement} */
    const reload = UI.button(
      t("app.sparktail.button.reload"),
      () => {
        const u = (this.urlEl?.value ?? this.url).trim();
        if (u) this._navigate(normalizeUrlInput(u), false /* already in history */);
      },
      {}
    );
    this.backBtn = back;
    this.fwdBtn = fwd;
    this.reloadBtn = reload;

    /** @type {HTMLButtonElement} */
    const go = UI.button(t("app.sparktail.button.go"), () => this._goFromUI(), { primary: true });
    /** @type {HTMLButtonElement} */
    // icon only, like back/forward/reload; the label stays as tooltip and for screen readers
    const stop = UI.button("", () => this._stop(), { title: t("app.sparktail.button.stop") });
    stop.replaceChildren(UI.el("i", { className: "fas fa-stop" }));
    stop.setAttribute("aria-label", t("app.sparktail.button.stop"));
    this.goBtn = go;
    this.stopBtn = stop;

    const throbber = UI.el("div", { className: "sparktail-throbber" });
    this.throbberEl = throbber;

    const status = UI.el("div", { className: "sparktail-status" });
    this.statusEl = status;

    // Tabs (devtools-ish)
    const { bar: tabBar, setActive: setTabActive } = UI.tabGroup([
      { id: "preview", label: t("app.sparktail.tab.preview") },
      { id: "source",  label: t("app.sparktail.tab.source")  },
      { id: "headers", label: t("app.sparktail.tab.headers") },
    ], (id) => { this.tab = /** @type {any} */ (id); this._renderTab(); });
    this._setTabActive = setTabActive;
    // protocol choice: Auto behaves like real browsers (HTTP/2 via ALPN for https)
    const protoSel = UI.select(PROTOCOL_MODES.map(m => ({ value: m, label: t(`app.sparktail.proto.${m}`) })), {
      value: this.protocolMode,
      className: ["input", "sparktail-proto"],
      onChange: (v) => this._setProtocolMode(v),
    });
    protoSel.title = t("app.sparktail.proto.title");
    this.protoEl = protoSel;
    const tabRow = UI.el("div", { className: "sparktail-tab-row", children: [tabBar, protoSel] });

    // Content areas
    const iframe = /** @type {HTMLIFrameElement} */ (UI.el("iframe", {
      className: "sparktail-preview",
      // external default: no scripts
      attrs: { sandbox: "allow-forms allow-pointer-lock allow-popups-to-escape-sandbox" },
    }));
    this.previewFrame = iframe;

    const source = /** @type {HTMLTextAreaElement} */ (UI.el("textarea", { className: "sparktail-source" }));
    source.readOnly = true;
    this.sourceEl = source;

    const headersTA = /** @type {HTMLTextAreaElement} */ (UI.el("textarea", { className: "sparktail-headers" }));
    headersTA.readOnly = true;
    this.headersEl = headersTA;

    const content = UI.el("div", { className: "sparktail-content" });
    content.appendChild(iframe);
    content.appendChild(source);
    content.appendChild(headersTA);

    const lockEl = UI.el("span", { className: "sparktail-lock sparktail-lock-none" });
    this._lockEl = lockEl;
    this.disposer.on(lockEl, "click", () => this._toggleCertPopup());

    const certPopupEl = UI.el("div", { className: "sparktail-cert-popup" });
    certPopupEl.hidden = true;
    this._certPopupEl = certPopupEl;

    // Browser-ish chrome bar
    const chromeBar = UI.el("div", { className: "sparktail-chrome" });
    chromeBar.appendChild(back);
    chromeBar.appendChild(fwd);
    chromeBar.appendChild(reload);
    chromeBar.appendChild(lockEl);
    chromeBar.appendChild(urlInput);
    chromeBar.appendChild(go);
    chromeBar.appendChild(stop);
    chromeBar.appendChild(throbber);

    const panel = UI.panel([chromeBar, tabRow, content, status]);
    panel.appendChild(certPopupEl);
    this.root.replaceChildren(panel);

    // Listen for internal page navigation (about:start links)
    /** @param {MessageEvent} ev */
    const onMsg = (ev) => {
      const d = ev?.data;
      if (!d || d.__sparktail !== true) return;
      if (d.type === "navigate" && typeof d.url === "string") {
        const u = normalizeUrlInput(d.url);
        if (!u) return;
        if (this.urlEl) this.urlEl.value = u;
        this._navigate(u, true);
      }
      if (d.type === "certProceed" && typeof d.url === "string") {
        this._bypassCertCheck = true;
        const u = d.url;
        if (this.urlEl) this.urlEl.value = u;
        this._navigate(u, false);
      }
    };
    window.addEventListener("message", onMsg);
    this.disposer.add(() => window.removeEventListener("message", onMsg));

    // initialize history with initial url
    this._pushHistory(this.url);

    this._syncUI();
    this._renderTab();
    this._setStatus(t("app.sparktail.status.ready"));

    // show start page immediately
    this._fetchUrl(this.url);

    // throbber tick
    this.disposer.interval(() => {
      if (!this.throbberEl) return;
      this.throbberEl.textContent = this.loading ? t("app.sparktail.throbber.loading") : "";
    }, 120);
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl = null;
    this.urlEl = null;
    this.goBtn = null;
    this.stopBtn = null;
    this.backBtn = null;
    this.fwdBtn = null;
    this.reloadBtn = null;
    this.throbberEl = null;
    this.statusEl = null;
    this.previewFrame = null;
    this.sourceEl = null;
    this.headersEl = null;
    this.protoEl = null;
    this._lockEl = null;
    this._certPopupEl = null;
    this._serverCert = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    this._closePool();
    super.destroy();
  }

  // ── connection pool: HTTP/1.1 keep-alive and shared HTTP/2 ─────────────────

  /** @param {BrowserConn} conn */
  _closeConn(conn) {
    conn.closing = true;
    if (conn.h2) { try { conn.h2.goaway(); } catch { /* ignore */ } }
    if (conn.tls) { try { conn.tls.close(); } catch { /* ignore */ } }
    try { this.os.net.closeTCPConn(conn.key); } catch { /* ignore */ }
  }

  /**
   * Connections opened with "proceed anyway" live in their own pool slot, so
   * a later normal navigation runs the certificate check again.
   * @param {string} origin @param {boolean} bypass
   */
  _poolKey(origin, bypass) {
    return bypass ? `${origin} (insecure)` : origin;
  }

  /** All pooled connections (idle HTTP/1.1 and shared HTTP/2). @returns {BrowserConn[]} */
  _pooledConns() {
    return [...[...this._pool.values()].flat(), ...this._h2.values()];
  }

  /**
   * Park an idle HTTP/1.1 connection for reuse. When the server closes it
   * later (keep-alive timeout), it is dropped and our side is closed as well.
   * @param {BrowserConn} conn
   */
  _poolPut(conn) {
    const key = this._poolKey(conn.origin, conn.bypass);
    const list = this._pool.get(key) ?? [];
    if (list.includes(conn)) return;
    if (list.length >= MAX_CONNS_PER_ORIGIN) { this._closeConn(conn); return; }
    list.push(conn);
    this._pool.set(key, list);
    conn.reader.watchIdle(() => {
      const l = this._pool.get(key);
      const i = l ? l.indexOf(conn) : -1;
      if (!l || i < 0) return;
      l.splice(i, 1);
      if (l.length === 0) this._pool.delete(key);
      this._closeConn(conn);
      this._appendLog(t("app.sparktail.log.connClosedByServer", { time: nowStamp(), origin: conn.origin, count: conn.requests }));
    });
  }

  /**
   * Share an HTTP/2 connection for its origin until it ends (GOAWAY from the
   * server after its idle timeout, or transport close).
   * @param {BrowserConn} conn
   */
  _registerH2(conn) {
    const key = this._poolKey(conn.origin, conn.bypass);
    this._h2.set(key, conn);
    const h2 = /** @type {Http2Connection} */ (conn.h2);
    const drop = () => {
      if (this._h2.get(key) !== conn) return;
      this._h2.delete(key);
      if (!conn.closing) {
        this._appendLog(t("app.sparktail.log.connClosedByServer", { time: nowStamp(), origin: conn.origin, count: conn.requests }));
      }
      this._closeConn(conn);
    };
    h2.onGoaway = () => { if (h2.activeStreams === 0) drop(); else h2.onIdle = drop; };
    h2.done.then(drop);
  }

  /**
   * Get a connection for a request: a shared HTTP/2 one, an idle HTTP/1.1
   * one, or a new one. While a connection that may become HTTP/2 is being
   * opened, further requests wait for it instead of opening their own.
   * @param {{ scheme: string, host: string, port: number, ip: IPAddress,
   *           bypass: boolean, isCancelled: () => boolean }} o
   * @returns {Promise<{ conn: BrowserConn, reused: boolean }>}
   */
  async _acquire(o) {
    const origin = originKey(o.scheme, o.host, o.port);
    const key = this._poolKey(origin, o.bypass);
    for (;;) {
      const shared = this._h2.get(key);
      if (shared?.h2?.usable) return { conn: shared, reused: true };
      const idle = this._pool.get(key)?.pop();
      if (idle) {
        if (this._pool.get(key)?.length === 0) this._pool.delete(key);
        return { conn: idle, reused: true };
      }
      const pending = this._opening.get(key);
      if (!pending) break;
      const c = await pending.catch(() => null);
      if (!c?.h2) break;    // it became HTTP/1.1: open our own connection
    }
    const mayBeH2 = this.protocolMode !== "http1" && (o.scheme === "https" || this.protocolMode === "h2");
    const p = this._openConn(o);
    if (mayBeH2) this._opening.set(key, p);
    try {
      const conn = await p;
      if (conn.h2) this._registerH2(conn);
      return { conn, reused: false };
    } finally {
      if (this._opening.get(key) === p) this._opening.delete(key);
    }
  }

  /**
   * Done with a connection after a response.
   * @param {BrowserConn} conn @param {boolean} reusable
   */
  _release(conn, reusable) {
    if (conn.h2) {
      if (!conn.h2.usable && conn.h2.activeStreams === 0) this._closeConn(conn);
      return;
    }
    if (reusable) this._poolPut(conn);
    else this._closeConn(conn);
  }

  _closePool() {
    for (const conn of this._pooledConns()) this._closeConn(conn);
    this._pool.clear();
    this._h2.clear();
  }

  /**
   * Open a TCP connection (plus TLS for https) and pick the protocol:
   * ALPN decides for https, the protocol setting for http (h2c only with
   * "HTTP/2"). Throws an Error with `stage` = "connect" | "tls" | "proto";
   * for "tls" also `tls` (for the peer cert).
   * @param {{ scheme: string, host: string, port: number, ip: IPAddress,
   *           bypass: boolean, isCancelled: () => boolean }} o  bypass: "proceed anyway", no certificate check
   * @returns {Promise<BrowserConn>}
   */
  async _openConn(o) {
    const timeout = this._timeoutMs();
    const mode = this.protocolMode;
    /** @type {string|undefined} */
    let key;
    try {
      const conn = await withTimeout(this.os.net.connectTCPConn(o.ip, o.port), SimTimer.TCP_CONNECT_TIMEOUT_MS, t("app.sparktail.label.connect"));
      key = conn?.key;
      if (typeof key !== "string" || !key) throw new Error(t("app.sparktail.err.noConnKey"));
    } catch (e) {
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { stage: "connect" });
    }
    const k = key;

    /** @type {(d: Uint8Array) => void|Promise<void>} */
    let send = (d) => this.os.net.sendTCPConn(k, d);
    /** @type {() => Promise<Uint8Array|null>} */
    let recv = () => this.os.net.recvTCPConn(k);
    /** @type {TlsSession|null} */
    let tls = null;
    let useH2 = o.scheme === "http" && mode === "h2";
    let proto = useH2 ? "HTTP/2 (h2c, prior knowledge)" : "HTTP/1.1";

    if (o.scheme === "https") {
      // ALPN offer (RFC 7301), most preferred first
      const alpn = mode === "http1" ? ["http/1.1"] : mode === "h2" ? ["h2"] : ["h2", "http/1.1"];
      tls = new TlsSession({
        send, recv, isServer: false,
        trustStore: o.bypass ? undefined : (this.os.tls?.certStore ?? undefined),
        timeoutMs: timeout,
        sleepFn: (ms) => simTimer.sleep(ms),
        now: () => this.os.clock.nowMs(),
        serverName: o.host,
        alpn,
      });
      try {
        await withTimeout(tls.handshake(), timeout, t("app.sparktail.label.tlsHandshake"));
      } catch (e) {
        try { tls.close(); } catch { /* ignore */ }
        try { this.os.net.closeTCPConn(k); } catch { /* ignore */ }
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { stage: "tls", tls });
      }
      useH2 = tls.alpn === "h2";
      if (mode === "h2" && !useH2) {
        try { tls.close(); } catch { /* ignore */ }
        try { this.os.net.closeTCPConn(k); } catch { /* ignore */ }
        throw Object.assign(new Error(t("app.sparktail.err.noHttp2")), { stage: "proto" });
      }
      proto = useH2 ? "HTTP/2 (ALPN h2)" : tls.alpn ? `HTTP/1.1 (ALPN ${tls.alpn})` : "HTTP/1.1";
      const session = tls;
      send = (d) => session.send(/** @type {Uint8Array<ArrayBuffer>} */ (d));
      recv = () => session.recv();
    }

    /** @type {Http2Connection|null} */
    let h2 = null;
    if (useH2) {
      h2 = new Http2Connection({ send, recv, isServer: false });
      h2.start();
    }
    const origin = originKey(o.scheme, o.host, o.port);
    this._appendLog(t("app.sparktail.log.protocol", { time: nowStamp(), origin, proto }));

    return {
      origin,
      key: k,
      tls,
      send,
      // HTTP/2 owns the transport; the reader is only used for HTTP/1.1
      reader: new TcpBufferedReader({ recv: h2 ? async () => null : recv, isCancelled: o.isCancelled, timeoutMs: timeout }),
      h2,
      proto,
      peerCert: tls?.peerCert ?? null,
      bypass: o.bypass,
      requests: 0,
      closing: false,
    };
  }

  /**
   * One GET on `conn`, HTTP/1.1 or HTTP/2. Throws an Error with
   * `stale: true` when a reused connection turned out to be gone before
   * anything was received (the caller may retry on a fresh connection).
   * @param {BrowserConn} conn
   * @param {{ path: string, hostHeader: string, scheme: string, accept: string,
   *           bodyLimit: number, isCancelled: () => boolean, reused: boolean,
   *           onSent?: (info: { bytes: Uint8Array|null, streamId: number }) => void }} r
   * @returns {Promise<BrowserResponse>}
   */
  async _exchange(conn, r) {
    if (conn.h2) {
      const h2 = conn.h2;
      try {
        const p = h2.request({
          scheme: r.scheme, authority: r.hostHeader, path: r.path,
          headers: [["user-agent", "Sparktail/1.0"], ["accept", r.accept]],
        });
        r.onSent?.({ bytes: null, streamId: h2.lastStreamId });
        const res = await withTimeout(p, this._timeoutMs(), t("app.sparktail.label.recv"));
        conn.requests++;
        if (res.body.length > r.bodyLimit) throw new Error(t("app.sparktail.err.bodyLimitExceeded", { bodyLimit: r.bodyLimit }));
        /** @type {Record<string,string>} */
        const headers = {};
        for (const [n, v] of res.headers) headers[n] = headers[n] ? `${headers[n]}, ${v}` : v;
        const statusLine = `HTTP/2 ${res.status}`;
        return {
          statusLine, statusCode: res.status, reason: "",
          headerText: [statusLine, ...res.headers.map(([n, v]) => `${n}: ${v}`)].join("\r\n"),
          headers, body: res.body, reusable: h2.usable, streamId: res.streamId,
        };
      } catch (e) {
        // refused before processing (GOAWAY, closed connection): safe to retry
        if (e instanceof Http2Error && e.retryable) throw Object.assign(new Error(e.message), { stale: true });
        throw e;
      }
    }

    const req =
      `GET ${r.path} HTTP/1.1\r\n` +
      `Host: ${r.hostHeader}\r\n` +
      `User-Agent: Sparktail/1.0\r\n` +
      `Accept: ${r.accept}\r\n` +
      `Connection: keep-alive\r\n` +
      `\r\n`;
    const bytes = encodeUTF8(req);
    conn.reader._isCancelled = r.isCancelled;
    try {
      await conn.send(bytes);
    } catch (e) {
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { stale: r.reused, stage: "send" });
    }
    r.onSent?.({ bytes, streamId: 0 });
    try {
      const res = await readHttpResponse(conn.reader, r.bodyLimit);
      conn.requests++;
      return { ...res, streamId: 0 };
    } catch (e) {
      // nothing received on a reused connection: the server had closed it
      const stale = r.reused && conn.reader.closed && conn.reader.buf.length === 0;
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { stale });
    }
  }

  /** @param {string} text */
  _setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = String(text ?? "");
  }

  _syncNavButtons() {
    if (this.backBtn) this.backBtn.disabled = this.loading || this.historyIndex <= 0;
    if (this.fwdBtn) this.fwdBtn.disabled = this.loading || this.historyIndex >= this.history.length - 1;
    if (this.reloadBtn) this.reloadBtn.disabled = this.loading || this.historyIndex < 0;
  }

  _syncUI() {
    const busy = this.loading;
    if (this.goBtn) this.goBtn.disabled = busy;
    if (this.stopBtn) this.stopBtn.disabled = !busy;
    if (this.urlEl) this.urlEl.disabled = busy;
    this._syncNavButtons();
  }

  _renderTab() {
    if (this.previewFrame) this.previewFrame.style.display = this.tab === "preview" ? "" : "none";
    if (this.sourceEl) this.sourceEl.style.display = this.tab === "source" ? "" : "none";
    if (this.headersEl) this.headersEl.style.display = this.tab === "headers" ? "" : "none";
    this._setTabActive?.(this.tab);
  }

  /** @param {string} url */
  _pushHistory(url) {
    // If we are mid-history, truncate forward entries
    if (this.historyIndex < this.history.length - 1) {
      this.history.splice(this.historyIndex + 1);
    }
    this.history.push(url);
    this.historyIndex = this.history.length - 1;
    this._syncNavButtons();
  }

  /** @param {number} index */
  _navTo(index) {
    if (index < 0 || index >= this.history.length) return;
    const url = this.history[index];
    this.historyIndex = index;
    if (this.urlEl) this.urlEl.value = url;
    this.url = url;
    this._syncNavButtons();
    this._fetchUrl(url);
  }

  _goFromUI() {
    const raw = (this.urlEl?.value ?? "").trim();
    if (!raw) {
      this._appendLog(t("app.sparktail.log.urlEmpty", { time: nowStamp() }));
      this._setStatus(t("app.sparktail.status.errorUrlEmpty"));
      return;
    }

    const u = normalizeUrlInput(raw);
    this.url = u;
    if (this.urlEl) this.urlEl.value = u;

    // Only add to history if it differs from current entry
    const cur = this.historyIndex >= 0 ? this.history[this.historyIndex] : null;
    if (cur !== u) this._pushHistory(u);

    this._fetchUrl(u);
  }

  /**
   * Navigate programmatically (used by about:start links).
   * @param {string} url
   * @param {boolean} pushHistory
   */
  _navigate(url, pushHistory) {
    const u = normalizeUrlInput(url);
    if (!u) return;
    this.url = u;

    if (pushHistory) {
      const cur = this.historyIndex >= 0 ? this.history[this.historyIndex] : null;
      if (cur !== u) this._pushHistory(u);
    }

    this._fetchUrl(u);
  }

  _stop() {
    this._closePool();
    const tls = this._activeTls;
    this._activeTls = null;
    if (tls) { try { tls.close(); } catch { /* ignore */ } }
    this._hideCertPopup();
    this._setLockState("none");

    // cancels current request by bumping seq and closing conn
    this.requestSeq++;
    this.loading = false;
    this._syncUI();

    const key = this.connKey;
    this.connKey = null;
    if (key) {
      try {
        this.os.net.closeTCPConn(key);
      } catch {
        /* ignore */
      }
    }
    this._appendLog(t("app.sparktail.log.stop", { time: nowStamp() }));
    this._setStatus(t("app.sparktail.status.stopped"));
  }

  /**
   * @returns {number} timeout in ms
   */
  _timeoutMs() {
    return SimTimer.HTTP_CLIENT_TIMEOUT_MS;
  }

  /**
   * External pages: no scripts
   * Internal pages (about:*): allow scripts so start page can postMessage
   * @param {boolean} allowScripts
   */
  _setIframePolicy(allowScripts) {
    if (!this.previewFrame) return;
    if (allowScripts) {
      // for about:* pages only
      this.previewFrame.setAttribute(
        "sandbox",
        "allow-scripts allow-forms allow-pointer-lock allow-popups-to-escape-sandbox"
      );
    } else {
      // for external content
      this.previewFrame.setAttribute("sandbox", "allow-forms allow-pointer-lock allow-popups-to-escape-sandbox");
    }
  }

  /**
   * @param {string} url
   */
  async _fetchUrl(url) {
    if (this.loading) return;

    const bypassCert = this._bypassCertCheck;
    this._bypassCertCheck = false;
    this._hideCertPopup();
    this._serverCert = null;
    this._certTrusted = false;
    this._setLockState("none");

    const seq = ++this.requestSeq;
    this.loading = true;
    this._syncUI();

    // reset views
    if (this.sourceEl) this.sourceEl.value = "";
    if (this.headersEl) this.headersEl.value = "";
    this.tab = "preview";
    this._renderTab();
    this._setStatus(t("app.sparktail.status.loading", { url }));

    // about:* pages are internal
    const utrim = url.trim();
    if (utrim.toLowerCase() === "about:start") {
      this._showStartPage();
      this._appendLog(t("app.sparktail.log.aboutStart", { time: nowStamp() }));
      this._setStatus(t("app.sparktail.status.startPage"));
      this.loading = false;
      this._syncUI();
      return;
    }

    if (utrim.toLowerCase() === "about:beaver") {
      this._showBeaverGame();
      this._appendLog(`[${nowStamp()}] about:beaver`);
      this._setStatus("about:beaver");
      this.loading = false;
      this._syncUI();
      return;
    }

    // external policy
    this._setIframePolicy(false);

    const parsed = parseHttpUrl(url);
    if (!parsed.ok) {
      this._showInternalPage(t("app.sparktail.page.invalidUrl.title"), parsed.error ?? "");
      this.loading = false;
      this._syncUI();
      this._setStatus(t("app.sparktail.status.invalidUrl", { error: parsed.error }));
      return;
    }

    const { scheme, host, port, path } = parsed;
    const bodyLimit = 1_048_576;

    /** @type {(name:string)=>Promise<import("../net/models/IPAddress.js").IPAddress|null>} */
    const dnsResolve = async (name) => {
      return await this.os.dns.resolveIP(name);
    };

    /** @type {IPAddress|null} */
    let dstIP = null;

    try {
      dstIP = await withTimeout(
        resolveHostToIP(/** @type {string} */ (host), dnsResolve),
        SimTimer.DNS_RESOLVE_TIMEOUT_MS,
        t("app.sparktail.label.dns")
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._appendLog(t("app.sparktail.log.dnsError", { time: nowStamp(), host, msg }));
      this._showInternalPage(
        t("app.sparktail.page.dnsError.title"),
        t("app.sparktail.page.dnsError.body", { host, msg })
      );
      this.loading = false;
      this._syncUI();
      this._setStatus(t("app.sparktail.status.dnsError", { host }));
      return;
    }

    if (!dstIP) {
      const msg = t("app.sparktail.err.cannotResolveHost", { host });
      this._appendLog(t("app.sparktail.log.dnsError", { time: nowStamp(), host, msg }));
      this._showInternalPage(
        t("app.sparktail.page.dnsError.title"),
        t("app.sparktail.page.dnsError.body", { host, msg })
      );
      this.loading = false;
      this._syncUI();
      this._setStatus(t("app.sparktail.status.dnsError", { host }));
      return;
    }


    const defaultPort = scheme === "https" ? 443 : 80;
    const hostHeader = /** @type {string} */ (host).includes(":")
      ? `[${host}]${port !== defaultPort ? `:${port}` : ""}`
      : `${host}${port !== defaultPort ? `:${port}` : ""}`;

    /** @type {string} */
    let headerText = "";
    /** @type {Record<string,string>} */
    let headers = {};
    /** @type {Uint8Array} */
    let bodyBytes = new Uint8Array(0);
    /** @type {number} */
    let statusCode = 0;
    /** @type {string} */
    let reason = "";
    let protoLabel = "";

    const openArgs = {
      scheme: /** @type {string} */ (scheme), host: /** @type {string} */ (host), port: /** @type {number} */ (port), ip: dstIP,
      // a connection opened with "proceed anyway" is only reused for the same decision
      bypass: bypassCert,
      isCancelled: () => !this.loading || this.requestSeq !== seq,
    };

    // At most two rounds: a reused connection the server has meanwhile
    // closed fails before any response byte — then retry on a fresh one.
    for (let attempt = 0; ; attempt++) {
      /** @type {BrowserConn} */
      let c;
      let reused = false;
      if (scheme === "https" && attempt === 0) {
        this._setStatus(t("app.sparktail.status.tlsHandshaking"));
      }
      try {
        ({ conn: c, reused } = await this._acquire(openArgs));
      } catch (e) {
        const err = /** @type {any} */ (e);
        const msg = e instanceof Error ? e.message : String(e);
        if (err?.stage === "tls") {
          const tls = /** @type {TlsSession} */ (err.tls);
          if (e instanceof TlsCertNameMismatchError) {
            this._showCertErrorPage(tls.peerCert, url, "nameMismatch", host);
          } else if (e instanceof TlsCertUntrustedError) {
            this._showCertErrorPage(tls.peerCert, url, "untrusted");
          } else if (e instanceof TlsCertExpiredError) {
            this._showCertErrorPage(tls.peerCert, url, e.reason);
          } else {
            this._appendLog(t("app.sparktail.log.tlsFailed", { time: nowStamp(), reason: msg }));
            this._showInternalPage(t("app.sparktail.page.tlsError.title"), msg);
            this._setStatus(t("app.sparktail.status.tlsFailed"));
          }
          this._stop();
          return;
        }
        if (err?.stage === "proto") {
          this._appendLog(t("app.sparktail.log.tlsFailed", { time: nowStamp(), reason: msg }));
          this._showInternalPage(t("app.sparktail.page.tlsError.title"), msg);
          this._setStatus(t("app.sparktail.status.tlsFailed"));
          this._stop();
          return;
        }
        this._appendLog(t("app.sparktail.log.connectError", { time: nowStamp(), ip: dstIP.toString(), port, msg }));
        this._showInternalPage(
          t("app.sparktail.page.socketError.title"),
          t("app.sparktail.page.socketError.body", { host, port, msg })
        );
        this.loading = false;
        this.connKey = null;
        this._syncUI();
        this._setStatus(t("app.sparktail.status.socketError", { host, port }));
        return;
      }

      if (reused) {
        this._appendLog(t("app.sparktail.log.connReused", { time: nowStamp(), origin: c.origin, count: c.requests }));
      } else if (scheme === "https") {
        this._appendLog(t("app.sparktail.log.tlsOk", { time: nowStamp(), host }));
      }
      if (scheme === "https") {
        this._serverCert = c.peerCert;
        this._certTrusted = !c.bypass;
        this._setLockState(c.bypass ? "insecure" : "secure");
      }

      // an HTTP/2 connection is shared: Stop must not tear it down
      this.connKey = c.h2 ? null : c.key;
      this._activeTls = c.h2 ? null : c.tls;
      const conn = c;

      try {
        const res = await this._exchange(conn, {
          path: /** @type {string} */ (path), hostHeader, scheme: /** @type {string} */ (scheme),
          accept: "text/html, text/plain, */*", bodyLimit, reused,
          isCancelled: () => !this.loading || this.requestSeq !== seq || (!conn.h2 && this.connKey !== conn.key),
          onSent: ({ bytes, streamId }) => this._appendLog(bytes
            ? t("app.sparktail.log.request", { time: nowStamp(), host, port, path, len: bytes.length, hex: hexPreview(bytes) })
            : t("app.sparktail.log.requestH2", { time: nowStamp(), host, port, path, stream: streamId })),
        });
        ({ headerText, headers, statusCode, reason } = res);
        bodyBytes = res.body;
        protoLabel = conn.h2 ? "HTTP/2" : "HTTP/1.1";
        if (this.headersEl) this.headersEl.value = headerText;
        this._activeTls = null;
        if (this.connKey === conn.key) this.connKey = null;
        this._release(conn, res.reusable);
        break;
      } catch (e) {
        const err = /** @type {any} */ (e);
        this._activeTls = null;
        if (this.connKey === conn.key) this.connKey = null;
        if (conn.h2) { if (!conn.h2.usable) this._closeConn(conn); }
        else this._closeConn(conn);
        if (err?.stale && attempt === 0) {
          this._appendLog(t("app.sparktail.log.connStale", { time: nowStamp(), origin: conn.origin }));
          continue;
        }
        const msg = e instanceof Error ? e.message : String(e);
        const sendFailed = err?.stage === "send";
        this._appendLog(t(sendFailed ? "app.sparktail.log.sendError" : "app.sparktail.log.recvError", { time: nowStamp(), msg }));
        this._showInternalPage(t(sendFailed ? "app.sparktail.page.sendError.title" : "app.sparktail.page.recvError.title"), msg);
        this._stop();
        return;
      }
    }

    // If cancelled, stop quietly
    if (!this.loading || this.requestSeq !== seq) return;

    // Render / display
    if (bodyBytes.length > bodyLimit) {
      this._showInternalPage(
        t("app.sparktail.page.bodyTooLarge.title"),
        t("app.sparktail.page.bodyTooLarge.body", { bytes: bodyBytes.length, bodyLimit })
      );
      this.loading = false;
      this._syncUI();
      this._setStatus(t("app.sparktail.status.bodyTooLarge", { statusCode }));
      return;
    }

    const bodyText = decodeUTF8(bodyBytes);

    if (statusCode !== 200 && statusCode !== 404) {
      this._appendLog(t("app.sparktail.log.httpNotRendered", { time: nowStamp(), statusCode, reason }));
      this._showInternalPage(
        t("app.sparktail.page.notSupported.title"),
        t("app.sparktail.page.notSupported.body", { statusCode, reason })
      );
      if (this.sourceEl) this.sourceEl.value = bodyText;

      const ct = headers["content-type"] || t("app.sparktail.value.unknown");
      this._setStatus(`${t("app.sparktail.status.httpSummary", { statusCode, reason, bytes: bodyBytes.length, ct })} · ${protoLabel}`);

      this.loading = false;
      this._syncUI();
      return;
    }

    if (this.sourceEl) this.sourceEl.value = bodyText;

    if (this.previewFrame) {
      if (isHtml(headers)) {
        const isCancelled = () => !this.loading || this.requestSeq !== seq;
        const inlined = await this._inlineResources(bodyText, url, isCancelled, bypassCert);
        if (isCancelled()) return;
        this._setIframePolicy(true); // allow our injected nav script to run
        this.previewFrame.srcdoc = inlined;
      } else {
        this.previewFrame.srcdoc = internalErrorPage(
          t("app.sparktail.page.nonHtml.title", { statusCode }),
          t("app.sparktail.page.nonHtml.body", {
            ct: headers["content-type"] || t("app.sparktail.value.unknown"),
          })
        );
      }
    }

    const ct = headers["content-type"] || t("app.sparktail.value.unknown");
    this._appendLog(t("app.sparktail.log.httpOk", { time: nowStamp(), statusCode, reason, bytes: bodyBytes.length }));
    this._setStatus(`${t("app.sparktail.status.httpSummary", { statusCode, reason, bytes: bodyBytes.length, ct })} · ${protoLabel}`);

    this.loading = false;
    this._syncUI();
  }

  /** @param {"none"|"secure"|"insecure"} state */
  _setLockState(state) {
    if (!this._lockEl) return;
    this._lockEl.className = `sparktail-lock sparktail-lock-${state}`;
    const icon = state === "secure" ? "fa-lock"
      : state === "insecure" ? "fa-lock-open"
      : "";
    this._lockEl.innerHTML = icon ? `<i class="fa-solid ${icon}"></i>` : "";
  }

  /**
   * @param {import("../net/models/TlsCertificate.js").TlsCertificate|null} cert
   * @param {string} url
   * @param {"untrusted"|"expired"|"notYetValid"|"nameMismatch"} [reason]
   * @param {string} [host]
   */
  _showCertErrorPage(cert, url, reason = "untrusted", host = "") {
    this._setIframePolicy(true);
    const subject = cert?.subject ?? "?";
    const [titleKey, detailKey] = reason === "expired"
      ? ["app.sparktail.tls.certExpired.title",      "app.sparktail.tls.certExpired.detail"]
      : reason === "notYetValid"
      ? ["app.sparktail.tls.certNotYetValid.title",  "app.sparktail.tls.certNotYetValid.detail"]
      : reason === "nameMismatch"
      ? ["app.sparktail.tls.certNameMismatch.title", "app.sparktail.tls.certNameMismatch.detail"]
      : ["app.sparktail.tls.certError.title",        "app.sparktail.tls.certError.detail"];
    if (this.previewFrame) {
      this.previewFrame.srcdoc = certErrorPage(cert, url, {
        title:       t(titleKey),
        detail:      t(detailKey, { subject, host }),
        subject:     t("app.sparktail.tls.certPopup.subject"),
        issuer:      t("app.sparktail.tls.certPopup.issuer"),
        fingerprint: t("app.sparktail.tls.certPopup.fingerprint"),
        expiry:      t("app.sparktail.tls.certPopup.expiry"),
        selfSigned:  t("app.sparktail.tls.certPopup.selfSigned"),
        proceed:     t("app.sparktail.tls.proceedAnyway"),
      });
    }
    if (this.sourceEl)  this.sourceEl.value  = "";
    if (this.headersEl) this.headersEl.value = "";
    this.tab = "preview";
    this._renderTab();
  }

  _toggleCertPopup() {
    if (!this._certPopupEl || !this._serverCert) return;
    if (!this._certPopupEl.hidden) {
      this._hideCertPopup();
      return;
    }
    this._renderCertPopup();
    this._certPopupEl.hidden = false;

    const onOutside = (/** @type {MouseEvent} */ e) => {
      if (!this._certPopupEl?.contains(/** @type {Node} */ (e.target)) &&
          e.target !== this._lockEl) {
        this._hideCertPopup();
        document.removeEventListener("click", onOutside, true);
      }
    };
    // defer so this click event doesn't immediately close it
    setTimeout(() => document.addEventListener("click", onOutside, true), 0);
  }

  _hideCertPopup() {
    if (!this._certPopupEl) return;
    this._certPopupEl.hidden = true;
    this._certPopupEl.replaceChildren();
  }

  _renderCertPopup() {
    if (!this._certPopupEl || !this._serverCert) return;
    const cert = this._serverCert;
    const trusted = this._certTrusted;
    const expiry = new Date(cert.notAfter).toLocaleDateString();

    const nowMs = this.os.clock ? this.os.clock.nowMs() : Date.now();
    const validity = cert.validityStatus(nowMs);

    const trustEl = UI.el("div", {
      className: "cert-popup-trust " + (trusted ? "cert-trust-ok" : "cert-trust-warn"),
      text: trusted
        ? t("app.sparktail.tls.certPopup.trusted")
        : t("app.sparktail.tls.certPopup.notVerified"),
    });
    const validityEl = validity !== "valid" ? UI.el("div", {
      className: "cert-popup-trust cert-trust-warn",
      text: validity === "expired"
        ? t("app.sparktail.tls.certPopup.expiredWarning")
        : t("app.sparktail.tls.certPopup.notYetValidWarning"),
    }) : null;

    const row = (/** @type {string} */ label, /** @type {string} */ value) =>
      UI.el("div", { className: "cert-popup-row", children: [
        UI.el("span", { className: "cert-popup-label", text: label }),
        UI.el("span", { className: "cert-popup-value", text: value }),
      ]});

    const selfSignedSuffix = cert.selfSigned
      ? ` (${t("app.sparktail.tls.certPopup.selfSigned")})`
      : "";

    /** @type {Node[]} */
    const children = [
      UI.el("div", { className: "cert-popup-title", text: t("app.sparktail.tls.certPopup.title") }),
      trustEl,
      validityEl,
      row(t("app.sparktail.tls.certPopup.subject"),     cert.subject),
      row(t("app.sparktail.tls.certPopup.issuer"),      cert.issuer + selfSignedSuffix),
      row(t("app.sparktail.tls.certPopup.fingerprint"), cert.fingerprint()),
      row(t("app.sparktail.tls.certPopup.expiry"),      expiry),
    ].filter((x) => x != null);
    this._certPopupEl.replaceChildren(...children);
  }

  /**
   * @param {string} title
   * @param {string} text
   */
  _showInternalPage(title, text) {
    // internal pages may use scripts? not needed here, keep it strict
    this._setIframePolicy(false);
    if (this.previewFrame) this.previewFrame.srcdoc = internalErrorPage(title, text);
    if (this.sourceEl) this.sourceEl.value = "";
    if (this.headersEl) this.headersEl.value = "";
    this.tab = "preview";
    this._renderTab();
  }

  _showStartPage() {
    this._setIframePolicy(true); // allow scripts for about:start so links can postMessage
    const html = startPage;
    if (this.previewFrame) this.previewFrame.srcdoc = html;
    if (this.sourceEl) this.sourceEl.value = html;
    if (this.headersEl) this.headersEl.value = t("app.sparktail.headers.aboutStart");
    this.tab = "preview";
    this._renderTab();
  }

  _showBeaverGame() {
    this._setIframePolicy(true);
    if (this.previewFrame) this.previewFrame.srcdoc = beaverPage;
    if (this.sourceEl) this.sourceEl.value = "";
    if (this.headersEl) this.headersEl.value = "";
    this.tab = "preview";
    this._renderTab();
  }

  /**
   * Fetch a URL through the simulated network without touching UI state.
   * Uses the connection pool, so a page's images and stylesheets travel over
   * the connection(s) the page came on — multiplexed with HTTP/2.
   * Returns null on any error or cancellation.
   * @param {string} url
   * @param {() => boolean} isCancelled
   * @param {boolean} [bypass] the page was opened with "proceed anyway"
   * @returns {Promise<{statusCode: number, headers: Record<string,string>, body: Uint8Array}|null>}
   */
  async _doGet(url, isCancelled, bypass = false) {
    const parsed = parseHttpUrl(url);
    if (!parsed.ok) return null;
    const scheme = /** @type {string} */ (parsed.scheme);
    const host = /** @type {string} */ (parsed.host);
    const port = /** @type {number} */ (parsed.port);
    const path = /** @type {string} */ (parsed.path);
    const defaultPort = scheme === "https" ? 443 : 80;
    const hostHeader = `${host.includes(":") ? `[${host}]` : host}${port !== defaultPort ? `:${port}` : ""}`;

    let dstIP;
    try {
      dstIP = await withTimeout(
        resolveHostToIP(host, (n) => this.os.dns.resolveIP(n)),
        SimTimer.DNS_RESOLVE_TIMEOUT_MS, "dns"
      );
    } catch { return null; }
    if (!dstIP || isCancelled()) return null;

    for (let attempt = 0; attempt < 2; attempt++) {
      let acquired;
      try {
        acquired = await this._acquire({ scheme, host, port, ip: dstIP, bypass, isCancelled });
      } catch { return null; }
      const { conn, reused } = acquired;
      if (isCancelled()) { if (!conn.h2) this._release(conn, true); return null; }
      this._appendLog(reused
        ? t("app.sparktail.log.resourceReused", { time: nowStamp(), url, count: conn.requests })
        : t("app.sparktail.log.resourceNewConn", { time: nowStamp(), url }));
      try {
        const res = await this._exchange(conn, {
          path, hostHeader, scheme, accept: "*/*", bodyLimit: 1_048_576, isCancelled, reused,
        });
        this._release(conn, res.reusable && !isCancelled());
        return { statusCode: res.statusCode, headers: res.headers, body: res.body };
      } catch (e) {
        if (!conn.h2) this._closeConn(conn);
        else if (!conn.h2.usable) this._closeConn(conn);
        if (!(/** @type {any} */ (e))?.stale || isCancelled()) return null;
        // the server closed the idle connection meanwhile: one fresh attempt
        this._appendLog(t("app.sparktail.log.connStale", { time: nowStamp(), origin: conn.origin }));
      }
    }
    return null;
  }

  /**
   * Inline sub-resources into an HTML string before putting it into the iframe:
   * - <img src="..."> → data URI
   * - <link rel="stylesheet" href="..."> → <style> with the CSS text
   * Like a real browser, the resources load in parallel (at most
   * MAX_CONNS_PER_ORIGIN at a time): over HTTP/1.1 that means several
   * connections, over HTTP/2 several streams on one connection.
   * @param {string} html
   * @param {string} baseUrl
   * @param {() => boolean} isCancelled
   * @param {boolean} [bypass] the page was opened with "proceed anyway"
   * @returns {Promise<string>}
   */
  async _inlineResources(html, baseUrl, isCancelled, bypass = false) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    /** @param {string} href @returns {string|null} */
    const resolve = (href) => {
      try { return new URL(href, baseUrl).href; } catch { return null; }
    };

    /** @param {Uint8Array} bytes @returns {string} */
    const toBase64 = (bytes) => {
      const CHUNK = 8192;
      let bin = "";
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
      }
      return btoa(bin);
    };

    /** @type {Array<() => Promise<void>>} */
    const tasks = [];
    for (const img of doc.querySelectorAll("img[src]")) {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) continue;
      const abs = resolve(src);
      if (!abs) continue;
      tasks.push(async () => {
        const res = await this._doGet(abs, isCancelled, bypass);
        if (!res || res.statusCode !== 200 || isCancelled()) return;
        const ct = (res.headers["content-type"] || "image/*").split(";")[0].trim();
        img.setAttribute("src", `data:${ct};base64,${toBase64(res.body)}`);
      });
    }
    for (const link of doc.querySelectorAll('link[rel="stylesheet"][href]')) {
      const href = link.getAttribute("href");
      if (!href) continue;
      const abs = resolve(href);
      if (!abs) continue;
      tasks.push(async () => {
        const res = await this._doGet(abs, isCancelled, bypass);
        if (!res || res.statusCode !== 200 || isCancelled()) return;
        const style = doc.createElement("style");
        style.textContent = decodeUTF8(res.body);
        link.replaceWith(style);
      });
    }

    // run with limited parallelism
    let nextTask = 0;
    const worker = async () => {
      while (nextTask < tasks.length && !isCancelled()) await tasks[nextTask++]();
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONNS_PER_ORIGIN, tasks.length) }, worker));
    if (isCancelled()) return html;

    for (const el of doc.querySelectorAll("iframe, object, embed")) {
      const placeholder = doc.createElement("div");
      placeholder.className = "sparktail-iframe-blocked";
      placeholder.textContent = `[${el.tagName.toLowerCase()} blocked]`;
      el.replaceWith(placeholder);
    }

    // Strip page scripts and inline handlers, then inject Sparktail's own
    // link interceptor so clicks route through _navigate instead of navigating
    // the iframe directly (which would break srcdoc and lose the page content).
    for (const s of doc.querySelectorAll("script")) s.remove();
    for (const el of doc.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
      }
    }
    const nav = doc.createElement("script");
    nav.textContent = `(function(){
      document.addEventListener('click',function(e){
        var a=e.target.closest('a[href]');
        if(!a)return;
        var h=a.getAttribute('href');
        if(!h||h.startsWith('javascript:'))return;
        if(h==='#'||h[0]==='#'){
          e.preventDefault();
          if(h.length>1){var t=document.getElementById(h.slice(1))||document.querySelector('[name="'+h.slice(1)+'"]');if(t)t.scrollIntoView();}
          return;
        }
        e.preventDefault();
        parent.postMessage({__sparktail:true,type:'navigate',url:h},'*');
      },true);
    })();`;
    (doc.head ?? doc.body ?? doc.documentElement).prepend(nav);

    if (isCancelled()) return html;
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  }
}
