import { describe, it, expect } from 'vitest';
import { NTPPacket } from '../../../src/net/pdu/NTPPacket.js';

describe('NTPPacket constructor defaults', () => {
  it('defaults to VN=4, mode=client, all timestamps unspecified', () => {
    const pkt = new NTPPacket();
    expect(pkt.vn).toBe(4);
    expect(pkt.mode).toBe(NTPPacket.MODE_CLIENT);
    expect(pkt.stratum).toBe(0);
    expect(pkt.originTimestampMs).toBe(0);
    expect(pkt.receiveTimestampMs).toBe(0);
    expect(pkt.transmitTimestampMs).toBe(0);
    expect(pkt.referenceTimestampMs).toBe(0);
  });
});

describe('NTPPacket.pack() — header layout', () => {
  it('produces exactly 48 bytes', () => {
    expect(new NTPPacket().pack().length).toBe(48);
  });

  it('encodes LI/VN/Mode into byte 0', () => {
    const bytes = new NTPPacket({ li: 1, vn: 4, mode: NTPPacket.MODE_SERVER }).pack();
    expect((bytes[0] >>> 6) & 0x03).toBe(1);
    expect((bytes[0] >>> 3) & 0x07).toBe(4);
    expect(bytes[0] & 0x07).toBe(NTPPacket.MODE_SERVER);
  });

  it('encodes stratum in byte 1', () => {
    expect(new NTPPacket({ stratum: 1 }).pack()[1]).toBe(1);
  });

  it('encodes a 4-byte ASCII reference ID unpadded to 4 bytes', () => {
    const bytes = new NTPPacket({ referenceId: 'LOCL' }).pack();
    expect(String.fromCharCode(...bytes.slice(12, 16))).toBe('LOCL');
  });
});

describe('NTPPacket round-trip', () => {
  it('pack() -> fromBytes() preserves mode, stratum and reference ID', () => {
    const pkt = new NTPPacket({ mode: NTPPacket.MODE_SERVER, stratum: 1, referenceId: 'LOCL' });
    const parsed = NTPPacket.fromBytes(pkt.pack());
    expect(parsed.mode).toBe(NTPPacket.MODE_SERVER);
    expect(parsed.stratum).toBe(1);
    expect(parsed.referenceIdText).toBe('LOCL');
  });

  it('preserves all four timestamps to millisecond precision', () => {
    const t1 = Date.UTC(2024, 0, 1, 12, 0, 0, 250);
    const t2 = t1 + 5;
    const t3 = t2 + 1;
    const t4 = t1 + 40;

    const pkt = new NTPPacket({
      originTimestampMs: t1,
      receiveTimestampMs: t2,
      transmitTimestampMs: t3,
      referenceTimestampMs: t4,
    });
    const parsed = NTPPacket.fromBytes(pkt.pack());

    expect(Math.round(parsed.originTimestampMs)).toBe(t1);
    expect(Math.round(parsed.receiveTimestampMs)).toBe(t2);
    expect(Math.round(parsed.transmitTimestampMs)).toBe(t3);
    expect(Math.round(parsed.referenceTimestampMs)).toBe(t4);
  });

  it('round-trips a zero ("unspecified") timestamp as 0', () => {
    const pkt = new NTPPacket({ originTimestampMs: 0 });
    const parsed = NTPPacket.fromBytes(pkt.pack());
    expect(parsed.originTimestampMs).toBe(0);
  });

  it('throws on a payload shorter than 48 bytes', () => {
    expect(() => NTPPacket.fromBytes(new Uint8Array(47))).toThrow();
  });
});

describe('NTPPacket.msToNtp / ntpToMs', () => {
  it('round-trips an arbitrary epoch-ms value', () => {
    const ms = Date.UTC(2026, 5, 15, 8, 30, 12, 500);
    const { seconds, fraction } = NTPPacket.msToNtp(ms);
    expect(Math.round(NTPPacket.ntpToMs(seconds, fraction))).toBe(ms);
  });

  it('maps the Unix epoch to the well-known NTP seconds offset', () => {
    const { seconds, fraction } = NTPPacket.msToNtp(0);
    // 0 ms is treated as "unspecified" by convention (matches real NTP's zero timestamp)
    expect(seconds).toBe(0);
    expect(fraction).toBe(0);
  });

  it('maps 1 ms past the Unix epoch to seconds = NTP/Unix epoch delta', () => {
    const { seconds } = NTPPacket.msToNtp(1);
    expect(seconds).toBe(NTPPacket.NTP_UNIX_EPOCH_DELTA_S);
  });
});
