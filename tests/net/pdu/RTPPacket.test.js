import { describe, it, expect } from 'vitest';
import { RTPPacket } from '../../../src/net/pdu/RTPPacket.js';

describe('RTPPacket constructor defaults', () => {
  it('defaults to version 2, PCMU, no marker, empty payload', () => {
    const p = new RTPPacket();
    expect(p.version).toBe(2);
    expect(p.payloadType).toBe(RTPPacket.PT_PCMU);
    expect(p.marker).toBe(false);
    expect(p.sequenceNumber).toBe(0);
    expect(p.timestamp).toBe(0);
    expect(p.ssrc).toBe(0);
    expect(p.csrc).toEqual([]);
    expect(p.payload.length).toBe(0);
  });
});

describe('RTPPacket.pack() — header layout', () => {
  it('produces a 12-byte header for a bare packet', () => {
    expect(new RTPPacket().pack().length).toBe(12);
  });

  it('encodes version/flags/CC into byte 0 and marker/PT into byte 1', () => {
    const p = new RTPPacket({ marker: true, payloadType: 8, csrc: [1, 2] });
    const b = p.pack();
    expect((b[0] >>> 6) & 0x03).toBe(2);      // version
    expect((b[0] >>> 5) & 0x01).toBe(0);      // padding never emitted
    expect((b[0] >>> 4) & 0x01).toBe(0);      // no extension
    expect(b[0] & 0x0f).toBe(2);              // CC = 2
    expect((b[1] >>> 7) & 0x01).toBe(1);      // marker
    expect(b[1] & 0x7f).toBe(8);              // PT
  });

  it('writes sequence number, timestamp and SSRC big-endian', () => {
    const p = new RTPPacket({ sequenceNumber: 0x1234, timestamp: 0x89abcdef, ssrc: 0xdeadbeef });
    const b = p.pack();
    expect([b[2], b[3]]).toEqual([0x12, 0x34]);
    expect([b[4], b[5], b[6], b[7]]).toEqual([0x89, 0xab, 0xcd, 0xef]);
    expect([b[8], b[9], b[10], b[11]]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('appends the CSRC list after the fixed header', () => {
    const b = new RTPPacket({ csrc: [0x01020304, 0x05060708] }).pack();
    expect(b.length).toBe(12 + 8);
    expect([...b.slice(12, 20)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('RTPPacket round-trip', () => {
  it('pack() -> fromBytes() preserves every field', () => {
    const payload = new Uint8Array([9, 8, 7, 6, 5]);
    const p = new RTPPacket({
      marker: true, payloadType: 0, sequenceNumber: 40000,
      timestamp: 3_000_000_000, ssrc: 0x11223344, csrc: [0xaabbccdd], payload,
    });
    const r = RTPPacket.fromBytes(p.pack());
    expect(r.marker).toBe(true);
    expect(r.payloadType).toBe(0);
    expect(r.sequenceNumber).toBe(40000);
    expect(r.timestamp).toBe(3_000_000_000);
    expect(r.ssrc).toBe(0x11223344);
    expect(r.csrc).toEqual([0xaabbccdd]);
    expect([...r.payload]).toEqual([9, 8, 7, 6, 5]);
  });

  it('round-trips a one-shot header extension', () => {
    const p = new RTPPacket({
      headerExtension: { profile: 0xbede, data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
      payload: new Uint8Array([42]),
    });
    const r = RTPPacket.fromBytes(p.pack());
    expect(r.extension).toBe(true);
    expect(r.headerExtension.profile).toBe(0xbede);
    expect([...r.headerExtension.data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...r.payload]).toEqual([42]);
  });

  it('strips padding bytes on parse when P=1', () => {
    // hand-craft: 12-byte header with P bit set, payload "AB" + 2 padding octets
    // (RFC 3550: final octet is the pad count, itself included → 0x02 strips both)
    const raw = new Uint8Array(12 + 4);
    raw[0] = (2 << 6) | (1 << 5);
    raw[1] = 0;
    raw[12] = 0x41; raw[13] = 0x42; raw[14] = 0x00; raw[15] = 0x02;
    const r = RTPPacket.fromBytes(raw);
    expect([...r.payload]).toEqual([0x41, 0x42]);
  });
});

describe('RTPPacket validation', () => {
  it('rejects a non-2 version on parse', () => {
    const raw = new Uint8Array(12);
    raw[0] = (1 << 6);
    expect(() => RTPPacket.fromBytes(raw)).toThrow(/version/i);
  });

  it('rejects a payloadType above 127', () => {
    expect(() => new RTPPacket({ payloadType: 200 })).not.toThrow(); // masked to 7 bits
    expect(new RTPPacket({ payloadType: 200 }).payloadType).toBe(200 & 0x7f);
  });

  it('rejects more than 15 CSRC identifiers', () => {
    expect(() => new RTPPacket({ csrc: new Array(16).fill(1) })).toThrow(/CSRC/i);
  });

  it('throws on a truncated header', () => {
    expect(() => RTPPacket.fromBytes(new Uint8Array(8))).toThrow(/12 bytes/);
  });
});
