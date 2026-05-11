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
   * Optional 802.1Q tag.
   * @type {{ vid: number, pcp?: number, dei?: number } | null}
   */
  vlan = null;

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
    // Real payload length (must not include padding if using 802.3 length field)
    const realPayloadLen = this.payload.length;

    // Prepare padded payload for minimum Ethernet payload size (46 bytes)
    let paddedPayload = this.payload;
    if (paddedPayload.length < 46) {
      const tmp = new Uint8Array(46);
      tmp.set(paddedPayload);
      // remaining bytes already 0
      paddedPayload = tmp;
    }

    const hasVlan = this.vlan != null;
    const headerLen = hasVlan ? 18 : 14;
    const out = new Uint8Array(headerLen + paddedPayload.length);

    out.set(this.dstMac, 0);
    out.set(this.srcMac, 6);

    if (!hasVlan) {
      if (this.useLengthField) {
        // 802.3 length (<= 1500)
        write16BE(out, 12, realPayloadLen & 0xffff);
      } else {
        // Ethernet II EtherType
        write16BE(out, 12, this.etherType);
      }

      out.set(paddedPayload, 14);
      return out;
    }

    // VLAN tagged header
    out[12] = 0x81;
    out[13] = 0x00;

    const vid = this.vlan.vid & 0x0fff;
    const pcp = (this.vlan.pcp ?? 0) & 0x07;
    const dei = (this.vlan.dei ?? 0) & 0x01;
    const tci = (pcp << 13) | (dei << 12) | vid;

    write16BE(out, 14, tci);

    if (this.useLengthField) {
      // Inner field is LENGTH (802.3), not EtherType
      write16BE(out, 16, realPayloadLen & 0xffff);
    } else {
      // Inner field is EtherType
      write16BE(out, 16, this.etherType);
    }

    out.set(paddedPayload, 18);
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
    const typeOrTpid = read16BE(bytes, 12);

    // VLAN tagged?
    if (typeOrTpid === 0x8100) {
      const tci = read16BE(bytes, 14);
      const pcp = (tci >> 13) & 0x07;
      const dei = (tci >> 12) & 0x01;
      const vid = tci & 0x0fff;

      const innerTypeOrLen = read16BE(bytes, 16);
           const payload = bytes.subarray(18);

      const f = new EthernetFrame({ dstMac, srcMac, etherType: 0, payload });
      f.vlan = { vid, pcp, dei };

      if (innerTypeOrLen <= 1500) {
        // 802.3 length
        f.useLengthField = true;
        f.length = innerTypeOrLen;
        f.etherType = 0;
      } else {
        // Ethernet II EtherType
        f.useLengthField = false;
        f.length = 0;
        f.etherType = innerTypeOrLen;
      }

      return f;
    }

    // Untagged
    const typeOrLen = typeOrTpid;
    const payload = bytes.subarray(14);

    const f = new EthernetFrame({ dstMac, srcMac, etherType: 0, payload });

    if (typeOrLen <= 1500) {
      // 802.3 length
      f.useLengthField = true;
      f.length = typeOrLen;
      f.etherType = 0;
    } else {
      // Ethernet II EtherType
      f.useLengthField = false;
      f.length = 0;
      f.etherType = typeOrLen;
    }

    return f;
  }
}
