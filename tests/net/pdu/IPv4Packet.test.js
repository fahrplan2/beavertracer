import { describe, it, expect } from 'vitest';
import { IPv4Packet } from '../../../src/net/pdu/IPv4Packet.js';
import { IPAddress } from '../../../src/net/models/IPAddress.js';

const SRC = IPAddress.fromString('192.168.1.1');
const DST = IPAddress.fromString('10.0.0.2');

describe('IPv4Packet constructor defaults', () => {
  it('sets version=4, ihl=5, ttl=64, protocol=0', () => {
    const pkt = new IPv4Packet({ identification: 0 });
    expect(pkt.version).toBe(4);
    expect(pkt.ihl).toBe(5);
    expect(pkt.ttl).toBe(64);
    expect(pkt.protocol).toBe(0);
  });

  it('uses 0.0.0.0 as default src and dst', () => {
    const pkt = new IPv4Packet({ identification: 0 });
    expect(pkt.src.toString()).toBe('0.0.0.0');
    expect(pkt.dst.toString()).toBe('0.0.0.0');
  });
});

describe('IPv4Packet bitmask behaviour', () => {
  it('masks dscp to 6 bits', () => {
    // 0xff & 0x3f = 0x3f = 63
    const pkt = new IPv4Packet({ identification: 0, dscp: 0xff });
    expect(pkt.dscp).toBe(63);
  });

  it('masks ecn to 2 bits', () => {
    const pkt = new IPv4Packet({ identification: 0, ecn: 0xff });
    expect(pkt.ecn).toBe(3);
  });

  it('masks ttl to 8 bits', () => {
    const pkt = new IPv4Packet({ identification: 0, ttl: 0x1ff });
    expect(pkt.ttl).toBe(0xff);
  });
});

describe('IPv4Packet.pack()', () => {
  it('produces exactly 20 bytes for a header-only packet', () => {
    const pkt = new IPv4Packet({ identification: 0, src: SRC, dst: DST });
    expect(pkt.pack().length).toBe(20);
  });

  it('sets totalLength to 20 + payload.length', () => {
    const payload = new Uint8Array(8);
    const pkt = new IPv4Packet({ identification: 0, src: SRC, dst: DST, payload });
    pkt.pack();
    expect(pkt.totalLength).toBe(28);
  });

  it('writes src and dst addresses into bytes 12–19', () => {
    const pkt = new IPv4Packet({ identification: 0, src: SRC, dst: DST });
    const bytes = pkt.pack();
    expect(Array.from(bytes.slice(12, 16))).toEqual([192, 168, 1, 1]);
    expect(Array.from(bytes.slice(16, 20))).toEqual([10, 0, 0, 2]);
  });

  it('computes a non-zero header checksum', () => {
    const pkt = new IPv4Packet({ identification: 0, src: SRC, dst: DST });
    const bytes = pkt.pack();
    const checksum = (bytes[10] << 8) | bytes[11];
    expect(checksum).not.toBe(0);
  });
});

describe('IPv4Packet.fromBytes() round-trip', () => {
  it('restores all header fields after pack/parse', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const original = new IPv4Packet({
      identification: 0x1234,
      ttl: 128,
      protocol: 6,
      src: SRC,
      dst: DST,
      payload,
    });
    const parsed = IPv4Packet.fromBytes(original.pack());
    expect(parsed.version).toBe(4);
    expect(parsed.identification).toBe(0x1234);
    expect(parsed.ttl).toBe(128);
    expect(parsed.protocol).toBe(6);
    expect(parsed.src.toString()).toBe('192.168.1.1');
    expect(parsed.dst.toString()).toBe('10.0.0.2');
    expect(Array.from(parsed.payload)).toEqual([1, 2, 3, 4]);
  });

  it('throws for buffers shorter than 20 bytes', () => {
    expect(() => IPv4Packet.fromBytes(new Uint8Array(19))).toThrow();
  });
});
