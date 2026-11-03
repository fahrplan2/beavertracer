//@ts-check
// Layer-2 control-plane conformance:
//  - LLDP (802.1AB §7.1) / LACP (802.1AX §6.2) are processed independently of the STP port state
//  - classic STP topology change (802.1D-1998 §8.6.14): TCN towards the root, only the root
//    sets TC, every bridge relays the root port's TC flag and fast-ages its MAC table
//  - worse info from the same designated bridge/port replaces stored info at once
//    (802.1D-1998 §8.6.2.2 / 802.1D-2004 §17.21.8) instead of waiting for Max Age
import { vi, describe, it, expect, afterEach } from 'vitest';

// Break the EthernetLink → SimControl import chain (see SwitchBackplane.rstp.test.js)
vi.mock('../../src/net/EthernetLink.js', () => ({ EthernetLink: class EthernetLink {} }));

import { SwitchBackplane, STP_STATE } from '../../src/net/SwitchBackplane.js';
import { EthernetPort } from '../../src/net/EthernetPort.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';
import { STPBPDU, RSTP_PORT_ROLE, RSTP_FLAG_LEARNING, RSTP_FLAG_FORWARDING } from '../../src/net/pdu/STPBPDU.js';
import { LLDPDaemon } from '../../src/net/LLDPDaemon.js';
import { simTimer, SimTimer } from '../../src/lib/SimTimer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @type {SwitchBackplane[]} */
let _backplanes = [];
/** @type {Array<{destroy():void}>} */
let _wires = [];

afterEach(() => {
    for (const bp of _backplanes) { bp.disableSTPFeature(); bp.disableLLDP(); }
    for (const w of _wires) w.destroy();
    _backplanes = [];
    _wires = [];
});

const HELLO_TICKS = SimTimer.toTicks(SimTimer.STP_HELLO_MS);
const FWD_TICKS   = SimTimer.toTicks(SimTimer.STP_FORWARD_DELAY_MS);
const MAXAGE_TICKS = SimTimer.toTicks(SimTimer.STP_MAX_AGE_MS);

/**
 * @param {bigint} id
 * @param {'off'|'stp'|'rstp'} mode
 * @param {number} [priority]
 */
function makeSwitch(id, mode, priority = 32768) {
    const bp = new SwitchBackplane(4);
    bp.setBridgeId(id);
    bp.setBridgePriority(priority);
    if (mode === 'stp') bp.enableSTPFeature();
    if (mode === 'rstp') bp.enableRSTPFeature();
    _backplanes.push(bp);
    return bp;
}

/** @param {EthernetPort} a @param {EthernetPort} b */
function wire(a, b) {
    const sentinel = {};
    a.link(/** @type {any} */ (sentinel));
    b.link(/** @type {any} */ (sentinel));
    let up = true;
    const w = {
        transfer() {
            if (!up) return;
            let pkt;
            while ((pkt = a.getNextOutgoingFrame()) != null) b.recieve(pkt);
            while ((pkt = b.getNextOutgoingFrame()) != null) a.recieve(pkt);
        },
        destroy() { if (up) { up = false; a.unlink(); b.unlink(); } },
    };
    _wires.push(w);
    return w;
}

/** @param {number} n @param {SwitchBackplane[]} sws @param {Array<{transfer():void}>} wires */
function tick(n, sws, wires) {
    for (let i = 0; i < n; i++) {
        simTimer.tick();
        for (const w of wires) w.transfer();
        for (const sw of sws) sw.update();
    }
}

/**
 * Inject a raw BPDU on a switch port.
 * @param {SwitchBackplane} sw
 * @param {number} port
 * @param {{rootId: Uint8Array, cost: number, bridgeId: Uint8Array, portId: number, rstp?: boolean, flags?: number}} o
 */
function injectBpdu(sw, port, o) {
    const bpdu = new STPBPDU({
        protocolId: 0,
        protocolVersion: o.rstp ? 2 : 0,
        bpduType: o.rstp ? 0x02 : 0x00,
        flags: o.flags ?? (o.rstp ? (RSTP_PORT_ROLE.DESIGNATED << 2) | RSTP_FLAG_LEARNING | RSTP_FLAG_FORWARDING : 0),
        rootId: o.rootId,
        rootPathCost: o.cost,
        bridgeId: o.bridgeId,
        portId: o.portId,
        messageAge: 0,
        maxAge: 20 * 256,
        helloTime: 2 * 256,
        forwardDelay: 15 * 256,
    }).pack();
    const payload = new Uint8Array(3 + bpdu.length);
    payload.set([0x42, 0x42, 0x03], 0);
    payload.set(bpdu, 3);
    const f = new EthernetFrame({
        dstMac: new Uint8Array([0x01, 0x80, 0xc2, 0, 0, 0]),
        srcMac: new Uint8Array([0x02, 0, 0, 0, 0, 0x77]),
        etherType: 0,
        payload,
    });
    f.useLengthField = true;
    f.length = payload.length;
    sw.ports[port].recieve(f.pack());
    sw.update();
}

/** 8-byte bridge id from priority + low MAC byte. @param {number} prio @param {number} last */
function bid(prio, last) {
    return new Uint8Array([(prio >> 8) & 0xff, prio & 0xff, 0x02, 0, 0, 0, 0, last]);
}

/** Seed an (old) MAC table entry on port p. @param {SwitchBackplane} sw @param {number} p */
function seedSat(sw, p) {
    sw.sat.set(0xdeadbeefn, p);
}

// ── LLDP / LACP vs. STP port state ───────────────────────────────────────────

describe('LLDP / LACP are independent of the STP port state', () => {
    for (const mode of /** @type {const} */ (['stp', 'rstp'])) {
        it(`${mode}: LLDP neighbour on a blocked ring port stays visible`, () => {
            const sws = [1n, 2n, 3n].map(id => makeSwitch(id, mode));
            const wires = sws.map((sw, k) => wire(sw.ports[0], sws[(k + 1) % 3].ports[1]));
            tick(4 * FWD_TICKS + 2 * HELLO_TICKS, sws, wires);

            const blocked = [];
            for (const sw of sws) for (const p of [0, 1]) {
                if (sw.stpPortState[p] !== STP_STATE.FORWARDING) blocked.push({ sw, p });
            }
            expect(blocked.length).toBe(1);

            for (const sw of sws) sw.enableLLDP();
            tick(5, sws, wires);
            const { sw, p } = blocked[0];
            expect(sw.stpPortState[p]).not.toBe(STP_STATE.FORWARDING);
            expect(sw.lldpNeighbors.has(p)).toBe(true);
            // all ring ports know their neighbour
            for (const s of sws) expect(s.lldpNeighbors.size).toBe(2);
        });
    }

    it('LLDP frame received on a Blocking port is processed and not forwarded', () => {
        const sw = makeSwitch(1n, 'stp');
        sw.enableLLDP();
        tick(1, [sw], []);
        expect(sw.stpPortState[0]).toBe(STP_STATE.BLOCKING);
        for (const p of sw.ports) p.outBuffer = [];

        const payload = LLDPDaemon.encode(new Uint8Array([2, 0, 0, 0, 0, 9]), 'eth0', 'peer');
        const f = new EthernetFrame({ dstMac: LLDPDaemon.DEST_MAC, srcMac: new Uint8Array([2, 0, 0, 0, 0, 9]), etherType: LLDPDaemon.ETHERTYPE, payload });
        sw.ports[0].recieve(f.pack());
        sw.update();

        expect(sw.lldpNeighbors.get(0)?.systemName).toBe('peer');
        for (const p of sw.ports) expect(p.outBuffer.length).toBe(0);
    });

    it('LACP partner on a Discarding (RSTP) port is learned', () => {
        const sw = makeSwitch(1n, 'rstp');
        tick(1, [sw], []);
        expect(sw.stpPortState[2]).toBe(STP_STATE.DISCARDING);

        const peerMac = new Uint8Array([2, 0, 0, 0, 0, 0x42]);
        const payload = sw._encodeLACPDU(peerMac, 7, 0, null);
        const f = new EthernetFrame({ dstMac: SwitchBackplane.LACP_DEST_MAC, srcMac: peerMac, etherType: SwitchBackplane.LACP_ETHERTYPE, payload });
        sw.ports[2].recieve(f.pack());
        sw.update();

        expect(sw.lacpPartners.get(2)?.key).toBe(7);
        expect(sw.lacpPartners.get(2)?.sysId).toBe('02:00:00:00:00:42');
    });
});

// ── Classic STP topology change ──────────────────────────────────────────────

describe('STP – topology change: TCN to root, only root sets TC, relayed downstream', () => {
    /** Chain Root – A – B (Root.p0 ↔ A.p1, A.p0 ↔ B.p1), converged and TC-quiet. */
    function chain() {
        const root = makeSwitch(1n, 'stp', 4096);
        const a = makeSwitch(2n, 'stp');
        const b = makeSwitch(3n, 'stp');
        const sws = [root, a, b];
        const wires = [wire(root.ports[0], a.ports[1]), wire(a.ports[0], b.ports[1])];
        // converge + let all TC timers (MaxAge + ForwardDelay) run out
        tick(4 * FWD_TICKS + MAXAGE_TICKS + 4 * HELLO_TICKS, sws, wires);
        expect(b.stpRootId).toBe(root.stpBridgeIdVal);
        expect(b.stpRootCost).toBe(2);
        for (const sw of sws) expect(sw._stpTcActive).toBe(false);
        return { root, a, b, sws, wires };
    }

    it('change detected at B: B sends TCN, does not set TC itself; root sets TC, B gets it via A', () => {
        const { root, a, b, sws, wires } = chain();

        // new link on B → port goes Listening → Learning → Forwarding = topology change
        const host = new EthernetPort('host');
        wires.push(wire(b.ports[2], host));
        let n = 0;
        while (b.stpPortState[2] !== STP_STATE.FORWARDING && n++ < 4 * FWD_TICKS) {
            simTimer.tick();
            for (const sw of sws) sw.update();   // no transfer yet: look at B in isolation
            for (const w of wires) w.transfer();
            host.outBuffer = [];
        }
        expect(b.stpPortState[2]).toBe(STP_STATE.FORWARDING);
        expect(b._stpTcActive).toBe(false);      // non-root bridge must not set TC
        expect(b._stpTcnPending).toBe(true);     // … it reports the change with TCN

        // stale entry that fast aging must remove once TC comes back from the root
        seedSat(b, 1);

        tick(5, sws, wires);
        expect(root._stpTcActive).toBe(true);    // TCN relayed by A reached the root
        expect(b._stpTcnPending).toBe(false);    // A acknowledged with TCA

        tick(2 * HELLO_TICKS + 5, sws, wires);
        expect(a._stpTcActive).toBe(true);
        expect(b._stpTcActive).toBe(true);
        expect(b.sat.has(0xdeadbeefn)).toBe(false);
    });

    it('TC set by the root reaches a bridge two hops away and ends with the root\'s TC', () => {
        const { root, a, b, sws, wires } = chain();
        root._stpTriggerTc();
        seedSat(b, 1);

        tick(2 * HELLO_TICKS + 5, sws, wires);
        expect(a._stpTcActive).toBe(true);
        expect(b._stpTcActive).toBe(true);
        expect(b.sat.has(0xdeadbeefn)).toBe(false);

        // the root's TC lasts MaxAge + ForwardDelay; afterwards everybody clears it
        tick(MAXAGE_TICKS + FWD_TICKS + 3 * HELLO_TICKS, sws, wires);
        for (const sw of sws) expect(sw._stpTcActive).toBe(false);
    });

    it('fast aging (aging time = ForwardDelay) drops old entries but keeps fresh ones', () => {
        const { b, sws, wires } = chain();
        seedSat(b, 1); // no learn time → old
        const f = new EthernetFrame({ dstMac: new Uint8Array(6).fill(0xff), srcMac: new Uint8Array([2, 0, 0, 0, 0, 0x55]), etherType: 0x0800, payload: new Uint8Array(46) });
        b.ports[1].recieve(f.pack());
        b.update();
        tick(2, sws, wires);
        b._satFastAge();
        expect(b.sat.has(0xdeadbeefn)).toBe(false);
        expect(b.sat.size).toBe(1);
        tick(FWD_TICKS + 2, sws, wires);
        b._satFastAge();
        expect(b.sat.size).toBe(0);
    });
});

// ── Worse info from the same designated sender ───────────────────────────────

describe('worse BPDU from the same designated bridge replaces stored info immediately', () => {
    /** Switch whose port 0 is linked to a passive peer. @param {'stp'|'rstp'} mode */
    function linkedSwitch(mode) {
        const sw = makeSwitch(3n, mode);
        wire(sw.ports[0], new EthernetPort('peer'));
        sw.update();
        return sw;
    }

    for (const mode of /** @type {const} */ (['stp', 'rstp'])) {
        const rstp = mode === 'rstp';

        it(`${mode}: upstream loses the root → new root claim accepted without Max Age`, () => {
            const sw = linkedSwitch(mode);
            const R = bid(4096, 1), A = bid(32768, 2);
            injectBpdu(sw, 0, { rootId: R, cost: 1, bridgeId: A, portId: 0x8001, rstp });
            expect(sw.stpRootPort).toBe(0);
            expect(sw.stpRootCost).toBe(2);

            // A lost its root and now claims to be root itself (worse info, same sender)
            injectBpdu(sw, 0, { rootId: A, cost: 0, bridgeId: A, portId: 0x8001, rstp });
            expect(sw._bigIntTo8Bytes(sw.stpRootId)).toEqual(A);
            expect(sw.stpRootCost).toBe(1);
        });

        it(`${mode}: upstream root path cost rises → own cost follows at once`, () => {
            const sw = linkedSwitch(mode);
            const R = bid(4096, 1), A = bid(32768, 2);
            injectBpdu(sw, 0, { rootId: R, cost: 1, bridgeId: A, portId: 0x8001, rstp });
            injectBpdu(sw, 0, { rootId: R, cost: 5, bridgeId: A, portId: 0x8001, rstp });
            expect(sw.stpRootCost).toBe(6);
            expect(sw.stpRxBest[0]?.cost).toBe(5);
        });

        it(`${mode}: worse info from a DIFFERENT sender is still ignored`, () => {
            const sw = linkedSwitch(mode);
            const R = bid(4096, 1), A = bid(32768, 2), C = bid(32768, 9);
            injectBpdu(sw, 0, { rootId: R, cost: 1, bridgeId: A, portId: 0x8001, rstp });
            injectBpdu(sw, 0, { rootId: R, cost: 4, bridgeId: C, portId: 0x8001, rstp });
            expect(sw.stpRxBest[0]?.bridgeId).toBe(sw._bridgeIdBytesToBigInt(A));
            expect(sw.stpRootCost).toBe(2);
        });

        it(`${mode}: chain Root–A–B, link Root–A fails → B follows A within a few ticks`, () => {
            const root = makeSwitch(1n, mode, 4096);
            const a = makeSwitch(2n, mode);
            const b = makeSwitch(3n, mode, 36864);
            const sws = [root, a, b];
            const wRA = wire(root.ports[0], a.ports[1]);
            const wAB = wire(a.ports[0], b.ports[1]);
            tick(4 * FWD_TICKS + 2 * HELLO_TICKS, sws, [wRA, wAB]);
            expect(b.stpRootId).toBe(root.stpBridgeIdVal);

            wRA.destroy();
            tick(5, sws, [wAB]);
            expect(a.stpRootId).toBe(a.stpBridgeIdVal);
            expect(b.stpRootId).toBe(a.stpBridgeIdVal);
            expect(b.stpRootCost).toBe(1);
        });
    }
});
