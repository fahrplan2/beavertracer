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
import { computeIPv4PseudoChecksum } from '../../src/net/util/checksumUtils.js';

/** @param {TCPPacket} tcp */
function parseTsOption(tcp) {
  return TcpEngine._parseTsOption(tcp.options ?? new Uint8Array(0));
}

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

    // Verify segmentation: each segment carries at most MSS bytes.
    // With Slow Start (initial cwnd = 1 MSS), not all bytes are transmitted
    // in the first _flushSend — subsequent batches flow as ACKs grow cwnd.
    const dataSegs = log.slice(logBefore).filter(e => e.from === 'client' && e.tcp.payload.length > 0);
    expect(dataSegs.length).toBeGreaterThan(1);
    dataSegs.forEach(seg => expect(seg.tcp.payload.length).toBeLessThanOrEqual(512));
  });

  it('data segments carry PSH only on the piece that completes a write', async () => {
    const { client, server, log } = makeLoopback();
    const { clientKey } = await connect(client, server);
    log.length = 0;
    client.send(clientKey, new Uint8Array(1200)); // MSS 512 → 512 + 512 + 176
    const data = log.filter(e => e.from === 'client' && e.tcp.payload.length > 0);
    expect(data.length).toBeGreaterThanOrEqual(1);
    const psh = data.map(e => e.tcp.hasFlag(TCPPacket.FLAG_PSH));
    expect(psh.at(-1)).toBe(true);
    expect(psh.slice(0, -1).every(f => !f)).toBe(true);
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

describe('duplicate ACKs (RFC 5681 §4.2)', () => {
  /** Segment from the client at `seqOffset` bytes past what the server expects next. */
  function setup() {
    const env = makeLoopback();
    return connect(env.client, env.server).then(({ serverKey }) => {
      const serverConn = env.server.conns.get(serverKey);
      const clientConn = [...env.client.conns.values()].find(c => c.state === 'ESTABLISHED');
      const base = serverConn.theiracc;
      const inject = (seqOffset, data) => env.server.handle({
        src: CLIENT_IP, dst: SERVER_IP,
        payload: new TCPPacket({
          srcPort: clientConn.port, dstPort: SERVER_PORT,
          seq: (base + seqOffset) >>> 0, ack: serverConn.myacc,
          flags: TCPPacket.FLAG_ACK, payload: data,
        }).pack(),
      });
      const serverAcks = () => env.log.filter(e => e.from === 'server' && e.tcp.payload.length === 0).map(e => e.tcp.ack >>> 0);
      return { ...env, base, inject, serverAcks };
    });
  }

  it('acknowledges every out-of-order segment immediately with the old ACK number', async () => {
    const { base, inject, serverAcks } = await setup();
    inject(0, new Uint8Array([1, 2, 3, 4, 5]));           // in order → ACK base+5
    inject(10, new Uint8Array([11, 12, 13, 14, 15]));      // gap (5..9 lost) → dup ACK base+5
    inject(15, new Uint8Array([16, 17, 18, 19, 20]));      // still gap → dup ACK base+5
    expect(serverAcks().slice(-3)).toEqual([base + 5, base + 5, base + 5].map(n => n >>> 0));
  });

  it('acknowledges everything at once when the gap is filled', async () => {
    const { base, inject, serverAcks } = await setup();
    inject(0, new Uint8Array([1, 2, 3, 4, 5]));
    inject(10, new Uint8Array([11, 12, 13, 14, 15]));
    inject(5, new Uint8Array([6, 7, 8, 9, 10]));           // fills the gap
    expect(serverAcks().at(-1)).toBe((base + 15) >>> 0);
  });

  it('re-acknowledges a duplicate (already received) segment', async () => {
    const { base, inject, serverAcks } = await setup();
    inject(0, new Uint8Array([1, 2, 3]));
    const before = serverAcks().length;
    inject(0, new Uint8Array([1, 2, 3]));                  // retransmitted copy
    expect(serverAcks().length).toBe(before + 1);
    expect(serverAcks().at(-1)).toBe((base + 3) >>> 0);
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

// ─────────────────────────────────────────────────────────────────────────────
// TCP Timestamps (RFC 7323)
// ─────────────────────────────────────────────────────────────────────────────

describe('TCP Timestamps', () => {
  it('SYN and SYN-ACK both carry a Timestamp option', async () => {
    const { client, server, log } = makeLoopback();
    await connect(client, server);

    const syn    = log.find(e => e.from === 'client' && e.tcp.hasFlag(TCPPacket.FLAG_SYN) && !e.tcp.hasFlag(TCPPacket.FLAG_ACK));
    const synAck = log.find(e => e.from === 'server' && e.tcp.hasFlag(TCPPacket.FLAG_SYN) &&  e.tcp.hasFlag(TCPPacket.FLAG_ACK));

    expect(parseTsOption(syn.tcp)).not.toBeNull();
    expect(parseTsOption(synAck.tcp)).not.toBeNull();
  });

  it('SYN-ACK echoes the SYN TSval as TSecr', async () => {
    const { client, server, log } = makeLoopback();
    await connect(client, server);

    const syn    = log.find(e => e.from === 'client' && e.tcp.hasFlag(TCPPacket.FLAG_SYN) && !e.tcp.hasFlag(TCPPacket.FLAG_ACK));
    const synAck = log.find(e => e.from === 'server' && e.tcp.hasFlag(TCPPacket.FLAG_SYN) &&  e.tcp.hasFlag(TCPPacket.FLAG_ACK));

    const synTs    = parseTsOption(syn.tcp);
    const synAckTs = parseTsOption(synAck.tcp);

    expect(synAckTs.tsecr).toBe(synTs.tsval);
  });

  it('tsEnabled is true on both sides after handshake', async () => {
    const { client, server } = makeLoopback();
    const { clientConn, serverKey } = await connect(client, server);
    const serverConn = server.conns.get(serverKey);

    expect(clientConn.tsEnabled).toBe(true);
    expect(serverConn.tsEnabled).toBe(true);
  });

  it('data segments carry a Timestamp option after handshake', async () => {
    const { client, server, log } = makeLoopback();
    const { clientKey } = await connect(client, server);

    const before = log.length;
    client.send(clientKey, new Uint8Array([1, 2, 3]));

    const dataSeg = log.slice(before).find(e => e.from === 'client' && e.tcp.payload.length > 0);
    expect(dataSeg).toBeDefined();
    expect(parseTsOption(dataSeg.tcp)).not.toBeNull();
  });

  it('RTT measurement updates srtt and rtoMs after a delayed ACK', async () => {
    const { client, server } = makeLoopback();
    const { clientKey, clientConn, serverKey } = await connect(client, server);

    // Intercept server ACKs so we can deliver them with a simulated delay.
    let pendingAck = null;
    const origServerSend = server._ipSend.bind(server);
    // @ts-ignore
    server._ipSend = (opts) => {
      const tcp = TCPPacket.fromBytes(opts.payload);
      if (tcp.hasFlag(TCPPacket.FLAG_ACK) && !tcp.hasFlag(TCPPacket.FLAG_SYN) && tcp.payload.length === 0) {
        pendingAck = opts;
      } else {
        origServerSend(opts);
      }
    };

    client.send(clientKey, new Uint8Array([1, 2, 3]));
    expect(pendingAck).not.toBeNull();

    // Simulate a 20-tick (100 ms simulated) round-trip delay.
    const delay = 20;
    for (let i = 0; i < delay; i++) simTimer.tick();

    // Deliver the delayed ACK — this triggers RTT measurement.
    client.handle({ src: SERVER_IP, dst: CLIENT_IP, payload: pendingAck.payload });

    // srtt reflects the measured delay; rtoMs is clamped to TCP_MIN_RTO_MS (1 s per RFC 6298).
    expect(clientConn.srtt).toBeGreaterThan(0);
    expect(clientConn.rtoMs).toBeGreaterThanOrEqual(SimTimer.TCP_MIN_RTO_MS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Congestion control
// ─────────────────────────────────────────────────────────────────────────────

describe('congestion control', () => {
  it('cwnd starts at 1 MSS after handshake', async () => {
    const { client, server } = makeLoopback();
    const { clientConn, serverKey } = await connect(client, server);
    const serverConn = server.conns.get(serverKey);

    expect(clientConn.cwnd).toBe(clientConn.mss);
    expect(serverConn.cwnd).toBe(serverConn.mss);
  });

  it('cwnd grows after a properly-timed ACK (Slow Start)', async () => {
    const { client, server } = makeLoopback();
    const { clientKey, clientConn } = await connect(client, server);

    // Intercept server ACK and deliver it after send() returns so that
    // myacc is already updated and okAck passes.
    let pendingAck = null;
    // @ts-ignore
    server._ipSend = (opts) => {
      const tcp = TCPPacket.fromBytes(opts.payload);
      if (tcp.hasFlag(TCPPacket.FLAG_ACK) && !tcp.hasFlag(TCPPacket.FLAG_SYN) && tcp.payload.length === 0) {
        pendingAck = opts;
      }
    };

    const cwndBefore = clientConn.cwnd;
    client.send(clientKey, new Uint8Array(clientConn.mss)); // exactly 1 MSS
    expect(pendingAck).not.toBeNull();

    // Deliver the ACK now that myacc has been updated.
    client.handle({ src: SERVER_IP, dst: CLIENT_IP, payload: pendingAck.payload });

    expect(clientConn.cwnd).toBeGreaterThan(cwndBefore);
  });

  it('Fast Retransmit: 3 duplicate ACKs trigger retransmit without waiting for RTO', async () => {
    const { client, server } = makeLoopback();
    const { clientKey, clientConn } = await connect(client, server);

    const sent = [];
    // @ts-ignore
    client._ipSend = ({ payload }) => sent.push(TCPPacket.fromBytes(payload));

    client.send(clientKey, new Uint8Array([1]));
    const initialSent = sent.filter(t => t.payload.length > 0).length;
    expect(initialSent).toBe(1);

    // Build a duplicate ACK: ackNo = sndUna (doesn't advance the window).
    const sndUna = clientConn.outQ[0]?.seq ?? clientConn.myacc;
    const dupAckBytes = new TCPPacket({
      srcPort: SERVER_PORT,
      dstPort: clientConn.port,
      seq: clientConn.theiracc,
      ack: sndUna,
      flags: TCPPacket.FLAG_ACK,
      window: 65535,
    }).pack();

    client.handle({ src: SERVER_IP, dst: CLIENT_IP, payload: dupAckBytes });
    client.handle({ src: SERVER_IP, dst: CLIENT_IP, payload: dupAckBytes });
    client.handle({ src: SERVER_IP, dst: CLIENT_IP, payload: dupAckBytes }); // 3rd → Fast Retransmit

    expect(sent.filter(t => t.payload.length > 0).length).toBeGreaterThan(initialSent);
    // ssthresh and cwnd must have been updated
    expect(clientConn.ssthresh).toBeLessThan(65535);
    expect(clientConn.dupAckCount).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Checksum (RFC 9293 §3.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('checksum', () => {
  /** Wire both engines like makeLoopback(), but keep the raw segment bytes. */
  function makeRawLoopback() {
    /** @type {Array<{src:IPAddress, dst:IPAddress, bytes:Uint8Array}>} */
    const raw = [];
    const client = new TcpEngine({
      ipSend: ({ dst, src, payload }) => { raw.push({ src, dst, bytes: payload }); server.handle({ src, dst, payload }); },
      resolveSrcIp: () => CLIENT_IP,
    });
    const server = new TcpEngine({
      ipSend: ({ dst, src, payload }) => { raw.push({ src, dst, bytes: payload }); client.handle({ src, dst, payload }); },
      resolveSrcIp: () => SERVER_IP,
    });
    return { client, server, raw };
  }

  /** @param {{src:IPAddress, dst:IPAddress, bytes:Uint8Array}} seg */
  function expectValidChecksum(seg) {
    const stored = (seg.bytes[16] << 8) | seg.bytes[17];
    const zeroed = seg.bytes.slice();
    zeroed[16] = 0; zeroed[17] = 0;
    expect(stored).not.toBe(0);
    expect(stored).toBe(computeIPv4PseudoChecksum(zeroed, seg.src.toUInt8(), seg.dst.toUInt8(), 6));
  }

  it('every handshake and data segment carries a valid pseudo-header checksum', async () => {
    const { client, server, raw } = makeRawLoopback();
    const { clientKey } = await connect(client, server);
    client.send(clientKey, new TextEncoder().encode('hello'));
    expect(raw.length).toBeGreaterThanOrEqual(4);
    raw.forEach(expectValidChecksum);
  });

  it('RST for a closed port carries a valid checksum', async () => {
    const { client, raw } = makeRawLoopback();
    await client.connect(SERVER_IP, 9).catch(() => {});
    const rst = raw.find(s => TCPPacket.fromBytes(s.bytes).hasFlag(TCPPacket.FLAG_RST));
    expect(rst).toBeDefined();
    expectValidChecksum(/** @type {any} */ (rst));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persist timer / zero-window probes (RFC 9293 §3.8.6.1, RFC 1122 §4.2.2.17)
// and receiver window updates (RFC 9293 §3.8.6.2.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('persist timer and window updates', () => {
  /**
   * Like makeLoopback(), but segments are queued and only delivered by pump().
   * This mirrors a real link (no re-entrant ACK while the sender is still
   * inside _flushSend), so bulk transfers behave as on the wire.
   */
  function makeQueuedLoopback() {
    /** @type {Array<{from:'client'|'server', tcp:TCPPacket, tick:number}>} */
    const log = [];
    /** @type {Array<() => void>} */
    const queue = [];
    /** @type {{ drop: boolean }} */
    const ctl = { drop: false };
    const client = new TcpEngine({
      ipSend: ({ dst, src, payload }) => {
        log.push({ from: 'client', tcp: TCPPacket.fromBytes(payload), tick: simTimer.currentTick });
        if (!ctl.drop) queue.push(() => server.handle({ src, dst, payload }));
      },
      resolveSrcIp: () => CLIENT_IP,
    });
    const server = new TcpEngine({
      ipSend: ({ dst, src, payload }) => {
        log.push({ from: 'server', tcp: TCPPacket.fromBytes(payload), tick: simTimer.currentTick });
        if (!ctl.drop) queue.push(() => client.handle({ src, dst, payload }));
      },
      resolveSrcIp: () => SERVER_IP,
    });
    const pump = () => { let n = 0; while (queue.length && n++ < 100_000) queue.shift()?.(); };
    /** @param {number} ticks */
    const run = (ticks) => { for (let i = 0; i < ticks; i++) { simTimer.tick(); pump(); } };
    return { client, server, log, pump, run, ctl };
  }

  const TOTAL = 10_000;
  const RCV_CAP = 4096;

  /** Connect, shrink the server's receive buffer, send TOTAL bytes the server doesn't read. */
  async function setupStalled() {
    const lb = makeQueuedLoopback();
    const { client, server, pump, run } = lb;
    server.openServer(BIND_ALL, SERVER_PORT);
    const ap = server.accept(SERVER_PORT);
    const cp = client.connect(SERVER_IP, SERVER_PORT);
    pump();
    const clientConn = await cp;
    const serverKey = (await ap) ?? '';
    const serverConn = /** @type {any} */ (server.conns.get(serverKey));
    serverConn.rcvCap = RCV_CAP;

    const data = new Uint8Array(TOTAL);
    for (let i = 0; i < TOTAL; i++) data[i] = (i * 7 + 3) & 0xff;
    client.send(clientConn.key, data);
    pump();
    run(5);
    return { ...lb, clientConn, serverConn, serverKey, data };
  }

  it('sender sees rwnd=0, then sends 1-byte probes at SND.NXT with exponential backoff', async () => {
    const { log, run, clientConn, serverConn } = await setupStalled();

    expect(clientConn.sndWnd).toBe(0);
    expect(clientConn.sendQBytes).toBeGreaterThan(0);
    expect(clientConn.outQ.length).toBe(0);           // everything in flight was ACKed
    expect(clientConn.persistTimerId).not.toBeNull(); // persist timer armed, not RTO
    expect(clientConn.rtoTimerId).toBeNull();

    const sndNxt = clientConn.myacc >>> 0;
    const logStart = log.length;

    // Run long enough for more than TCP_MAX_REXMIT probes (backoff caps at TCP_MAX_RTO_MS).
    run(SimTimer.toTicks(5 * 60_000));

    const probes = log.slice(logStart).filter(e => e.from === 'client' && e.tcp.payload.length > 0);
    expect(probes.length).toBeGreaterThan(SimTimer.TCP_MAX_REXMIT);
    // Every probe is the same single byte at the old SND.NXT (re-sent while refused).
    for (const p of probes) {
      expect(p.tcp.payload.length).toBe(1);
      expect(p.tcp.seq >>> 0).toBe(sndNxt);
    }
    expect(clientConn.myacc >>> 0).toBe((sndNxt + 1) >>> 0); // probe byte counted in SND.NXT
    expect(clientConn.outQ.length).toBe(1);
    expect(clientConn.outQ[0].probe).toBe(true);

    // Interval doubles (base = RTO 600 ms) and is capped at TCP_MAX_RTO_MS.
    const gaps = probes.slice(1).map((p, i) => p.tick - probes[i].tick);
    expect(gaps[0]).toBe(SimTimer.toTicks(2 * clientConn.rtoMs));
    expect(gaps[1]).toBe(gaps[0] * 2);
    expect(gaps[2]).toBe(gaps[1] * 2);
    expect(Math.max(...gaps)).toBe(SimTimer.toTicks(SimTimer.TCP_MAX_RTO_MS));

    // The receiver refused each probe with a zero-window ACK; connection stays up.
    const zeroAcks = log.slice(logStart).filter(e => e.from === 'server' && e.tcp.window === 0);
    expect(zeroAcks.length).toBeGreaterThanOrEqual(probes.length);
    expect(clientConn.state).toBe('ESTABLISHED');
    expect(serverConn.state).toBe('ESTABLISHED');
    expect(clientConn.dupAckCount).toBe(0); // probe answers are not duplicate ACKs
  });

  it('receiver sends a window update on recv() and the remaining data arrives intact', async () => {
    const { server, log, pump, run, clientConn, serverKey, data } = await setupStalled();
    run(SimTimer.toTicks(3000)); // a few probes
    expect(clientConn.sndWnd).toBe(0);

    // First recv() frees one segment worth of buffer → immediate window update.
    const logStart = log.length;
    const first = await server.recv(serverKey);
    const update = log.slice(logStart).find(e => e.from === 'server');
    expect(update).toBeDefined();
    expect(update?.tcp.payload.length).toBe(0);
    expect(update?.tcp.hasFlag(TCPPacket.FLAG_ACK)).toBe(true);
    expect(update?.tcp.window).toBeGreaterThan(0);

    pump();
    const serverConn = /** @type {any} */ (server.conns.get(serverKey));
    const chunks = [first ?? new Uint8Array()];
    let got = chunks[0].length;
    let ticksWaited = 0;
    // Read only what is buffered (recv() then resolves at once); let the
    // simulation run when the buffer is empty.
    for (let guard = 0; got < TOTAL && guard < 20_000; guard++) {
      if (serverConn.in.length === 0) { ticksWaited++; run(1); continue; }
      const c = (await server.recv(serverKey)) ?? new Uint8Array();
      pump();
      chunks.push(c);
      got += c.length;
    }

    const out = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    expect(got).toBe(TOTAL);
    expect(out).toEqual(data);
    // Driven by window updates, not by waiting for the next probe.
    expect(ticksWaited).toBeLessThan(SimTimer.toTicks(clientConn.rtoMs));

    run(SimTimer.toTicks(2000));
    expect(clientConn.persistTimerId).toBeNull();
    expect(clientConn.sendQBytes).toBe(0);
    expect(clientConn.outQ.length).toBe(0);
    expect(clientConn.state).toBe('ESTABLISHED');
  });

  it('aborts only after TCP_MAX_REXMIT unanswered probes', async () => {
    const { run, ctl, clientConn } = await setupStalled();
    expect(clientConn.persistTimerId).not.toBeNull();
    ctl.drop = true; // peer goes silent
    run(SimTimer.toTicks(10 * 60_000));
    expect(clientConn.state).toBe('CLOSED');
  });
});
