//@ts-check

import { assertU8, assertMac } from "../helpers.js";

export class EthernetFrame {

   dstMac;
   srcMac;
   etherType;
   payload;

  /**
   * @param {object} [opts]
   * @param {Uint8Array} [opts.dstMac] 6 bytes
   * @param {Uint8Array} [opts.srcMac] 6 bytes
   * @param {number} [opts.etherType] 0..65535
   * @param {Uint8Array} [opts.payload] bytes after EtherType
   */

  constructor(opts = {}) {
    this.dstMac = opts.dstMac ? assertMac(opts.dstMac) : new Uint8Array(6);
    this.srcMac = opts.srcMac ? assertMac(opts.srcMac) : new Uint8Array(6);
    this.etherType = (opts.etherType ?? 0) & 0xffff;
    this.payload = opts.payload ? assertU8(opts.payload) : new Uint8Array(0);
  }

  /**
   * assembels the frame
   * @returns {Uint8Array} Assembled Frame
   */

  pack() {
    //add a padding if payload less than 46 bytes
    while (this.payload.length < 46) {

      //this is a push() on a Uint8Array
      const payload = new Uint8Array(this.payload.length + 1);
      payload.set(this.payload);
      payload[payload.length] = 0;
      this.payload = payload;
    }

    const out = new Uint8Array(14 + this.payload.length);
    out.set(this.dstMac,0);
    out.set(this.srcMac,6);
    out[12] = Math.floor(this.etherType/256);
    out[13] = Math.floor(this.etherType%256);
    out.set(this.payload,14);
    return out;
  }

  /**
   * returnes a new Ethernet Frame
   * @param {Uint8Array} bytes 
   */

  static fromBytes(bytes) {
    assertU8(bytes);
    const dstMac = bytes.subarray(0,6);
    const srcMac = bytes.subarray(6,12);
    const etherType = (bytes[12]<<8)+bytes[13];
    const payload = bytes.subarray(14);

    return new EthernetFrame({dstMac, srcMac, etherType, payload});
  }
 



}