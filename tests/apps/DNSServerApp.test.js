//@ts-check

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DNSServerApp } from '../../src/apps/DNSServerApp.js';
import { DNSPacket } from '../../src/net/pdu/DNSPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

// ── Minimal DOM stub ──────────────────────────────────────────────────────────

if (!globalThis.document) {
  const makeFakeEl = () => {
    const el = {
      classList: { add() {}, remove() {} },
      style: {},
      disabled: false,
      value: '',
      textContent: '',
      childElementCount: 0,
      get scrollTop() { return 0; },
      set scrollTop(_v) {},
      get scrollHeight() { return 0; },
      replaceChildren() {},
      appendChild() { return el; },
      removeChild() { return el; },
      addEventListener() {},
      setAttribute() {},
    };
    return el;
  };
  // @ts-ignore
  globalThis.document = {
    createElement: (_tag) => makeFakeEl(),
    createTextNode: (_t) => ({}),
    createDocumentFragment: () => ({ appendChild() {} }),
  };
}

// ── Async single-item queue ───────────────────────────────────────────────────

function makeQueue() {
  /** @type {any[]} */
  const pending = [];
  let closed = false;
  /** @type {((r: {done: boolean, value: any}) => void) | null} */
  let waiter = null;
  return {
    push(val) {
      if (waiter) { const r = waiter; waiter = null; r({ done: false, value: val }); }
      else pending.push(val);
    },
    close() {
      if (closed) return; closed = true;
      if (waiter) { const r = waiter; waiter = null; r({ done: true, value: null }); }
    },
    next() {
      if (pending.length) return Promise.resolve({ done: false, value: pending.shift() });
      if (closed)         return Promise.resolve({ done: true,  value: null });
      return new Promise(r => { waiter = r; });
    },
  };
}

// ── Virtual UDP network ───────────────────────────────────────────────────────

function makeVirtualUDPNet() {
  let nextId = 0;
  /** @type {Map<number, ReturnType<typeof makeQueue>>} */
  const recvQueues = new Map();
  const outgoing = makeQueue();

  const net = {
    openUDPSocket(_ip, _port) {
      const id = ++nextId;
      recvQueues.set(id, makeQueue());
      return id;
    },
    closeUDPSocket(id) {
      recvQueues.get(id)?.close();
      recvQueues.delete(id);
    },
    async recvUDPSocket(id) {
      const q = recvQueues.get(id);
      if (!q) return null;
      const { done, value } = await q.next();
      return done ? null : value;
    },
    sendUDPSocket(_id, dstIp, dstPort, data) {
      outgoing.push({ dstIp, dstPort, data });
    },
  };

  function inject(sockId, src, srcPort, payload) {
    recvQueues.get(sockId)?.push({ src, srcPort, payload });
  }

  async function nextSent() {
    const { done, value } = await outgoing.next();
    return done ? null : value;
  }

  return { net, inject, nextSent };
}

// ── Mock OS ───────────────────────────────────────────────────────────────────

function makeOS(net) {
  return {
    net,
    fs: { readFile() { throw new Error('no fs'); }, writeFile() {} },
    exit() {},
    dns: null,
  };
}

// ── DNS helpers ───────────────────────────────────────────────────────────────

const CLIENT = IPAddress.fromString('10.0.0.1');

/**
 * Build a minimal DNS query packet.
 * @param {string} name
 * @param {number} type
 * @param {number} [id]
 */
function makeQuery(name, type, id = 1) {
  return new DNSPacket({
    id,
    qr: 0,
    questions: [{ name, type, cls: DNSPacket.CLASS_IN }],
    answers: [],
    authorities: [],
    additionals: [],
  }).pack();
}

/**
 * Inject a DNS query and return the parsed response.
 * @param {ReturnType<typeof makeVirtualUDPNet>} vnet
 * @param {number} sockId
 * @param {string} name
 * @param {number} type
 */
async function query(vnet, sockId, name, type) {
  vnet.inject(sockId, CLIENT, 5353, makeQuery(name, type));
  const sent = await vnet.nextSent();
  return DNSPacket.fromBytes(sent.data);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DNSServerApp – authoritative mode', () => {
  /** @type {ReturnType<typeof makeVirtualUDPNet>} */
  let vnet;
  /** @type {DNSServerApp} */
  let server;
  /** @type {number} */
  let sockId;

  beforeEach(() => {
    vnet = makeVirtualUDPNet();
    server = new DNSServerApp(makeOS(vnet.net));

    server.cfg = {
      a:     [{ name: 'example.com', ip: '1.2.3.4',   ttl: 60 }],
      aaaa:  [{ name: 'example.com', ip: '2001:db8::1', ttl: 60 }],
      cname: [{ name: 'www.example.com', target: 'example.com', ttl: 60 }],
      mx:    [{ name: 'example.com', exchange: 'mail.example.com', preference: 10, ttl: 60 }],
      ns:    [{ name: 'example.com', host: 'ns1.example.com', ttl: 300 }],
      mode: 'authoritative',
      forwarderIp: '',
    };

    server._start();
    sockId = /** @type {number} */ (server.socketPort);
  });

  afterEach(() => {
    server._stop();
  });

  // ── A records ────────────────────────────────────────────────────────────────

  describe('A records', () => {
    it('returns the correct IPv4 address for a known name', async () => {
      const resp = await query(vnet, sockId, 'example.com', DNSPacket.TYPE_A);
      expect(resp.rcode).toBe(0);
      expect(resp.answers).toHaveLength(1);
      expect(resp.answers[0].type).toBe(DNSPacket.TYPE_A);
      const ip = Array.from(resp.answers[0].data).join('.');
      expect(ip).toBe('1.2.3.4');
    });

    it('echoes the query ID in the response', async () => {
      vnet.inject(sockId, CLIENT, 5353, makeQuery('example.com', DNSPacket.TYPE_A, 0xABCD));
      const sent = await vnet.nextSent();
      const resp = DNSPacket.fromBytes(sent.data);
      expect(resp.id).toBe(0xABCD);
    });

    it('sets QR=1 (response) in the reply', async () => {
      const resp = await query(vnet, sockId, 'example.com', DNSPacket.TYPE_A);
      expect(resp.qr).toBe(1);
    });

    it('returns NXDOMAIN (rcode 3) for unknown name', async () => {
      const resp = await query(vnet, sockId, 'unknown.invalid', DNSPacket.TYPE_A);
      expect(resp.rcode).toBe(3);
      expect(resp.answers).toHaveLength(0);
    });
  });

  // ── AAAA records ─────────────────────────────────────────────────────────────

  describe('AAAA records', () => {
    it('returns 16-byte IPv6 address data for AAAA query', async () => {
      const resp = await query(vnet, sockId, 'example.com', DNSPacket.TYPE_AAAA);
      expect(resp.rcode).toBe(0);
      expect(resp.answers).toHaveLength(1);
      expect(resp.answers[0].type).toBe(DNSPacket.TYPE_AAAA);
      expect(resp.answers[0].data).toHaveLength(16);
    });
  });

  // ── CNAME records ─────────────────────────────────────────────────────────────

  describe('CNAME records', () => {
    it('returns a CNAME record for the alias name', async () => {
      const resp = await query(vnet, sockId, 'www.example.com', DNSPacket.TYPE_CNAME);
      expect(resp.rcode).toBe(0);
      const cname = resp.answers.find(a => a.type === DNSPacket.TYPE_CNAME);
      expect(cname).toBeTruthy();
      expect(cname.data).toBe('example.com');
    });

    it('returns a CNAME when querying A for a CNAME-only name', async () => {
      const resp = await query(vnet, sockId, 'www.example.com', DNSPacket.TYPE_A);
      expect(resp.answers.some(a => a.type === DNSPacket.TYPE_CNAME)).toBe(true);
    });
  });

  // ── MX records ───────────────────────────────────────────────────────────────

  describe('MX records', () => {
    it('returns MX record with exchange and preference', async () => {
      const resp = await query(vnet, sockId, 'example.com', DNSPacket.TYPE_MX);
      expect(resp.rcode).toBe(0);
      const mx = resp.answers.find(a => a.type === DNSPacket.TYPE_MX);
      expect(mx).toBeTruthy();
      expect(mx.data.exchange).toBe('mail.example.com');
      expect(mx.data.preference).toBe(10);
    });
  });

  // ── NS records ───────────────────────────────────────────────────────────────

  describe('NS records', () => {
    it('returns NS record for the zone', async () => {
      const resp = await query(vnet, sockId, 'example.com', DNSPacket.TYPE_NS);
      expect(resp.rcode).toBe(0);
      const ns = resp.answers.find(a => a.type === DNSPacket.TYPE_NS);
      expect(ns).toBeTruthy();
      expect(ns.data).toBe('ns1.example.com');
    });
  });

  // ── Case-insensitivity ────────────────────────────────────────────────────────

  describe('Name normalization', () => {
    it('matches names case-insensitively', async () => {
      const resp = await query(vnet, sockId, 'EXAMPLE.COM', DNSPacket.TYPE_A);
      expect(resp.rcode).toBe(0);
      expect(resp.answers).toHaveLength(1);
    });
  });
});
