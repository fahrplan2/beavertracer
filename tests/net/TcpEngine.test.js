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

// ─────────────────────────────────────────────────────────────────────────────
// Realistic loss scenarios, RFC 5681 duplicate ACKs / Fast Recovery,
// RFC 9293 + RFC 5961 RST processing, SYN-RECEIVED data, SYN-ACK retransmit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queued loopback (like makeQueuedLoopback() above) with a drop predicate:
 * `drop(from, tcp, n)` gets the sender, the segment and how many data-carrying
 * segments that sender has sent so far (incl. this one) — the same counting as
 * the cable's "Gezielter Paketverlust" (only segments with payload count).
 * @param {(from:'client'|'server', tcp:TCPPacket, n:number) => boolean} [drop]
 */
function makeLossyLoopback(drop = () => false) {
  /** @type {Array<{from:'client'|'server', tcp:TCPPacket, tick:number, dropped:boolean}>} */
  const log = [];
  /** @type {Array<() => void>} */
  const queue = [];
  const dataCount = { client: 0, server: 0 };
  /** @param {'client'|'server'} from @param {() => TcpEngine} peer */
  const mkSend = (from, peer) => ({ dst, src, payload }) => {
    const tcp = TCPPacket.fromBytes(payload);
    if (tcp.payload.length > 0) dataCount[from]++;
    const dropped = drop(from, tcp, dataCount[from]);
    log.push({ from, tcp, tick: simTimer.currentTick, dropped });
    if (!dropped) queue.push(() => peer().handle({ src, dst, payload }));
  };
  const client = new TcpEngine({ ipSend: mkSend('client', () => server), resolveSrcIp: () => CLIENT_IP });
  const server = new TcpEngine({ ipSend: mkSend('server', () => client), resolveSrcIp: () => SERVER_IP });
  /** Deliver queued segments and let promise continuations (apps) run. */
  const settle = async () => {
    for (let i = 0; i < 1000; i++) {
      await Promise.resolve(); await Promise.resolve();
      if (!queue.length) { await new Promise(r => setTimeout(r, 0)); if (!queue.length) return; }
      while (queue.length) queue.shift()?.();
    }
  };
  /** @param {number} ticks */
  const run = async (ticks) => { for (let i = 0; i < ticks; i++) { simTimer.tick(); await settle(); } };
  return { client, server, log, settle, run };
}

/** Connect over a lossy loopback; the server echoes everything (SimpleTCPServer-like). */
async function connectEcho(lb) {
  const { client, server, settle } = lb;
  server.openServer(BIND_ALL, SERVER_PORT);
  const ap = server.accept(SERVER_PORT);
  const cp = client.connect(SERVER_IP, SERVER_PORT);
  await settle();
  const clientConn = await cp;
  const serverKey = (await ap) ?? '';
  (async () => {
    for (;;) {
      const d = await server.recv(serverKey);
      if (!d) break;
      server.send(serverKey, d);
    }
  })();
  return { clientConn, serverKey, serverConn: server.conns.get(serverKey) };
}

const enc = (s) => new TextEncoder().encode(s);

describe('lesson 5.4: loss of the second data segment', () => {
  // Drop the client's 2nd data segment (first transmission only), as the cable does.
  const dropSecond = (from, tcp, n) => from === 'client' && n === 2;

  it('one dup ACK, RTO retransmission at rel. seq 8, then ACK 17 (Hallo / Welt / !)', async () => {
    const lb = makeLossyLoopback(dropSecond);
    const { client, log, settle, run } = lb;
    const { clientConn, serverConn } = await connectEcho(lb);
    const cIsn = (clientConn.myacc - 1) >>> 0;
    const rel = (n) => ((n >>> 0) - cIsn) >>> 0;

    client.send(clientConn.key, enc('Hallo\r\n')); await settle();
    client.send(clientConn.key, enc('Welt\r\n'));  await settle();   // lost
    client.send(clientConn.key, enc('!\r\n'));     await settle();

    const start = log.findIndex(e => e.dropped);
    const serverAcks = log.slice(start).filter(e => e.from === 'server' && e.tcp.payload.length === 0);
    expect(serverAcks.map(e => rel(e.tcp.ack))).toEqual([8]);       // exactly one dup ACK
    expect(clientConn.dupAckCount).toBe(1);

    const tickBefore = simTimer.currentTick;
    const logBefore = log.length;
    await run(SimTimer.toTicks(clientConn.rtoMs) + 1);
    const after = log.slice(logBefore);
    const retx = after.filter(e => e.from === 'client' && e.tcp.payload.length > 0);
    expect(retx.length).toBe(1);
    expect(rel(retx[0].tcp.seq)).toBe(8);
    expect(retx[0].tick - tickBefore).toBeGreaterThanOrEqual(SimTimer.toTicks(600)); // via RTO
    const ackAfter = after.find(e => e.from === 'server' && e.tick === retx[0].tick);
    expect(rel(ackAfter?.tcp.ack ?? 0)).toBe(17);
    expect(serverConn.theiracc >>> 0).toBe((cIsn + 17) >>> 0);
    expect(clientConn.outQ.length).toBe(0);
  });

  it('Vertiefung: four quick messages → three dup ACKs → Fast Retransmit, no RTO wait', async () => {
    const lb = makeLossyLoopback(dropSecond);
    const { client, log, settle } = lb;
    const { clientConn } = await connectEcho(lb);
    const cIsn = (clientConn.myacc - 1) >>> 0;
    const rel = (n) => ((n >>> 0) - cIsn) >>> 0;

    client.send(clientConn.key, enc('Hallo\r\n')); await settle();
    const tick = simTimer.currentTick;
    for (const m of ['Welt\r\n', 'a\r\n', 'b\r\n', 'c\r\n']) client.send(clientConn.key, enc(m));
    await settle();

    const start = log.findIndex(e => e.dropped);
    const after = log.slice(start + 1);
    const dupAcks = after.filter(e => e.from === 'server' && e.tcp.payload.length === 0 && rel(e.tcp.ack) === 8);
    expect(dupAcks.length).toBe(3);
    const retx = after.filter(e => e.from === 'client' && rel(e.tcp.seq) === 8 && e.tcp.payload.length > 0);
    expect(retx.length).toBe(1);
    expect(retx[0].tick).toBe(tick);                       // immediately, not after RTO
    // The retransmission is sent right after the third dup ACK arrived.
    expect(log.indexOf(retx[0])).toBeGreaterThan(log.indexOf(dupAcks[2]));
    const fullAck = after.find(e => e.from === 'server' && rel(e.tcp.ack) === 8 + 6 + 3 * 3);
    expect(fullAck).toBeDefined();
    expect(clientConn.outQ.length).toBe(0);
    expect(clientConn.inFastRecovery).toBe(false);
    expect(clientConn.cwnd).toBe(clientConn.ssthresh);    // deflated after recovery
  });
});

describe('Fast Recovery (RFC 5681 §3.2)', () => {
  /** Client with `nseg` full segments in flight (black-holed), cwnd opened wide. */
  async function inFlight(nseg) {
    const { client, server } = makeLoopback();
    const { clientKey, clientConn } = await connect(client, server);
    const sent = [];
    // @ts-ignore
    client._ipSend = ({ payload }) => sent.push(TCPPacket.fromBytes(payload));
    clientConn.cwnd = 10 * clientConn.mss;
    client.send(clientKey, new Uint8Array(nseg * clientConn.mss));
    const sndUna = clientConn.outQ[0].seq >>> 0;
    const ackSeg = (ackNo, extra = {}) => client.handle({
      src: SERVER_IP, dst: CLIENT_IP,
      payload: new TCPPacket({
        srcPort: SERVER_PORT, dstPort: clientConn.port, seq: clientConn.theiracc,
        ack: ackNo >>> 0, flags: TCPPacket.FLAG_ACK, window: clientConn.sndWnd, ...extra,
      }).pack(),
    });
    return { client, clientConn, sent, sndUna, ackSeg };
  }

  it('ssthresh = max(FlightSize/2, 2·MSS) and cwnd is deflated to ssthresh on the first new ACK', async () => {
    const { clientConn, sndUna, ackSeg } = await inFlight(8);
    const mss = clientConn.mss;
    expect(clientConn.myacc - sndUna).toBe(8 * mss);
    ackSeg(sndUna); ackSeg(sndUna); ackSeg(sndUna);
    expect(clientConn.ssthresh).toBe(4 * mss);           // FlightSize/2, not min(cwnd,rwnd)/2
    expect(clientConn.cwnd).toBe(7 * mss);
    ackSeg(sndUna);                                      // 4th dup ACK inflates
    expect(clientConn.cwnd).toBe(8 * mss);
    ackSeg(clientConn.myacc);                            // everything acknowledged
    expect(clientConn.cwnd).toBe(4 * mss);
    expect(clientConn.inFastRecovery).toBe(false);
  });

  it('data segments of the reverse direction with ACK == SND.UNA are not duplicate ACKs', async () => {
    const { clientConn, sent, sndUna, ackSeg } = await inFlight(2);
    const before = sent.filter(t => t.payload.length > 0).length;
    for (let i = 0; i < 4; i++) {
      ackSeg(sndUna, { seq: clientConn.theiracc, flags: TCPPacket.FLAG_ACK | TCPPacket.FLAG_PSH, payload: enc('x') });
    }
    expect(clientConn.dupAckCount).toBe(0);
    expect(sent.filter(t => t.payload.length > 0).length).toBe(before); // no Fast Retransmit
  });

  it('window updates (ACK == SND.UNA, changed window) are not duplicate ACKs', async () => {
    const { clientConn, sent, sndUna, ackSeg } = await inFlight(2);
    const before = sent.filter(t => t.payload.length > 0).length;
    for (let i = 1; i <= 4; i++) ackSeg(sndUna, { window: 60000 + i * 100 });
    expect(clientConn.dupAckCount).toBe(0);
    expect(sent.filter(t => t.payload.length > 0).length).toBe(before);
  });

  it('a FIN with ACK == SND.UNA is not a duplicate ACK', async () => {
    const { clientConn, sndUna, ackSeg } = await inFlight(2);
    ackSeg(sndUna, { flags: TCPPacket.FLAG_ACK | TCPPacket.FLAG_FIN });
    expect(clientConn.dupAckCount).toBe(0);
  });
});

describe('SYN-RECEIVED: segment completing the handshake carries data (RFC 9293 §3.10.7.4)', () => {
  it('a bare handshake ACK is not answered (no extra server ACK / Dup ACK after the handshake)', async () => {
    const lb = makeLossyLoopback();
    await connectEcho(lb);
    await lb.run(5);
    expect(lb.log.map(e => e.from)).toEqual(['client', 'server', 'client']);
  });

  // Drop the client's bare handshake ACK (first pure ACK the client sends).
  function lossyHandshake() {
    let dropped = false;
    return makeLossyLoopback((from, tcp) => {
      if (dropped || from !== 'client') return false;
      const pureAck = tcp.flags === TCPPacket.FLAG_ACK && tcp.payload.length === 0;
      if (pureAck) dropped = true;
      return pureAck;
    });
  }

  it('the payload is delivered at once and acknowledged — no retransmission needed', async () => {
    const lb = lossyHandshake();
    const { client, server, log, settle } = lb;
    server.openServer(BIND_ALL, SERVER_PORT);
    const ap = server.accept(SERVER_PORT);
    const cp = client.connect(SERVER_IP, SERVER_PORT);
    await settle();
    const clientConn = await cp;
    const serverConn = [...server.conns.values()][0];
    expect(serverConn.state).toBe('SYN-RECEIVED');

    client.send(clientConn.key, enc('hello'));
    await settle();
    expect(serverConn.state).toBe('ESTABLISHED');
    const serverKey = (await ap) ?? '';
    expect(new TextDecoder().decode(await server.recv(serverKey) ?? new Uint8Array())).toBe('hello');
    expect(clientConn.outQ.length).toBe(0);
    expect(log.filter(e => e.from === 'client' && e.tcp.payload.length > 0).length).toBe(1);
  });

  it('a FIN on the completing segment is processed too (→ CLOSE-WAIT)', async () => {
    const lb = lossyHandshake();
    const { client, server, settle } = lb;
    server.openServer(BIND_ALL, SERVER_PORT);
    server.accept(SERVER_PORT);
    const cp = client.connect(SERVER_IP, SERVER_PORT);
    await settle();
    const clientConn = await cp;
    const serverConn = [...server.conns.values()][0];
    client.close(clientConn.key);
    await settle();
    expect(serverConn.state).toBe('CLOSE-WAIT');
    expect(serverConn.eof).toBe(true);
  });
});

describe('RST acceptance (RFC 9293 §3.10.7.3/§3.10.7.4, RFC 5961 §3.2)', () => {
  /** @param {TcpEngine} eng @param {any} conn @param {object} f */
  const rstTo = (eng, conn, f) => eng.handle({
    src: conn.peerIP, dst: conn.localIP,
    payload: new TCPPacket({ srcPort: conn.peerPort, dstPort: conn.port, flags: TCPPacket.FLAG_RST, window: 0, ...f }).pack(),
  });

  it('SYN-SENT: RST without ACK or with a wrong ACK is ignored; RST acking the SYN refuses', async () => {
    const sent = [];
    const client = new TcpEngine({ ipSend: ({ payload }) => sent.push(TCPPacket.fromBytes(payload)), resolveSrcIp: () => CLIENT_IP });
    const cp = client.connect(SERVER_IP, SERVER_PORT);
    let err = null;
    cp.catch(e => { err = e; });
    const conn = [...client.conns.values()][0];
    expect(conn.state).toBe('SYN-SENT');

    rstTo(client, conn, { seq: 0 });                                                    // no ACK
    rstTo(client, conn, { seq: 0, ack: (conn.myacc + 5) >>> 0, flags: TCPPacket.FLAG_RST | TCPPacket.FLAG_ACK });
    await Promise.resolve();
    expect(conn.state).toBe('SYN-SENT');

    rstTo(client, conn, { seq: 0, ack: conn.myacc, flags: TCPPacket.FLAG_RST | TCPPacket.FLAG_ACK });
    await Promise.resolve(); await Promise.resolve();
    expect(conn.state).toBe('CLOSED');
    expect(err).toBeInstanceOf(Error);
  });

  it('ESTABLISHED: in-window RST with SEQ != RCV.NXT → challenge ACK, connection stays', async () => {
    const { client, server } = makeLoopback();
    const { clientConn } = await connect(client, server);
    const sent = [];
    // @ts-ignore
    client._ipSend = ({ payload }) => sent.push(TCPPacket.fromBytes(payload));

    rstTo(client, clientConn, { seq: (clientConn.theiracc + 100) >>> 0 });
    expect(clientConn.state).toBe('ESTABLISHED');
    expect(sent.length).toBe(1);
    expect(sent[0].flags).toBe(TCPPacket.FLAG_ACK);
    expect(sent[0].ack >>> 0).toBe(clientConn.theiracc >>> 0);
    expect(sent[0].seq >>> 0).toBe(clientConn.myacc >>> 0);
  });

  it('ESTABLISHED: RST outside the receive window is silently ignored', async () => {
    const { client, server } = makeLoopback();
    const { clientConn } = await connect(client, server);
    const sent = [];
    // @ts-ignore
    client._ipSend = ({ payload }) => sent.push(TCPPacket.fromBytes(payload));
    rstTo(client, clientConn, { seq: (clientConn.theiracc + 1_000_000) >>> 0 });
    rstTo(client, clientConn, { seq: (clientConn.theiracc - 1) >>> 0 });
    expect(clientConn.state).toBe('ESTABLISHED');
    expect(sent.length).toBe(0);
  });
});

describe('RST generation without a connection (RFC 9293 §3.10.7.1/§3.10.7.2)', () => {
  function engine() {
    const sent = [];
    const eng = new TcpEngine({ ipSend: ({ payload }) => sent.push(TCPPacket.fromBytes(payload)), resolveSrcIp: () => SERVER_IP });
    /** @param {object} f */
    const inject = (f) => eng.handle({
      src: CLIENT_IP, dst: SERVER_IP,
      payload: new TCPPacket({ srcPort: 40000, dstPort: SERVER_PORT, window: 1000, ...f }).pack(),
    });
    return { eng, sent, inject };
  }

  it('CLOSED port: a bare FIN (no ACK) is answered with RST+ACK acknowledging it', () => {
    const { sent, inject } = engine();
    inject({ seq: 5000, flags: TCPPacket.FLAG_FIN });
    expect(sent.length).toBe(1);
    expect(sent[0].flags).toBe(TCPPacket.FLAG_RST | TCPPacket.FLAG_ACK);
    expect(sent[0].seq).toBe(0);
    expect(sent[0].ack >>> 0).toBe(5001);
  });

  it('CLOSED port: data without ACK → RST+ACK, ack = SEG.SEQ + SEG.LEN', () => {
    const { sent, inject } = engine();
    inject({ seq: 7000, flags: TCPPacket.FLAG_PSH, payload: enc('abc') });
    expect(sent.length).toBe(1);
    expect(sent[0].ack >>> 0).toBe(7003);
  });

  it('LISTEN port: a stray ACK gets <SEQ=SEG.ACK><CTL=RST>', () => {
    const { eng, sent, inject } = engine();
    eng.openServer(BIND_ALL, SERVER_PORT);
    inject({ seq: 100, ack: 4242, flags: TCPPacket.FLAG_ACK, payload: enc('x') });
    expect(sent.length).toBe(1);
    expect(sent[0].flags).toBe(TCPPacket.FLAG_RST);
    expect(sent[0].seq >>> 0).toBe(4242);
    expect(eng.conns.size).toBe(0);
  });

  it('LISTEN port: a SYN+ACK gets a RST, not a new connection', () => {
    const { eng, sent, inject } = engine();
    eng.openServer(BIND_ALL, SERVER_PORT);
    inject({ seq: 100, ack: 777, flags: TCPPacket.FLAG_SYN | TCPPacket.FLAG_ACK });
    expect(sent.length).toBe(1);
    expect(sent[0].flags).toBe(TCPPacket.FLAG_RST);
    expect(sent[0].seq >>> 0).toBe(777);
    expect(eng.conns.size).toBe(0);
  });

  it('never answers a RST with a RST (closed and listening port)', () => {
    const { eng, sent, inject } = engine();
    inject({ seq: 1, ack: 2, flags: TCPPacket.FLAG_RST | TCPPacket.FLAG_ACK });
    inject({ seq: 1, flags: TCPPacket.FLAG_RST });
    eng.openServer(BIND_ALL, SERVER_PORT);
    inject({ seq: 1, ack: 2, flags: TCPPacket.FLAG_RST | TCPPacket.FLAG_ACK });
    inject({ seq: 1, flags: TCPPacket.FLAG_RST | TCPPacket.FLAG_SYN });
    expect(sent.length).toBe(0);
    expect(eng.conns.size).toBe(0);
  });
});

describe('SYN-ACK retransmission', () => {
  /** @param {boolean} withTs */
  function synAckRetx(withTs) {
    const sent = [];
    const server = new TcpEngine({ ipSend: ({ payload }) => sent.push(TCPPacket.fromBytes(payload)), resolveSrcIp: () => SERVER_IP });
    server.openServer(BIND_ALL, SERVER_PORT);
    server.handle({
      src: CLIENT_IP, dst: SERVER_IP,
      payload: new TCPPacket({
        srcPort: 40000, dstPort: SERVER_PORT, seq: 9000, flags: TCPPacket.FLAG_SYN, window: 65535,
        options: withTs ? TcpEngine._buildSynOptions(512, 77, 0) : TcpEngine._buildMssOption(512),
      }).pack(),
    });
    for (let i = 0; i < SimTimer.toTicks(600) + 1; i++) simTimer.tick();
    const synAcks = sent.filter(t => t.hasFlag(TCPPacket.FLAG_SYN) && t.hasFlag(TCPPacket.FLAG_ACK));
    return synAcks;
  }

  it('carries the same options (MSS + TS) as the original SYN-ACK', () => {
    const synAcks = synAckRetx(true);
    expect(synAcks.length).toBe(2);
    for (const t of synAcks) {
      expect(TcpEngine._parseMssOption(t.options)).toBe(512);
      expect(parseTsOption(t)?.tsecr).toBe(77);
    }
    expect(synAcks[1].options.length).toBe(synAcks[0].options.length);
  });

  it('carries the MSS option when timestamps were not offered', () => {
    const synAcks = synAckRetx(false);
    expect(synAcks.length).toBe(2);
    expect(TcpEngine._parseMssOption(synAcks[1].options)).toBe(512);
    expect(parseTsOption(synAcks[1])).toBeNull();
  });
});
