//@ts-check

import { assertLenU8 } from "../../lib/helpers.js";

export class IPv6Packet {

  version;
  trafficClass;
  flowLabel;

  payloadLength;
  nextHeader;
  hopLimit;

  src;
  dst;

  /** @type {Uint8Array} */
  payload;

  /**
   * IPv6 packet (fixed 40-byte header + payload)
   *
   * Layout:
   *  0..3   version(4), trafficClass(8), flowLabel(20)
   *  4..5   payloadLength
   *  6      nextHeader
   *  7      hopLimit
   *  8..23  src IPv6
   *  24..39 dst IPv6
   *  40..   payload
   *
   * Note: This is the base IPv6 header only (no extension headers).
   *
   * @param {object} [opts]
   * @param {number} [opts.version] default 6
   * @param {number} [opts.trafficClass] 8-bit traffic class (default 0)
   * @param {number} [opts.flowLabel] 20-bit flow label (default 0)
   * @param {number} [opts.payloadLength] 16-bit payload length (default auto from payload)
   * @param {number} [opts.nextHeader] 8-bit next header (default 59 = No Next Header)
   * @param {number} [opts.hopLimit] 8-bit hop limit (default 64)
   * @param {Uint8Array} [opts.src] source IPv6 (length 16)
   * @param {Uint8Array} [opts.dst] destination IPv6 (length 16)
   * @param {Uint8Array} [opts.payload] payload bytes (default empty)
   */
  constructor(opts = {}) {
    this.version = (opts.version ?? 6) & 0x0f;

    this.trafficClass = (opts.trafficClass ?? 0) & 0xff;
    this.flowLabel = (opts.flowLabel ?? 0) & 0xfffff; // 20 bit

    // May be overwritten in pack()
    this.payloadLength = (opts.payloadLength ?? 0) & 0xffff;

    this.nextHeader = (opts.nextHeader ?? 59) & 0xff; // 59 = No Next Header
    this.hopLimit = (opts.hopLimit ?? 64) & 0xff;

    this.src = opts.src ? assertLenU8(opts.src, 16, "src") : new Uint8Array(16);
    this.dst = opts.dst ? assertLenU8(opts.dst, 16, "dst") : new Uint8Array(16);

    this.payload = opts.payload ? opts.payload : new Uint8Array(0);

    this._validate();
  }

  /**
   * Parse IPv6 packet from bytes (base header + payload).
   * Does NOT parse extension headers (they remain inside payload).
   *
   * @param {Uint8Array} bytes
   * @returns {IPv6Packet}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("fromBytes expects Uint8Array");
    }
    if (bytes.length < 40) {
      throw new Error("IPv6 packet needs at least 40 bytes");
    }

    const b0 = bytes[0];
    const version = (b0 >> 4) & 0x0f;

    if (version !== 6) throw new Error("Not an IPv6 packet (version != 6)");

    const trafficClass = ((bytes[0] & 0x0f) << 4) | ((bytes[1] >> 4) & 0x0f);
    const flowLabel = ((bytes[1] & 0x0f) << 16) | (bytes[2] << 8) | bytes[3];

    const payloadLength = (bytes[4] << 8) | bytes[5];
    const nextHeader = bytes[6];
    const hopLimit = bytes[7];

    const src = bytes.slice(8, 24);
    const dst = bytes.slice(24, 40);

    const totalLen = 40 + payloadLength;
    if (bytes.length < totalLen) {
      throw new Error("IPv6 packet truncated (payload incomplete)");
    }

    const payload = bytes.slice(40, totalLen);

    return new IPv6Packet({
      version,
      trafficClass,
      flowLabel,
      payloadLength,
      nextHeader,
      hopLimit,
      src,
      dst,
      payload
    });
  }

  /**
   * Pack IPv6 packet into bytes (40-byte header + payload).
   *
   * @returns {Uint8Array}
   */
  pack() {
    this._validate();

    if (!(this.payload instanceof Uint8Array)) {
      throw new Error("payload must be Uint8Array");
    }
    if (this.payload.length > 0xffff) {
      throw new Error("payload too large for IPv6 base header (max 65535, jumbograms not supported)");
    }

    this.payloadLength = this.payload.length & 0xffff;

    const out = new Uint8Array(40 + this.payload.length);

    // version(4), trafficClass(8), flowLabel(20)
    out[0] = ((this.version & 0x0f) << 4) | ((this.trafficClass >> 4) & 0x0f);
    out[1] = ((this.trafficClass & 0x0f) << 4) | ((this.flowLabel >> 16) & 0x0f);
    out[2] = (this.flowLabel >> 8) & 0xff;
    out[3] = this.flowLabel & 0xff;

    // payload length
    out[4] = (this.payloadLength >> 8) & 0xff;
    out[5] = this.payloadLength & 0xff;

    // next header + hop limit
    out[6] = this.nextHeader & 0xff;
    out[7] = this.hopLimit & 0xff;

    // src/dst
    out.set(this.src, 8);
    out.set(this.dst, 24);

    // payload
    if (this.payload.length > 0) out.set(this.payload, 40);

    return out;
  }

  _validate() {
    if (this.version !== 6) throw new Error("version must be 6");
    if (!Number.isInteger(this.trafficClass) || this.trafficClass < 0 || this.trafficClass > 255) {
      throw new Error("trafficClass must be 0..255");
    }
    if (!Number.isInteger(this.flowLabel) || this.flowLabel < 0 || this.flowLabel > 0xfffff) {
      throw new Error("flowLabel must be 0..1048575 (20-bit)");
    }
    if (!Number.isInteger(this.payloadLength) || this.payloadLength < 0 || this.payloadLength > 65535) {
      throw new Error("payloadLength must be 0..65535");
    }
    if (!Number.isInteger(this.nextHeader) || this.nextHeader < 0 || this.nextHeader > 255) {
      throw new Error("nextHeader must be 0..255");
    }
    if (!Number.isInteger(this.hopLimit) || this.hopLimit < 0 || this.hopLimit > 255) {
      throw new Error("hopLimit must be 0..255");
    }

    assertLenU8(this.src, 16, "src");
    assertLenU8(this.dst, 16, "dst");

    if (!(this.payload instanceof Uint8Array)) {
      throw new Error("payload must be Uint8Array");
    }
  }
}
