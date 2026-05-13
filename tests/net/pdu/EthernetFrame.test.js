import { describe, it, expect } from 'vitest';
import { EthernetFrame } from '../../../src/net/pdu/EthernetFrame.js';

const MAC_A = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
const MAC_B = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
const BCAST = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

describe('EthernetFrame constructor defaults', () => {
  it('defaults to zero MACs and etherType=0', () => {
    const f = new EthernetFrame();
    expect(Array.from(f.dstMac)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(f.srcMac)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(f.etherType).toBe(0);
  });
});

describe('EthernetFrame.pack() — Ethernet II', () => {
  it('produces a 60-byte frame for short payload (14 header + 46 padded)', () => {
    const f = new EthernetFrame({ dstMac: BCAST, srcMac: MAC_A, etherType: 0x0800 });
    expect(f.pack().length).toBe(60);
  });

  it('does not pad payload that is already 46 bytes or more', () => {
    const payload = new Uint8Array(46);
    const f = new EthernetFrame({ dstMac: MAC_B, srcMac: MAC_A, etherType: 0x0800, payload });
    expect(f.pack().length).toBe(60); // 14 + 46

    const bigPayload = new Uint8Array(100);
    const f2 = new EthernetFrame({ dstMac: MAC_B, srcMac: MAC_A, etherType: 0x0800, payload: bigPayload });
    expect(f2.pack().length).toBe(114); // 14 + 100
  });

  it('writes dstMac into bytes 0-5 and srcMac into bytes 6-11', () => {
    const f = new EthernetFrame({ dstMac: BCAST, srcMac: MAC_A, etherType: 0x0800 });
    const bytes = f.pack();
    expect(Array.from(bytes.slice(0, 6))).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(Array.from(bytes.slice(6, 12))).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });

  it('writes EtherType into bytes 12-13', () => {
    const f = new EthernetFrame({ dstMac: MAC_B, srcMac: MAC_A, etherType: 0x0806 }); // ARP
    const bytes = f.pack();
    expect(bytes[12]).toBe(0x08);
    expect(bytes[13]).toBe(0x06);
  });
});

describe('EthernetFrame.pack() — 802.1Q VLAN tagging', () => {
  it('inserts TPID 0x8100 at bytes 12-13', () => {
    const f = new EthernetFrame({ dstMac: MAC_B, srcMac: MAC_A, etherType: 0x0800 });
    f.vlan = { vid: 10 };
    const bytes = f.pack();
    expect(bytes[12]).toBe(0x81);
    expect(bytes[13]).toBe(0x00);
  });

  it('encodes VID in lower 12 bits of TCI (bytes 14-15)', () => {
    const f = new EthernetFrame({ dstMac: MAC_B, srcMac: MAC_A, etherType: 0x0800 });
    f.vlan = { vid: 42 };
    const bytes = f.pack();
    const tci = (bytes[14] << 8) | bytes[15];
    expect(tci & 0x0fff).toBe(42);
  });

  it('encodes PCP in upper 3 bits and DEI in bit 12 of TCI', () => {
    const f = new EthernetFrame({ dstMac: MAC_B, srcMac: MAC_A, etherType: 0x0800 });
    f.vlan = { vid: 1, pcp: 5, dei: 1 };
    const bytes = f.pack();
    const tci = (bytes[14] << 8) | bytes[15];
    expect((tci >> 13) & 0x07).toBe(5);  // pcp
    expect((tci >> 12) & 0x01).toBe(1);  // dei
    expect(tci & 0x0fff).toBe(1);         // vid
  });

  it('writes EtherType into bytes 16-17 when VLAN-tagged', () => {
    const f = new EthernetFrame({ dstMac: MAC_B, srcMac: MAC_A, etherType: 0x0800 });
    f.vlan = { vid: 5 };
    const bytes = f.pack();
    expect(bytes[16]).toBe(0x08);
    expect(bytes[17]).toBe(0x00);
  });

  it('VLAN frame is 4 bytes larger than untagged frame', () => {
    const payload = new Uint8Array(46);
    const untagged = new EthernetFrame({ dstMac: MAC_B, srcMac: MAC_A, etherType: 0x0800, payload });
    const tagged = new EthernetFrame({ dstMac: MAC_B, srcMac: MAC_A, etherType: 0x0800, payload });
    tagged.vlan = { vid: 100 };
    expect(tagged.pack().length - untagged.pack().length).toBe(4);
  });
});

describe('EthernetFrame.fromBytes()', () => {
  it('parses Ethernet II (EtherType > 1500)', () => {
    const payload = new Uint8Array(46);
    payload[0] = 0xab;
    const f = new EthernetFrame({ dstMac: BCAST, srcMac: MAC_A, etherType: 0x0800, payload });
    const parsed = EthernetFrame.fromBytes(f.pack());
    expect(parsed.etherType).toBe(0x0800);
    expect(parsed.useLengthField).toBe(false);
  });

  it('parses 802.3 (length field ≤ 1500)', () => {
    // Manually construct an 802.3 frame
    const bytes = new Uint8Array(60);
    bytes.set(BCAST, 0);
    bytes.set(MAC_A, 6);
    bytes[12] = 0x00;
    bytes[13] = 0x2a; // length = 42
    const f = EthernetFrame.fromBytes(bytes);
    expect(f.useLengthField).toBe(true);
    expect(f.length).toBe(42);
    expect(f.etherType).toBe(0);
  });

  it('parses VLAN-tagged frame', () => {
    const f = new EthernetFrame({ dstMac: MAC_B, srcMac: MAC_A, etherType: 0x0800 });
    f.vlan = { vid: 77, pcp: 3, dei: 0 };
    const parsed = EthernetFrame.fromBytes(f.pack());
    expect(parsed.vlan).not.toBeNull();
    expect(parsed.vlan?.vid).toBe(77);
    expect(parsed.vlan?.pcp).toBe(3);
    expect(parsed.etherType).toBe(0x0800);
  });

  it('round-trips MACs through pack/fromBytes', () => {
    const f = new EthernetFrame({ dstMac: BCAST, srcMac: MAC_A, etherType: 0x0806 });
    const parsed = EthernetFrame.fromBytes(f.pack());
    expect(Array.from(parsed.dstMac.slice(0, 6))).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(Array.from(parsed.srcMac.slice(0, 6))).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });
});
