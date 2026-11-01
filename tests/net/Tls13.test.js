//@ts-check

/**
 * TLS 1.3 (RFC 8446): our client ↔ our server, version negotiation and
 * downgrade protection, and interop with OpenSSL through node:tls in both
 * directions (the real check of key schedule, record format and signatures).
 */

import { describe, it, expect, afterEach } from 'vitest';
import tls from 'node:tls';
import { duplexPair } from 'node:stream';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import {
  TlsSession, TlsHandshakeError, TlsAlertReceivedError, TlsCertUntrustedError,
  hkdfExpandLabel, ecdsaRawToDer, ecdsaDerToRaw,
} from '../../src/net/TlsSession.js';
import { TlsCertificate, TlsTrustStore } from '../../src/net/models/TlsCertificate.js';
import { TlsRecord } from '../../src/net/pdu/TlsRecord.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const FIXTURE_KEY = readFileSync(new URL('../fixtures/interop-p256.pkcs8.pem', import.meta.url), 'utf8');
const FIXTURE_CERT = readFileSync(new URL('../fixtures/interop-p256.cert.pem', import.meta.url), 'utf8');

// ── transports ───────────────────────────────────────────────────────────────

function makeQueue() {
  /** @type {Array<Uint8Array|null>} */
  const items = [];
  /** @type {((v: Uint8Array|null) => void)|null} */
  let waiter = null;
  return {
    push(/** @type {Uint8Array|null} */ v) { if (waiter) { const w = waiter; waiter = null; w(v); } else items.push(v); },
    /** @returns {Promise<Uint8Array|null>} */
    next() { return items.length ? Promise.resolve(/** @type {any} */ (items.shift())) : new Promise(r => { waiter = r; }); },
  };
}

function makePipe() {
  const a2b = makeQueue(), b2a = makeQueue();
  /** @type {{ a: Uint8Array[], b: Uint8Array[] }} */
  const wire = { a: [], b: [] };
  return {
    wire,
    a: { send: (/** @type {Uint8Array} */ d) => { wire.a.push(d.slice()); a2b.push(d.slice()); }, recv: () => b2a.next() },
    b: { send: (/** @type {Uint8Array} */ d) => { wire.b.push(d.slice()); b2a.push(d.slice()); }, recv: () => a2b.next() },
  };
}

/** @param {import('node:stream').Duplex} sock */
function fromDuplex(sock) {
  const q = makeQueue();
  sock.on('data', (/** @type {Buffer} */ d) => q.push(new Uint8Array(d)));
  sock.on('end', () => q.push(null));
  return { send: (/** @type {Uint8Array} */ d) => { sock.write(Buffer.from(d)); }, recv: () => q.next() };
}

/** Record content types and the first handshake type of plaintext records. @param {Uint8Array[]} chunks */
function records(chunks) {
  const { records: recs } = TlsRecord.parseRecords(/** @type {any} */ (new Uint8Array(Buffer.concat(chunks.map(c => Buffer.from(c))))));
  return recs.map(r => ({ type: r.contentType, hs: r.contentType === 0x16 ? r.payload[0] : -1 }));
}

/**
 * @param {any} serverOpts
 * @param {any} clientOpts
 */
async function pair(serverOpts, clientOpts) {
  const pipe = makePipe();
  const client = new TlsSession({ ...pipe.a, isServer: false, timeoutMs: 5000, ...clientOpts });
  const server = new TlsSession({ ...pipe.b, isServer: true, timeoutMs: 5000, ...serverOpts });
  const [c, s] = await Promise.allSettled([client.handshake(), server.handshake()]);
  return { client, server, c, s, pipe };
}

/** The fixture as a server certificate object (duck-typed TlsCertificate). */
async function fixtureCert() {
  const b64 = FIXTURE_KEY.replace(/-----[^-]+-----|\s+/g, '');
  const privateKey = await webcrypto.subtle.importKey('pkcs8', Buffer.from(b64, 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const der = new Uint8Array(Buffer.from(FIXTURE_CERT.replace(/-----[^-]+-----|\s+/g, ''), 'base64'));
  return /** @type {any} */ ({ privateKey, toDer: () => der, chain: [], subject: 'CN=interop.test' });
}

// ── helpers ──────────────────────────────────────────────────────────────────

describe('TLS 1.3 helpers', () => {
  it('ECDSA r||s <-> DER round-trips, including leading-zero and high-bit cases', () => {
    for (const fill of [0x00, 0x7f, 0x80, 0xff]) {
      const raw = new Uint8Array(64).fill(fill);
      raw[0] = 0; raw[32] = 0x80;
      const der = ecdsaRawToDer(raw);
      expect(der[0]).toBe(0x30);
      expect(Array.from(/** @type {Uint8Array} */ (ecdsaDerToRaw(der)))).toEqual(Array.from(raw));
    }
    expect(ecdsaDerToRaw(new Uint8Array([0x30, 0x02, 0x05, 0x00]))).toBeNull();
  });

  it('HKDF-Expand-Label builds the "tls13 " label (RFC 8446 §7.1)', async () => {
    const a = await hkdfExpandLabel(new Uint8Array(32), 'key', new Uint8Array(0), 16);
    const b = await hkdfExpandLabel(new Uint8Array(32), 'iv', new Uint8Array(0), 12);
    expect(a.length).toBe(16);
    expect(b.length).toBe(12);
    expect(Buffer.from(a).equals(Buffer.from(b.subarray(0, 12)))).toBe(false);
  });
});

// ── our client ↔ our server ──────────────────────────────────────────────────

describe('TLS 1.3 loopback', () => {
  it('negotiates TLS 1.3 when the server enables it, 1-RTT flight shape', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { client, server, pipe } = await pair({ cert, versions: ['1.3', '1.2'] }, {});
    expect(client.version).toBe('TLS 1.3');
    expect(server.version).toBe('TLS 1.3');
    // server: plaintext ServerHello, compatibility CCS, then only encrypted records
    const s2c = records(pipe.wire.b);
    expect(s2c[0]).toEqual({ type: 0x16, hs: 2 });
    expect(s2c[1].type).toBe(0x14);
    expect(s2c.slice(2).every(r => r.type === 0x17)).toBe(true);
    // the certificate is no longer readable on the wire
    expect(s2c.some(r => r.hs === 11)).toBe(false);
  });

  it('application data round-trips in both directions', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { client, server } = await pair({ cert, versions: ['1.3'] }, {});
    await client.send(enc.encode('ping'));
    expect(dec.decode(/** @type {Uint8Array} */ (await server.recv()))).toBe('ping');
    await server.send(enc.encode('pong'));
    expect(dec.decode(/** @type {Uint8Array} */ (await client.recv()))).toBe('pong');
    server.close();
    expect(await client.recv()).toBeNull();
  });

  it('ALPN and SNI work inside EncryptedExtensions', async () => {
    const a = await TlsCertificate.generate('a.lan');
    const b = await TlsCertificate.generate('b.lan');
    const { client, server } = await pair(
      { versions: ['1.3'], alpn: ['h2', 'http/1.1'], selectCert: (/** @type {string} */ sni) => (sni === 'b.lan' ? b : a) },
      { serverName: 'b.lan', alpn: ['h2', 'http/1.1'] },
    );
    expect(client.alpn).toBe('h2');
    expect(server.sni).toBe('b.lan');
    expect(client.peerCert?.subject).toBe('CN=b.lan');
  });

  it('certificate checks apply as in 1.2', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { c } = await pair({ cert, versions: ['1.3'] }, { trustStore: new TlsTrustStore() });
    expect(/** @type {PromiseRejectedResult} */ (c).reason).toBeInstanceOf(TlsCertUntrustedError);
  });

  it('a 1.2-only server still works with a 1.3-offering client', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { client } = await pair({ cert }, {});
    expect(client.version).toBe('TLS 1.2');
  });

  it('a 1.3-capable server marks a 1.2 handshake; a 1.2-only client is fine', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { client, c } = await pair({ cert, versions: ['1.3', '1.2'] }, { versions: ['1.2'] });
    expect(c.status).toBe('fulfilled');
    expect(client.version).toBe('TLS 1.2');
  });

  it('client detects a downgrade (1.3 server forced to 1.2 by an attacker)', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const pipe = makePipe();
    const client = new TlsSession({ ...pipe.a, isServer: false, timeoutMs: 5000 });
    // "attacker": strips supported_versions from the ClientHello on its way
    const server = new TlsSession({
      send: pipe.b.send,
      recv: async () => {
        const d = await pipe.b.recv();
        if (d && d[0] === 0x16 && d[5] === 0x01) {
          return TlsRecord.buildClientHello(d.slice(11, 43), '', []); // same random, no 1.3 offer
        }
        return d;
      },
      isServer: true, cert, versions: ['1.3', '1.2'], timeoutMs: 5000,
    });
    const [c] = await Promise.allSettled([client.handshake(), server.handshake()]);
    const err = /** @type {PromiseRejectedResult} */ (c).reason;
    expect(err).toBeInstanceOf(TlsHandshakeError);
    expect(err.message).toMatch(/Downgrade/);
  });

  it('1.3-only client vs 1.2-only server -> protocol_version', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { c } = await pair({ cert }, { versions: ['1.3'] });
    expect(/** @type {PromiseRejectedResult} */ (c).reason.message).toMatch(/TLS 1.3/);
  });

  it('1.3-only server vs 1.2-only client -> protocol_version alert', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { c } = await pair({ cert, versions: ['1.3'] }, { versions: ['1.2'], timeoutMs: 5000 });
    const err = /** @type {PromiseRejectedResult} */ (c).reason;
    expect(err).toBeInstanceOf(TlsAlertReceivedError);
    expect(err.description).toBe(70);
  });

  it('a tampered encrypted record is rejected', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const pipe = makePipe();
    let flip = false;
    const client = new TlsSession({
      send: pipe.a.send,
      recv: async () => {
        const d = await pipe.a.recv();
        if (d && d[0] === 0x17 && !flip) { flip = true; const x = d.slice(); x[x.length - 1] ^= 1; return x; }
        return d;
      },
      isServer: false, timeoutMs: 5000,
    });
    const server = new TlsSession({ ...pipe.b, isServer: true, cert, versions: ['1.3'], timeoutMs: 5000 });
    const [c] = await Promise.allSettled([client.handshake(), server.handshake()]);
    expect(/** @type {PromiseRejectedResult} */ (c).reason.message).toMatch(/bad_record_mac/);
  });
});

// ── interop with OpenSSL (node:tls) ──────────────────────────────────────────

describe('TLS 1.3 interop with OpenSSL', () => {
  /** @type {Array<() => void>} */
  const cleanup = [];
  afterEach(() => { for (const f of cleanup.splice(0)) f(); });

  it('our client ↔ OpenSSL server', async () => {
    const [ours, theirs] = duplexPair();
    const server = new tls.TLSSocket(/** @type {any} */ (theirs), {
      isServer: true, key: FIXTURE_KEY, cert: FIXTURE_CERT,
      minVersion: 'TLSv1.3', ecdhCurve: 'prime256v1', ALPNProtocols: ['h2', 'http/1.1'],
    });
    server.on('data', (d) => server.write(`echo:${d}`));
    server.on('error', () => {});
    cleanup.push(() => server.destroy());

    const client = new TlsSession({ ...fromDuplex(ours), isServer: false, timeoutMs: 5000, serverName: 'interop.test', alpn: ['h2', 'http/1.1'] });
    await client.handshake();
    expect(client.version).toBe('TLS 1.3');
    expect(client.alpn).toBe('h2');
    expect(client.peerCert?.publicKey).toBeTruthy();
    await client.send(enc.encode('hi'));
    // OpenSSL may send NewSessionTicket first; recv() skips it
    expect(dec.decode(/** @type {Uint8Array} */ (await client.recv()))).toBe('echo:hi');
  });

  it('OpenSSL client ↔ our server', async () => {
    const [ours, theirs] = duplexPair();
    const server = new TlsSession({
      ...fromDuplex(ours), isServer: true, timeoutMs: 5000,
      cert: await fixtureCert(), versions: ['1.3'], alpn: ['h2', 'http/1.1'],
    });
    const serverDone = server.handshake();

    const client = tls.connect({
      socket: /** @type {any} */ (theirs), servername: 'interop.test', rejectUnauthorized: false,
      minVersion: 'TLSv1.3', ecdhCurve: 'prime256v1', ALPNProtocols: ['http/1.1'],
    });
    client.on('error', () => {});
    cleanup.push(() => client.destroy());
    await new Promise((resolve, reject) => { client.once('secureConnect', resolve); client.once('error', reject); });
    await serverDone;
    expect(client.getProtocol()).toBe('TLSv1.3');
    expect(client.alpnProtocol).toBe('http/1.1');
    expect(server.sni).toBe('interop.test');

    client.write('from openssl');
    expect(dec.decode(/** @type {Uint8Array} */ (await server.recv()))).toBe('from openssl');
    const got = new Promise((r) => client.once('data', (d) => r(String(d))));
    await server.send(enc.encode('from beaver'));
    expect(await got).toBe('from beaver');
  });
});

describe('TLS 1.2 interop with OpenSSL', () => {
  /** @type {Array<() => void>} */
  const cleanup = [];
  afterEach(() => { for (const f of cleanup.splice(0)) f(); });

  it('our 1.2 client ↔ OpenSSL server (DER ServerKeyExchange signature)', async () => {
    const [ours, theirs] = duplexPair();
    const server = new tls.TLSSocket(/** @type {any} */ (theirs), {
      isServer: true, key: FIXTURE_KEY, cert: FIXTURE_CERT, maxVersion: 'TLSv1.2', ciphers: 'ECDHE-ECDSA-AES128-GCM-SHA256',
    });
    server.on('data', (d) => server.write(`echo:${d}`));
    server.on('error', () => {});
    cleanup.push(() => server.destroy());
    const client = new TlsSession({ ...fromDuplex(ours), isServer: false, timeoutMs: 5000, versions: ['1.2'] });
    await client.handshake();
    expect(client.version).toBe('TLS 1.2');
    await client.send(enc.encode('x'));
    expect(dec.decode(/** @type {Uint8Array} */ (await client.recv()))).toBe('echo:x');
  });

  it('OpenSSL 1.2 client ↔ our server (renegotiation_info, RFC 5746)', async () => {
    const [ours, theirs] = duplexPair();
    const server = new TlsSession({ ...fromDuplex(ours), isServer: true, timeoutMs: 5000, cert: await fixtureCert() });
    const serverDone = server.handshake();
    const client = tls.connect({
      socket: /** @type {any} */ (theirs), rejectUnauthorized: false, maxVersion: 'TLSv1.2', ciphers: 'ECDHE-ECDSA-AES128-GCM-SHA256',
    });
    client.on('error', () => {});
    cleanup.push(() => client.destroy());
    await new Promise((resolve, reject) => { client.once('secureConnect', resolve); client.once('error', reject); });
    await serverDone;
    expect(client.getProtocol()).toBe('TLSv1.2');
    client.write('hello');
    expect(dec.decode(/** @type {Uint8Array} */ (await server.recv()))).toBe('hello');
  });
});
