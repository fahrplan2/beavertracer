import { describe, it, expect } from 'vitest';
import { UDPPacket } from '../../../src/net/pdu/UDPPacket.js';

const SRC4 = new Uint8Array([10, 0, 0, 1]);
const DST4 = new Uint8Array([10, 0, 0, 2]);
const SRC6 = new Uint8Array(16); SRC6[15] = 1; // ::1
const DST6 = new Uint8Array(16); DST6[15] = 2; // ::2

describe('UDPPacket constructor defaults', () => {
  it('defaults to zero ports, zero checksum, empty payload', () => {
    const pkt = new UDPPacket();
    expect(pkt.srcPort).toBe(0);
    expect(pkt.dstPort).toBe(0);
    expect(pkt.checksum).toBe(0);
    expect(pkt.payload).toBeInstanceOf(Uint8Array);
    expect(pkt.payload.length).toBe(0);
  });
});

describe('UDPPacket.pack()', () => {
  it('produces 8 bytes for empty payload', () => {
    expect(new UDPPacket().pack().length).toBe(8);
  });

  it('sets length field to 8 + payload.length', () => {
    const pkt = new UDPPacket({ payload: new Uint8Array(4) });
    pkt.pack();
    expect(pkt.length).toBe(12);
  });

  it('writes length into bytes 4-5', () => {
    const pkt = new UDPPacket({ srcPort: 1234, dstPort: 53, payload: new Uint8Array(4) });
    const bytes = pkt.pack();
    expect((bytes[4] << 8) | bytes[5]).toBe(12);
  });

  it('leaves checksum=0 without IP addresses (valid in IPv4)', () => {
    const bytes = new UDPPacket({ srcPort: 1234, dstPort: 53 }).pack();
    expect((bytes[6] << 8) | bytes[7]).toBe(0);
  });

  it('computes a non-zero checksum with IPv4 addresses', () => {
    const pkt = new UDPPacket({
      srcPort: 12345, dstPort: 53,
      payload: new Uint8Array([0x01, 0x02]),
    });
    const bytes = pkt.pack({ srcIp: SRC4, dstIp: DST4 });
    expect((bytes[6] << 8) | bytes[7]).not.toBe(0);
  });

  it('checksum passes self-verification (IPv4 pseudo-header)', () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const pkt = new UDPPacket({ srcPort: 5000, dstPort: 5001, payload });
    const bytes = pkt.pack({ srcIp: SRC4, dstIp: DST4 });
    const checksum = (bytes[6] << 8) | bytes[7];

    const forVerify = new Uint8Array(bytes);
    forVerify[6] = 0;
    forVerify[7] = 0;
    expect(UDPPacket.computeChecksumIPv4Pseudo(forVerify, SRC4, DST4)).toBe(checksum);
  });

  it('computes checksum with IPv6 addresses', () => {
    const pkt = new UDPPacket({ srcPort: 5000, dstPort: 5001, payload: new Uint8Array([1]) });
    const bytes = pkt.pack({ srcIp: SRC6, dstIp: DST6 });
    const checksum = (bytes[6] << 8) | bytes[7];
    expect(checksum).not.toBe(0);

    const forVerify = new Uint8Array(bytes);
    forVerify[6] = 0;
    forVerify[7] = 0;
    expect(UDPPacket.computeChecksumIPv6Pseudo(forVerify, SRC6, DST6)).toBe(checksum);
  });
});

describe('UDPPacket.fromBytes()', () => {
  it('throws for buffer shorter than 8 bytes', () => {
    expect(() => UDPPacket.fromBytes(new Uint8Array(7))).toThrow();
  });

  it('throws when length field claims more bytes than available', () => {
    const buf = new Uint8Array([0x00, 0x50, 0x00, 0x35, 0x00, 0x10, 0x00, 0x00]);
    // length=16 but only 8 bytes in buf
    expect(() => UDPPacket.fromBytes(buf)).toThrow();
  });

  it('round-trips all fields', () => {
    const payload = new Uint8Array([10, 20, 30, 40]);
    const original = new UDPPacket({ srcPort: 1234, dstPort: 53, payload });
    const bytes = original.pack({ srcIp: SRC4, dstIp: DST4 });
    const parsed = UDPPacket.fromBytes(bytes);

    expect(parsed.srcPort).toBe(1234);
    expect(parsed.dstPort).toBe(53);
    expect(parsed.length).toBe(12);
    expect(Array.from(parsed.payload)).toEqual([10, 20, 30, 40]);
  });
});
