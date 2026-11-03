//@ts-check

/**
 * The complex demo's DNS hierarchy (root -> TLD -> company name servers),
 * resolved the way the providers' recursive DNS servers do it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DNSServerApp } from '../../src/apps/DNSServerApp.js';
import { DNSResolver } from '../../src/apps/lib/DNSResolver.js';
import { DNSPacket } from '../../src/net/pdu/DNSPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

if (!globalThis.document) {
  const el = () => ({ classList: { add() {}, remove() {} }, style: {}, replaceChildren() {}, appendChild() {}, addEventListener() {}, setAttribute() {} });
  // @ts-ignore
  globalThis.document = { createElement: el, createTextNode: () => ({}), createDocumentFragment: () => ({ appendChild() {} }) };
}

const scene = JSON.parse(readFileSync(new URL('../../public/sims/demo-full.btsim', import.meta.url), 'utf8'));

/** @param {any} node @param {string} path */
function readFsFile(node, path) {
  let cur = node;
  for (const part of path.split('/').filter(Boolean)) cur = cur?.children?.find((/** @type {any} */ c) => c.name === part);
  return cur?.data;
}

describe('demo-full.btsim DNS hierarchy', () => {
  /** @type {Map<string, DNSServerApp>} ip -> authoritative server */
  const servers = new Map();
  for (const o of scene.objects) {
    if (!o.fs) continue;
    const conf = readFsFile(o.fs, '/etc/dnsd.conf');
    if (!conf) continue;
    const cfg = JSON.parse(conf);
    if (cfg.mode !== 'authoritative') continue;
    const s = new DNSServerApp(/** @type {any} */ ({ net: {}, fs: { readFile() { throw new Error(); }, writeFile() {} }, exit() {} }));
    s.cfg = { https: [], ...cfg };
    servers.set(o.net.interfaces[0].ip, s);
  }

  /** client net that delivers every query to the authoritative server with that IP */
  function resolver() {
    /** @type {Map<number, any[]>} */ const inbox = new Map();
    /** @type {Map<number, (v: any) => void>} */ const waiters = new Map();
    let next = 2000;
    let queries = 0;
    const net = {
      openUDPSocket() { const id = ++next; inbox.set(id, []); return id; },
      closeUDPSocket(/** @type {number} */ id) { inbox.delete(id); },
      recvUDPSocket(/** @type {number} */ id) {
        const q = inbox.get(id);
        if (q?.length) return Promise.resolve(q.shift());
        return new Promise((r) => waiters.set(id, r));
      },
      sendUDPSocket(/** @type {number} */ id, /** @type {any} */ dst, /** @type {number} */ _p, /** @type {Uint8Array} */ data) {
        queries++;
        const s = servers.get(dst.toString());
        if (!s) return;
        s.os.net = {
          sendUDPSocket(/** @type {any} */ _s, /** @type {any} */ _ip, /** @type {number} */ port, /** @type {Uint8Array} */ resp) {
            const msg = { src: dst, srcPort: 53, payload: resp };
            const w = waiters.get(port);
            if (w) { waiters.delete(port); w(msg); } else inbox.get(port)?.push(msg);
          },
        };
        void s._handleDNSQuery(53, IPAddress.fromString('192.0.2.3'), id, data);
      },
    };
    const r = new DNSResolver(/** @type {any} */ ({ net }), '198.41.0.4', { cache: false });
    return { r, count: () => queries };
  }

  it('has the expected authoritative servers', () => {
    expect([...servers.keys()].sort()).toEqual(['185.1.1.30', '185.1.1.31', '185.2.1.53', '185.3.1.53', '198.41.0.4']);
  });

  it('www.example.com A/AAAA/HTTPS via root -> .com -> ns1.example.com, without timeouts', async () => {
    const { r, count } = resolver();
    expect((await r.resolveA_IP('www.example.com')).map(String)).toEqual(['185.3.1.10']);
    expect(r.lastQueryTimedOut).toBe(false);
    expect((await r.resolveAAAA('www.example.com')).map(String)).toEqual(['2001:db8:3:1::10']);
    const https = await r.resolveHTTPS('www.example.com');
    expect(https[0].params.alpn).toEqual(['h3', 'h2']);
    expect(count()).toBeLessThan(20);
  });

  it('betanet.de: www, MX and NXDOMAIN', async () => {
    const { r } = resolver();
    expect((await r.resolveA_IP('www.betanet.de')).map(String)).toEqual(['185.2.1.10']);
    expect((await r.resolveMX('betanet.de')).map(m => m.exchange)).toEqual(['mail.betanet.de']);
    const neg = await r._query('gibtsnicht.betanet.de', DNSPacket.TYPE_A);
    expect(neg?.rcode).toBe(3);
  });
});
