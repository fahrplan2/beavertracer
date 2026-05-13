import { describe, it, expect } from 'vitest';
import { TCPPacket } from '../../../src/net/pdu/TCPPacket.js';

const SRC = new Uint8Array([10, 0, 0, 1]);
const DST = new Uint8Array([10, 0, 0, 2]);

describe('TCPPacket constructor defaults', () => {
  it('defaults to all-zero ports, seq, ack, flags; window=65535', () => {
    const pkt = new TCPPacket();
    expect(pkt.srcPort).toBe(0);
    expect(pkt.dstPort).toBe(0);
    expect(pkt.seq).toBe(0);
    expect(pkt.ack).toBe(0);
    expect(pkt.flags).toBe(0);
    expect(pkt.window).toBe(65535);
    expect(pkt.checksum).toBe(0);
    expect(pkt.urgentPointer).toBe(0);
  });

  it('stores empty options and payload as Uint8Array', () => {
    const pkt = new TCPPacket();
    expect(pkt.options).toBeInstanceOf(Uint8Array);
    expect(pkt.payload).toBeInstanceOf(Uint8Array);
    expect(pkt.options.length).toBe(0);
    expect(pkt.payload.length).toBe(0);
  });
});

describe('TCPPacket flag constants', () => {
  it('defines all eight flag bits correctly', () => {
    expect(TCPPacket.FLAG_FIN).toBe(0x01);
    expect(TCPPacket.FLAG_SYN).toBe(0x02);
    expect(TCPPacket.FLAG_RST).toBe(0x04);
    expect(TCPPacket.FLAG_PSH).toBe(0x08);
    expect(TCPPacket.FLAG_ACK).toBe(0x10);
    expect(TCPPacket.FLAG_URG).toBe(0x20);
    expect(TCPPacket.FLAG_ECE).toBe(0x40);
    expect(TCPPacket.FLAG_CWR).toBe(0x80);
  });
});

describe('TCPPacket.hasFlag()', () => {
  it('detects a single set flag', () => {
    const pkt = new TCPPacket({ flags: TCPPacket.FLAG_SYN });
    expect(pkt.hasFlag(TCPPacket.FLAG_SYN)).toBe(true);
  });

  it('returns false for a flag that is not set', () => {
    const pkt = new TCPPacket({ flags: TCPPacket.FLAG_SYN });
    expect(pkt.hasFlag(TCPPacket.FLAG_ACK)).toBe(false);
  });

  it('correctly handles combined flags (SYN+ACK)', () => {
    const pkt = new TCPPacket({ flags: TCPPacket.FLAG_SYN | TCPPacket.FLAG_ACK });
    expect(pkt.hasFlag(TCPPacket.FLAG_SYN)).toBe(true);
    expect(pkt.hasFlag(TCPPacket.FLAG_ACK)).toBe(true);
    expect(pkt.hasFlag(TCPPacket.FLAG_RST)).toBe(false);
  });
});

describe('TCPPacket.pack()', () => {
  it('produces 20 bytes for empty options and payload', () => {
    expect(new TCPPacket().pack().length).toBe(20);
  });

  it('sets dataOffset to 5 (=20 bytes header) after pack', () => {
    const pkt = new TCPPacket();
    pkt.pack();
    expect(pkt.dataOffset).toBe(5);
  });

  it('writes srcPort and dstPort into bytes 0-3', () => {
    const pkt = new TCPPacket({ srcPort: 0x3039, dstPort: 0x0050 });
    const bytes = pkt.pack();
    expect(bytes[0]).toBe(0x30);
    expect(bytes[1]).toBe(0x39);
    expect(bytes[2]).toBe(0x00);
    expect(bytes[3]).toBe(0x50);
  });

  it('writes seq into bytes 4-7 big-endian', () => {
    const pkt = new TCPPacket({ seq: 0xdeadbeef });
    const bytes = pkt.pack();
    expect(Array.from(bytes.slice(4, 8))).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('writes flags into byte 13', () => {
    const pkt = new TCPPacket({ flags: TCPPacket.FLAG_SYN | TCPPacket.FLAG_ACK });
    expect(pkt.pack()[13]).toBe(0x12);
  });

  it('leaves checksum=0 when no IP addresses are provided', () => {
    const bytes = new TCPPacket({ srcPort: 80 }).pack();
    expect((bytes[16] << 8) | bytes[17]).toBe(0);
  });

  it('computes a non-zero checksum when IPs are provided', () => {
    const pkt = new TCPPacket({ srcPort: 12345, dstPort: 80, flags: TCPPacket.FLAG_SYN });
    const bytes = pkt.pack({ srcIp: SRC, dstIp: DST });
    expect((bytes[16] << 8) | bytes[17]).not.toBe(0);
  });

  it('checksum passes self-verification (pseudo-header integrity)', () => {
    const pkt = new TCPPacket({
      srcPort: 12345, dstPort: 80,
      seq: 1000, flags: TCPPacket.FLAG_SYN,
    });
    const bytes = pkt.pack({ srcIp: SRC, dstIp: DST });
    const checksum = (bytes[16] << 8) | bytes[17];

    const forVerify = new Uint8Array(bytes);
    forVerify[16] = 0;
    forVerify[17] = 0;
    expect(TCPPacket.computeChecksumIPv4Pseudo(forVerify, SRC, DST)).toBe(checksum);
  });

  it('total length grows by payload size', () => {
    const payload = new Uint8Array(100);
    const pkt = new TCPPacket({ payload });
    expect(pkt.pack().length).toBe(120);
  });
});

describe('TCPPacket.fromBytes()', () => {
  it('throws for non-Uint8Array', () => {
    // @ts-ignore
    expect(() => TCPPacket.fromBytes('bad')).toThrow();
  });

  it('throws for buffer shorter than 20 bytes', () => {
    expect(() => TCPPacket.fromBytes(new Uint8Array(19))).toThrow();
  });

  it('round-trips all header fields', () => {
    const payload = new Uint8Array([1, 2, 3]);
    const original = new TCPPacket({
      srcPort: 54321,
      dstPort: 443,
      seq: 0xaabbccdd,
      ack: 0x11223344,
      flags: TCPPacket.FLAG_ACK | TCPPacket.FLAG_PSH,
      window: 8192,
      urgentPointer: 0,
      payload,
    });
    const bytes = original.pack({ srcIp: SRC, dstIp: DST });
    const parsed = TCPPacket.fromBytes(bytes);

    expect(parsed.srcPort).toBe(54321);
    expect(parsed.dstPort).toBe(443);
    expect(parsed.seq).toBe(0xaabbccdd);
    expect(parsed.ack).toBe(0x11223344);
    expect(parsed.hasFlag(TCPPacket.FLAG_ACK)).toBe(true);
    expect(parsed.hasFlag(TCPPacket.FLAG_PSH)).toBe(true);
    expect(parsed.hasFlag(TCPPacket.FLAG_SYN)).toBe(false);
    expect(parsed.window).toBe(8192);
    expect(Array.from(parsed.payload)).toEqual([1, 2, 3]);
  });
});
