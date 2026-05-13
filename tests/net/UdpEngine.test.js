import { describe, it, expect, beforeEach } from 'vitest';
import { UdpEngine } from '../../src/net/UdpEngine.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { UDPPacket } from '../../src/net/pdu/UDPPacket.js';

const IP_A = IPAddress.fromString('10.0.0.1');
const IP_B = IPAddress.fromString('10.0.0.2');
const BIND_ALL = IPAddress.fromString('0.0.0.0');
const PORT_A = 5000;
const PORT_B = 5001;

/**
 * Build a cross-wired pair of UdpEngines so that each engine's ipSend
 * immediately delivers into the other engine's handle(). All I/O is synchronous.
 */
function makeLoopback() {
  /** @type {UdpEngine} */
  let a;
  /** @type {UdpEngine} */
  let b;

  a = new UdpEngine({
    ipSend: ({ payload, src, dst }) => { b.handle({ src, dst, payload }); },
    resolveSrcIp: () => IP_A,
  });

  b = new UdpEngine({
    ipSend: ({ payload, src, dst }) => { a.handle({ src, dst, payload }); },
    resolveSrcIp: () => IP_B,
  });

  return { a, b };
}

// ─────────────────────────────────────────────────────────────────────────────
// Open / Close
// ─────────────────────────────────────────────────────────────────────────────

describe('open / close', () => {
  it('open() returns the bound port number', () => {
    const { a } = makeLoopback();
    expect(a.open(BIND_ALL, PORT_A)).toBe(PORT_A);
  });

  it('opening the same port twice throws', () => {
    const { a } = makeLoopback();
    a.open(BIND_ALL, PORT_A);
    expect(() => a.open(BIND_ALL, PORT_A)).toThrow();
  });

  it('port 0 is rejected', () => {
    const { a } = makeLoopback();
    expect(() => a.open(BIND_ALL, 0)).toThrow();
  });

  it('port 65536 is rejected', () => {
    const { a } = makeLoopback();
    expect(() => a.open(BIND_ALL, 65536)).toThrow();
  });

  it('close() removes the socket from the map', () => {
    const { a } = makeLoopback();
    a.open(BIND_ALL, PORT_A);
    a.close(PORT_A);
    expect(a.sockets.get(PORT_A)).toBeUndefined();
  });

  it('after close() the port can be reopened', () => {
    const { a } = makeLoopback();
    a.open(BIND_ALL, PORT_A);
    a.close(PORT_A);
    expect(() => a.open(BIND_ALL, PORT_A)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Send / Recv
// ─────────────────────────────────────────────────────────────────────────────

describe('send / recv', () => {
  /** @type {UdpEngine} */ let a;
  /** @type {UdpEngine} */ let b;

  beforeEach(() => {
    ({ a, b } = makeLoopback());
    a.open(BIND_ALL, PORT_A);
    b.open(BIND_ALL, PORT_B);
  });

  it('A sends to B and B receives the payload', async () => {
    await a.send(PORT_A, IP_B, PORT_B, new Uint8Array([1, 2, 3]));
    const msg = await b.recv(PORT_B);
    expect(Array.from(msg?.payload ?? [])).toEqual([1, 2, 3]);
  });

  it('B sends to A and A receives the payload', async () => {
    await b.send(PORT_B, IP_A, PORT_A, new Uint8Array([4, 5, 6]));
    const msg = await a.recv(PORT_A);
    expect(Array.from(msg?.payload ?? [])).toEqual([4, 5, 6]);
  });

  it('multiple messages are buffered and delivered in order', async () => {
    await a.send(PORT_A, IP_B, PORT_B, new Uint8Array([10]));
    await a.send(PORT_A, IP_B, PORT_B, new Uint8Array([20]));
    const msg1 = await b.recv(PORT_B);
    const msg2 = await b.recv(PORT_B);
    expect(msg1?.payload[0]).toBe(10);
    expect(msg2?.payload[0]).toBe(20);
  });

  it('recv() includes correct srcPort and dstPort metadata', async () => {
    await a.send(PORT_A, IP_B, PORT_B, new Uint8Array([99]));
    const msg = await b.recv(PORT_B);
    expect(msg?.srcPort).toBe(PORT_A);
    expect(msg?.dstPort).toBe(PORT_B);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Async recv (waiter)
// ─────────────────────────────────────────────────────────────────────────────

describe('async recv', () => {
  it('recv() blocks as a Promise until send() delivers a message', async () => {
    const { a, b } = makeLoopback();
    a.open(BIND_ALL, PORT_A);
    b.open(BIND_ALL, PORT_B);

    let resolved = false;
    const recvPromise = b.recv(PORT_B).then((msg) => { resolved = true; return msg; });

    expect(resolved).toBe(false);

    await a.send(PORT_A, IP_B, PORT_B, new Uint8Array([7]));
    const msg = await recvPromise;
    expect(resolved).toBe(true);
    expect(msg?.payload[0]).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Close wakes pending recv
// ─────────────────────────────────────────────────────────────────────────────

describe('close wakes pending recv', () => {
  it('close() resolves a pending recv() with null', async () => {
    const { b } = makeLoopback();
    b.open(BIND_ALL, PORT_B);

    const recvPromise = b.recv(PORT_B);
    b.close(PORT_B);
    const msg = await recvPromise;
    expect(msg).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// destroyAll
// ─────────────────────────────────────────────────────────────────────────────

describe('destroyAll', () => {
  it('destroyAll() removes all sockets', () => {
    const { b } = makeLoopback();
    b.open(BIND_ALL, PORT_B);
    b.open(BIND_ALL, PORT_B + 1);
    b.destroyAll();
    expect(b.sockets.size).toBe(0);
  });

  it('destroyAll() resolves all pending recv() calls with null', async () => {
    const { b } = makeLoopback();
    b.open(BIND_ALL, PORT_B);

    const p1 = b.recv(PORT_B);
    const p2 = b.recv(PORT_B);
    b.destroyAll();
    expect(await p1).toBeNull();
    expect(await p2).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ICMP Port Unreachable
// ─────────────────────────────────────────────────────────────────────────────

describe('ICMP Port Unreachable', () => {
  it('handle() on an unbound port calls sendIcmpError with type=3 code=3', () => {
    let icmpArgs = null;
    const engine = new UdpEngine({
      ipSend: () => {},
      sendIcmpError: (original, type, code) => { icmpArgs = { type, code }; },
    });

    const pkt = new UDPPacket({ srcPort: 1234, dstPort: 9999, payload: new Uint8Array([1]) });
    engine.handle({ src: IP_A, dst: IP_B, payload: pkt.pack() });

    expect(icmpArgs?.type).toBe(3);
    expect(icmpArgs?.code).toBe(3);
  });

  it('handle() on an unbound port with no sendIcmpError callback does not throw', () => {
    const engine = new UdpEngine({ ipSend: () => {} });
    const pkt = new UDPPacket({ srcPort: 1234, dstPort: 9999, payload: new Uint8Array([1]) });
    expect(() => engine.handle({ src: IP_A, dst: IP_B, payload: pkt.pack() })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Src IP resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('src IP resolution', () => {
  it('resolveSrcIp is called with the destination IP when socket is bound to wildcard', async () => {
    let resolvedDst = null;
    const engine = new UdpEngine({
      ipSend: () => {},
      resolveSrcIp: (dstIp) => { resolvedDst = dstIp; return IP_A; },
    });
    engine.open(BIND_ALL, PORT_A);
    await engine.send(PORT_A, IP_B, PORT_B, new Uint8Array([1]));
    expect(resolvedDst?.toString()).toBe(IP_B.toString());
  });
});
