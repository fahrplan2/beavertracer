//@ts-check

import { assertU8, assertMac } from "../../lib/helpers.js";
import { read16BE, write16BE } from "../util/byteUtils.js";

export class EthernetFrame {
  dstMac;
  srcMac;

  /**
   * For Ethernet II frames: EtherType
   * For 802.3+LLC frames: can be left as 0 (not used)
   */
  etherType;

  payload;

  /**
   * Optional 802.1Q C-Tag (TPID 0x8100).
   * @type {{ vid: number, pcp?: number, dei?: number } | null}
   */
  vlan = null;

  /**
   * Optional 802.1ad outer S-Tag (TPID 0x88a8). When set together with vlan,
   * the frame is double-tagged: [0x88a8][outerTCI][0x8100][innerTCI][etherType][payload].
   * @type {{ vid: number, pcp?: number, dei?: number } | null}
   */
  svlan = null;

  /**
   * If true, bytes 12-13 (or inner field after VLAN tag) are treated as LENGTH (802.3),
   * and payload should start with LLC bytes (e.g. DSAP/SSAP/CTRL).
   *
   * If false, bytes 12-13 are EtherType (Ethernet II).
   * @type {boolean}
   */
  useLengthField = false;

  /**
   * Length value (only meaningful when useLengthField === true)
   * This is the number of bytes in the LLC+payload (excluding padding).
   * @type {number}
   */
  length = 0;

  /**
   * @param {object} [opts]
   * @param {Uint8Array} [opts.dstMac] 6 bytes
   * @param {Uint8Array} [opts.srcMac] 6 bytes
   * @param {number} [opts.etherType] 0..65535
   * @param {Uint8Array} [opts.payload] bytes after EtherType (or after Length for 802.3)
   */
  constructor(opts = {}) {
    this.dstMac = opts.dstMac ? assertMac(opts.dstMac) : new Uint8Array(6);
    this.srcMac = opts.srcMac ? assertMac(opts.srcMac) : new Uint8Array(6);
    this.etherType = (opts.etherType ?? 0) & 0xffff;
    this.payload = opts.payload ? assertU8(opts.payload) : new Uint8Array(0);
  }

  /**
   * assembles the frame
   * @returns {Uint8Array}
   */
  pack() {
    const realPayloadLen = this.payload.length;

    let paddedPayload = this.payload;
    if (paddedPayload.length < 46) {
      const tmp = new Uint8Array(46);
      tmp.set(paddedPayload);
      paddedPayload = tmp;
    }

    const svlan = this.svlan;
    const vlan  = this.vlan;

    // 12 (MACs) + 4 per tag + 2 (etherType/length)
    const headerLen = 12 + (svlan != null ? 4 : 0) + (vlan != null ? 4 : 0) + 2;
    const out = new Uint8Array(headerLen + paddedPayload.length);

    out.set(this.dstMac, 0);
    out.set(this.srcMac, 6);

    let offset = 12;

    if (svlan != null) {
      write16BE(out, offset, 0x88a8); offset += 2;
      const tci = (((svlan.pcp ?? 0) & 0x07) << 13) | (((svlan.dei ?? 0) & 0x01) << 12) | (svlan.vid & 0x0fff);
      write16BE(out, offset, tci);    offset += 2;
    }

    if (vlan != null) {
      write16BE(out, offset, 0x8100); offset += 2;
      const tci = (((vlan.pcp ?? 0) & 0x07) << 13) | (((vlan.dei ?? 0) & 0x01) << 12) | (vlan.vid & 0x0fff);
      write16BE(out, offset, tci);    offset += 2;
    }

    write16BE(out, offset, this.useLengthField ? (realPayloadLen & 0xffff) : this.etherType);
    offset += 2;

    out.set(paddedPayload, offset);
    return out;
  }

  /**
   * returns a new Ethernet Frame
   * @param {Uint8Array} bytes
   */
  static fromBytes(bytes) {
    assertU8(bytes);

    const dstMac = bytes.subarray(0, 6);
    const srcMac = bytes.subarray(6, 12);

    const f = new EthernetFrame({ dstMac, srcMac });
    let offset = 12;

    // Outer S-Tag (TPID 0x88a8)?
    if (read16BE(bytes, offset) === 0x88a8) {
      const tci = read16BE(bytes, offset + 2);
      f.svlan = { pcp: (tci >> 13) & 0x07, dei: (tci >> 12) & 0x01, vid: tci & 0x0fff };
      offset += 4;
    }

    // Inner C-Tag (TPID 0x8100)?
    if (read16BE(bytes, offset) === 0x8100) {
      const tci = read16BE(bytes, offset + 2);
      f.vlan = { pcp: (tci >> 13) & 0x07, dei: (tci >> 12) & 0x01, vid: tci & 0x0fff };
      offset += 4;
    }

    const typeOrLen = read16BE(bytes, offset);
    offset += 2;
    f.payload = bytes.subarray(offset);

    if (typeOrLen <= 1500) {
      f.useLengthField = true;
      f.length = typeOrLen;
      f.etherType = 0;
    } else {
      f.useLengthField = false;
      f.length = 0;
      f.etherType = typeOrLen;
    }

    return f;
  }
}
