//@ts-check

/**
 * QUIC over the simulated network: UDP sockets of a host's IP stack
 * (`os.net`) on one side, QuicConnection / QuicServer and HTTP/3 on the
 * other. Shared by the HTTP server, Sparktail and curl.
 */

import { IPAddress } from "./models/IPAddress.js";
import { QuicConnection, QuicServer } from "./Quic.js";
import { Http3Connection } from "./Http3.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";

/** How long a client waits for the QUIC handshake before giving up (then: TCP fallback). */
export const QUIC_CONNECT_TIMEOUT_MS = 3_000;

/**
 * Open an ephemeral UDP port (49152–65535).
 * @param {any} net `os.net`
 * @returns {number}
 */
function openEphemeralUdp(net) {
  for (let i = 0; i < 64; i++) {
    const p = 49152 + Math.floor(Math.random() * 16384);
    try { return net.openUDPSocket(new IPAddress(4, 0), p); } catch { /* in use: next */ }
  }
  throw new Error("no free UDP port");
}

/**
 * Connect with QUIC + HTTP/3. Resolves once the handshake is done.
 * Rejects (and cleans up) on handshake failure or timeout — the caller may
 * then fall back to TCP, as browsers do when UDP is blocked.
 * @param {any} os
 * @param {{ ip: IPAddress, port: number, host: string, insecure?: boolean, timeoutMs?: number,
 *           onPacket?: (dir: "in"|"out", level: string, pn: number, frames: string[]) => void }} o
 * @returns {Promise<{ quic: QuicConnection, h3: Http3Connection, close: () => void, localPort: number }>}
 */
export async function connectHttp3(os, o) {
  const net = os.net;
  const localPort = openEphemeralUdp(net);
  let open = true;
  const closeSocket = () => {
    if (!open) return;
    open = false;
    try { net.closeUDPSocket(localPort); } catch { /* already closed */ }
  };
  const quic = new QuicConnection({
    isServer: false,
    alpn: ["h3"],
    serverName: o.host,
    trustStore: o.insecure ? undefined : (os.tls?.certStore ?? undefined),
    now: () => os.clock?.nowMs?.() ?? Date.now(),
    onPacket: o.onPacket,
    sendDatagram: (b) => { if (open) net.sendUDPSocket(localPort, o.ip, o.port, b); },
  });
  // receive loop: everything arriving on our port belongs to this connection
  (async () => {
    while (open) {
      const msg = await net.recvUDPSocket(localPort).catch(() => null);
      if (!msg) break;
      if (quic.state === "closed") break;
      quic.handleDatagram(msg.payload);
    }
  })();
  quic.done.then(closeSocket);
  quic.start();

  /** @type {number|null} */
  let timer = null;
  try {
    await Promise.race([
      quic.ready,
      new Promise((_, reject) => {
        timer = simTimer.schedule(() => reject(new Error("QUIC handshake timeout")), o.timeoutMs ?? QUIC_CONNECT_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    quic.close(0, "handshake failed", false);
    closeSocket();
    throw e;
  } finally {
    if (timer !== null) simTimer.cancel(timer);
  }
  const h3 = new Http3Connection({ quic });
  h3.start();
  return {
    quic, h3, localPort,
    // the socket closes once CONNECTION_CLOSE is out (quic.done)
    close: () => { h3.goaway(); quic.close(0x100, ""); },
  };
}

/**
 * Listen for QUIC on UDP `port` and serve HTTP/3.
 * @param {any} os
 * @param {{ port: number, cert?: any, selectCert?: (sni: string) => any,
 *           onRequest: (req: any, res: any, conn: QuicConnection) => any,
 *           onConnection?: (conn: QuicConnection, peer: { ip: IPAddress, port: number }) => void }} o
 * @returns {{ stop: () => void, server: QuicServer }}
 */
export function listenHttp3(os, o) {
  const net = os.net;
  const sock = net.openUDPSocket(new IPAddress(4, 0), o.port);
  let open = true;
  const server = new QuicServer({
    alpn: ["h3"],
    cert: o.cert,
    selectCert: o.selectCert,
    connOptions: { now: () => os.clock?.nowMs?.() ?? Date.now(), idleTimeoutMs: SimTimer.HTTP_KEEPALIVE_TIMEOUT_MS * 6 },
    send: (b, peer) => { if (open) net.sendUDPSocket(sock, peer.ip, peer.port, b); },
    onConnection: (conn, peer) => {
      o.onConnection?.(conn, peer);
      conn.ready.then(() => {
        const h3 = new Http3Connection({ quic: conn, onRequest: (req, res) => o.onRequest(req, res, conn) });
        h3.start();
      }).catch(() => { /* failed handshakes are logged by onConnection's owner */ });
    },
  });
  (async () => {
    while (open) {
      const msg = await net.recvUDPSocket(sock).catch(() => null);
      if (!msg) break;
      server.handleDatagram(msg.payload, { ip: msg.src, port: msg.srcPort });
    }
  })();
  return {
    server,
    stop: () => {
      if (!open) return;
      // keep the socket until every CONNECTION_CLOSE has been sent
      server.closeAll().finally(() => {
        open = false;
        try { net.closeUDPSocket(sock); } catch { /* ignore */ }
      });
    },
  };
}
