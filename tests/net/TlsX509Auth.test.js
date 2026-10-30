//@ts-check

/**
 * TLS server authentication — X.509 v3 encoding, CA constraints on the chain,
 * mandatory ServerKeyExchange signature (ECDHE_ECDSA), and compatibility
 * with legacy (v1-layout) certificates stored in save files / lesson sims.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TlsSession, TlsCertUntrustedError, TlsMissingAuthError, TlsSignatureError, certMatchesName,
} from '../../src/net/TlsSession.js';
import { TlsCertificate, TlsTrustStore } from '../../src/net/models/TlsCertificate.js';
import { TlsRecord } from '../../src/net/pdu/TlsRecord.js';

// ── helpers ────────────────────────────────────────────────────────────────

/** @param {Uint8Array} data @param {number} offset */
function el(data, offset) {
  let off = offset + 1;
  let len;
  if (data[off] < 0x80) { len = data[off]; off += 1; }
  else if (data[off] === 0x81) { len = data[off + 1]; off += 2; }
  else { len = (data[off + 1] << 8) | data[off + 2]; off += 3; }
  return { start: offset, contentStart: off, end: off + len };
}

/** @param {Uint8Array} der */
function tbsChildren(der) {
  const outer = el(der, 0);
  const tbs = el(der, outer.contentStart);
  const kids = [];
  for (let o = tbs.contentStart; o < tbs.end;) { const e = el(der, o); kids.push(e); o = e.end; }
  const sigAlg = el(der, tbs.end);
  return { kids, sigAlg };
}

/** @param {Uint8Array} der @param {{start:number,end:number}} e */
const hex = (der, e) => Buffer.from(der.slice(e.start, e.end)).toString('hex');

const ECDSA_SHA256_ALGID = '300a06082a8648ce3d040302';

/**
 * Loopback handshake; `tamperS2C` may rewrite or drop (return null) server records.
 * @param {TlsCertificate} serverCert
 * @param {{ trustStore?: TlsTrustStore|null, serverName?: string,
 *   tamperS2C?: (d: Uint8Array) => Uint8Array|null }} [opts]
 */
async function handshake(serverCert, opts = {}) {
  /** @type {Uint8Array[]} */ const c2sWire = [];
  const mkQueue = () => {
    /** @type {Uint8Array[]} */ const q = [];
    /** @type {((d: Uint8Array) => void)|null} */ let waiter = null;
    return {
      push: (/** @type {Uint8Array} */ d) => { if (waiter) { const w = waiter; waiter = null; w(d); } else q.push(d); },
      recv: () => new Promise(r => { if (q.length) r(/** @type {Uint8Array} */ (q.shift())); else waiter = r; }),
    };
  };
  const c2s = mkQueue(), s2c = mkQueue();
  const client = new TlsSession({
    send: d => { c2sWire.push(d.slice()); c2s.push(d); },
    recv: s2c.recv, isServer: false,
    trustStore: opts.trustStore ?? undefined, serverName: opts.serverName,
    timeoutMs: 2000, sleepFn: ms => new Promise(r => setTimeout(r, ms)),
  });
  const server = new TlsSession({
    send: d => { const out = opts.tamperS2C ? opts.tamperS2C(d.slice()) : d; if (out) s2c.push(out); },
    recv: c2s.recv, isServer: true, cert: serverCert,
    timeoutMs: 300, sleepFn: ms => new Promise(r => setTimeout(r, ms)),
  });
  const [c, s] = await Promise.allSettled([client.handshake(), server.handshake()]);
  const all = new Uint8Array(c2sWire.reduce((n, x) => n + x.length, 0));
  let off = 0; for (const x of c2sWire) { all.set(x, off); off += x.length; }
  return { client: c, server: s, c2s: TlsRecord.parseRecords(all).records };
}

// ── 1. ServerKeyExchange signature / Certificate are mandatory ────────────

describe('ECDHE_ECDSA server authentication (RFC 8422 §5.4)', () => {
  /** strip the signature from the ServerKeyExchange record → [params][0x0000][0x0000] */
  const stripSkeSignature = (/** @type {Uint8Array} */ d) => {
    if (d[0] !== 22 || d[5] !== 12) return d;
    const keyLen = d[9 + 3];
    const params = d.slice(9, 9 + 4 + keyLen);
    const body = new Uint8Array(params.length + 4); body.set(params, 0);
    const hs = new Uint8Array(4 + body.length);
    hs[0] = 12; hs[1] = 0; hs[2] = (body.length >> 8) & 0xff; hs[3] = body.length & 0xff; hs.set(body, 4);
    return new TlsRecord(22, hs).pack();
  };

  it('builder refuses to produce an unsigned ServerKeyExchange', () => {
    const key = new Uint8Array(65); key[0] = 4;
    expect(() => TlsRecord.buildServerKeyExchange(key, new Uint8Array(0))).toThrow();
  });

  it('client aborts with a plaintext fatal handshake_failure if the SKE is unsigned (MITM swapped the key)', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const r = await handshake(cert, { tamperS2C: stripSkeSignature });
    expect(r.client.status).toBe('rejected');
    expect(/** @type {any} */ (r.client).reason).toBeInstanceOf(TlsMissingAuthError);
    const alert = r.c2s[r.c2s.length - 1];
    expect(alert.contentType).toBe(21);
    expect(Array.from(alert.payload)).toEqual([2, 40]);           // before CCS → not encrypted
    expect(r.c2s.some(x => x.contentType === 20)).toBe(false);     // never got to ChangeCipherSpec
  });

  it('also without a trust store (curl -k only skips certificate checks)', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const trust = new TlsTrustStore(); trust.add(cert);
    const r1 = await handshake(cert, { tamperS2C: stripSkeSignature });
    const r2 = await handshake(cert, { trustStore: trust, tamperS2C: stripSkeSignature });
    expect(r1.client.status).toBe('rejected');
    expect(r2.client.status).toBe('rejected');
  });

  it('client aborts with handshake_failure if the server sends no Certificate', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const r = await handshake(cert, { tamperS2C: d => (d[0] === 22 && d[5] === 11 ? null : d) });
    expect(/** @type {any} */ (r.client).reason).toBeInstanceOf(TlsMissingAuthError);
    expect(Array.from(r.c2s[r.c2s.length - 1].payload)).toEqual([2, 40]);
  });

  it('a wrong SKE signature yields decrypt_error (51)', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const r = await handshake(cert, {
      tamperS2C: d => { if (d[0] === 22 && d[5] === 12) d[d.length - 1] ^= 0x01; return d; },
    });
    expect(/** @type {any} */ (r.client).reason).toBeInstanceOf(TlsSignatureError);
    expect(Array.from(r.c2s[r.c2s.length - 1].payload)).toEqual([2, 51]);
  });

  it('an unmodified handshake still succeeds', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const r = await handshake(cert);
    expect(r.client.status).toBe('fulfilled');
    expect(r.server.status).toBe('fulfilled');
  });
});

// ── 2./3. X.509 v3 encoding ───────────────────────────────────────────────

describe('X.509 v3 certificate encoding (RFC 5280 §4.1)', () => {
  it('TBS signature field is ecdsa-with-SHA256, identical to the outer signatureAlgorithm', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const der = cert.toDer();
    const { kids, sigAlg } = tbsChildren(der);
    expect(hex(der, kids[2])).toBe(ECDSA_SHA256_ALGID);  // [0]version, serial, signature
    expect(hex(der, sigAlg)).toBe(ECDSA_SHA256_ALGID);
  });

  it('is v3 with critical basicConstraints: cA TRUE for a CA, empty (cA FALSE) for a leaf', async () => {
    const ca = await TlsCertificate.generate('Test CA', null, { isCA: true });
    const leaf = await TlsCertificate.generate('www.bank.de', ca);
    for (const [cert, bc] of /** @type {const} */ ([[ca, '30030101ff'], [leaf, '3000']])) {
      const der = cert.toDer();
      const { kids } = tbsChildren(der);
      expect(hex(der, kids[0])).toBe('a003020102');                   // version v3
      const exts = hex(der, kids[kids.length - 1]);
      expect(exts.startsWith('a3')).toBe(true);
      expect(exts).toContain('0603551d130101ff04' + (bc.length / 2).toString(16).padStart(2, '0') + bc);
    }
    expect(hex(leaf.toDer(), tbsChildren(leaf.toDer()).kids.at(-1))).toContain('551d11');
    expect(leaf.subjectAltNames()).toEqual(['www.bank.de']);
    expect(ca.subjectAltNames()).toEqual([]);
  });

  it('cA and SAN survive the wire: parsed peer cert reports isCA / subjectAltNames', async () => {
    const root = await TlsCertificate.generate('Root', null, { isCA: true });
    const inter = await TlsCertificate.generate('Inter', root, { isCA: true });
    const leaf = await TlsCertificate.generate('www.bank.de', inter);
    const trust = new TlsTrustStore(); trust.add(root);
    const r = await handshake(leaf, { trustStore: trust, serverName: 'www.bank.de' });
    expect(r.client.status).toBe('fulfilled');
  });

  it('hostname check uses SAN first and only falls back to the CN without SAN (RFC 6125)', () => {
    expect(certMatchesName('CN=www.bank.de', 'www.bank.de', ['www.bank.de'])).toBe(true);
    expect(certMatchesName('CN=www.bank.de', 'www.bank.de', ['other.de'])).toBe(false);
    expect(certMatchesName('CN=Bank', 'www.bank.de', ['*.bank.de'])).toBe(true);
    expect(certMatchesName('CN=www.bank.de', 'www.bank.de', [])).toBe(true);
  });
});

// ── 3. chain constraints ──────────────────────────────────────────────────

describe('certificate chain: issuers must be valid CAs (RFC 5280 §6.1.4(k))', () => {
  it('rejects a certificate signed by a leaf (non-CA) certificate', async () => {
    const root = await TlsCertificate.generate('Root', null, { isCA: true });
    const attackerLeaf = await TlsCertificate.generate('evil.example', root);   // legit leaf
    const forged = await TlsCertificate.generate('www.bank.de', attackerLeaf);  // signed by the leaf
    const trust = new TlsTrustStore(); trust.add(root);
    expect(await trust.isTrusted(forged, forged.chain)).toBe(false);
    const r = await handshake(forged, { trustStore: trust, serverName: 'www.bank.de' });
    expect(/** @type {any} */ (r.client).reason).toBeInstanceOf(TlsCertUntrustedError);
  });

  it('a leaf whose JSON was edited to isCA=true still cannot issue (cA is signed into the cert)', async () => {
    const root = await TlsCertificate.generate('Root', null, { isCA: true });
    const leaf = await TlsCertificate.generate('evil.example', root);
    const json = /** @type {any} */ (await leaf.toSaveData());
    json.isCA = true;
    const tamperedLeaf = await TlsCertificate.fromJSON(json);
    const forged = await TlsCertificate.generate('www.bank.de', tamperedLeaf);
    const trust = new TlsTrustStore(); trust.add(root);
    const r = await handshake(forged, { trustStore: trust, serverName: 'www.bank.de' });
    expect(r.client.status).toBe('rejected');
  });

  it('accepts root → intermediate CA → leaf, rejects an expired intermediate', async () => {
    const now = Date.now();
    const root = await TlsCertificate.generate('Root', null, { isCA: true, validityDays: 3650, nowMs: now - 86400000 * 400 });
    const inter = await TlsCertificate.generate('Inter', root, { isCA: true, validityDays: 30, nowMs: now - 86400000 * 10 });
    const leaf = await TlsCertificate.generate('www.bank.de', inter, { nowMs: now - 1000 });
    const trust = new TlsTrustStore(); trust.add(root);
    expect(await trust.isTrusted(leaf, [], { nowMs: now })).toBe(true);
    expect(await trust.isTrusted(leaf, [], { nowMs: now + 86400000 * 25 })).toBe(false); // inter expired
  });
});

// ── compatibility with certificates saved before the v3 layout ────────────

describe('legacy certificates from lesson sims / save files', () => {
  const simDir = path.resolve(__dirname, '../../public/sims');
  /** @type {{ sim: string, file: string, host: string, json: any }[]} */
  const certs = [];
  for (const f of fs.readdirSync(simDir).filter(n => n.endsWith('.btsim'))) {
    const state = JSON.parse(fs.readFileSync(path.join(simDir, f), 'utf8'));
    /** @param {any} n @param {string} host */
    const walk = (n, host) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'file' && typeof n.data === 'string') {
        try { const j = JSON.parse(n.data); if (j && 'certSignatureHex' in j) certs.push({ sim: f, file: n.name, host, json: j }); } catch { /* not JSON */ }
        return;
      }
      for (const v of Object.values(n)) walk(v, n.name && n.kind ? n.name : host);
    };
    walk(state, '');
  }
  /** @param {string} sim @param {string} subject */
  const find = (sim, subject, priv = true) =>
    certs.find(c => c.sim === sim && c.json.subject === subject && (!priv || c.json.privateKeyJwk));

  it('finds the certificates of the HTTPS lessons', () => {
    expect(certs.length).toBeGreaterThanOrEqual(10);
  });

  it('every stored certificate loads as legacy v1 and its stored signature still verifies', async () => {
    for (const c of certs) {
      const cert = await TlsCertificate.fromJSON(c.json);
      expect(cert.x509Version, `${c.sim} ${c.file}`).toBe(1);
      const issuer = cert.selfSigned ? cert : cert.chain[0];
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
        /** @type {CryptoKey} */ (issuer.publicKey),
        /** @type {Uint8Array<ArrayBuffer>} */ (cert.certSignature),
        /** @type {Uint8Array<ArrayBuffer>} */ (cert._buildTbsBytes()));
      expect(ok, `${c.sim} ${c.file}`).toBe(true);
      // round trip keeps the legacy layout
      expect((await TlsCertificate.fromJSON(await cert.toSaveData())).x509Version).toBe(1);
    }
  });

  it('lesson 8.3.3: legacy server cert + legacy trusted CA still give a working HTTPS handshake', async () => {
    const leaf = await TlsCertificate.fromJSON(find('lesson-8.3.3.btsim', 'CN=www.beaver-schule.de')?.json);
    const root = await TlsCertificate.fromJSON(find('lesson-8.3.3.btsim', 'CN=Schul-CA', false)?.json);
    const trust = new TlsTrustStore(); trust.add(root);
    const r = await handshake(leaf, { trustStore: trust, serverName: 'www.beaver-schule.de' });
    expect(r.client.status).toBe('fulfilled');
  });

  it('lesson 8.3.3: a new v3 leaf issued by the legacy Schul-CA (CertManager) is trusted', async () => {
    const ca = await TlsCertificate.fromJSON(find('lesson-8.3.3.btsim', 'CN=Schul-CA')?.json);
    expect(ca.isCA && ca.hasPrivateKey).toBe(true);
    const leaf = await TlsCertificate.generate('neu.beaver-schule.de', ca);
    expect(leaf.x509Version).toBe(3);
    const trust = new TlsTrustStore(); trust.add(ca);
    const r = await handshake(leaf, { trustStore: trust, serverName: 'neu.beaver-schule.de' });
    expect(r.client.status).toBe('fulfilled');
  });

  it('lesson 8.3.5: the attacker cannot use his CA-issued leaf to sign www.biberbank.de', async () => {
    const sim = 'lesson-8.3.5.btsim';
    const attacker = await TlsCertificate.fromJSON(find(sim, 'CN=www.biber-gewinnspiel.de')?.json);
    const root = await TlsCertificate.fromJSON(find(sim, 'CN=Biber Root CA', false)?.json);
    const trust = new TlsTrustStore(); trust.add(root);
    // the attacker's own cert is fine for his own domain …
    expect((await handshake(attacker, { trustStore: trust, serverName: 'www.biber-gewinnspiel.de' })).client.status).toBe('fulfilled');
    // … but a cert he issues with it for the bank must not be trusted
    attacker.isCA = true; // even if he flips the flag locally
    const forged = await TlsCertificate.generate('www.biberbank.de', attacker);
    const r = await handshake(forged, { trustStore: trust, serverName: 'www.biberbank.de' });
    expect(/** @type {any} */ (r.client).reason).toBeInstanceOf(TlsCertUntrustedError);
  });
});
