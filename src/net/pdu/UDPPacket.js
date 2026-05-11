//@ts-check

import { computeIPv4PseudoChecksum, computeIPv6PseudoChecksum } from "../util/checksumUtils.js";
import { read16BE, write16BE } from "../util/byteUtils.js";

export class UDPPacket {

  srcPort;
  dstPort;
  length;
  checksum;

  /** @type {Uint8Array} */
  payload;

  /**
   * UDP datagram (header + payload)
   *
   * Layout:
   *  0..1  src port
   *  2..3  dst port
   *  4..5  length (header+payload)
   *  6..7  checksum
   *  8..   payload
   *
   * Note: UDP checksum also uses the IPv4 pseudo-header. In IPv4 the checksum
   * may be 0 (meaning "not used"). This class can compute it if you provide
   * srcIp/dstIp when packing.
   *
   * @param {object} [opts]
   * @param {number} [opts.srcPort] 0..65535
   * @param {number} [opts.dstPort] 0..65535
   * @param {number} [opts.length] 16-bit length (default auto from payload)
   * @param {number} [opts.checksum] 16-bit checksum (default 0 => auto if pseudo-header provided, or "unused" if not)
   * @param {Uint8Array} [opts.payload] payload bytes (default empty)
   */
  constructor(opts = {}) {
    this.srcPort = (opts.srcPort ?? 0) & 0xffff;
    this.dstPort = (opts.dstPort ?? 0) & 0xffff;

    // May be overwritten in pack()
    this.length = (opts.length ?? 0) & 0xffff;

    this.checksum = (opts.checksum ?? 0) & 0xffff;

    this.payload = opts.payload ? opts.payload : new Uint8Array(0);

    this._validate();
  }

  /**
   * Parse UDP datagram from bytes.
   *
   * @param {Uint8Array} bytes
   * @returns {UDPPacket}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("fromBytes expects Uint8Array");
    }
    if (bytes.length < 8) {
      throw new Error("UDP header needs at least 8 bytes");
    }

    const srcPort = read16BE(bytes, 0);
    const dstPort = read16BE(bytes, 2);
    const length  = read16BE(bytes, 4);
    const checksum = read16BE(bytes, 6);

    if (length < 8) {
      throw new Error("Invalid UDP length (< 8)");
    }
    if (bytes.length < length) {
      throw new Error("UDP datagram truncated (payload incomplete)");
    }

    const payload = bytes.slice(8, length);

    return new UDPPacket({ srcPort, dstPort, length, checksum, payload });
  }

  /**
   * Pack UDP datagram into bytes.
   *
   * If checksum == 0 and srcIp/dstIp are provided, checksum will be computed (IPv4 only for now).
   * If checksum == 0 and srcIp/dstIp are NOT provided, checksum remains 0 (IPv4: allowed).
   *
   * @param {object} [opts]
   * @param {import("../models/IPAddress.js").IPAddress | Uint8Array} [opts.srcIp] for pseudo-header
   * @param {import("../models/IPAddress.js").IPAddress | Uint8Array} [opts.dstIp] for pseudo-header
   * @returns {Uint8Array}
   */
  pack(opts = {}) {
    this._validate();

    this.length = (8 + this.payload.length) & 0xffff;

    const out = new Uint8Array(this.length);

    write16BE(out, 0, this.srcPort);
    write16BE(out, 2, this.dstPort);
    write16BE(out, 4, this.length);

    // checksum placeholder
    out[6] = 0;
    out[7] = 0;

    if (this.payload.length > 0) out.set(this.payload, 8);

    let cs = this.checksum & 0xffff;
    if (cs === 0) {
      const rawSrc = opts.srcIp;
      const rawDst = opts.dstIp;
      if (rawSrc && rawDst) {
        const srcBytes = (rawSrc instanceof Uint8Array) ? rawSrc : rawSrc.toUInt8();
        const dstBytes = (rawDst instanceof Uint8Array) ? rawDst : rawDst.toUInt8();
        if (srcBytes.length === 4 && dstBytes.length === 4) {
          cs = UDPPacket.computeChecksumIPv4Pseudo(out, srcBytes, dstBytes);
          // RFC: In IPv4, checksum 0 means "not used" — send as 0xFFFF instead.
          if (cs === 0) cs = 0xffff;
        } else if (srcBytes.length === 16 && dstBytes.length === 16) {
          cs = UDPPacket.computeChecksumIPv6Pseudo(out, srcBytes, dstBytes);
          // RFC 2460: UDP checksum is mandatory in IPv6 — never send 0.
          if (cs === 0) cs = 0xffff;
        }
      }
    }

    write16BE(out, 6, cs);

    return out;
  }

  /**
   * @param {Uint8Array} udpDatagram (with checksum bytes set to 0)
   * @param {Uint8Array} srcIp length 4
   * @param {Uint8Array} dstIp length 4
   * @returns {number}
   */
  static computeChecksumIPv4Pseudo(udpDatagram, srcIp, dstIp) {
    return computeIPv4PseudoChecksum(udpDatagram, srcIp, dstIp, 17);
  }

  /**
   * @param {Uint8Array} udpDatagram (with checksum bytes set to 0)
   * @param {Uint8Array} srcIp length 16
   * @param {Uint8Array} dstIp length 16
   * @returns {number}
   */
  static computeChecksumIPv6Pseudo(udpDatagram, srcIp, dstIp) {
    return computeIPv6PseudoChecksum(udpDatagram, srcIp, dstIp, 17);
  }

  _validate() {
    if (!Number.isInteger(this.srcPort) || this.srcPort < 0 || this.srcPort > 65535) {
      throw new Error("srcPort must be 0..65535");
    }
    if (!Number.isInteger(this.dstPort) || this.dstPort < 0 || this.dstPort > 65535) {
      throw new Error("dstPort must be 0..65535");
    }
    if (!Number.isInteger(this.length) || this.length < 0 || this.length > 65535) {
      throw new Error("length must be 0..65535");
    }
    if (!Number.isInteger(this.checksum) || this.checksum < 0 || this.checksum > 65535) {
      throw new Error("checksum must be 0..65535");
    }
    if (!(this.payload instanceof Uint8Array)) {
      throw new Error("payload must be Uint8Array");
    }
    if (this.payload.length > (65535 - 8)) {
      throw new Error("payload too large for UDP");
    }
  }
}
