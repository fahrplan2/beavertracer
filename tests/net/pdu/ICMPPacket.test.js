import { describe, it, expect } from 'vitest';
import { ICMPPacket } from '../../../src/net/pdu/ICMPPacket.js';

describe('ICMPPacket constructor defaults', () => {
  it('defaults to Echo Request (type=8, code=0)', () => {
    const pkt = new ICMPPacket();
    expect(pkt.type).toBe(8);
    expect(pkt.code).toBe(0);
    expect(pkt.checksum).toBe(0);
    expect(pkt.identifier).toBe(0);
    expect(pkt.sequence).toBe(0);
  });

  it('stores empty payload as Uint8Array', () => {
    expect(new ICMPPacket().payload).toBeInstanceOf(Uint8Array);
    expect(new ICMPPacket().payload.length).toBe(0);
  });
});

describe('ICMPPacket.pack()', () => {
  it('produces exactly 8 bytes for empty payload', () => {
    expect(new ICMPPacket().pack().length).toBe(8);
  });

  it('writes type into byte 0 and code into byte 1', () => {
    const bytes = new ICMPPacket({ type: 0, code: 0 }).pack(); // Echo Reply
    expect(bytes[0]).toBe(0);
    expect(bytes[1]).toBe(0);
  });

  it('writes identifier and sequence into bytes 4-7', () => {
    const pkt = new ICMPPacket({ identifier: 0x1234, sequence: 0x0005 });
    const bytes = pkt.pack();
    expect((bytes[4] << 8) | bytes[5]).toBe(0x1234);
    expect((bytes[6] << 8) | bytes[7]).toBe(0x0005);
  });

  it('auto-computes checksum 0xf7ff for default Echo Request (known value)', () => {
    // type=8, code=0, cs=0, id=0, seq=0, no payload
    // sum = 0x0800; ~0x0800 & 0xffff = 0xf7ff
    const bytes = new ICMPPacket().pack();
    expect(bytes[2]).toBe(0xf7);
    expect(bytes[3]).toBe(0xff);
  });

  it('verifier property: computing checksum over packed packet gives 0', () => {
    // After pack(), the checksum field is set correctly.
    // Re-running the checksum over the whole packet (including the checksum field) gives 0.
    const bytes = new ICMPPacket({ identifier: 7, sequence: 42 }).pack();
    expect(ICMPPacket.computeChecksum(bytes)).toBe(0);
  });

  it('preserves a manually provided checksum', () => {
    const pkt = new ICMPPacket({ checksum: 0xabcd });
    const bytes = pkt.pack();
    expect((bytes[2] << 8) | bytes[3]).toBe(0xabcd);
  });

  it('appends payload after the 8-byte header', () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const bytes = new ICMPPacket({ payload }).pack();
    expect(bytes.length).toBe(12);
    expect(Array.from(bytes.slice(8))).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});

describe('ICMPPacket.fromBytes()', () => {
  it('throws for buffer shorter than 4 bytes', () => {
    expect(() => ICMPPacket.fromBytes(new Uint8Array(3))).toThrow();
  });

  it('round-trips Echo Request fields', () => {
    const original = new ICMPPacket({
      type: 8, code: 0,
      identifier: 0x0042, sequence: 0x0007,
      payload: new Uint8Array([1, 2, 3]),
    });
    const parsed = ICMPPacket.fromBytes(original.pack());

    expect(parsed.type).toBe(8);
    expect(parsed.code).toBe(0);
    expect(parsed.identifier).toBe(0x0042);
    expect(parsed.sequence).toBe(0x0007);
    expect(Array.from(parsed.payload)).toEqual([1, 2, 3]);
  });

  it('round-trips Echo Reply (type=0)', () => {
    const pkt = new ICMPPacket({ type: 0, identifier: 1, sequence: 1 });
    const parsed = ICMPPacket.fromBytes(pkt.pack());
    expect(parsed.type).toBe(0);
    expect(parsed.identifier).toBe(1);
  });

  it('handles minimal 4-byte packet (no identifier/sequence)', () => {
    // 4 bytes: type, code, checksum only — id and seq default to 0
    const buf = new Uint8Array([0x03, 0x01, 0x00, 0x00]); // Dest Unreachable, Host
    const pkt = ICMPPacket.fromBytes(buf);
    expect(pkt.type).toBe(3);
    expect(pkt.code).toBe(1);
    expect(pkt.identifier).toBe(0);
    expect(pkt.sequence).toBe(0);
  });

  it('preserves the parsed checksum (no recompute on parse)', () => {
    const original = new ICMPPacket({ identifier: 5, sequence: 10 });
    const bytes = original.pack();
    const expectedChecksum = (bytes[2] << 8) | bytes[3];
    const parsed = ICMPPacket.fromBytes(bytes);
    expect(parsed.checksum).toBe(expectedChecksum);
  });
});
