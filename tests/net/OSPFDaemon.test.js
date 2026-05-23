/**
 * OSPFDaemon integration tests.
 *
 * Two flavours:
 *  - Direct-injection tests: craft OSPF packets and call _handleOSPF() directly,
 *    then inspect daemon state without advancing the sim clock.
 *  - Tick-based tests: wire two daemons together via mock IPStacks and advance
 *    simTimer ticks until the expected state is reached.
 *
 * The simTimer singleton is shared globally. Each test stops all daemons it
 * creates so their pending timers are cancelled before the next test runs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OSPFDaemon } from '../../src/net/OSPFDaemon.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { simTimer, SimTimer } from '../../src/lib/SimTimer.js';
import {
    OspfPacket, OspfHello, OspfHeader,
    LsaHeader, RouterLSA, RouterLink, NetworkLSA, SummaryLSA, Lsa,
    OSPF_TYPE_HELLO,
    LSA_TYPE_ROUTER, LSA_TYPE_NETWORK, LSA_TYPE_SUMMARY,
    LINK_TYPE_STUB,
    LSA_INIT_SEQ,
    OSPF_PROTO,
} from '../../src/net/pdu/OSPFPacket.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock IPStack.
 * @param {Array<{ip: string, prefix: number}>} ifaces
 */
function makeStack(ifaces) {
    const handlers = new Map();
    const sent     = [];
    const routes   = [];

    const stack = {
        interfaces: ifaces.map(({ ip, prefix }) => ({
            ip: IPAddress.fromString(ip),
            prefixLength: prefix,
            port: { linkref: {} },
        })),
        _handlers: handlers,
        _sent: sent,
        _routes: routes,
        _peer: /** @type {typeof stack | null} */ (null),

        registerProtoHandler(proto, fn) { handlers.set(proto, fn); },
        unregisterProtoHandler(proto)   { handlers.delete(proto); },

        async sendOnInterface(ifIndex, dst, proto, payload) {
            sent.push({ ifIndex, dst, proto, payload: new Uint8Array(payload) });
            // Deliver synchronously to the peer daemon's handler
            if (stack._peer) {
                const fn = stack._peer._handlers.get(proto);
                if (fn) fn({ src: stack.interfaces[ifIndex]?.ip ?? IPAddress.fromString('0.0.0.0'), payload }, ifIndex);
            }
        },

        addRoute(dst, prefix, ifIndex, nexthop, source) {
            routes.push({ dst: dst.toString(), prefix, ifIndex, nexthop: nexthop.toString(), source });
        },
        delRoute(_dst, _prefix, _ifIndex, _nexthop) { /* no-op for tests */ },
    };

    return stack;
}

/** Wire two stacks so each daemon's outgoing packets arrive at the other's handler. */
function wirePeers(a, b) { a._peer = b; b._peer = a; }

/** Advance the global simTimer by n ticks. */
function tick(n) {
    for (let i = 0; i < n; i++) simTimer.tick();
}

/**
 * Build an OSPF Hello packet suitable for injection into a daemon
 * whose interface has prefix /24 (mask 0xffffff00).
 */
function makeHelloBytes({ routerId, areaId = 0, neighbors = [], dr = 0, bdr = 0 }) {
    const hello = new OspfHello({
        networkMask:    0xffffff00,
        helloInterval:  0,   // matches Math.trunc(OSPF_HELLO_MS / 1000) = 0
        deadInterval:   2,   // matches Math.trunc(OSPF_DEAD_MS  / 1000) = 2
        routerPriority: 1,
        dr, bdr, neighbors,
    });
    const hdr = new OspfHeader({ type: OSPF_TYPE_HELLO, length: 0, routerId, areaId });
    return new OspfPacket({ header: hdr, body: hello }).pack();
}

/** Return the first neighbor entry from daemon's interface 0, or undefined. */
function firstNeighbor(daemon) {
    return [...(daemon._ifaces.get(0)?.neighbors.values() ?? [])][0];
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe('lifecycle', () => {
    it('computes Router-ID as the highest IPv4 address', () => {
        const stack  = makeStack([{ ip: '10.0.0.3', prefix: 24 }, { ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.setEnabled(true);
        // 10.0.0.3 = 0x0a000003 > 10.0.0.1 = 0x0a000001
        expect(daemon._myRouterId).toBe(0x0a000003);
        daemon.stop();
    });

    it('registers an OSPF protocol handler on start', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.setEnabled(true);
        expect(stack._handlers.has(OSPF_PROTO)).toBe(true);
        daemon.stop();
    });

    it('unregisters the handler on stop', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.setEnabled(true);
        daemon.stop();
        expect(stack._handlers.has(OSPF_PROTO)).toBe(false);
    });

    it('does not start without an IPv4 address', () => {
        const stack = { interfaces: [], registerProtoHandler() {}, unregisterProtoHandler() {} };
        const daemon = new OSPFDaemon(/** @type {any} */ (stack));
        daemon.setEnabled(true);
        expect(daemon._running).toBe(false);
    });
});

// ── Hello transmission ────────────────────────────────────────────────────────

describe('Hello transmission', () => {
    it('sends a Hello on the first tick after start', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.setEnabled(true);
        tick(1);
        const hellos = stack._sent.filter(p => {
            try { return OspfPacket.fromBytes(p.payload).header.type === OSPF_TYPE_HELLO; }
            catch { return false; }
        });
        expect(hellos.length).toBeGreaterThanOrEqual(1);
        daemon.stop();
    });

    it('Hello carries the correct Router-ID and area', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.setEnabled(true);
        tick(1);
        const pkt = OspfPacket.fromBytes(stack._sent[0].payload);
        expect(pkt.header.routerId).toBe(0x0a000001);
        expect(pkt.header.areaId).toBe(0);
        daemon.stop();
    });
});

// ── Neighbor state machine (direct injection) ─────────────────────────────────

describe('neighbor state machine', () => {
    /** @type {ReturnType<typeof makeStack>} */
    let stack;
    /** @type {OSPFDaemon} */
    let daemon;
    const MY_RID  = 0x0a000001;  // 10.0.0.1
    const NBR_RID = 0x0a000002;  // 10.0.0.2

    beforeEach(() => {
        stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        daemon = new OSPFDaemon(stack);
        daemon.setEnabled(true);
        tick(1);  // fire first Hello so iface is active
    });

    afterEach(() => { daemon.stop(); });

    it('creates neighbor in Init after receiving a Hello that does not list us', () => {
        const bytes = makeHelloBytes({ routerId: NBR_RID, neighbors: [] });
        daemon._handleOSPF({ src: IPAddress.fromString('10.0.0.2'), payload: bytes }, 0);
        expect(firstNeighbor(daemon)?.state).toBe('Init');
    });

    it('advances to 2-Way when the Hello lists our Router-ID', () => {
        // First Hello: neighbor doesn't see us yet
        daemon._handleOSPF({ src: IPAddress.fromString('10.0.0.2'), payload: makeHelloBytes({ routerId: NBR_RID, neighbors: [] }) }, 0);
        expect(firstNeighbor(daemon)?.state).toBe('Init');

        // Second Hello: neighbor lists our RID → 2-Way
        daemon._handleOSPF({ src: IPAddress.fromString('10.0.0.2'), payload: makeHelloBytes({ routerId: NBR_RID, neighbors: [MY_RID] }) }, 0);
        expect(firstNeighbor(daemon)?.state).toBe('2-Way');
    });

    it('ignores a Hello with a wrong network mask', () => {
        const hello = new OspfHello({ networkMask: 0xffff0000, helloInterval: 0, deadInterval: 2 });
        const hdr   = new OspfHeader({ type: OSPF_TYPE_HELLO, length: 0, routerId: NBR_RID, areaId: 0 });
        const bytes = new OspfPacket({ header: hdr, body: hello }).pack();
        daemon._handleOSPF({ src: IPAddress.fromString('10.0.0.2'), payload: bytes }, 0);
        expect(firstNeighbor(daemon)).toBeUndefined();
    });

    it('ignores a Hello with a mismatched dead interval', () => {
        const hello = new OspfHello({ networkMask: 0xffffff00, helloInterval: 0, deadInterval: 99 });
        const hdr   = new OspfHeader({ type: OSPF_TYPE_HELLO, length: 0, routerId: NBR_RID, areaId: 0 });
        const bytes = new OspfPacket({ header: hdr, body: hello }).pack();
        daemon._handleOSPF({ src: IPAddress.fromString('10.0.0.2'), payload: bytes }, 0);
        expect(firstNeighbor(daemon)).toBeUndefined();
    });

    it('ignores a Hello with a mismatched area ID', () => {
        const bytes = makeHelloBytes({ routerId: NBR_RID, areaId: 99 });
        daemon._handleOSPF({ src: IPAddress.fromString('10.0.0.2'), payload: bytes }, 0);
        expect(firstNeighbor(daemon)).toBeUndefined();
    });

    it('ignores our own Hello (same Router-ID)', () => {
        const bytes = makeHelloBytes({ routerId: MY_RID });
        daemon._handleOSPF({ src: IPAddress.fromString('10.0.0.1'), payload: bytes }, 0);
        expect(firstNeighbor(daemon)).toBeUndefined();
    });
});

// ── DR/BDR election ───────────────────────────────────────────────────────────

describe('DR/BDR election', () => {
    it('single router declares itself DR after the Wait timer expires', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.setEnabled(true);
        // OSPF_WAIT_MS = 2000 ms → 400 ticks
        tick(SimTimer.toTicks(SimTimer.OSPF_WAIT_MS));
        const oif = daemon._ifaces.get(0);
        expect(oif?.state).toBe('DR');
        expect(oif?.dr).toBe(daemon._myRouterId);
        daemon.stop();
    });
});

// ── Full adjacency (tick-based) ───────────────────────────────────────────────

describe('full adjacency', () => {
    /** @type {ReturnType<typeof makeStack>} */
    let stackA;
    /** @type {ReturnType<typeof makeStack>} */
    let stackB;
    /** @type {OSPFDaemon} */
    let daemonA;
    /** @type {OSPFDaemon} */
    let daemonB;

    beforeEach(() => {
        stackA  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        stackB  = makeStack([{ ip: '10.0.0.2', prefix: 24 }]);
        wirePeers(stackA, stackB);
        daemonA = new OSPFDaemon(stackA);
        daemonB = new OSPFDaemon(stackB);
        daemonA.setEnabled(true);
        daemonB.setEnabled(true);
    });

    afterEach(() => {
        daemonA.stop();
        daemonB.stop();
    });

    it('both neighbors reach Full state within 500 ticks', () => {
        tick(500);
        const nbInA = [...(daemonA._ifaces.get(0)?.neighbors.values() ?? [])][0];
        const nbInB = [...(daemonB._ifaces.get(0)?.neighbors.values() ?? [])][0];
        expect(nbInA?.state).toBe('Full');
        expect(nbInB?.state).toBe('Full');
    });

    it('both routers agree on the elected DR', () => {
        tick(500);
        const oifA = daemonA._ifaces.get(0);
        const oifB = daemonB._ifaces.get(0);
        // Both must agree on the DR, and it must be one of the two routers
        expect(oifA?.dr).not.toBe(0);
        expect(oifA?.dr).toBe(oifB?.dr);
        const rids = new Set([daemonA._myRouterId, daemonB._myRouterId]);
        expect(rids.has(oifA?.dr ?? 0)).toBe(true);
    });

    it('each router has the other\'s Router-LSA in its LSDB after Full', () => {
        tick(500);
        const lsdbA = daemonA._lsdbFor(0);
        const lsdbB = daemonB._lsdbFor(0);
        // A's LSDB should contain B's Router-LSA
        const bLsaKeyInA = `${LSA_TYPE_ROUTER}-${daemonB._myRouterId}-${daemonB._myRouterId}`;
        // B's LSDB should contain A's Router-LSA
        const aLsaKeyInB = `${LSA_TYPE_ROUTER}-${daemonA._myRouterId}-${daemonA._myRouterId}`;
        expect(lsdbA.has(bLsaKeyInA)).toBe(true);
        expect(lsdbB.has(aLsaKeyInB)).toBe(true);
    });

    it('dead timer removes the neighbor after OSPF_DEAD_MS without Hellos', () => {
        tick(500);  // reach Full
        // Stop B so it no longer sends Hellos
        daemonB.stop();
        // Wait for dead timer: OSPF_DEAD_MS = 2000 ms = 400 ticks
        tick(SimTimer.toTicks(SimTimer.OSPF_DEAD_MS) + 5);
        const oifA = daemonA._ifaces.get(0);
        // Neighbor should have been removed (or be in Down state)
        const nbInA = oifA?.neighbors.get(daemonB._myRouterId);
        expect(nbInA == null || nbInA.state === 'Down').toBe(true);
    });
});

// ── SPF route installation ────────────────────────────────────────────────────

describe('SPF route installation', () => {
    it('installs inter-router routes after Full adjacency and SPF delay', () => {
        // A has eth0 (10.0.0.1/24) and eth1 (172.16.0.1/24) — eth1 stub for B to learn.
        // Force A.rid < B.rid via _routerIdOverride so the ExStart master/slave negotiation
        // does not deadlock when both wait timers fire in the same tick.
        const stackA = makeStack([
            { ip: '10.0.0.1', prefix: 24 },
            { ip: '172.16.0.1', prefix: 24 },
        ]);
        const stackB = makeStack([{ ip: '10.0.0.2', prefix: 24 }]);
        wirePeers(stackA, stackB);

        const daemonA = new OSPFDaemon(stackA);
        const daemonB = new OSPFDaemon(stackB);
        // B must have the higher Router-ID so it wins the ExStart master role;
        // otherwise the synchronous mock delivery causes a deadlock.
        daemonA._routerIdOverride = 0x0a000001;  // 10.0.0.1
        daemonB._routerIdOverride = 0x0a000002;  // 10.0.0.2  (> A)
        daemonA.setEnabled(true);
        daemonB.setEnabled(true);

        // Full adjacency + SPF delay (500 + 60 ticks for margin)
        tick(560);

        // B should have a route to 172.16.0.0/24 (A's eth1 stub)
        const hasRoute = stackB._routes.some(r => r.dst === '172.16.0.0' && r.prefix === 24);
        expect(hasRoute).toBe(true);

        daemonA.stop();
        daemonB.stop();
    });
});

// ── Multi-area ────────────────────────────────────────────────────────────────

describe('multi-area', () => {
    it('_isABR() returns false when all interfaces share the same area', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }, { ip: '10.0.1.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.setEnabled(true);
        expect(daemon._isABR()).toBe(false);
        daemon.stop();
    });

    it('_isABR() returns true when interfaces span two areas', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }, { ip: '10.0.1.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.setIfaceArea('eth1', 1);
        daemon.setEnabled(true);
        expect(daemon._isABR()).toBe(true);
        daemon.stop();
    });

    it('setIfaceArea persists in _ifaceAreaMap', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.setIfaceArea('eth0', 2);
        expect(daemon._ifaceAreaMap.get('eth0')).toBe(2);
        daemon.stop();
    });

    it('interface area assignment is used when daemon starts', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.setIfaceArea('eth0', 5);
        daemon.setEnabled(true);
        expect(daemon._ifaces.get(0)?.areaId).toBe(5);
        daemon.stop();
    });
});

// ── LSDB helpers ─────────────────────────────────────────────────────────────

describe('LSDB helpers', () => {
    it('_lsdbFor() creates and reuses the area LSDB map', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        const lsdb1  = daemon._lsdbFor(0);
        const lsdb2  = daemon._lsdbFor(0);
        expect(lsdb1).toBe(lsdb2);          // same object
        const lsdbOther = daemon._lsdbFor(1);
        expect(lsdbOther).not.toBe(lsdb1);  // separate map for area 1
    });
});

// ── Persistence ───────────────────────────────────────────────────────────────

describe('persistence', () => {
    it('toJSON / applyJSON round-trips enabled, passive, routerIdOverride, interfaceAreas', () => {
        const stack1  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon1 = new OSPFDaemon(stack1);
        daemon1.setPassive('eth0', true);
        daemon1.setIfaceArea('eth0', 3);
        daemon1._routerIdOverride = 0x01020304;
        daemon1.enabled = true;

        const json = daemon1.toJSON();

        const stack2  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon2 = new OSPFDaemon(stack2);
        daemon2.applyJSON(json);

        expect(daemon2.enabled).toBe(true);
        expect(daemon2.passiveInterfaces.has('eth0')).toBe(true);
        expect(daemon2._ifaceAreaMap.get('eth0')).toBe(3);
        expect(daemon2._routerIdOverride).toBe(0x01020304);

        daemon1.stop();
        daemon2.stop();
    });

    it('applyJSON starts the daemon when enabled is true', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.applyJSON({ enabled: true, passive: [], routerIdOverride: null });
        expect(daemon._running).toBe(true);
        daemon.stop();
    });

    it('applyJSON does not start when enabled is false', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new OSPFDaemon(stack);
        daemon.applyJSON({ enabled: false, passive: [], routerIdOverride: null });
        expect(daemon._running).toBe(false);
    });
});
