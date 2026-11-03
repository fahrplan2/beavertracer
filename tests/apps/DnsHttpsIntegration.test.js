//@ts-check

/**
 * DNS server ↔ resolver ↔ dig / nslookup / Sparktail on one in-memory network:
 * HTTPS records, SOA answers, NODATA vs. NXDOMAIN, first visit over HTTP/3.
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

const { DNSServerApp } = await import('../../src/apps/DNSServerApp.js');
const { DNSResolver } = await import('../../src/apps/lib/DNSResolver.js');
const { SimpleHTTPServerApp } = await import('../../src/apps/SimpleHTTPServerApp.js');
const { SparktailHTTPClientApp } = await import('../../src/apps/SparktailHTTPClientApp.js');
const { TlsCertificate } = await import('../../src/net/models/TlsCertificate.js');
const { dig } = await import('../../src/apps/terminal/commands/net/dig.js');
const { nslookup } = await import('../../src/apps/terminal/commands/net/nslookup.js');
const { makeLinkedNet, makeFS } = await import('../support/linkedNet.js');

const ZONE = {
  a: [{ name: 'www.beaver.lan', ip: '10.0.0.1', ttl: 60 }],
  aaaa: [{ name: 'www.beaver.lan', ip: '2001:db8::1', ttl: 60 }],
  ns: [{ name: 'beaver.lan', host: 'ns.beaver.lan', ttl: 300 }],
  https: [{ name: 'www.beaver.lan', priority: 1, target: '.', params: 'alpn=h3,h2 port=443', ttl: 300 }],
};

describe('DNS HTTPS records end to end', () => {
  /** @type {any[]} */ const apps = [];
  afterEach(() => { for (const a of apps.splice(0)) (a._stop ?? a.destroy)?.call(a); });

  /** @param {any} [zone] */
  function setup(zone = ZONE) {
    const linked = makeLinkedNet();
    linked.control.udpSrc = '10.0.0.53'; // dig only accepts replies from the queried server
    /** @type {any} */
    const os = { net: linked.net, fs: makeFS({ '/var/www/index.html': 'hi' }), exit() {}, clock: { nowMs: () => Date.now() } };
    os.dns = new DNSResolver(os, '10.0.0.53');
    const dns = new DNSServerApp(os);
    dns.cfg = { a: [], aaaa: [], cname: [], mx: [], ns: [], https: [], mode: 'authoritative', forwarderIp: '', ...zone };
    dns._start();
    apps.push(dns);
    /** @type {string[]} */
    const out = [];
    const ctx = /** @type {any} */ ({ os, cwd: '/', env: {}, onInterrupt: () => {}, signal: new AbortController().signal, println: (/** @type {string} */ s = '') => out.push(s) });
    return { os, linked, ctx, out };
  }

  it('dig shows the HTTPS record in presentation format', async () => {
    const { ctx, out } = setup();
    await dig.run(ctx, ['www.beaver.lan', 'HTTPS']);
    const text = out.join('\n');
    expect(text).toContain('status: NOERROR');
    expect(text).toMatch(/www\.beaver\.lan\t300\tIN\tHTTPS\t1 \. alpn="h3,h2" port=443/);
    out.length = 0;
    await dig.run(ctx, ['+short', 'www.beaver.lan', 'HTTPS']);
    expect(out).toEqual(['1 . alpn="h3,h2" port=443']);
  });

  it('dig: NODATA and NXDOMAIN with readable SOA, SOA query answered at the apex', async () => {
    const { ctx, out } = setup();
    await dig.run(ctx, ['beaver.lan', 'HTTPS']);
    let text = out.join('\n');
    expect(text).toContain('status: NOERROR');
    expect(text).toContain('ANSWER: 0, AUTHORITY: 1');
    expect(text).toMatch(/beaver\.lan\t60\tIN\tSOA\tns\.beaver\.lan\. hostmaster\.beaver\.lan\. 1 3600 900 86400 60/);
    expect(text).not.toContain('[object Object]');
    out.length = 0;
    await dig.run(ctx, ['nope.beaver.lan', 'A']);
    expect(out.join('\n')).toContain('status: NXDOMAIN');
    out.length = 0;
    await dig.run(ctx, ['beaver.lan', 'SOA']);
    text = out.join('\n');
    expect(text).toContain('ANSWER: 1');
    expect(text).toMatch(/;; ANSWER SECTION:\nbeaver\.lan\t60\tIN\tSOA/);
  });

  it('dig prints AAAA as an IPv6 address', async () => {
    const { ctx, out } = setup();
    await dig.run(ctx, ['+short', 'www.beaver.lan', 'AAAA']);
    expect(out).toEqual(['2001:db8::1']);
  });

  it('nslookup: HTTPS record, "No answer" (NODATA) vs. NXDOMAIN', async () => {
    const { ctx, out } = setup();
    await nslookup.run(ctx, ['-type=HTTPS', 'www.beaver.lan']);
    expect(out).toContain('www.beaver.lan\trdata_65 = 1 . alpn="h3,h2" port=443');
    out.length = 0;
    await nslookup.run(ctx, ['-type=HTTPS', 'beaver.lan']);
    expect(out.at(-1)).toMatch(/No answer|nslookup\.err\.noAnswer/);
    out.length = 0;
    await nslookup.run(ctx, ['nope.beaver.lan']);
    expect(out.at(-1)).toMatch(/NXDOMAIN|nslookup\.err\.notFound/);
  });

  it('negative answers are cached for min(SOA TTL, SOA minimum) (RFC 2308 §5)', () => {
    const r = new DNSResolver({}, '10.0.0.53');
    const neg = { answers: [], authorities: [{ type: 6, ttl: 3600, data: { minimum: 30 } }] };
    expect(r._pickCacheTTLSeconds(neg)).toBe(30);
    const neg2 = { answers: [], authorities: [{ type: 6, ttl: 20, data: { minimum: 300 } }] };
    expect(r._pickCacheTTLSeconds(neg2)).toBe(20);
  });

  it('Sparktail uses HTTP/3 on the first visit when DNS announces it', async () => {
    const { os, linked } = setup();
    const web = new SimpleHTTPServerApp(os);
    web.httpsEnabled = true;
    web.http3Enabled = true;
    web._cert = await TlsCertificate.generate('www.beaver.lan');
    web._start();
    apps.push(web);
    const browser = new SparktailHTTPClientApp(os);
    apps.push(browser);
    const before = linked.stats.connects;
    const r = await browser._doGet('https://www.beaver.lan/', () => false);
    expect(r?.statusCode).toBe(200);
    expect(linked.stats.connects).toBe(before);        // no TCP at all
    expect(browser._pooledConns()[0].proto).toBe('HTTP/3 (QUIC)');
    expect(browser.log.some((/** @type {string} */ l) => /HTTPS|httpsRR/.test(l))).toBe(true);
  });

  it('without an HTTPS record Sparktail starts on TCP as before', async () => {
    const { os, linked } = setup({ ...ZONE, https: [] });
    const web = new SimpleHTTPServerApp(os);
    web.httpsEnabled = true;
    web.http3Enabled = true;
    web._cert = await TlsCertificate.generate('www.beaver.lan');
    web._start();
    apps.push(web);
    const browser = new SparktailHTTPClientApp(os);
    apps.push(browser);
    const before = linked.stats.connects;
    await browser._doGet('https://www.beaver.lan/', () => false);
    expect(linked.stats.connects).toBe(before + 1);
    expect(browser._pooledConns()[0].proto).toMatch(/HTTP\/1\.1/);
  });
});
