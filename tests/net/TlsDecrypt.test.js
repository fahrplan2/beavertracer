//@ts-check

/**
 * Wireshark decrypts our TLS 1.2, TLS 1.3 and QUIC traffic when it gets the
 * session secrets as an NSS key log (what SSLKEYLOGFILE writes) — and only
 * then. Checks both the key log lines and our record/packet protection.
 */

import { describe, it, expect } from 'vitest';
import { TlsSession } from '../../src/net/TlsSession.js';
import { TlsCertificate } from '../../src/net/models/TlsCertificate.js';
import { Http3Connection } from '../../src/net/Http3.js';
import { dissectTcp, dissectUdp } from '../support/wiregasm.js';
import { quicPair } from '../support/quicPair.js';

const enc = new TextEncoder();

/** One HTTPS request/response over our TLS, recording the wire bytes. @param {Array<"1.2"|"1.3">} versions */
async function tlsExchange(versions) {
  /** @type {Array<{ dir: 'c2s'|'s2c', bytes: Uint8Array }>} */
  const chunks = [];
  /** @type {string[]} */
  const keylog = [];
  /** @type {Array<Uint8Array|null>} */ const a2b = []; /** @type {Array<Uint8Array|null>} */ const b2a = [];
  /** @type {any} */ let wa = null; /** @type {any} */ let wb = null;
  const push = (/** @type {any[]} */ q, /** @type {'a'|'b'} */ who, /** @type {Uint8Array} */ d) => {
    const w = who === 'a' ? wa : wb;
    if (w) { if (who === 'a') wa = null; else wb = null; w(d); } else q.push(d);
  };
  const client = new TlsSession({
    send: (d) => { chunks.push({ dir: 'c2s', bytes: d.slice() }); push(a2b, 'b', d.slice()); },
    recv: () => b2a.length ? Promise.resolve(/** @type {any} */ (b2a.shift())) : new Promise(r => { wa = r; }),
    isServer: false, timeoutMs: 5000, serverName: 'www.example.com', versions,
    keyLog: (l) => keylog.push(l),
  });
  const server = new TlsSession({
    send: (d) => { chunks.push({ dir: 's2c', bytes: d.slice() }); push(b2a, 'a', d.slice()); },
    recv: () => a2b.length ? Promise.resolve(/** @type {any} */ (a2b.shift())) : new Promise(r => { wb = r; }),
    isServer: true, timeoutMs: 5000, cert: await TlsCertificate.generate('www.example.com'), versions,
  });
  await Promise.all([client.handshake(), server.handshake()]);
  await client.send(enc.encode('GET /secret.html HTTP/1.1\r\nHost: www.example.com\r\n\r\n'));
  await server.recv();
  await server.send(enc.encode('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 11\r\n\r\nhello world'));
  await client.recv();
  return { chunks, keylog: keylog.join('\n') + '\n', version: client.version };
}

describe('Wireshark decrypts our traffic with an SSLKEYLOGFILE-style key log', () => {
  it('TLS 1.2: CLIENT_RANDOM line, HTTP visible only with the key log', async () => {
    const { chunks, keylog, version } = await tlsExchange(['1.2']);
    expect(version).toBe('TLS 1.2');
    expect(keylog).toMatch(/^CLIENT_RANDOM [0-9a-f]{64} [0-9a-f]{96}\n$/);
    const plain = (await dissectTcp(chunks)).frames.flat().join('\n');
    expect(plain).not.toContain('GET /secret.html');
    const dec = (await dissectTcp(chunks, { keylog })).frames.flat().join('\n');
    expect(dec).toContain('GET /secret.html HTTP/1.1');
    expect(dec).toContain('HTTP/1.1 200 OK');
    // TLS 1.2 sends the certificate in clear: well-formed X.509 for Wireshark
    expect(plain).toContain('utcTime: ');
    expect(plain).not.toMatch(/Malformed|BER Error/);
  }, 30_000);

  it('TLS 1.3: four traffic secrets, HTTP visible only with the key log', async () => {
    const { chunks, keylog, version } = await tlsExchange(['1.3']);
    expect(version).toBe('TLS 1.3');
    expect(keylog.trim().split('\n').map(l => l.split(' ')[0])).toEqual([
      'CLIENT_HANDSHAKE_TRAFFIC_SECRET', 'SERVER_HANDSHAKE_TRAFFIC_SECRET', 'CLIENT_TRAFFIC_SECRET_0', 'SERVER_TRAFFIC_SECRET_0',
    ]);
    const plain = (await dissectTcp(chunks)).frames.flat().join('\n');
    expect(plain).not.toContain('GET /secret.html');
    const dec = (await dissectTcp(chunks, { keylog })).frames.flat().join('\n');
    expect(dec).toContain('GET /secret.html HTTP/1.1');
    expect(dec).toContain('HTTP/1.1 200 OK');
    // the certificate becomes readable too (it is encrypted in TLS 1.3) —
    // and is well-formed X.509 for Wireshark
    expect(dec).toMatch(/Handshake Type: Certificate/);
    expect(dec).toContain('utcTime: ');
    expect(dec).toContain('dNSName: www.example.com');
    expect(dec).not.toMatch(/Malformed|BER Error|Expert Info \(Warn/);
  }, 30_000);

  it('QUIC + HTTP/3: packets decrypted with the key log', async () => {
    /** @type {Array<{ dir: 'c2s'|'s2c', bytes: Uint8Array }>} */
    const dgrams = [];
    /** @type {string[]} */
    const keylog = [];
    const { client, getServer } = await quicPair({ onDatagram: (dir, b) => dgrams.push({ dir, bytes: b.slice() }) });
    // pass the key log into the client's TLS (quicPair builds the connection)
    client.tls._keyLog = (/** @type {string} */ l) => keylog.push(l);
    await client.ready;
    await getServer().ready;
    const server = new Http3Connection({ quic: getServer(), onRequest: async (req, res) => {
      await res.respond(200, [['content-type', 'text/plain']], enc.encode(`secret for ${req.path}`));
    } });
    server.start();
    const h3 = new Http3Connection({ quic: client });
    h3.start();
    await h3.request({ scheme: 'https', authority: 'quic.lan', path: '/geheim' });
    await new Promise(r => setTimeout(r, 30));
    expect(keylog.length).toBeGreaterThanOrEqual(2);

    const plain = (await dissectUdp(dgrams)).frames.flat().join('\n');
    const dec = (await dissectUdp(dgrams, { keylog: keylog.join('\n') + '\n' })).frames.flat().join('\n');
    expect(plain).toContain('Secrets are not available');
    // decrypted 1-RTT packets show their frames (STREAM, …)
    expect(dec).toMatch(/STREAM/);
    // HTTP/3 itself is decoded once QUIC is decrypted
    expect(dec).toContain('Hypertext Transfer Protocol Version 3');
  }, 30_000);
});
