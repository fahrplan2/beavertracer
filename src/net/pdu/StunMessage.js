//@ts-check

import { read16BE, read32BE, write16BE, write32BE } from "../util/byteUtils.js";
import { IPAddress } from "../models/IPAddress.js";

/**
 * Minimal STUN message PDU (RFC 5389 subset) — just enough for a classic
 * "Binding" NAT-discovery exchange, used by StunClient / STUNServerApp to
 * let a host behind a NatEngine-mapped router learn its public-facing
 * IP:port (for the SIP Contact header and the SDP c=/m= lines).
 *
 * Scope (v1):
 *   - Message types: Binding Request (0x0001), Binding Success Response
 *     (0x0101), Binding Error Response (0x0111).
 *   - Attributes: XOR-MAPPED-ADDRESS (0x0020) is built/read; legacy
 *     MAPPED-ADDRESS (0x0001) is read for completeness. IPv4 only — this
 *     sim's NatEngine is IPv4-only too. Unknown attributes round-trip as
 *     raw bytes on parse → pack but are not otherwise interpreted.
 *   - No MESSAGE-INTEGRITY / FINGERPRINT / auth: this is an open, anonymous
 *     Binding usage, same "no auth" simplification SipStack documents for
 *     REGISTER/INVITE.
 */

const MAGIC_COOKIE = 0x2112A442;

export class StunMessage {
  static TYPE_BINDING_REQUEST = 0x0001;
  static TYPE_BINDING_SUCCESS = 0x0101;
  static TYPE_BINDING_ERROR = 0x0111;

  static ATTR_MAPPED_ADDRESS = 0x0001;
  static ATTR_ERROR_CODE = 0x0009;
  static ATTR_XOR_MAPPED_ADDRESS = 0x0020;
  static ATTR_SOFTWARE = 0x8022;

  /** @type {number} */
  type;
  /** @type {Uint8Array} 12 bytes */
  transactionId;
  /** @type {Array<{type: number, value: Uint8Array}>} raw attributes, in wire order */
  attributes;

  /**
   * @param {object} [opts]
   * @param {number} [opts.type]
   * @param {Uint8Array} [opts.transactionId] 12 bytes; a random one is generated if omitted
   * @param {Array<{type: number, value: Uint8Array}>} [opts.attributes]
   * @param {() => number} [opts.rng]
   */
  constructor(opts = {}) {
    this.type = (opts.type ?? StunMessage.TYPE_BINDING_REQUEST) & 0xffff;
    this.transactionId = (opts.transactionId instanceof Uint8Array && opts.transactionId.length === 12)
      ? opts.transactionId
      : StunMessage._randomTransactionId(opts.rng ?? Math.random);
    this.attributes = Array.isArray(opts.attributes) ? opts.attributes : [];
  }

  get isSuccess() { return this.type === StunMessage.TYPE_BINDING_SUCCESS; }
  get isError() { return this.type === StunMessage.TYPE_BINDING_ERROR; }

  /**
   * The XOR-MAPPED-ADDRESS attribute, decoded (or null if absent / not IPv4).
   * @returns {{ip: string, port: number} | null}
   */
  get xorMappedAddress() {
    const attr = this.attributes.find(a => a.type === StunMessage.ATTR_XOR_MAPPED_ADDRESS);
    return attr ? StunMessage._unpackXorAddress(attr.value) : null;
  }

  /**
   * Legacy, non-XOR MAPPED-ADDRESS (RFC 3489), decoded (or null if absent / not IPv4).
   * @returns {{ip: string, port: number} | null}
   */
  get mappedAddress() {
    const attr = this.attributes.find(a => a.type === StunMessage.ATTR_MAPPED_ADDRESS);
    return attr ? StunMessage._unpackPlainAddress(attr.value) : null;
  }

  /**
   * Decoded ERROR-CODE attribute, if present.
   * @returns {{code: number, reason: string} | null}
   */
  get errorCode() {
    const attr = this.attributes.find(a => a.type === StunMessage.ATTR_ERROR_CODE);
    if (!attr || attr.value.length < 4) return null;
    const code = (attr.value[2] & 0x07) * 100 + attr.value[3];
    const reason = StunMessage._u8ToAscii(attr.value.slice(4));
    return { code, reason };
  }

  /**
   * Build a Binding Request with a fresh transaction ID.
   * @param {object} [opts]
   * @param {() => number} [opts.rng]
   * @returns {StunMessage}
   */
  static bindingRequest(opts = {}) {
    return new StunMessage({ type: StunMessage.TYPE_BINDING_REQUEST, rng: opts.rng });
  }

  /**
   * Build a Binding Success Response carrying XOR-MAPPED-ADDRESS for the
   * request's observed source — this is the whole job of a STUN server.
   * @param {Uint8Array} transactionId the request's transaction ID
   * @param {string} ip IPv4 address the request was seen coming from
   * @param {number} port port the request was seen coming from
   * @returns {StunMessage}
   */
  static bindingSuccess(transactionId, ip, port) {
    const msg = new StunMessage({ type: StunMessage.TYPE_BINDING_SUCCESS, transactionId });
    msg.setXorMappedAddress(ip, port);
    return msg;
  }

  /**
   * Build a Binding Error Response.
   * @param {Uint8Array} transactionId
   * @param {number} code 300..699
   * @param {string} reason
   * @returns {StunMessage}
   */
  static bindingError(transactionId, code, reason) {
    const msg = new StunMessage({ type: StunMessage.TYPE_BINDING_ERROR, transactionId });
    const reasonBytes = StunMessage._asciiToU8(reason);
    const value = new Uint8Array(4 + reasonBytes.length);
    value[2] = Math.floor(code / 100) & 0x07;
    value[3] = code % 100;
    value.set(reasonBytes, 4);
    msg.attributes.push({ type: StunMessage.ATTR_ERROR_CODE, value });
    return msg;
  }

  /** @param {string} ip @param {number} port */
  setXorMappedAddress(ip, port) {
    this.attributes = this.attributes.filter(a => a.type !== StunMessage.ATTR_XOR_MAPPED_ADDRESS);
    this.attributes.push({ type: StunMessage.ATTR_XOR_MAPPED_ADDRESS, value: this._packXorAddress(ip, port) });
  }

  /**
   * Parse a STUN message from bytes. Throws on anything that isn't a
   * well-formed STUN header (magic cookie + reserved type bits) so a caller
   * can distinguish STUN traffic from other UDP payloads on the same port.
   * @param {Uint8Array} bytes
   * @returns {StunMessage}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error("fromBytes expects Uint8Array");
    if (bytes.length < 20) throw new Error("STUN message needs at least 20 bytes");

    const type = read16BE(bytes, 0);
    const length = read16BE(bytes, 2);
    const cookie = read32BE(bytes, 4);
    if (cookie !== MAGIC_COOKIE) throw new Error("not a STUN message (bad magic cookie)");
    if ((type & 0xc000) !== 0) throw new Error("not a STUN message (reserved type bits set)");
    if (20 + length > bytes.length) throw new Error("STUN message truncated");

    const transactionId = bytes.slice(8, 20);

    /** @type {Array<{type: number, value: Uint8Array}>} */
    const attributes = [];
    let off = 20;
    const end = 20 + length;
    while (off + 4 <= end) {
      const attrType = read16BE(bytes, off);
      const attrLen = read16BE(bytes, off + 2);
      off += 4;
      if (off + attrLen > end) throw new Error("STUN attribute truncated");
      attributes.push({ type: attrType, value: bytes.slice(off, off + attrLen) });
      off += attrLen + StunMessage._padLen(attrLen);
    }

    return new StunMessage({ type, transactionId, attributes });
  }

  /** @returns {Uint8Array} */
  pack() {
    /** @type {Array<Uint8Array>} */
    const attrParts = [];
    for (const a of this.attributes) {
      const header = new Uint8Array(4);
      write16BE(header, 0, a.type & 0xffff);
      write16BE(header, 2, a.value.length & 0xffff);
      attrParts.push(header, a.value);
      const pad = StunMessage._padLen(a.value.length);
      if (pad) attrParts.push(new Uint8Array(pad));
    }
    const attrBytes = StunMessage._concat(attrParts);

    const out = new Uint8Array(20 + attrBytes.length);
    write16BE(out, 0, this.type & 0xffff);
    write16BE(out, 2, attrBytes.length & 0xffff);
    write32BE(out, 4, MAGIC_COOKIE);
    out.set(this.transactionId, 8);
    out.set(attrBytes, 20);
    return out;
  }

  // ── address attribute codec ──────────────────────────────────────

  /** @param {string} ip @param {number} port @returns {Uint8Array} */
  _packXorAddress(ip, port) {
    const raw = IPAddress.fromString(ip).toUInt8();
    if (raw.length !== 4) throw new Error("StunMessage: only IPv4 addresses are supported");

    const value = new Uint8Array(8);
    value[1] = 0x01; // family: IPv4
    write16BE(value, 2, (port & 0xffff) ^ (MAGIC_COOKIE >>> 16));
    for (let i = 0; i < 4; i++) value[4 + i] = raw[i] ^ ((MAGIC_COOKIE >>> (24 - 8 * i)) & 0xff);
    return value;
  }

  /** @param {Uint8Array} value @returns {{ip: string, port: number} | null} */
  static _unpackXorAddress(value) {
    if (value.length < 8 || value[1] !== 0x01) return null; // IPv6 (family 0x02) not supported
    const port = read16BE(value, 2) ^ (MAGIC_COOKIE >>> 16);
    const ipBytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) ipBytes[i] = value[4 + i] ^ ((MAGIC_COOKIE >>> (24 - 8 * i)) & 0xff);
    return { ip: IPAddress.fromUInt8(ipBytes).toString(), port: port & 0xffff };
  }

  /** @param {Uint8Array} value @returns {{ip: string, port: number} | null} */
  static _unpackPlainAddress(value) {
    if (value.length < 8 || value[1] !== 0x01) return null;
    return { ip: IPAddress.fromUInt8(value.slice(4, 8)).toString(), port: read16BE(value, 2) };
  }

  /** @param {() => number} rng @returns {Uint8Array} */
  static _randomTransactionId(rng) {
    const id = new Uint8Array(12);
    for (let i = 0; i < 12; i++) id[i] = Math.floor(rng() * 256) & 0xff;
    return id;
  }

  /** @param {number} len @returns {number} padding to the next 4-byte boundary */
  static _padLen(len) { return (4 - (len % 4)) % 4; }

  /** @param {string} s @returns {Uint8Array} */
  static _asciiToU8(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  /** @param {Uint8Array} u8 @returns {string} */
  static _u8ToAscii(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  /** @param {Array<Uint8Array>} parts @returns {Uint8Array} */
  static _concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }
}
