//@ts-check

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NTPServerApp } from '../../src/apps/NTPServerApp.js';
import { NTPPacket } from '../../src/net/pdu/NTPPacket.js';
import { SystemClock } from '../../src/apps/lib/SystemClock.js';
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

  /**
   * @param {number} sockId
   * @param {IPAddress} src
   * @param {number} srcPort
   * @param {Uint8Array} payload
   */
  function inject(sockId, src, srcPort, payload) {
    recvQueues.get(sockId)?.push({ src, srcPort, payload });
  }

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
    clock: new SystemClock(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NTPServerApp', () => {
  /** @type {ReturnType<typeof makeVirtualUDPNet>} */
  let vnet;
  /** @type {NTPServerApp} */
  let server;
  /** @type {number} */
  let sockId;

  beforeEach(() => {
    vnet = makeVirtualUDPNet();
    server = new NTPServerApp(makeOS(vnet.net));
    server._start();
    sockId = /** @type {number} */ (server.socketPort);
  });

  afterEach(() => {
    server._stop();
  });

  it('replies to a client request in mode 4 (server)', async () => {
    const query = new NTPPacket({ mode: NTPPacket.MODE_CLIENT, transmitTimestampMs: Date.now() });
    vnet.inject(sockId, IPAddress.fromString('10.0.0.1'), 12345, query.pack());

    const sent = await vnet.nextSent();
    const reply = NTPPacket.fromBytes(sent.data);
    expect(reply.mode).toBe(NTPPacket.MODE_SERVER);
  });

  it('answers as stratum 1 with reference ID LOCL', async () => {
    const query = new NTPPacket({ mode: NTPPacket.MODE_CLIENT, transmitTimestampMs: Date.now() });
    vnet.inject(sockId, IPAddress.fromString('10.0.0.1'), 12345, query.pack());

    const sent = await vnet.nextSent();
    const reply = NTPPacket.fromBytes(sent.data);
    expect(reply.stratum).toBe(1);
    expect(reply.referenceIdText).toBe('LOCL');
  });

  it('echoes the client\'s Transmit Timestamp back as Origin Timestamp', async () => {
    const t1 = Date.UTC(2026, 0, 1, 12, 0, 0);
    const query = new NTPPacket({ mode: NTPPacket.MODE_CLIENT, transmitTimestampMs: t1 });
    vnet.inject(sockId, IPAddress.fromString('10.0.0.1'), 12345, query.pack());

    const sent = await vnet.nextSent();
    const reply = NTPPacket.fromBytes(sent.data);
    expect(Math.round(reply.originTimestampMs)).toBe(t1);
  });

  it('stamps Receive and Transmit timestamps as non-zero', async () => {
    const query = new NTPPacket({ mode: NTPPacket.MODE_CLIENT, transmitTimestampMs: Date.now() });
    vnet.inject(sockId, IPAddress.fromString('10.0.0.1'), 12345, query.pack());

    const sent = await vnet.nextSent();
    const reply = NTPPacket.fromBytes(sent.data);
    expect(reply.receiveTimestampMs).toBeGreaterThan(0);
    expect(reply.transmitTimestampMs).toBeGreaterThan(0);
    expect(reply.transmitTimestampMs).toBeGreaterThanOrEqual(reply.receiveTimestampMs);
  });

  it('ignores a packet in server mode (not a client request)', async () => {
    const bogus = new NTPPacket({ mode: NTPPacket.MODE_SERVER });
    vnet.inject(sockId, IPAddress.fromString('10.0.0.1'), 12345, bogus.pack());

    // nothing should come back — race the (never-resolving) nextSent against a timeout
    const result = await Promise.race([
      vnet.nextSent().then(() => 'sent'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 20)),
    ]);
    expect(result).toBe('timeout');
  });

  it('replies to the sender IP and port', async () => {
    const query = new NTPPacket({ mode: NTPPacket.MODE_CLIENT, transmitTimestampMs: Date.now() });
    vnet.inject(sockId, IPAddress.fromString('192.168.1.100'), 9999, query.pack());

    const sent = await vnet.nextSent();
    expect(sent.dstIp.toString()).toBe('192.168.1.100');
    expect(sent.dstPort).toBe(9999);
  });

  it('marks itself as not running after _stop()', async () => {
    server._stop();
    expect(server.running).toBe(false);
    expect(server.socketPort).toBeNull();
  });
});
