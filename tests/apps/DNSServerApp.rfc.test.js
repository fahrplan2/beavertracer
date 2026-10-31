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

import { DNSResolver } from '../../src/apps/lib/DNSResolver.js';

/** @param {any} cfg */
function startServer(cfg) {
  const vnet = makeVirtualUDPNet();
  const server = new DNSServerApp(makeOS(vnet.net));
  server.cfg = { a: [], aaaa: [], cname: [], mx: [], ns: [], mode: 'authoritative', forwarderIp: '', ...cfg };
  server._start();
  return { vnet, server, sockId: /** @type {number} */ (server.socketPort) };
}

/** @param {any} r */
const authTypes = (r) => r.authorities.map((/** @type {any} */ x) => [x.name, x.type]);

describe('DNSServerApp – RFC conformance', () => {
  /** @type {ReturnType<typeof startServer>[]} */
  let started = [];
  /** @param {any} cfg */
  const srv = (cfg) => { const s = startServer(cfg); started.push(s); return s; };
  afterEach(() => { for (const s of started) s.server._stop(); started = []; });

  const exampleZone = {
    a:  [{ name: 'www.example.com', ip: '1.2.3.4', ttl: 60 }],
    ns: [{ name: 'example.com', host: 'ns1.example.com', ttl: 300 }],
  };

  it('NS at own zone apex is not a delegation: unknown name → NXDOMAIN, AA=1, SOA (RFC 1034 §4.3.2, RFC 2308 §3)', async () => {
    const { vnet, sockId } = srv(exampleZone);
    const r = await query(vnet, sockId, 'nope.example.com', DNSPacket.TYPE_A);
    expect(r.rcode).toBe(3);
    expect(r.aa).toBe(1);
    expect(r.answers).toHaveLength(0);
    expect(authTypes(r)).toEqual([['example.com', DNSPacket.TYPE_SOA]]);
  });

  it('existing name without requested type → NODATA with SOA, AA=1 (RFC 2308 §2.2)', async () => {
    const { vnet, sockId } = srv(exampleZone);
    const r = await query(vnet, sockId, 'www.example.com', DNSPacket.TYPE_AAAA);
    expect(r.rcode).toBe(0);
    expect(r.aa).toBe(1);
    expect(r.answers).toHaveLength(0);
    expect(authTypes(r)).toEqual([['example.com', DNSPacket.TYPE_SOA]]);
  });

  it('positive answer from own zone has AA=1', async () => {
    const { vnet, sockId } = srv(exampleZone);
    const r = await query(vnet, sockId, 'www.example.com', DNSPacket.TYPE_A);
    expect(r.rcode).toBe(0);
    expect(r.aa).toBe(1);
    expect(r.answers).toHaveLength(1);
  });

  it('name outside every own zone without recursion → REFUSED, AA=0 (RFC 1035 §4.1.1)', async () => {
    const { vnet, sockId } = srv(exampleZone);
    const r = await query(vnet, sockId, 'foo.other.org', DNSPacket.TYPE_A);
    expect(r.rcode).toBe(5);
    expect(r.aa).toBe(0);
  });

  it('server without NS/SOA: unknown name in implicit zone → NXDOMAIN, AA=1, SOA', async () => {
    const { vnet, sockId } = srv({ a: [{ name: 'www.beaver-schule.de', ip: '192.168.0.20' }] });
    const ok = await query(vnet, sockId, 'www.beaver-schule.de', DNSPacket.TYPE_A);
    expect(ok.aa).toBe(1);
    expect(ok.answers).toHaveLength(1);
    const r = await query(vnet, sockId, 'nope.beaver-schule.de', DNSPacket.TYPE_A);
    expect(r.rcode).toBe(3);
    expect(r.aa).toBe(1);
    expect(authTypes(r)).toEqual([['beaver-schule.de', DNSPacket.TYPE_SOA]]);
  });

  it('delegation below the apex (zone cut) stays a referral, AA=0', async () => {
    const { vnet, sockId } = srv({
      a:  [{ name: 'www.example.com', ip: '1.2.3.4' }, { name: 'ns.sub.example.com', ip: '1.2.3.5' }],
      ns: [
        { name: 'example.com', host: 'ns1.example.com' },
        { name: 'sub.example.com', host: 'ns.sub.example.com' },
      ],
    });
    const r = await query(vnet, sockId, 'host.sub.example.com', DNSPacket.TYPE_A);
    expect(r.rcode).toBe(0);
    expect(r.aa).toBe(0);
    expect(r.answers).toHaveLength(0);
    expect(r.authorities.map((/** @type {any} */ x) => [x.name, x.type, x.data]))
      .toEqual([['sub.example.com', DNSPacket.TYPE_NS, 'ns.sub.example.com']]);
    // Names in the parent zone itself are still answered authoritatively
    const nx = await query(vnet, sockId, 'nope.example.com', DNSPacket.TYPE_A);
    expect(nx.rcode).toBe(3);
    expect(nx.aa).toBe(1);
  });

  it('root/TLD-style server with only NS + glue refers, glue answer is non-authoritative', async () => {
    const { vnet, sockId } = srv({
      a:  [{ name: 'ns.nic.de', ip: '192.168.0.102' }],
      ns: [{ name: 'de', host: 'ns.nic.de' }],
    });
    const r = await query(vnet, sockId, 'www.beaver-schule.de', DNSPacket.TYPE_A);
    expect(r.rcode).toBe(0);
    expect(r.aa).toBe(0);
    expect(authTypes(r)).toEqual([['de', DNSPacket.TYPE_NS]]);
    const glue = await query(vnet, sockId, 'ns.nic.de', DNSPacket.TYPE_A);
    expect(glue.answers).toHaveLength(1);
    expect(glue.aa).toBe(0);
  });

  it('recursive answer for a foreign name has AA=0', async () => {
    const { vnet, server, sockId } = srv({ mode: 'recursive', forwarderIp: '192.168.0.101' });
    // @ts-ignore – stub upstream resolver
    server._resolver = {
      async _query(/** @type {string} */ name) {
        return new DNSPacket({
          id: 1, qr: 1, aa: 1, rcode: 0,
          questions: [{ name, type: DNSPacket.TYPE_A, cls: DNSPacket.CLASS_IN }],
          answers: [{ name, type: DNSPacket.TYPE_A, cls: DNSPacket.CLASS_IN, ttl: 60, data: new Uint8Array([9, 9, 9, 9]) }],
          authorities: [], additionals: [],
        });
      },
    };
    const r = await query(vnet, sockId, 'foo.other.org', DNSPacket.TYPE_A);
    expect(r.rcode).toBe(0);
    expect(r.aa).toBe(0);
    expect(r.ra).toBe(1);
    expect(r.answers).toHaveLength(1);
  });
});

// ── Iterative resolution across root → TLD → authoritative (lesson 6.2 setup) ─

describe('DNSServerApp – iterative resolution via DNSResolver', () => {
  it('resolves www.beaver-schule.de through real delegations', async () => {
    /** @type {Map<string, DNSServerApp>} */
    const servers = new Map();
    /** @type {Map<number, ReturnType<typeof makeQueue>>} */
    const clientSocks = new Map();
    let nextSock = 1000;

    /** @param {string} ip @param {any} cfg */
    const add = (ip, cfg) => {
      const s = new DNSServerApp(makeOS({
        sendUDPSocket(/** @type {number} */ _p, /** @type {any} */ _dst, /** @type {number} */ dstPort, /** @type {Uint8Array} */ data) {
          clientSocks.get(dstPort)?.push({ src: IPAddress.fromString(ip), srcPort: 53, payload: data });
        },
      }));
      s.cfg = { a: [], aaaa: [], cname: [], mx: [], ns: [], mode: 'authoritative', forwarderIp: '', ...cfg };
      servers.set(ip, s);
    };
    add('192.168.0.101', { a: [{ name: 'ns.nic.de', ip: '192.168.0.102' }], ns: [{ name: 'de', host: 'ns.nic.de' }] });
    add('192.168.0.102', { a: [{ name: 'ns.beaver-schule.de', ip: '192.168.0.103' }], ns: [{ name: 'beaver-schule.de', host: 'ns.beaver-schule.de' }] });
    add('192.168.0.103', { a: [{ name: 'www.beaver-schule.de', ip: '192.168.0.20' }] });

    const clientNet = {
      openUDPSocket() { const id = ++nextSock; clientSocks.set(id, makeQueue()); return id; },
      closeUDPSocket(/** @type {number} */ id) { clientSocks.get(id)?.close(); clientSocks.delete(id); },
      async recvUDPSocket(/** @type {number} */ id) {
        const q = clientSocks.get(id); if (!q) return null;
        const { done, value } = await q.next(); return done ? null : value;
      },
      sendUDPSocket(/** @type {number} */ id, /** @type {any} */ dst, /** @type {number} */ _port, /** @type {Uint8Array} */ data) {
        const s = servers.get(dst.toString());
        if (s) void s._handleDNSQuery(53, IPAddress.fromString('192.168.0.53'), id, data);
      },
    };
    const resolver = new DNSResolver(makeOS(clientNet), '192.168.0.101', { cache: false });

    // Lesson 6.2.1: a name that does not exist must come back as NXDOMAIN, not as the root referral
    const neg = await resolver._query('gibtsnicht.beaver-schule.de', DNSPacket.TYPE_A);
    expect(neg?.rcode).toBe(3);
    expect(neg?.answers ?? []).toHaveLength(0);

    const ips = await resolver.resolveA('www.beaver-schule.de');
    expect(ips.length).toBeGreaterThan(0);
    const first = ips[0];
    const txt = typeof first === 'number'
      ? [first >>> 24, (first >>> 16) & 255, (first >>> 8) & 255, first & 255].join('.')
      : String(first);
    expect(txt).toBe('192.168.0.20');
  });
});
