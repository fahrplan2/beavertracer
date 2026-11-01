//@ts-check

/**
 * QPACK field compression for HTTP/3 (RFC 9204) — static table only.
 *
 * Both sides announce SETTINGS_QPACK_MAX_TABLE_CAPACITY = 0, which RFC 9204
 * §3.2.3 allows: no dynamic table, no encoder/decoder streams, and every
 * field section starts with Required Insert Count 0. Field lines are encoded
 * as static-table references or literals (Huffman-coded when shorter).
 * A reference to a dynamic table entry is a QPACK_DECOMPRESSION_FAILED error.
 */

import { huffmanEncode, huffmanDecode, huffmanEncodedLength, HpackError } from "./Hpack.js";

export const QPACK_DECOMPRESSION_FAILED = 0x200;

export class QpackError extends Error {
  /** @param {string} msg */
  constructor(msg) {
    super(msg);
    this.name = "QpackError";
    this.code = QPACK_DECOMPRESSION_FAILED;
  }
}

/** Static table (RFC 9204 Appendix A), index 0..98. */
export const QPACK_STATIC_TABLE = Object.freeze(/** @type {Array<readonly [string, string]>} */ ([
  [":authority", ""], [":path", "/"], ["age", "0"], ["content-disposition", ""],
  ["content-length", "0"], ["cookie", ""], ["date", ""], ["etag", ""],
  ["if-modified-since", ""], ["if-none-match", ""], ["last-modified", ""], ["link", ""],
  ["location", ""], ["referer", ""], ["set-cookie", ""], [":method", "CONNECT"],
  [":method", "DELETE"], [":method", "GET"], [":method", "HEAD"], [":method", "OPTIONS"],
  [":method", "POST"], [":method", "PUT"], [":scheme", "http"], [":scheme", "https"],
  [":status", "103"], [":status", "200"], [":status", "304"], [":status", "404"],
  [":status", "503"], ["accept", "*/*"], ["accept", "application/dns-message"], ["accept-encoding", "gzip, deflate, br"],
  ["accept-ranges", "bytes"], ["access-control-allow-headers", "cache-control"], ["access-control-allow-headers", "content-type"], ["access-control-allow-origin", "*"],
  ["cache-control", "max-age=0"], ["cache-control", "max-age=2592000"], ["cache-control", "max-age=604800"], ["cache-control", "no-cache"],
  ["cache-control", "no-store"], ["cache-control", "public, max-age=31536000"], ["content-encoding", "br"], ["content-encoding", "gzip"],
  ["content-type", "application/dns-message"], ["content-type", "application/javascript"], ["content-type", "application/json"], ["content-type", "application/x-www-form-urlencoded"],
  ["content-type", "image/gif"], ["content-type", "image/jpeg"], ["content-type", "image/png"], ["content-type", "text/css"],
  ["content-type", "text/html; charset=utf-8"], ["content-type", "text/plain"], ["content-type", "text/plain;charset=utf-8"], ["range", "bytes=0-"],
  ["strict-transport-security", "max-age=31536000"], ["strict-transport-security", "max-age=31536000; includesubdomains"], ["strict-transport-security", "max-age=31536000; includesubdomains; preload"], ["vary", "accept-encoding"],
  ["vary", "origin"], ["x-content-type-options", "nosniff"], ["x-xss-protection", "1; mode=block"], [":status", "100"],
  [":status", "204"], [":status", "206"], [":status", "302"], [":status", "400"],
  [":status", "403"], [":status", "421"], [":status", "425"], [":status", "500"],
  ["accept-language", ""], ["access-control-allow-credentials", "FALSE"], ["access-control-allow-credentials", "TRUE"], ["access-control-allow-headers", "*"],
  ["access-control-allow-methods", "get"], ["access-control-allow-methods", "get, post, options"], ["access-control-allow-methods", "options"], ["access-control-expose-headers", "content-length"],
  ["access-control-request-headers", "content-type"], ["access-control-request-method", "get"], ["access-control-request-method", "post"], ["alt-svc", "clear"],
  ["authorization", ""], ["content-security-policy", "script-src 'none'; object-src 'none'; base-uri 'none'"], ["early-data", "1"], ["expect-ct", ""],
  ["forwarded", ""], ["if-range", ""], ["origin", ""], ["purpose", "prefetch"],
  ["server", ""], ["timing-allow-origin", "*"], ["upgrade-insecure-requests", "1"], ["user-agent", ""],
  ["x-forwarded-for", ""], ["x-frame-options", "deny"], ["x-frame-options", "sameorigin"],
].map(e => Object.freeze(e))));

/** Fields that must not be indexed (RFC 9204 §7.1.3); we never index anyway, the N bit tells intermediaries. */
const SENSITIVE = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Prefixed integer (RFC 7541 §5.1, used by QPACK as well).
 * @param {number[]} out @param {number} value @param {number} prefixBits @param {number} first
 */
function encodeInt(out, value, prefixBits, first) {
  const max = (1 << prefixBits) - 1;
  if (value < max) { out.push(first | value); return; }
  out.push(first | max);
  value -= max;
  while (value >= 128) { out.push((value & 0x7f) | 0x80); value = Math.floor(value / 128); }
  out.push(value);
}

/**
 * String literal with an H bit right above an N-bit length prefix.
 * @param {number[]} out @param {string} s @param {number} prefixBits @param {number} first
 */
function encodeString(out, s, prefixBits, first) {
  const raw = enc.encode(s);
  const useH = huffmanEncodedLength(raw) < raw.length;
  const data = useH ? huffmanEncode(raw) : raw;
  encodeInt(out, data.length, prefixBits, first | (useH ? 1 << prefixBits : 0));
  for (const b of data) out.push(b);
}

/**
 * Encode a field section (one HEADERS frame payload).
 * @param {Array<[string, string]>} fields lower-case names
 * @returns {Uint8Array}
 */
export function qpackEncode(fields) {
  /** @type {number[]} */
  const out = [0x00, 0x00]; // Required Insert Count 0, Delta Base 0 (§4.5.1)
  for (const [name, value] of fields) {
    let exact = -1, nameIdx = -1;
    for (let i = 0; i < QPACK_STATIC_TABLE.length; i++) {
      const [n, v] = QPACK_STATIC_TABLE[i];
      if (n !== name) continue;
      if (v === value) { exact = i; break; }
      if (nameIdx < 0) nameIdx = i;
    }
    const sensitive = SENSITIVE.has(name);
    if (exact >= 0 && !sensitive) {
      encodeInt(out, exact, 6, 0xc0);                         // indexed, static (§4.5.2): 11 + index
    } else if ((exact >= 0 ? exact : nameIdx) >= 0) {
      encodeInt(out, exact >= 0 ? exact : nameIdx, 4, 0x50 | (sensitive ? 0x20 : 0)); // literal, static name ref (§4.5.4): 01 N T=1
      encodeString(out, value, 7, 0x00);
    } else {
      encodeString(out, name, 3, 0x20 | (sensitive ? 0x10 : 0)); // literal name (§4.5.6): 001 N H
      encodeString(out, value, 7, 0x00);
    }
  }
  return Uint8Array.from(out);
}

/** Cursor with QPACK integer and string decoding. */
class Reader {
  /** @param {Uint8Array} b */
  constructor(b) { this.b = b; this.p = 0; }
  get done() { return this.p >= this.b.length; }
  byte() {
    if (this.p >= this.b.length) throw new QpackError("field section truncated");
    return this.b[this.p++];
  }
  /** @param {number} prefixBits */
  int(prefixBits) {
    const max = (1 << prefixBits) - 1;
    let v = this.byte() & max;
    if (v < max) return v;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (v > 0x7fffffff) throw new QpackError("integer overflow");
      if ((b & 0x80) === 0) return v;
    }
  }
  /** @param {number} prefixBits */
  string(prefixBits) {
    const h = (this.b[this.p] >> prefixBits) & 1;
    const len = this.int(prefixBits);
    if (this.p + len > this.b.length) throw new QpackError("string truncated");
    const raw = this.b.subarray(this.p, this.p + len);
    this.p += len;
    try {
      return dec.decode(h ? huffmanDecode(raw) : raw);
    } catch (e) {
      if (e instanceof HpackError) throw new QpackError(e.message);
      throw e;
    }
  }
}

/** @param {number} i */
function staticEntry(i) {
  const e = QPACK_STATIC_TABLE[i];
  if (!e) throw new QpackError(`static table index ${i} out of range`);
  return e;
}

/**
 * Decode a field section.
 * @param {Uint8Array} block
 * @returns {Array<[string, string]>}
 */
export function qpackDecode(block) {
  const r = new Reader(block);
  const ric = r.int(8);
  r.int(7); // delta base (with sign bit); irrelevant without a dynamic table
  if (ric !== 0) throw new QpackError("dynamic table reference (Required Insert Count > 0)");
  /** @type {Array<[string, string]>} */
  const out = [];
  while (!r.done) {
    const b = r.b[r.p];
    if (b & 0x80) {                                  // indexed field line (§4.5.2)
      if (!(b & 0x40)) throw new QpackError("dynamic table reference");
      const [n, v] = staticEntry(r.int(6));
      out.push([n, v]);
    } else if (b & 0x40) {                           // literal with name reference (§4.5.4)
      if (!(b & 0x10)) throw new QpackError("dynamic table reference");
      const [n] = staticEntry(r.int(4));
      out.push([n, r.string(7)]);
    } else if (b & 0x20) {                           // literal with literal name (§4.5.6)
      const name = r.string(3);
      out.push([name, r.string(7)]);
    } else {                                         // post-base forms: dynamic only (§4.5.3, §4.5.5)
      throw new QpackError("post-base reference");
    }
  }
  return out;
}
