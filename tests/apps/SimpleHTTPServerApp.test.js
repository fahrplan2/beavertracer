//@ts-check

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SimpleHTTPServerApp } from '../../src/apps/SimpleHTTPServerApp.js';

// ── Minimal DOM stub ──────────────────────────────────────────────────────────

if (!globalThis.document) {
  const makeFakeEl = () => {
    const el = {
      classList: { add() {}, remove() {} },
      style: {},
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
      querySelectorAll() { return []; },
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
  const acceptQueues = new Map();
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

  function connect(serverRef = 1) {
    const ck = `10.0.0.1:${++nextId * 1000}>127.0.0.1:80`;
    const toServer = makeQueue();
    const toClient = makeQueue();
    conns.set(ck, { toServer, toClient });
    acceptQueues.get(serverRef)?.push(ck);
    return {
      send(/** @type {Uint8Array} */ data) { toServer.push(data); },
      async recv() {
        const { done, value } = await toClient.next();
        return done ? null : value;
      },
      close() { toServer.close(); },
    };
  }

  return { net, connect };
}

// ── Mock FS ───────────────────────────────────────────────────────────────────

/**
 * @param {Record<string, string>} files  path → string content
 */
function makeMockFS(files = {}) {
  return {
    mkdir(_path, _opts) {},
    readFile(path) {
      if (Object.prototype.hasOwnProperty.call(files, path)) return files[path];
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    },
    writeFile(_path, _data) {},
  };
}

// ── Mock OS ───────────────────────────────────────────────────────────────────

function makeOS(net, fs) {
  return { net, fs, exit() {}, dns: null };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Read all chunks from the server until EOF (connection close), then parse
 * the HTTP response.
 */
async function readResponse(conn) {
  /** @type {Uint8Array[]} */
  const chunks = [];
  /** @type {Uint8Array|null} */
  let chunk;
  while ((chunk = await conn.recv()) !== null) chunks.push(chunk);

  const text = dec.decode(concat(chunks));
  const sep = text.indexOf('\r\n\r\n');
  const headerText = sep >= 0 ? text.slice(0, sep) : text;
  const body = sep >= 0 ? text.slice(sep + 4) : '';

  const [statusLine, ...headerLines] = headerText.split('\r\n');
  const sm = /^HTTP\/1\.[01] (\d+)/.exec(statusLine);
  const status = sm ? Number(sm[1]) : 0;

  /** @type {Record<string,string>} */
  const headers = {};
  for (const h of headerLines) {
    const i = h.indexOf(': ');
    if (i > 0) headers[h.slice(0, i).toLowerCase()] = h.slice(i + 2);
  }

  return { status, headers, body };
}

function sendGet(conn, path) {
  conn.send(enc.encode(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`));
}

function sendHead(conn, path) {
  conn.send(enc.encode(`HEAD ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`));
}

function sendPost(conn, path, body = '') {
  conn.send(enc.encode(`POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${body.length}\r\n\r\n${body}`));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SimpleHTTPServerApp', () => {
  /** @type {ReturnType<typeof makeVirtualTCPNet>} */
  let vnet;
  /** @type {SimpleHTTPServerApp} */
  let server;

  const FILES = {
    '/var/www/index.html': '<html><body>Hello</body></html>',
    '/var/www/page.txt':   'plain text content',
  };

  beforeEach(() => {
    vnet = makeVirtualTCPNet();
    server = new SimpleHTTPServerApp(makeOS(vnet.net, makeMockFS(FILES)));
    server._start();
  });

  afterEach(() => {
    server._stop();
  });

  // ── 200 OK ───────────────────────────────────────────────────────────────────

  describe('GET – 200 OK', () => {
    it('serves a known file with status 200', async () => {
      const c = vnet.connect();
      sendGet(c, '/index.html');
      const resp = await readResponse(c);
      expect(resp.status).toBe(200);
    });

    it('response body matches the file content', async () => {
      const c = vnet.connect();
      sendGet(c, '/index.html');
      const resp = await readResponse(c);
      expect(resp.body).toBe(FILES['/var/www/index.html']);
    });

    it('Content-Length header matches body length', async () => {
      const c = vnet.connect();
      sendGet(c, '/index.html');
      const resp = await readResponse(c);
      expect(Number(resp.headers['content-length'])).toBe(FILES['/var/www/index.html'].length);
    });

    it('serves a .txt file with correct Content-Type', async () => {
      const c = vnet.connect();
      sendGet(c, '/page.txt');
      const resp = await readResponse(c);
      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('text/plain');
    });

    it('GET / redirects to index.html implicitly', async () => {
      const c = vnet.connect();
      sendGet(c, '/');
      const resp = await readResponse(c);
      expect(resp.status).toBe(200);
      expect(resp.body).toBe(FILES['/var/www/index.html']);
    });
  });

  // ── HEAD ─────────────────────────────────────────────────────────────────────

  describe('HEAD', () => {
    it('HEAD returns 200 with no body', async () => {
      const c = vnet.connect();
      sendHead(c, '/index.html');
      const resp = await readResponse(c);
      expect(resp.status).toBe(200);
      expect(resp.body).toBe('');
    });

    it('HEAD Content-Length matches the file size', async () => {
      const c = vnet.connect();
      sendHead(c, '/index.html');
      const resp = await readResponse(c);
      expect(Number(resp.headers['content-length'])).toBe(FILES['/var/www/index.html'].length);
    });
  });

  // ── 404 ──────────────────────────────────────────────────────────────────────

  describe('404 Not Found', () => {
    it('returns 404 for a file that does not exist', async () => {
      const c = vnet.connect();
      sendGet(c, '/nosuchfile.html');
      const resp = await readResponse(c);
      expect(resp.status).toBe(404);
    });
  });

  // ── 405 ──────────────────────────────────────────────────────────────────────

  describe('405 Method Not Allowed', () => {
    it('returns 405 for POST requests', async () => {
      const c = vnet.connect();
      sendPost(c, '/index.html');
      const resp = await readResponse(c);
      expect(resp.status).toBe(405);
    });
  });

  // ── Path traversal prevention ─────────────────────────────────────────────────

  describe('Path normalization', () => {
    it('collapses .. segments so they cannot escape docroot', async () => {
      const c = vnet.connect();
      // The server normalizes the path; /../../etc/passwd → /etc/passwd
      // which maps to /var/www/etc/passwd → 404 (not the real /etc/passwd)
      sendGet(c, '/../../etc/passwd');
      const resp = await readResponse(c);
      expect(resp.status).toBe(404);
    });
  });

  // ── Multiple concurrent requests ──────────────────────────────────────────────

  describe('Concurrency', () => {
    it('handles two concurrent connections returning correct content to each', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();

      sendGet(c1, '/index.html');
      sendGet(c2, '/page.txt');

      const [r1, r2] = await Promise.all([readResponse(c1), readResponse(c2)]);
      expect(r1.status).toBe(200);
      expect(r1.body).toBe(FILES['/var/www/index.html']);
      expect(r2.status).toBe(200);
      expect(r2.body).toBe(FILES['/var/www/page.txt']);
    });
  });
});
