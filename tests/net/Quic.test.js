//@ts-check

import { describe, it, expect } from 'vitest';
import {
  QuicServer, QuicError, QuicReader, encodeVarint, decodePacketNumber,
  initialSecrets, packetKeysFromSecret, hpMask, QUIC_MAX_DATAGRAM,
} from '../../src/net/Quic.js';
import { hkdfExpandLabel } from '../../src/net/TlsSession.js';
import { TlsCertificate, TlsTrustStore } from '../../src/net/models/TlsCertificate.js';
import { quicPair, fastQuic } from '../support/quicPair.js';

const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('hex');
const unhex = (/** @type {string} */ s) => Uint8Array.from(Buffer.from(s, 'hex'));
const enc = new TextEncoder();
const dec = new TextDecoder();


// ── RFC test vectors ─────────────────────────────────────────────────────────

describe('QUIC primitives', () => {
  it('varints (RFC 9000 §A.1)', () => {
    for (const [h, v] of /** @type {Array<[string, number]>} */ ([['25', 37], ['7bbd', 15293], ['9d7f3e7d', 494878333], ['c2197c5eff14e88c', 151288809941952652]])) {
      expect(new QuicReader(unhex(h)).varint()).toBe(v);
      if (v < 2 ** 53 && h.length <= 8) expect(hex(encodeVarint(v))).toBe(h);
    }
    expect(new QuicReader(encodeVarint(2 ** 40 + 5)).varint()).toBe(2 ** 40 + 5);
  });

  it('packet number decoding (RFC 9000 §A.3)', () => {
    expect(decodePacketNumber(0xa82f30ea, 0x9b32, 16)).toBe(0xa82f9b32);
    expect(decodePacketNumber(-1, 0, 32)).toBe(0);
    expect(decodePacketNumber(255, 1, 8)).toBe(257);
  });

  it('Initial secrets and keys (RFC 9001 §A.1)', async () => {
    const s = await initialSecrets(unhex('8394c8f03e515708'));
    expect(hex(s.client)).toBe('c00cf151ca5be075ed0ebfb5c80323c42d6b7db67881289af4008f1f6c357aea');
    expect(hex(s.server)).toBe('3c199828fd139efd216c155ad844cc81fb82fa8d7446fa7d78be803acdda951b');
    const e = new Uint8Array(0);
    expect(hex(await hkdfExpandLabel(s.client, 'quic key', e, 16))).toBe('1f369613dd76d5467730efcbe3b1a22d');
    expect(hex(await hkdfExpandLabel(s.client, 'quic iv', e, 12))).toBe('fa044b2f42a3fd3b46fb255c');
    expect(hex(await hkdfExpandLabel(s.client, 'quic hp', e, 16))).toBe('9f50449e04a0e810283a1e9933adedd2');
    expect(hex(await hkdfExpandLabel(s.server, 'quic key', e, 16))).toBe('cf3a5331653c364c88f0f379b6067e37');
    expect(hex(await hkdfExpandLabel(s.server, 'quic iv', e, 12))).toBe('0ac1493ca1905853b0bba03e');
    expect(hex(await hkdfExpandLabel(s.server, 'quic hp', e, 16))).toBe('c206b8d9b9f0f37644430b490eeaa314');
  });

  it('header protection mask via AES-CBC equals AES-ECB (RFC 9001 §A.2)', async () => {
    const s = await initialSecrets(unhex('8394c8f03e515708'));
    const k = await packetKeysFromSecret(s.client);
    expect(hex(await hpMask(k.hp, unhex('d1b1c98dd7689fb8ec11d242b123dc9b')))).toBe('437b9aec36');
  });
});

// ── client ↔ server over an in-memory datagram link ──────────────────────────

const setup = quicPair;

/** Server side: echo every bidirectional stream, upper-cased. @param {QuicConnection} c */
function echo(c) {
  c.onStream = (s) => {
    s.readAll().then((data) => s.write(enc.encode(dec.decode(data).toUpperCase()), true)).catch(() => {});
  };
}

describe('QUIC connection', () => {
  it('completes the handshake, negotiates ALPN, pads client Initials to 1200 bytes', async () => {
    const { client, sizes, getServer } = await setup();
    await client.ready;
    expect(client.alpn).toBe('h3');
    expect(getServer().alpn).toBe('h3');
    expect(sizes.c2s[0]).toBe(QUIC_MAX_DATAGRAM);
    expect(Math.max(...sizes.c2s, ...sizes.s2c)).toBeLessThanOrEqual(QUIC_MAX_DATAGRAM);
    expect(client.tls.peerCert?.subject).toBe('CN=quic.lan');
    await new Promise(r => setTimeout(r, 30));
    expect(client.handshakeConfirmed).toBe(true); // HANDSHAKE_DONE arrived
  });

  it('carries request/response on a bidirectional stream', async () => {
    const { client, getServer } = await setup();
    await client.ready;
    echo(getServer());
    const s = client.openStream();
    expect(s.id).toBe(0);
    s.write(enc.encode('hello quic'), true);
    expect(dec.decode(await s.readAll())).toBe('HELLO QUIC');
  });

  it('multiplexes streams and moves large bodies across many packets', async () => {
    const { client, getServer } = await setup();
    await client.ready;
    echo(getServer());
    const big = 'x'.repeat(300_000);
    const streams = [0, 1, 2].map(() => client.openStream());
    expect(streams.map(s => s.id)).toEqual([0, 4, 8]);
    streams[0].write(enc.encode(big), true);
    streams[1].write(enc.encode('b'), true);
    streams[2].write(enc.encode('c'), true);
    const [a, b, c] = await Promise.all(streams.map(s => s.readAll()));
    expect(a.length).toBe(300_000);
    expect(dec.decode(b) + dec.decode(c)).toBe('BC');
  });

  it('server-initiated unidirectional stream', async () => {
    const { client, getServer } = await setup();
    await client.ready;
    /** @type {Promise<string>} */
    const got = new Promise((resolve) => { client.onStream = (s) => s.readAll().then(d => resolve(dec.decode(d))); });
    await getServer().ready; // the server finishes one flight later (client Finished)
    const u = getServer().openStream({ bidi: false });
    expect(u.id).toBe(3);
    u.write(enc.encode('settings'), true);
    expect(await got).toBe('settings');
  });

  it('survives packet loss (retransmission after PTO / packet threshold)', async () => {
    const { client, getServer } = await setup({ drop: (n) => n % 3 === 1 });
    await client.ready;
    echo(getServer());
    const s = client.openStream();
    s.write(enc.encode('y'.repeat(50_000)), true);
    const out = await s.readAll();
    expect(out.length).toBe(50_000);
  }, 20_000);

  it('handshake still completes when the first server flight is lost', async () => {
    const { client } = await setup({ drop: (n, dir) => dir === 's2c' && n < 3 });
    await client.ready;
    expect(client.state).toBe('connected');
  }, 20_000);

  it('untrusted certificate -> CONNECTION_CLOSE with crypto error 0x100+42', async () => {
    const { client, getServer } = await setup({ trustStore: new TlsTrustStore() });
    await expect(client.ready).rejects.toBeInstanceOf(Error);
    await getServer().done;
    const err = /** @type {QuicError} */ (getServer().closeError);
    expect(err.remote).toBe(true);
    expect(err.code).toBe(0x100 + 42);
  });

  it('no common ALPN -> crypto error 0x100+120 (no_application_protocol)', async () => {
    const { client } = await setup({ alpnServer: ['h3'], alpnClient: ['hq-interop'] });
    await expect(client.ready).rejects.toBeInstanceOf(Error);
    await client.done;
    expect(/** @type {QuicError} */ (client.closeError).code).toBe(0x100 + 120);
  });

  it('application close reaches the peer', async () => {
    const { client, getServer } = await setup();
    await client.ready;
    client.close(0, 'bye');
    await getServer().done;
    expect(getServer().closeError).toBeNull();
    expect(client.state).toBe('closed');
  });

  it('idle timeout closes both sides silently', async () => {
    const { client, getServer } = await setup({ idleTimeoutMs: 80 });
    await client.ready;
    await Promise.all([client.done, getServer().done]);
    expect(/** @type {Error} */ (client.closeError).message).toMatch(/idle/);
  });

  it('server ignores datagrams that are too small for a first Initial', async () => {
    /** @type {any[]} */
    const created = [];
    const server = new QuicServer({ alpn: ['h3'], cert: await TlsCertificate.generate('x'), send: () => {}, onConnection: (c) => created.push(c) });
    const bogus = new Uint8Array(100); bogus[0] = 0xc3; bogus[4] = 1; bogus[5] = 8;
    server.handleDatagram(bogus, 'peer');
    expect(created.length).toBe(0);
  });
});
