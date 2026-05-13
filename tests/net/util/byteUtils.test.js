import { describe, it, expect } from 'vitest';
import { read16BE, read32BE, write16BE, write32BE } from '../../../src/net/util/byteUtils.js';

describe('read16BE', () => {
  it('reads two bytes as big-endian uint16', () => {
    const buf = new Uint8Array([0x08, 0x00, 0xff, 0x00]);
    expect(read16BE(buf, 0)).toBe(0x0800);
    expect(read16BE(buf, 2)).toBe(0xff00);
  });

  it('reads 0xffff correctly', () => {
    const buf = new Uint8Array([0xff, 0xff]);
    expect(read16BE(buf, 0)).toBe(0xffff);
  });
});

describe('write16BE', () => {
  it('writes uint16 as two big-endian bytes', () => {
    const buf = new Uint8Array(4);
    write16BE(buf, 0, 0x0800);
    write16BE(buf, 2, 0xff00);
    expect(Array.from(buf)).toEqual([0x08, 0x00, 0xff, 0x00]);
  });

  it('masks to 16 bits', () => {
    const buf = new Uint8Array(2);
    write16BE(buf, 0, 0x1abcd);
    expect(read16BE(buf, 0)).toBe(0xabcd);
  });
});

describe('read32BE', () => {
  it('reads four bytes as big-endian uint32', () => {
    const buf = new Uint8Array([0xc0, 0xa8, 0x01, 0x01]);
    expect(read32BE(buf, 0)).toBe(0xc0a80101);
  });

  it('handles 0xffffffff without sign extension', () => {
    const buf = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    expect(read32BE(buf, 0)).toBe(0xffffffff);
  });
});

describe('write32BE', () => {
  it('writes uint32 as four big-endian bytes', () => {
    const buf = new Uint8Array(4);
    write32BE(buf, 0, 0xc0a80101);
    expect(Array.from(buf)).toEqual([0xc0, 0xa8, 0x01, 0x01]);
  });

  it('round-trips with read32BE', () => {
    const buf = new Uint8Array(4);
    write32BE(buf, 0, 0xdeadbeef);
    expect(read32BE(buf, 0)).toBe(0xdeadbeef);
  });
});
