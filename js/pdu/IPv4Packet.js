//@ts-check

import { assertLenU8 } from "../helpers.js";

export class IPv4Packet {

  version;
  ihl;
  dscp;
  ecn;
  totalLength;
  identification;
  flags;
  fragmentOffset;
  ttl;
  protocol;
  headerChecksum;
  src;
  dst;
  options;

  /** @type {Uint8Array} */
  payload;

  /**
   * IPv4 packet (header + payload)
   *
   * @param {object} [opts]
   * @param {number} [opts.version] default 4
   * @param {number} [opts.ihl] header length in 32-bit words (default 5; auto-updated in pack())
   * @param {number} [opts.dscp] 6-bit DSCP (default 0)
   * @param {number} [opts.ecn] 2-bit ECN (default 0)
   * @param {number} [opts.totalLength] header+payload bytes (default auto from header+payload)
   * @param {number} [opts.identification] 16-bit ID (default 0)
   * @param {number} [opts.flags] 3-bit flags (default 0)
   * @param {number} [opts.fragmentOffset] 13-bit fragment offset (default 0)
   * @param {number} [opts.ttl] default 64
   * @param {number} [opts.protocol] 8-bit protocol number (default 0)
   * @param {number} [opts.headerChecksum] 16-bit checksum (default 0 => auto on pack)
   * @param {Uint8Array} [opts.src] source IPv4 (length 4)
   * @param {Uint8Array} [opts.dst] destination IPv4 (length 4)
   * @param {Uint8Array} [opts.options] raw options bytes (0..40). Padding is added in pack()
   * @param {Uint8Array} [opts.payload] payload bytes (default empty)
   */
  constructor(opts = {}) {
    this.version = (opts.version ?? 4) & 0x0f;
    this.ihl = (opts.ihl ?? 5) & 0x0f;

    this.dscp = (opts.dscp ?? 0) & 0x3f;
    this.ecn  = (opts.ecn  ?? 0) & 0x03;

    // May be overwritten in pack() to match header+payload.
    this.totalLength = (opts.totalLength ?? 0) & 0xffff;

    this.identification = (opts.identification ?? Math.floor(Math.random()*65535)) & 0xffff;

    this.flags = (opts.flags ?? 0) & 0x07;
    this.fragmentOffset = (opts.fragmentOffset ?? 0) & 0x1fff;

    this.ttl = (opts.ttl ?? 64) & 0xff;
    this.protocol = (opts.protocol ?? 0) & 0xff;

    this.headerChecksum = (opts.headerChecksum ?? 0) & 0xffff;

    this.src = opts.src ? assertLenU8(opts.src, 4, "src") : new Uint8Array(4);
    this.dst = opts.dst ? assertLenU8(opts.dst, 4, "dst") : new Uint8Array(4);

    this.options = opts.options ? assertLenU8(opts.options, opts.options.length, "options") : new Uint8Array(0);

    this.payload = opts.payload ? opts.payload : new Uint8Array(0);

    this._validate();
  }

  /**
   * Parse full IPv4 packet from bytes (header + payload).
   *
   * @param {Uint8Array} bytes
   * @returns {IPv4Packet}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("fromBytes expects Uint8Array");
    }
    if (bytes.length < 20) {
      throw new Error("IPv4 packet needs at least 20 bytes");
    }

    const vihl = bytes[0];
    const version = (vihl >> 4) & 0x0f;
    const ihl = vihl & 0x0f;
    const headerLen = ihl * 4;

    if (version !== 4) throw new Error("Not an IPv4 packet (version != 4)");
    if (ihl < 5) throw new Error("Invalid IHL (< 5)");
    if (bytes.length < headerLen) throw new Error("Not enough bytes for full IPv4 header");

    const tos = bytes[1];
    const dscp = (tos >> 2) & 0x3f;
    const ecn  = tos & 0x03;

    const totalLength = (bytes[2] << 8) | bytes[3];
    if (totalLength < headerLen) {
      throw new Error("Invalid totalLength (< header length)");
    }
    if (bytes.length < totalLength) {
      throw new Error("IPv4 packet truncated (payload incomplete)");
    }

    const identification = (bytes[4] << 8) | bytes[5];

    const flagsFrag = (bytes[6] << 8) | bytes[7];
    const flags = (flagsFrag >> 13) & 0x07;
    const fragmentOffset = flagsFrag & 0x1fff;

    const ttl = bytes[8];
    const protocol = bytes[9];
    const headerChecksum = (bytes[10] << 8) | bytes[11];

    const src = bytes.slice(12, 16);
    const dst = bytes.slice(16, 20);

    const options = headerLen > 20 ? bytes.slice(20, headerLen) : new Uint8Array(0);

    const payload = bytes.slice(headerLen, totalLength);

    return new IPv4Packet({
      version,
      ihl,
      dscp,
      ecn,
      totalLength,
      identification,
      flags,
      fragmentOffset,
      ttl,
      protocol,
      headerChecksum,
      src,
      dst,
      options,
      payload
    });
  }

  /**
   * Pack packet into bytes (header + options + padding + payload).
   * If headerChecksum == 0, it will be computed automatically.
   *
   * @returns {Uint8Array}
   */
  pack() {
    this._validate();

    const opts = this.options ?? new Uint8Array(0);
    if (!(opts instanceof Uint8Array)) throw new Error("options must be Uint8Array");
    if (opts.length > 40) throw new Error("options too long (max 40 bytes)");

    const pad = (opts.length % 4 === 0) ? 0 : (4 - (opts.length % 4));
    const headerLen = 20 + opts.length + pad;

    this.ihl = (headerLen / 4) & 0x0f;

    if (!(this.payload instanceof Uint8Array)) {
      throw new Error("payload must be Uint8Array");
    }

    this.totalLength = (headerLen + this.payload.length) & 0xffff;

    const header = new Uint8Array(headerLen);

    header[0] = ((this.version & 0x0f) << 4) | (this.ihl & 0x0f);
    header[1] = ((this.dscp & 0x3f) << 2) | (this.ecn & 0x03);

    header[2] = (this.totalLength >> 8) & 0xff;
    header[3] = this.totalLength & 0xff;

    header[4] = (this.identification >> 8) & 0xff;
    header[5] = this.identification & 0xff;

    const flagsFrag = ((this.flags & 0x07) << 13) | (this.fragmentOffset & 0x1fff);
    header[6] = (flagsFrag >> 8) & 0xff;
    header[7] = flagsFrag & 0xff;

    header[8] = this.ttl & 0xff;
    header[9] = this.protocol & 0xff;

    // checksum placeholder
    header[10] = 0;
    header[11] = 0;

    header.set(this.src, 12);
    header.set(this.dst, 16);

    if (opts.length > 0) header.set(opts, 20);
    // padding bytes remain 0

    const checksum = (this.headerChecksum === 0)
      ? IPv4Packet.computeHeaderChecksum(header)
      : (this.headerChecksum & 0xffff);

    header[10] = (checksum >> 8) & 0xff;
    header[11] = checksum & 0xff;

    const packet = new Uint8Array(header.length + this.payload.length);
    packet.set(header, 0);
    packet.set(this.payload, header.length);

    return packet;
  }

  /**
   * Compute IPv4 header checksum. Assumes bytes[10..11] are zero.
   *
   * @param {Uint8Array} headerBytes
   * @returns {number}
   */
  static computeHeaderChecksum(headerBytes) {
    if (!(headerBytes instanceof Uint8Array)) {
      throw new Error("computeHeaderChecksum expects Uint8Array");
    }
    if (headerBytes.length < 20 || (headerBytes.length % 4) !== 0) {
      throw new Error("headerBytes must be >= 20 and multiple of 4");
    }

    let sum = 0;
    for (let i = 0; i < headerBytes.length; i += 2) {
      const word = (headerBytes[i] << 8) | headerBytes[i + 1];
      sum += word;
      sum = (sum & 0xffff) + (sum >>> 16);
    }
    return (~sum) & 0xffff;
  }

  _validate() {
    if (this.version !== 4) throw new Error("version must be 4");
    if (!Number.isInteger(this.ihl) || this.ihl < 5 || this.ihl > 15) {
      throw new Error("ihl must be 5..15");
    }
    if (!Number.isInteger(this.dscp) || this.dscp < 0 || this.dscp > 63) {
      throw new Error("dscp must be 0..63");
    }
    if (!Number.isInteger(this.ecn) || this.ecn < 0 || this.ecn > 3) {
      throw new Error("ecn must be 0..3");
    }
    if (!Number.isInteger(this.identification) || this.identification < 0 || this.identification > 65535) {
      throw new Error("identification must be 0..65535");
    }
    if (!Number.isInteger(this.flags) || this.flags < 0 || this.flags > 7) {
      throw new Error("flags must be 0..7");
    }
    if (!Number.isInteger(this.fragmentOffset) || this.fragmentOffset < 0 || this.fragmentOffset > 0x1fff) {
      throw new Error("fragmentOffset must be 0..8191");
    }
    if (!Number.isInteger(this.ttl) || this.ttl < 0 || this.ttl > 255) {
      throw new Error("ttl must be 0..255");
    }
    if (!Number.isInteger(this.protocol) || this.protocol < 0 || this.protocol > 255) {
      throw new Error("protocol must be 0..255");
    }
    if (!Number.isInteger(this.headerChecksum) || this.headerChecksum < 0 || this.headerChecksum > 65535) {
      throw new Error("headerChecksum must be 0..65535");
    }

    assertLenU8(this.src, 4, "src");
    assertLenU8(this.dst, 4, "dst");

    if (!(this.options instanceof Uint8Array)) throw new Error("options must be Uint8Array");
    if (this.options.length > 40) throw new Error("options too long (max 40 bytes)");

    if (!(this.payload instanceof Uint8Array)) throw new Error("payload must be Uint8Array");

    // totalLength is auto-fixed in pack(), but if user sets it, keep it sane.
    const headerLen = this.ihl * 4;
    if (this.totalLength !== 0 && this.totalLength < headerLen) {
      throw new Error("totalLength must be >= header length");
    }
  }
}
