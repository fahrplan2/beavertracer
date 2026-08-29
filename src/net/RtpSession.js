//@ts-check

import { RTPPacket } from "./pdu/RTPPacket.js";
import { encodeVoiceFrame, decodeVoiceFrame } from "./pdu/VoiceFrame.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";

/**
 * One RTP media leg for a call.
 *
 * Sending: a softphone triggers a canned phrase; this schedules one RTP packet
 * per ptime-slice on the simulation clock, marker bit on the first packet of the
 * talkspurt, and stays silent (DTX) between phrases. The payload is a compact
 * voice-frame reference (VoiceFrame.js), not real audio.
 *
 * Receiving: packets are collected per talkspurt, tolerating loss and reorder.
 * When a talkspurt ends (marker of the next one, or a grace period of silence)
 * a "talkspurt" event fires with exactly which frame indices arrived — the app
 * plays those slices of its local copy of the phrase and leaves the gaps silent,
 * so simulated packet loss becomes audible. RFC 3550 loss counters and an
 * interarrival-jitter estimate are maintained for the call-stats UI.
 *
 * Transport-agnostic: give it `transport.send(bytes, dstIp, dstPort)` and feed
 * inbound datagrams to `receive(bytes, srcIp, srcPort)`.
 */

const DEFAULT_PTIME_MS = SimTimer.RTP_PTIME_MS;
const CLOCK_RATE = 8000;             // G.711 / PCMU sample rate
/** End a talkspurt this many missed frames after the last packet seen. */
const TALKSPURT_GRACE_FRAMES = SimTimer.RTP_TALKSPURT_GRACE_FRAMES;
/** Sim-time in ms derived from the shared tick counter (matches TcpEngine's RTT clock). */
const simNowMs = () => simTimer.currentTick * SimTimer.SIM_MS_PER_TICK;

export class RtpSession {

  /**
   * @param {object} deps
   * @param {{ send: (bytes: Uint8Array, dstIp: string, dstPort: number) => void }} deps.transport
   * @param {number} [deps.ptimeMs]       packetization interval, default 100
   * @param {number} [deps.payloadType]   default 0 (PCMU)
   * @param {"realtime"|"burst"} [deps.pacing]  "realtime" = one packet / ptime (default);
   *                                            "burst" = compress to burstIntervalMs
   * @param {number} [deps.burstIntervalMs] default SimTimer.RTP_BURST_INTERVAL_MS
   * @param {{ schedule: (cb: () => void, ms: number) => number, cancel: (id: number) => void }} [deps.timer]
   * @param {() => number} [deps.rng]     [0,1) source for SSRC / start values
   * @param {() => number} [deps.now]     sim-time in ms (default: shared tick clock), for jitter + silence gaps
   */
  constructor(deps) {
    this._transport = deps.transport;
    this._ptimeMs = deps.ptimeMs ?? DEFAULT_PTIME_MS;
    this._payloadType = deps.payloadType ?? RTPPacket.PT_PCMU;
    this._pacing = deps.pacing ?? "realtime";
    this._burstIntervalMs = deps.burstIntervalMs ?? SimTimer.RTP_BURST_INTERVAL_MS;
    this._timer = deps.timer ?? simTimer;
    this._rng = deps.rng ?? Math.random;
    this._now = deps.now ?? simNowMs;

    this._samplesPerFrame = Math.round(CLOCK_RATE * this._ptimeMs / 1000);

    // ── local (tx) state ──
    this._ssrc = Math.floor(this._rng() * 0xffffffff) >>> 0;
    this._txSeq = Math.floor(this._rng() * 0x10000) & 0xffff;
    this._txTimestamp = Math.floor(this._rng() * 0xffffffff) >>> 0;
    this._lastTxEndMs = /** @type {number|null} */ (null);
    /** @type {Set<number>} pending scheduled-send timer ids */
    this._txTimers = new Set();
    this._txPackets = 0;
    this._txBytes = 0;

    /** @type {string|null} */ this._remoteIp = null;
    /** @type {number} */ this._remotePort = 0;

    // ── remote (rx) state ──
    /** @type {number|null} */ this._remoteSsrc = null;
    this._baseSeq = 0;
    this._maxSeq = 0;
    this._cycles = 0;
    this._rxReceived = 0;
    this._rxPackets = 0;
    this._probation = true;

    // jitter (RFC 3550 §A.8), in RTP timestamp units
    this._jitter = 0;
    this._lastTransit = /** @type {number|null} */ (null);

    // current inbound talkspurt — identified by (phraseId, baseTs) where baseTs
    // is the RTP timestamp frame 0 would carry, inferred from any packet. This
    // makes segmentation independent of the marker bit and immune to reorder.
    /** @type {{ phraseId: number, baseTs: number, totalFrames: number, frames: Set<number>, firstArrivalMs: number } | null} */
    this._rxTalkspurt = null;
    this._rxFlushTimer = /** @type {number|null} */ (null);
    this._sawFirstPacket = false;

    /** @type {Map<string, Array<(...a:any[]) => void>>} */
    this._listeners = new Map();
  }

  get ssrc() { return this._ssrc; }
  get ptimeMs() { return this._ptimeMs; }
  get remoteSsrc() { return this._remoteSsrc; }
  get sending() { return this._txTimers.size > 0; }

  /**
   * @param {string} event  "talkstart" | "talkspurt" | "firstPacket" | "ssrcChange" | "sendComplete"
   * @param {(...a:any[]) => void} cb
   * @returns {() => void}
   */
  on(event, cb) {
    const list = this._listeners.get(event) ?? [];
    list.push(cb);
    this._listeners.set(event, list);
    return () => {
      const l = this._listeners.get(event);
      if (l) this._listeners.set(event, l.filter(x => x !== cb));
    };
  }

  /** @param {string} event @param {...any} args */
  _emit(event, ...args) {
    for (const cb of this._listeners.get(event) ?? []) {
      try { cb(...args); } catch { /* listener errors must not break media */ }
    }
  }

  /**
   * @param {string} ip
   * @param {number} port
   */
  setRemote(ip, port) {
    this._remoteIp = ip;
    this._remotePort = port;
  }

  /**
   * Number of ptime-slices a phrase of the given duration occupies.
   * @param {number} durationMs
   * @returns {number}
   */
  frameCountFor(durationMs) {
    return Math.max(1, Math.ceil(durationMs / this._ptimeMs));
  }

  /**
   * Send a canned phrase as an RTP talkspurt.
   * @param {object} opts
   * @param {number} opts.phraseId     0..255, index into the app's manifest
   * @param {number} opts.frameCount   number of ptime-slices (see frameCountFor)
   * @returns {boolean} false if no remote is set or a phrase is already sending
   */
  playPhrase({ phraseId, frameCount }) {
    if (!this._remoteIp || this._txTimers.size > 0) return false;
    const total = Math.max(1, Math.min(frameCount, 0xffff));

    // Advance the timestamp across the silence gap since the last talkspurt so
    // the marker bit lines up with a real discontinuity (RFC 3550 §5.1).
    if (this._lastTxEndMs != null) {
      const gapMs = Math.max(0, this._now() - this._lastTxEndMs);
      this._txTimestamp = (this._txTimestamp + Math.round(CLOCK_RATE * gapMs / 1000)) >>> 0;
    }

    const step = this._pacing === "burst" ? this._burstIntervalMs : this._ptimeMs;
    for (let i = 0; i < total; i++) {
      const frameIndex = i;
      const marker = i === 0;
      const id = this._timer.schedule(() => {
        this._txTimers.delete(id);
        this._sendFrame(phraseId, frameIndex, total, marker);
        if (frameIndex === total - 1) {
          this._lastTxEndMs = this._now();
          this._emit("sendComplete", { phraseId, frames: total });
        }
      }, i * step + 1);
      this._txTimers.add(id);
    }
    return true;
  }

  /** @param {number} phraseId @param {number} frameIndex @param {number} total @param {boolean} marker */
  _sendFrame(phraseId, frameIndex, total, marker) {
    if (!this._remoteIp) return;
    const pkt = new RTPPacket({
      marker,
      payloadType: this._payloadType,
      sequenceNumber: this._txSeq,
      timestamp: this._txTimestamp,
      ssrc: this._ssrc,
      payload: encodeVoiceFrame({ phraseId, frameIndex, totalFrames: total }),
    });
    this._txSeq = (this._txSeq + 1) & 0xffff;
    this._txTimestamp = (this._txTimestamp + this._samplesPerFrame) >>> 0;

    const bytes = pkt.pack();
    this._txPackets++;
    this._txBytes += bytes.length;
    this._transport.send(bytes, this._remoteIp, this._remotePort);
  }

  /**
   * Feed an inbound datagram (already stripped to the RTP bytes).
   * @param {Uint8Array} bytes
   * @param {string} [srcIp]
   * @param {number} [srcPort]
   */
  receive(bytes, srcIp, srcPort) {
    let pkt;
    try { pkt = RTPPacket.fromBytes(bytes); }
    catch { return; }
    if (pkt.payloadType !== this._payloadType) return;

    // Lock onto the first remote SSRC; report a mid-call change but follow it.
    if (this._remoteSsrc == null) {
      this._remoteSsrc = pkt.ssrc;
      this._initSeq(pkt.sequenceNumber);
    } else if (pkt.ssrc !== this._remoteSsrc) {
      const old = this._remoteSsrc;
      this._remoteSsrc = pkt.ssrc;
      this._initSeq(pkt.sequenceNumber);
      this._resetTalkspurt();
      this._emit("ssrcChange", { oldSsrc: old, newSsrc: pkt.ssrc });
    } else {
      this._updateSeq(pkt.sequenceNumber);
    }

    this._rxPackets++;
    this._updateJitter(pkt.timestamp);

    if (!this._sawFirstPacket) {
      this._sawFirstPacket = true;
      this._emit("firstPacket");
    }

    const vf = decodeVoiceFrame(pkt.payload);
    if (!vf) return;

    // All packets of one phrase share this inferred "frame 0" timestamp; a new
    // (phraseId, baseTs) pair means a genuinely new talkspurt, reorder or not.
    const baseTs = (pkt.timestamp - vf.frameIndex * this._samplesPerFrame) >>> 0;
    if (!this._rxTalkspurt || this._rxTalkspurt.phraseId !== vf.phraseId || this._rxTalkspurt.baseTs !== baseTs) {
      this._flushTalkspurt();
      this._rxTalkspurt = {
        phraseId: vf.phraseId,
        baseTs,
        totalFrames: vf.totalFrames,
        frames: new Set(),
        firstArrivalMs: this._now(),
      };
      // Fired on the first packet of a talkspurt so a consumer can start
      // playback immediately instead of waiting for the whole thing to arrive.
      this._emit("talkstart", { phraseId: vf.phraseId, totalFrames: vf.totalFrames });
    }
    this._rxTalkspurt.frames.add(vf.frameIndex);
    this._rxTalkspurt.totalFrames = vf.totalFrames; // trust the latest

    // (re)arm the silence-grace flush
    if (this._rxFlushTimer != null) this._timer.cancel(this._rxFlushTimer);
    this._rxFlushTimer = this._timer.schedule(
      () => { this._rxFlushTimer = null; this._flushTalkspurt(); },
      this._ptimeMs * TALKSPURT_GRACE_FRAMES,
    );

    // all frames present → flush immediately, no need to wait out the grace
    if (this._rxTalkspurt.frames.size >= this._rxTalkspurt.totalFrames) {
      if (this._rxFlushTimer != null) { this._timer.cancel(this._rxFlushTimer); this._rxFlushTimer = null; }
      this._flushTalkspurt();
    }
  }

  _flushTalkspurt() {
    const ts = this._rxTalkspurt;
    if (!ts) return;
    this._rxTalkspurt = null;

    const received = [...ts.frames].sort((a, b) => a - b);
    const lost = [];
    for (let i = 0; i < ts.totalFrames; i++) if (!ts.frames.has(i)) lost.push(i);

    this._emit("talkspurt", {
      phraseId: ts.phraseId,
      totalFrames: ts.totalFrames,
      receivedFrames: received,
      lostFrames: lost,
      lossFraction: ts.totalFrames ? lost.length / ts.totalFrames : 0,
      jitterMs: this.jitterMs,
    });
  }

  _resetTalkspurt() {
    if (this._rxFlushTimer != null) { this._timer.cancel(this._rxFlushTimer); this._rxFlushTimer = null; }
    this._rxTalkspurt = null;
  }

  // ── RFC 3550 sequence / loss bookkeeping ────────────────────────────

  /** @param {number} seq */
  _initSeq(seq) {
    this._baseSeq = seq;
    this._maxSeq = seq;
    this._cycles = 0;
    this._rxReceived = 1;
    this._lastTransit = null;
    this._jitter = 0;
  }

  /** @param {number} seq */
  _updateSeq(seq) {
    const delta = (seq - this._maxSeq) & 0xffff;
    if (delta < 0x8000) {
      // in-order (possibly with a gap)
      if (seq < this._maxSeq) this._cycles += 0x10000;
      this._maxSeq = seq;
    }
    // reordered / duplicate packets still count as received
    this._rxReceived++;
  }

  /** Cumulative packets lost (never negative). */
  get lost() {
    const extendedMax = this._cycles + this._maxSeq;
    const expected = extendedMax - this._baseSeq + 1;
    return Math.max(0, expected - this._rxReceived);
  }

  get expected() {
    return (this._cycles + this._maxSeq) - this._baseSeq + 1;
  }

  get lossFraction() {
    const exp = this.expected;
    return exp > 0 ? this.lost / exp : 0;
  }

  /** @param {number} rtpTimestamp */
  _updateJitter(rtpTimestamp) {
    const arrivalRtp = Math.round(this._now() * CLOCK_RATE / 1000);
    const transit = arrivalRtp - rtpTimestamp;
    if (this._lastTransit != null) {
      const d = Math.abs(transit - this._lastTransit);
      this._jitter += (d - this._jitter) / 16;
    }
    this._lastTransit = transit;
  }

  get jitterMs() {
    return (this._jitter / CLOCK_RATE) * 1000;
  }

  /** @returns {{ ssrc:number, remoteSsrc:number|null, txPackets:number, txBytes:number, rxPackets:number, expected:number, lost:number, lossFraction:number, jitterMs:number }} */
  getStats() {
    return {
      ssrc: this._ssrc,
      remoteSsrc: this._remoteSsrc,
      txPackets: this._txPackets,
      txBytes: this._txBytes,
      rxPackets: this._rxPackets,
      expected: this._remoteSsrc == null ? 0 : this.expected,
      lost: this._remoteSsrc == null ? 0 : this.lost,
      lossFraction: this._remoteSsrc == null ? 0 : this.lossFraction,
      jitterMs: this.jitterMs,
    };
  }

  /** Stop all scheduled sends and flush any pending inbound talkspurt. */
  close() {
    for (const id of this._txTimers) this._timer.cancel(id);
    this._txTimers.clear();
    if (this._rxFlushTimer != null) { this._timer.cancel(this._rxFlushTimer); this._rxFlushTimer = null; }
    this._flushTalkspurt();
  }
}
