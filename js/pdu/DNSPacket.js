//@ts-check

/**
 * @typedef {Object} DNSQuestion
 * @property {string} name
 * @property {number} type
 * @property {number} cls
 */

/**
 * @typedef {Object} DNSResourceRecord
 * @property {string} name
 * @property {number} type
 * @property {number} cls
 * @property {number} ttl
 * @property {Uint8Array|string|string[]|any} data
 */

/**
 * Minimal DNS message PDU (supports common queries/responses).
 *
 * - Parses/serializes header + questions + answers/authority/additional.
 * - Supports name compression when parsing.
 * - When packing, this implementation does NOT compress names (simpler, still valid).
 *
 * Records supported in decode/encode:
 * - A (1), AAAA (28), CNAME (5), NS (2), PTR (12), TXT (16)
 * - Other types are kept as raw rdata bytes (Uint8Array).
 */
export class DNSPacket {

  /** @type {number} */
  id;

  /** @type {number} */
  qr;     // 0 query, 1 response
  /** @type {number} */
  opcode; // 0..15
  /** @type {number} */
  aa;     // authoritative answer
  /** @type {number} */
  tc;     // truncation
  /** @type {number} */
  rd;     // recursion desired
  /** @type {number} */
  ra;     // recursion available
  /** @type {number} */
  z;      // must be 0
  /** @type {number} */
  rcode;  // 0..15

  /** @type {Array<DNSQuestion>} */
  questions;

  /** @type {Array<DNSResourceRecord>} */
  answers;

  /** @type {Array<DNSResourceRecord>} */
  authorities;

  /** @type {Array<DNSResourceRecord>} */
  additionals;

  /**
   * @param {object} [opts]
   * @param {number} [opts.id] 16-bit ID
   * @param {number} [opts.qr] 0/1
   * @param {number} [opts.opcode] 0..15
   * @param {number} [opts.aa] 0/1
   * @param {number} [opts.tc] 0/1
   * @param {number} [opts.rd] 0/1
   * @param {number} [opts.ra] 0/1
   * @param {number} [opts.z] 0..7 (must be 0 in classic DNS)
   * @param {number} [opts.rcode] 0..15
   *
   * @param {Array<DNSQuestion>} [opts.questions]
   * @param {Array<DNSResourceRecord>} [opts.answers]
   * @param {Array<DNSResourceRecord>} [opts.authorities]
   * @param {Array<DNSResourceRecord>} [opts.additionals]
   */
  constructor(opts = {}) {
    this.id = (opts.id ?? 0) & 0xffff;

    this.qr = (opts.qr ?? 0) & 0x01;
    this.opcode = (opts.opcode ?? 0) & 0x0f;
    this.aa = (opts.aa ?? 0) & 0x01;
    this.tc = (opts.tc ?? 0) & 0x01;
    this.rd = (opts.rd ?? 1) & 0x01;

    this.ra = (opts.ra ?? 0) & 0x01;
    this.z = (opts.z ?? 0) & 0x07;
    this.rcode = (opts.rcode ?? 0) & 0x0f;

    this.questions = Array.isArray(opts.questions) ? opts.questions : [];
    this.answers = Array.isArray(opts.answers) ? opts.answers : [];
    this.authorities = Array.isArray(opts.authorities) ? opts.authorities : [];
    this.additionals = Array.isArray(opts.additionals) ? opts.additionals : [];

    this._validate();
  }

  // Common constants
  static CLASS_IN = 1;

  static TYPE_A = 1;
  static TYPE_NS = 2;
  static TYPE_CNAME = 5;
  static TYPE_PTR = 12;
  static TYPE_MX = 15;
  static TYPE_TXT = 16;
  static TYPE_AAAA = 28;

  /**
   * Parse DNS message from bytes (UDP payload typically).
   *
   * @param {Uint8Array} bytes
   * @returns {DNSPacket}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error("fromBytes expects Uint8Array");
    if (bytes.length < 12) throw new Error("DNS message needs at least 12 bytes");

    const id = (bytes[0] << 8) | bytes[1];
    const flags = (bytes[2] << 8) | bytes[3];

    const qr = (flags >>> 15) & 0x01;
    const opcode = (flags >>> 11) & 0x0f;
    const aa = (flags >>> 10) & 0x01;
    const tc = (flags >>> 9) & 0x01;
    const rd = (flags >>> 8) & 0x01;
    const ra = (flags >>> 7) & 0x01;
    const z = (flags >>> 4) & 0x07;
    const rcode = flags & 0x0f;

    const qdcount = (bytes[4] << 8) | bytes[5];
    const ancount = (bytes[6] << 8) | bytes[7];
    const nscount = (bytes[8] << 8) | bytes[9];
    const arcount = (bytes[10] << 8) | bytes[11];

    /** @type {number} */
    let off = 12;

    /** @type {Array<DNSQuestion>} */
    const questions = [];
    for (let i = 0; i < qdcount; i++) {
      const nameRes = DNSPacket._readName(bytes, off);
      const name = nameRes.name;
      off = nameRes.nextOffset;

      if (off + 4 > bytes.length) throw new Error("DNS truncated in question");
      const type = (bytes[off] << 8) | bytes[off + 1];
      const cls = (bytes[off + 2] << 8) | bytes[off + 3];
      off += 4;

      questions.push({ name, type, cls });
    }

    /** @type {Array<DNSResourceRecord>} */
    const answers = [];
    for (let i = 0; i < ancount; i++) {
      const rrRes = DNSPacket._readRR(bytes, off);
      answers.push(rrRes.rr);
      off = rrRes.nextOffset;
    }

    /** @type {Array<DNSResourceRecord>} */
    const authorities = [];
    for (let i = 0; i < nscount; i++) {
      const rrRes = DNSPacket._readRR(bytes, off);
      authorities.push(rrRes.rr);
      off = rrRes.nextOffset;
    }

    /** @type {Array<DNSResourceRecord>} */
    const additionals = [];
    for (let i = 0; i < arcount; i++) {
      const rrRes = DNSPacket._readRR(bytes, off);
      additionals.push(rrRes.rr);
      off = rrRes.nextOffset;
    }

    return new DNSPacket({
      id, qr, opcode, aa, tc, rd, ra, z, rcode,
      questions, answers, authorities, additionals
    });
  }

  /**
   * Pack DNS message into bytes.
   * Note: does NOT use name compression (simpler).
   *
   * @returns {Uint8Array}
   */
  pack() {
    this._validate();

    /** @type {Array<Uint8Array>} */
    const parts = [];

    // Header
    const header = new Uint8Array(12);
    header[0] = (this.id >> 8) & 0xff;
    header[1] = this.id & 0xff;

    const flags =
      ((this.qr & 0x01) << 15) |
      ((this.opcode & 0x0f) << 11) |
      ((this.aa & 0x01) << 10) |
      ((this.tc & 0x01) << 9) |
      ((this.rd & 0x01) << 8) |
      ((this.ra & 0x01) << 7) |
      ((this.z & 0x07) << 4) |
      (this.rcode & 0x0f);

    header[2] = (flags >> 8) & 0xff;
    header[3] = flags & 0xff;

    const qdcount = this.questions.length & 0xffff;
    const ancount = this.answers.length & 0xffff;
    const nscount = this.authorities.length & 0xffff;
    const arcount = this.additionals.length & 0xffff;

    header[4] = (qdcount >> 8) & 0xff;
    header[5] = qdcount & 0xff;
    header[6] = (ancount >> 8) & 0xff;
    header[7] = ancount & 0xff;
    header[8] = (nscount >> 8) & 0xff;
    header[9] = nscount & 0xff;
    header[10] = (arcount >> 8) & 0xff;
    header[11] = arcount & 0xff;

    parts.push(header);

    for (const q of this.questions) {
      parts.push(DNSPacket._writeName(q.name));
      parts.push(DNSPacket._u16(q.type));
      parts.push(DNSPacket._u16(q.cls));
    }

    for (const rr of this.answers) parts.push(DNSPacket._writeRR(rr));
    for (const rr of this.authorities) parts.push(DNSPacket._writeRR(rr));
    for (const rr of this.additionals) parts.push(DNSPacket._writeRR(rr));

    return DNSPacket._concat(parts);
  }

  // ------------------ Internal parsing/writing helpers ------------------

  /**
   * @param {Uint8Array} bytes
   * @param {number} offset
   * @returns {{ rr: DNSResourceRecord, nextOffset: number }}
   */
  static _readRR(bytes, offset) {
    const nameRes = DNSPacket._readName(bytes, offset);
    const name = nameRes.name;
    let off = nameRes.nextOffset;

    if (off + 10 > bytes.length) throw new Error("DNS truncated in RR header");

    const type = (bytes[off] << 8) | bytes[off + 1];
    const cls = (bytes[off + 2] << 8) | bytes[off + 3];
    const ttl = (
      (bytes[off + 4] << 24) |
      (bytes[off + 5] << 16) |
      (bytes[off + 6] << 8) |
      bytes[off + 7]
    ) >>> 0;
    const rdlength = (bytes[off + 8] << 8) | bytes[off + 9];
    off += 10;

    if (off + rdlength > bytes.length) throw new Error("DNS truncated in RDATA");

    const rdataBytes = bytes.slice(off, off + rdlength);
    const data = DNSPacket._decodeRData(bytes, off, type, rdataBytes);
    off += rdlength;

    return {
      rr: /** @type {DNSResourceRecord} */ ({ name, type, cls, ttl, data }),
      nextOffset: off
    };
  }

  /**
   * @param {Uint8Array} fullMsg
   * @param {number} rdataOffset
   * @param {number} type
   * @param {Uint8Array} rdataBytes
   * @returns 
   */
  static _decodeRData(fullMsg, rdataOffset, type, rdataBytes) {
    if (type === DNSPacket.TYPE_A) {
      if (rdataBytes.length !== 4) return new Uint8Array(rdataBytes);
      return new Uint8Array(rdataBytes);
    }
    if (type === DNSPacket.TYPE_AAAA) {
      if (rdataBytes.length !== 16) return new Uint8Array(rdataBytes);
      return new Uint8Array(rdataBytes);
    }
    if (type === DNSPacket.TYPE_CNAME || type === DNSPacket.TYPE_NS || type === DNSPacket.TYPE_PTR) {
      const nameRes = DNSPacket._readName(fullMsg, rdataOffset);
      return nameRes.name;
    }
    if (type === DNSPacket.TYPE_TXT) {
      /** @type {string[]} */
      const texts = [];
      let i = 0;
      while (i < rdataBytes.length) {
        const len = rdataBytes[i];
        i++;
        if (i + len > rdataBytes.length) break;
        const chunk = rdataBytes.slice(i, i + len);
        texts.push(DNSPacket._u8ToAscii(chunk));
        i += len;
      }
      return texts;
    }
    if (type === DNSPacket.TYPE_MX) {
      // MX RDATA: preference (u16) + exchange (domain name)
      if (rdataBytes.length < 3) return new Uint8Array(rdataBytes);
      const pref = (rdataBytes[0] << 8) | rdataBytes[1];
      const nameRes = DNSPacket._readName(fullMsg, rdataOffset + 2);
      return { preference: pref, exchange: nameRes.name };
    }
    return new Uint8Array(rdataBytes);
  }

  /**
   * @param {DNSResourceRecord} rr
   * @returns {Uint8Array}
   */
  static _writeRR(rr) {
    const name = rr.name;
    const type = rr.type & 0xffff;
    const cls = rr.cls & 0xffff;
    const ttl = (rr.ttl ?? 0) >>> 0;

    const rdata = DNSPacket._encodeRData(type, rr.data);
    const rdlength = rdata.length & 0xffff;

    /** @type {Array<Uint8Array>} */
    const parts = [];
    parts.push(DNSPacket._writeName(name));
    parts.push(DNSPacket._u16(type));
    parts.push(DNSPacket._u16(cls));
    parts.push(DNSPacket._u32(ttl));
    parts.push(DNSPacket._u16(rdlength));
    parts.push(rdata);

    return DNSPacket._concat(parts);
  }

  /**
   * @param {number} type
   * @param {any} data
   * @returns {Uint8Array}
   */
  static _encodeRData(type, data) {
    if (type === DNSPacket.TYPE_A) {
      if (!(data instanceof Uint8Array) || data.length !== 4) {
        throw new Error("A record data must be Uint8Array(4)");
      }
      return data;
    }
    if (type === DNSPacket.TYPE_AAAA) {
      if (!(data instanceof Uint8Array) || data.length !== 16) {
        throw new Error("AAAA record data must be Uint8Array(16)");
      }
      return data;
    }
    if (type === DNSPacket.TYPE_CNAME || type === DNSPacket.TYPE_NS || type === DNSPacket.TYPE_PTR) {
      if (typeof data !== "string") throw new Error("Name-type record data must be string");
      return DNSPacket._writeName(data);
    }
    if (type === DNSPacket.TYPE_TXT) {
      const arr = Array.isArray(data) ? data : [data];
      /** @type {Array<Uint8Array>} */
      const bufs = [];
      for (const t of arr) {
        if (typeof t !== "string") throw new Error("TXT record data must be string or string[]");
        const b = DNSPacket._asciiToU8(t);
        if (b.length > 255) throw new Error("TXT chunk too long (max 255)");
        const out = new Uint8Array(1 + b.length);
        out[0] = b.length & 0xff;
        out.set(b, 1);
        bufs.push(out);
      }
      return DNSPacket._concat(bufs);
    }
    if (type === DNSPacket.TYPE_MX) {
      // data: { preference: number, exchange: string }
      if (!data || typeof data !== "object") throw new Error("MX data must be object");
      const pref = Number(data.preference ?? 0);
      const exchange = String(data.exchange ?? "");
      if (!Number.isInteger(pref) || pref < 0 || pref > 65535) throw new Error("MX.preference must be 0..65535");
      if (!exchange) throw new Error("MX.exchange required");

      const nameBytes = DNSPacket._writeName(exchange);
      const out = new Uint8Array(2 + nameBytes.length);
      out[0] = (pref >> 8) & 0xff;
      out[1] = pref & 0xff;
      out.set(nameBytes, 2);
      return out;
    }

    if (!(data instanceof Uint8Array)) {
      throw new Error("Unknown RR type: data must be Uint8Array");
    }
    return data;
  }

  /**
   * Read a possibly compressed DNS name.
   *
   * @param {Uint8Array} bytes
   * @param {number} offset
   * @returns {{ name: string, nextOffset: number }}
   */
  static _readName(bytes, offset) {
    let off = offset;
    let jumped = false;
    let jumpBack = -1;

    /** @type {string[]} */
    const labels = [];
    let safety = 0;

    while (true) {
      if (off >= bytes.length) throw new Error("DNS name out of bounds");
      if (++safety > 255) throw new Error("DNS name parse loop");

      const len = bytes[off];

      // pointer?
      if ((len & 0xc0) === 0xc0) {
        if (off + 1 >= bytes.length) throw new Error("DNS pointer truncated");
        const ptr = ((len & 0x3f) << 8) | bytes[off + 1];
        if (!jumped) {
          jumped = true;
          jumpBack = off + 2;
        }
        off = ptr;
        continue;
      }

      // end
      if (len === 0) {
        off += 1;
        break;
      }

      off += 1;
      if (off + len > bytes.length) throw new Error("DNS label truncated");

      const labelBytes = bytes.slice(off, off + len);
      labels.push(DNSPacket._u8ToAscii(labelBytes));
      off += len;
    }

    const name = labels.join(".");
    return { name, nextOffset: jumped ? jumpBack : off };
  }

  /**
   * Write an uncompressed DNS name.
   *
   * @param {string} name
   * @returns {Uint8Array}
   */
  static _writeName(name) {
    if (typeof name !== "string") throw new Error("name must be string");
    if (name === "") return new Uint8Array([0]);

    const labels = name.split(".");
    /** @type {Array<Uint8Array>} */
    const bufs = [];

    for (const lab of labels) {
      const b = DNSPacket._asciiToU8(lab);
      if (b.length === 0) throw new Error("Empty label in name");
      if (b.length > 63) throw new Error("Label too long (max 63)");
      const out = new Uint8Array(1 + b.length);
      out[0] = b.length & 0xff;
      out.set(b, 1);
      bufs.push(out);
    }

    bufs.push(new Uint8Array([0]));
    return DNSPacket._concat(bufs);
  }

  /**
   * @param {number} v
   * @returns {Uint8Array}
   */
  static _u16(v) {
    const out = new Uint8Array(2);
    out[0] = (v >> 8) & 0xff;
    out[1] = v & 0xff;
    return out;
  }

  /**
   * @param {number} v
   * @returns {Uint8Array}
   */
  static _u32(v) {
    const out = new Uint8Array(4);
    out[0] = (v >>> 24) & 0xff;
    out[1] = (v >>> 16) & 0xff;
    out[2] = (v >>> 8) & 0xff;
    out[3] = v & 0xff;
    return out;
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

  /**
   * @param {string} s
   * @returns {Uint8Array}
   */
  static _asciiToU8(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  /**
   * @param {Uint8Array} u8
   * @returns {string}
   */
  static _u8ToAscii(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  _validate() {
    if (!Number.isInteger(this.id) || this.id < 0 || this.id > 0xffff) throw new Error("id must be 0..65535");

    for (const [n, v, max] of /** @type {Array<[string, number, number]>} */ ([
      ["qr", this.qr, 1],
      ["opcode", this.opcode, 15],
      ["aa", this.aa, 1],
      ["tc", this.tc, 1],
      ["rd", this.rd, 1],
      ["ra", this.ra, 1],
      ["z", this.z, 7],
      ["rcode", this.rcode, 15]
    ])) {
      if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`${n} out of range`);
    }

    if (!Array.isArray(this.questions)) throw new Error("questions must be array");
    if (!Array.isArray(this.answers)) throw new Error("answers must be array");
    if (!Array.isArray(this.authorities)) throw new Error("authorities must be array");
    if (!Array.isArray(this.additionals)) throw new Error("additionals must be array");

    for (const q of this.questions) {
      if (!q || typeof q !== "object") throw new Error("question must be object");
      if (typeof q.name !== "string") throw new Error("question.name must be string");
      if (!Number.isInteger(q.type) || q.type < 0 || q.type > 0xffff) throw new Error("question.type must be 0..65535");
      if (!Number.isInteger(q.cls) || q.cls < 0 || q.cls > 0xffff) throw new Error("question.cls must be 0..65535");
    }

    /** @param {DNSResourceRecord} rr */
    const checkRR = (rr) => {
      if (!rr || typeof rr !== "object") throw new Error("RR must be object");
      if (typeof rr.name !== "string") throw new Error("RR.name must be string");
      if (!Number.isInteger(rr.type) || rr.type < 0 || rr.type > 0xffff) throw new Error("RR.type must be 0..65535");
      if (!Number.isInteger(rr.cls) || rr.cls < 0 || rr.cls > 0xffff) throw new Error("RR.cls must be 0..65535");
      if (!Number.isInteger(rr.ttl ?? 0) || (rr.ttl ?? 0) < 0 || (rr.ttl ?? 0) > 0xffffffff) {
        throw new Error("RR.ttl must be 0..2^32-1");
      }
    };

    for (const rr of this.answers) checkRR(rr);
    for (const rr of this.authorities) checkRR(rr);
    for (const rr of this.additionals) checkRR(rr);
  }
}
