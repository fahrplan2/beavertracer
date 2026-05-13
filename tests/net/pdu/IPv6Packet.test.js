import { describe, it, expect } from 'vitest';
import { IPv6Packet } from '../../../src/net/pdu/IPv6Packet.js';
import { IPAddress } from '../../../src/net/models/IPAddress.js';

const SRC = IPAddress.fromString('2001:db8::1');
const DST = IPAddress.fromString('2001:db8::2');

describe('IPv6Packet constructor defaults', () => {
  it('defaults to version=6, hopLimit=64, nextHeader=59', () => {
    const pkt = new IPv6Packet();
    expect(pkt.version).toBe(6);
    expect(pkt.hopLimit).toBe(64);
    expect(pkt.nextHeader).toBe(59);
    expect(pkt.trafficClass).toBe(0);
    expect(pkt.flowLabel).toBe(0);
  });

  it('defaults src and dst to ::', () => {
    const pkt = new IPv6Packet();
    expect(pkt.src.toString()).toBe('::');
    expect(pkt.dst.toString()).toBe('::');
  });

  it('stores empty payload as Uint8Array', () => {
    const pkt = new IPv6Packet();
    expect(pkt.payload).toBeInstanceOf(Uint8Array);
    expect(pkt.payload.length).toBe(0);
  });
});

describe('IPv6Packet.pack()', () => {
  it('produces exactly 40 bytes for empty payload', () => {
    expect(new IPv6Packet({ src: SRC, dst: DST }).pack().length).toBe(40);
  });

  it('auto-sets payloadLength from payload.length', () => {
    const pkt = new IPv6Packet({ src: SRC, dst: DST, payload: new Uint8Array(16) });
    const bytes = pkt.pack();
    expect(pkt.payloadLength).toBe(16);
    expect((bytes[4] << 8) | bytes[5]).toBe(16);
  });

  it('encodes version=6 in high nibble of byte 0', () => {
    const bytes = new IPv6Packet({ src: SRC, dst: DST }).pack();
    expect((bytes[0] >> 4) & 0x0f).toBe(6);
  });

  it('encodes flowLabel across bytes 1-3', () => {
    const pkt = new IPv6Packet({ src: SRC, dst: DST, flowLabel: 0xabcde });
    const bytes = pkt.pack();
    const fl = ((bytes[1] & 0x0f) << 16) | (bytes[2] << 8) | bytes[3];
    expect(fl).toBe(0xabcde);
  });

  it('masks flowLabel to 20 bits on construction', () => {
    const pkt = new IPv6Packet({ src: SRC, dst: DST, flowLabel: 0x100000 });
    expect(pkt.flowLabel).toBe(0);
  });

  it('writes src into bytes 8-23 and dst into bytes 24-39', () => {
    const bytes = new IPv6Packet({ src: SRC, dst: DST }).pack();
    expect(Array.from(bytes.slice(8, 24))).toEqual(Array.from(SRC.toUInt8()));
    expect(Array.from(bytes.slice(24, 40))).toEqual(Array.from(DST.toUInt8()));
  });

  it('appends payload after the 40-byte header', () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const bytes = new IPv6Packet({ src: SRC, dst: DST, payload }).pack();
    expect(bytes.length).toBe(44);
    expect(Array.from(bytes.slice(40))).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});

describe('IPv6Packet.fromBytes()', () => {
  it('throws for buffer shorter than 40 bytes', () => {
    expect(() => IPv6Packet.fromBytes(new Uint8Array(39))).toThrow();
  });

  it('throws if version field is not 6', () => {
    const buf = new Uint8Array(40);
    buf[0] = 0x40; // version=4
    expect(() => IPv6Packet.fromBytes(buf)).toThrow();
  });

  it('round-trips all header fields', () => {
    const original = new IPv6Packet({
      src: SRC,
      dst: DST,
      hopLimit: 128,
      nextHeader: 58,
      flowLabel: 0x12345,
      trafficClass: 0x20,
      payload: new Uint8Array([1, 2, 3]),
    });
    const parsed = IPv6Packet.fromBytes(original.pack());

    expect(parsed.version).toBe(6);
    expect(parsed.hopLimit).toBe(128);
    expect(parsed.nextHeader).toBe(58);
    expect(parsed.flowLabel).toBe(0x12345);
    expect(parsed.trafficClass).toBe(0x20);
    expect(parsed.src.toString()).toBe(SRC.toString());
    expect(parsed.dst.toString()).toBe(DST.toString());
    expect(Array.from(parsed.payload)).toEqual([1, 2, 3]);
  });
});
