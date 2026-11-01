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

describe('curl and HTTP/2', () => {
  /** @type {any} */ let server;
  afterEach(() => server?._stop());

  /** @param {Record<string, any>} cfg */
  async function setup(cfg) {
    const { net } = makeLinkedNet();
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
    return { ctx, out };
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
});
