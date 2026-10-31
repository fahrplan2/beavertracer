import { describe, it, expect, beforeEach } from 'vitest';
import { SipRegistrarProxy } from '../../src/net/SipRegistrarProxy.js';
import { SipStack } from '../../src/net/SipStack.js';
import { SIPMessage } from '../../src/net/pdu/SIPMessage.js';
import { SdpMessage } from '../../src/net/pdu/SdpMessage.js';

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

class Wire {
  constructor() { this.nodes = new Map(); this.log = []; }
  attach(ip, port, obj) { this.nodes.set(`${ip}:${port}`, { ip, port, obj }); }
  transportFor(ip, port) {
    return {
      send: (bytes, dstIp, dstPort) => {
        this.log.push({ from: ip, to: dstIp, line: SIPMessage.parse(bytes).startLine() });
        this.nodes.get(`${dstIp}:${dstPort}`)?.obj.receive(bytes, ip, port);
      },
    };
  }
  lines() { return this.log.map(e => `${e.from}->${e.to} ${e.line}`); }
}

const PROXY = '10.0.0.9';
let wire, timer, proxy, alice, bob, events;

function mkStack(ip, uri) {
  return new SipStack({
    transport: wire.transportFor(ip, 5060), timer, rng: () => 0.5,
    identity: { uri, displayName: uri.split(':')[1].split('@')[0], contactIp: ip, contactPort: 5060 },
  });
}

beforeEach(() => {
  wire = new Wire();
  timer = new FakeTimer();
  events = [];
  proxy = new SipRegistrarProxy({
    transport: wire.transportFor(PROXY, 5060), timer, now: () => timer.now,
    selfAddr: { ip: PROXY, port: 5060 }, domain: 'example.com',
  });
  for (const ev of ['register', 'unregister', 'forward', 'respond', 'drop']) {
    proxy.on(ev, (d) => events.push({ ev, d }));
  }
  alice = mkStack('10.0.0.1', 'sip:alice@example.com');
  bob = mkStack('10.0.0.2', 'sip:bob@example.com');
  wire.attach(PROXY, 5060, proxy);
  wire.attach('10.0.0.1', 5060, alice);
  wire.attach('10.0.0.2', 5060, bob);
});

describe('registrar', () => {
  it('creates a binding and answers 200 with Expires', () => {
    alice.register({ registrarIp: PROXY, expires: 600 });
    expect(alice.registered).toBe(true);
    const b = proxy.lookup('sip:alice@example.com');
    expect(b).toBeTruthy();
    expect(b.contactIp).toBe('10.0.0.1');
    expect(b.contactPort).toBe(5060);
    expect(events.find(e => e.ev === 'register').d.expires).toBe(600);
  });

  it('binds to the observed source, not a private IP in the Contact URI (NAT)', () => {
    const reg = SIPMessage.request('REGISTER', `sip:${PROXY}`, [
      ['Via', 'SIP/2.0/UDP 192.168.1.50:5060;branch=z9hG4bKnat;rport'],
      ['From', '<sip:dave@example.com>;tag=d1'],
      ['To', '<sip:dave@example.com>'],
      ['Call-ID', 'reg-dave'],
      ['CSeq', '1 REGISTER'],
      ['Contact', '<sip:dave@192.168.1.50:5060>'], // dave's private, pre-NAT address
      ['Expires', '600'],
    ]);
    // ...but the packet actually arrives from the router's WAN-mapped address
    proxy.receive(reg.pack(), '203.0.113.9', 40222);

    const b = proxy.lookup('sip:dave@example.com');
    expect(b.contactIp).toBe('203.0.113.9');
    expect(b.contactPort).toBe(40222);
  });

  it('removes the binding on Expires: 0', () => {
    alice.register({ registrarIp: PROXY, expires: 600 });
    alice.unregister();
    expect(proxy.lookup('sip:alice@example.com')).toBeUndefined();
    expect(events.some(e => e.ev === 'unregister' && e.d.reason === 'explicit')).toBe(true);
  });

  it('expires a binding on the sim clock', () => {
    // craft a bare REGISTER so no live client keeps refreshing it
    const reg = SIPMessage.request('REGISTER', `sip:${PROXY}`, [
      ['Via', 'SIP/2.0/UDP 10.0.0.1:5060;branch=z9hG4bKreg'],
      ['From', '<sip:carol@example.com>;tag=c1'],
      ['To', '<sip:carol@example.com>'],
      ['Call-ID', 'reg-carol'],
      ['CSeq', '1 REGISTER'],
      ['Contact', '<sip:carol@10.0.0.3:5060>'],
      ['Expires', '60'],
    ]);
    proxy.receive(reg.pack(), '10.0.0.1', 5060);
    expect(proxy.lookup('sip:carol@example.com')).toBeTruthy();
    timer.advance(61_000);
    expect(proxy.bindings.length).toBe(0);
    expect(events.some(e => e.ev === 'unregister' && e.d.reason === 'expired')).toBe(true);
  });
});

describe('proxy call routing', () => {
  beforeEach(() => {
    alice.register({ registrarIp: PROXY, expires: 3600 });
    bob.register({ registrarIp: PROXY, expires: 3600 });
    events.length = 0;
  });

  it('routes INVITE to the registered contact and connects the call', () => {
    let incoming;
    bob.on('incomingCall', (c) => { incoming = c; });
    let answeredSdp = null;
    alice.on('answered', (_id, { sdp }) => { answeredSdp = sdp; });

    const callId = alice.call({
      targetUri: 'sip:bob@example.com', peerIp: PROXY,
      sdp: SdpMessage.audioOffer({ address: '10.0.0.1', port: 40000 }).toString(),
    });

    expect(incoming).toBeTruthy();
    expect(events.some(e => e.ev === 'forward' && e.d.method === 'INVITE' && e.d.dstIp === '10.0.0.2')).toBe(true);

    incoming.answer(SdpMessage.audioOffer({ address: '10.0.0.2', port: 41000 }).toString());

    expect(alice.getCall(callId).state).toBe('in-call');
    expect(bob.calls[0].state).toBe('in-call');
    expect(SdpMessage.parse(answeredSdp).audio.port).toBe(41000);
    // Bob's Contact (10.0.0.2) became Alice's remote target → in-dialog goes direct
    expect(alice.getCall(callId).remoteTarget).toContain('10.0.0.2');
  });

  it('BYE tears the call down on both sides', () => {
    let incoming;
    bob.on('incomingCall', (c) => { incoming = c; });
    const callId = alice.call({
      targetUri: 'sip:bob@example.com', peerIp: PROXY,
      sdp: SdpMessage.audioOffer({ address: '10.0.0.1', port: 40000 }).toString(),
    });
    incoming.answer(SdpMessage.audioOffer({ address: '10.0.0.2', port: 41000 }).toString());

    alice.hangup(callId);
    expect(alice.getCall(callId).state).toBe('ended');
    expect(bob.calls[0].state).toBe('ended');
  });

  it('replies 404 for an unregistered target', () => {
    bob.register({ registrarIp: PROXY, expires: 0 }); // drop Bob's binding
    events.length = 0;
    const ended = [];
    alice.on('ended', (_id, d) => ended.push(d));

    alice.call({
      targetUri: 'sip:bob@example.com', peerIp: PROXY,
      sdp: SdpMessage.audioOffer({ address: '10.0.0.1', port: 40000 }).toString(),
    });

    expect(events.some(e => e.ev === 'respond' && e.d.code === 404)).toBe(true);
    expect(ended[0].reason).toBe('not-found');
  });

  it('pushes and pops its own Via so responses find their way back', () => {
    let incoming;
    bob.on('incomingCall', (c) => { incoming = c; });
    alice.call({
      targetUri: 'sip:bob@example.com', peerIp: PROXY,
      sdp: SdpMessage.audioOffer({ address: '10.0.0.1', port: 40000 }).toString(),
    });
    // INVITE reached Bob carrying two Via rows: Bob's peer then Alice's
    const inviteAtBob = wire.log.find(e => e.to === '10.0.0.2' && e.line.startsWith('INVITE'));
    expect(inviteAtBob).toBeTruthy();
    // 180/200 made it back to Alice (proxied)
    incoming.answer(SdpMessage.audioOffer({ address: '10.0.0.2', port: 41000 }).toString());
    expect(wire.log.some(e => e.to === '10.0.0.1' && e.line.includes('200 OK'))).toBe(true);
  });
});

// ── RFC 3261 §16.11 / §17.1.1.3 / §9.1 via the stateless proxy ────────────

describe('stateless proxy: INVITE / CANCEL / ACK share a branch (§16.11)', () => {
  /** rng yielding a varying sequence so every branch is distinct */
  function seqRng() { let x = 0.123; return () => { x = (x * 9301 + 0.49297) % 1; return x; }; }

  beforeEach(() => {
    // fresh stacks with distinct tokens (the default fixture rng repeats)
    alice = new SipStack({
      transport: wire.transportFor('10.0.0.1', 5060), timer, rng: seqRng(),
      identity: { uri: 'sip:alice@example.com', contactIp: '10.0.0.1', contactPort: 5060 },
    });
    bob = new SipStack({
      transport: wire.transportFor('10.0.0.2', 5060), timer, rng: seqRng(),
      identity: { uri: 'sip:bob@example.com', contactIp: '10.0.0.2', contactPort: 5060 },
    });
    wire.attach('10.0.0.1', 5060, alice);
    wire.attach('10.0.0.2', 5060, bob);
    alice.register({ registrarIp: PROXY, expires: 3600 });
    bob.register({ registrarIp: PROXY, expires: 3600 });
    wire.log.length = 0;
  });

  function captureBob() {
    const seen = [];
    const orig = bob.receive.bind(bob);
    bob.receive = (bytes, ip, port) => { seen.push(SIPMessage.parse(bytes)); orig(bytes, ip, port); };
    return seen;
  }

  it('486 through the proxy: the ACK matches Bob\'s INVITE transaction, no 486 retransmits', () => {
    const seen = captureBob();
    bob.on('incomingCall', (c) => c.reject(486, 'Busy Here'));
    const ended = [];
    alice.on('ended', (_id, d) => ended.push(d.reason));
    alice.call({
      targetUri: 'sip:bob@example.com', peerIp: PROXY,
      sdp: SdpMessage.audioOffer({ address: '10.0.0.1', port: 40000 }).toString(),
    });
    timer.advance(40_000); // past Timer H

    const invite = seen.find(m => m.method === 'INVITE');
    const ack = seen.find(m => m.method === 'ACK');
    expect(ack).toBeTruthy();
    expect(ack.topViaBranch).toBe(invite.topViaBranch);
    const busyFromBob = wire.log.filter(e => e.from === '10.0.0.2' && e.line.includes('486'));
    expect(busyFromBob.length).toBe(1);
    expect(ended).toEqual(['busy']);
  });

  it('hangup while ringing: CANCEL after 180, 200/CANCEL, 487 ACKed with the INVITE branch', () => {
    const seen = captureBob();
    bob.on('incomingCall', () => { /* let it ring */ });
    const aliceEnded = [];
    alice.on('ended', (_id, d) => aliceEnded.push(d.reason));
    const callId = alice.call({
      targetUri: 'sip:bob@example.com', peerIp: PROXY,
      sdp: SdpMessage.audioOffer({ address: '10.0.0.1', port: 40000 }).toString(),
    });
    expect(alice.getCall(callId).state).toBe('ringing');
    alice.hangup(callId);
    timer.advance(40_000);

    const lines = wire.lines();
    const i180 = lines.findIndex(l => l.startsWith(`${PROXY}->10.0.0.1`) && l.includes('180'));
    const iCancel = lines.findIndex(l => l.startsWith('10.0.0.1->') && l.includes('CANCEL'));
    expect(i180).toBeGreaterThanOrEqual(0);
    expect(iCancel).toBeGreaterThan(i180);

    const invite = seen.find(m => m.method === 'INVITE');
    const cancel = seen.find(m => m.method === 'CANCEL');
    const ack = seen.find(m => m.method === 'ACK');
    expect(cancel.topViaBranch).toBe(invite.topViaBranch);
    expect(ack).toBeTruthy();
    expect(ack.topViaBranch).toBe(invite.topViaBranch);

    expect(wire.log.filter(e => e.from === '10.0.0.2' && e.line.includes('487')).length).toBe(1);
    expect(wire.log.some(e => e.to === '10.0.0.1' && e.line.includes('200 OK'))).toBe(true);
    expect(aliceEnded).toEqual(['hangup']);
    expect(bob.calls[0].state).toBe('ended');
  });

  it('a 2xx ACK (fresh UAC branch) gets a different proxy branch than the INVITE', () => {
    const seen = captureBob();
    bob.on('incomingCall', (c) => c.answer(SdpMessage.audioOffer({ address: '10.0.0.2', port: 41000 }).toString()));
    alice.call({
      targetUri: 'sip:bob@example.com', peerIp: PROXY,
      sdp: SdpMessage.audioOffer({ address: '10.0.0.1', port: 40000 }).toString(),
    });
    const invite = seen.find(m => m.method === 'INVITE');
    // forge the same ACK the UAC would send, but via the proxy
    const ack = SIPMessage.request('ACK', 'sip:bob@example.com', [
      ['Via', 'SIP/2.0/UDP 10.0.0.1:5060;branch=z9hG4bKfreshackbranch'],
      ['From', invite.getHeader('From')], ['To', invite.getHeader('To')],
      ['Call-ID', invite.getHeader('Call-ID')], ['CSeq', '1 ACK'],
    ]);
    proxy.receive(ack.pack(), '10.0.0.1', 5060);
    const fwdAck = seen.filter(m => m.method === 'ACK').pop();
    expect(fwdAck.topViaBranch).not.toBe(invite.topViaBranch);
  });
});
