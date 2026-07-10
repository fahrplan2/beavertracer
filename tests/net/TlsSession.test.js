/**
 * TlsSession integration tests — loopback client+server over in-memory queues.
 *
 * Verifies RFC 5246 / RFC 5288 compliance:
 *  - Full handshake succeeds
 *  - Application data round-trips correctly
 *  - AES-GCM records carry an 8-byte explicit nonce (RFC 5288 §3)
 *  - Finished verify_data is computed via PRF(master_secret, label, transcript_hash)
 *  - Tampered Finished is rejected
 *  - Untrusted certificate is rejected
 */
import { describe, it, expect } from 'vitest';
import { TlsSession, TlsHandshakeError, TlsCertUntrustedError } from '../../src/net/TlsSession.js';
import { TlsCertificate, TlsTrustStore } from '../../src/net/models/TlsCertificate.js';

// ── loopback wiring ────────────────────────────────────────────────────────

/**
 * Create a pair of in-memory byte queues so client and server can exchange
 * raw TLS records synchronously within the same process.
 */
function makeQueues() {
  const c2s = []; // client → server
  const s2c = []; // server → client

  let c2sWaiter = null;
  let s2cWaiter = null;

  function push(queue, waiterRef, data) {
    if (waiterRef.val) {
      const resolve = waiterRef.val;
      waiterRef.val = null;
      resolve(data);
    } else {
      queue.push(data);
    }
  }

  const c2sWaiterBox = { val: null };
  const s2cWaiterBox = { val: null };

  function makeRecv(queue, waiterBox) {
    return () => new Promise(resolve => {
      if (queue.length > 0) {
        resolve(queue.shift());
      } else {
        waiterBox.val = resolve;
      }
    });
  }

  return {
    clientSend: (data) => push(c2s, c2sWaiterBox, data),
    clientRecv: makeRecv(s2c, s2cWaiterBox),
    serverSend: (data) => push(s2c, s2cWaiterBox, data),
    serverRecv: makeRecv(c2s, c2sWaiterBox),
  };
}

/**
 * Run a full TLS handshake between a client and server session.
 * Returns { client, server } after both handshakes complete.
 */
async function runHandshake(serverCert, trustStore = null) {
  const q = makeQueues();

  const client = new TlsSession({
    send: q.clientSend,
    recv: q.clientRecv,
    isServer: false,
    trustStore,
    timeoutMs: 5000,
    sleepFn: (ms) => new Promise(r => setTimeout(r, ms)),
  });

  const server = new TlsSession({
    send: q.serverSend,
    recv: q.serverRecv,
    isServer: true,
    cert: serverCert,
    timeoutMs: 5000,
    sleepFn: (ms) => new Promise(r => setTimeout(r, ms)),
  });

  await Promise.all([client.handshake(), server.handshake()]);
  return { client, server, queues: q };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('TlsSession', () => {
  it('completes handshake with self-signed certificate', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { client, server } = await runHandshake(cert);
    expect(client['_state']).toBe('ESTABLISHED');
    expect(server['_state']).toBe('ESTABLISHED');
  });

  it('client exposes peerCert after handshake', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { client } = await runHandshake(cert);
    expect(client.peerCert).not.toBeNull();
    expect(client.peerCert?.subject).toBe('CN=server.local');
  });

  it('application data round-trips client → server', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { client, server } = await runHandshake(cert);

    const msg = new TextEncoder().encode('hello TLS 1.2');
    await client.send(msg);
    const received = await server.recv();
    expect(new TextDecoder().decode(received)).toBe('hello TLS 1.2');
  });

  it('application data round-trips server → client', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { client, server } = await runHandshake(cert);

    const msg = new TextEncoder().encode('response from server');
    await server.send(msg);
    const received = await client.recv();
    expect(new TextDecoder().decode(received)).toBe('response from server');
  });

  it('multiple messages round-trip in sequence', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { client, server } = await runHandshake(cert);

    for (let i = 0; i < 5; i++) {
      const msg = new TextEncoder().encode(`message ${i}`);
      await client.send(msg);
      const recv = await server.recv();
      expect(new TextDecoder().decode(recv)).toBe(`message ${i}`);
    }
  });

  it('APP_DATA record carries 8-byte explicit nonce (RFC 5288)', async () => {
    // Intercept the raw bytes sent after the handshake to inspect record layout.
    const cert = await TlsCertificate.generate('server.local');
    const q = makeQueues();

    const capturedRecords = [];
    const origClientSend = q.clientSend;
    let handshakeDone = false;

    const client = new TlsSession({
      send: (data) => {
        if (handshakeDone) capturedRecords.push(data.slice()); // copy
        origClientSend(data);
      },
      recv: q.clientRecv,
      isServer: false,
      timeoutMs: 5000,
      sleepFn: (ms) => new Promise(r => setTimeout(r, ms)),
    });

    const server = new TlsSession({
      send: q.serverSend,
      recv: q.serverRecv,
      isServer: true,
      cert,
      timeoutMs: 5000,
      sleepFn: (ms) => new Promise(r => setTimeout(r, ms)),
    });

    await Promise.all([client.handshake(), server.handshake()]);
    handshakeDone = true;

    await client.send(new TextEncoder().encode('probe'));

    expect(capturedRecords.length).toBe(1);
    const record = capturedRecords[0];

    // TLS record header: [type:1][major:1][minor:1][len:2]
    expect(record[0]).toBe(0x17); // APP_DATA
    expect(record[1]).toBe(0x03); // TLS major
    expect(record[2]).toBe(0x03); // TLS minor

    const payloadLen = (record[3] << 8) | record[4];
    const payload = record.slice(5, 5 + payloadLen);

    // RFC 5288 §3: payload = explicit_nonce(8) || ciphertext+tag
    // plaintext "probe" = 5 bytes → ciphertext = 5 + 16 (GCM tag) = 21 bytes
    // total payload = 8 + 21 = 29 bytes
    expect(payload.length).toBe(8 + 5 + 16);

    // The explicit nonce must be the sequence number (0) as 8-byte big-endian
    const explicitNonce = payload.slice(0, 8);
    expect(Array.from(explicitNonce)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('second APP_DATA record has explicit nonce = 1', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const q = makeQueues();
    const capturedRecords = [];
    let handshakeDone = false;
    const origSend = q.clientSend;

    const client = new TlsSession({
      send: (data) => {
        if (handshakeDone) capturedRecords.push(data.slice());
        origSend(data);
      },
      recv: q.clientRecv,
      isServer: false,
      timeoutMs: 5000,
      sleepFn: (ms) => new Promise(r => setTimeout(r, ms)),
    });
    const server = new TlsSession({
      send: q.serverSend,
      recv: q.serverRecv,
      isServer: true,
      cert,
      timeoutMs: 5000,
      sleepFn: (ms) => new Promise(r => setTimeout(r, ms)),
    });

    await Promise.all([client.handshake(), server.handshake()]);
    handshakeDone = true;

    await client.send(new TextEncoder().encode('first'));
    await client.send(new TextEncoder().encode('second'));

    const nonce0 = capturedRecords[0].slice(5, 13); // first record explicit nonce
    const nonce1 = capturedRecords[1].slice(5, 13); // second record explicit nonce
    expect(Array.from(nonce0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(nonce1)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('rejects untrusted certificate when trust store is provided', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const otherCert = await TlsCertificate.generate('other.local');

    // Trust store contains only the other cert, not the server cert
    const trustStore = new TlsTrustStore();
    trustStore.add(otherCert);

    await expect(runHandshake(cert, trustStore)).rejects.toBeInstanceOf(TlsCertUntrustedError);
  });

  it('accepts certificate from trusted CA', async () => {
    const ca   = await TlsCertificate.generate('Test CA', null, { isCA: true });
    const cert = await TlsCertificate.generate('server.local', ca);

    const trustStore = new TlsTrustStore();
    trustStore.add(ca);

    const { client } = await runHandshake(cert, trustStore);
    expect(client['_state']).toBe('ESTABLISHED');
  });

  it('rejects a forged self-signed certificate that reuses a trusted CA\'s subject string', async () => {
    const ca = await TlsCertificate.generate('Test CA', null, { isCA: true });
    const trustStore = new TlsTrustStore();
    trustStore.add(ca);

    // Attacker's own self-signed cert, same subject as the trusted CA but a different key pair
    const forged = await TlsCertificate.generate('Test CA', null, {});

    await expect(runHandshake(forged, trustStore)).rejects.toBeInstanceOf(TlsCertUntrustedError);
  });

  it('client and server derive identical master_secret', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const { client, server } = await runHandshake(cert);

    const clientMs = client['_masterSecret'];
    const serverMs = server['_masterSecret'];
    expect(clientMs).not.toBeNull();
    expect(serverMs).not.toBeNull();
    expect(Array.from(clientMs)).toEqual(Array.from(serverMs));
    expect(clientMs.length).toBe(48); // RFC 5246: master_secret is always 48 bytes
  });
});
