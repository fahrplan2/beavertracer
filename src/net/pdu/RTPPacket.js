//@ts-check

import { read16BE, read32BE, write16BE, write32BE } from "../util/byteUtils.js";

/**
 * RTP packet (RFC 3550 §5.1) — the 12-byte fixed header plus an optional CSRC
 * list and an optional one-shot header extension. This is the complete wire
 * shape a plain audio sender/receiver exchanges, so Wireshark's own "rtp"
 * dissector reads these bytes natively; BeaverTracer needs no custom dissector.
 *
 * The simulator does not carry real encoded audio: the payload is a compact
 * "voice frame reference" (see VoiceFrame.js) that the receiving softphone
 * resolves against its local copy of the phrase. Everything above the payload
 * — version, PT, sequence number, timestamp, SSRC, marker — is real RTP, so
 * loss / jitter / stream analysis in Wireshark stays meaningful.
 *
 * Header layout:
 *   0      V(2) P(1) X(1) CC(4)
 *   1      M(1) PT(7)
 *   2..3   sequence number (uint16)
 *   4..7   timestamp (uint32)
 *   8..11  SSRC (uint32)
 *   12..   CC × CSRC (uint32 each)
 *   [X]    extension: profile(uint16) length(uint16, in 32-bit words) + data
 *   ...    payload
 */
export class RTPPacket {

  /** @type {number} version, always 2 */
  version;
  /** @type {boolean} padding flag (padding bytes present at end of payload) */
  padding;
  /** @type {boolean} extension flag (one header extension follows the CSRC list) */
  extension;
  /** @type {boolean} marker bit — for audio: first packet of a talkspurt */
  marker;
  /** @type {number} payload type, 0..127 (0 = PCMU/G.711 µ-law) */
  payloadType;
  /** @type {number} sequence number, uint16, increments by 1 per packet */
  sequenceNumber;
  /** @type {number} timestamp, uint32 — for 8 kHz audio: +160 per 20 ms frame */
  timestamp;
  /** @type {number} synchronization source identifier, uint32 */
  ssrc;
  /** @type {number[]} contributing source identifiers (uint32 each), length 0..15 */
  csrc;
  /** @type {{ profile: number, data: Uint8Array } | null} optional header extension */
  headerExtension;
  /** @type {Uint8Array} payload bytes */
  payload;

  /** PCMU / G.711 µ-law — the one codec the simulator negotiates. */
  static PT_PCMU = 0;
  /** RFC 4733 telephone-event (DTMF), dynamically mapped in SDP (typ. 101). */
  static PT_TELEPHONE_EVENT = 101;

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.padding] default false
   * @param {boolean} [opts.marker] default false
   * @param {number}  [opts.payloadType] 0..127, default 0 (PCMU)
   * @param {number}  [opts.sequenceNumber] uint16, default 0
   * @param {number}  [opts.timestamp] uint32, default 0
   * @param {number}  [opts.ssrc] uint32, default 0
   * @param {number[]} [opts.csrc] up to 15 uint32 values, default []
   * @param {{ profile: number, data: Uint8Array } | null} [opts.headerExtension] default null
   * @param {Uint8Array} [opts.payload] default empty
   */
  constructor(opts = {}) {
    this.version        = 2;
    this.padding        = !!opts.padding;
    this.marker         = !!opts.marker;
    this.payloadType    = (opts.payloadType ?? RTPPacket.PT_PCMU) & 0x7f;
    this.sequenceNumber = (opts.sequenceNumber ?? 0) & 0xffff;
    this.timestamp      = (opts.timestamp ?? 0) >>> 0;
    this.ssrc           = (opts.ssrc ?? 0) >>> 0;
    this.csrc           = (opts.csrc ?? []).map(v => v >>> 0);
    this.headerExtension = opts.headerExtension
      ? { profile: opts.headerExtension.profile & 0xffff, data: new Uint8Array(opts.headerExtension.data) }
      : null;
    this.extension      = this.headerExtension != null;
    this.payload        = opts.payload instanceof Uint8Array ? opts.payload : new Uint8Array(0);

    this._validate();
  }

  /**
   * Parse an RTP packet from bytes.
   * @param {Uint8Array} bytes
   * @returns {RTPPacket}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error("fromBytes expects Uint8Array");
    if (bytes.length < 12) throw new Error("RTP header needs at least 12 bytes");

    const b0 = bytes[0];
    const version = (b0 >>> 6) & 0x03;
    if (version !== 2) throw new Error(`Unsupported RTP version ${version}`);
    const padding = ((b0 >>> 5) & 0x01) === 1;
    const extFlag = ((b0 >>> 4) & 0x01) === 1;
    const cc      = b0 & 0x0f;

    const b1 = bytes[1];
    const marker      = ((b1 >>> 7) & 0x01) === 1;
    const payloadType = b1 & 0x7f;

    const sequenceNumber = read16BE(bytes, 2);
    const timestamp      = read32BE(bytes, 4);
    const ssrc           = read32BE(bytes, 8);

    let offset = 12;
    if (bytes.length < offset + cc * 4) throw new Error("RTP CSRC list truncated");
    const csrc = [];
    for (let i = 0; i < cc; i++) {
      csrc.push(read32BE(bytes, offset));
      offset += 4;
    }

    /** @type {{ profile: number, data: Uint8Array } | null} */
    let headerExtension = null;
    if (extFlag) {
      if (bytes.length < offset + 4) throw new Error("RTP header extension truncated");
      const profile = read16BE(bytes, offset);
      const words   = read16BE(bytes, offset + 2);
      offset += 4;
      if (bytes.length < offset + words * 4) throw new Error("RTP header extension data truncated");
      headerExtension = { profile, data: bytes.slice(offset, offset + words * 4) };
      offset += words * 4;
    }

    let payload = bytes.slice(offset);
    if (padding && payload.length > 0) {
      const padLen = payload[payload.length - 1];
      if (padLen > 0 && padLen <= payload.length) payload = payload.slice(0, payload.length - padLen);
    }

    return new RTPPacket({
      marker, payloadType, sequenceNumber, timestamp, ssrc, csrc, headerExtension, payload,
    });
  }

  /**
   * Serialize to bytes. Padding is not emitted (the simulator never pads);
   * the flag round-trips for fidelity but pack() always writes P=0.
   * @returns {Uint8Array}
   */
  pack() {
    this._validate();

    const cc = this.csrc.length;
    const extBytes = this.headerExtension ? 4 + this.headerExtension.data.length : 0;
    const out = new Uint8Array(12 + cc * 4 + extBytes + this.payload.length);

    out[0] = (this.version << 6)
           | (0 << 5) // padding: never emitted
           | ((this.headerExtension ? 1 : 0) << 4)
           | (cc & 0x0f);
    out[1] = ((this.marker ? 1 : 0) << 7) | (this.payloadType & 0x7f);

    write16BE(out, 2, this.sequenceNumber & 0xffff);
    write32BE(out, 4, this.timestamp >>> 0);
    write32BE(out, 8, this.ssrc >>> 0);

    let offset = 12;
    for (const id of this.csrc) {
      write32BE(out, offset, id >>> 0);
      offset += 4;
    }

    if (this.headerExtension) {
      const data = this.headerExtension.data;
      if (data.length % 4 !== 0) throw new Error("RTP header extension data must be a multiple of 4 bytes");
      write16BE(out, offset, this.headerExtension.profile & 0xffff);
      write16BE(out, offset + 2, data.length / 4);
      offset += 4;
      out.set(data, offset);
      offset += data.length;
    }

    out.set(this.payload, offset);
    return out;
  }

  _validate() {
    if (this.version !== 2) throw new Error("RTP version must be 2");
    if (!Number.isInteger(this.payloadType) || this.payloadType < 0 || this.payloadType > 127) {
      throw new Error("payloadType must be 0..127");
    }
    if (!Number.isInteger(this.sequenceNumber) || this.sequenceNumber < 0 || this.sequenceNumber > 0xffff) {
      throw new Error("sequenceNumber must be 0..65535");
    }
    if (!Number.isInteger(this.timestamp) || this.timestamp < 0 || this.timestamp > 0xffffffff) {
      throw new Error("timestamp must be a uint32");
    }
    if (!Number.isInteger(this.ssrc) || this.ssrc < 0 || this.ssrc > 0xffffffff) {
      throw new Error("ssrc must be a uint32");
    }
    if (this.csrc.length > 15) throw new Error("RTP allows at most 15 CSRC identifiers");
    if (!(this.payload instanceof Uint8Array)) throw new Error("payload must be Uint8Array");
  }
}
