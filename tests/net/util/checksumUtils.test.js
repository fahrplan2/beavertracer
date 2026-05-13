import { describe, it, expect } from 'vitest';
import {
  onesComplementChecksum,
  computeIPv4PseudoChecksum,
  computeIPv6PseudoChecksum,
} from '../../../src/net/util/checksumUtils.js';

describe('onesComplementChecksum', () => {
  it('returns 0xffff for an all-zero buffer (nothing to add)', () => {
    expect(onesComplementChecksum([new Uint8Array(8)])).toBe(0xffff);
  });

  it('returns 0xffff for empty buffer list', () => {
    expect(onesComplementChecksum([])).toBe(0xffff);
  });

  it('computes known value for single 0x0800 word', () => {
    // sum = 0x0800, ~0x0800 & 0xffff = 0xf7ff
    const buf = new Uint8Array([0x08, 0x00]);
    expect(onesComplementChecksum([buf])).toBe(0xf7ff);
  });

  it('handles odd-length buffers (implicit zero pad)', () => {
    // [0x08] is treated as [0x08, 0x00] → same as above
    const a = new Uint8Array([0x08]);
    const b = new Uint8Array([0x08, 0x00]);
    expect(onesComplementChecksum([a])).toBe(onesComplementChecksum([b]));
  });

  it('multiple buffers equal their concatenation', () => {
    const a = new Uint8Array([0x45, 0x00]);
    const b = new Uint8Array([0x00, 0x14]);
    const combined = new Uint8Array([0x45, 0x00, 0x00, 0x14]);
    expect(onesComplementChecksum([a, b])).toBe(onesComplementChecksum([combined]));
  });

  it('produces checksum that is its own inverse (verifier property)', () => {
    // After inserting the checksum, onesComplementChecksum over the full packet returns 0.
    // This is the standard IP/ICMP receiver check: ~0xffff & 0xffff == 0.
    const data = new Uint8Array([0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const cs = onesComplementChecksum([data]);
    const packet = new Uint8Array(data);
    packet[2] = (cs >> 8) & 0xff;
    packet[3] = cs & 0xff;
    expect(onesComplementChecksum([packet])).toBe(0);
  });

  it('throws when passed non-Uint8Array buffer', () => {
    // @ts-ignore
    expect(() => onesComplementChecksum([[1, 2, 3]])).toThrow();
  });
});

describe('computeIPv4PseudoChecksum', () => {
  it('throws for non-Uint8Array segment', () => {
    // @ts-ignore
    expect(() => computeIPv4PseudoChecksum('bad', new Uint8Array(4), new Uint8Array(4), 6)).toThrow();
  });

  it('throws for srcIp not Uint8Array(4)', () => {
    expect(() =>
      computeIPv4PseudoChecksum(new Uint8Array(20), new Uint8Array(3), new Uint8Array(4), 6)
    ).toThrow();
  });

  it('throws for dstIp not Uint8Array(4)', () => {
    expect(() =>
      computeIPv4PseudoChecksum(new Uint8Array(20), new Uint8Array(4), new Uint8Array(5), 17)
    ).toThrow();
  });

  it('returns a 16-bit value', () => {
    const seg = new Uint8Array(20);
    const cs = computeIPv4PseudoChecksum(seg, new Uint8Array(4), new Uint8Array(4), 6);
    expect(cs).toBeGreaterThanOrEqual(0);
    expect(cs).toBeLessThanOrEqual(0xffff);
  });

  it('differs for TCP (protocol 6) vs UDP (protocol 17)', () => {
    const seg = new Uint8Array(20);
    const src = new Uint8Array([10, 0, 0, 1]);
    const dst = new Uint8Array([10, 0, 0, 2]);
    const csTCP = computeIPv4PseudoChecksum(seg, src, dst, 6);
    const csUDP = computeIPv4PseudoChecksum(seg, src, dst, 17);
    expect(csTCP).not.toBe(csUDP);
  });
});

describe('computeIPv6PseudoChecksum', () => {
  it('throws for srcIp not Uint8Array(16)', () => {
    expect(() =>
      computeIPv6PseudoChecksum(new Uint8Array(20), new Uint8Array(4), new Uint8Array(16), 58)
    ).toThrow();
  });

  it('throws for dstIp not Uint8Array(16)', () => {
    expect(() =>
      computeIPv6PseudoChecksum(new Uint8Array(20), new Uint8Array(16), new Uint8Array(4), 58)
    ).toThrow();
  });

  it('returns a 16-bit value', () => {
    const seg = new Uint8Array(20);
    const cs = computeIPv6PseudoChecksum(seg, new Uint8Array(16), new Uint8Array(16), 17);
    expect(cs).toBeGreaterThanOrEqual(0);
    expect(cs).toBeLessThanOrEqual(0xffff);
  });
});
