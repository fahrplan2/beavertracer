//@ts-check

import { assertLenU8 } from "../helpers.js";

/**
 * @typedef {Object} DHCPOption
 * @property {number} code
 * @property {Uint8Array} data
 */

/**
 * DHCP (IPv4) message PDU (BOOTP/DHCP).
 *
 * - Parses/serializes fixed BOOTP header + options (DHCP magic cookie required).
 * - Options are stored as raw {code,data} pairs; helper getters/setters included.
 *
 * Note:
 * - DHCP is typically carried in UDP:
 *   client:68 <-> server:67
 */
export class DHCPPacket {

  /** @type {number} */ op;       // 1=request, 2=reply
  /** @type {number} */ htype;    // 1=Ethernet
  /** @type {number} */ hlen;     // 6 for MAC
  /** @type {number} */ hops;

  /** @type {number} */ xid;      // transaction id
  /** @type {number} */ secs;
  /** @type {number} */ flags;    // bit15 = broadcast

  /** @type {Uint8Array} */ ciaddr; // client IP
  /** @type {Uint8Array} */ yiaddr; // your (client) IP
  /** @type {Uint8Array} */ siaddr; // server IP
  /** @type {Uint8Array} */ giaddr; // relay agent IP

  /** @type {Uint8Array} */ chaddr; // client hardware address (16 bytes in BOOTP)
  /** @type {Uint8Array} */ sname;  // 64 bytes server host name (optional)
  /** @type {Uint8Array} */ file;   // 128 bytes boot file name (optional)

  /** @type {Array<DHCPOption>} */ options;

  // Common option codes
  static OPT_PAD = 0;
  static OPT_END = 255;
  static OPT_MESSAGE_TYPE = 53;
  static OPT_CLIENT_ID = 61;
  static OPT_REQUESTED_IP = 50;
  static OPT_SERVER_ID = 54;
  static OPT_PARAMETER_REQUEST_LIST = 55;
  static OPT_HOSTNAME = 12;
  static OPT_SUBNET_MASK = 1;
  static OPT_ROUTER = 3;
  static OPT_DNS = 6;
  static OPT_DOMAIN_NAME = 15;
  static OPT_LEASE_TIME = 51;
  static OPT_RENEWAL_T1 = 58;
  static OPT_REBINDING_T2 = 59;

  // DHCP message types (option 53)
  static MT_DISCOVER = 1;
  static MT_OFFER = 2;
  static MT_REQUEST = 3;
  static MT_DECLINE = 4;
  static MT_ACK = 5;
  static MT_NAK = 6;
  static MT_RELEASE = 7;
  static MT_INFORM = 8;

  /**
   * @param {object} [opts]
   * @param {number} [opts.op] 1=request, 2=reply (default 1)
   * @param {number} [opts.htype] default 1 (Ethernet)
   * @param {number} [opts.hlen] default 6
   * @param {number} [opts.hops] default 0
   * @param {number} [opts.xid] 32-bit transaction id (default 0)
   * @param {number} [opts.secs] default 0
   * @param {number} [opts.flags] 16-bit flags (default 0)
   *
   * @param {Uint8Array} [opts.ciaddr] length 4
   * @param {Uint8Array} [opts.yiaddr] length 4
   * @param {Uint8Array} [opts.siaddr] length 4
   * @param {Uint8Array} [opts.giaddr] length 4
   *
   * @param {Uint8Array} [opts.chaddr] BOOTP chaddr field length 16 (MAC in first hlen bytes)
   * @param {Uint8Array} [opts.sname] length 64
   * @param {Uint8Array} [opts.file] length 128
   *
   * @param {Array<DHCPOption>} [opts.options]
   */
  constructor(opts = {}) {
    this.op = (opts.op ?? 1) & 0xff;
    this.htype = (opts.htype ?? 1) & 0xff;
    this.hlen = (opts.hlen ?? 6) & 0xff;
    this.hops = (opts.hops ?? 0) & 0xff;

    this.xid = (opts.xid ?? 0) >>> 0;
    this.secs = (opts.secs ?? 0) & 0xffff;
    this.flags = (opts.flags ?? 0) & 0xffff;

    this.ciaddr = opts.ciaddr ? assertLenU8(opts.ciaddr, 4, "ciaddr") : new Uint8Array(4);
    this.yiaddr = opts.yiaddr ? assertLenU8(opts.yiaddr, 4, "yiaddr") : new Uint8Array(4);
    this.siaddr = opts.siaddr ? assertLenU8(opts.siaddr, 4, "siaddr") : new Uint8Array(4);
    this.giaddr = opts.giaddr ? assertLenU8(opts.giaddr, 4, "giaddr") : new Uint8Array(4);

    this.chaddr = opts.chaddr ? assertLenU8(opts.chaddr, 16, "chaddr") : new Uint8Array(16);
    this.sname = opts.sname ? assertLenU8(opts.sname, 64, "sname") : new Uint8Array(64);
    this.file = opts.file ? assertLenU8(opts.file, 128, "file") : new Uint8Array(128);

    this.options = Array.isArray(opts.options) ? opts.options : [];

    this._validate();
  }

  /**
   * Convenience: set client MAC (writes into chaddr[0..5]).
   * @param {Uint8Array} mac length 6
   */
  setClientMAC(mac) {
    assertLenU8(mac, 6, "mac");
    this.chaddr.fill(0);
    this.chaddr.set(mac, 0);
    this.hlen = 6;
    this.htype = 1;
  }

  /**
   * Convenience: get client MAC from chaddr[0..hlen].
   * @returns {Uint8Array}
   */
  getClientMAC() {
    return this.chaddr.slice(0, this.hlen);
  }

  /**
   * Get first option by code.
   * @param {number} code
   * @returns {Uint8Array|null}
   */
  getOption(code) {
    for (const o of this.options) {
      if (o.code === code) return o.data;
    }
    return null;
  }

  /**
   * Set (replace) option by code.
   * @param {number} code
   * @param {Uint8Array} data
   */
  setOption(code, data) {
    if (!Number.isInteger(code) || code < 0 || code > 255) throw new Error("option code must be 0..255");
    if (!(data instanceof Uint8Array)) throw new Error("option data must be Uint8Array");

    // remove existing
    this.options = this.options.filter(o => o.code !== code);
    this.options.push({ code, data });
  }

  /**
   * Convenience: DHCP message type (option 53).
   * @returns {number|null}
   */
  getMessageType() {
    const v = this.getOption(DHCPPacket.OPT_MESSAGE_TYPE);
    if (!v || v.length !== 1) return null;
    return v[0];
  }

  /**
   * Convenience: set DHCP message type (option 53).
   * @param {number} mt
   */
  setMessageType(mt) {
    if (!Number.isInteger(mt) || mt < 0 || mt > 255) throw new Error("message type must be 0..255");
    this.setOption(DHCPPacket.OPT_MESSAGE_TYPE, new Uint8Array([mt & 0xff]));
  }

  /**
   * Parse DHCP packet from bytes.
   *
   * @param {Uint8Array} bytes
   * @returns {DHCPPacket}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error("fromBytes expects Uint8Array");
    if (bytes.length < 240) throw new Error("DHCP needs at least 240 bytes (BOOTP + cookie)");

    const op = bytes[0];
    const htype = bytes[1];
    const hlen = bytes[2];
    const hops = bytes[3];

    const xid =
      ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;

    const secs = (bytes[8] << 8) | bytes[9];
    const flags = (bytes[10] << 8) | bytes[11];

    const ciaddr = bytes.slice(12, 16);
    const yiaddr = bytes.slice(16, 20);
    const siaddr = bytes.slice(20, 24);
    const giaddr = bytes.slice(24, 28);

    const chaddr = bytes.slice(28, 44);     // 16
    const sname = bytes.slice(44, 108);     // 64
    const file = bytes.slice(108, 236);     // 128

    // magic cookie
    const cookie0 = bytes[236], cookie1 = bytes[237], cookie2 = bytes[238], cookie3 = bytes[239];
    if (cookie0 !== 99 || cookie1 !== 130 || cookie2 !== 83 || cookie3 !== 99) {
      throw new Error("Invalid DHCP magic cookie");
    }

    /** @type {Array<DHCPOption>} */
    const options = [];

    let off = 240;
    while (off < bytes.length) {
      const code = bytes[off] & 0xff;
      off += 1;

      if (code === DHCPPacket.OPT_PAD) continue;
      if (code === DHCPPacket.OPT_END) break;

      if (off >= bytes.length) throw new Error("DHCP options truncated (missing len)");
      const len = bytes[off] & 0xff;
      off += 1;

      if (off + len > bytes.length) throw new Error("DHCP options truncated (missing data)");
      const data = bytes.slice(off, off + len);
      off += len;

      options.push({ code, data });
    }

    return new DHCPPacket({
      op, htype, hlen, hops, xid, secs, flags,
      ciaddr, yiaddr, siaddr, giaddr,
      chaddr, sname, file,
      options
    });
  }

  /**
   * Pack DHCP packet into bytes (BOOTP + magic cookie + options + END).
   *
   * Note: This will always write the magic cookie and terminate options with END.
   *
   * @returns {Uint8Array}
   */
  pack() {
    this._validate();

    /** @type {Array<Uint8Array>} */
    const parts = [];

    const fixed = new Uint8Array(236);

    fixed[0] = this.op & 0xff;
    fixed[1] = this.htype & 0xff;
    fixed[2] = this.hlen & 0xff;
    fixed[3] = this.hops & 0xff;

    fixed[4] = (this.xid >>> 24) & 0xff;
    fixed[5] = (this.xid >>> 16) & 0xff;
    fixed[6] = (this.xid >>> 8) & 0xff;
    fixed[7] = this.xid & 0xff;

    fixed[8] = (this.secs >> 8) & 0xff;
    fixed[9] = this.secs & 0xff;

    fixed[10] = (this.flags >> 8) & 0xff;
    fixed[11] = this.flags & 0xff;

    fixed.set(this.ciaddr, 12);
    fixed.set(this.yiaddr, 16);
    fixed.set(this.siaddr, 20);
    fixed.set(this.giaddr, 24);

    fixed.set(this.chaddr, 28);
    fixed.set(this.sname, 44);
    fixed.set(this.file, 108);

    parts.push(fixed);

    // magic cookie
    parts.push(new Uint8Array([99, 130, 83, 99]));

    // options
    for (const opt of this.options) {
      if (opt.code === DHCPPacket.OPT_PAD || opt.code === DHCPPacket.OPT_END) continue;
      if (!(opt.data instanceof Uint8Array)) throw new Error("option.data must be Uint8Array");

      const code = opt.code & 0xff;
      const len = opt.data.length & 0xff;
      if (opt.data.length > 255) throw new Error(`DHCP option ${code} too long (max 255)`);

      const hdr = new Uint8Array(2);
      hdr[0] = code;
      hdr[1] = len;

      parts.push(hdr);
      parts.push(opt.data);
    }

    // END
    parts.push(new Uint8Array([DHCPPacket.OPT_END]));

    return DHCPPacket._concat(parts);
  }

  /**
   * @param {Array<Uint8Array>} parts
   * @returns {Uint8Array}
   */
  static _concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length;

    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  _validate() {
    for (const [n, v, max] of /** @type {Array<[string, number, number]>} */ ([
      ["op", this.op, 255],
      ["htype", this.htype, 255],
      ["hlen", this.hlen, 255],
      ["hops", this.hops, 255],
    ])) {
      if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`${n} out of range`);
    }

    if (!Number.isInteger(this.xid) || this.xid < 0 || this.xid > 0xffffffff) throw new Error("xid out of range");
    if (!Number.isInteger(this.secs) || this.secs < 0 || this.secs > 0xffff) throw new Error("secs out of range");
    if (!Number.isInteger(this.flags) || this.flags < 0 || this.flags > 0xffff) throw new Error("flags out of range");

    assertLenU8(this.ciaddr, 4, "ciaddr");
    assertLenU8(this.yiaddr, 4, "yiaddr");
    assertLenU8(this.siaddr, 4, "siaddr");
    assertLenU8(this.giaddr, 4, "giaddr");

    assertLenU8(this.chaddr, 16, "chaddr");
    assertLenU8(this.sname, 64, "sname");
    assertLenU8(this.file, 128, "file");

    if (!Array.isArray(this.options)) throw new Error("options must be array");
    for (const o of this.options) {
      if (!o || typeof o !== "object") throw new Error("option must be object");
      if (!Number.isInteger(o.code) || o.code < 0 || o.code > 255) throw new Error("option.code must be 0..255");
      if (!(o.data instanceof Uint8Array)) throw new Error("option.data must be Uint8Array");
    }
  }
}
