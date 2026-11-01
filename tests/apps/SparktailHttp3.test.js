//@ts-check

/**
 * Sparktail and HTTP/3: discovery through Alt-Svc, one QUIC connection for
 * parallel resources, TCP fallback when UDP is blocked, "HTTP/3 only".
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
const { simTimer } = await import('../../src/lib/SimTimer.js');
const { makeLinkedNet, makeFS } = await import('../support/linkedNet.js');
const { KEYLOG_PATH } = await import('../../src/lib/keyLog.js');

const dec = new TextDecoder();
const FILES = { '/var/www/index.html': '<html></html>', '/var/www/a.png': 'A', '/var/www/b.png': 'B', '/var/www/c.css': 'C' };
const never = () => false;

describe('Sparktail HTTP/3', () => {
  /** @type {any} */ let server;
  /** @type {any} */ let browser;
  /** @type {any} */ let ticker = null;
  afterEach(() => {
    browser?.destroy?.();
    server?._stop();
    if (ticker) clearInterval(ticker);
    ticker = null;
  });

  /** @param {Record<string, any>} cfg @param {string} [mode] */
  async function setup(cfg, mode = 'auto') {
    const linked = makeLinkedNet();
    const os = { net: linked.net, fs: makeFS({ ...FILES }), exit() {}, dns: { resolveIP: async () => null }, tls: null, clock: { nowMs: () => simTimer.nowMs } };
    server = new SimpleHTTPServerApp(/** @type {any} */ (os));
    server.httpsEnabled = true;
    server._cert = await TlsCertificate.generate('10.0.0.1');
    Object.assign(server, cfg);
    server._start();
    browser = new SparktailHTTPClientApp(/** @type {any} */ (os));
    browser.protocolMode = mode;
    return linked;
  }

  /** Let simulated time run (QUIC timeouts, PTO) while the test waits. */
  function runSimTime() {
    ticker = setInterval(() => { for (let i = 0; i < 40; i++) simTimer.tick(); }, 1);
  }

  it('Auto: first request over TCP learns Alt-Svc, the next ones use QUIC', async () => {
    const { stats } = await setup({ http3Enabled: true, http2Enabled: true });
    const first = await browser._doGet('https://10.0.0.1/a.png', never);
    expect(first?.headers['alt-svc']).toBe('h3=":443"; ma=86400');
    expect(browser._pooledConns()[0].proto).toBe('HTTP/2 (ALPN h2)');
    expect(browser._altSvc.get('https://10.0.0.1:443')?.port).toBe(443);
    // the pooled HTTP/2 connection is still preferred while it is usable;
    // a new navigation context (pool closed) goes for HTTP/3
    browser._closePool();
    const tcpBefore = stats.connects;
    const rs = await Promise.all(['a.png', 'b.png', 'c.css'].map(p => browser._doGet(`https://10.0.0.1/${p}`, never)));
    expect(rs.map(r => dec.decode(r?.body))).toEqual(['A', 'B', 'C']);
    expect(stats.connects).toBe(tcpBefore);           // no new TCP connection
    const conns = browser._pooledConns();
    expect(conns.length).toBe(1);
    expect(conns[0].proto).toBe('HTTP/3 (QUIC)');
    expect(conns[0].requests).toBe(3);
    expect(conns[0].tlsVersion).toBe('TLS 1.3');
  });

  it('navigation shows HTTP/3 in headers and lock popup', async () => {
    await setup({ http3Enabled: true }, 'h3');
    browser.headersEl = { value: '', style: {} };
    await browser._fetchUrl('https://10.0.0.1/a.png');
    expect(browser.headersEl.value.startsWith('HTTP/3 200')).toBe(true);
    expect(browser._connInfo).toBe('TLS 1.3, HTTP/3 (QUIC)');
  });

  it('Auto: UDP blocked -> QUIC times out, falls back to TCP and remembers it', async () => {
    const linked = await setup({ http3Enabled: true });
    await browser._doGet('https://10.0.0.1/a.png', never); // learns Alt-Svc
    browser._closePool();
    linked.control.blockUdp = true;
    runSimTime();
    const r = await browser._doGet('https://10.0.0.1/b.png', never);
    expect(dec.decode(r?.body)).toBe('B');
    expect(browser._pooledConns()[0].proto).toMatch(/^HTTP\/1\.1/);
    expect(browser._h3Broken.has('https://10.0.0.1:443')).toBe(true);
    expect(linked.stats.udpDropped).toBeGreaterThan(0);
    // next time no new QUIC attempt
    browser._closePool();
    const dropped = linked.stats.udpDropped;
    await browser._doGet('https://10.0.0.1/c.css', never);
    expect(linked.stats.udpDropped).toBe(dropped);
  }, 20_000);

  it('"HTTP/3 only" does not fall back', async () => {
    const linked = await setup({ http3Enabled: false }, 'h3');
    linked.control.blockUdp = true;
    runSimTime();
    expect(await browser._doGet('https://10.0.0.1/a.png', never)).toBeNull();
  }, 20_000);

  it('"Disconnect" closes all connections and forgets HTTP/3 knowledge', async () => {
    const { stats } = await setup({ http3Enabled: true });
    await browser._doGet('https://10.0.0.1/a.png', never);   // learns Alt-Svc
    expect(browser._pooledConns().length).toBe(1);
    browser._h3Broken.set('https://x:443', 1e15);
    browser._disconnectAll();
    expect(browser._pooledConns().length).toBe(0);
    expect(browser._altSvc.size).toBe(0);
    expect(browser._h3Broken.size).toBe(0);
    // next request starts over: new TCP connection with handshake
    const before = stats.connects;
    await browser._doGet('https://10.0.0.1/b.png', never);
    expect(stats.connects).toBe(before + 1);
  });

  it('Alt-Svc parsing: other hosts are ignored, "clear" forgets', () => {
    browser = new SparktailHTTPClientApp(/** @type {any} */ ({ net: {}, fs: makeFS({}), clock: { nowMs: () => 0 } }));
    browser._noteAltSvc('https://a.lan:443', 'h3="other.lan:443"');
    expect(browser._altSvc.size).toBe(0);
    browser._noteAltSvc('https://a.lan:443', 'h2=":443", h3=":8443"; ma=60');
    expect(browser._altSvc.get('https://a.lan:443')).toEqual({ port: 8443, expires: 60_000 });
    browser._noteAltSvc('https://a.lan:443', 'clear');
    expect(browser._altSvc.size).toBe(0);
    browser._noteAltSvc('http://a.lan:80', 'h3=":443"');
    expect(browser._altSvc.size).toBe(0);
  });

  it('"Log session keys": TLS and QUIC secrets go to /var/log/sslkeys.log, only when switched on', async () => {
    await setup({ http3Enabled: true, tls13Enabled: true });
    const fs = browser.os.fs;
    await browser._doGet('https://10.0.0.1/a.png', never);
    expect(fs.exists(KEYLOG_PATH)).toBe(false);           // off by default
    browser._closePool();
    browser._setKeyLog(true);
    browser._altSvc.clear();
    await browser._doGet('https://10.0.0.1/a.png', never); // TCP + TLS
    const tcpLog = fs.readFile(KEYLOG_PATH);
    expect(tcpLog).toMatch(/^(CLIENT_RANDOM|CLIENT_HANDSHAKE_TRAFFIC_SECRET) [0-9a-f]{64} [0-9a-f]+\n/);
    browser._closePool();
    await browser._doGet('https://10.0.0.1/b.png', never); // QUIC (Alt-Svc learnt)
    expect(browser._pooledConns()[0].proto).toBe('HTTP/3 (QUIC)');
    const all = fs.readFile(KEYLOG_PATH);
    expect(all.startsWith(tcpLog)).toBe(true);           // appended
    expect(all.slice(tcpLog.length)).toContain('CLIENT_TRAFFIC_SECRET_0 ');
    // the setting is stored with the browser config
    expect(JSON.parse(fs.readFile('/etc/sparktail.conf')).keyLog).toBe(true);
    browser._setKeyLog(false);
    browser._closePool();
    browser._altSvc.clear();
    await browser._doGet('https://10.0.0.1/c.css', never);
    expect(fs.readFile(KEYLOG_PATH)).toBe(all);
  });
});
