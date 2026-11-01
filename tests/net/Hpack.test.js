//@ts-check

import { describe, it, expect } from 'vitest';
import {
  HpackEncoder, HpackDecoder, HpackError, huffmanEncode, huffmanDecode, STATIC_TABLE,
} from '../../src/net/Hpack.js';

const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('hex');
const unhex = (/** @type {string} */ s) => Uint8Array.from(Buffer.from(s.replace(/\s+/g, ''), 'hex'));
const enc = new TextEncoder();

/** @type {Array<Array<[string, string]>>} RFC 7541 C.3 / C.4 request header lists */
const REQUESTS = [
  [[':method', 'GET'], [':scheme', 'http'], [':path', '/'], [':authority', 'www.example.com']],
  [[':method', 'GET'], [':scheme', 'http'], [':path', '/'], [':authority', 'www.example.com'], ['cache-control', 'no-cache']],
  [[':method', 'GET'], [':scheme', 'https'], [':path', '/index.html'], [':authority', 'www.example.com'], ['custom-key', 'custom-value']],
];

describe('HPACK static table', () => {
  it('has the 61 entries of Appendix A', () => {
    expect(STATIC_TABLE.length).toBe(61);
    expect(STATIC_TABLE[0]).toEqual([':authority', '']);
    expect(STATIC_TABLE[7]).toEqual([':status', '200']);
    expect(STATIC_TABLE[60]).toEqual(['www-authenticate', '']);
  });
});

describe('Huffman (RFC 7541 Appendix B)', () => {
  it('matches the RFC examples', () => {
    expect(hex(huffmanEncode(enc.encode('www.example.com')))).toBe('f1e3c2e5f23a6ba0ab90f4ff');
    expect(hex(huffmanEncode(enc.encode('no-cache')))).toBe('a8eb10649cbf');
    expect(hex(huffmanEncode(enc.encode('Mon, 21 Oct 2013 20:13:21 GMT')))).toBe('d07abe941054d444a8200595040b8166e082a62d1bff');
  });

  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(huffmanDecode(huffmanEncode(all)))).toEqual(Array.from(all));
    for (let i = 0; i < 256; i++) {
      const one = Uint8Array.of(i, 255 - i, i);
      expect(Array.from(huffmanDecode(huffmanEncode(one)))).toEqual(Array.from(one));
    }
  });

  it('rejects bad padding and EOS', () => {
    // 'a' = 00011 (5 bits); padding with zeros is invalid
    expect(() => huffmanDecode(Uint8Array.of(0b00011000))).toThrow(HpackError);
    // a full byte of padding (8 ones after a complete symbol) is too long
    expect(() => huffmanDecode(Uint8Array.of(0b00011111, 0xff))).toThrow(HpackError);
    // EOS (30 ones) inside the string
    expect(() => huffmanDecode(Uint8Array.of(0xff, 0xff, 0xff, 0xfc))).toThrow(HpackError);
    expect(Array.from(huffmanDecode(Uint8Array.of(0b00011111)))).toEqual([0x61]);
  });
});

describe('HPACK request examples (RFC 7541 C.3 without, C.4 with Huffman)', () => {
  const C3 = [
    '828684410f7777772e6578616d706c652e636f6d',
    '828684be58086e6f2d6361636865',
    '828785bf400a637573746f6d2d6b65790c637573746f6d2d76616c7565',
  ];
  const C4 = [
    '828684418cf1e3c2e5f23a6ba0ab90f4ff',
    '828684be5886a8eb10649cbf',
    '828785bf408825a849e95ba97d7f8925a849e95bb8e8b4bf',
  ];

  it('encoder output is byte-identical (C.3)', () => {
    const e = new HpackEncoder({ huffman: false });
    REQUESTS.forEach((h, i) => expect(hex(e.encode(h))).toBe(C3[i]));
    expect(e.table.size).toBe(164);
  });

  it('encoder output is byte-identical (C.4)', () => {
    const e = new HpackEncoder({ huffman: true });
    REQUESTS.forEach((h, i) => expect(hex(e.encode(h))).toBe(C4[i]));
  });

  it('decoder reproduces the header lists and table state', () => {
    for (const blocks of [C3, C4]) {
      const d = new HpackDecoder();
      blocks.forEach((b, i) => expect(d.decode(unhex(b))).toEqual(REQUESTS[i]));
      expect(d.table.size).toBe(164);
      expect(d.table.entries.map(e => e[0])).toEqual(['custom-key', 'cache-control', ':authority']);
    }
  });
});

describe('HPACK dynamic table behaviour', () => {
  it('evicts oldest entries when the table is full', () => {
    const e = new HpackEncoder({ maxTableSize: 100 });
    const d = new HpackDecoder({ maxTableSize: 100 });
    const lists = /** @type {Array<Array<[string, string]>>} */ ([
      [['x-a', 'one']], [['x-b', 'two']], [['x-c', 'three']], [['x-a', 'one']],
    ]);
    for (const h of lists) expect(d.decode(e.encode(h))).toEqual(h);
    expect(d.table.size).toBeLessThanOrEqual(100);
    expect(d.table.entries).toEqual(e.table.entries);
  });

  it('table size update is announced and applied', () => {
    const e = new HpackEncoder();
    const d = new HpackDecoder();
    d.decode(e.encode([['x-big', 'v'.repeat(100)]]));
    e.setMaxTableSize(0);
    const block = e.encode([[':method', 'GET']]);
    expect(block[0]).toBe(0x20);   // size update to 0 comes first
    d.decode(block);
    expect(d.table.entries.length).toBe(0);
  });

  it('rejects a size update after header fields and above the limit', () => {
    const d = new HpackDecoder({ maxTableSize: 100 });
    expect(() => d.decode(Uint8Array.of(0x82, 0x20))).toThrow(HpackError);
    expect(() => new HpackDecoder({ maxTableSize: 100 }).decode(Uint8Array.of(0x3f, 0xe1, 0x1f))).toThrow(HpackError);
  });

  it('rejects index 0, unknown indices and truncation', () => {
    expect(() => new HpackDecoder().decode(Uint8Array.of(0x80))).toThrow(HpackError);
    expect(() => new HpackDecoder().decode(Uint8Array.of(0xbe))).toThrow(HpackError); // 62: empty dynamic table
    expect(() => new HpackDecoder().decode(Uint8Array.of(0x40, 0x05, 0x61))).toThrow(HpackError);
  });

  it('never indexes sensitive fields', () => {
    const e = new HpackEncoder();
    const block = e.encode([['authorization', 'Basic abc']]);
    expect(block[0] & 0xf0).toBe(0x10);
    expect(e.table.entries.length).toBe(0);
    expect(new HpackDecoder().decode(block)).toEqual([['authorization', 'Basic abc']]);
  });

  it('handles UTF-8 values and large integers', () => {
    const e = new HpackEncoder();
    const h = /** @type {Array<[string, string]>} */ ([['x-text', 'Grüße ✓'], ['x-long', 'z'.repeat(5000)]]);
    expect(new HpackDecoder().decode(e.encode(h))).toEqual(h);
  });
});
