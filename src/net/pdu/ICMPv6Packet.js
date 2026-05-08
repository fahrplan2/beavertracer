//@ts-check

import { IPAddress } from "../models/IPAddress.js";
import { computeIPv6PseudoChecksum } from "../util/checksumUtils.js";
import { read16BE, read32BE, write16BE, write32BE } from "../util/byteUtils.js";

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
      checksum: read16BE(bytes, 2),
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

    write16BE(out, 2, cs);
    return out;
  }

  /**
   * ICMPv6 checksum over IPv6 pseudo-header + ICMPv6 message.
   *
   * @param {Uint8Array} icmpv6Bytes  (with checksum field = 0)
   * @param {IPAddress} srcIp
   * @param {IPAddress} dstIp
   * @returns {number}
   */
  static computeChecksum(icmpv6Bytes, srcIp, dstIp) {
    return computeIPv6PseudoChecksum(icmpv6Bytes, srcIp.toUInt8(), dstIp.toUInt8(), 58);
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
    write16BE(body, 0, id);
    write16BE(body, 2, seq);
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
    write16BE(body, 0, id);
    write16BE(body, 2, seq);
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
    return read32BE(this.body, 0);
  }
  /** Solicited flag (NA) */
  get ndpSolicited() { return (this.ndpFlags & 0x40000000) !== 0; }

  /**
   * Build Neighbor Solicitation (type 135).
   * body: reserved(4) + target(16) [+ SLLA option(8) if srcMac given]
   * Pass srcMac=null for DAD probes (RFC 4861 §4.3: no SLLA when src is ::).
   * @param {IPAddress} target
   * @param {Uint8Array|null} [srcMac]
   * @returns {ICMPv6Packet}
   */
  static buildNS(target, srcMac = null) {
    const body = new Uint8Array(srcMac ? 28 : 20);
    // bytes 0-3: reserved (0)
    body.set(target.toUInt8(), 4);  // bytes 4-19: target
    if (srcMac) {
      body[20] = 1; body[21] = 1;   // SLLA option: type=1, length=1
      body.set(srcMac.subarray(0, 6), 22);
    }
    return new ICMPv6Packet({ type: 135, code: 0, body });
  }

  // ── Router Solicitation / Advertisement (types 133 / 134) ────────────────────

  /**
   * Build Router Solicitation (type 133).
   * Pass srcMac=null when sending from :: (before link-local is ready).
   * body: reserved(4) [+ SLLA option(8) if srcMac given]
   * @param {Uint8Array|null} [srcMac]
   * @returns {ICMPv6Packet}
   */
  static buildRS(srcMac = null) {
    const body = new Uint8Array(srcMac ? 12 : 4);
    if (srcMac) {
      body[4] = 1; body[5] = 1; // SLLA option: type=1, length=1
      body.set(srcMac.subarray(0, 6), 6);
    }
    return new ICMPv6Packet({ type: 133, code: 0, body });
  }

  /**
   * Build Router Advertisement (type 134) with optional Prefix Information Option.
   * @param {Object} [opts]
   * @param {number}    [opts.hopLimit=64]
   * @param {boolean}   [opts.managedFlag=false]      M-flag (stateful DHCPv6)
   * @param {boolean}   [opts.otherFlag=false]         O-flag (stateless DHCPv6)
   * @param {number}    [opts.routerLifetime=1800]     seconds; 0 = not a default router
   * @param {IPAddress} [opts.prefix]                  network prefix to advertise
   * @param {number}    [opts.prefixLength=64]
   * @param {number}    [opts.validLifetime=2592000]   seconds (30 days)
   * @param {number}    [opts.preferredLifetime=604800] seconds (7 days)
   * @returns {ICMPv6Packet}
   */
  static buildRA(opts = {}) {
    const hopLimit       = (opts.hopLimit      ?? 64)    & 0xff;
    const moFlags        = (opts.managedFlag ? 0x80 : 0) | (opts.otherFlag ? 0x40 : 0);
    const routerLifetime = (opts.routerLifetime ?? 1800) & 0xffff;
    const hasPrefix      = opts.prefix != null;
    const body = new Uint8Array(12 + (hasPrefix ? 32 : 0));

    body[0] = hopLimit;
    body[1] = moFlags;
    write16BE(body, 2, routerLifetime);
    // bytes 4-11: Reachable Time + Retrans Timer (0 = unspecified)

    if (hasPrefix) {
      const prefixLength      = (opts.prefixLength      ?? 64)      & 0xff;
      const validLifetime     = (opts.validLifetime     ?? 2592000) >>> 0;
      const preferredLifetime = (opts.preferredLifetime ?? 604800)  >>> 0;
      const prefixBytes       = /** @type {IPAddress} */ (opts.prefix).toUInt8();
      body[12] = 3;    // Prefix Information Option type
      body[13] = 4;    // length in units of 8 bytes = 32 bytes total
      body[14] = prefixLength;
      body[15] = 0xc0; // L=1, A=1: on-link + autonomous address configuration
      write32BE(body, 16, validLifetime);
      write32BE(body, 20, preferredLifetime);
      // bytes 24-27: Reserved2 (0)
      body.set(prefixBytes, 28); // prefix (16 bytes, host bits are ignored by receiver)
    }

    return new ICMPv6Packet({ type: 134, code: 0, body });
  }

  /**
   * Parse all Prefix Information Options (type 3) from an RA body (RFC 4861 §4.6.2).
   * @returns {Array<{prefixLength:number, onLink:boolean, autonomous:boolean, validLifetime:number, preferredLifetime:number, prefix:IPAddress}>}
   */
  getPrefixInfoOptions() {
    const result = [];
    let i = 12; // skip 12-byte RA header (hopLimit, flags, lifetime, reachTime, retransTimer)
    while (i + 2 <= this.body.length) {
      const optType = this.body[i];
      const optLen  = this.body[i + 1] * 8;
      if (optLen === 0) break;
      if (optType === 3 && optLen === 32 && i + 32 <= this.body.length) {
        result.push({
          prefixLength:      this.body[i + 2],
          onLink:            (this.body[i + 3] & 0x80) !== 0,
          autonomous:        (this.body[i + 3] & 0x40) !== 0,
          validLifetime:     read32BE(this.body, i + 4),
          preferredLifetime: read32BE(this.body, i + 8),
          prefix: IPAddress.fromUInt8(this.body.slice(i + 16, i + 32)),
        });
      }
      i += optLen;
    }
    return result;
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
    write32BE(body, 0, flags);
    body.set(target.toUInt8(), 4);  // bytes 4-19: target
    body[20] = 2; body[21] = 1;     // TLLA option: type=2, length=1
    body.set(targetMac.subarray(0, 6), 22);
    return new ICMPv6Packet({ type: 136, code: 0, body });
  }
}
