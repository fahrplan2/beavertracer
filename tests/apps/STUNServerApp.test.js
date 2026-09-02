//@ts-check

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { STUNServerApp } from '../../src/apps/STUNServerApp.js';
import { StunMessage } from '../../src/net/pdu/StunMessage.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

// ── Minimal DOM stub (same pattern as tests/apps/UDPEchoServerApp.test.js) ────

if (!globalThis.document) {
  const makeFakeEl = () => {
    const el = {
      classList: { add() {}, remove() {} },
      style: {},
      disabled: false,
      value: '',
      textContent: '',
      childElementCount: 0,
      get scrollTop() { return 0; },
      set scrollTop(_v) {},
      get scrollHeight() { return 0; },
      replaceChildren() {},
      appendChild() { return el; },
      removeChild() { return el; },
      addEventListener() {},
      setAttribute() {},
    };
    return el;
  };
  // @ts-ignore
  globalThis.document = {
    createElement: (_tag) => makeFakeEl(),
    createTextNode: (_t) => ({}),
    createDocumentFragment: () => ({ appendChild() {} }),
  };
}

// ── Async single-item queue / virtual UDP network ─────────────────────────────

function makeQueue() {
  /** @type {any[]} */
  const pending = [];
  let closed = false;
  /** @type {((r: {done: boolean, value: any}) => void) | null} */
  let waiter = null;
  return {
    push(val) {
      if (waiter) { const r = waiter; waiter = null; r({ done: false, value: val }); }
      else pending.push(val);
    },
    close() {
      if (closed) return; closed = true;
      if (waiter) { const r = waiter; waiter = null; r({ done: true, value: null }); }
    },
    next() {
      if (pending.length) return Promise.resolve({ done: false, value: pending.shift() });
      if (closed)         return Promise.resolve({ done: true,  value: null });
      return new Promise(r => { waiter = r; });
    },
  };
}

function makeVirtualUDPNet() {
  let nextId = 0;
  /** @type {Map<number, ReturnType<typeof makeQueue>>} */
  const recvQueues = new Map();
  const outgoing = makeQueue();

  const net = {
    openUDPSocket(_ip, _port) {
      const id = ++nextId;
      recvQueues.set(id, makeQueue());
      return id;
    },
    closeUDPSocket(id) {
      recvQueues.get(id)?.close();
      recvQueues.delete(id);
    },
    async recvUDPSocket(id) {
      const q = recvQueues.get(id);
      if (!q) return null;
      const { done, value } = await q.next();
      return done ? null : value;
    },
    sendUDPSocket(_id, dstIp, dstPort, data) {
      outgoing.push({ dstIp, dstPort, data });
    },
  };

  function inject(sockId, src, srcPort, payload) {
    recvQueues.get(sockId)?.push({ src, srcPort, payload });
  }

  async function nextSent() {
    const { done, value } = await outgoing.next();
    return done ? null : value;
  }

  return { net, inject, nextSent };
}

function makeOS(net) {
  return {
    net,
    fs: { readFile() { throw new Error('no fs'); }, writeFile() {} },
    exit() {},
    dns: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('STUNServerApp', () => {
  /** @type {ReturnType<typeof makeVirtualUDPNet>} */
  let vnet;
  /** @type {STUNServerApp} */
  let server;
  /** @type {number} */
  let sockId;

  beforeEach(() => {
    vnet = makeVirtualUDPNet();
    server = new STUNServerApp(makeOS(vnet.net));
    server._start();
    sockId = /** @type {number} */ (server.socketPort);
  });

  afterEach(() => {
    server._stop();
  });

  it('opens its socket on the default STUN port (3478)', () => {
    expect(server.port).toBe(3478);
    expect(server.running).toBe(true);
  });

  it('answers a Binding Request with the request\'s own (NAT-observed) source as XOR-MAPPED-ADDRESS', async () => {
    const req = StunMessage.bindingRequest();
    // the sim delivers the src/srcPort as observed on the wire — this is what a
    // NatEngine on a router in between would have already rewritten to the
    // WAN-mapped address, which is exactly the value STUN is supposed to reveal.
    vnet.inject(sockId, IPAddress.fromString('198.51.100.9'), 40000, req.pack());

    const sent = await vnet.nextSent();
    expect(sent.dstIp.toString()).toBe('198.51.100.9');
    expect(sent.dstPort).toBe(40000);

    const resp = StunMessage.fromBytes(sent.data);
    expect(resp.isSuccess).toBe(true);
    expect(resp.transactionId).toEqual(req.transactionId);
    expect(resp.xorMappedAddress).toEqual({ ip: '198.51.100.9', port: 40000 });
  });

  it('is stateless: two independent clients each get their own reflected address', async () => {
    const reqA = StunMessage.bindingRequest();
    const reqB = StunMessage.bindingRequest();
    vnet.inject(sockId, IPAddress.fromString('203.0.113.5'), 11111, reqA.pack());
    vnet.inject(sockId, IPAddress.fromString('203.0.113.6'), 22222, reqB.pack());

    const sentA = await vnet.nextSent();
    const sentB = await vnet.nextSent();

    expect(StunMessage.fromBytes(sentA.data).xorMappedAddress).toEqual({ ip: '203.0.113.5', port: 11111 });
    expect(StunMessage.fromBytes(sentB.data).xorMappedAddress).toEqual({ ip: '203.0.113.6', port: 22222 });
  });

  it('silently ignores bytes that are not a STUN message', () => {
    let sent = false;
    const originalSend = vnet.net.sendUDPSocket;
    vnet.net.sendUDPSocket = (...args) => { sent = true; return originalSend(...args); };

    server._handleDatagram(new Uint8Array([1, 2, 3, 4]), '10.0.0.1', 1234);

    expect(sent).toBe(false);
  });

  it('marks itself as not running after _stop()', () => {
    server._stop();
    expect(server.running).toBe(false);
    expect(server.socketPort).toBeNull();
  });
});
