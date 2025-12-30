//@ts-check

/**
 * 802.1Q VLAN header AFTER the outer EtherType (TPID=0x8100).
 *
 * Wire format is:
 *   [TPID=0x8100][TCI][inner EtherType][payload]
 *
 * If your EthernetFrame already stores EtherType=0x8100, then its payload starts with:
 *   [TCI][inner EtherType][payload]
 *
 * Layout here:
 *  0..1  TCI: PCP(3) | DEI(1) | VID(12)
 *  2..3  inner EtherType (e.g. 0x0800 IPv4, 0x0806 ARP)
 *  4..   inner payload
 */
export class VLANHeader {

  /** @type {number} */
  pcp; // 0..7

  /** @type {number} */
  dei; // 0..1

  /** @type {number} */
  vid; // 0..4095

  /** @type {number} */
  innerEtherType; // 0..65535

  /** @type {Uint8Array} */
  payload;

  /**
   * @param {object} [opts]
   * @param {number} [opts.pcp] 0..7 (default 0)
   * @param {number} [opts.dei] 0..1 (default 0)
   * @param {number} [opts.vid] 0..4095 (default 1)
   * @param {number} [opts.innerEtherType] default 0x0800 (IPv4)
   * @param {Uint8Array} [opts.payload] inner payload bytes (default empty)
   */
  constructor(opts = {}) {
    this.pcp = (opts.pcp ?? 0) & 0x07;
    this.dei = (opts.dei ?? 0) & 0x01;
    this.vid = (opts.vid ?? 1) & 0x0fff;

    this.innerEtherType = (opts.innerEtherType ?? 0x0800) & 0xffff;

    this.payload = opts.payload ? opts.payload : new Uint8Array(0);

    this._validate();
  }

  /**
   * Parse VLANHeader from bytes (TCI + inner EtherType + payload).
   *
   * @param {Uint8Array} bytes
   * @returns {VLANHeader}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("fromBytes expects Uint8Array");
    }
    if (bytes.length < 4) {
      throw new Error("VLANHeader needs at least 4 bytes");
    }

    const tci = (bytes[0] << 8) | bytes[1];
    const pcp = (tci >> 13) & 0x07;
    const dei = (tci >> 12) & 0x01;
    const vid = tci & 0x0fff;

    const innerEtherType = (bytes[2] << 8) | bytes[3];
    const payload = bytes.slice(4);

    return new VLANHeader({ pcp, dei, vid, innerEtherType, payload });
  }

  /**
   * Pack VLANHeader into bytes (TCI + inner EtherType + payload).
   *
   * @returns {Uint8Array}
   */
  pack() {
    this._validate();

    const out = new Uint8Array(4 + this.payload.length);

    const tci =
      ((this.pcp & 0x07) << 13) |
      ((this.dei & 0x01) << 12) |
      (this.vid & 0x0fff);

    out[0] = (tci >> 8) & 0xff;
    out[1] = tci & 0xff;

    out[2] = (this.innerEtherType >> 8) & 0xff;
    out[3] = this.innerEtherType & 0xff;

    if (this.payload.length > 0) out.set(this.payload, 4);

    return out;
  }

  _validate() {
    if (!Number.isInteger(this.pcp) || this.pcp < 0 || this.pcp > 7) {
      throw new Error("pcp must be 0..7");
    }
    if (!Number.isInteger(this.dei) || this.dei < 0 || this.dei > 1) {
      throw new Error("dei must be 0..1");
    }
    if (!Number.isInteger(this.vid) || this.vid < 0 || this.vid > 4095) {
      throw new Error("vid must be 0..4095");
    }
    if (!Number.isInteger(this.innerEtherType) || this.innerEtherType < 0 || this.innerEtherType > 0xffff) {
      throw new Error("innerEtherType must be 0..65535");
    }
    if (!(this.payload instanceof Uint8Array)) {
      throw new Error("payload must be Uint8Array");
    }
  }
}
