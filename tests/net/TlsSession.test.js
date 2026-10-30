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
import { TlsSession, TlsHandshakeError, TlsCertUntrustedError, TlsCertExpiredError, TlsCertNameMismatchError, certMatchesName } from '../../src/net/TlsSession.js';
import { TlsCertificate, TlsTrustStore } from '../../src/net/models/TlsCertificate.js';
import { TlsRecord } from '../../src/net/pdu/TlsRecord.js';

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
 * @param {TlsCertificate} serverCert
 * @param {TlsTrustStore|null} [trustStore]
 * @param {{ clientNow?: () => number, serverName?: string }} [opts] - inject the client's "virtual clock" / requested host
 */
async function runHandshake(serverCert, trustStore = null, opts = {}) {
  const q = makeQueues();

  const client = new TlsSession({
    send: q.clientSend,
    recv: q.clientRecv,
    isServer: false,
    trustStore,
    timeoutMs: 5000,
    sleepFn: (ms) => new Promise(r => setTimeout(r, ms)),
    now: opts.clientNow,
    serverName: opts.serverName,
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

    // The explicit nonce is the sequence number as 8-byte big-endian.
    // Seq 0 under the new keys was the Finished message, so ApplicationData starts at 1.
    const explicitNonce = payload.slice(0, 8);
    expect(Array.from(explicitNonce)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('second APP_DATA record has explicit nonce = 2', async () => {
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
    expect(Array.from(nonce0)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(nonce1)).toEqual([0, 0, 0, 0, 0, 0, 0, 2]);
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

  describe('hostname verification', () => {
    it('accepts a trusted certificate issued for the requested name', async () => {
      const ca   = await TlsCertificate.generate('Test CA', null, { isCA: true });
      const cert = await TlsCertificate.generate('www.bank.de', ca);
      const trustStore = new TlsTrustStore();
      trustStore.add(ca);
      const { client } = await runHandshake(cert, trustStore, { serverName: 'WWW.Bank.de' });
      expect(client['_state']).toBe('ESTABLISHED');
    });

    it('rejects a trusted certificate issued for a different name', async () => {
      const ca   = await TlsCertificate.generate('Test CA', null, { isCA: true });
      const cert = await TlsCertificate.generate('angreifer.example', ca);
      const trustStore = new TlsTrustStore();
      trustStore.add(ca);
      const err = await runHandshake(cert, trustStore, { serverName: 'www.bank.de' }).catch(e => e);
      expect(err).toBeInstanceOf(TlsCertNameMismatchError);
      expect(err).toBeInstanceOf(TlsCertUntrustedError);
    });

    it('skips the name check without a trust store (curl -k)', async () => {
      const cert = await TlsCertificate.generate('angreifer.example');
      const { client } = await runHandshake(cert, null, { serverName: 'www.bank.de' });
      expect(client['_state']).toBe('ESTABLISHED');
    });

    it('certMatchesName handles exact names, IPs and one-label wildcards', () => {
      expect(certMatchesName('CN=www.bank.de', 'www.bank.de')).toBe(true);
      expect(certMatchesName('CN=192.0.2.80', '192.0.2.80')).toBe(true);
      expect(certMatchesName('CN=*.bank.de', 'www.bank.de')).toBe(true);
      expect(certMatchesName('CN=*.bank.de', 'a.b.bank.de')).toBe(false);
      expect(certMatchesName('CN=*.bank.de', 'bank.de')).toBe(false);
      expect(certMatchesName('CN=bank.de', 'www.bank.de')).toBe(false);
    });
  });

  // ── certificate validity period (notBefore/notAfter) ────────────────────

  describe('certificate validity period', () => {
    it('rejects a certificate that has expired according to the client clock', async () => {
      const cert = await TlsCertificate.generate('server.local', null, { validityDays: 30 });
      const trustStore = new TlsTrustStore();
      trustStore.add(cert);

      // Client's virtual clock reads a moment 100 days past notAfter.
      const clientNow = () => cert.notAfter + 100 * 24 * 3600 * 1000;

      const err = await runHandshake(cert, trustStore, { clientNow }).catch(e => e);
      expect(err).toBeInstanceOf(TlsCertExpiredError);
      expect(/** @type {InstanceType<typeof TlsCertExpiredError>} */ (err).reason).toBe('expired');
    });

    it('rejects a certificate that is not yet valid according to the client clock', async () => {
      const cert = await TlsCertificate.generate('server.local', null, { validityDays: 30 });
      const trustStore = new TlsTrustStore();
      trustStore.add(cert);

      // Client's virtual clock reads a moment before notBefore.
      const clientNow = () => cert.notBefore - 24 * 3600 * 1000;

      const err = await runHandshake(cert, trustStore, { clientNow }).catch(e => e);
      expect(err).toBeInstanceOf(TlsCertExpiredError);
      expect(/** @type {InstanceType<typeof TlsCertExpiredError>} */ (err).reason).toBe('notYetValid');
    });

    it('accepts a real-time-expired certificate when the virtual clock is set to a valid moment', async () => {
      // Cert whose validity window is entirely in the (real) past.
      const skewedPast = Date.now() - 400 * 24 * 3600 * 1000;
      const cert = await TlsCertificate.generate('server.local', null, { validityDays: 30, nowMs: skewedPast });
      const trustStore = new TlsTrustStore();
      trustStore.add(cert);

      // The simulated host's virtual clock is set back to when the cert was still valid.
      const clientNow = () => cert.notBefore + 24 * 3600 * 1000;

      const { client } = await runHandshake(cert, trustStore, { clientNow });
      expect(client['_state']).toBe('ESTABLISHED');
    });

    it('rejects a real-time-valid certificate when the virtual clock is skewed past notAfter', async () => {
      const cert = await TlsCertificate.generate('server.local', null, { validityDays: 30 });
      const trustStore = new TlsTrustStore();
      trustStore.add(cert);

      // Real time is well within validity, but this host's virtual clock was fast-forwarded.
      const clientNow = () => cert.notAfter + 1000;

      const err = await runHandshake(cert, trustStore, { clientNow }).catch(e => e);
      expect(err).toBeInstanceOf(TlsCertExpiredError);
    });

    it('defaults to the real clock when no now() is injected', async () => {
      const cert = await TlsCertificate.generate('server.local', null, { validityDays: 30 });
      const trustStore = new TlsTrustStore();
      trustStore.add(cert);

      const { client } = await runHandshake(cert, trustStore);
      expect(client['_state']).toBe('ESTABLISHED');
    });
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
  // ── Finished / Alerts under the negotiated cipher (RFC 5246 §7.1, §7.4.9) ──

  describe('records after ChangeCipherSpec are encrypted', () => {
    /**
     * Loopback handshake that records every byte written by each side and
     * optionally lets a test rewrite outgoing chunks.
     * @param {{ tamperC2S?: (d: Uint8Array) => Uint8Array, tamperS2C?: (d: Uint8Array) => Uint8Array, timeoutMs?: number }} [opts]
     */
    async function runCaptured(opts = {}) {
      const cert = await TlsCertificate.generate('server.local');
      const q = makeQueues();
      const wire = { c2s: [], s2c: [] };
      const mk = (isServer) => new TlsSession({
        send: (d) => {
          const out = (isServer ? opts.tamperS2C : opts.tamperC2S)?.(d.slice()) ?? d;
          (isServer ? wire.s2c : wire.c2s).push(out.slice());
          (isServer ? q.serverSend : q.clientSend)(out);
        },
        recv: isServer ? q.serverRecv : q.clientRecv,
        isServer,
        cert: isServer ? cert : undefined,
        timeoutMs: opts.timeoutMs ?? 5000,
        sleepFn: (ms) => new Promise(r => setTimeout(r, ms)),
      });
      const client = mk(false);
      const server = mk(true);
      return { client, server, wire };
    }

    /** @param {Uint8Array[]} chunks */
    function records(chunks) {
      const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let off = 0;
      for (const c of chunks) { all.set(c, off); off += c.length; }
      return TlsRecord.parseRecords(all).records;
    }

    /** @param {TlsRecord[]} recs */
    function recordAfterCcs(recs) {
      const i = recs.findIndex(r => r.contentType === 0x14);
      expect(i).toBeGreaterThanOrEqual(0);
      return recs[i + 1];
    }

    it('client and server Finished are AES-GCM records with seq 0, not readable plaintext', async () => {
      const { client, server, wire } = await runCaptured();
      await Promise.all([client.handshake(), server.handshake()]);
      expect(client['_state']).toBe('ESTABLISHED');
      expect(server['_state']).toBe('ESTABLISHED');

      for (const dir of ['c2s', 's2c']) {
        const fin = recordAfterCcs(records(wire[dir]));
        expect(fin.contentType).toBe(22);                 // Handshake content type
        // explicit_nonce(8) || ciphertext(4 + 12) || tag(16)
        expect(fin.payload.length).toBe(8 + 16 + 16);
        expect(Array.from(fin.payload.slice(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        // not a plaintext Finished header (type 20, length 12)
        expect(Array.from(fin.payload.slice(0, 4))).not.toEqual([20, 0, 0, 12]);
        expect(Array.from(fin.payload.slice(8, 12))).not.toEqual([20, 0, 0, 12]);
      }
    });

    it('encrypted client Finished decrypts with seq 0 / AAD(type 22, len 16) to the plaintext message', async () => {
      const { client, server, wire } = await runCaptured();
      await Promise.all([client.handshake(), server.handshake()]);

      const fin = recordAfterCcs(records(wire.c2s));
      const nonce = new Uint8Array(12);
      nonce.set(server['_decryptFixedIV'], 0);
      nonce.set(fin.payload.slice(0, 8), 4);
      const aad = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 22, 3, 3, 0, 16]);
      const plain = new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad },
        server['_decryptKey'], fin.payload.slice(8),
      ));
      expect(Array.from(plain.slice(0, 4))).toEqual([20, 0, 0, 12]);
      expect(plain.length).toBe(16);
    });

    it('application data round-trips in both directions after encrypted Finished', async () => {
      const { client, server } = await runCaptured();
      await Promise.all([client.handshake(), server.handshake()]);
      await client.send(new TextEncoder().encode('ping'));
      expect(new TextDecoder().decode(await server.recv())).toBe('ping');
      await server.send(new TextEncoder().encode('pong'));
      expect(new TextDecoder().decode(await client.recv())).toBe('pong');
      expect(client['_sendSeq']).toBe(2);
      expect(server['_recvSeq']).toBe(2);
    });

    it('rejects a tampered (encrypted) client Finished', async () => {
      let seenCcs = false;
      const { client, server } = await runCaptured({
        timeoutMs: 300,
        tamperC2S: (d) => {
          if (seenCcs && d[0] === 22) { d[d.length - 1] ^= 0xff; seenCcs = false; }
          if (d[0] === 0x14) seenCcs = true;
          return d;
        },
      });
      const [c, s] = await Promise.allSettled([client.handshake(), server.handshake()]);
      expect(s.status).toBe('rejected');
      expect(/** @type {PromiseRejectedResult} */ (s).reason).toBeInstanceOf(TlsHandshakeError);
      expect(c.status).toBe('rejected');
    });

    it('client sends an encrypted fatal alert when the server Finished is bad', async () => {
      let seenCcs = false;
      const { client, server, wire } = await runCaptured({
        tamperS2C: (d) => {
          if (seenCcs && d[0] === 22) { d[d.length - 1] ^= 0xff; seenCcs = false; }
          if (d[0] === 0x14) seenCcs = true;
          return d;
        },
      });
      const [c] = await Promise.allSettled([client.handshake(), server.handshake()]);
      expect(c.status).toBe('rejected');
      const recs = records(wire.c2s);
      const alert = recs[recs.length - 1];
      expect(alert.contentType).toBe(21);
      expect(alert.payload.length).toBe(8 + 2 + 16);                       // protected, not [2, 42]
      expect(Array.from(alert.payload.slice(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    });

    it('close_notify after the handshake is encrypted with the next sequence number', async () => {
      const { client, server, wire } = await runCaptured();
      await Promise.all([client.handshake(), server.handshake()]);
      await client.send(new TextEncoder().encode('bye'));
      expect(new TextDecoder().decode(await server.recv())).toBe('bye');

      const before = records(wire.c2s).length;
      client.close();                                   // synchronous, as callers use it
      const recs = records(wire.c2s);
      expect(recs.length).toBe(before + 1);
      const alert = recs[recs.length - 1];
      expect(alert.contentType).toBe(21);
      expect(alert.payload.length).toBe(8 + 2 + 16);
      expect(Array.from(alert.payload.slice(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 2]);
      expect(await server.recv()).toBeNull();           // decrypts and treats as close
    });

    it('close_notify right after the handshake uses seq 1', async () => {
      const { client, server, wire } = await runCaptured();
      await Promise.all([client.handshake(), server.handshake()]);
      server.close();
      const recs = records(wire.s2c);
      const alert = recs[recs.length - 1];
      expect(alert.contentType).toBe(21);
      expect(Array.from(alert.payload.slice(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
      expect(await client.recv()).toBeNull();
    });
  });
});
