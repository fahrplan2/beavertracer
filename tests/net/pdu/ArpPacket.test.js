import { describe, it, expect } from 'vitest';
import { ArpPacket } from '../../../src/net/pdu/ArpPacket.js';

const MAC_SENDER = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
const MAC_TARGET = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // unknown (ARP request)
const IP_SENDER  = new Uint8Array([192, 168, 1, 1]);
const IP_TARGET  = new Uint8Array([192, 168, 1, 254]);

describe('ArpPacket constructor defaults', () => {
  it('defaults to Ethernet/IPv4 ARP request', () => {
    const pkt = new ArpPacket();
    expect(pkt.htype).toBe(1);       // Ethernet
    expect(pkt.ptype).toBe(0x0800);  // IPv4
    expect(pkt.hlen).toBe(6);
    expect(pkt.plen).toBe(4);
    expect(pkt.oper).toBe(1);        // request
  });

  it('initialises sha/spa/tha/tpa as zero-filled arrays of correct length', () => {
    const pkt = new ArpPacket();
    expect(pkt.sha).toBeInstanceOf(Uint8Array);
    expect(pkt.sha.length).toBe(6);
    expect(pkt.spa.length).toBe(4);
    expect(pkt.tha.length).toBe(6);
    expect(pkt.tpa.length).toBe(4);
  });
});

describe('ArpPacket.pack()', () => {
  it('produces exactly 28 bytes for Ethernet/IPv4 ARP', () => {
    // 8 fixed + 2*(hlen=6) + 2*(plen=4) = 8+12+8 = 28
    expect(new ArpPacket().pack().length).toBe(28);
  });

  it('writes htype=1 (Ethernet) into bytes 0-1', () => {
    const bytes = new ArpPacket().pack();
    expect(bytes[0]).toBe(0x00);
    expect(bytes[1]).toBe(0x01);
  });

  it('writes ptype=0x0800 (IPv4) into bytes 2-3', () => {
    const bytes = new ArpPacket().pack();
    expect(bytes[2]).toBe(0x08);
    expect(bytes[3]).toBe(0x00);
  });

  it('writes hlen=6 at byte 4 and plen=4 at byte 5', () => {
    const bytes = new ArpPacket().pack();
    expect(bytes[4]).toBe(6);
    expect(bytes[5]).toBe(4);
  });

  it('writes oper=1 (request) into bytes 6-7', () => {
    const bytes = new ArpPacket().pack();
    expect(bytes[6]).toBe(0x00);
    expect(bytes[7]).toBe(0x01);
  });

  it('writes oper=2 (reply) correctly', () => {
    const bytes = new ArpPacket({ oper: 2 }).pack();
    expect(bytes[6]).toBe(0x00);
    expect(bytes[7]).toBe(0x02);
  });

  it('lays out SHA, SPA, THA, TPA in order starting at byte 8', () => {
    const pkt = new ArpPacket({
      sha: MAC_SENDER, spa: IP_SENDER,
      tha: MAC_TARGET, tpa: IP_TARGET,
    });
    const bytes = pkt.pack();
    // SHA at 8..13
    expect(Array.from(bytes.slice(8, 14))).toEqual(Array.from(MAC_SENDER));
    // SPA at 14..17
    expect(Array.from(bytes.slice(14, 18))).toEqual(Array.from(IP_SENDER));
    // THA at 18..23
    expect(Array.from(bytes.slice(18, 24))).toEqual(Array.from(MAC_TARGET));
    // TPA at 24..27
    expect(Array.from(bytes.slice(24, 28))).toEqual(Array.from(IP_TARGET));
  });
});

describe('ArpPacket.fromBytes()', () => {
  it('throws for buffer shorter than 8 bytes', () => {
    expect(() => ArpPacket.fromBytes(new Uint8Array(7))).toThrow();
  });

  it('throws when buffer is too short for declared hlen/plen', () => {
    // hlen=6, plen=4 → needs 28 bytes; supply only 20
    const buf = new Uint8Array(20);
    buf[4] = 6; buf[5] = 4;
    expect(() => ArpPacket.fromBytes(buf)).toThrow();
  });

  it('round-trips an ARP request', () => {
    const original = new ArpPacket({
      oper: 1,
      sha: MAC_SENDER, spa: IP_SENDER,
      tha: MAC_TARGET, tpa: IP_TARGET,
    });
    const parsed = ArpPacket.fromBytes(original.pack());

    expect(parsed.htype).toBe(1);
    expect(parsed.ptype).toBe(0x0800);
    expect(parsed.oper).toBe(1);
    expect(Array.from(parsed.sha)).toEqual(Array.from(MAC_SENDER));
    expect(Array.from(parsed.spa)).toEqual(Array.from(IP_SENDER));
    expect(Array.from(parsed.tpa)).toEqual(Array.from(IP_TARGET));
  });

  it('round-trips an ARP reply', () => {
    const reply = new ArpPacket({
      oper: 2,
      sha: MAC_SENDER, spa: IP_TARGET,
      tha: MAC_SENDER, tpa: IP_SENDER,
    });
    const parsed = ArpPacket.fromBytes(reply.pack());
    expect(parsed.oper).toBe(2);
    expect(Array.from(parsed.sha)).toEqual(Array.from(MAC_SENDER));
  });
});
