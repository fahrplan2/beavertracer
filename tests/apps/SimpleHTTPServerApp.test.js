//@ts-check

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SimpleHTTPServerApp, hostFromHeader, normalizeHostName, sanitizeVhosts } from '../../src/apps/SimpleHTTPServerApp.js';
import { TlsSession } from '../../src/net/TlsSession.js';
import { TlsCertificate } from '../../src/net/models/TlsCertificate.js';

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
    getTCPConnInfo(_ck) { return null; },
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
  conn.send(enc.encode(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
}

function sendHead(conn, path) {
  conn.send(enc.encode(`HEAD ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
}

function sendPost(conn, path, body = '') {
  conn.send(enc.encode(`POST ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n${body}`));
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
      expect(resp.headers['allow']).toBe('GET, HEAD'); // RFC 9110 §15.5.6
    });
  });

  // ── Host header (RFC 9112 §3.2) ──────────────────────────────────────────────

  describe('Host header', () => {
    it('rejects an HTTP/1.1 request without Host with 400', async () => {
      const c = vnet.connect();
      c.send(enc.encode('GET /index.html HTTP/1.1\r\n\r\n'));
      const resp = await readResponse(c);
      expect(resp.status).toBe(400);
    });

    it('rejects an HTTP/1.1 request with two Host headers with 400', async () => {
      const c = vnet.connect();
      c.send(enc.encode('GET /index.html HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n'));
      const resp = await readResponse(c);
      expect(resp.status).toBe(400);
    });

    it('accepts an HTTP/1.0 request without Host', async () => {
      const c = vnet.connect();
      c.send(enc.encode('GET /index.html HTTP/1.0\r\n\r\n'));
      const resp = await readResponse(c);
      expect(resp.status).toBe(200);
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

// ── Virtual hosts ─────────────────────────────────────────────────────────────

describe('virtual host helpers', () => {
  it('hostFromHeader strips port, brackets, case and trailing dot', () => {
    expect(hostFromHeader(' A.Lan:8080 ')).toBe('a.lan');
    expect(hostFromHeader('a.lan.')).toBe('a.lan');
    expect(hostFromHeader('[2001:DB8::1]:443')).toBe('2001:db8::1');
    expect(hostFromHeader('2001:db8::1')).toBe('2001:db8::1');
    expect(hostFromHeader('192.168.0.20:80')).toBe('192.168.0.20');
    expect(normalizeHostName('[::1]')).toBe('::1');
  });

  it('sanitizeVhosts normalises, skips blanks, fills docRoot', () => {
    const r = sanitizeVhosts([
      { host: 'Shop.LAN', docRoot: '', certPath: '' },
      { host: '  ', docRoot: '/x/' },
      { host: 'blog.lan', docRoot: ' /srv/blog/ ', certPath: '/etc/certs/b.json' },
    ]);
    expect(r.invalid).toBeNull();
    expect(r.duplicate).toBeNull();
    expect(r.vhosts).toEqual([
      { host: 'shop.lan', docRoot: '/var/www/shop.lan/', certPath: '' },
      { host: 'blog.lan', docRoot: '/srv/blog/', certPath: '/etc/certs/b.json' },
    ]);
  });

  it('sanitizeVhosts reports invalid and duplicate names', () => {
    expect(sanitizeVhosts([{ host: 'bad name' }]).invalid).toBe('bad name');
    expect(sanitizeVhosts([{ host: 'a.lan' }, { host: 'A.lan.' }]).duplicate).toBe('a.lan');
    expect(sanitizeVhosts('nope').vhosts).toEqual([]);
  });
});

describe('SimpleHTTPServerApp – virtual hosts (HTTP)', () => {
  const FILES = {
    '/var/www/index.html':   'DEFAULT',
    '/var/www/a/index.html': 'SITE A',
    '/var/www/b/index.html': 'SITE B',
  };
  /** @type {ReturnType<typeof makeVirtualTCPNet>} */
  let vnet;
  /** @type {SimpleHTTPServerApp} */
  let server;

  const get = async (/** @type {string} */ host) => {
    const c = vnet.connect();
    c.send(enc.encode(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
    return readResponse(c);
  };

  /** @param {boolean} enabled */
  function startWith(enabled) {
    vnet = makeVirtualTCPNet();
    server = new SimpleHTTPServerApp(makeOS(vnet.net, makeMockFS(FILES)));
    server.vhostsEnabled = enabled;
    server.vhosts = [
      { host: 'a.lan', docRoot: '/var/www/a/', certPath: '' },
      { host: 'b.lan', docRoot: '/var/www/b/', certPath: '' },
    ];
    server._start();
  }

  afterEach(() => server._stop());

  it('disabled: the host name is ignored', async () => {
    startWith(false);
    expect((await get('a.lan')).body).toBe('DEFAULT');
    expect((await get('b.lan')).body).toBe('DEFAULT');
  });

  it('enabled: Host header picks the document root (port and case ignored)', async () => {
    startWith(true);
    expect((await get('a.lan')).body).toBe('SITE A');
    expect((await get('B.LAN:80')).body).toBe('SITE B');
  });

  it('enabled: unknown names and IP addresses get the default host', async () => {
    startWith(true);
    expect((await get('c.lan')).body).toBe('DEFAULT');
    expect((await get('192.168.0.20')).body).toBe('DEFAULT');
  });

  it('enabled: HTTP/1.0 without Host gets the default host', async () => {
    startWith(true);
    const c = vnet.connect();
    c.send(enc.encode('GET / HTTP/1.0\r\n\r\n'));
    expect((await readResponse(c)).body).toBe('DEFAULT');
  });
});

describe('SimpleHTTPServerApp – config', () => {
  it('loads an old config without vhost fields unchanged', () => {
    const fs = makeMockFS({ '/etc/httpd.conf': JSON.stringify({ port: 8080, docRoot: '/srv/' }) });
    const app = new SimpleHTTPServerApp(makeOS(makeVirtualTCPNet().net, fs));
    app._loadConfig();
    expect(app.port).toBe(8080);
    expect(app.vhostsEnabled).toBe(false);
    expect(app.vhosts).toEqual([]);
  });

  it('round-trips vhosts through /etc/httpd.conf', () => {
    /** @type {Record<string,string>} */
    const files = {};
    const fs = { ...makeMockFS(files), writeFile(/** @type {string} */ p, /** @type {string} */ d) { files[p] = d; } };
    const app = new SimpleHTTPServerApp(makeOS(makeVirtualTCPNet().net, fs));
    app.vhostsEnabled = true;
    app.vhosts = [{ host: 'a.lan', docRoot: '/var/www/a/', certPath: '/etc/certs/a.json' }];
    app._saveConfig();
    const app2 = new SimpleHTTPServerApp(makeOS(makeVirtualTCPNet().net, fs));
    app2._loadConfig();
    expect(app2.vhostsEnabled).toBe(true);
    expect(app2.vhosts).toEqual(app.vhosts);
  });
});

describe('SimpleHTTPServerApp – virtual hosts (HTTPS / SNI)', () => {
  /** @type {ReturnType<typeof makeVirtualTCPNet>} */
  let vnet;
  /** @type {SimpleHTTPServerApp} */
  let server;
  /** @type {TlsCertificate} */ let defCert;
  /** @type {TlsCertificate} */ let aCert;

  beforeEach(async () => {
    defCert = await TlsCertificate.generate('default.lan');
    aCert = await TlsCertificate.generate('a.lan');
    const files = {
      '/var/www/index.html':   'DEFAULT',
      '/var/www/a/index.html': 'SITE A',
      '/var/www/b/index.html': 'SITE B',
      '/etc/certs/a.json':     JSON.stringify(await aCert.toSaveData()),
    };
    vnet = makeVirtualTCPNet();
    server = new SimpleHTTPServerApp(makeOS(vnet.net, makeMockFS(files)));
    server.httpsEnabled = true;
    server._cert = defCert;
    server.vhostsEnabled = true;
    server.vhosts = [
      { host: 'a.lan', docRoot: '/var/www/a/', certPath: '/etc/certs/a.json' },
      { host: 'b.lan', docRoot: '/var/www/b/', certPath: '' },
    ];
    server._start();
  });

  afterEach(() => server._stop());

  /**
   * TLS connection to the HTTPS listener (ref 2), one GET, response text.
   * @param {string} serverName SNI ('' or an IP: none)
   * @param {string} host Host header
   */
  async function httpsGet(serverName, host) {
    const conn = vnet.connect(2);
    const tls = new TlsSession({
      send: (d) => conn.send(d), recv: () => conn.recv(), isServer: false,
      timeoutMs: 5000, serverName,
    });
    await tls.handshake();
    await tls.send(enc.encode(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
    /** @type {Uint8Array[]} */
    const chunks = [];
    let c;
    while ((c = await tls.recv()) !== null) chunks.push(c);
    const text = dec.decode(concat(chunks));
    return {
      subject: tls.peerCert?.subject,
      status: Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1] ?? 0),
      body: text.slice(text.indexOf('\r\n\r\n') + 4),
    };
  }

  it('SNI selects the vhost certificate and Host the content', async () => {
    const r = await httpsGet('a.lan', 'a.lan');
    expect(r.subject).toBe('CN=a.lan');
    expect(r.status).toBe(200);
    expect(r.body).toBe('SITE A');
  });

  it('vhost without own certificate gets the default certificate', async () => {
    const r = await httpsGet('b.lan', 'b.lan');
    expect(r.subject).toBe('CN=default.lan');
    expect(r.body).toBe('SITE B');
  });

  it('without SNI (IP address) the Host header decides, default certificate', async () => {
    const r = await httpsGet('192.168.0.20', 'a.lan');
    expect(r.subject).toBe('CN=default.lan');
    expect(r.status).toBe(200);
    expect(r.body).toBe('SITE A');
  });

  it('SNI and Host of different sites -> 421 Misdirected Request', async () => {
    const r = await httpsGet('a.lan', 'b.lan');
    expect(r.status).toBe(421);
  });

  it('two unknown names both map to the default host -> no 421', async () => {
    const r = await httpsGet('x.lan', 'y.lan');
    expect(r.status).toBe(200);
    expect(r.body).toBe('DEFAULT');
  });
});

// ── Keep-Alive (RFC 9112 §9.3) ────────────────────────────────────────────────

describe('SimpleHTTPServerApp – keep-alive', () => {
  const FILES = {
    '/var/www/index.html': 'INDEX',
    '/var/www/a.css':      'body{}',
  };
  /** @type {ReturnType<typeof makeVirtualTCPNet>} */
  let vnet;
  /** @type {SimpleHTTPServerApp} */
  let server;

  /** @param {boolean} [keepAlive] */
  function start(keepAlive = true) {
    vnet = makeVirtualTCPNet();
    server = new SimpleHTTPServerApp(makeOS(vnet.net, makeMockFS(FILES)));
    server.keepAlive = keepAlive;
    server._start();
  }
  afterEach(() => server._stop());

  /**
   * Response reader that frames by Content-Length, so several responses can
   * be read from one connection. `closed` tells whether the server ended it.
   */
  function responses(/** @type {any} */ conn) {
    let buf = new Uint8Array(0);
    let closed = false;
    const fill = async () => {
      const c = await conn.recv();
      if (c === null) { closed = true; return false; }
      buf = concat([buf, c]);
      return true;
    };
    return {
      get closed() { return closed; },
      /** @param {boolean} [head] HEAD request: no body follows */
      async next(head = false) {
        let sep;
        while ((sep = dec.decode(buf).indexOf('\r\n\r\n')) < 0) if (!await fill()) return null;
        const headerText = dec.decode(buf.slice(0, sep));
        const [statusLine, ...lines] = headerText.split('\r\n');
        /** @type {Record<string,string>} */
        const headers = {};
        for (const l of lines) { const i = l.indexOf(': '); headers[l.slice(0, i).toLowerCase()] = l.slice(i + 2); }
        const len = head ? 0 : Number(headers['content-length'] ?? 0);
        while (buf.length < sep + 4 + len) if (!await fill()) break;
        const body = dec.decode(buf.slice(sep + 4, sep + 4 + len));
        buf = buf.slice(sep + 4 + len);
        return { status: Number(statusLine.split(' ')[1]), headers, body };
      },
      async waitClosed() { while (!closed) await fill(); return buf.length; },
    };
  }

  const req = (/** @type {string} */ path, extra = '', ver = '1.1') =>
    enc.encode(`GET ${path} HTTP/${ver}\r\nHost: localhost\r\n${extra}\r\n`);

  it('serves several requests over one connection', async () => {
    start();
    const c = vnet.connect();
    const r = responses(c);
    c.send(req('/index.html'));
    const r1 = await r.next();
    expect(r1?.body).toBe('INDEX');
    expect(r1?.headers.connection).toBe('keep-alive');
    expect(r1?.headers['keep-alive']).toBe('timeout=5, max=99');
    c.send(req('/a.css'));
    const r2 = await r.next();
    expect(r2?.body).toBe('body{}');
    expect(r2?.headers['keep-alive']).toBe('timeout=5, max=98');
    expect(r.closed).toBe(false);
  });

  it('answers pipelined requests in order', async () => {
    start();
    const c = vnet.connect();
    const r = responses(c);
    const both = concat([req('/a.css'), req('/index.html', 'Connection: close\r\n')]);
    c.send(both);
    expect((await r.next())?.body).toBe('body{}');
    const last = await r.next();
    expect(last?.body).toBe('INDEX');
    expect(last?.headers.connection).toBe('close');
    expect(await r.waitClosed()).toBe(0);
  });

  it('404 keeps the connection, a HEAD 404 carries no body', async () => {
    start();
    const c = vnet.connect();
    const r = responses(c);
    c.send(enc.encode('HEAD /missing HTTP/1.1\r\nHost: localhost\r\n\r\n'));
    const r1 = await r.next(true);
    expect(r1?.status).toBe(404);
    expect(Number(r1?.headers['content-length'])).toBeGreaterThan(0);
    c.send(req('/index.html'));
    const r2 = await r.next();
    expect(r2?.status).toBe(200);
    expect(r2?.body).toBe('INDEX');
  });

  it('HTTP/1.0 closes by default, stays open with "Connection: keep-alive"', async () => {
    start();
    const c1 = vnet.connect();
    const r1 = responses(c1);
    c1.send(req('/index.html', '', '1.0'));
    expect((await r1.next())?.headers.connection).toBe('close');
    await r1.waitClosed();

    const c2 = vnet.connect();
    const r2 = responses(c2);
    c2.send(req('/index.html', 'Connection: Keep-Alive\r\n', '1.0'));
    expect((await r2.next())?.headers.connection).toBe('keep-alive');
    expect(r2.closed).toBe(false);
  });

  it('switched off: every response closes the connection', async () => {
    start(false);
    const c = vnet.connect();
    const r = responses(c);
    c.send(req('/index.html'));
    const r1 = await r.next();
    expect(r1?.headers.connection).toBe('close');
    expect(r1?.headers['keep-alive']).toBeUndefined();
    await r.waitClosed();
  });

  it('a request with a body ends the connection', async () => {
    start();
    const c = vnet.connect();
    const r = responses(c);
    c.send(enc.encode('GET / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 3\r\n\r\nabc'));
    expect((await r.next())?.headers.connection).toBe('close');
    await r.waitClosed();
  });

  it('the client closing between requests ends the connection quietly', async () => {
    start();
    const c = vnet.connect();
    const r = responses(c);
    c.send(req('/index.html'));
    await r.next();
    c.close();
    expect(await r.waitClosed()).toBe(0);  // no 400 page after the last response
  });

  it('keepAlive is persisted, old configs default to on', () => {
    /** @type {Record<string,string>} */
    const files = { '/etc/httpd.conf': JSON.stringify({ port: 80 }) };
    const fs = { ...makeMockFS(files), writeFile(/** @type {string} */ p, /** @type {string} */ d) { files[p] = d; } };
    const app = new SimpleHTTPServerApp(makeOS(makeVirtualTCPNet().net, fs));
    app._loadConfig();
    expect(app.keepAlive).toBe(true);
    app.keepAlive = false;
    app._saveConfig();
    const app2 = new SimpleHTTPServerApp(makeOS(makeVirtualTCPNet().net, fs));
    app2._loadConfig();
    expect(app2.keepAlive).toBe(false);
  });
});
