//@ts-check

/**
 * Sparktail keep-alive: response framing / reuse decision (unit) and the
 * connection pool against the real SimpleHTTPServerApp over an in-memory
 * TCP network (integration).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

if (!globalThis.document) {
  const makeFakeEl = () => {
    const el = {
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      style: {},
      dataset: {},
      disabled: false,
      value: '',
      checked: false,
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
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
    return el;
  };
  // @ts-expect-error minimal stub, not a real Document
  globalThis.document = {
    createElement: (/** @type {string} */ _tag) => makeFakeEl(),
    createTextNode: (/** @type {string} */ _t) => ({}),
    createDocumentFragment: () => ({ appendChild() {} }),
  };
}

const { SparktailHTTPClientApp, TcpBufferedReader, readHttpResponse, isReusableResponse } =
  await import('../../src/apps/SparktailHTTPClientApp.js');
const { SimpleHTTPServerApp } = await import('../../src/apps/SimpleHTTPServerApp.js');

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── unit: reuse decision ──────────────────────────────────────────────────────

describe('isReusableResponse (RFC 9112 §9.3)', () => {
  it('HTTP/1.1 with Content-Length persists', () => {
    expect(isReusableResponse('HTTP/1.1 200 OK', { 'content-length': '5' })).toBe(true);
  });
  it('HTTP/1.1 chunked persists', () => {
    expect(isReusableResponse('HTTP/1.1 200 OK', { 'transfer-encoding': 'chunked' })).toBe(true);
  });
  it('"Connection: close" ends it', () => {
    expect(isReusableResponse('HTTP/1.1 200 OK', { 'content-length': '5', connection: 'Close' })).toBe(false);
  });
  it('a body delimited by the close cannot be reused', () => {
    expect(isReusableResponse('HTTP/1.1 200 OK', {})).toBe(false);
  });
  it('HTTP/1.0 only with keep-alive', () => {
    expect(isReusableResponse('HTTP/1.0 200 OK', { 'content-length': '5' })).toBe(false);
    expect(isReusableResponse('HTTP/1.0 200 OK', { 'content-length': '5', connection: 'keep-alive' })).toBe(true);
  });
});

// ── unit: response reader ────────────────────────────────────────────────────

/** Reader over a fixed list of chunks (then EOF). @param {string[]} chunks */
function readerOf(chunks) {
  const q = chunks.map(c => enc.encode(c));
  return new TcpBufferedReader({
    recv: async () => q.shift() ?? null,
    isCancelled: () => false,
    timeoutMs: 1000,
  });
}

describe('readHttpResponse', () => {
  it('reads two back-to-back responses from one stream', async () => {
    const r = readerOf([
      'HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabcHTTP/1.1 404 Not Found\r\nContent-Le',
      'ngth: 2\r\n\r\nxy',
    ]);
    const a = await readHttpResponse(r, 1000);
    const b = await readHttpResponse(r, 1000);
    expect([a.statusCode, dec.decode(a.body), a.reusable]).toEqual([200, 'abc', true]);
    expect([b.statusCode, dec.decode(b.body), b.reusable]).toEqual([404, 'xy', true]);
  });

  it('decodes chunked bodies', async () => {
    const r = readerOf(['HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n']);
    const res = await readHttpResponse(r, 1000);
    expect(dec.decode(res.body)).toBe('abcde');
    expect(res.reusable).toBe(true);
  });

  it('HEAD and 304 carry no body even with Content-Length', async () => {
    const r = readerOf(['HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nHTTP/1.1 304 Not Modified\r\nContent-Length: 9\r\n\r\n']);
    expect((await readHttpResponse(r, 1000, 'HEAD')).body.length).toBe(0);
    expect((await readHttpResponse(r, 1000)).statusCode).toBe(304);
  });

  it('falls back to read-until-close without a length', async () => {
    const r = readerOf(['HTTP/1.1 200 OK\r\n\r\nall', ' of it']);
    const res = await readHttpResponse(r, 1000);
    expect(dec.decode(res.body)).toBe('all of it');
    expect(res.reusable).toBe(false);
  });
});

// ── integration: Sparktail ↔ SimpleHTTPServerApp ─────────────────────────────

function makeQueue() {
  /** @type {any[]} */
  const pending = [];
  let closed = false;
  /** @type {((v: any) => void) | null} */
  let waiter = null;
  return {
    push(/** @type {any} */ v) {
      if (closed) return;
      if (waiter) { const w = waiter; waiter = null; w(v); } else pending.push(v);
    },
    close() {
      if (closed) return;
      closed = true;
      if (waiter) { const w = waiter; waiter = null; w(null); }
    },
    /** @returns {Promise<any>} */
    next() {
      if (pending.length) return Promise.resolve(pending.shift());
      if (closed) return Promise.resolve(null);
      return new Promise(r => { waiter = r; });
    },
  };
}

/**
 * One in-memory TCP network shared by client and server. Every connection
 * has a server-side and a client-side key; closing one side signals EOF to
 * the other (like a FIN).
 */
function makeLinkedNet() {
  let next = 0;
  /** @type {Map<number, ReturnType<typeof makeQueue>>} */
  const listeners = new Map(); // port -> accept queue
  /** @type {Map<string, { inbox: ReturnType<typeof makeQueue>, peer: string }>} */
  const ends = new Map();
  const stats = { connects: 0 };

  const net = {
    openTCPServerSocket(/** @type {any} */ _ip, /** @type {number} */ port) {
      listeners.set(port, makeQueue());
      return port;
    },
    closeTCPServerSocket(/** @type {number} */ ref) { listeners.get(ref)?.close(); listeners.delete(ref); },
    acceptTCPConn(/** @type {number} */ ref) { return listeners.get(ref)?.next() ?? Promise.resolve(null); },
    async connectTCPConn(/** @type {any} */ _ip, /** @type {number} */ port) {
      const q = listeners.get(port);
      if (!q) throw new Error('connection refused');
      stats.connects++;
      const n = ++next;
      const ck = `c${n}`, sk = `s${n}`;
      ends.set(ck, { inbox: makeQueue(), peer: sk });
      ends.set(sk, { inbox: makeQueue(), peer: ck });
      q.push(sk);
      return { key: ck };
    },
    recvTCPConn(/** @type {string} */ k) { return ends.get(k)?.inbox.next() ?? Promise.resolve(null); },
    sendTCPConn(/** @type {string} */ k, /** @type {Uint8Array} */ d) {
      const e = ends.get(k);
      if (!e) throw new Error('not connected');
      ends.get(e.peer)?.inbox.push(d);
    },
    closeTCPConn(/** @type {string} */ k) {
      const e = ends.get(k);
      if (!e) return;
      ends.get(e.peer)?.inbox.close();
      e.inbox.close();
      ends.delete(k);
    },
    getTCPConnInfo() { return null; },
  };
  return { net, stats, openEnds: () => ends.size };
}

const FILES = {
  '/var/www/index.html': '<html><img src="a.png"><link rel="stylesheet" href="s.css"></html>',
  '/var/www/a.png': 'PNG',
  '/var/www/s.css': 'body{}',
};

/** @param {Record<string,string>} files */
function makeFS(files) {
  return {
    mkdir() {},
    readFile(/** @type {string} */ p) {
      if (p in files) return files[p];
      throw new Error('ENOENT');
    },
    writeFile() {},
  };
}

const settle = () => new Promise(r => setTimeout(r, 0));

describe('Sparktail connection reuse', () => {
  /** @type {any} */ let server;
  /** @type {any} */ let browser;
  afterEach(() => { browser?.destroy?.(); server?._stop(); });

  /** @param {boolean} keepAlive */
  function setup(keepAlive) {
    const { net, stats, openEnds } = makeLinkedNet();
    const os = {
      net, fs: makeFS(FILES), exit() {},
      dns: { resolveIP: async () => null },
      tls: null,
      clock: { nowMs: () => Date.now() },
    };
    server = new SimpleHTTPServerApp(/** @type {any} */ (os));
    server.keepAlive = keepAlive;
    server._start();
    browser = new SparktailHTTPClientApp(/** @type {any} */ (os));
    return { stats, openEnds };
  }

  const never = () => false;

  it('loads several resources over one connection', async () => {
    const { stats } = setup(true);
    const a = await browser._doGet('http://10.0.0.1/index.html', never);
    const b = await browser._doGet('http://10.0.0.1/a.png', never);
    const c = await browser._doGet('http://10.0.0.1/s.css', never);
    expect([a?.statusCode, b?.statusCode, c?.statusCode]).toEqual([200, 200, 200]);
    expect(dec.decode(c?.body)).toBe('body{}');
    expect(stats.connects).toBe(1);
    expect(browser._pool.size).toBe(1);
  });

  it('opens a connection per resource when the server does not keep alive', async () => {
    const { stats } = setup(false);
    await browser._doGet('http://10.0.0.1/index.html', never);
    await browser._doGet('http://10.0.0.1/a.png', never);
    expect(stats.connects).toBe(2);
    expect(browser._pool.size).toBe(0);
  });

  it('drops a pooled connection the server closed, and closes its own side', async () => {
    const { stats, openEnds } = setup(true);
    await browser._doGet('http://10.0.0.1/index.html', never);
    expect(browser._pool.size).toBe(1);
    server._stop();           // stands in for the keep-alive timeout: server side goes away
    for (const k of [...browser._pool.values()].map((/** @type {any} */ c) => c.key)) {
      // the server's end of each pooled connection closes
      server.os.net.closeTCPConn(k.replace('c', 's'));
    }
    await settle();
    expect(browser._pool.size).toBe(0);
    expect(openEnds()).toBe(0);
    server._start();
    const r = await browser._doGet('http://10.0.0.1/a.png', never);
    expect(r?.statusCode).toBe(200);
    expect(stats.connects).toBe(2);
  });

  it('retries once on a fresh connection when a reused one turns out dead', async () => {
    const { stats } = setup(true);
    await browser._doGet('http://10.0.0.1/index.html', never);
    const pooled = [...browser._pool.values()][0];
    // the idle watch has not seen the close yet: fake a silently dead connection
    pooled.reader.watchIdle = () => {};
    browser._pool.set(pooled.origin, pooled);
    pooled.reader._pending = Promise.resolve(null);
    const r = await browser._doGet('http://10.0.0.1/s.css', never);
    expect(r?.statusCode).toBe(200);
    expect(dec.decode(r?.body)).toBe('body{}');
    expect(stats.connects).toBe(2);
  });

  it('navigation and a second navigation share the connection', async () => {
    const { stats } = setup(true);
    await browser._fetchUrl('http://10.0.0.1/index.html');
    expect(browser.loading).toBe(false);
    expect(browser._pool.size).toBe(1);
    await browser._fetchUrl('http://10.0.0.1/a.png');
    expect(stats.connects).toBe(1);
    expect(browser.log.some((/** @type {string} */ l) => /Keep-Alive|connReused/.test(l))).toBe(true);
  });

  it('HTTPS: one TLS handshake for several resources, server close is noticed', async () => {
    const { TlsCertificate } = await import('../../src/net/models/TlsCertificate.js');
    const { stats, openEnds } = setup(true);
    server._stop();
    server.httpsEnabled = true;
    server.httpsPort = 443;
    server._cert = await TlsCertificate.generate('10.0.0.1');
    server._start();
    const a = await browser._doGet('https://10.0.0.1/index.html', never);
    const b = await browser._doGet('https://10.0.0.1/s.css', never);
    expect([a?.statusCode, dec.decode(b?.body)]).toEqual([200, 'body{}']);
    expect(stats.connects).toBe(1);
    const conn = [...browser._pool.values()][0];
    expect(conn.requests).toBe(2);
    // server ends the connection (TLS close_notify + FIN): browser drops it
    server._stop();
    server.os.net.closeTCPConn(conn.key.replace('c', 's'));
    await settle();
    expect(browser._pool.size).toBe(0);
    expect(openEnds()).toBe(0);
  });

  it('_stop() closes idle pooled connections', async () => {
    const { openEnds } = setup(true);
    await browser._doGet('http://10.0.0.1/index.html', never);
    browser._stop();
    await settle();
    expect(browser._pool.size).toBe(0);
    expect(openEnds()).toBe(0);
  });
});
