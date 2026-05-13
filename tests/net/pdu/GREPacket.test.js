import { describe, it, expect } from 'vitest';
import { GREPacket } from '../../../src/net/pdu/GREPacket.js';

describe('GREPacket constructor', () => {
  it('defaults to IPv4 protocol and empty payload', () => {
    const pkt = new GREPacket();
    expect(pkt.protocol).toBe(0x0800);
    expect(pkt.payload).toBeInstanceOf(Uint8Array);
    expect(pkt.payload.length).toBe(0);
  });

  it('accepts custom protocol and payload', () => {
    const payload = new Uint8Array([1, 2, 3]);
    const pkt = new GREPacket({ protocol: 0x86dd, payload });
    expect(pkt.protocol).toBe(0x86dd);
    expect(Array.from(pkt.payload)).toEqual([1, 2, 3]);
  });
});

describe('GREPacket.pack()', () => {
  it('produces a 4-byte header for empty payload', () => {
    const pkt = new GREPacket();
    const out = pkt.pack();
    expect(out.length).toBe(4);
  });

  it('writes zero flags/version word and protocol in header', () => {
    const pkt = new GREPacket({ protocol: 0x0800 });
    const out = pkt.pack();
    expect(out[0]).toBe(0x00); // flags high byte
    expect(out[1]).toBe(0x00); // flags low byte
    expect(out[2]).toBe(0x08); // protocol high byte
    expect(out[3]).toBe(0x00); // protocol low byte
  });

  it('appends payload after the 4-byte header', () => {
    const payload = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const pkt = new GREPacket({ payload });
    const out = pkt.pack();
    expect(out.length).toBe(7);
    expect(Array.from(out.slice(4))).toEqual([0xaa, 0xbb, 0xcc]);
  });
});

describe('GREPacket.fromBytes()', () => {
  it('round-trips through pack()', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const original = new GREPacket({ protocol: 0x86dd, payload });
    const parsed = GREPacket.fromBytes(original.pack());
    expect(parsed.protocol).toBe(0x86dd);
    expect(Array.from(parsed.payload)).toEqual([10, 20, 30]);
  });

  it('throws on buffer shorter than 4 bytes', () => {
    expect(() => GREPacket.fromBytes(new Uint8Array([0x00, 0x00, 0x08]))).toThrow();
  });

  it('skips optional checksum field when bit 15 of flags is set', () => {
    // flags = 0x8000 → 4 extra bytes (checksum + reserved) → payload starts at byte 8
    const buf = new Uint8Array([0x80, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0xaa]);
    const pkt = GREPacket.fromBytes(buf);
    expect(pkt.protocol).toBe(0x0800);
    expect(Array.from(pkt.payload)).toEqual([0xaa]);
  });
});
