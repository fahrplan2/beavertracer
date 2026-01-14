//@ts-check

import { assertU8, assertLenU8 } from "../../lib/helpers.js";

export class ArpPacket {
  
  htype;
  ptype;
  hlen;
  plen;
  oper;
  sha;
  spa;
  tha;
  tpa;

  /**
   * ARP for Ethernet/IPv4 by default:
   * HTYPE=1 (Ethernet), PTYPE=0x0800 (IPv4), HLEN=6, PLEN=4
   *
   * @param {object} [opts]
   * @param {number} [opts.htype] hardware type (default 1)
   * @param {number} [opts.ptype] protocol type (default 0x0800)
   * @param {number} [opts.hlen] hardware length (default 6)
   * @param {number} [opts.plen] protocol length (default 4)
   * @param {number} [opts.oper] operation: 1=request, 2=reply
   * @param {Uint8Array} [opts.sha] sender hardware address (MAC) length hlen
   * @param {Uint8Array} [opts.spa] sender protocol address (IPv4) length plen
   * @param {Uint8Array} [opts.tha] target hardware address (MAC) length hlen
   * @param {Uint8Array} [opts.tpa] target protocol address (IPv4) length plen
   */
  constructor(opts = {}) {
    this.htype = (opts.htype ?? 1) & 0xffff;
    this.ptype = (opts.ptype ?? 0x0800) & 0xffff;
    this.hlen  = (opts.hlen  ?? 6) & 0xff;
    this.plen  = (opts.plen  ?? 4) & 0xff;
    this.oper  = (opts.oper  ?? 1) & 0xffff;

    this.sha = opts.sha ? assertLenU8(opts.sha, this.hlen, "sha") : new Uint8Array(this.hlen);
    this.spa = opts.spa ? assertLenU8(opts.spa, this.plen, "spa") : new Uint8Array(this.plen);
    this.tha = opts.tha ? assertLenU8(opts.tha, this.hlen, "tha") : new Uint8Array(this.hlen);
    this.tpa = opts.tpa ? assertLenU8(opts.tpa, this.plen, "tpa") : new Uint8Array(this.plen);
  }

  /** Serialize to raw ARP bytes (for Ethernet payload with EtherType 0x0806) */
  pack() {
    const out = new Uint8Array(8 + 2 * this.hlen + 2 * this.plen);

    out[0] = (this.htype >> 8) & 0xff;
    out[1] = this.htype & 0xff;

    out[2] = (this.ptype >> 8) & 0xff;
    out[3] = this.ptype & 0xff;

    out[4] = this.hlen & 0xff;
    out[5] = this.plen & 0xff;

    out[6] = (this.oper >> 8) & 0xff;
    out[7] = this.oper & 0xff;

    let o = 8;
    out.set(this.sha, o); o += this.hlen;
    out.set(this.spa, o); o += this.plen;
    out.set(this.tha, o); o += this.hlen;
    out.set(this.tpa, o); o += this.plen;

    return out;
  }

  /**
   * Parse raw ARP bytes into an ArpPacket
   * @param {Uint8Array} bytes 
   * @returns {ArpPacket} 
   */
  static fromBytes(bytes) {
    const b = assertU8(bytes);

    if (b.length < 8) throw new Error("ARP too short (need at least 8 bytes)");

    const htype = (b[0] << 8) | b[1];
    const ptype = (b[2] << 8) | b[3];
    const hlen  = b[4];
    const plen  = b[5];
    const oper  = (b[6] << 8) | b[7];

    const need = 8 + 2 * hlen + 2 * plen;
    if (b.length < need) throw new Error(`ARP too short (need ${need} bytes, got ${b.length})`);

    let o = 8;
    const sha = b.slice(o, o + hlen); o += hlen;
    const spa = b.slice(o, o + plen); o += plen;
    const tha = b.slice(o, o + hlen); o += hlen;
    const tpa = b.slice(o, o + plen); o += plen;

    return new ArpPacket({ htype, ptype, hlen, plen, oper, sha, spa, tha, tpa });
  }

}