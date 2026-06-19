//@ts-check

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DHCPServerApp } from '../../src/apps/DHCPServerApp.js';
import { DHCPPacket } from '../../src/net/pdu/DHCPPacket.js';
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

// ── DHCP helpers ─────────────────────────────────────────────────────────────

const CLIENT_SRC = IPAddress.fromString('0.0.0.0');
const MAC_A = new Uint8Array([0xAA, 0xBB, 0xCC, 0x11, 0x22, 0x33]);
const MAC_B = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01]);

/** Build and pack a DHCPDISCOVER packet. */
function makeDiscover(mac, xid = 0x12345678) {
  const pkt = new DHCPPacket({ xid });
  pkt.setClientMAC(mac);
  pkt.setMessageType(DHCPPacket.MT_DISCOVER);
  return pkt.pack();
}

/**
 * Build and pack a DHCPREQUEST packet requesting a specific IP.
 * @param {Uint8Array} mac
 * @param {Uint8Array} requestedIpBytes  4-byte IPv4
 * @param {number} [xid]
 */
function makeRequest(mac, requestedIpBytes, xid = 0x12345678) {
  const pkt = new DHCPPacket({ xid });
  pkt.setClientMAC(mac);
  pkt.setMessageType(DHCPPacket.MT_REQUEST);
  pkt.setOption(DHCPPacket.OPT_REQUESTED_IP, requestedIpBytes);
  return pkt.pack();
}

/** Convert yiaddr (Uint8Array[4]) to dotted-decimal string. */
function yiaddrStr(bytes) {
  return Array.from(bytes).join('.');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DHCPServerApp – DORA handshake', () => {
  /** @type {ReturnType<typeof makeVirtualUDPNet>} */
  let vnet;
  /** @type {DHCPServerApp} */
  let server;
  /** @type {number} */
  let sockId;

  beforeEach(() => {
    vnet = makeVirtualUDPNet();
    server = new DHCPServerApp(makeOS(vnet.net));
    // defaultCfg gives range 192.168.1.100-200, gateway 192.168.1.1
    server._start();
    sockId = /** @type {number} */ (server.socketPort);
  });

  afterEach(() => {
    server._stop();
  });

  // ── DISCOVER → OFFER ─────────────────────────────────────────────────────────

  describe('DISCOVER → OFFER', () => {
    it('responds to DISCOVER with an OFFER', async () => {
      vnet.inject(sockId, CLIENT_SRC, 68, makeDiscover(MAC_A));
      const sent = await vnet.nextSent();
      const offer = DHCPPacket.fromBytes(sent.data);
      expect(offer.getMessageType()).toBe(DHCPPacket.MT_OFFER);
    });

    it('OFFER yiaddr is within the configured range', async () => {
      vnet.inject(sockId, CLIENT_SRC, 68, makeDiscover(MAC_A));
      const sent = await vnet.nextSent();
      const offer = DHCPPacket.fromBytes(sent.data);
      const ip = yiaddrStr(offer.yiaddr);
      // Default range 192.168.1.100-200
      const last = Number(ip.split('.')[3]);
      expect(last).toBeGreaterThanOrEqual(100);
      expect(last).toBeLessThanOrEqual(200);
    });

    it('OFFER is sent to UDP port 68 (DHCP client port)', async () => {
      vnet.inject(sockId, CLIENT_SRC, 68, makeDiscover(MAC_A));
      const sent = await vnet.nextSent();
      expect(sent.dstPort).toBe(68);
    });
  });

  // ── DISCOVER → OFFER → REQUEST → ACK ─────────────────────────────────────────

  describe('full DORA cycle', () => {
    it('ACK confirms the offered IP', async () => {
      vnet.inject(sockId, CLIENT_SRC, 68, makeDiscover(MAC_A));
      const offerPkt = await vnet.nextSent();
      const offer = DHCPPacket.fromBytes(offerPkt.data);
      const offeredIp = yiaddrStr(offer.yiaddr);

      vnet.inject(sockId, CLIENT_SRC, 68, makeRequest(MAC_A, offer.yiaddr));
      const ackPkt = await vnet.nextSent();
      const ack = DHCPPacket.fromBytes(ackPkt.data);

      expect(ack.getMessageType()).toBe(DHCPPacket.MT_ACK);
      expect(yiaddrStr(ack.yiaddr)).toBe(offeredIp);
    });

    it('ACK matches the original transaction ID', async () => {
      const xid = 0xDEADBEEF;
      vnet.inject(sockId, CLIENT_SRC, 68, makeDiscover(MAC_A, xid));
      const offerPkt = await vnet.nextSent();
      const offer = DHCPPacket.fromBytes(offerPkt.data);

      vnet.inject(sockId, CLIENT_SRC, 68, makeRequest(MAC_A, offer.yiaddr, xid));
      const ackPkt = await vnet.nextSent();
      const ack = DHCPPacket.fromBytes(ackPkt.data);

      expect(ack.xid).toBe(xid);
    });

    it('two clients receive different IP addresses', async () => {
      vnet.inject(sockId, CLIENT_SRC, 68, makeDiscover(MAC_A));
      const offerA = DHCPPacket.fromBytes((await vnet.nextSent()).data);
      vnet.inject(sockId, CLIENT_SRC, 68, makeRequest(MAC_A, offerA.yiaddr));
      await vnet.nextSent(); // ACK for A

      vnet.inject(sockId, CLIENT_SRC, 68, makeDiscover(MAC_B));
      const offerB = DHCPPacket.fromBytes((await vnet.nextSent()).data);

      expect(yiaddrStr(offerA.yiaddr)).not.toBe(yiaddrStr(offerB.yiaddr));
    });
  });

  // ── Lease re-use ──────────────────────────────────────────────────────────────

  describe('lease re-use', () => {
    it('same MAC gets same IP on second DISCOVER', async () => {
      // First DORA
      vnet.inject(sockId, CLIENT_SRC, 68, makeDiscover(MAC_A));
      const offer1 = DHCPPacket.fromBytes((await vnet.nextSent()).data);
      vnet.inject(sockId, CLIENT_SRC, 68, makeRequest(MAC_A, offer1.yiaddr));
      await vnet.nextSent(); // ACK

      // Second DISCOVER from same MAC
      vnet.inject(sockId, CLIENT_SRC, 68, makeDiscover(MAC_A));
      const offer2 = DHCPPacket.fromBytes((await vnet.nextSent()).data);

      expect(yiaddrStr(offer2.yiaddr)).toBe(yiaddrStr(offer1.yiaddr));
    });
  });

  // ── NAK for invalid REQUEST ───────────────────────────────────────────────────

  describe('NAK', () => {
    it('sends NAK when requested IP is outside the pool range', async () => {
      const outOfRange = new Uint8Array([10, 0, 0, 1]); // not in 192.168.1.100-200
      vnet.inject(sockId, CLIENT_SRC, 68, makeRequest(MAC_A, outOfRange));
      const sent = await vnet.nextSent();
      const nak = DHCPPacket.fromBytes(sent.data);
      expect(nak.getMessageType()).toBe(DHCPPacket.MT_NAK);
    });
  });
});
