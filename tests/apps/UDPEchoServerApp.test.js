//@ts-check

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UDPEchoServerApp } from '../../src/apps/UDPEchoServerApp.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

// ── Minimal DOM stub ──────────────────────────────────────────────────────────

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

// ── Async single-item queue ───────────────────────────────────────────────────

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

// ── Virtual UDP network ───────────────────────────────────────────────────────

function makeVirtualUDPNet() {
  let nextId = 0;
  /** @type {Map<number, ReturnType<typeof makeQueue>>} sockId → inbound packet queue */
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

  /**
   * Deliver an inbound UDP packet to the server.
   * @param {number} sockId
   * @param {IPAddress} src
   * @param {number} srcPort
   * @param {Uint8Array} payload
   */
  function inject(sockId, src, srcPort, payload) {
    recvQueues.get(sockId)?.push({ src, srcPort, payload });
  }

  /** Wait for the next packet sent by the server. */
  async function nextSent() {
    const { done, value } = await outgoing.next();
    return done ? null : value;
  }

  return { net, inject, nextSent };
}

// ── Mock OS ───────────────────────────────────────────────────────────────────

function makeOS(net) {
  return {
    net,
    fs: { readFile() { throw new Error('no fs'); }, writeFile() {} },
    exit() {},
    dns: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UDPEchoServerApp', () => {
  /** @type {ReturnType<typeof makeVirtualUDPNet>} */
  let vnet;
  /** @type {UDPEchoServerApp} */
  let server;
  /** @type {number} */
  let sockId;

  beforeEach(() => {
    vnet = makeVirtualUDPNet();
    server = new UDPEchoServerApp(makeOS(vnet.net));
    server._start();
    sockId = /** @type {number} */ (server.socketPort);
  });

  afterEach(() => {
    server._stop();
  });

  it('echoes a UDP packet back to the sender port', async () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    vnet.inject(sockId, IPAddress.fromString('10.0.0.1'), 12345, payload);

    const sent = await vnet.nextSent();
    expect(sent.data).toEqual(payload);
    expect(sent.dstPort).toBe(12345);
  });

  it('echoes a UDP packet back to the sender IP', async () => {
    vnet.inject(sockId, IPAddress.fromString('192.168.1.100'), 9999, new Uint8Array([0xAA]));

    const sent = await vnet.nextSent();
    expect(sent.dstIp.toString()).toBe('192.168.1.100');
  });

  it('echoes multiple packets in order', async () => {
    const src = IPAddress.fromString('10.0.0.2');
    const p1 = new Uint8Array([1]);
    const p2 = new Uint8Array([2, 3]);
    const p3 = new Uint8Array([4, 5, 6]);

    vnet.inject(sockId, src, 5000, p1);
    vnet.inject(sockId, src, 5000, p2);
    vnet.inject(sockId, src, 5000, p3);

    const s1 = await vnet.nextSent();
    const s2 = await vnet.nextSent();
    const s3 = await vnet.nextSent();

    expect(s1.data).toEqual(p1);
    expect(s2.data).toEqual(p2);
    expect(s3.data).toEqual(p3);
  });

  it('preserves the full payload including zero bytes', async () => {
    const payload = new Uint8Array([0x00, 0xFF, 0x00, 0x7F]);
    vnet.inject(sockId, IPAddress.fromString('10.1.2.3'), 1111, payload);

    const sent = await vnet.nextSent();
    expect(sent.data).toEqual(payload);
  });

  it('marks itself as not running after _stop()', async () => {
    server._stop();
    expect(server.running).toBe(false);
    expect(server.socketPort).toBeNull();
  });
});
