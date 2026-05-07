//@ts-check

/**
 * @typedef {{ code: number, data: Uint8Array }} DHCPv6Option
 */

/**
 * DHCPv6 message PDU (RFC 3315 / RFC 8415).
 *
 * Wire format:
 *   1 byte  msg-type
 *   3 bytes transaction-id
 *   N bytes options (each: 2-byte code, 2-byte length, data)
 *
 * Carried in UDP: client port 546 <-> server port 547.
 * Server listens on ff02::1:2 (All_DHCP_Relay_Agents_and_Servers).
 */
export class DHCPv6Packet {

  // Message types
  static MT_SOLICIT             = 1;
  static MT_ADVERTISE           = 2;
  static MT_REQUEST             = 3;
  static MT_CONFIRM             = 4;
  static MT_RENEW               = 5;
  static MT_REBIND              = 6;
  static MT_REPLY               = 7;
  static MT_RELEASE             = 8;
  static MT_DECLINE             = 9;
  static MT_RECONFIGURE         = 10;
  static MT_INFORMATION_REQUEST = 11;

  // Option codes
  static OPT_CLIENTID    = 1;
  static OPT_SERVERID    = 2;
  static OPT_IA_NA       = 3;
  static OPT_IA_TA       = 4;
  static OPT_IAADDR      = 5;
  static OPT_ORO         = 6;
  static OPT_PREFERENCE  = 7;
  static OPT_ELAPSED_TIME = 8;
  static OPT_STATUS_CODE = 13;
  static OPT_RAPID_COMMIT = 14;
  static OPT_DNS_SERVERS = 23;
  static OPT_DOMAIN_LIST = 24;
  static OPT_IA_PD       = 25;
  static OPT_IAPREFIX    = 26;

  // Status codes (for OPT_STATUS_CODE)
  static STATUS_SUCCESS      = 0;
  static STATUS_UNSPEC_FAIL  = 1;
  static STATUS_NO_ADDRS     = 2;
  static STATUS_NO_BINDING   = 3;

  /** @type {number} */ msgType;
  /** @type {Uint8Array} */ transactionId; // 3 bytes
  /** @type {DHCPv6Option[]} */ options;

  /**
   * @param {object} [opts]
   * @param {number} [opts.msgType]
   * @param {Uint8Array} [opts.transactionId]
   * @param {DHCPv6Option[]} [opts.options]
   */
  constructor(opts = {}) {
    this.msgType       = ((opts.msgType ?? 1) & 0xff);
    this.transactionId = (opts.transactionId instanceof Uint8Array && opts.transactionId.length === 3)
      ? opts.transactionId : new Uint8Array(3);
    this.options       = Array.isArray(opts.options) ? opts.options : [];
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
   * Set (replace) option.
   * @param {number} code
   * @param {Uint8Array} data
   */
  setOption(code, data) {
    if (!Number.isInteger(code) || code < 0 || code > 65535) throw new Error("option code 0..65535");
    if (!(data instanceof Uint8Array)) throw new Error("option data must be Uint8Array");
    this.options = this.options.filter(o => o.code !== code);
    this.options.push({ code, data });
  }

  /**
   * Parse DHCPv6 packet from bytes.
   * @param {Uint8Array} bytes
   * @returns {DHCPv6Packet}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error("fromBytes expects Uint8Array");
    if (bytes.length < 4) throw new Error("DHCPv6 packet too short (need ≥ 4 bytes)");

    const msgType       = bytes[0];
    const transactionId = bytes.slice(1, 4);

    /** @type {DHCPv6Option[]} */
    const options = [];
    let off = 4;
    while (off + 4 <= bytes.length) {
      const code = (bytes[off] << 8) | bytes[off + 1];
      const len  = (bytes[off + 2] << 8) | bytes[off + 3];
      off += 4;
      if (off + len > bytes.length) throw new Error(`DHCPv6 option ${code} truncated`);
      options.push({ code, data: bytes.slice(off, off + len) });
      off += len;
    }

    return new DHCPv6Packet({ msgType, transactionId, options });
  }

  /**
   * Serialize packet to bytes.
   * @returns {Uint8Array}
   */
  pack() {
    /** @type {Uint8Array[]} */
    const parts = [];

    const hdr = new Uint8Array(4);
    hdr[0] = this.msgType & 0xff;
    hdr.set(this.transactionId.slice(0, 3), 1);
    parts.push(hdr);

    for (const opt of this.options) {
      const data = opt.data;
      const optHdr = new Uint8Array(4);
      optHdr[0] = (opt.code >>> 8) & 0xff;
      optHdr[1] = opt.code & 0xff;
      optHdr[2] = (data.length >>> 8) & 0xff;
      optHdr[3] = data.length & 0xff;
      parts.push(optHdr);
      parts.push(data);
    }

    return _concat(parts);
  }

  // ---- Static builders ----

  /**
   * Encode a single option TLV (for embedding as sub-option).
   * @param {number} code
   * @param {Uint8Array} data
   * @returns {Uint8Array}
   */
  static encodeOption(code, data) {
    const out = new Uint8Array(4 + data.length);
    out[0] = (code >>> 8) & 0xff;
    out[1] = code & 0xff;
    out[2] = (data.length >>> 8) & 0xff;
    out[3] = data.length & 0xff;
    out.set(data, 4);
    return out;
  }

  /**
   * Build IA_NA option payload (RFC 3315 §22.4).
   * @param {number} iaid  32-bit Identity Association ID
   * @param {number} t1    seconds until T1 (renew)
   * @param {number} t2    seconds until T2 (rebind)
   * @param {Uint8Array} iaOptions  embedded sub-options (e.g. IAADDR)
   * @returns {Uint8Array}
   */
  static buildIA_NA(iaid, t1, t2, iaOptions) {
    const out = new Uint8Array(12 + iaOptions.length);
    _writeU32(out, 0, iaid);
    _writeU32(out, 4, t1);
    _writeU32(out, 8, t2);
    out.set(iaOptions, 12);
    return out;
  }

  /**
   * Parse IA_NA option payload.
   * @param {Uint8Array} data
   * @returns {{ iaid: number, t1: number, t2: number, iaOptions: Uint8Array }}
   */
  static parseIA_NA(data) {
    if (data.length < 12) throw new Error("IA_NA too short");
    return {
      iaid:      _readU32(data, 0),
      t1:        _readU32(data, 4),
      t2:        _readU32(data, 8),
      iaOptions: data.slice(12),
    };
  }

  /**
   * Build IA_PD option payload (RFC 8415 §21.21) — identical structure to IA_NA.
   * @param {number} iaid  32-bit Identity Association ID
   * @param {number} t1    seconds until T1
   * @param {number} t2    seconds until T2
   * @param {Uint8Array} iaOptions  embedded sub-options (e.g. IAPREFIX)
   * @returns {Uint8Array}
   */
  static buildIA_PD(iaid, t1, t2, iaOptions) {
    const out = new Uint8Array(12 + iaOptions.length);
    _writeU32(out, 0, iaid);
    _writeU32(out, 4, t1);
    _writeU32(out, 8, t2);
    out.set(iaOptions, 12);
    return out;
  }

  /**
   * Parse IA_PD option payload.
   * @param {Uint8Array} data
   * @returns {{ iaid: number, t1: number, t2: number, iaOptions: Uint8Array }}
   */
  static parseIA_PD(data) {
    if (data.length < 12) throw new Error("IA_PD too short");
    return {
      iaid:      _readU32(data, 0),
      t1:        _readU32(data, 4),
      t2:        _readU32(data, 8),
      iaOptions: data.slice(12),
    };
  }

  /**
   * Build IAPREFIX option payload (RFC 8415 §21.22): 25 bytes.
   * @param {number} preferred  preferred lifetime (seconds)
   * @param {number} valid      valid lifetime (seconds)
   * @param {number} prefixLength  prefix length in bits (e.g. 56)
   * @param {Uint8Array} prefix16bytes  masked 16-byte prefix
   * @returns {Uint8Array}
   */
  static buildIAPrefix(preferred, valid, prefixLength, prefix16bytes) {
    if (prefix16bytes.length !== 16) throw new Error("prefix16bytes must be 16 bytes");
    const out = new Uint8Array(25);
    _writeU32(out, 0, preferred);
    _writeU32(out, 4, valid);
    out[8] = prefixLength & 0xff;
    out.set(prefix16bytes, 9);
    return out;
  }

  /**
   * Parse IAPREFIX option payload.
   * @param {Uint8Array} data
   * @returns {{ preferred: number, valid: number, prefixLength: number, prefix16bytes: Uint8Array }}
   */
  static parseIAPrefix(data) {
    if (data.length < 25) throw new Error("IAPREFIX too short");
    return {
      preferred:     _readU32(data, 0),
      valid:         _readU32(data, 4),
      prefixLength:  data[8],
      prefix16bytes: data.slice(9, 25),
    };
  }

  /**
   * Build IAADDR option payload (RFC 3315 §22.6): 16-byte address + lifetimes.
   * @param {Uint8Array} ip6bytes  16 bytes
   * @param {number} preferred  preferred lifetime (seconds)
   * @param {number} valid      valid lifetime (seconds)
   * @returns {Uint8Array}
   */
  static buildIAAddr(ip6bytes, preferred, valid) {
    if (ip6bytes.length !== 16) throw new Error("ip6bytes must be 16 bytes");
    const out = new Uint8Array(24);
    out.set(ip6bytes, 0);
    _writeU32(out, 16, preferred);
    _writeU32(out, 20, valid);
    return out;
  }

  /**
   * Build DUID-LL (type 3, RFC 3315 §9.4): link-layer address.
   * @param {Uint8Array} mac  6-byte Ethernet MAC
   * @returns {Uint8Array}  10-byte DUID
   */
  static buildDUID_LL(mac) {
    if (mac.length !== 6) throw new Error("MAC must be 6 bytes");
    const out = new Uint8Array(10);
    out[0] = 0; out[1] = 3; // DUID-LL
    out[2] = 0; out[3] = 1; // hardware type: Ethernet
    out.set(mac, 4);
    return out;
  }

  /**
   * Convert DUID bytes to lowercase hex string (for use as Map key).
   * @param {Uint8Array} duid
   * @returns {string}
   */
  static duidToHex(duid) {
    return Array.from(duid).map(b => b.toString(16).padStart(2, "0")).join("");
  }
}

// ---- private helpers ----

/** @param {Uint8Array[]} parts @returns {Uint8Array} */
function _concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/**
 * Write big-endian u32 into buf at offset.
 * @param {Uint8Array} buf
 * @param {number} off
 * @param {number} val
 */
function _writeU32(buf, off, val) {
  const v = val >>> 0;
  buf[off]     = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

/**
 * Read big-endian u32 from buf at offset.
 * @param {Uint8Array} buf
 * @param {number} off
 * @returns {number}
 */
function _readU32(buf, off) {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}
