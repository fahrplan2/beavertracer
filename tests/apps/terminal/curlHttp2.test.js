//@ts-check

import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeLinkedNet, makeFS } from '../../support/linkedNet.js';

vi.mock('../../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

if (!globalThis.document) {
  const el = () => ({
    classList: { add() {}, remove() {} }, style: {}, value: '', checked: false, textContent: '',
    replaceChildren() {}, appendChild() {}, addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; },
  });
  // @ts-expect-error minimal stub
  globalThis.document = { createElement: el, createTextNode: () => ({}), createDocumentFragment: () => ({ appendChild() {} }) };
}

const { curl } = await import('../../../src/apps/terminal/commands/net/curl.js');
const { CommandError } = await import('../../../src/apps/terminal/commands/lib/errors.js');
const { SimpleHTTPServerApp } = await import('../../../src/apps/SimpleHTTPServerApp.js');
const { TlsCertificate } = await import('../../../src/net/models/TlsCertificate.js');
const { simTimer } = await import('../../../src/lib/SimTimer.js');

describe('curl and HTTP/2', () => {
  /** @type {any} */ let server;
  /** @type {any} */ let ticker = null;
  afterEach(() => { server?._stop(); if (ticker) clearInterval(ticker); ticker = null; });
  /** simulated time must run for QUIC timeouts */
  const runSimTime = () => { ticker = setInterval(() => { for (let i = 0; i < 40; i++) simTimer.tick(); }, 1); };

  /** @param {Record<string, any>} cfg */
  async function setup(cfg) {
    const { net, control } = makeLinkedNet();
    const os = {
      net, fs: makeFS({ '/var/www/index.html': 'hello h2' }), exit() {},
      dns: { resolveIP: async () => null }, clock: { nowMs: () => Date.now() },
    };
    server = new SimpleHTTPServerApp(/** @type {any} */ (os));
    server.httpsEnabled = true;
    server._cert = await TlsCertificate.generate('10.0.0.1');
    Object.assign(server, cfg);
    server._start();
    /** @type {string[]} */
    const out = [];
    const ctx = /** @type {any} */ ({
      os, cwd: '/', env: {}, onInterrupt: () => {}, signal: new AbortController().signal,
      println: (/** @type {string} */ s = '') => out.push(s),
    });
    return { ctx, out, control };
  }

  it('negotiates h2 by default over https when the server offers it', async () => {
    const { ctx, out } = await setup({ http2Enabled: true });
    await curl.run(ctx, ['-v', 'https://10.0.0.1/']);
    const text = out.join('\n');
    expect(text).toContain('* ALPN: curl offers h2,http/1.1');
    expect(text).toContain('* ALPN: server accepted h2');
    expect(text).toContain('> GET / HTTP/2');
    expect(text).toContain('< HTTP/2 200');
    expect(text).toContain('< content-type: text/html; charset=utf-8');
    expect(text).toContain('hello h2');
  });

  it('stays on HTTP/1.1 when the server has HTTP/2 switched off', async () => {
    const { ctx, out } = await setup({ http2Enabled: false });
    await curl.run(ctx, ['-v', 'https://10.0.0.1/']);
    const text = out.join('\n');
    expect(text).toContain('* ALPN: server accepted http/1.1');
    expect(text).toContain('< HTTP/1.1 200 OK');
  });

  it('--http1.1 offers only http/1.1', async () => {
    const { ctx, out } = await setup({ http2Enabled: true });
    await curl.run(ctx, ['-v', '--http1.1', 'https://10.0.0.1/']);
    expect(out.join('\n')).toContain('* ALPN: curl offers http/1.1');
    expect(out.join('\n')).toContain('< HTTP/1.1 200 OK');
  });

  it('--http2-prior-knowledge speaks h2c on http://', async () => {
    const { ctx, out } = await setup({ h2cEnabled: true });
    await curl.run(ctx, ['-I', '--http2-prior-knowledge', 'http://10.0.0.1/']);
    expect(out[0]).toBe('< HTTP/2 200');
  });

  it('--http2-prior-knowledge fails against a server without h2c', async () => {
    const { ctx } = await setup({ h2cEnabled: false });
    await expect(curl.run(ctx, ['--http2-prior-knowledge', 'http://10.0.0.1/'])).rejects.toBeInstanceOf(CommandError);
  });

  it('--http2 on http:// falls back to HTTP/1.1 (no Upgrade in this simulation)', async () => {
    const { ctx, out } = await setup({ h2cEnabled: true });
    await curl.run(ctx, ['-v', '--http2', 'http://10.0.0.1/']);
    expect(out.join('\n')).toContain('> GET / HTTP/1.1');
  });

  it('-v reports TLS 1.3 when the server offers it, else TLS 1.2', async () => {
    const { ctx, out } = await setup({ tls13Enabled: true });
    await curl.run(ctx, ['-v', 'https://10.0.0.1/']);
    expect(out.join('\n')).toContain('* SSL connection using TLSv1.3 / TLS_AES_128_GCM_SHA256');
    const two = await setup({ tls13Enabled: false });
    await curl.run(two.ctx, ['-v', 'https://10.0.0.1/']);
    expect(two.out.join('\n')).toContain('* SSL connection using TLSv1.2 / TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256');
  });

  it('--tlsv1.3 fails against a TLS 1.2-only server, --tls-max 1.2 forces 1.2', async () => {
    const { ctx } = await setup({ tls13Enabled: false });
    await expect(curl.run(ctx, ['--tlsv1.3', 'https://10.0.0.1/'])).rejects.toBeInstanceOf(CommandError);
    const s2 = await setup({ tls13Enabled: true });
    await curl.run(s2.ctx, ['-v', '--tls-max', '1.2', 'https://10.0.0.1/']);
    expect(s2.out.join('\n')).toContain('TLSv1.2');
    await expect(curl.run(s2.ctx, ['--tlsv1.3', '--tls-max', '1.2', 'https://10.0.0.1/'])).rejects.toBeInstanceOf(CommandError);
  });

  it('HTTP/2 over TLS 1.3 works together', async () => {
    const { ctx, out } = await setup({ tls13Enabled: true, http2Enabled: true });
    await curl.run(ctx, ['-v', 'https://10.0.0.1/']);
    const text = out.join('\n');
    expect(text).toContain('TLSv1.3');
    expect(text).toContain('< HTTP/2 200');
    expect(text).toContain('hello h2');
  });

  it('--http3 speaks HTTP/3 over QUIC', async () => {
    const { ctx, out } = await setup({ http3Enabled: true });
    await curl.run(ctx, ['-v', '--http3', 'https://10.0.0.1/']);
    const text = out.join('\n');
    expect(text).toContain('* QUIC connection established: TLSv1.3 / TLS_AES_128_GCM_SHA256');
    expect(text).toContain('* using HTTP/3');
    expect(text).toContain('> GET / HTTP/3');
    expect(text).toContain('< HTTP/3 200');
    expect(text).toContain('hello h2');
  });

  it('HTTPS responses announce HTTP/3 with Alt-Svc', async () => {
    const { ctx, out } = await setup({ http3Enabled: true });
    await curl.run(ctx, ['-I', 'https://10.0.0.1/']);
    expect(out).toContain('< Alt-Svc: h3=":443"; ma=86400');
  });

  it('--http3 falls back to TCP when UDP is blocked; --http3-only fails', async () => {
    const { ctx, out, control } = await setup({ http3Enabled: true });
    control.blockUdp = true;
    runSimTime();
    await curl.run(ctx, ['-v', '--http3', 'https://10.0.0.1/']);
    const text = out.join('\n');
    expect(text).toMatch(/\* QUIC failed \(QUIC handshake timeout\), falling back to TCP/);
    expect(text).toContain('< HTTP/1.1 200 OK');
    await expect(curl.run(ctx, ['--http3-only', 'https://10.0.0.1/'])).rejects.toBeInstanceOf(CommandError);
  }, 20_000);

  it('--http3 needs https', async () => {
    const { ctx } = await setup({});
    await expect(curl.run(ctx, ['--http3', 'http://10.0.0.1/'])).rejects.toBeInstanceOf(CommandError);
  });
});
