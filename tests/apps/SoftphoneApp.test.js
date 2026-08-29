import { describe, it, expect } from 'vitest';
import { SoftphoneApp } from '../../src/apps/SoftphoneApp.js';
import { SipStack } from '../../src/net/SipStack.js';
import { RtpSession } from '../../src/net/RtpSession.js';
import { SdpMessage } from '../../src/net/pdu/SdpMessage.js';

/**
 * The SoftphoneApp UI needs a DOM; vitest runs in node here, so this only
 * smoke-checks that the module wires together and that the SIP + RTP + SDP
 * pieces it depends on interoperate the way the app drives them.
 */

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
      this.now = next.t.at; this.q.delete(next.id); next.t.cb();
    }
    this.now = target;
  }
}

describe('SoftphoneApp module', () => {
  it('exports a class with the expected surface', () => {
    expect(typeof SoftphoneApp).toBe('function');
    expect(SoftphoneApp.prototype.run).toBeTypeOf('function');
    expect(SoftphoneApp.prototype._placeCall).toBeTypeOf('function');
    expect(SoftphoneApp.prototype._acceptIncoming).toBeTypeOf('function');
  });
});

describe('the offer/answer + RTP flow the app performs', () => {
  it('agrees on RTP endpoints via SDP and exchanges a talkspurt', () => {
    const timer = new FakeTimer();
    const nodes = new Map();
    const send = (fromIp) => (bytes, dstIp, dstPort) => nodes.get(`${dstIp}:${dstPort}`)?.(bytes, fromIp);

    const aliceSip = new SipStack({
      transport: { send: send('10.0.0.1') }, timer, rng: () => 0.11,
      identity: { uri: 'sip:alice@x', displayName: 'Alice', contactIp: '10.0.0.1', contactPort: 5060 },
    });
    const bobSip = new SipStack({
      transport: { send: send('10.0.0.2') }, timer, rng: () => 0.77,
      identity: { uri: 'sip:bob@x', displayName: 'Bob', contactIp: '10.0.0.2', contactPort: 5060 },
    });
    nodes.set('10.0.0.1:5060', (b, from) => aliceSip.receive(b, from, 5060));
    nodes.set('10.0.0.2:5060', (b, from) => bobSip.receive(b, from, 5060));

    const aliceRtp = new RtpSession({ transport: { send: send('10.0.0.1') }, timer, now: () => timer.now });
    const bobRtp = new RtpSession({ transport: { send: send('10.0.0.2') }, timer, now: () => timer.now });
    nodes.set('10.0.0.1:40000', (b, from) => aliceRtp.receive(b, from, 41000));
    nodes.set('10.0.0.2:41000', (b, from) => bobRtp.receive(b, from, 40000));

    let bobsCall;
    bobSip.on('incomingCall', (c) => { bobsCall = c; });
    let answeredSdp = null;
    aliceSip.on('answered', (_id, { sdp }) => { answeredSdp = sdp; });
    const heard = [];
    bobRtp.on('talkspurt', (t) => heard.push(t));

    aliceSip.call({
      targetUri: 'sip:bob@x', peerIp: '10.0.0.2',
      sdp: SdpMessage.audioOffer({ address: '10.0.0.1', port: 40000 }).toString(),
    });
    expect(bobsCall).toBeTruthy();

    const bOffer = SdpMessage.parse(bobsCall.sdp);
    bobRtp.setRemote(bOffer.addressFor(bOffer.audio), bOffer.audio.port);
    bobsCall.answer(SdpMessage.audioOffer({ address: '10.0.0.2', port: 41000 }).toString());

    const aAns = SdpMessage.parse(answeredSdp);
    aliceRtp.setRemote(aAns.addressFor(aAns.audio), aAns.audio.port);
    expect(aAns.audio.port).toBe(41000);

    aliceRtp.playPhrase({ phraseId: 1, frameCount: aliceRtp.frameCountFor(900) });
    timer.advance(5000);

    expect(heard.length).toBe(1);
    expect(heard[0].phraseId).toBe(1);
    expect(heard[0].lostFrames).toEqual([]);
  });
});
