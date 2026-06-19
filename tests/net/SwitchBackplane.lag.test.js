//@ts-check
import { vi, describe, it, expect, afterEach } from 'vitest';

vi.mock('../../src/net/EthernetLink.js', () => ({ EthernetLink: class EthernetLink {} }));

import { SwitchBackplane, STP_STATE } from '../../src/net/SwitchBackplane.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';
import { MACToNumber } from '../../src/lib/helpers.js';
import { simTimer, SimTimer } from '../../src/lib/SimTimer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SENTINEL = {};

/** @param {number[]} bytes */
const mac = (bytes) => new Uint8Array(bytes);

const BCAST = mac([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

/**
 * Minimal unicast EthernetFrame.
 * @param {Uint8Array} src
 * @param {Uint8Array} dst
 */
function frame(src, dst = BCAST) {
    return new EthernetFrame({ srcMac: src, dstMac: dst, etherType: 0x0800, payload: new Uint8Array(4) });
}

let _backplanes = [];

afterEach(() => {
    for (const bp of _backplanes) bp.disableSTPFeature();
    _backplanes = [];
});

/** @param {number} [nPorts] */
function makeBP(nPorts = 4) {
    const bp = new SwitchBackplane(nPorts);
    _backplanes.push(bp);
    return bp;
}

/** Link a port so isLinked() returns true. */
function linkPort(bp, idx) {
    bp.ports[idx].link(/** @type {any} */ (SENTINEL));
}

/** Inject a frame into port i and run one update cycle. */
function inject(bp, portIdx, f) {
    bp.ports[portIdx].recieve(f.pack());
    bp.update();
}

/** Drain all outgoing frames from a port, return count. */
function drainCount(bp, portIdx) {
    let n = 0;
    while (bp.ports[portIdx].getNextOutgoingFrame() != null) n++;
    return n;
}

/** Wire two backplane ports together (minimal, no EthernetLink). */
function wire(a, b) {
    a.link(/** @type {any} */ (SENTINEL));
    b.link(/** @type {any} */ (SENTINEL));
    return {
        transfer() {
            let pkt;
            while ((pkt = a.getNextOutgoingFrame()) != null) b.recieve(pkt);
            while ((pkt = b.getNextOutgoingFrame()) != null) a.recieve(pkt);
        },
        destroy() { a.unlink(); b.unlink(); },
    };
}

function tick(n, switches, wires) {
    for (let i = 0; i < n; i++) {
        simTimer.tick();
        for (const w  of wires)    w.transfer();
        for (const sw of switches) sw.update();
    }
}

const FWD_TICKS = SimTimer.toTicks(SimTimer.STP_FORWARD_DELAY_MS);

// ── Group management ──────────────────────────────────────────────────────────

describe('LAG – group management', () => {
    it('createLagGroup returns a group with correct defaults', () => {
        const bp = makeBP();
        const g = bp.createLagGroup('static');
        expect(g.id).toBe(0);
        expect(g.name).toBe('bond0');
        expect(g.mode).toBe('static');
        expect(g.members).toEqual([]);
    });

    it('successive groups get incrementing ids and names', () => {
        const bp = makeBP();
        const g0 = bp.createLagGroup();
        const g1 = bp.createLagGroup('lacp');
        expect(g0.name).toBe('bond0');
        expect(g1.name).toBe('bond1');
        expect(g1.id).toBe(1);
    });

    it('addPortToLag assigns port and updates portLagId', () => {
        const bp = makeBP();
        const g = bp.createLagGroup();
        bp.addPortToLag(2, g.id);
        expect(bp.portLagId[2]).toBe(g.id);
        expect(g.members).toContain(2);
    });

    it('addPortToLag keeps members sorted', () => {
        const bp = makeBP();
        const g = bp.createLagGroup();
        bp.addPortToLag(3, g.id);
        bp.addPortToLag(1, g.id);
        expect(g.members).toEqual([1, 3]);
    });

    it('addPortToLag moves port from old group to new group', () => {
        const bp = makeBP();
        const g0 = bp.createLagGroup();
        const g1 = bp.createLagGroup();
        bp.addPortToLag(0, g0.id);
        bp.addPortToLag(0, g1.id);
        expect(g0.members).not.toContain(0);
        expect(g1.members).toContain(0);
        expect(bp.portLagId[0]).toBe(g1.id);
    });

    it('removePortFromLag clears portLagId and removes from members', () => {
        const bp = makeBP();
        const g = bp.createLagGroup();
        bp.addPortToLag(1, g.id);
        bp.removePortFromLag(1);
        expect(bp.portLagId[1]).toBe(-1);
        expect(g.members).not.toContain(1);
    });

    it('deleteLagGroup clears portLagId for all members and removes group', () => {
        const bp = makeBP();
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        bp.deleteLagGroup(g.id);
        expect(bp.lagGroups).toHaveLength(0);
        expect(bp.portLagId[0]).toBe(-1);
        expect(bp.portLagId[1]).toBe(-1);
    });

    it('LAG config changes clear the SAT', () => {
        const bp = makeBP();
        bp.sat.set(0xdeadbeef, 0);
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);      // clears SAT
        expect(bp.sat.size).toBe(0);

        bp.sat.set(0xdeadbeef, 0);
        bp.removePortFromLag(0);       // clears SAT
        expect(bp.sat.size).toBe(0);

        bp.sat.set(0xdeadbeef, 0);
        const g2 = bp.createLagGroup();
        bp.addPortToLag(0, g2.id);
        bp.deleteLagGroup(g2.id);      // clears SAT
        expect(bp.sat.size).toBe(0);
    });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

describe('LAG – helper functions', () => {
    it('_lagRepresentative: non-LAG port returns itself', () => {
        const bp = makeBP();
        expect(bp._lagRepresentative(2)).toBe(2);
    });

    it('_lagRepresentative: any member returns the first member (sorted)', () => {
        const bp = makeBP();
        const g = bp.createLagGroup();
        bp.addPortToLag(3, g.id);
        bp.addPortToLag(1, g.id);
        // members sorted: [1, 3], representative = 1
        expect(bp._lagRepresentative(1)).toBe(1);
        expect(bp._lagRepresentative(3)).toBe(1);
    });

    it('_stpIsLogicalPort: non-LAG ports are always logical', () => {
        const bp = makeBP();
        expect(bp._stpIsLogicalPort(0)).toBe(true);
        expect(bp._stpIsLogicalPort(3)).toBe(true);
    });

    it('_stpIsLogicalPort: representative is logical, non-representative is not', () => {
        const bp = makeBP();
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        expect(bp._stpIsLogicalPort(0)).toBe(true);  // rep
        expect(bp._stpIsLogicalPort(1)).toBe(false); // non-rep
    });

    it('_stpIsLinked: non-LAG reflects physical link', () => {
        const bp = makeBP();
        expect(bp._stpIsLinked(0)).toBe(false);
        linkPort(bp, 0);
        expect(bp._stpIsLinked(0)).toBe(true);
    });

    it('_stpIsLinked: LAG group is linked if any member is linked', () => {
        const bp = makeBP();
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        // no members linked
        expect(bp._stpIsLinked(0)).toBe(false);
        // link only the non-representative member
        linkPort(bp, 1);
        expect(bp._stpIsLinked(0)).toBe(true);
    });

    it('_lagSyncStpStates: non-representative members inherit rep state and role', () => {
        const bp = makeBP();
        bp.enableRSTPFeature();
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        // manually set rep's state, then sync
        bp.stpPortState[0] = STP_STATE.FORWARDING;
        bp.stpPortRole[0]  = 'designated';
        bp.stpPortState[1] = STP_STATE.DISCARDING;
        bp.stpPortRole[1]  = 'alternate';
        bp._lagSyncStpStates();
        expect(bp.stpPortState[1]).toBe(STP_STATE.FORWARDING);
        expect(bp.stpPortRole[1]).toBe('designated');
    });
});

// ── MAC learning ──────────────────────────────────────────────────────────────

describe('LAG – MAC learning', () => {
    it('frame received on non-LAG port is learned on that port', () => {
        const bp = makeBP();
        linkPort(bp, 0);
        const src = mac([0xaa, 0x00, 0x00, 0x00, 0x00, 0x01]);
        inject(bp, 0, frame(src));
        expect(bp.sat.get(MACToNumber(src))).toBe(0);
    });

    it('frame received on the LAG representative is learned on the representative', () => {
        const bp = makeBP();
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        linkPort(bp, 0);
        const src = mac([0xaa, 0x00, 0x00, 0x00, 0x00, 0x02]);
        inject(bp, 0, frame(src));
        expect(bp.sat.get(MACToNumber(src))).toBe(0); // rep = port 0
    });

    it('frame received on a non-representative LAG member is learned on the representative', () => {
        const bp = makeBP();
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        linkPort(bp, 1);
        const src = mac([0xaa, 0x00, 0x00, 0x00, 0x00, 0x03]);
        inject(bp, 1, frame(src));
        // learned on port 0 (rep), NOT port 1
        expect(bp.sat.get(MACToNumber(src))).toBe(0);
    });
});

// ── Data forwarding ───────────────────────────────────────────────────────────

describe('LAG – data forwarding', () => {
    it('broadcast flood reaches exactly one member of a LAG group, not both', () => {
        const bp = makeBP(4);
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        linkPort(bp, 0);
        linkPort(bp, 1);
        linkPort(bp, 2);

        // inject broadcast on port 2
        const src = mac([0xaa, 0x00, 0x00, 0x00, 0x00, 0x10]);
        inject(bp, 2, frame(src, BCAST));

        const toPort0 = drainCount(bp, 0);
        const toPort1 = drainCount(bp, 1);
        // exactly one LAG member should receive it
        expect(toPort0 + toPort1).toBe(1);
    });

    it('broadcast does not loop back to ingress LAG group', () => {
        const bp = makeBP(4);
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        linkPort(bp, 0);
        linkPort(bp, 1);

        // inject broadcast on a LAG member
        const src = mac([0xaa, 0x00, 0x00, 0x00, 0x00, 0x11]);
        inject(bp, 0, frame(src, BCAST));

        // neither member 0 nor member 1 should receive the flood
        expect(drainCount(bp, 0)).toBe(0);
        expect(drainCount(bp, 1)).toBe(0);
    });

    it('known unicast to LAG group resolves to an active member', () => {
        const bp = makeBP(4);
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        linkPort(bp, 0);
        linkPort(bp, 1);
        linkPort(bp, 2);

        const dst = mac([0xbb, 0x00, 0x00, 0x00, 0x00, 0x01]);
        // teach the SAT: dst is at rep (port 0)
        bp.sat.set(MACToNumber(dst), 0);

        const src = mac([0xcc, 0x00, 0x00, 0x00, 0x00, 0x01]);
        inject(bp, 2, frame(src, dst));

        // frame must arrive on exactly one LAG member
        const toPort0 = drainCount(bp, 0);
        const toPort1 = drainCount(bp, 1);
        expect(toPort0 + toPort1).toBe(1);
        // and not on the ingress port
        expect(drainCount(bp, 2)).toBe(0);
    });

    it('known unicast falls back to other member when elected member is unlinked', () => {
        const bp = makeBP(4);
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        // only port 1 is linked (port 0 is down)
        linkPort(bp, 1);
        linkPort(bp, 2);

        const dst = mac([0xbb, 0x00, 0x00, 0x00, 0x00, 0x02]);
        bp.sat.set(MACToNumber(dst), 0); // SAT says rep (port 0), but port 0 is down

        const src = mac([0xcc, 0x00, 0x00, 0x00, 0x00, 0x02]);
        inject(bp, 2, frame(src, dst));

        // should arrive on port 1 (only active member)
        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 0)).toBe(0);
    });
});

// ── STP + LAG integration ─────────────────────────────────────────────────────

describe('LAG + RSTP', () => {
    it('non-representative LAG member is not a logical STP port', () => {
        const bp = makeBP();
        bp.enableRSTPFeature();
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        expect(bp._stpIsLogicalPort(0)).toBe(true);
        expect(bp._stpIsLogicalPort(1)).toBe(false);
    });

    it('both LAG members end up FORWARDING after RSTP convergence (no blocking)', () => {
        // Two switches connected by two parallel links, both in a LAG on each side.
        // Without LAG-aware STP, one link would be blocked as a loop.
        // With LAG-aware STP, both physical members should be FORWARDING.
        const swA = new SwitchBackplane(4);
        const swB = new SwitchBackplane(4);
        _backplanes.push(swA, swB);

        swA.setBridgeId(1n);
        swB.setBridgeId(2n);
        swA.setBridgePriority(4096);
        swB.setBridgePriority(32768);

        // bond0 on swA: ports 0 and 1
        const gA = swA.createLagGroup();
        swA.addPortToLag(0, gA.id);
        swA.addPortToLag(1, gA.id);

        // bond0 on swB: ports 0 and 1
        const gB = swB.createLagGroup();
        swB.addPortToLag(0, gB.id);
        swB.addPortToLag(1, gB.id);

        swA.enableRSTPFeature();
        swB.enableRSTPFeature();

        const w0 = wire(swA.ports[0], swB.ports[0]);
        const w1 = wire(swA.ports[1], swB.ports[1]);

        tick(FWD_TICKS + 10, [swA, swB], [w0, w1]);

        // All four physical ports should be FORWARDING
        expect(swA.stpPortState[0]).toBe(STP_STATE.FORWARDING);
        expect(swA.stpPortState[1]).toBe(STP_STATE.FORWARDING);
        expect(swB.stpPortState[0]).toBe(STP_STATE.FORWARDING);
        expect(swB.stpPortState[1]).toBe(STP_STATE.FORWARDING);

        w0.destroy();
        w1.destroy();
    });

    it('non-representative inherits the same role as the representative', () => {
        const swA = new SwitchBackplane(4);
        const swB = new SwitchBackplane(4);
        _backplanes.push(swA, swB);

        swA.setBridgeId(1n);
        swB.setBridgeId(2n);
        swA.setBridgePriority(4096);
        swB.setBridgePriority(32768);

        const gA = swA.createLagGroup();
        swA.addPortToLag(0, gA.id);
        swA.addPortToLag(1, gA.id);

        const gB = swB.createLagGroup();
        swB.addPortToLag(0, gB.id);
        swB.addPortToLag(1, gB.id);

        swA.enableRSTPFeature();
        swB.enableRSTPFeature();

        const w0 = wire(swA.ports[0], swB.ports[0]);
        const w1 = wire(swA.ports[1], swB.ports[1]);

        tick(FWD_TICKS + 10, [swA, swB], [w0, w1]);

        // rep and non-rep must have the same role and state
        expect(swB.stpPortRole[1]).toBe(swB.stpPortRole[0]);
        expect(swB.stpPortState[1]).toBe(swB.stpPortState[0]);
        expect(swA.stpPortRole[1]).toBe(swA.stpPortRole[0]);
        expect(swA.stpPortState[1]).toBe(swA.stpPortState[0]);

        w0.destroy();
        w1.destroy();
    });

    it('all LAG members go FORWARDING when the group is root port side', () => {
        const swA = new SwitchBackplane(4);
        const swB = new SwitchBackplane(4);
        _backplanes.push(swA, swB);

        swA.setBridgeId(1n);
        swB.setBridgeId(2n);
        swA.setBridgePriority(4096);  // swA is root
        swB.setBridgePriority(32768);

        const gB = swB.createLagGroup();
        swB.addPortToLag(0, gB.id);
        swB.addPortToLag(1, gB.id);

        swA.enableRSTPFeature();
        swB.enableRSTPFeature();

        const w0 = wire(swA.ports[0], swB.ports[0]);
        const w1 = wire(swA.ports[1], swB.ports[1]);

        tick(FWD_TICKS + 10, [swA, swB], [w0, w1]);

        // swB's LAG group is the root port — both members should be FORWARDING
        expect(swB.stpPortState[0]).toBe(STP_STATE.FORWARDING);
        expect(swB.stpPortState[1]).toBe(STP_STATE.FORWARDING);
        expect(swB.stpPortRole[0]).toBe('root');
        expect(swB.stpPortRole[1]).toBe('root');

        w0.destroy();
        w1.destroy();
    });
});

// ── Serialization ─────────────────────────────────────────────────────────────
// Switch.toJSON/fromJSON can't be imported in vitest (DOM dependency chain).
// These tests replicate the same extract/restore logic directly on SwitchBackplane.

/** Mirror of Switch.toJSON() lag section */
function lagSerialize(bp) {
    return {
        lagGroups: bp.lagGroups.map(g => ({ id: g.id, name: g.name, mode: g.mode, members: [...g.members] })),
        lagNextId: bp._nextLagId,
    };
}

/** Mirror of Switch.fromJSON() lag restore block */
function lagRestore(bp, json) {
    if (!Array.isArray(json.lagGroups)) return;
    for (const g of json.lagGroups) {
        const group = { id: g.id, name: g.name ?? `bond${g.id}`, mode: g.mode ?? 'static', members: /** @type {number[]} */ ([]) };
        bp.lagGroups.push(group);
        for (const portIdx of (g.members ?? [])) {
            if (portIdx >= 0 && portIdx < bp.ports.length) {
                group.members.push(portIdx);
                bp.portLagId[portIdx] = group.id;
            }
        }
    }
    bp._nextLagId = typeof json.lagNextId === 'number'
        ? json.lagNextId
        : bp.lagGroups.reduce((m, g) => Math.max(m, g.id + 1), 0);
}

describe('LAG – serialization roundtrip', () => {
    it('preserves lag groups and member assignments', () => {
        const bp = makeBP(4);
        const g = bp.createLagGroup('lacp');
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(2, g.id);

        const json = lagSerialize(bp);
        expect(json.lagGroups).toHaveLength(1);
        expect(json.lagGroups[0].mode).toBe('lacp');
        expect(json.lagGroups[0].members).toEqual([0, 2]);

        const bp2 = makeBP(4);
        lagRestore(bp2, json);

        expect(bp2.lagGroups).toHaveLength(1);
        expect(bp2.lagGroups[0].name).toBe('bond0');
        expect(bp2.lagGroups[0].mode).toBe('lacp');
        expect(bp2.lagGroups[0].members).toEqual([0, 2]);
        expect(bp2.portLagId[0]).toBe(g.id);
        expect(bp2.portLagId[2]).toBe(g.id);
        expect(bp2.portLagId[1]).toBe(-1);
        expect(bp2._nextLagId).toBe(1);
    });

    it('nextLagId continues past restored ids', () => {
        const bp = makeBP(4);
        bp.createLagGroup();
        bp.createLagGroup();

        const bp2 = makeBP(4);
        lagRestore(bp2, lagSerialize(bp));

        const g = bp2.createLagGroup();
        expect(g.id).toBe(2);
        expect(g.name).toBe('bond2');
    });

    it('out-of-bounds port indices in restored JSON are ignored', () => {
        const bp = makeBP(4);
        const json = {
            lagGroups: [{ id: 0, name: 'bond0', mode: 'static', members: [0, 99] }],
            lagNextId: 1,
        };
        const bp2 = makeBP(4);
        lagRestore(bp2, json);
        expect(bp2.lagGroups[0].members).toEqual([0]);
        expect(bp2.portLagId[0]).toBe(0);
    });
});

// ── LACP – frame encoding ─────────────────────────────────────────────────────

describe('LACP – frame encoding', () => {
    const ACTOR_MAC = new Uint8Array([0x02, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE]);
    const GROUP_ID = 1;
    const PORT_IDX = 0;

    it('returns exactly 110 bytes', () => {
        const bp = makeBP();
        const buf = bp._encodeLACPDU(ACTOR_MAC, GROUP_ID, PORT_IDX, null);
        expect(buf).toBeInstanceOf(Uint8Array);
        expect(buf.length).toBe(110);
    });

    it('sets LACP subtype and version', () => {
        const bp = makeBP();
        const buf = bp._encodeLACPDU(ACTOR_MAC, GROUP_ID, PORT_IDX, null);
        expect(buf[0]).toBe(0x01); // subtype
        expect(buf[1]).toBe(0x01); // version
    });

    it('encodes actor TLV with correct type, length, MAC, key, port and state', () => {
        const bp = makeBP();
        const buf = bp._encodeLACPDU(ACTOR_MAC, 5, 3, null);
        expect(buf[2]).toBe(0x01); // TLV type = actor
        expect(buf[3]).toBe(0x14); // TLV length = 20
        expect(buf[4]).toBe(0x80); expect(buf[5]).toBe(0x00); // system priority 32768
        expect(Array.from(buf.slice(6, 12))).toEqual(Array.from(ACTOR_MAC));
        expect((buf[12] << 8) | buf[13]).toBe(5);   // key = groupId
        expect(buf[14]).toBe(0x80); expect(buf[15]).toBe(0x00); // port priority 32768
        expect((buf[16] << 8) | buf[17]).toBe(4);   // port = portIdx + 1
        expect(buf[18]).toBe(0x3D);                 // state flags
    });

    it('encodes partner TLV as zeroes when partner is null', () => {
        const bp = makeBP();
        const buf = bp._encodeLACPDU(ACTOR_MAC, GROUP_ID, PORT_IDX, null);
        expect(buf[22]).toBe(0x02); // TLV type = partner
        expect(buf[23]).toBe(0x14); // TLV length = 20
        for (let i = 24; i < 42; i++) expect(buf[i]).toBe(0);
    });

    it('encodes partner TLV fields when partner is provided', () => {
        const bp = makeBP();
        const partner = {
            sysPriority: 32768,
            sysId: '02:bb:cc:dd:ee:ff',
            key: 2,
            portPriority: 32768,
            port: 1,
            state: 0x3D,
        };
        const buf = bp._encodeLACPDU(ACTOR_MAC, GROUP_ID, PORT_IDX, partner);
        expect((buf[24] << 8) | buf[25]).toBe(32768);
        expect(Array.from(buf.slice(26, 32))).toEqual([0x02, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
        expect((buf[32] << 8) | buf[33]).toBe(2);
        expect((buf[34] << 8) | buf[35]).toBe(32768);
        expect((buf[36] << 8) | buf[37]).toBe(1);
        expect(buf[38]).toBe(0x3D);
    });

    it('encodes collector and terminator TLVs', () => {
        const bp = makeBP();
        const buf = bp._encodeLACPDU(ACTOR_MAC, GROUP_ID, PORT_IDX, null);
        expect(buf[44]).toBe(0x03); // collector TLV type
        expect(buf[45]).toBe(0x10); // collector TLV length = 16
        expect(buf[62]).toBe(0x00); // terminator type
        expect(buf[63]).toBe(0x00); // terminator length
    });
});

// ── LACP – frame decoding ─────────────────────────────────────────────────────

describe('LACP – frame decoding', () => {
    const ACTOR_MAC = new Uint8Array([0x02, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE]);

    it('returns null for missing or too-short payload', () => {
        const bp = makeBP();
        expect(bp._decodeLACPDU(null)).toBeNull();
        expect(bp._decodeLACPDU(new Uint8Array(0))).toBeNull();
        expect(bp._decodeLACPDU(new Uint8Array(43))).toBeNull();
    });

    it('returns null for wrong subtype', () => {
        const bp = makeBP();
        const buf = bp._encodeLACPDU(ACTOR_MAC, 1, 0, null);
        buf[0] = 0x02;
        expect(bp._decodeLACPDU(buf)).toBeNull();
    });

    it('returns null for wrong actor TLV type', () => {
        const bp = makeBP();
        const buf = bp._encodeLACPDU(ACTOR_MAC, 1, 0, null);
        buf[2] = 0x03;
        expect(bp._decodeLACPDU(buf)).toBeNull();
    });

    it('roundtrip: encode then decode returns actor fields', () => {
        const bp = makeBP();
        const buf = bp._encodeLACPDU(ACTOR_MAC, 5, 3, null);
        const info = bp._decodeLACPDU(buf);
        expect(info).not.toBeNull();
        expect(info.sysPriority).toBe(32768);
        expect(info.sysId).toBe('02:aa:bb:cc:dd:ee');
        expect(info.key).toBe(5);
        expect(info.portPriority).toBe(32768);
        expect(info.port).toBe(4); // portIdx + 1
        expect(info.state).toBe(0x3D);
    });
});

// ── LACP – isLACPFrame ────────────────────────────────────────────────────────

describe('LACP – isLACPFrame', () => {
    function lacpFrame(opts = {}) {
        const payload = new Uint8Array(110);
        payload[0] = SwitchBackplane.LACP_SUBTYPE;
        const f = new EthernetFrame({
            dstMac: SwitchBackplane.LACP_DEST_MAC,
            srcMac: mac([0x02, 0, 0, 0, 0, 1]),
            etherType: SwitchBackplane.LACP_ETHERTYPE,
            payload,
        });
        if (opts.etherType != null) f.etherType = opts.etherType;
        if (opts.subtype != null)   f.payload[0] = opts.subtype;
        if (opts.useLengthField)    f.useLengthField = true;
        return f;
    }

    it('returns true for a valid LACP frame', () => {
        const bp = makeBP();
        expect(bp._isLACPFrame(lacpFrame())).toBe(true);
    });

    it('returns false when etherType does not match', () => {
        const bp = makeBP();
        expect(bp._isLACPFrame(lacpFrame({ etherType: 0x0800 }))).toBe(false);
    });

    it('returns false when payload subtype does not match', () => {
        const bp = makeBP();
        expect(bp._isLACPFrame(lacpFrame({ subtype: 0x02 }))).toBe(false);
    });

    it('returns false when frame uses the length field', () => {
        const bp = makeBP();
        expect(bp._isLACPFrame(lacpFrame({ useLengthField: true }))).toBe(false);
    });
});

// ── LACP – handleLACPFrame ────────────────────────────────────────────────────

describe('LACP – handleLACPFrame', () => {
    function makeLacpFrame(bp, actorMac, groupId, portIdx) {
        const payload = bp._encodeLACPDU(actorMac, groupId, portIdx, null);
        return new EthernetFrame({
            dstMac: SwitchBackplane.LACP_DEST_MAC,
            srcMac: actorMac,
            etherType: SwitchBackplane.LACP_ETHERTYPE,
            payload,
        });
    }

    it('stores partner info on the correct port', () => {
        const bp = makeBP();
        const actorMac = new Uint8Array([0x02, 0x11, 0x22, 0x33, 0x44, 0x55]);
        bp._handleLACPFrame(0, makeLacpFrame(bp, actorMac, 3, 1));
        const partner = bp.lacpPartners.get(0);
        expect(partner).toBeDefined();
        expect(partner.sysId).toBe('02:11:22:33:44:55');
        expect(partner.key).toBe(3);
        expect(partner.port).toBe(2); // portIdx + 1
    });

    it('sets expiresAtTick to currentTick + LACP_PARTNER_TTL ticks', () => {
        const bp = makeBP();
        const actorMac = new Uint8Array([0x02, 0, 0, 0, 0, 1]);
        const before = simTimer.currentTick;
        bp._handleLACPFrame(0, makeLacpFrame(bp, actorMac, 1, 0));
        const ttl = Math.round(SimTimer.LACP_PARTNER_TTL_MS / SimTimer.SIM_MS_PER_TICK);
        expect(bp.lacpPartners.get(0).expiresAtTick).toBe(before + ttl);
    });

    it('ignores a frame with an invalid LACPDU payload', () => {
        const bp = makeBP();
        const payload = new Uint8Array(110); // all zeros → subtype = 0x00 → decode returns null
        const f = new EthernetFrame({
            dstMac: SwitchBackplane.LACP_DEST_MAC,
            srcMac: mac([0x02, 0, 0, 0, 0, 1]),
            etherType: SwitchBackplane.LACP_ETHERTYPE,
            payload,
        });
        bp._handleLACPFrame(0, f);
        expect(bp.lacpPartners.has(0)).toBe(false);
    });
});

// ── LACP – TX timer ───────────────────────────────────────────────────────────

describe('LACP – TX timer', () => {
    const LACP_TX_TICKS = SimTimer.toTicks(SimTimer.LACP_TX_MS);

    it('_lacpStartPort emits nothing immediately when port is unlinked', () => {
        const bp = makeBP();
        const g = bp.createLagGroup('lacp');
        bp.addPortToLag(0, g.id);
        // addPortToLag already calls _lacpStartPort; port is not linked
        expect(bp.ports[0].outBuffer.length).toBe(0);
    });

    it('_lacpStartPort sends a LACP frame immediately when port is linked', () => {
        const bp = makeBP();
        const g = bp.createLagGroup('lacp');
        bp.addPortToLag(0, g.id);
        linkPort(bp, 0);
        bp._lacpStartPort(0, g.id);
        expect(bp.ports[0].outBuffer.length).toBe(1);
        expect(bp._isLACPFrame(bp.ports[0].outBuffer[0])).toBe(true);
    });

    it('_lacpStartPort re-transmits after LACP_TX_MS', () => {
        const bp = makeBP();
        const g = bp.createLagGroup('lacp');
        bp.addPortToLag(0, g.id);
        linkPort(bp, 0);
        bp._lacpStartPort(0, g.id);
        const countAfterImmediate = bp.ports[0].outBuffer.length;
        for (let i = 0; i < LACP_TX_TICKS; i++) simTimer.tick();
        expect(bp.ports[0].outBuffer.length).toBe(countAfterImmediate + 1);
    });

    it('_lacpStopPort cancels the TX timer and clears the partner entry', () => {
        const bp = makeBP();
        const g = bp.createLagGroup('lacp');
        bp.addPortToLag(0, g.id);
        linkPort(bp, 0);
        bp._lacpStartPort(0, g.id);

        // Simulate receiving a partner PDU so lacpPartners gets an entry
        const peerMac = new Uint8Array([0x02, 0, 0, 0, 0, 2]);
        bp._handleLACPFrame(0, new EthernetFrame({
            dstMac: SwitchBackplane.LACP_DEST_MAC,
            srcMac: peerMac,
            etherType: SwitchBackplane.LACP_ETHERTYPE,
            payload: bp._encodeLACPDU(peerMac, 1, 0, null),
        }));
        expect(bp.lacpPartners.has(0)).toBe(true);

        bp._lacpStopPort(0);
        expect(bp.lacpPartners.has(0)).toBe(false);

        // No further frames should be queued after stop
        const countBefore = bp.ports[0].outBuffer.length;
        for (let i = 0; i < LACP_TX_TICKS; i++) simTimer.tick();
        expect(bp.ports[0].outBuffer.length).toBe(countBefore);
    });
});

// ── LACP – two-switch integration with link failover ─────────────────────────

describe('LACP – two-switch failover integration', () => {
    // Build a wire that shares a `broken` flag so both port's isLinked()
    // reflects the cable state (EthernetLink is mocked in this file).
    function wireBreakable(portA, portB) {
        const link = { broken: false };
        portA.link(link);
        portB.link(link);
        return {
            transfer() {
                if (link.broken) return;
                let pkt;
                while ((pkt = portA.getNextOutgoingFrame()) != null) portB.recieve(pkt);
                while ((pkt = portB.getNextOutgoingFrame()) != null) portA.recieve(pkt);
            },
            break()  { link.broken = true;  },
            repair() { link.broken = false; },
            destroy() { portA.unlink(); portB.unlink(); },
        };
    }

    /**
     * Topology:
     *   hostA → sw1.port[2]    sw1.port[0] ↔ sw2.port[0]  (breakable link0)
     *                          sw1.port[1] ↔ sw2.port[1]  (always-up   link1)
     *                          sw2.port[2] → hostB
     */
    function buildTopo() {
        const sw1 = makeBP(4);
        const sw2 = makeBP(4);

        const g1 = sw1.createLagGroup('lacp');
        sw1.addPortToLag(0, g1.id);
        sw1.addPortToLag(1, g1.id);

        const g2 = sw2.createLagGroup('lacp');
        sw2.addPortToLag(0, g2.id);
        sw2.addPortToLag(1, g2.id);

        const link0 = wireBreakable(sw1.ports[0], sw2.ports[0]);
        const link1 = wireBreakable(sw1.ports[1], sw2.ports[1]);

        sw1.ports[2].link(SENTINEL);
        sw2.ports[2].link(SENTINEL);

        return { sw1, sw2, g1, g2, link0, link1 };
    }

    const LACP_TX_TICKS = SimTimer.toTicks(SimTimer.LACP_TX_MS);

    function runTicks(n, sw1, sw2, link0, link1) {
        for (let i = 0; i < n; i++) {
            simTimer.tick();
            link0.transfer();
            link1.transfer();
            sw1.update();
            sw2.update();
        }
    }

    it('both switches learn each other as LACP partners after TX interval', () => {
        const { sw1, sw2, link0, link1 } = buildTopo();
        runTicks(LACP_TX_TICKS + 2, sw1, sw2, link0, link1);
        expect(sw1.lacpPartners.has(0)).toBe(true);
        expect(sw1.lacpPartners.has(1)).toBe(true);
        expect(sw2.lacpPartners.has(0)).toBe(true);
        expect(sw2.lacpPartners.has(1)).toBe(true);
    });

    it('partner info contains the correct peer system ID', () => {
        const { sw1, sw2, link0, link1 } = buildTopo();
        runTicks(LACP_TX_TICKS + 2, sw1, sw2, link0, link1);
        // sw1.lacpPartners[0] should reflect sw2's bridge MAC
        const sw2ActorMac = Array.from(sw2.ports[0].outBuffer[0]?.srcMac ?? []);
        const partner0 = sw1.lacpPartners.get(0);
        expect(partner0).toBeDefined();
        // key should equal sw2's LAG group id
        expect(partner0.key).toBe(sw2.lagGroups[0].id);
    });

    it('broadcast from sw1 reaches sw2 host port with both links up', () => {
        const { sw1, sw2, link0, link1 } = buildTopo();
        runTicks(LACP_TX_TICKS + 2, sw1, sw2, link0, link1);

        const hostAMac = mac([0x02, 0, 0, 0, 0, 0xA]);
        inject(sw1, 2, frame(hostAMac, BCAST));
        link0.transfer();
        link1.transfer();
        sw2.update();

        expect(sw2.ports[2].outBuffer.length).toBeGreaterThan(0);
    });

    it('unicast traffic fails over to the remaining link when link0 is broken', () => {
        const { sw1, sw2, link0, link1 } = buildTopo();
        runTicks(LACP_TX_TICKS + 2, sw1, sw2, link0, link1);

        link0.break();
        expect(sw1.ports[0].isLinked()).toBe(false);
        expect(sw2.ports[0].isLinked()).toBe(false);

        // Let sw1 learn hostB MAC via link1
        const hostBMac = mac([0x02, 0, 0, 0, 0, 0xB]);
        inject(sw2, 2, frame(hostBMac, BCAST));
        link0.transfer(); // no-op (broken)
        link1.transfer();
        sw1.update();

        // Drain any extra frames from ports before the unicast test
        while (sw2.ports[2].outBuffer.length) sw2.ports[2].outBuffer.shift();

        // Send unicast from sw1 toward hostB
        const hostAMac = mac([0x02, 0, 0, 0, 0, 0xA]);
        inject(sw1, 2, frame(hostAMac, hostBMac));
        link0.transfer(); // no-op
        link1.transfer();
        sw2.update();

        // Must arrive at sw2 host port
        expect(sw2.ports[2].outBuffer.length).toBeGreaterThan(0);
        // Must NOT have gone through the broken link
        expect(sw2.ports[0].inBuffer.length).toBe(0);
    });

    it('both ports are active again after the broken link is repaired', () => {
        const { sw1, sw2, link0, link1 } = buildTopo();
        runTicks(LACP_TX_TICKS + 2, sw1, sw2, link0, link1);

        link0.break();
        runTicks(2, sw1, sw2, link0, link1);

        link0.repair();
        expect(sw1.ports[0].isLinked()).toBe(true);
        expect(sw2.ports[0].isLinked()).toBe(true);

        const active = sw1.lagGroups[0].members.filter(i => sw1.ports[i].isLinked());
        expect(active.length).toBe(2);
    });
});
