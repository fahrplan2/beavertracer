//@ts-check

/**
 * HPACK header compression for HTTP/2 (RFC 7541).
 *
 * Encoder and decoder each keep a dynamic table; the encoder indexes what it
 * can, otherwise sends literals (Huffman-coded when that is shorter, like
 * nghttp2 does). Malformed input raises {@link HpackError}, which the HTTP/2
 * layer turns into a COMPRESSION_ERROR (RFC 9113 §4.3).
 */

export class HpackError extends Error {
  /** @param {string} msg */
  constructor(msg) {
    super(msg);
    this.name = "HpackError";
  }
}

// ── static table (RFC 7541 Appendix A) ───────────────────────────────────────

/** @type {ReadonlyArray<readonly [string, string]>} index 1..61 at [0..60] */
export const STATIC_TABLE = Object.freeze([
  [":authority", ""], [":method", "GET"], [":method", "POST"], [":path", "/"],
  [":path", "/index.html"], [":scheme", "http"], [":scheme", "https"], [":status", "200"],
  [":status", "204"], [":status", "206"], [":status", "304"], [":status", "400"],
  [":status", "404"], [":status", "500"], ["accept-charset", ""], ["accept-encoding", "gzip, deflate"],
  ["accept-language", ""], ["accept-ranges", ""], ["accept", ""], ["access-control-allow-origin", ""],
  ["age", ""], ["allow", ""], ["authorization", ""], ["cache-control", ""],
  ["content-disposition", ""], ["content-encoding", ""], ["content-language", ""], ["content-length", ""],
  ["content-location", ""], ["content-range", ""], ["content-type", ""], ["cookie", ""],
  ["date", ""], ["etag", ""], ["expect", ""], ["expires", ""],
  ["from", ""], ["host", ""], ["if-match", ""], ["if-modified-since", ""],
  ["if-none-match", ""], ["if-range", ""], ["if-unmodified-since", ""], ["last-modified", ""],
  ["link", ""], ["location", ""], ["max-forwards", ""], ["proxy-authenticate", ""],
  ["proxy-authorization", ""], ["range", ""], ["referer", ""], ["refresh", ""],
  ["retry-after", ""], ["server", ""], ["set-cookie", ""], ["strict-transport-security", ""],
  ["transfer-encoding", ""], ["user-agent", ""], ["vary", ""], ["via", ""],
  ["www-authenticate", ""],
].map(e => Object.freeze(/** @type {[string, string]} */ (e))));

// ── Huffman code (RFC 7541 Appendix B) ───────────────────────────────────────

/** [code, bit length] for symbols 0..255 and EOS (256), flattened. */
const HUFFMAN = [
  0x1ff8, 13, 0x7fffd8, 23, 0xfffffe2, 28, 0xfffffe3, 28,
  0xfffffe4, 28, 0xfffffe5, 28, 0xfffffe6, 28, 0xfffffe7, 28,
  0xfffffe8, 28, 0xffffea, 24, 0x3ffffffc, 30, 0xfffffe9, 28,
  0xfffffea, 28, 0x3ffffffd, 30, 0xfffffeb, 28, 0xfffffec, 28,
  0xfffffed, 28, 0xfffffee, 28, 0xfffffef, 28, 0xffffff0, 28,
  0xffffff1, 28, 0xffffff2, 28, 0x3ffffffe, 30, 0xffffff3, 28,
  0xffffff4, 28, 0xffffff5, 28, 0xffffff6, 28, 0xffffff7, 28,
  0xffffff8, 28, 0xffffff9, 28, 0xffffffa, 28, 0xffffffb, 28,
  0x14, 6, 0x3f8, 10, 0x3f9, 10, 0xffa, 12,
  0x1ff9, 13, 0x15, 6, 0xf8, 8, 0x7fa, 11,
  0x3fa, 10, 0x3fb, 10, 0xf9, 8, 0x7fb, 11,
  0xfa, 8, 0x16, 6, 0x17, 6, 0x18, 6,
  0x0, 5, 0x1, 5, 0x2, 5, 0x19, 6,
  0x1a, 6, 0x1b, 6, 0x1c, 6, 0x1d, 6,
  0x1e, 6, 0x1f, 6, 0x5c, 7, 0xfb, 8,
  0x7ffc, 15, 0x20, 6, 0xffb, 12, 0x3fc, 10,
  0x1ffa, 13, 0x21, 6, 0x5d, 7, 0x5e, 7,
  0x5f, 7, 0x60, 7, 0x61, 7, 0x62, 7,
  0x63, 7, 0x64, 7, 0x65, 7, 0x66, 7,
  0x67, 7, 0x68, 7, 0x69, 7, 0x6a, 7,
  0x6b, 7, 0x6c, 7, 0x6d, 7, 0x6e, 7,
  0x6f, 7, 0x70, 7, 0x71, 7, 0x72, 7,
  0xfc, 8, 0x73, 7, 0xfd, 8, 0x1ffb, 13,
  0x7fff0, 19, 0x1ffc, 13, 0x3ffc, 14, 0x22, 6,
  0x7ffd, 15, 0x3, 5, 0x23, 6, 0x4, 5,
  0x24, 6, 0x5, 5, 0x25, 6, 0x26, 6,
  0x27, 6, 0x6, 5, 0x74, 7, 0x75, 7,
  0x28, 6, 0x29, 6, 0x2a, 6, 0x7, 5,
  0x2b, 6, 0x76, 7, 0x2c, 6, 0x8, 5,
  0x9, 5, 0x2d, 6, 0x77, 7, 0x78, 7,
  0x79, 7, 0x7a, 7, 0x7b, 7, 0x7ffe, 15,
  0x7fc, 11, 0x3ffd, 14, 0x1ffd, 13, 0xffffffc, 28,
  0xfffe6, 20, 0x3fffd2, 22, 0xfffe7, 20, 0xfffe8, 20,
  0x3fffd3, 22, 0x3fffd4, 22, 0x3fffd5, 22, 0x7fffd9, 23,
  0x3fffd6, 22, 0x7fffda, 23, 0x7fffdb, 23, 0x7fffdc, 23,
  0x7fffdd, 23, 0x7fffde, 23, 0xffffeb, 24, 0x7fffdf, 23,
  0xffffec, 24, 0xffffed, 24, 0x3fffd7, 22, 0x7fffe0, 23,
  0xffffee, 24, 0x7fffe1, 23, 0x7fffe2, 23, 0x7fffe3, 23,
  0x7fffe4, 23, 0x1fffdc, 21, 0x3fffd8, 22, 0x7fffe5, 23,
  0x3fffd9, 22, 0x7fffe6, 23, 0x7fffe7, 23, 0xffffef, 24,
  0x3fffda, 22, 0x1fffdd, 21, 0xfffe9, 20, 0x3fffdb, 22,
  0x3fffdc, 22, 0x7fffe8, 23, 0x7fffe9, 23, 0x1fffde, 21,
  0x7fffea, 23, 0x3fffdd, 22, 0x3fffde, 22, 0xfffff0, 24,
  0x1fffdf, 21, 0x3fffdf, 22, 0x7fffeb, 23, 0x7fffec, 23,
  0x1fffe0, 21, 0x1fffe1, 21, 0x3fffe0, 22, 0x1fffe2, 21,
  0x7fffed, 23, 0x3fffe1, 22, 0x7fffee, 23, 0x7fffef, 23,
  0xfffea, 20, 0x3fffe2, 22, 0x3fffe3, 22, 0x3fffe4, 22,
  0x7ffff0, 23, 0x3fffe5, 22, 0x3fffe6, 22, 0x7ffff1, 23,
  0x3ffffe0, 26, 0x3ffffe1, 26, 0xfffeb, 20, 0x7fff1, 19,
  0x3fffe7, 22, 0x7ffff2, 23, 0x3fffe8, 22, 0x1ffffec, 25,
  0x3ffffe2, 26, 0x3ffffe3, 26, 0x3ffffe4, 26, 0x7ffffde, 27,
  0x7ffffdf, 27, 0x3ffffe5, 26, 0xfffff1, 24, 0x1ffffed, 25,
  0x7fff2, 19, 0x1fffe3, 21, 0x3ffffe6, 26, 0x7ffffe0, 27,
  0x7ffffe1, 27, 0x3ffffe7, 26, 0x7ffffe2, 27, 0xfffff2, 24,
  0x1fffe4, 21, 0x1fffe5, 21, 0x3ffffe8, 26, 0x3ffffe9, 26,
  0xffffffd, 28, 0x7ffffe3, 27, 0x7ffffe4, 27, 0x7ffffe5, 27,
  0xfffec, 20, 0xfffff3, 24, 0xfffed, 20, 0x1fffe6, 21,
  0x3fffe9, 22, 0x1fffe7, 21, 0x1fffe8, 21, 0x7ffff3, 23,
  0x3fffea, 22, 0x3fffeb, 22, 0x1ffffee, 25, 0x1ffffef, 25,
  0xfffff4, 24, 0xfffff5, 24, 0x3ffffea, 26, 0x7ffff4, 23,
  0x3ffffeb, 26, 0x7ffffe6, 27, 0x3ffffec, 26, 0x3ffffed, 26,
  0x7ffffe7, 27, 0x7ffffe8, 27, 0x7ffffe9, 27, 0x7ffffea, 27,
  0x7ffffeb, 27, 0xffffffe, 28, 0x7ffffec, 27, 0x7ffffed, 27,
  0x7ffffee, 27, 0x7ffffef, 27, 0x7fffff0, 27, 0x3ffffee, 26,
  0x3fffffff, 30,]; 

const EOS = 256;

/**
 * Decoding trie: node i has children at TRIE[2i] (bit 0) and TRIE[2i+1]
 * (bit 1); a value < 0 marks a leaf holding symbol -(value + 1).
 */
const TRIE = (() => {
  /** @type {number[]} */
  const trie = [0, 0];
  let nodes = 1;
  for (let sym = 0; sym <= EOS; sym++) {
    const code = HUFFMAN[2 * sym], len = HUFFMAN[2 * sym + 1];
    let node = 0;
    for (let i = len - 1; i >= 0; i--) {
      const bit = (code >>> i) & 1;
      const slot = 2 * node + bit;
      if (i === 0) { trie[slot] = -(sym + 1); break; }
      if (trie[slot] === 0) {
        trie[slot] = nodes;
        trie.push(0, 0);
        nodes++;
      }
      node = trie[slot];
    }
  }
  return trie;
})();

/** @param {Uint8Array} bytes */
export function huffmanEncodedLength(bytes) {
  let bits = 0;
  for (const b of bytes) bits += HUFFMAN[2 * b + 1];
  return (bits + 7) >>> 3;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function huffmanEncode(bytes) {
  const out = new Uint8Array(huffmanEncodedLength(bytes));
  let acc = 0, accBits = 0, pos = 0;
  for (const b of bytes) {
    const code = HUFFMAN[2 * b], len = HUFFMAN[2 * b + 1];
    // push the code bit by bit in chunks that keep acc below 2^31
    for (let rem = len; rem > 0;) {
      const take = Math.min(rem, 24 - accBits);
      acc = (acc << take) | ((code >>> (rem - take)) & ((1 << take) - 1));
      accBits += take;
      rem -= take;
      while (accBits >= 8) {
        out[pos++] = (acc >>> (accBits - 8)) & 0xff;
        accBits -= 8;
        acc &= (1 << accBits) - 1;
      }
    }
  }
  // pad with the most significant bits of EOS (all ones), RFC 7541 §5.2
  if (accBits > 0) out[pos++] = ((acc << (8 - accBits)) | ((1 << (8 - accBits)) - 1)) & 0xff;
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function huffmanDecode(bytes) {
  /** @type {number[]} */
  const out = [];
  let node = 0, depth = 0, allOnes = true;
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      const bit = (byte >>> i) & 1;
      const next = TRIE[2 * node + bit];
      depth++;
      allOnes = allOnes && bit === 1;
      if (next < 0) {
        const sym = -(next + 1);
        if (sym === EOS) throw new HpackError("Huffman: EOS symbol in string");
        out.push(sym);
        node = 0; depth = 0; allOnes = true;
      } else if (next === 0) {
        throw new HpackError("Huffman: invalid code");
      } else {
        node = next;
      }
    }
  }
  // leftover bits must be a prefix of EOS (all ones) and shorter than 8
  if (depth > 7 || !allOnes) throw new HpackError("Huffman: invalid padding");
  return Uint8Array.from(out);
}

// ── primitives (RFC 7541 §5) ─────────────────────────────────────────────────

/**
 * Integer with an N-bit prefix; `first` holds the flag bits above the prefix.
 * @param {number[]} out
 * @param {number} value
 * @param {number} prefixBits
 * @param {number} first
 */
function encodeInt(out, value, prefixBits, first) {
  const max = (1 << prefixBits) - 1;
  if (value < max) { out.push(first | value); return; }
  out.push(first | max);
  value -= max;
  while (value >= 128) { out.push((value & 0x7f) | 0x80); value = Math.floor(value / 128); }
  out.push(value);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Cursor over a header block. */
class Reader {
  /** @param {Uint8Array} buf */
  constructor(buf) { this.buf = buf; this.pos = 0; }
  get done() { return this.pos >= this.buf.length; }
  byte() {
    if (this.pos >= this.buf.length) throw new HpackError("header block truncated");
    return this.buf[this.pos++];
  }
  /** @param {number} prefixBits */
  int(prefixBits) {
    const max = (1 << prefixBits) - 1;
    let value = this.byte() & max;
    if (value < max) return value;
    let shift = 0;
    while (true) {
      const b = this.byte();
      value += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (value > 0x7fffffff) throw new HpackError("integer overflow");
      if ((b & 0x80) === 0) return value;
    }
  }
  string() {
    const huffman = (this.buf[this.pos] & 0x80) !== 0;
    const len = this.int(7);
    if (this.pos + len > this.buf.length) throw new HpackError("string literal truncated");
    const raw = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return textDecoder.decode(huffman ? huffmanDecode(raw) : raw);
  }
}

// ── dynamic table (RFC 7541 §2.3.2, §4) ──────────────────────────────────────

/** @param {string} name @param {string} value */
function entrySize(name, value) {
  return textEncoder.encode(name).length + textEncoder.encode(value).length + 32;
}

class DynamicTable {
  /** @param {number} maxSize */
  constructor(maxSize) {
    /** newest first @type {Array<[string, string]>} */
    this.entries = [];
    this.size = 0;
    this.maxSize = maxSize;
  }
  /** @param {string} name @param {string} value */
  add(name, value) {
    const sz = entrySize(name, value);
    this.entries.unshift([name, value]);
    this.size += sz;
    this._evict();
  }
  /** @param {number} n */
  resize(n) { this.maxSize = n; this._evict(); }
  _evict() {
    while (this.size > this.maxSize && this.entries.length > 0) {
      const [n, v] = /** @type {[string, string]} */ (this.entries.pop());
      this.size -= entrySize(n, v);
    }
  }
  /** 1-based HPACK index -> entry @param {number} index */
  get(index) {
    if (index >= 1 && index <= STATIC_TABLE.length) return STATIC_TABLE[index - 1];
    const e = this.entries[index - STATIC_TABLE.length - 1];
    if (!e) throw new HpackError(`invalid table index ${index}`);
    return e;
  }
  /**
   * @param {string} name @param {string} value
   * @returns {{ exact: number, name: number }} 0 = not found
   */
  find(name, value) {
    let nameIdx = 0;
    for (let i = 0; i < STATIC_TABLE.length; i++) {
      const [n, v] = STATIC_TABLE[i];
      if (n !== name) continue;
      if (v === value) return { exact: i + 1, name: i + 1 };
      if (!nameIdx) nameIdx = i + 1;
    }
    for (let i = 0; i < this.entries.length; i++) {
      const [n, v] = this.entries[i];
      if (n !== name) continue;
      const idx = STATIC_TABLE.length + 1 + i;
      if (v === value) return { exact: idx, name: nameIdx || idx };
      if (!nameIdx) nameIdx = idx;
    }
    return { exact: 0, name: nameIdx };
  }
}

// ── encoder ──────────────────────────────────────────────────────────────────

/** Header fields that should never be stored in a table (RFC 7541 §7.1.3). */
const NEVER_INDEX = new Set(["authorization", "proxy-authorization", "set-cookie", "cookie"]);

export class HpackEncoder {
  /** @param {{ maxTableSize?: number, huffman?: boolean }} [opts] */
  constructor(opts = {}) {
    this.table = new DynamicTable(opts.maxTableSize ?? 4096);
    this.huffman = opts.huffman ?? true;
    /** pending table size update for the next block @type {number|null} */
    this._pendingResize = null;
  }

  /**
   * The peer's SETTINGS_HEADER_TABLE_SIZE changed: use at most that much
   * and announce it at the start of the next header block (§4.2).
   * @param {number} n
   */
  setMaxTableSize(n) {
    const size = Math.min(n, 4096);
    if (size === this.table.maxSize && this._pendingResize === null) return;
    this._pendingResize = size;
  }

  /**
   * @param {Array<[string, string]>} headers names must already be lower case
   * @returns {Uint8Array}
   */
  encode(headers) {
    /** @type {number[]} */
    const out = [];
    if (this._pendingResize !== null) {
      this.table.resize(this._pendingResize);
      encodeInt(out, this._pendingResize, 5, 0x20);
      this._pendingResize = null;
    }
    for (const [name, value] of headers) {
      const { exact, name: nameIdx } = this.table.find(name, value);
      if (exact && !NEVER_INDEX.has(name)) {
        encodeInt(out, exact, 7, 0x80);              // indexed field (§6.1)
        continue;
      }
      if (NEVER_INDEX.has(name)) {
        encodeInt(out, nameIdx, 4, 0x10);            // never indexed (§6.2.3)
      } else {
        encodeInt(out, nameIdx, 6, 0x40);            // incremental indexing (§6.2.1)
      }
      if (!nameIdx) this._string(out, name);
      this._string(out, value);
      if (!NEVER_INDEX.has(name)) this.table.add(name, value);
    }
    return Uint8Array.from(out);
  }

  /** @param {number[]} out @param {string} s */
  _string(out, s) {
    const raw = textEncoder.encode(s);
    if (this.huffman && huffmanEncodedLength(raw) < raw.length) {
      const h = huffmanEncode(raw);
      encodeInt(out, h.length, 7, 0x80);
      for (const b of h) out.push(b);
    } else {
      encodeInt(out, raw.length, 7, 0x00);
      for (const b of raw) out.push(b);
    }
  }
}

// ── decoder ──────────────────────────────────────────────────────────────────

export class HpackDecoder {
  /** @param {{ maxTableSize?: number }} [opts] our SETTINGS_HEADER_TABLE_SIZE */
  constructor(opts = {}) {
    this.limit = opts.maxTableSize ?? 4096;
    this.table = new DynamicTable(this.limit);
  }

  /**
   * Decode one complete header block. Any error leaves the decoder state
   * unusable — the HTTP/2 connection must then be closed (RFC 9113 §4.3).
   * @param {Uint8Array} block
   * @returns {Array<[string, string]>}
   */
  decode(block) {
    const r = new Reader(block);
    /** @type {Array<[string, string]>} */
    const out = [];
    let fieldsSeen = false;
    while (!r.done) {
      const b = r.buf[r.pos];
      if (b & 0x80) {                                      // indexed (§6.1)
        const idx = r.int(7);
        if (idx === 0) throw new HpackError("index 0");
        const [n, v] = this.table.get(idx);
        out.push([n, v]);
        fieldsSeen = true;
      } else if (b & 0x40) {                               // incremental indexing (§6.2.1)
        const [n, v] = this._literal(r, 6);
        this.table.add(n, v);
        out.push([n, v]);
        fieldsSeen = true;
      } else if (b & 0x20) {                               // table size update (§6.3)
        if (fieldsSeen) throw new HpackError("table size update after header fields");
        const size = r.int(5);
        if (size > this.limit) throw new HpackError(`table size ${size} exceeds limit ${this.limit}`);
        this.table.resize(size);
      } else {                                             // without / never indexed (§6.2.2, §6.2.3)
        out.push(this._literal(r, 4));
        fieldsSeen = true;
      }
    }
    return out;
  }

  /** @param {Reader} r @param {number} prefixBits @returns {[string, string]} */
  _literal(r, prefixBits) {
    const nameIdx = r.int(prefixBits);
    const name = nameIdx ? this.table.get(nameIdx)[0] : r.string();
    const value = r.string();
    return [name, value];
  }
}
