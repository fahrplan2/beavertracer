//@ts-check

/**
 * Sparktail and HTTP/2: ALPN negotiation, one shared multiplexed connection
 * vs. parallel HTTP/1.1 connections, protocol setting, h2c.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

if (!globalThis.document) {
  const el = () => ({
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: {}, dataset: {},
    value: '', checked: false, textContent: '', replaceChildren() {}, appendChild() {}, removeChild() {},
    addEventListener() {}, setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  });
  // @ts-expect-error minimal stub
  globalThis.document = { createElement: el, createTextNode: () => ({}), createDocumentFragment: () => ({ appendChild() {} }) };
}

const { SparktailHTTPClientApp } = await import('../../src/apps/SparktailHTTPClientApp.js');
const { SimpleHTTPServerApp } = await import('../../src/apps/SimpleHTTPServerApp.js');
const { TlsCertificate } = await import('../../src/net/models/TlsCertificate.js');
const { makeLinkedNet, makeFS } = await import('../support/linkedNet.js');

const dec = new TextDecoder();
const FILES = {
  '/var/www/index.html': '<html></html>',
  '/var/www/a.png': 'A', '/var/www/b.png': 'B', '/var/www/c.css': 'C', '/var/www/d.css': 'D',
};
const RESOURCES = ['a.png', 'b.png', 'c.css', 'd.css'];
const never = () => false;
const settle = () => new Promise(r => setTimeout(r, 0));

describe('Sparktail HTTP/2', () => {
  /** @type {any} */ let server;
  /** @type {any} */ let browser;
  afterEach(() => { browser?.destroy?.(); server?._stop(); });

  /** @param {Record<string, any>} cfg @param {string} [mode] */
  async function setup(cfg, mode = 'auto') {
    const { net, stats, openEnds } = makeLinkedNet();
    /** @type {Record<string,string>} */
    const files = { ...FILES };
    const fs = { ...makeFS(files), writeFile(/** @type {string} */ p, /** @type {string} */ d) { files[p] = d; } };
    const os = { net, fs, exit() {}, dns: { resolveIP: async () => null }, tls: null, clock: { nowMs: () => Date.now() } };
    server = new SimpleHTTPServerApp(/** @type {any} */ (os));
    server.httpsEnabled = true;
    server._cert = await TlsCertificate.generate('10.0.0.1');
    Object.assign(server, cfg);
    server._start();
    browser = new SparktailHTTPClientApp(/** @type {any} */ (os));
    browser.protocolMode = mode;
    return { stats, openEnds, files, os };
  }

  /** @param {string} base */
  const fetchAll = (base) => Promise.all(RESOURCES.map(r => browser._doGet(`${base}/${r}`, never)));

  it('Auto + HTTP/2 server: all resources multiplexed over one connection', async () => {
    const { stats } = await setup({ http2Enabled: true });
    const res = await fetchAll('https://10.0.0.1');
    expect(res.map(r => dec.decode(r?.body))).toEqual(['A', 'B', 'C', 'D']);
    expect(stats.connects).toBe(1);
    const conns = browser._pooledConns();
    expect(conns.length).toBe(1);
    expect(conns[0].proto).toBe('HTTP/2 (ALPN h2)');
    expect(conns[0].requests).toBe(4);
  });

  it('Auto + HTTP/1.1-only server: parallel requests open parallel connections', async () => {
    const { stats } = await setup({ http2Enabled: false });
    const res = await fetchAll('https://10.0.0.1');
    expect(res.every(r => r?.statusCode === 200)).toBe(true);
    expect(stats.connects).toBeGreaterThan(1);
    expect(browser._pooledConns().every((/** @type {any} */ c) => c.h2 === null)).toBe(true);
  });

  it('"HTTP/1.1 only" does not use HTTP/2 even when offered', async () => {
    await setup({ http2Enabled: true }, 'http1');
    await browser._doGet('https://10.0.0.1/a.png', never);
    expect(browser._pooledConns()[0].proto).toBe('HTTP/1.1 (ALPN http/1.1)');
  });

  it('"HTTP/2 only" fails against a server without HTTP/2', async () => {
    await setup({ http2Enabled: false }, 'h2');
    expect(await browser._doGet('https://10.0.0.1/a.png', never)).toBeNull();
  });

  it('"HTTP/2 only" on http:// speaks h2c with prior knowledge', async () => {
    const { stats } = await setup({ h2cEnabled: true }, 'h2');
    const res = await fetchAll('http://10.0.0.1');
    expect(res.map(r => dec.decode(r?.body))).toEqual(['A', 'B', 'C', 'D']);
    expect(stats.connects).toBe(1);
    expect(browser._pooledConns()[0].proto).toBe('HTTP/2 (h2c, prior knowledge)');
  });

  it('Auto stays on HTTP/1.1 for http:// (browsers never use h2c)', async () => {
    await setup({ h2cEnabled: true });
    await browser._doGet('http://10.0.0.1/a.png', never);
    expect(browser._pooledConns()[0].h2).toBeNull();
  });

  it('navigation over HTTP/2 shows the HTTP/2 status line in the headers', async () => {
    await setup({ http2Enabled: true });
    browser.headersEl = { value: '', style: {} };
    await browser._fetchUrl('https://10.0.0.1/a.png');
    expect(browser.headersEl.value.startsWith('HTTP/2 200')).toBe(true);
    expect(browser.headersEl.value).toContain('content-type: image/png');
  });

  it('server ending the HTTP/2 connection drops it from the pool', async () => {
    const { openEnds } = await setup({ http2Enabled: true });
    await browser._doGet('https://10.0.0.1/a.png', never);
    const [conn] = browser._pooledConns();
    server.os.net.closeTCPConn(conn.key.replace('c', 's'));
    await settle();
    expect(browser._pooledConns().length).toBe(0);
    expect(openEnds()).toBe(0);
    // next request opens a new connection
    expect((await browser._doGet('https://10.0.0.1/b.png', never))?.statusCode).toBe(200);
  });

  it('protocol setting is persisted and closes old connections', async () => {
    const { files, os } = await setup({ http2Enabled: true });
    await browser._doGet('https://10.0.0.1/a.png', never);
    browser._setProtocolMode('http1');
    expect(browser._pooledConns().length).toBe(0);
    expect(JSON.parse(files['/etc/sparktail.conf']).protocol).toBe('http1');
    const again = new SparktailHTTPClientApp(/** @type {any} */ (os));
    again._loadConfig();
    expect(again.protocolMode).toBe('http1');
  });

  it('records the TLS version of the connection (TLS 1.3 when the server offers it)', async () => {
    await setup({ http2Enabled: true, tls13Enabled: true });
    await browser._doGet('https://10.0.0.1/a.png', never);
    expect(browser._pooledConns()[0].tlsVersion).toBe('TLS 1.3');
    await browser._fetchUrl('https://10.0.0.1/b.png');
    expect(browser._connInfo).toBe('TLS 1.3, HTTP/2');
  });
});
