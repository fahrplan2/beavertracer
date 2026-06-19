//@ts-check

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SimpleTCPServerApp } from '../../src/apps/SimpleTCPServerApp.js';

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

// ── Virtual TCP network ───────────────────────────────────────────────────────

function makeVirtualTCPNet() {
  let nextId = 0;
  /** @type {Map<number, ReturnType<typeof makeQueue>>} serverRef → accept queue */
  const acceptQueues = new Map();
  /** @type {Map<string, {toServer: ReturnType<typeof makeQueue>, toClient: ReturnType<typeof makeQueue>}>} */
  const conns = new Map();

  const net = {
    openTCPServerSocket(_ip, _port) {
      const ref = ++nextId;
      acceptQueues.set(ref, makeQueue());
      return ref;
    },
    closeTCPServerSocket(ref) {
      acceptQueues.get(ref)?.close();
      acceptQueues.delete(ref);
    },
    async acceptTCPConn(ref) {
      const q = acceptQueues.get(ref);
      if (!q) return null;
      const { done, value } = await q.next();
      return done ? null : value;
    },
    async recvTCPConn(ck) {
      const c = conns.get(ck);
      if (!c) return null;
      const { done, value } = await c.toServer.next();
      return done ? null : value;
    },
    sendTCPConn(ck, bytes) {
      conns.get(ck)?.toClient.push(bytes);
    },
    closeTCPConn(ck) {
      const c = conns.get(ck);
      if (!c) return;
      c.toServer.close();
      c.toClient.close();
      conns.delete(ck);
    },
  };

  /**
   * Open a new client connection to the given server socket.
   * Returns a handle with send / recv / close / connKey.
   * @param {number} [serverRef=1]
   */
  function connect(serverRef = 1) {
    const ck = `10.0.0.1:${++nextId * 1000}>127.0.0.1:7`;
    const toServer = makeQueue();
    const toClient = makeQueue();
    conns.set(ck, { toServer, toClient });
    acceptQueues.get(serverRef)?.push(ck);

    return {
      connKey: ck,
      /** Send raw bytes to the server. */
      send(/** @type {Uint8Array} */ data) { toServer.push(data); },
      /** Read one chunk sent by the server. Returns null on EOF. */
      async recv() {
        const { done, value } = await toClient.next();
        return done ? null : value;
      },
      /** Signal EOF from the client side. */
      close() { toServer.close(); },
    };
  }

  return { net, connect };
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

describe('SimpleTCPServerApp', () => {
  /** @type {ReturnType<typeof makeVirtualTCPNet>} */
  let vnet;
  /** @type {SimpleTCPServerApp} */
  let server;

  beforeEach(() => {
    vnet = makeVirtualTCPNet();
    server = new SimpleTCPServerApp(makeOS(vnet.net));
    server._start();
  });

  afterEach(() => {
    server._stop();
  });

  it('echoes data back to the client', async () => {
    const c = vnet.connect();
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    c.send(data);

    const echo = await c.recv();
    expect(echo).toEqual(data);
  });

  it('echoes multiple chunks independently', async () => {
    const c = vnet.connect();
    const d1 = new Uint8Array([1, 2]);
    const d2 = new Uint8Array([3, 4, 5]);

    c.send(d1);
    expect(await c.recv()).toEqual(d1);

    c.send(d2);
    expect(await c.recv()).toEqual(d2);
  });

  it('handles two concurrent connections independently', async () => {
    const c1 = vnet.connect();
    const c2 = vnet.connect();

    const d1 = new Uint8Array([0xAA]);
    const d2 = new Uint8Array([0xBB]);

    c1.send(d1);
    c2.send(d2);

    const [e1, e2] = await Promise.all([c1.recv(), c2.recv()]);
    expect(e1).toEqual(d1);
    expect(e2).toEqual(d2);
  });

  it('echo from one connection does not leak to another', async () => {
    const c1 = vnet.connect();
    const c2 = vnet.connect();

    c1.send(new Uint8Array([0x01]));
    const echo = await c1.recv();
    expect(echo).toEqual(new Uint8Array([0x01]));

    // c2 sends its own data after; the echo should only contain c2's data
    c2.send(new Uint8Array([0x02]));
    const echo2 = await c2.recv();
    expect(echo2).toEqual(new Uint8Array([0x02]));
  });

  it('gracefully handles client disconnect (EOF closes the echo loop)', async () => {
    const c = vnet.connect();
    c.send(new Uint8Array([42]));
    await c.recv(); // consume echo to confirm conn is live

    c.close(); // signal EOF from client

    // Give the server's conn loop a tick to process the EOF
    await new Promise(r => setTimeout(r, 0));

    // Connection key should have been removed from the active set
    expect(server.conns.has(c.connKey)).toBe(false);
  });

  it('marks itself as not running after _stop()', () => {
    server._stop();
    expect(server.running).toBe(false);
    expect(server.listenPort).toBeNull();
  });
});
