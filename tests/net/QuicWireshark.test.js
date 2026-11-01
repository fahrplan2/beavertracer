//@ts-check

/**
 * Wireshark as an independent check of the QUIC wire format: it derives the
 * Initial keys from the connection ID on its own, so it can only show the
 * ClientHello / ServerHello if packet and header protection are right.
 */

import { describe, it, expect } from 'vitest';
import { QuicConnection, QuicServer } from '../../src/net/Quic.js';
import { TlsCertificate } from '../../src/net/models/TlsCertificate.js';
import { dissectUdp } from '../support/wiregasm.js';

describe('QUIC packets as seen by Wireshark', () => {
  it('decrypts our Initial packets and finds the TLS handshake inside', async () => {
    /** @type {Array<{ dir: 'c2s'|'s2c', bytes: Uint8Array }>} */
    const dgrams = [];
    const timer = { schedule: (/** @type {() => void} */ f, /** @type {number} */ ms) => /** @type {any} */ (setTimeout(f, ms)), cancel: (/** @type {any} */ id) => clearTimeout(id) };
    /** @type {QuicConnection} */
    let client;
    const server = new QuicServer({
      alpn: ['h3'], cert: await TlsCertificate.generate('quic.lan'),
      connOptions: { timer, clock: Date.now },
      send: (b) => { dgrams.push({ dir: 's2c', bytes: b.slice() }); setTimeout(() => client.handleDatagram(b.slice()), 0); },
      onConnection: () => {},
    });
    client = new QuicConnection({
      isServer: false, alpn: ['h3'], serverName: 'quic.lan', timer, clock: Date.now,
      sendDatagram: (b) => { dgrams.push({ dir: 'c2s', bytes: b.slice() }); setTimeout(() => server.handleDatagram(b.slice(), 'peer'), 0); },
    });
    client.start();
    await client.ready;
    await new Promise(r => setTimeout(r, 30));

    const { frames, summary } = await dissectUdp(dgrams);
    const all = frames.flat().join('\n');
    expect(all).not.toMatch(/Malformed|Decryption failed|Expert Info \(Error/);

    // client Initial: decrypted, ClientHello with SNI, ALPN, TLS 1.3, transport parameters
    const first = frames[0].join('\n');
    expect(first).toMatch(/Protocols in frame: raw:ip:udp:quic:tls/);
    expect(first).toContain('Handshake Type: Client Hello (1)');
    expect(first).toContain('Server Name: quic.lan');
    expect(first).toContain('ALPN Next Protocol: h3');
    expect(first).toContain('Supported Version: TLS 1.3 (0x0304)');
    expect(first).toContain('quic_transport_parameters');
    expect(summary[0]).toMatch(/Initial, DCID=.*PKN: 0, CRYPTO, PADDING/);

    // server Initial carries the ServerHello; later packets are Handshake / 1-RTT
    expect(all).toContain('Handshake Type: Server Hello (2)');
    expect(summary.some(s => /Handshake, DCID=/.test(s))).toBe(true);
    expect(summary.some(s => /Protected Payload/.test(s))).toBe(true);
  }, 30_000);
});
