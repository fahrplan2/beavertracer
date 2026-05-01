//@ts-check

import { IPAddress } from "../models/IPAddress.js";

export class ICMPv6Packet {

  /** @type {number} */ type;
  /** @type {number} */ code;
  /** @type {number} */ checksum;
  /** @type {Uint8Array} */ body; // everything after the 4-byte common header

  /**
   * @param {object} [opts]
   * @param {number} [opts.type] ICMPv6 type (default 128 = Echo Request)
   * @param {number} [opts.code] code (default 0)
   * @param {number} [opts.checksum] 16-bit, 0 = auto on pack()
   * @param {Uint8Array} [opts.body] type-specific bytes after the header
   */
  constructor(opts = {}) {
    this.type     = (opts.type     ?? 128) & 0xff;
    this.code     = (opts.code     ?? 0)   & 0xff;
    this.checksum = (opts.checksum ?? 0)   & 0xffff;
    this.body     = (opts.body instanceof Uint8Array) ? opts.body : new Uint8Array(4);
  }

  /**
   * @param {Uint8Array} bytes
   * @returns {ICMPv6Packet}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
      throw new Error("ICMPv6 needs at least 4 bytes");
    }
    return new ICMPv6Packet({
      type:     bytes[0],
      code:     bytes[1],
      checksum: (bytes[2] << 8) | bytes[3],
      body:     bytes.slice(4),
    });
  }

  /**
   * Pack into bytes. Checksum is computed via IPv6 pseudo-header.
   * @param {IPAddress} srcIp
   * @param {IPAddress} dstIp
   * @returns {Uint8Array}
   */
  pack(srcIp, dstIp) {
    const out = new Uint8Array(4 + this.body.length);
    out[0] = this.type & 0xff;
    out[1] = this.code & 0xff;
    out[2] = 0; out[3] = 0; // checksum placeholder

    if (this.body.length > 0) out.set(this.body, 4);

    const cs = (this.checksum === 0 && srcIp && dstIp)
      ? ICMPv6Packet.computeChecksum(out, srcIp, dstIp)
      : (this.checksum & 0xffff);

    out[2] = (cs >> 8) & 0xff;
    out[3] = cs & 0xff;
    return out;
  }

  /**
   * ICMPv6 checksum over IPv6 pseudo-header + ICMPv6 message.
   * Pseudo-header: src(16) + dst(16) + ICMPv6-length(4) + zeros(3) + next-header=58(1)
   *
   * @param {Uint8Array} icmpv6Bytes  (with checksum field = 0)
   * @param {IPAddress} srcIp
   * @param {IPAddress} dstIp
   * @returns {number}
   */
  static computeChecksum(icmpv6Bytes, srcIp, dstIp) {
    const src = srcIp.toUInt8();
    const dst = dstIp.toUInt8();
    const len = icmpv6Bytes.length;

    const pseudo = new Uint8Array(40);
    pseudo.set(src, 0);   // 16 bytes src
    pseudo.set(dst, 16);  // 16 bytes dst
    pseudo[32] = (len >>> 24) & 0xff;
    pseudo[33] = (len >>> 16) & 0xff;
    pseudo[34] = (len >>> 8)  & 0xff;
    pseudo[35] =  len         & 0xff;
    // pseudo[36..38] = 0
    pseudo[39] = 58; // next header = ICMPv6

    return ICMPv6Packet._onesComplement([pseudo, icmpv6Bytes]);
  }

  /**
   * @param {Uint8Array[]} bufs
   * @returns {number}
   */
  static _onesComplement(bufs) {
    let sum = 0;
    for (const b of bufs) {
      let i = 0;
      for (; i + 1 < b.length; i += 2) {
        sum += (b[i] << 8) | b[i + 1];
        sum = (sum & 0xffff) + (sum >>> 16);
      }
      if (i < b.length) {
        sum += b[i] << 8;
        sum = (sum & 0xffff) + (sum >>> 16);
      }
    }
    return (~sum) & 0xffff;
  }

  // ── Echo (types 128 / 129) ────────────────────────────────────────────────

  /** @returns {number} */ get identifier() { return this.body.length >= 2 ? (this.body[0] << 8) | this.body[1] : 0; }
  /** @returns {number} */ get sequence()   { return this.body.length >= 4 ? (this.body[2] << 8) | this.body[3] : 0; }
  /** @returns {Uint8Array} */ get echoPayload() { return this.body.slice(4); }

  /**
   * @param {number} id
   * @param {number} seq
   * @param {Uint8Array} [payload]
   * @returns {ICMPv6Packet}
   */
  static buildEchoRequest(id, seq, payload = new Uint8Array(32)) {
    const body = new Uint8Array(4 + payload.length);
    body[0] = (id  >> 8) & 0xff;  body[1] = id  & 0xff;
    body[2] = (seq >> 8) & 0xff;  body[3] = seq & 0xff;
    if (payload.length > 0) body.set(payload, 4);
    return new ICMPv6Packet({ type: 128, code: 0, body });
  }

  /**
   * @param {number} id
   * @param {number} seq
   * @param {Uint8Array} [payload]
   * @returns {ICMPv6Packet}
   */
  static buildEchoReply(id, seq, payload = new Uint8Array(0)) {
    const body = new Uint8Array(4 + payload.length);
    body[0] = (id  >> 8) & 0xff;  body[1] = id  & 0xff;
    body[2] = (seq >> 8) & 0xff;  body[3] = seq & 0xff;
    if (payload.length > 0) body.set(payload, 4);
    return new ICMPv6Packet({ type: 129, code: 0, body });
  }

  // ── NDP (types 135 / 136) ─────────────────────────────────────────────────

  /**
   * Target address for NS/NA (bytes 4-19 of body).
   * @returns {IPAddress|null}
   */
  get ndpTarget() {
    if (this.body.length < 20) return null;
    return IPAddress.fromUInt8(this.body.slice(4, 20));
  }

  /**
   * Parse first ICMPv6 option of type 1 (SLLA) or 2 (TLLA).
   * Options start at body[20] (after 4-byte flags/reserved + 16-byte target).
   * @returns {Uint8Array|null} 6-byte MAC or null
   */
  getLinkLayerAddress() {
    let i = 20;
    while (i + 2 <= this.body.length) {
      const optType = this.body[i];
      const optLen  = this.body[i + 1] * 8; // length field is in units of 8 bytes
      if (optLen === 0) break;
      if ((optType === 1 || optType === 2) && i + 8 <= this.body.length) {
        return this.body.slice(i + 2, i + 8);
      }
      i += optLen;
    }
    return null;
  }

  /** R/S/O flags word (NA, byte 0-3 of body). S=bit30, O=bit29 */
  get ndpFlags() {
    return ((this.body[0] << 24) | (this.body[1] << 16) | (this.body[2] << 8) | this.body[3]) >>> 0;
  }
  /** Solicited flag (NA) */
  get ndpSolicited() { return (this.ndpFlags & 0x40000000) !== 0; }

  /**
   * Build Neighbor Solicitation (type 135).
   * body: reserved(4) + target(16) + SLLA option(8)
   * @param {IPAddress} target
   * @param {Uint8Array} srcMac
   * @returns {ICMPv6Packet}
   */
  static buildNS(target, srcMac) {
    const body = new Uint8Array(28);
    // bytes 0-3: reserved (0)
    body.set(target.toUInt8(), 4);  // bytes 4-19: target
    body[20] = 1; body[21] = 1;     // SLLA option: type=1, length=1
    body.set(srcMac.subarray(0, 6), 22);
    return new ICMPv6Packet({ type: 135, code: 0, body });
  }

  /**
   * Build Neighbor Advertisement (type 136).
   * body: flags(4) + target(16) + TLLA option(8)
   * @param {IPAddress} target
   * @param {Uint8Array} targetMac
   * @param {boolean} [solicited]
   * @returns {ICMPv6Packet}
   */
  static buildNA(target, targetMac, solicited = true) {
    const body = new Uint8Array(28);
    const flags = (solicited ? 0x40000000 : 0) | 0x20000000; // S | O
    body[0] = (flags >>> 24) & 0xff;
    body[1] = (flags >>> 16) & 0xff;
    body[2] = (flags >>> 8)  & 0xff;
    body[3] =  flags         & 0xff;
    body.set(target.toUInt8(), 4);  // bytes 4-19: target
    body[20] = 2; body[21] = 1;     // TLLA option: type=2, length=1
    body.set(targetMac.subarray(0, 6), 22);
    return new ICMPv6Packet({ type: 136, code: 0, body });
  }
}
