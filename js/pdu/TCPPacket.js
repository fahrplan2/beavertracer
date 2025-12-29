//@ts-check

export class TCPPacket {

  srcPort;
  dstPort;
  seq;
  ack;
  dataOffset;
  flags;
  window;
  checksum;
  urgentPointer;
  options;

  /** @type {Uint8Array} */
  payload;

  /**
   * TCP segment (header + payload)
   *
   * Layout:
   *  0..1   src port
   *  2..3   dst port
   *  4..7   sequence
   *  8..11  acknowledgement
   *  12     dataOffset(4) + reserved(4)
   *  13     flags (8)  [CWR,ECE,URG,ACK,PSH,RST,SYN,FIN]
   *  14..15 window
   *  16..17 checksum
   *  18..19 urgent pointer
   *  20..   options (0..40, padded to 32-bit)
   *  ...    payload
   *
   * Note: Checksum for TCP requires the IPv4 pseudo-header. This class can
   * compute it if you provide srcIp/dstIp when packing (see pack()).
   *
   * @param {object} [opts]
   * @param {number} [opts.srcPort] 0..65535
   * @param {number} [opts.dstPort] 0..65535
   * @param {number} [opts.seq] 32-bit sequence (default 0)
   * @param {number} [opts.ack] 32-bit ack (default 0)
   * @param {number} [opts.dataOffset] header length in 32-bit words (default auto)
   * @param {number} [opts.flags] 8-bit flags (default 0)
   * @param {number} [opts.window] 16-bit window (default 65535)
   * @param {number} [opts.checksum] 16-bit checksum (default 0 => auto if pseudo-header provided)
   * @param {number} [opts.urgentPointer] 16-bit urgent ptr (default 0)
   * @param {Uint8Array} [opts.options] raw options bytes (0..40). Padding added in pack()
   * @param {Uint8Array} [opts.payload] payload bytes (default empty)
   */
  constructor(opts = {}) {
    this.srcPort = (opts.srcPort ?? 0) & 0xffff;
    this.dstPort = (opts.dstPort ?? 0) & 0xffff;

    this.seq = (opts.seq ?? 0) >>> 0;
    this.ack = (opts.ack ?? 0) >>> 0;

    this.dataOffset = (opts.dataOffset ?? 0) & 0x0f; // 0 => auto in pack

    this.flags = (opts.flags ?? 0) & 0xff;

    this.window = (opts.window ?? 65535) & 0xffff;

    this.checksum = (opts.checksum ?? 0) & 0xffff;

    this.urgentPointer = (opts.urgentPointer ?? 0) & 0xffff;

    this.options = opts.options ? opts.options : new Uint8Array(0);

    this.payload = opts.payload ? opts.payload : new Uint8Array(0);

    this._validate();
  }

  // --- Flag helpers (optional convenience) ---
  static FLAG_FIN = 0x01;
  static FLAG_SYN = 0x02;
  static FLAG_RST = 0x04;
  static FLAG_PSH = 0x08;
  static FLAG_ACK = 0x10;
  static FLAG_URG = 0x20;
  static FLAG_ECE = 0x40;
  static FLAG_CWR = 0x80;

  /**
   * Parse TCP segment from bytes (no pseudo-header validation here).
   *
   * @param {Uint8Array} bytes
   * @returns {TCPPacket}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("fromBytes expects Uint8Array");
    }
    if (bytes.length < 20) {
      throw new Error("TCP header needs at least 20 bytes");
    }

    const srcPort = (bytes[0] << 8) | bytes[1];
    const dstPort = (bytes[2] << 8) | bytes[3];

    const seq = (
      (bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]
    ) >>> 0;

    const ack = (
      (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11]
    ) >>> 0;

    const dataOffset = (bytes[12] >> 4) & 0x0f;
    const headerLen = dataOffset * 4;

    if (dataOffset < 5) throw new Error("Invalid TCP dataOffset (< 5)");
    if (bytes.length < headerLen) throw new Error("Not enough bytes for full TCP header");

    const flags = bytes[13];
    const window = (bytes[14] << 8) | bytes[15];
    const checksum = (bytes[16] << 8) | bytes[17];
    const urgentPointer = (bytes[18] << 8) | bytes[19];

    const options = headerLen > 20 ? bytes.slice(20, headerLen) : new Uint8Array(0);
    const payload = bytes.slice(headerLen);

    return new TCPPacket({
      srcPort,
      dstPort,
      seq,
      ack,
      dataOffset,
      flags,
      window,
      checksum,
      urgentPointer,
      options,
      payload
    });
  }

  /**
   * Pack TCP segment into bytes.
   *
   * If checksum == 0 and srcIp/dstIp are provided, checksum will be computed.
   * If checksum == 0 and srcIp/dstIp are NOT provided, checksum remains 0.
   *
   * @param {object} [opts]
   * @param {Uint8Array} [opts.srcIp] source IPv4 (length 4) for pseudo-header
   * @param {Uint8Array} [opts.dstIp] destination IPv4 (length 4) for pseudo-header
   * @returns {Uint8Array}
   */
  pack(opts = {}) {
    this._validate();

    const tcpOpts = this.options ?? new Uint8Array(0);
    if (!(tcpOpts instanceof Uint8Array)) throw new Error("options must be Uint8Array");
    if (tcpOpts.length > 40) throw new Error("options too long (max 40 bytes)");

    const pad = (tcpOpts.length % 4 === 0) ? 0 : (4 - (tcpOpts.length % 4));
    const headerLen = 20 + tcpOpts.length + pad;

    this.dataOffset = (headerLen / 4) & 0x0f;

    const seg = new Uint8Array(headerLen + this.payload.length);

    // ports
    seg[0] = (this.srcPort >> 8) & 0xff;
    seg[1] = this.srcPort & 0xff;
    seg[2] = (this.dstPort >> 8) & 0xff;
    seg[3] = this.dstPort & 0xff;

    // seq
    seg[4] = (this.seq >>> 24) & 0xff;
    seg[5] = (this.seq >>> 16) & 0xff;
    seg[6] = (this.seq >>> 8) & 0xff;
    seg[7] = this.seq & 0xff;

    // ack
    seg[8]  = (this.ack >>> 24) & 0xff;
    seg[9]  = (this.ack >>> 16) & 0xff;
    seg[10] = (this.ack >>> 8) & 0xff;
    seg[11] = this.ack & 0xff;

    // dataOffset + reserved(0)
    seg[12] = (this.dataOffset & 0x0f) << 4;

    // flags
    seg[13] = this.flags & 0xff;

    // window
    seg[14] = (this.window >> 8) & 0xff;
    seg[15] = this.window & 0xff;

    // checksum placeholder
    seg[16] = 0;
    seg[17] = 0;

    // urgent pointer
    seg[18] = (this.urgentPointer >> 8) & 0xff;
    seg[19] = this.urgentPointer & 0xff;

    // options + padding
    if (tcpOpts.length > 0) seg.set(tcpOpts, 20);
    // pad bytes remain 0

    // payload
    if (this.payload.length > 0) seg.set(this.payload, headerLen);

    // checksum
    let cs = this.checksum & 0xffff;
    if (cs === 0) {
      const srcIp = opts.srcIp;
      const dstIp = opts.dstIp;
      if (srcIp && dstIp) {
        cs = TCPPacket.computeChecksumIPv4Pseudo(seg, srcIp, dstIp);
      } // else keep 0
    }

    seg[16] = (cs >> 8) & 0xff;
    seg[17] = cs & 0xff;

    return seg;
  }

  /**
   * Compute TCP checksum using IPv4 pseudo-header.
   *
   * Pseudo-header:
   *  src(4) + dst(4) + zero(1) + protocol(1=6) + tcpLength(2)
   *
   * @param {Uint8Array} tcpSegment (with checksum bytes set to 0)
   * @param {Uint8Array} srcIp length 4
   * @param {Uint8Array} dstIp length 4
   * @returns {number}
   */
  static computeChecksumIPv4Pseudo(tcpSegment, srcIp, dstIp) {
    if (!(tcpSegment instanceof Uint8Array)) throw new Error("tcpSegment must be Uint8Array");
    if (!(srcIp instanceof Uint8Array) || srcIp.length !== 4) throw new Error("srcIp must be Uint8Array(4)");
    if (!(dstIp instanceof Uint8Array) || dstIp.length !== 4) throw new Error("dstIp must be Uint8Array(4)");

    const tcpLen = tcpSegment.length;

    const pseudo = new Uint8Array(12);
    pseudo.set(srcIp, 0);
    pseudo.set(dstIp, 4);
    pseudo[8] = 0;
    pseudo[9] = 6; // TCP
    pseudo[10] = (tcpLen >> 8) & 0xff;
    pseudo[11] = tcpLen & 0xff;

    return TCPPacket._onesComplementChecksum([pseudo, tcpSegment]);
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
    if (!Number.isInteger(this.seq) || this.seq < 0 || this.seq > 0xffffffff) {
      throw new Error("seq must be 0..2^32-1");
    }
    if (!Number.isInteger(this.ack) || this.ack < 0 || this.ack > 0xffffffff) {
      throw new Error("ack must be 0..2^32-1");
    }
    if (!Number.isInteger(this.dataOffset) || this.dataOffset < 0 || this.dataOffset > 15) {
      throw new Error("dataOffset must be 0..15");
    }
    if (!Number.isInteger(this.flags) || this.flags < 0 || this.flags > 255) {
      throw new Error("flags must be 0..255");
    }
    if (!Number.isInteger(this.window) || this.window < 0 || this.window > 65535) {
      throw new Error("window must be 0..65535");
    }
    if (!Number.isInteger(this.checksum) || this.checksum < 0 || this.checksum > 65535) {
      throw new Error("checksum must be 0..65535");
    }
    if (!Number.isInteger(this.urgentPointer) || this.urgentPointer < 0 || this.urgentPointer > 65535) {
      throw new Error("urgentPointer must be 0..65535");
    }
    if (!(this.options instanceof Uint8Array)) {
      throw new Error("options must be Uint8Array");
    }
    if (this.options.length > 40) {
      throw new Error("options too long (max 40 bytes)");
    }
    if (!(this.payload instanceof Uint8Array)) {
      throw new Error("payload must be Uint8Array");
    }
  }
}
