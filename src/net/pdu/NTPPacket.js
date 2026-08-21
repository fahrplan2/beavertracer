//@ts-check

import { read32BE, write32BE } from "../util/byteUtils.js";

/**
 * NTPv4 packet (RFC 5905 §7.3), unauthenticated (no extension fields, no MAC) —
 * the 48-byte header is all real NTP clients/servers exchange for a plain
 * query/response, so this is a complete, standards-shaped implementation
 * rather than a simplified stand-in. Wireshark's own "ntp" dissector reads
 * these bytes natively; BeaverTracer does not need a custom dissector.
 *
 * The four protocol timestamps (Reference/Origin/Receive/Transmit) are
 * exposed as plain epoch-millisecond numbers for convenience — 0 means
 * "unspecified" (the wire NTP era-0 zero timestamp), matching real NTP.
 */
export class NTPPacket {

  /** @type {number} Leap Indicator, 0..3 */
  li;
  /** @type {number} Version Number, 0..7 (4 = NTPv4) */
  vn;
  /** @type {number} Mode, 0..7 (3 = client, 4 = server) */
  mode;

  /** @type {number} Stratum, 0..255 (0 = unspecified/kiss-o'-death, 1 = primary ref., 2+ = secondary) */
  stratum;
  /** @type {number} Poll interval, signed log2 seconds */
  poll;
  /** @type {number} Precision, signed log2 seconds */
  precision;

  /** @type {number} Root Delay in seconds (signed) */
  rootDelay;
  /** @type {number} Root Dispersion in seconds (unsigned) */
  rootDispersion;

  /** @type {Uint8Array} 4-byte Reference Identifier (ASCII refclock ID for stratum <2, else upstream IPv4) */
  referenceId;

  /** @type {number} Reference Timestamp, epoch ms (0 = unspecified) */
  referenceTimestampMs;
  /** @type {number} Origin Timestamp (T1), epoch ms (0 = unspecified) */
  originTimestampMs;
  /** @type {number} Receive Timestamp (T2), epoch ms (0 = unspecified) */
  receiveTimestampMs;
  /** @type {number} Transmit Timestamp (T3 on the wire; T1 when sent by a client request), epoch ms */
  transmitTimestampMs;

  static MODE_CLIENT = 3;
  static MODE_SERVER = 4;

  /** Seconds between the NTP epoch (1900-01-01) and the Unix epoch (1970-01-01). */
  static NTP_UNIX_EPOCH_DELTA_S = 2208988800;

  /**
   * @param {object} [opts]
   * @param {number} [opts.li]
   * @param {number} [opts.vn]
   * @param {number} [opts.mode]
   * @param {number} [opts.stratum]
   * @param {number} [opts.poll]
   * @param {number} [opts.precision]
   * @param {number} [opts.rootDelay]
   * @param {number} [opts.rootDispersion]
   * @param {Uint8Array|string} [opts.referenceId]
   * @param {number} [opts.referenceTimestampMs]
   * @param {number} [opts.originTimestampMs]
   * @param {number} [opts.receiveTimestampMs]
   * @param {number} [opts.transmitTimestampMs]
   */
  constructor(opts = {}) {
    this.li = (opts.li ?? 0) & 0x03;
    this.vn = (opts.vn ?? 4) & 0x07;
    this.mode = (opts.mode ?? NTPPacket.MODE_CLIENT) & 0x07;

    this.stratum = (opts.stratum ?? 0) & 0xff;
    this.poll = (opts.poll ?? 0) << 24 >> 24; // clamp to signed 8-bit
    this.precision = (opts.precision ?? 0) << 24 >> 24;

    this.rootDelay = opts.rootDelay ?? 0;
    this.rootDispersion = opts.rootDispersion ?? 0;

    this.referenceId = NTPPacket._normalizeRefId(opts.referenceId);

    this.referenceTimestampMs = opts.referenceTimestampMs ?? 0;
    this.originTimestampMs = opts.originTimestampMs ?? 0;
    this.receiveTimestampMs = opts.receiveTimestampMs ?? 0;
    this.transmitTimestampMs = opts.transmitTimestampMs ?? 0;
  }

  /** @param {Uint8Array|string|undefined} id */
  static _normalizeRefId(id) {
    if (id instanceof Uint8Array) {
      const out = new Uint8Array(4);
      out.set(id.subarray(0, 4));
      return out;
    }
    if (typeof id === "string") {
      const out = new Uint8Array(4);
      for (let i = 0; i < 4 && i < id.length; i++) out[i] = id.charCodeAt(i) & 0xff;
      return out;
    }
    return new Uint8Array(4);
  }

  /** Reference ID as a printable ASCII string (control/zero bytes shown as '.'). */
  get referenceIdText() {
    let s = "";
    for (const b of this.referenceId) s += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".";
    return s;
  }

  // ---------------------------------------------------------------------
  // NTP <-> epoch-ms timestamp conversion (RFC 5905 §7.2, 32.32 fixed point)
  // ---------------------------------------------------------------------

  /**
   * @param {number} ms epoch milliseconds (0 = unspecified -> {0,0})
   * @returns {{seconds: number, fraction: number}}
   */
  static msToNtp(ms) {
    if (!ms) return { seconds: 0, fraction: 0 };
    const totalSeconds = ms / 1000;
    const wholeSeconds = Math.floor(totalSeconds);
    const frac = totalSeconds - wholeSeconds;
    return {
      seconds: (wholeSeconds + NTPPacket.NTP_UNIX_EPOCH_DELTA_S) >>> 0,
      fraction: Math.round(frac * 0x100000000) >>> 0,
    };
  }

  /**
   * @param {number} seconds unsigned 32-bit NTP seconds
   * @param {number} fraction unsigned 32-bit NTP fraction
   * @returns {number} epoch milliseconds (0 if the timestamp is unspecified)
   */
  static ntpToMs(seconds, fraction) {
    if (!seconds && !fraction) return 0;
    const unixSeconds = (seconds >>> 0) - NTPPacket.NTP_UNIX_EPOCH_DELTA_S;
    return unixSeconds * 1000 + ((fraction >>> 0) / 0x100000000) * 1000;
  }

  // ---------------------------------------------------------------------
  // Wire format
  // ---------------------------------------------------------------------

  /** @returns {Uint8Array} 48-byte NTPv4 header */
  pack() {
    const buf = new Uint8Array(48);

    buf[0] = ((this.li & 0x03) << 6) | ((this.vn & 0x07) << 3) | (this.mode & 0x07);
    buf[1] = this.stratum & 0xff;
    buf[2] = this.poll & 0xff;
    buf[3] = this.precision & 0xff;

    write32BE(buf, 4, NTPPacket._toFixed16_16(this.rootDelay));
    write32BE(buf, 8, NTPPacket._toFixed16_16(this.rootDispersion));

    buf.set(this.referenceId, 12);

    NTPPacket._writeTimestamp(buf, 16, this.referenceTimestampMs);
    NTPPacket._writeTimestamp(buf, 24, this.originTimestampMs);
    NTPPacket._writeTimestamp(buf, 32, this.receiveTimestampMs);
    NTPPacket._writeTimestamp(buf, 40, this.transmitTimestampMs);

    return buf;
  }

  /**
   * @param {Uint8Array} bytes
   * @returns {NTPPacket}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error("fromBytes expects Uint8Array");
    if (bytes.length < 48) throw new Error("NTP message needs at least 48 bytes");

    const b0 = bytes[0];

    return new NTPPacket({
      li: (b0 >>> 6) & 0x03,
      vn: (b0 >>> 3) & 0x07,
      mode: b0 & 0x07,
      stratum: bytes[1],
      poll: (bytes[2] << 24) >> 24,
      precision: (bytes[3] << 24) >> 24,
      rootDelay: NTPPacket._fromFixed16_16(read32BE(bytes, 4)),
      rootDispersion: NTPPacket._fromFixed16_16(read32BE(bytes, 8)),
      referenceId: bytes.slice(12, 16),
      referenceTimestampMs: NTPPacket.ntpToMs(read32BE(bytes, 16), read32BE(bytes, 20)),
      originTimestampMs: NTPPacket.ntpToMs(read32BE(bytes, 24), read32BE(bytes, 28)),
      receiveTimestampMs: NTPPacket.ntpToMs(read32BE(bytes, 32), read32BE(bytes, 36)),
      transmitTimestampMs: NTPPacket.ntpToMs(read32BE(bytes, 40), read32BE(bytes, 44)),
    });
  }

  /** @param {Uint8Array} buf @param {number} off @param {number} ms */
  static _writeTimestamp(buf, off, ms) {
    const { seconds, fraction } = NTPPacket.msToNtp(ms);
    write32BE(buf, off, seconds);
    write32BE(buf, off + 4, fraction);
  }

  /** Signed 16.16 fixed point (Root Delay), seconds -> raw 32-bit. @param {number} seconds */
  static _toFixed16_16(seconds) {
    return Math.round(seconds * 0x10000) | 0;
  }

  /** @param {number} raw */
  static _fromFixed16_16(raw) {
    return (raw | 0) / 0x10000;
  }
}
