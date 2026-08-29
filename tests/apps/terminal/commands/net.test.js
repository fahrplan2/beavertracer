//@ts-check

import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../../../../src/apps/lib/VirtualFileSystem.js';
import { curl } from '../../../../src/apps/terminal/commands/net/curl.js';
import { wget } from '../../../../src/apps/terminal/commands/net/wget.js';
import { CommandError } from '../../../../src/apps/terminal/commands/lib/errors.js';
import { TlsSession } from '../../../../src/net/TlsSession.js';
import { TlsCertificate, TlsTrustStore } from '../../../../src/net/models/TlsCertificate.js';

const te = new TextEncoder();
const td = new TextDecoder();

/** @param {string[]} lines @param {string} [body] */
function resp(lines, body = '') {
  return te.encode(lines.join('\r\n') + '\r\n\r\n' + body);
}

/** @param {Uint8Array[]} parts */
function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** In-memory byte queues so a client and server TlsSession can talk in-process. */
function makeQueues() {
  const c2s = []; const s2c = [];
  const c2sW = { val: null }; const s2cW = { val: null };
  const push = (q, w, d) => { if (w.val) { const r = w.val; w.val = null; r(d); } else q.push(d); };
  const recv = (q, w) => () => new Promise((r) => { if (q.length) r(q.shift()); else w.val = r; });
  return {
    clientSend: (d) => push(c2s, c2sW, d), serverRecv: recv(c2s, c2sW),
    serverSend: (d) => push(s2c, s2cW, d), clientRecv: recv(s2c, s2cW),
  };
}

/**
 * Fake `ctx.os` whose net layer replays one response per TCP connection.
 * @param {VirtualFileSystem} fs
 * @param {Array<Uint8Array|Uint8Array[]>} responses one entry per connect()
 * @param {{ resolve?: (h: string) => any }} [opts]
 */
function makeOs(fs, responses, opts = {}) {
  let connCount = 0;
  let cur = /** @type {Uint8Array[]|null} */ (null);
  let curIdx = 0;
  const sent = [];
  const tlsCert = opts.tls?.cert ?? null;
  let clientSend = null;
  let clientRecv = null;
  let lastDecryptedRequest = '';

  const net = {
    _lastIp: '', _lastPort: 0,
    async connectTCPConn(ip, port) {
      const r = responses[Math.min(connCount, responses.length - 1)];
      connCount++;
      net._lastIp = String(ip);
      net._lastPort = port;

      if (!tlsCert) {
        cur = Array.isArray(r) ? r.slice() : [r];
        curIdx = 0;
        clientSend = clientRecv = null;
        return { key: 'k' + connCount };
      }

      // https: run a server-side TlsSession over a fresh loopback queue
      const q = makeQueues();
      const server = new TlsSession({
        send: q.serverSend, recv: q.serverRecv, isServer: true, cert: tlsCert,
        timeoutMs: 5000, sleepFn: (ms) => new Promise((res) => setTimeout(res, ms)),
      });
      const respBytes = Array.isArray(r) ? concat(r) : r;
      void (async () => {
        try {
          await server.handshake();
          const req = await server.recv();
          lastDecryptedRequest = req ? td.decode(req) : '';
          await server.send(respBytes);
          server.close();
        } catch { /* surfaced through client-side assertions */ }
      })();
      clientSend = q.clientSend;
      clientRecv = q.clientRecv;
      cur = null;
      return { key: 't' + connCount };
    },
    sendTCPConn(_key, bytes) {
      sent.push(bytes);
      if (clientSend) clientSend(bytes);
    },
    async recvTCPConn() {
      if (clientRecv) return clientRecv();
      return cur && curIdx < cur.length ? cur[curIdx++] : null;
    },
    closeTCPConn() {},
  };
  const dns = {
    async resolveIP(host) {
      if (opts.resolve) return opts.resolve(host);
      throw new Error('no dns');
    },
  };
  return {
    os: { fs, net, dns, clock: { nowMs: () => Date.now() }, tls: opts.trustStore ? { certStore: opts.trustStore } : undefined },
    sentText: () => sent.map((b) => td.decode(b)).join(''),
    decryptedRequest: () => lastDecryptedRequest,
    connCount: () => connCount,
  };
}

function makeCtx(os) {
  const out = [];
  const err = [];
  const ctx = /** @type {any} */ ({
    os: os.os,
    cwd: '/home',
    env: {},
    onInterrupt: () => {},
    signal: { aborted: false },
    println: (s = '') => out.push(s),
    stdout: { print: (s = '') => out.push(s), println: (s = '') => out.push(s) },
    stderr: { print: (s = '') => err.push(s), println: (s = '') => err.push(s) },
  });
  return { ctx, out, err };
}

describe('curl', () => {
  it('prints the response body for a plain GET', async () => {
    const os = makeOs(new VirtualFileSystem(), [
      resp(['HTTP/1.1 200 OK', 'Content-Type: text/plain', 'Content-Length: 13'], 'hello, world!'),
    ]);
    const { ctx, out } = makeCtx(os);
    await curl.run(ctx, ['http://10.0.0.1/']);
    expect(out.join('\n')).toContain('hello, world!');
    expect(os.sentText()).toContain('GET / HTTP/1.1');
    expect(os.sentText()).toContain('Host: 10.0.0.1');
  });

  it('-I prints status + headers and no body', async () => {
    const os = makeOs(new VirtualFileSystem(), [
      resp(['HTTP/1.1 200 OK', 'Content-Type: text/html', 'Content-Length: 42']),
    ]);
    const { ctx, out } = makeCtx(os);
    await curl.run(ctx, ['-I', 'http://10.0.0.1/']);
    expect(os.sentText()).toContain('HEAD / HTTP/1.1');
    expect(out).toContain('< HTTP/1.1 200 OK');
    expect(out).toContain('< Content-Type: text/html');
    expect(out.at(-1)).toBe('<'); // nothing printed after the header block
  });

  it('-v traces request and response lines', async () => {
    const os = makeOs(new VirtualFileSystem(), [
      resp(['HTTP/1.1 200 OK', 'Content-Length: 2'], 'hi'),
    ]);
    const { ctx, out } = makeCtx(os);
    await curl.run(ctx, ['-v', 'http://10.0.0.1/']);
    expect(out).toContain('> GET / HTTP/1.1');
    expect(out).toContain('>');
    expect(out).toContain('< HTTP/1.1 200 OK');
  });

  it('POSTs -d data with a Content-Length', async () => {
    const os = makeOs(new VirtualFileSystem(), [resp(['HTTP/1.1 200 OK', 'Content-Length: 0'])]);
    const { ctx } = makeCtx(os);
    await curl.run(ctx, ['-d', 'name=bob', '-X', 'POST', 'http://10.0.0.1/submit']);
    const sent = os.sentText();
    expect(sent).toContain('POST /submit HTTP/1.1');
    expect(sent).toContain('Content-Length: 8');
    expect(sent.endsWith('name=bob')).toBe(true);
  });

  it('resolves a hostname through DNS', async () => {
    const os = makeOs(new VirtualFileSystem(), [resp(['HTTP/1.1 200 OK', 'Content-Length: 2'], 'ok')], {
      resolve: () => ({ toString: () => '203.0.113.9' }),
    });
    const { ctx, out } = makeCtx(os);
    await curl.run(ctx, ['http://example.test/']);
    expect(out.join('\n')).toContain('ok');
    expect(os.sentText()).toContain('Host: example.test');
  });

  it('rejects an unsupported scheme and a missing URL', async () => {
    const { ctx } = makeCtx(makeOs(new VirtualFileSystem(), [resp(['HTTP/1.1 200 OK'])]));
    await expect(curl.run(ctx, ['ftp://10.0.0.1/'])).rejects.toBeInstanceOf(CommandError);
    await expect(curl.run(ctx, [])).rejects.toBeInstanceOf(CommandError);
  });
});

describe('wget', () => {
  it('saves the body to a filename derived from the URL path', async () => {
    const fs = new VirtualFileSystem();
    const os = makeOs(fs, [
      resp(['HTTP/1.1 200 OK', 'Content-Type: text/plain', 'Content-Length: 5'], 'downl'),
    ]);
    const { ctx } = makeCtx(os);
    const ret = await wget.run(ctx, ['http://10.0.0.1/files/data.txt']);
    expect(ret).toBeUndefined();
    expect(fs.readFile('/home/data.txt')).toBe('downl');
  });

  it('falls back to index.html for a "/" path', async () => {
    const fs = new VirtualFileSystem();
    const os = makeOs(fs, [resp(['HTTP/1.1 200 OK', 'Content-Length: 3'], '<h1>')]);
    const { ctx } = makeCtx(os);
    await wget.run(ctx, ['http://10.0.0.1/']);
    expect(fs.readFile('/home/index.html')).toBe('<h1');
  });

  it('-O writes to the chosen name', async () => {
    const fs = new VirtualFileSystem();
    const os = makeOs(fs, [resp(['HTTP/1.1 200 OK', 'Content-Length: 4'], 'body')]);
    const { ctx } = makeCtx(os);
    await wget.run(ctx, ['-O', 'saved.html', 'http://10.0.0.1/x/y']);
    expect(fs.readFile('/home/saved.html')).toBe('body');
    expect(fs.exists('/home/y')).toBe(false);
  });

  it('-O - streams to stdout and writes no file', async () => {
    const fs = new VirtualFileSystem();
    const os = makeOs(fs, [resp(['HTTP/1.1 200 OK', 'Content-Length: 7'], 'to-out\n')]);
    const { ctx, out } = makeCtx(os);
    await wget.run(ctx, ['-qO-', 'http://10.0.0.1/thing']);
    expect(out.join('')).toContain('to-out');
    expect(fs.exists('/home/thing')).toBe(false);
  });

  it('does not overwrite an existing file — appends .1', async () => {
    const fs = new VirtualFileSystem();
    fs.writeFile('/home/data.txt', 'old');
    const os = makeOs(fs, [resp(['HTTP/1.1 200 OK', 'Content-Length: 3'], 'new')]);
    const { ctx } = makeCtx(os);
    await wget.run(ctx, ['http://10.0.0.1/data.txt']);
    expect(fs.readFile('/home/data.txt')).toBe('old');
    expect(fs.readFile('/home/data.txt.1')).toBe('new');
  });

  it('follows a 302 redirect and saves the final body', async () => {
    const fs = new VirtualFileSystem();
    const os = makeOs(fs, [
      resp(['HTTP/1.1 302 Found', 'Location: http://10.0.0.1/final.txt', 'Content-Length: 0']),
      resp(['HTTP/1.1 200 OK', 'Content-Length: 5'], 'final'),
    ]);
    const { ctx } = makeCtx(os);
    await wget.run(ctx, ['http://10.0.0.1/start']);
    expect(os.connCount()).toBe(2);
    expect(fs.readFile('/home/final.txt')).toBe('final');
  });

  it('errors on a 404 and writes nothing', async () => {
    const fs = new VirtualFileSystem();
    const os = makeOs(fs, [resp(['HTTP/1.1 404 Not Found', 'Content-Length: 9'], 'not here!!')]);
    const { ctx } = makeCtx(os);
    await expect(wget.run(ctx, ['http://10.0.0.1/nope.txt'])).rejects.toBeInstanceOf(CommandError);
    expect(fs.exists('/home/nope.txt')).toBe(false);
  });

  it('rejects an unsupported scheme', async () => {
    const { ctx } = makeCtx(makeOs(new VirtualFileSystem(), [resp(['HTTP/1.1 200 OK'])]));
    await expect(wget.run(ctx, ['ftp://10.0.0.1/'])).rejects.toBeInstanceOf(CommandError);
  });
});

describe('curl / wget over TLS', () => {
  it('curl performs an https GET through a real TLS handshake', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const trust = new TlsTrustStore();
    trust.add(cert);
    const os = makeOs(new VirtualFileSystem(), [
      resp(['HTTP/1.1 200 OK', 'Content-Type: text/plain', 'Content-Length: 6'], 'secure'),
    ], { tls: { cert }, trustStore: trust, resolve: () => ({ toString: () => '10.0.0.1' }) });
    const { ctx, out } = makeCtx(os);

    await curl.run(ctx, ['https://server.local/']);

    expect(out.join('\n')).toContain('secure');
    expect(os.decryptedRequest()).toContain('GET / HTTP/1.1');
    expect(os.decryptedRequest()).toContain('Host: server.local'); // no :443
  });

  it('curl without -k fails on an untrusted certificate', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const os = makeOs(new VirtualFileSystem(), [
      resp(['HTTP/1.1 200 OK', 'Content-Length: 2'], 'no'),
    ], { tls: { cert }, trustStore: new TlsTrustStore() /* empty → untrusted */ });
    const { ctx } = makeCtx(os);

    await expect(curl.run(ctx, ['https://server.local/'])).rejects.toBeInstanceOf(CommandError);
  });

  it('curl -k bypasses the certificate trust check', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const os = makeOs(new VirtualFileSystem(), [
      resp(['HTTP/1.1 200 OK', 'Content-Length: 4'], 'yolo'),
    ], { tls: { cert }, trustStore: new TlsTrustStore(), resolve: () => ({ toString: () => '10.0.0.1' }) });
    const { ctx, out } = makeCtx(os);

    await curl.run(ctx, ['-k', 'https://server.local/']);
    expect(out.join('\n')).toContain('yolo');
  });

  it('wget saves an https download', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const trust = new TlsTrustStore();
    trust.add(cert);
    const fs = new VirtualFileSystem();
    const os = makeOs(fs, [
      resp(['HTTP/1.1 200 OK', 'Content-Length: 9'], 'tls-body!'),
    ], { tls: { cert }, trustStore: trust, resolve: () => ({ toString: () => '10.0.0.1' }) });
    const { ctx } = makeCtx(os);

    await wget.run(ctx, ['https://server.local/secret.txt']);
    expect(fs.readFile('/home/secret.txt')).toBe('tls-body!');
  });
});
