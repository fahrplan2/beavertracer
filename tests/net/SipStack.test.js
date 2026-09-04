import { describe, it, expect, beforeEach } from 'vitest';
import { SipStack } from '../../src/net/SipStack.js';
import { SIPMessage } from '../../src/net/pdu/SIPMessage.js';
import { SdpMessage } from '../../src/net/pdu/SdpMessage.js';

// ── test doubles ──────────────────────────────────────────────────────────

/** Deterministic, manually-advanced timer. */
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

/** In-memory UDP-ish fabric connecting stacks by IP, with optional loss. */
class Wire {
  constructor() { this.nodes = new Map(); this.drop = () => false; this.log = []; }
  attach(ip, port, stack) { this.nodes.set(ip, { port, stack }); }
  transportFor(ip, port) {
    return {
      send: (bytes, dstIp, dstPort) => {
        const msg = SIPMessage.parse(bytes);
        this.log.push({ from: ip, to: dstIp, line: msg.startLine() });
        if (this.drop(msg, ip, dstIp)) return;
        const dst = this.nodes.get(dstIp);
        if (dst) dst.stack.receive(bytes, ip, port);
      },
    };
  }
  linesFrom(ip) { return this.log.filter(e => e.from === ip).map(e => e.line); }
}

/** Minimal registrar that answers every REGISTER with 200 OK. */
function attachRegistrar(wire, ip, port = 5060) {
  const bindings = new Map();
  const stub = {
    receive(bytes, srcIp, srcPort) {
      const req = SIPMessage.parse(bytes);
      if (req.method !== 'REGISTER') return;
      const aor = SIPMessage.uriOf(req.getHeader('To'));
      const contact = SIPMessage.uriOf(req.getHeader('Contact'));
      const expires = Number(req.getHeader('Expires') ?? '3600');
      if (expires === 0) bindings.delete(aor); else bindings.set(aor, contact);
      const resp = SIPMessage.response(200, 'OK');
      for (const v of req.getHeaders('Via')) resp.addHeader('Via', v);
      resp.setHeader('From', req.getHeader('From'));
      const to = req.getHeader('To');
      resp.setHeader('To', SIPMessage.tagOf(to) ? to : `${to};tag=reg${Math.random().toString(36).slice(2, 6)}`);
      resp.setHeader('Call-ID', req.getHeader('Call-ID'));
      resp.setHeader('CSeq', req.getHeader('CSeq'));
      resp.setHeader('Contact', `${req.getHeader('Contact')}`);
      wire.nodes.get(srcIp)?.stack.receive(resp.pack(), ip, port);
    },
  };
  wire.attach(ip, port, stub);
  return bindings;
}

/**
 * Minimal stateless proxy that retargets every request straight back to its
 * sender — i.e. what a registrar/proxy does when a UA's own AOR is the
 * Request-URI. Responses have the proxy's top Via popped and are relayed on.
 */
function attachLoopProxy(wire, ip, port = 5060) {
  const nextHop = (via) => {
    const m = via.match(/UDP\s+([^:;\s]+)(?::(\d+))?/i);
    return m ? { ip: m[1], port: m[2] ? Number(m[2]) : 5060 } : null;
  };
  const stub = {
    receive(bytes, srcIp, srcPort) {
      const msg = SIPMessage.parse(bytes);
      if (msg.kind === 'response') {
        const vias = msg.getHeaders('Via');
        msg.removeHeader('Via');
        for (let i = 1; i < vias.length; i++) msg.addHeader('Via', vias[i]);
        const hop = nextHop(vias[1] ?? '');
        if (hop) wire.nodes.get(hop.ip)?.stack.receive(msg.pack(), ip, port);
        return;
      }
      if (msg.method === 'ACK') return; // absorbed by the loop
      msg.prependHeader('Via', `SIP/2.0/UDP ${ip}:${port};branch=z9hG4bKproxy${Math.random().toString(36).slice(2, 8)}`);
      wire.nodes.get(srcIp)?.stack.receive(msg.pack(), ip, port);
    },
  };
  wire.attach(ip, port, stub);
}

// ── fixtures ──────────────────────────────────────────────────────────────

let wire, timer, alice, bob;
let events;

function mkStack(ip, uri, displayName) {
  const s = new SipStack({
    transport: wire.transportFor(ip, 5060),
    timer,
    rng: () => 0.4241, // stable-ish tokens
    identity: { uri, displayName, contactIp: ip, contactPort: 5060 },
  });
  return s;
}

function record(stack, name) {
  for (const ev of ['registrationState', 'incomingCall', 'progress', 'answered', 'ended']) {
    stack.on(ev, (...a) => events.push({ who: name, ev, args: a }));
  }
}

const OFFER = SdpMessage.audioOffer({ address: '10.0.0.1', port: 40000 }).toString();
const ANSWER = SdpMessage.audioOffer({ address: '10.0.0.2', port: 41000 }).toString();

beforeEach(() => {
  wire = new Wire();
  timer = new FakeTimer();
  events = [];
  alice = mkStack('10.0.0.1', 'sip:alice@example.com', 'Alice');
  bob = mkStack('10.0.0.2', 'sip:bob@example.com', 'Bob');
  wire.attach('10.0.0.1', 5060, alice);
  wire.attach('10.0.0.2', 5060, bob);
  record(alice, 'alice');
  record(bob, 'bob');
});

// ── tests ─────────────────────────────────────────────────────────────────

describe('registration', () => {
  it('marks the stack registered on a 200 OK', () => {
    attachRegistrar(wire, '10.0.0.9');
    alice.register({ registrarIp: '10.0.0.9', expires: 600 });
    expect(alice.registered).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ who: 'alice', ev: 'registrationState' }));
    const reg = events.find(e => e.ev === 'registrationState');
    expect(reg.args[0]).toBe('registered');
  });

  it('re-REGISTERs around half the expiry', () => {
    attachRegistrar(wire, '10.0.0.9');
    alice.register({ registrarIp: '10.0.0.9', expires: 600 });
    const before = wire.linesFrom('10.0.0.1').filter(l => l.startsWith('REGISTER')).length;
    timer.advance(600_000 / 2 + 10);
    const after = wire.linesFrom('10.0.0.1').filter(l => l.startsWith('REGISTER')).length;
    expect(after).toBe(before + 1);
  });
});

describe('basic call', () => {
  it('completes INVITE / 180 / 200 / ACK and carries SDP both ways', () => {
    let incoming;
    bob.on('incomingCall', (c) => { incoming = c; });

    const callId = alice.call({ targetUri: 'sip:bob@example.com', peerIp: '10.0.0.2', sdp: OFFER });
    expect(incoming).toBeTruthy();
    expect(incoming.fromUri).toBe('sip:alice@example.com');
    expect(SdpMessage.parse(incoming.sdp).audio.port).toBe(40000);

    // alice saw ringing
    expect(events.some(e => e.who === 'alice' && e.ev === 'progress' && e.args[1].code === 180)).toBe(true);

    incoming.answer(ANSWER);

    const answered = events.find(e => e.who === 'alice' && e.ev === 'answered');
    expect(answered).toBeTruthy();
    expect(SdpMessage.parse(answered.args[1].sdp).audio.port).toBe(41000);

    expect(alice.getCall(callId).state).toBe('in-call');
    expect(bob.calls[0].state).toBe('in-call');

    // the 200 OK must not keep retransmitting after the ACK
    const before200 = wire.linesFrom('10.0.0.2').filter(l => l.includes('200 OK')).length;
    timer.advance(60_000);
    const after200 = wire.linesFrom('10.0.0.2').filter(l => l.includes('200 OK')).length;
    expect(after200).toBe(before200);
  });

  it('BYE from the caller ends the dialog on both sides', () => {
    let incoming;
    bob.on('incomingCall', (c) => { incoming = c; });
    const callId = alice.call({ targetUri: 'sip:bob@example.com', peerIp: '10.0.0.2', sdp: OFFER });
    incoming.answer(ANSWER);

    alice.hangup(callId);

    expect(alice.getCall(callId).state).toBe('ended');
    expect(bob.calls[0].state).toBe('ended');
    const bobEnded = events.find(e => e.who === 'bob' && e.ev === 'ended');
    expect(bobEnded.args[1].reason).toBe('remote-bye');
    expect(wire.linesFrom('10.0.0.1').some(l => l.startsWith('BYE'))).toBe(true);
  });

  it('reject with 486 surfaces as reason "busy" to the caller', () => {
    let incoming;
    bob.on('incomingCall', (c) => { incoming = c; });
    const callId = alice.call({ targetUri: 'sip:bob@example.com', peerIp: '10.0.0.2', sdp: OFFER });

    incoming.reject(486, 'Busy Here');

    const aliceEnded = events.find(e => e.who === 'alice' && e.ev === 'ended');
    expect(aliceEnded.args[1].reason).toBe('busy');
    expect(alice.getCall(callId).state).toBe('ended');
    expect(wire.linesFrom('10.0.0.1').some(l => l.startsWith('ACK'))).toBe(true);
  });

  it('dialing our own AOR loops back and is rejected as busy, not answered', () => {
    attachLoopProxy(wire, '10.0.0.9');

    const callId = alice.call({ targetUri: 'sip:alice@example.com', peerIp: '10.0.0.9', sdp: OFFER });

    // the spiralled INVITE must not surface as an incoming call or get answered
    expect(events.some(e => e.who === 'alice' && e.ev === 'incomingCall')).toBe(false);
    expect(events.some(e => e.who === 'alice' && e.ev === 'answered')).toBe(false);

    const ended = events.find(e => e.who === 'alice' && e.ev === 'ended');
    expect(ended?.args[1].reason).toBe('busy');
    expect(alice.getCall(callId).state).toBe('ended');
    expect(wire.linesFrom('10.0.0.1').some(l => l.includes('486'))).toBe(true);
  });

  it('caller CANCEL during ringing yields 487 and ends both sides', () => {
    let incoming;
    bob.on('incomingCall', (c) => { incoming = c; });
    const callId = alice.call({ targetUri: 'sip:bob@example.com', peerIp: '10.0.0.2', sdp: OFFER });
    // do not answer; alice hangs up while ringing
    alice.hangup(callId);

    expect(wire.linesFrom('10.0.0.1').some(l => l.startsWith('CANCEL'))).toBe(true);
    expect(alice.getCall(callId).state).toBe('ended');
    expect(bob.calls[0].state).toBe('ended');
    const bobEnded = events.find(e => e.who === 'bob' && e.ev === 'ended');
    expect(bobEnded.args[1].reason).toBe('canceled');
  });
});

describe('retransmission under loss', () => {
  it('re-sends the INVITE after T1 when the first is dropped, and still connects', () => {
    let incoming;
    bob.on('incomingCall', (c) => { incoming = c; });

    let dropped = false;
    wire.drop = (msg) => {
      if (!dropped && msg.method === 'INVITE') { dropped = true; return true; }
      return false;
    };

    const callId = alice.call({ targetUri: 'sip:bob@example.com', peerIp: '10.0.0.2', sdp: OFFER });
    expect(incoming).toBeUndefined();               // first INVITE was lost
    timer.advance(600);                             // > T1
    expect(incoming).toBeTruthy();                  // retransmit got through

    incoming.answer(ANSWER);
    expect(alice.getCall(callId).state).toBe('in-call');
    const invites = wire.linesFrom('10.0.0.1').filter(l => l.startsWith('INVITE')).length;
    expect(invites).toBeGreaterThanOrEqual(2);
  });

  it('gives up with reason "timeout" after Timer B', () => {
    wire.drop = (msg) => msg.method === 'INVITE';   // black-hole every INVITE
    const callId = alice.call({ targetUri: 'sip:bob@example.com', peerIp: '10.0.0.2', sdp: OFFER });
    timer.advance(64 * 500 + 1000);
    const ended = events.find(e => e.who === 'alice' && e.ev === 'ended');
    expect(ended.args[1].reason).toBe('timeout');
    expect(alice.getCall(callId).state).toBe('ended');
  });
});

describe('OPTIONS keepalive', () => {
  it('answers OPTIONS with 200 and an Allow header', () => {
    const opt = SIPMessage.request('OPTIONS', 'sip:bob@example.com', [
      ['Via', 'SIP/2.0/UDP 10.0.0.1:5060;branch=z9hG4bKopt'],
      ['From', '<sip:alice@example.com>;tag=1'],
      ['To', '<sip:bob@example.com>'],
      ['Call-ID', 'opt-1'],
      ['CSeq', '1 OPTIONS'],
    ]);
    bob.receive(opt.pack(), '10.0.0.1', 5060);
    const reply = wire.log.find(e => e.from === '10.0.0.2');
    expect(reply.line).toContain('200 OK');
  });
});
