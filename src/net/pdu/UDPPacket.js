//@ts-check

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

    const srcPort = (bytes[0] << 8) | bytes[1];
    const dstPort = (bytes[2] << 8) | bytes[3];
    const length = (bytes[4] << 8) | bytes[5];
    const checksum = (bytes[6] << 8) | bytes[7];

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

    out[0] = (this.srcPort >> 8) & 0xff;
    out[1] = this.srcPort & 0xff;

    out[2] = (this.dstPort >> 8) & 0xff;
    out[3] = this.dstPort & 0xff;

    out[4] = (this.length >> 8) & 0xff;
    out[5] = this.length & 0xff;

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

    out[6] = (cs >> 8) & 0xff;
    out[7] = cs & 0xff;

    return out;
  }

  /**
   * Compute UDP checksum using IPv4 pseudo-header.
   *
   * Pseudo-header:
   *  src(4) + dst(4) + zero(1) + protocol(1=17) + udpLength(2)
   *
   * @param {Uint8Array} udpDatagram (with checksum bytes set to 0)
   * @param {Uint8Array} srcIp length 4
   * @param {Uint8Array} dstIp length 4
   * @returns {number}
   */
  static computeChecksumIPv4Pseudo(udpDatagram, srcIp, dstIp) {
    if (!(udpDatagram instanceof Uint8Array)) throw new Error("udpDatagram must be Uint8Array");
    if (!(srcIp instanceof Uint8Array) || srcIp.length !== 4) throw new Error("srcIp must be Uint8Array(4)");
    if (!(dstIp instanceof Uint8Array) || dstIp.length !== 4) throw new Error("dstIp must be Uint8Array(4)");

    const udpLen = udpDatagram.length;

    const pseudo = new Uint8Array(12);
    pseudo.set(srcIp, 0);
    pseudo.set(dstIp, 4);
    pseudo[8] = 0;
    pseudo[9] = 17; // UDP
    pseudo[10] = (udpLen >> 8) & 0xff;
    pseudo[11] = udpLen & 0xff;

    return UDPPacket._onesComplementChecksum([pseudo, udpDatagram]);
  }

  /**
   * Compute UDP checksum using IPv6 pseudo-header.
   * Pseudo-header: src(16) + dst(16) + udpLength(4) + zeros(3) + next-header=17(1)
   *
   * @param {Uint8Array} udpDatagram (with checksum bytes set to 0)
   * @param {Uint8Array} srcIp length 16
   * @param {Uint8Array} dstIp length 16
   * @returns {number}
   */
  static computeChecksumIPv6Pseudo(udpDatagram, srcIp, dstIp) {
    const len = udpDatagram.length;
    const pseudo = new Uint8Array(40);
    pseudo.set(srcIp, 0);
    pseudo.set(dstIp, 16);
    pseudo[32] = (len >>> 24) & 0xff;
    pseudo[33] = (len >>> 16) & 0xff;
    pseudo[34] = (len >>> 8)  & 0xff;
    pseudo[35] =  len         & 0xff;
    // pseudo[36..38] = 0
    pseudo[39] = 17; // UDP
    return UDPPacket._onesComplementChecksum([pseudo, udpDatagram]);
  }

  /**
   * One's complement checksum over multiple buffers (pads to even length).
   *
   * @param {Uint8Array[]} bufs
   * @returns {number}
   */
  static _onesComplementChecksum(bufs) {
    let sum = 0;

    for (const b of bufs) {
      if (!(b instanceof Uint8Array)) throw new Error("checksum buffers must be Uint8Array");

      let i = 0;
      for (; i + 1 < b.length; i += 2) {
        const word = (b[i] << 8) | b[i + 1];
        sum += word;
        sum = (sum & 0xffff) + (sum >>> 16);
      }
      if (i < b.length) {
        const word = (b[i] << 8);
        sum += word;
        sum = (sum & 0xffff) + (sum >>> 16);
      }
    }

    return (~sum) & 0xffff;
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
