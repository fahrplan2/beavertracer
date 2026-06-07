/**
 * TcpEngine integration tests using a two-engine loopback.
 *
 * Both engines are wired so that ipSend() of one immediately calls handle()
 * of the other. Because handle() is synchronous and simTimer is tick-based
 * (not real-time), the entire handshake runs within a single await resolution
 * and connect timeouts never fire unless simTimer.tick() is explicitly called.
 *
 * Note on ACK timing: in the synchronous loopback, ACKs from the peer arrive
 * while `conn.myacc` hasn't yet been updated (the update happens after
 * `_sendSegment` returns). The engine's seqLE guard correctly rejects those
 * out-of-window ACKs. Data still flows and arrives at the receiver; it just
 * stays in the sender's outQ until the next correctly-timed ACK clears it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TcpEngine } from '../../src/net/TcpEngine.js';
import { TCPPacket } from '../../src/net/pdu/TCPPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { simTimer, SimTimer } from '../../src/lib/SimTimer.js';

const CLIENT_IP = IPAddress.fromString('10.0.0.1');
const SERVER_IP = IPAddress.fromString('10.0.0.2');
const SERVER_PORT = 8080;
const BIND_ALL = IPAddress.fromString('0.0.0.0');

/**
 * Build a pair of cross-wired TcpEngine instances.
 * Outgoing segments from each engine are recorded in `log` for inspection.
 * @returns {{ client: TcpEngine, server: TcpEngine, log: Array<{from:'client'|'server', tcp:TCPPacket}> }}
 */
function makeLoopback() {
  /** @type {Array<{from:'client'|'server', tcp:TCPPacket}>} */
  const log = [];

  const client = new TcpEngine({
    ipSend: ({ dst, src, payload }) => {
      const tcp = TCPPacket.fromBytes(payload);
      log.push({ from: 'client', tcp });
      server.handle({ src, dst, payload });
    },
    resolveSrcIp: () => CLIENT_IP,
  });

  const server = new TcpEngine({
    ipSend: ({ dst, src, payload }) => {
      const tcp = TCPPacket.fromBytes(payload);
      log.push({ from: 'server', tcp });
      client.handle({ src, dst, payload });
    },
    resolveSrcIp: () => SERVER_IP,
  });

  return { client, server, log };
}

/**
 * Establish a full connection and return the keys for both sides.
 * @param {TcpEngine} client
 * @param {TcpEngine} server
 */
async function connect(client, server) {
  server.openServer(BIND_ALL, SERVER_PORT);
  const acceptPromise = server.accept(SERVER_PORT);
  const clientConn = await client.connect(SERVER_IP, SERVER_PORT);
  const serverKey = (await acceptPromise) ?? '';
  return { clientKey: clientConn.key, serverKey, clientConn };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3-Way Handshake
// ─────────────────────────────────────────────────────────────────────────────

describe('3-way handshake', () => {
  it('client reaches ESTABLISHED after connect()', async () => {
    const { client, server } = makeLoopback();
    const { clientConn } = await connect(client, server);
    expect(clientConn.state).toBe('ESTABLISHED');
  });

  it('server reaches ESTABLISHED after accept()', async () => {
    const { client, server } = makeLoopback();
    const { serverKey } = await connect(client, server);
    const serverConn = server.conns.get(serverKey);
    expect(serverConn?.state).toBe('ESTABLISHED');
  });

  it('segment order is SYN (client) → SYN+ACK (server) → ACK (client)', async () => {
    const { client, server, log } = makeLoopback();
    await connect(client, server);

    const syn    = log.find(e => e.tcp.hasFlag(TCPPacket.FLAG_SYN) && !e.tcp.hasFlag(TCPPacket.FLAG_ACK));
    const synAck = log.find(e => e.tcp.hasFlag(TCPPacket.FLAG_SYN) &&  e.tcp.hasFlag(TCPPacket.FLAG_ACK));
    const ack    = log.find(e =>
      !e.tcp.hasFlag(TCPPacket.FLAG_SYN) && e.tcp.hasFlag(TCPPacket.FLAG_ACK) && !e.tcp.hasFlag(TCPPacket.FLAG_FIN)
    );

    expect(syn?.from).toBe('client');
    expect(synAck?.from).toBe('server');
    expect(ack?.from).toBe('client');

    expect(log.indexOf(syn)).toBeLessThan(log.indexOf(synAck));
    expect(log.indexOf(synAck)).toBeLessThan(log.indexOf(ack));
  });

  it('SYN carries no ACK flag', async () => {
    const { client, server, log } = makeLoopback();
    await connect(client, server);

    const syn = log.find(e => e.from === 'client' && e.tcp.hasFlag(TCPPacket.FLAG_SYN));
    expect(syn?.tcp.hasFlag(TCPPacket.FLAG_ACK)).toBe(false);
  });

  it('connect() rejects when no server is listening', async () => {
    const { client } = makeLoopback();
    await expect(client.connect(SERVER_IP, SERVER_PORT)).rejects.toThrow();
  });

  it('openServer() throws when port is already in use', async () => {
    const { client, server } = makeLoopback();
    await connect(client, server);
    expect(() => server.openServer(BIND_ALL, SERVER_PORT)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Data transfer
// ─────────────────────────────────────────────────────────────────────────────

describe('data transfer', () => {
  /** @type {TcpEngine} */ let client;
  /** @type {TcpEngine} */ let server;
  /** @type {string}    */ let clientKey;
  /** @type {string}    */ let serverKey;

  beforeEach(async () => {
    ({ client, server } = makeLoopback());
    ({ clientKey, serverKey } = await connect(client, server));
  });

  it('client sends data and server receives it', async () => {
    client.send(clientKey, new TextEncoder().encode('hello'));
    const received = await server.recv(serverKey);
    expect(new TextDecoder().decode(received ?? new Uint8Array())).toBe('hello');
  });

  it('server sends data and client receives it', async () => {
    server.send(serverKey, new TextEncoder().encode('world'));
    const received = await client.recv(clientKey);
    expect(new TextDecoder().decode(received ?? new Uint8Array())).toBe('world');
  });

  it('server sends ACK after receiving data', () => {
    const { client: c2, server: s2, log } = makeLoopback();
    s2.openServer(BIND_ALL, SERVER_PORT);
    const ap = s2.accept(SERVER_PORT);

    // Connect synchronously (resolves in microtask, but data-send is sync)
    c2.connect(SERVER_IP, SERVER_PORT).then(async (conn2) => {
      await ap;
      const logBefore = log.length;
      c2.send(conn2.key, new Uint8Array([1, 2, 3]));
      const acks = log.slice(logBefore).filter(e => e.from === 'server' && e.tcp.hasFlag(TCPPacket.FLAG_ACK));
      expect(acks.length).toBeGreaterThan(0);
    });
  });

  it('large payload is split across multiple DATA segments (MSS=512)', async () => {
    const { client: c2, server: s2, log } = makeLoopback();
    s2.openServer(BIND_ALL, SERVER_PORT);
    const ap = s2.accept(SERVER_PORT);
    const conn2 = await c2.connect(SERVER_IP, SERVER_PORT);
    await ap;

    const logBefore = log.length;
    c2.send(conn2.key, new Uint8Array(1500).fill(0xab));

    // Verify from the segment log: multiple DATA segments were sent
    const dataSegs = log.slice(logBefore).filter(e => e.from === 'client' && e.tcp.payload.length > 0);
    expect(dataSegs.length).toBeGreaterThan(1); // more than 1 segment
    const totalPayload = dataSegs.reduce((sum, e) => sum + e.tcp.payload.length, 0);
    expect(totalPayload).toBe(1500);            // all bytes accounted for
  });

  it('sequence number advances by payload size after send', () => {
    const conn = client.conns.get(clientKey);
    const accBefore = (conn?.myacc ?? 0) >>> 0;
    client.send(clientKey, new Uint8Array(10));
    expect(((conn?.myacc ?? 0) >>> 0) - accBefore).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connection teardown (FIN/close)
// ─────────────────────────────────────────────────────────────────────────────

describe('connection teardown', () => {
  it('close() sends a FIN+ACK segment', async () => {
    const { client, server, log } = makeLoopback();
    const { clientKey } = await connect(client, server);

    const logBefore = log.length;
    client.close(clientKey);

    const fins = log.slice(logBefore).filter(e => e.from === 'client' && e.tcp.hasFlag(TCPPacket.FLAG_FIN));
    expect(fins.length).toBeGreaterThanOrEqual(1);
    expect(fins[0].tcp.hasFlag(TCPPacket.FLAG_ACK)).toBe(true);
  });

  it('server recv() returns null (EOF) after client closes', async () => {
    const { client, server } = makeLoopback();
    const { clientKey, serverKey } = await connect(client, server);

    client.send(clientKey, new TextEncoder().encode('last'));
    client.close(clientKey);

    expect(new TextDecoder().decode((await server.recv(serverKey)) ?? new Uint8Array())).toBe('last');
    expect(await server.recv(serverKey)).toBeNull();
  });

  it('client state after close() is in the teardown sequence', async () => {
    const { client, server } = makeLoopback();
    const { clientKey, clientConn } = await connect(client, server);

    client.close(clientKey);
    expect(['FIN-WAIT-1', 'FIN-WAIT-2', 'TIME-WAIT', 'CLOSED']).toContain(clientConn.state);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RST behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('RST handling', () => {
  it('server sends RST when SYN arrives on a closed port', async () => {
    const { client, log } = makeLoopback();

    try { await client.connect(SERVER_IP, SERVER_PORT); } catch { /* expected */ }

    const rsts = log.filter(e => e.from === 'server' && e.tcp.hasFlag(TCPPacket.FLAG_RST));
    expect(rsts.length).toBeGreaterThanOrEqual(1);
  });

  it('connection is destroyed when RST is received', async () => {
    const { client, server } = makeLoopback();
    const { clientKey, clientConn } = await connect(client, server);

    const rstBytes = new TCPPacket({
      srcPort: SERVER_PORT,
      dstPort: clientConn.port,
      seq: clientConn.theiracc,
      flags: TCPPacket.FLAG_RST,
    }).pack();

    client.handle({ src: SERVER_IP, dst: CLIENT_IP, payload: rstBytes });

    expect(clientConn.state).toBe('CLOSED');
    expect(client.conns.get(clientKey)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RTO retransmission
// ─────────────────────────────────────────────────────────────────────────────

describe('RTO retransmission', () => {
  it('retransmits data segment after RTO when ACK never arrives', async () => {
    const { client, server } = makeLoopback();
    const { clientKey, clientConn } = await connect(client, server);

    /** @type {TCPPacket[]} */
    const sentAfterDrop = [];
    // @ts-ignore — replace ipSend to black-hole all outgoing packets
    client._ipSend = ({ payload }) => { sentAfterDrop.push(TCPPacket.fromBytes(payload)); };

    client.send(clientKey, new Uint8Array([1, 2, 3]));
    const txBeforeRto = sentAfterDrop.filter(t => t.payload.length > 0).length;
    expect(txBeforeRto).toBe(1);

    // advance past initial 600 ms RTO (120 ticks at 5 ms/tick)
    for (let i = 0; i < SimTimer.toTicks(600) + 1; i++) simTimer.tick();

    const txAfterRto = sentAfterDrop.filter(t => t.payload.length > 0).length;
    expect(txAfterRto).toBeGreaterThan(1);
  });

  it('RTO doubles on each timeout (exponential backoff)', async () => {
    const { client, server } = makeLoopback();
    const { clientKey, clientConn } = await connect(client, server);

    // @ts-ignore
    client._ipSend = () => {};

    client.send(clientKey, new Uint8Array([1]));
    const rtoInitial = clientConn.rtoMs; // 600

    for (let i = 0; i < SimTimer.toTicks(rtoInitial) + 1; i++) simTimer.tick();
    expect(clientConn.rtoMs).toBe(rtoInitial * 2);

    for (let i = 0; i < SimTimer.toTicks(clientConn.rtoMs) + 1; i++) simTimer.tick();
    expect(clientConn.rtoMs).toBe(rtoInitial * 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Out-of-order delivery
// ─────────────────────────────────────────────────────────────────────────────

describe('out-of-order delivery', () => {
  it('two segments injected out of order are delivered in sequence', async () => {
    const { client, server } = makeLoopback();
    const { serverKey } = await connect(client, server);
    const serverConn = server.conns.get(serverKey);
    const clientConn = [...client.conns.values()].find(c => c.state === 'ESTABLISHED');

    const base = serverConn.theiracc; // next expected seq from client

    // Inject second segment first (bytes 5-9), then first (bytes 0-4).
    const makeSegment = (seqOffset, data) => new TCPPacket({
      srcPort: clientConn.port,
      dstPort: SERVER_PORT,
      seq: (base + seqOffset) >>> 0,
      ack: serverConn.myacc,
      flags: TCPPacket.FLAG_ACK,
      payload: data,
    }).pack();

    server.handle({ src: CLIENT_IP, dst: SERVER_IP, payload: makeSegment(5, new Uint8Array([6, 7, 8, 9, 10])) });
    expect(serverConn.in.length).toBe(0); // gap: nothing delivered yet

    server.handle({ src: CLIENT_IP, dst: SERVER_IP, payload: makeSegment(0, new Uint8Array([1, 2, 3, 4, 5])) });

    // Both segments are now merged and delivered as one contiguous block.
    const received = await server.recv(serverKey);
    expect(received?.length).toBe(10);
    expect(Array.from(received ?? [])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('duplicate segment does not cause duplicate delivery', async () => {
    const { client, server } = makeLoopback();
    const { serverKey } = await connect(client, server);
    const serverConn = server.conns.get(serverKey);
    const clientConn = [...client.conns.values()].find(c => c.state === 'ESTABLISHED');

    const segBytes = new TCPPacket({
      srcPort: clientConn.port,
      dstPort: SERVER_PORT,
      seq: serverConn.theiracc,
      ack: serverConn.myacc,
      flags: TCPPacket.FLAG_ACK,
      payload: new Uint8Array([1, 2, 3]),
    }).pack();

    server.handle({ src: CLIENT_IP, dst: SERVER_IP, payload: segBytes });
    server.handle({ src: CLIENT_IP, dst: SERVER_IP, payload: segBytes }); // duplicate

    const received = await server.recv(serverKey);
    expect(received?.length).toBe(3);
    expect(serverConn.in.length).toBe(0); // no duplicated chunk in the buffer
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Zero-window flow control
// ─────────────────────────────────────────────────────────────────────────────

describe('zero-window flow control', () => {
  it('sender stalls on window=0 and resumes when peer opens the window', async () => {
    const { client, server } = makeLoopback();
    const { clientKey, clientConn, serverKey } = await connect(client, server);

    // Inject a zero-window ACK from "server" into the client engine.
    const injectAck = (window) => client.handle({
      src: SERVER_IP,
      dst: CLIENT_IP,
      payload: new TCPPacket({
        srcPort: SERVER_PORT,
        dstPort: clientConn.port,
        seq: clientConn.theiracc,
        ack: clientConn.myacc,
        flags: TCPPacket.FLAG_ACK,
        window,
      }).pack(),
    });

    injectAck(0);
    expect(clientConn.sndWnd).toBe(0);

    // Track outgoing data segments while window is closed.
    const dataSent = [];
    // @ts-ignore
    const origSend = client._ipSend.bind(client);
    // @ts-ignore
    client._ipSend = (opts) => {
      const tcp = TCPPacket.fromBytes(opts.payload);
      if (tcp.payload.length > 0) dataSent.push(tcp);
      origSend(opts);
    };

    client.send(clientKey, new Uint8Array(5).fill(0xaa));
    expect(dataSent.length).toBe(0);           // nothing transmitted
    expect(clientConn.sendQ.length).toBeGreaterThan(0); // but queued

    // Re-open the window — client should flush sendQ immediately.
    injectAck(65535);
    expect(dataSent.length).toBeGreaterThan(0); // data now sent
    expect(clientConn.sendQ.length).toBe(0);    // sendQ drained
  });
});
