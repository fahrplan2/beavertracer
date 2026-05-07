//@ts-check

import { onesComplementChecksum } from "../util/checksumUtils.js";
import { read16BE, write16BE } from "../util/byteUtils.js";

export class ICMPPacket {

  type;
  code;
  checksum;
  identifier;
  sequence;
  payload;

  /**
   * ICMP packet (Echo-style by default).
   *
   * Layout (Echo Request/Reply):
   *  0: type (8=request, 0=reply)
   *  1: code (0)
   *  2-3: checksum
   *  4-5: identifier
   *  6-7: sequence
   *  8..: payload
   *
   * @param {object} [opts]
   * @param {number} [opts.type] ICMP type (default 8 = Echo Request)
   * @param {number} [opts.code] ICMP code (default 0)
   * @param {number} [opts.checksum] 16-bit checksum (default 0 => auto on pack)
   * @param {number} [opts.identifier] 16-bit identifier (default 0)
   * @param {number} [opts.sequence] 16-bit sequence (default 0)
   * @param {Uint8Array} [opts.payload] payload bytes (default empty)
   */
  constructor(opts = {}) {
    this.type = (opts.type ?? 8) & 0xff;
    this.code = (opts.code ?? 0) & 0xff;
    this.checksum = (opts.checksum ?? 0) & 0xffff;

    this.identifier = (opts.identifier ?? 0) & 0xffff;
    this.sequence = (opts.sequence ?? 0) & 0xffff;

    this.payload = opts.payload ? opts.payload : new Uint8Array(0);

    this._validate();
  }

  /**
   * Parse ICMP packet from bytes.
   *
   * Note: This class supports Echo-style format (types 0 and 8) for
   * identifier/sequence. For other ICMP types, those fields are still parsed
   * but their meaning differs (often "rest of header").
   *
   * @param {Uint8Array} bytes
   * @returns {ICMPPacket}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("fromBytes expects Uint8Array");
    }
    if (bytes.length < 4) {
      throw new Error("ICMP needs at least 4 bytes");
    }

    const type = bytes[0];
    const code = bytes[1];
    const checksum = read16BE(bytes, 2);

    // "Rest of header" is 4 bytes (bytes[4..7]) for most ICMP messages.
    // For Echo, it's identifier+sequence.
    let identifier = 0;
    let sequence = 0;
    let payloadStart = 4;

    if (bytes.length >= 8) {
      identifier = read16BE(bytes, 4);
      sequence   = read16BE(bytes, 6);
      payloadStart = 8;
    }

    const payload = bytes.slice(payloadStart);

    return new ICMPPacket({
      type,
      code,
      checksum,
      identifier,
      sequence,
      payload
    });
  }

  /**
   * Pack ICMP packet into bytes.
   * If checksum == 0, it will be computed automatically.
   *
   * @returns {Uint8Array}
   */
  pack() {
    this._validate();

    const headerLen = 8; // Echo-style fixed header
    const out = new Uint8Array(headerLen + this.payload.length);

    out[0] = this.type & 0xff;
    out[1] = this.code & 0xff;

    // checksum placeholder
    out[2] = 0;
    out[3] = 0;

    write16BE(out, 4, this.identifier);
    write16BE(out, 6, this.sequence);

    out.set(this.payload, headerLen);

    const cs = (this.checksum === 0)
      ? ICMPPacket.computeChecksum(out)
      : (this.checksum & 0xffff);

    write16BE(out, 2, cs);

    return out;
  }

  /**
   * @param {Uint8Array} bytes
   * @returns {number}
   */
  static computeChecksum(bytes) {
    return onesComplementChecksum([bytes]);
  }

  _validate() {
    if (!Number.isInteger(this.type) || this.type < 0 || this.type > 255) {
      throw new Error("type must be 0..255");
    }
    if (!Number.isInteger(this.code) || this.code < 0 || this.code > 255) {
      throw new Error("code must be 0..255");
    }
    if (!Number.isInteger(this.checksum) || this.checksum < 0 || this.checksum > 65535) {
      throw new Error("checksum must be 0..65535");
    }
    if (!Number.isInteger(this.identifier) || this.identifier < 0 || this.identifier > 65535) {
      throw new Error("identifier must be 0..65535");
    }
    if (!Number.isInteger(this.sequence) || this.sequence < 0 || this.sequence > 65535) {
      throw new Error("sequence must be 0..65535");
    }
    if (!(this.payload instanceof Uint8Array)) {
      throw new Error("payload must be Uint8Array");
    }
  }
}
