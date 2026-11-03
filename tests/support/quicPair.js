//@ts-check

/** Client/server QUIC connection pair over an in-memory datagram link (real-time timers). */

import { QuicConnection, QuicServer } from '../../src/net/Quic.js';
import { TlsCertificate } from '../../src/net/models/TlsCertificate.js';

export const testTimer = {
  schedule: (/** @type {() => void} */ fn, /** @type {number} */ ms) => /** @type {any} */ (setTimeout(fn, ms)),
  cancel: (/** @type {any} */ id) => clearTimeout(id),
};
export const fastQuic = { timer: testTimer, clock: () => Date.now(), initialRttMs: 10, handshakeTimeoutMs: 5000 };

/**
 * @param {{ drop?: (n: number, dir: 'c2s'|'s2c') => boolean, alpnServer?: string[], alpnClient?: string[],
 *           trustStore?: any, cert?: any, idleTimeoutMs?: number, onDatagram?: (dir: 'c2s'|'s2c', b: Uint8Array) => void }} [o]
 */
export async function quicPair(o = {}) {
  const cert = o.cert ?? await TlsCertificate.generate('quic.lan');
  /** @type {QuicConnection|null} */
  let serverConn = null;
  let n = 0;
  /** @type {{ c2s: number[], s2c: number[] }} */
  const sizes = { c2s: [], s2c: [] };
  /** @type {QuicConnection} */
  let client;
  const server = new QuicServer({
    alpn: o.alpnServer ?? ['h3'],
    cert,
    connOptions: { ...fastQuic, idleTimeoutMs: o.idleTimeoutMs },
    send: (bytes) => {
      sizes.s2c.push(bytes.length);
      o.onDatagram?.('s2c', bytes);
      if (o.drop?.(n++, 's2c')) return;
      setTimeout(() => client.handleDatagram(bytes.slice()), 0);
    },
    onConnection: (c) => { serverConn = c; },
  });
  client = new QuicConnection({
    ...fastQuic,
    isServer: false,
    alpn: o.alpnClient ?? ['h3'],
    serverName: 'quic.lan',
    trustStore: o.trustStore,
    idleTimeoutMs: o.idleTimeoutMs,
    sendDatagram: (bytes) => {
      sizes.c2s.push(bytes.length);
      o.onDatagram?.('c2s', bytes);
      if (o.drop?.(n++, 'c2s')) return;
      setTimeout(() => server.handleDatagram(bytes.slice(), 'client'), 0);
    },
  });
  client.start();
  return { client, server, sizes, getServer: () => /** @type {QuicConnection} */ (serverConn) };
}
