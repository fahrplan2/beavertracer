import { describe, it, expect, beforeEach } from 'vitest';
import { RtpSession } from '../../src/net/RtpSession.js';
import { RTPPacket } from '../../src/net/pdu/RTPPacket.js';

class FakeTimer {
  constructor() { this.now = 0; this.id = 1; this.q = new Map(); }
  schedule(cb, ms) { const id = this.id++; this.q.set(id, { at: this.now + Math.max(1, ms), cb }); return id; }
  cancel(id) { this.q.delete(id); }
  advance(ms) {
    const target = this.now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of this.q) if (t.at <= target && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      this.now = next.t.at;
      this.q.delete(next.id);
      next.t.cb();
    }
    this.now = target;
  }
}

/** Connect two sessions by "port"; drop(predicate) can black-hole packets. */
class MediaWire {
  constructor() { this.nodes = new Map(); this.drop = () => false; this.reorder = false; this._buf = []; }
  attach(port, session) { this.nodes.set(port, session); }
  transportFor(fromPort, toPort) {
    let n = 0;
    return {
      send: (bytes, _ip, _port) => {
        const seq = RTPPacket.fromBytes(bytes).sequenceNumber;
        if (this.drop(seq, n++)) return;
        const deliver = () => this.nodes.get(toPort)?.receive(bytes, '10.0.0.1', fromPort);
        if (this.reorder) { this._buf.push(deliver); if (this._buf.length === 2) { const [a, b] = this._buf.splice(0, 2); b(); a(); } }
        else deliver();
      },
    };
  }
  flush() { while (this._buf.length) this._buf.shift()(); }
}

let timer, wire, a, b;

beforeEach(() => {
  timer = new FakeTimer();
  wire = new MediaWire();
  a = new RtpSession({ transport: wire.transportFor(40000, 41000), timer, now: () => timer.now, rng: mkRng(1) });
  b = new RtpSession({ transport: wire.transportFor(41000, 40000), timer, now: () => timer.now, rng: mkRng(2) });
  wire.attach(40000, a);
  wire.attach(41000, b);
  a.setRemote('10.0.0.2', 41000);
  b.setRemote('10.0.0.1', 40000);
});

function mkRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

describe('sending', () => {
  it('refuses to play without a remote', () => {
    const lone = new RtpSession({ transport: { send() {} }, timer });
    expect(lone.playPhrase({ phraseId: 1, frameCount: 3 })).toBe(false);
  });

  it('emits one RTP packet per frame, marker on the first, seq/timestamp advancing', () => {
    const sent = [];
    a._transport = { send: (bytes) => sent.push(RTPPacket.fromBytes(bytes)) };
    a.playPhrase({ phraseId: 7, frameCount: 5 });
    timer.advance(5 * 100 + 50);

    expect(sent.length).toBe(5);
    expect(sent[0].marker).toBe(true);
    expect(sent.slice(1).every(p => p.marker === false)).toBe(true);
    expect(sent[1].sequenceNumber).toBe((sent[0].sequenceNumber + 1) & 0xffff);
    expect(sent[1].timestamp - sent[0].timestamp).toBe(800); // 8 kHz * 100 ms
    expect(sent.every(p => p.ssrc === a.ssrc)).toBe(true);
  });

  it('burst pacing compresses the schedule', () => {
    const sent = [];
    a._transport = { send: (bytes) => sent.push(bytes) };
    const fast = new RtpSession({ transport: { send: (x) => sent.push(x) }, timer, pacing: 'burst', burstIntervalMs: 5 });
    fast.setRemote('10.0.0.2', 41000);
    fast.playPhrase({ phraseId: 1, frameCount: 10 });
    timer.advance(10 * 5 + 10);
    expect(sent.length).toBe(10);
  });
});

describe('receiving a clean talkspurt', () => {
  it('reports every frame received, no loss, and fires firstPacket + talkstart', () => {
    let first = false;
    b.on('firstPacket', () => { first = true; });
    const starts = [];
    b.on('talkstart', (s) => starts.push(s));
    const spurts = [];
    b.on('talkspurt', (t) => spurts.push(t));

    a.playPhrase({ phraseId: 3, frameCount: 8 });
    timer.advance(8 * 100 + 500);

    expect(first).toBe(true);
    expect(starts).toEqual([{ phraseId: 3, totalFrames: 8 }]);   // once, before the flush
    expect(spurts.length).toBe(1);
    expect(spurts[0].phraseId).toBe(3);
    expect(spurts[0].totalFrames).toBe(8);
    expect(spurts[0].receivedFrames).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(spurts[0].lostFrames).toEqual([]);
    expect(spurts[0].lossFraction).toBe(0);
    expect(b.getStats().rxPackets).toBe(8);
    expect(b.getStats().lost).toBe(0);
  });

  it('tolerates reordering', () => {
    wire.reorder = true;
    const spurts = [];
    b.on('talkspurt', (t) => spurts.push(t));
    a.playPhrase({ phraseId: 1, frameCount: 6 });
    timer.advance(6 * 100 + 500);
    wire.flush();
    timer.advance(500);

    expect(spurts[0].receivedFrames).toEqual([0, 1, 2, 3, 4, 5]);
    expect(b.getStats().lost).toBe(0);
  });
});

describe('receiving with loss', () => {
  it('lists exactly the missing frame indices and a matching loss fraction', () => {
    // drop the 2nd and 5th packets sent (0-based n = 1, 4)
    wire.drop = (_seq, n) => n === 1 || n === 4;
    const spurts = [];
    b.on('talkspurt', (t) => spurts.push(t));

    a.playPhrase({ phraseId: 9, frameCount: 10 });
    timer.advance(10 * 100 + 1000);

    expect(spurts.length).toBe(1);
    expect(spurts[0].lostFrames).toEqual([1, 4]);
    expect(spurts[0].receivedFrames).toEqual([0, 2, 3, 5, 6, 7, 8, 9]);
    expect(spurts[0].lossFraction).toBeCloseTo(0.2, 5);
    const st = b.getStats();
    expect(st.lost).toBe(2);
    expect(st.lossFraction).toBeCloseTo(2 / 10, 5);
  });

  it('still opens a talkspurt when the marker packet is lost', () => {
    wire.drop = (_seq, n) => n === 0;
    const spurts = [];
    b.on('talkspurt', (t) => spurts.push(t));
    a.playPhrase({ phraseId: 2, frameCount: 4 });
    timer.advance(4 * 100 + 1000);

    expect(spurts.length).toBe(1);
    expect(spurts[0].lostFrames).toEqual([0]);
    expect(spurts[0].receivedFrames).toEqual([1, 2, 3]);
  });
});

describe('talkspurt end detection', () => {
  it('flushes after a grace period when frames simply stop arriving', () => {
    // deliver only the first 3 of 10, then go silent
    wire.drop = (_seq, n) => n >= 3;
    const spurts = [];
    b.on('talkspurt', (t) => spurts.push(t));

    a.playPhrase({ phraseId: 1, frameCount: 10 });
    timer.advance(3 * 100 + 10);
    expect(spurts.length).toBe(0);          // grace not elapsed yet
    timer.advance(100 * 4 + 10);            // > TALKSPURT_GRACE_FRAMES * ptime
    expect(spurts.length).toBe(1);
    expect(spurts[0].receivedFrames).toEqual([0, 1, 2]);
    expect(spurts[0].lostFrames.length).toBe(7);
  });

  it('a new marker flushes the previous talkspurt', () => {
    const spurts = [];
    b.on('talkspurt', (t) => spurts.push(t));

    a.playPhrase({ phraseId: 1, frameCount: 3 });
    timer.advance(3 * 100 + 10);
    a.playPhrase({ phraseId: 2, frameCount: 3 });
    timer.advance(3 * 100 + 500);

    expect(spurts.map(s => s.phraseId)).toEqual([1, 2]);
  });
});

describe('SSRC change', () => {
  it('follows a new SSRC and reports it', () => {
    const changes = [];
    b.on('ssrcChange', (c) => changes.push(c));

    a.playPhrase({ phraseId: 1, frameCount: 2 });
    timer.advance(300);

    const a2 = new RtpSession({ transport: wire.transportFor(40000, 41000), timer, now: () => timer.now, rng: mkRng(99) });
    a2.setRemote('10.0.0.2', 41000);
    a2.playPhrase({ phraseId: 1, frameCount: 2 });
    timer.advance(300);

    expect(changes.length).toBe(1);
    expect(changes[0].newSsrc).toBe(a2.ssrc);
    expect(b.remoteSsrc).toBe(a2.ssrc);
  });
});
