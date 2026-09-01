//@ts-check

import { describe, it, expect, beforeEach } from 'vitest';
import { StunClient } from '../../src/net/StunClient.js';
import { StunMessage } from '../../src/net/pdu/StunMessage.js';

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

/** A stateless STUN server, wired directly to a client's transport for the test. */
function makeFakeServer({ ip = '203.0.113.1', port = 3478, drop = 0 } = {}) {
  let dropped = 0;
  /** @type {StunClient|null} */
  let client = null;
  const transport = {
    send(bytes, dstIp, dstPort) {
      if (dstIp !== ip || dstPort !== port) return;
      let req;
      try { req = StunMessage.fromBytes(bytes); } catch { return; }
      if (dropped < drop) { dropped++; return; } // simulate loss of the first `drop` attempts
      const resp = StunMessage.bindingSuccess(req.transactionId, '9.9.9.9', 51000);
      client?.receive(resp.pack(), ip, port);
    },
  };
  return { ip, port, transport, bindClient: (c) => { client = c; } };
}

describe('StunClient.bind()', () => {
  /** @type {FakeTimer} */
  let timer;

  beforeEach(() => { timer = new FakeTimer(); });

  it('resolves with the server-observed address on the first try', async () => {
    const server = makeFakeServer();
    const client = new StunClient({ transport: server.transport, timer, rng: () => 0.5 });
    server.bindClient(client);

    const addr = await client.bind({ serverIp: server.ip, serverPort: server.port });
    expect(addr).toEqual({ ip: '9.9.9.9', port: 51000 });
  });

  it('retransmits on loss and still resolves once the retry gets through', async () => {
    const server = makeFakeServer({ drop: 1 }); // first attempt is lost
    const client = new StunClient({ transport: server.transport, timer, rng: () => 0.5 });
    server.bindClient(client);

    const p = client.bind({ serverIp: server.ip, serverPort: server.port });
    timer.advance(1000); // past the first retransmit, well under the overall timeout
    await expect(p).resolves.toEqual({ ip: '9.9.9.9', port: 51000 });
  });

  it('rejects once the overall timeout elapses with no response', async () => {
    const server = makeFakeServer({ drop: Infinity }); // never answers
    const client = new StunClient({ transport: server.transport, timer, rng: () => 0.5 });
    server.bindClient(client);

    const p = client.bind({ serverIp: server.ip, serverPort: server.port });
    p.catch(() => {}); // avoid an unhandled-rejection warning while we advance the clock
    timer.advance(5000);
    await expect(p).rejects.toThrow(/timed out/);
  });

  it('rejects on a Binding Error Response', async () => {
    const client = new StunClient({
      transport: {
        send: (bytes) => {
          const req = StunMessage.fromBytes(bytes);
          client.receive(StunMessage.bindingError(req.transactionId, 400, 'Bad Request').pack(), '203.0.113.1', 3478);
        },
      },
      timer,
    });
    await expect(client.bind({ serverIp: '203.0.113.1' })).rejects.toThrow(/400/);
  });
});

describe('StunClient.receive()', () => {
  it('returns false for non-STUN bytes so the caller can fall through to its own parser', () => {
    const client = new StunClient({ transport: { send() {} } });
    expect(client.receive(new Uint8Array([1, 2, 3, 4]), '10.0.0.1', 1234)).toBe(false);
  });

  it('returns true for a STUN message even if it matches no pending request', () => {
    const client = new StunClient({ transport: { send() {} } });
    const stray = StunMessage.bindingSuccess(new Uint8Array(12), '1.2.3.4', 5555);
    expect(client.receive(stray.pack(), '10.0.0.1', 1234)).toBe(true);
  });
});

describe('StunClient.dispose()', () => {
  it('rejects every in-flight bind()', async () => {
    const timer = new FakeTimer();
    const client = new StunClient({ transport: { send() {} }, timer });
    const p = client.bind({ serverIp: '203.0.113.1' });
    client.dispose();
    await expect(p).rejects.toThrow(/disposed/);
  });
});
