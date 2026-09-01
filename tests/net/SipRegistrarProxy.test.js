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
