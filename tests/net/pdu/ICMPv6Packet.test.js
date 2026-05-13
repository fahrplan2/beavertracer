import { describe, it, expect } from 'vitest';
import { ICMPv6Packet } from '../../../src/net/pdu/ICMPv6Packet.js';
import { IPAddress } from '../../../src/net/models/IPAddress.js';

const SRC = IPAddress.fromString('fe80::1');
const DST = IPAddress.fromString('fe80::2');
const TARGET = IPAddress.fromString('2001:db8::1');
const MAC_A = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);

describe('ICMPv6Packet constructor', () => {
  it('defaults to type=128 (Echo Request) and code=0', () => {
    const pkt = new ICMPv6Packet();
    expect(pkt.type).toBe(128);
    expect(pkt.code).toBe(0);
    expect(pkt.checksum).toBe(0);
  });

  it('defaults body to a 4-byte zero array', () => {
    const pkt = new ICMPv6Packet();
    expect(pkt.body).toBeInstanceOf(Uint8Array);
    expect(pkt.body.length).toBe(4);
  });
});

describe('ICMPv6Packet.fromBytes()', () => {
  it('throws for buffer shorter than 4 bytes', () => {
    expect(() => ICMPv6Packet.fromBytes(new Uint8Array(3))).toThrow();
  });

  it('round-trips type, code, and body', () => {
    const body = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const original = new ICMPv6Packet({ type: 3, code: 1, body });
    const parsed = ICMPv6Packet.fromBytes(original.pack(SRC, DST));
    expect(parsed.type).toBe(3);
    expect(parsed.code).toBe(1);
    expect(Array.from(parsed.body)).toEqual(Array.from(body));
  });
});

describe('Echo builders (type 128 / 129)', () => {
  it('buildEchoRequest() sets type=128 with correct identifier and sequence', () => {
    const pkt = ICMPv6Packet.buildEchoRequest(0x1234, 0x0005, new Uint8Array(0));
    expect(pkt.type).toBe(128);
    expect(pkt.identifier).toBe(0x1234);
    expect(pkt.sequence).toBe(0x0005);
  });

  it('buildEchoReply() sets type=129 with correct identifier and sequence', () => {
    const pkt = ICMPv6Packet.buildEchoReply(7, 42);
    expect(pkt.type).toBe(129);
    expect(pkt.identifier).toBe(7);
    expect(pkt.sequence).toBe(42);
  });

  it('echoPayload returns the payload bytes from the body', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const pkt = ICMPv6Packet.buildEchoRequest(1, 1, payload);
    expect(Array.from(pkt.echoPayload)).toEqual([10, 20, 30]);
  });
});

describe('ICMPv6Packet checksum', () => {
  it('pack() computes a non-zero checksum when src/dst are provided', () => {
    const pkt = ICMPv6Packet.buildEchoRequest(1, 1, new Uint8Array(4));
    const bytes = pkt.pack(SRC, DST);
    const cs = (bytes[2] << 8) | bytes[3];
    expect(cs).not.toBe(0);
  });

  it('verifier: re-running checksum over packed packet yields 0', () => {
    const pkt = ICMPv6Packet.buildEchoRequest(0x42, 0x07, new Uint8Array(8));
    const bytes = pkt.pack(SRC, DST);
    expect(ICMPv6Packet.computeChecksum(bytes, SRC, DST)).toBe(0);
  });
});

describe('NS builder (type 135)', () => {
  it('buildNS() sets type=135 and encodes target in body[4..19]', () => {
    const pkt = ICMPv6Packet.buildNS(TARGET);
    expect(pkt.type).toBe(135);
    const bodyTarget = IPAddress.fromUInt8(pkt.body.slice(4, 20));
    expect(bodyTarget.toString()).toBe(TARGET.toString());
  });

  it('buildNS() without srcMac has no SLLA option (body length=20)', () => {
    const pkt = ICMPv6Packet.buildNS(TARGET);
    expect(pkt.body.length).toBe(20);
  });

  it('buildNS() with srcMac includes SLLA option type=1 and MAC at body[22..27]', () => {
    const pkt = ICMPv6Packet.buildNS(TARGET, MAC_A);
    expect(pkt.body.length).toBe(28);
    expect(pkt.body[20]).toBe(1); // SLLA option type
    expect(pkt.body[21]).toBe(1); // option length in 8-byte units
    expect(Array.from(pkt.body.slice(22, 28))).toEqual(Array.from(MAC_A));
  });
});

describe('NA builder (type 136)', () => {
  it('buildNA() sets type=136 with TLLA option', () => {
    const pkt = ICMPv6Packet.buildNA(TARGET, MAC_A);
    expect(pkt.type).toBe(136);
    expect(pkt.body[20]).toBe(2); // TLLA option type
    expect(pkt.body[21]).toBe(1); // option length
    expect(Array.from(pkt.body.slice(22, 28))).toEqual(Array.from(MAC_A));
  });

  it('getLinkLayerAddress() extracts MAC from TLLA option', () => {
    const pkt = ICMPv6Packet.buildNA(TARGET, MAC_A);
    expect(Array.from(pkt.getLinkLayerAddress() ?? [])).toEqual(Array.from(MAC_A));
  });

  it('getLinkLayerAddress() extracts MAC from SLLA option in NS', () => {
    const pkt = ICMPv6Packet.buildNS(TARGET, MAC_A);
    expect(Array.from(pkt.getLinkLayerAddress() ?? [])).toEqual(Array.from(MAC_A));
  });

  it('getLinkLayerAddress() returns null when no NDP option is present', () => {
    const pkt = new ICMPv6Packet({ type: 135, body: new Uint8Array(20) });
    expect(pkt.getLinkLayerAddress()).toBeNull();
  });
});

describe('RS builder (type 133)', () => {
  it('buildRS() without srcMac sets type=133 and has 4-byte body', () => {
    const pkt = ICMPv6Packet.buildRS();
    expect(pkt.type).toBe(133);
    expect(pkt.body.length).toBe(4);
  });

  it('buildRS() with srcMac includes SLLA option at body[4..11]', () => {
    const pkt = ICMPv6Packet.buildRS(MAC_A);
    expect(pkt.body.length).toBe(12);
    expect(pkt.body[4]).toBe(1); // SLLA type
    expect(pkt.body[5]).toBe(1); // option length
    expect(Array.from(pkt.body.slice(6, 12))).toEqual(Array.from(MAC_A));
  });
});

describe('RA builder (type 134) and getPrefixInfoOptions()', () => {
  it('buildRA() sets type=134', () => {
    const pkt = ICMPv6Packet.buildRA();
    expect(pkt.type).toBe(134);
  });

  it('buildRA() with prefix produces one Prefix Information Option', () => {
    const prefix = IPAddress.fromString('2001:db8::');
    const pkt = ICMPv6Packet.buildRA({ prefix, prefixLength: 64, routerLifetime: 1800 });
    const opts = pkt.getPrefixInfoOptions();
    expect(opts.length).toBe(1);
    expect(opts[0].prefixLength).toBe(64);
    expect(opts[0].autonomous).toBe(true);
    expect(opts[0].onLink).toBe(true);
  });

  it('buildRA() without prefix yields no Prefix Information Options', () => {
    const pkt = ICMPv6Packet.buildRA({ routerLifetime: 1800 });
    expect(pkt.getPrefixInfoOptions()).toEqual([]);
  });

  it('getPrefixInfoOptions() preserves validLifetime and preferredLifetime', () => {
    const prefix = IPAddress.fromString('fd00::');
    const pkt = ICMPv6Packet.buildRA({
      prefix,
      prefixLength: 48,
      validLifetime: 7200,
      preferredLifetime: 3600,
    });
    const opts = pkt.getPrefixInfoOptions();
    expect(opts[0].validLifetime).toBe(7200);
    expect(opts[0].preferredLifetime).toBe(3600);
    expect(opts[0].prefixLength).toBe(48);
  });
});
