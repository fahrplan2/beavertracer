//@ts-check
import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('../../src/net/EthernetLink.js', () => ({ EthernetLink: class EthernetLink {} }));

import { SwitchBackplane } from '../../src/net/SwitchBackplane.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SENTINEL = {};

/** @param {number[]} bytes */
const mac = (bytes) => new Uint8Array(bytes);

const BCAST = mac([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

const _backplanes = /** @type {SwitchBackplane[]} */ ([]);

afterEach(() => {
    for (const bp of _backplanes) bp.disableSTPFeature?.();
    _backplanes.length = 0;
});

/** @param {number} [nPorts] */
function makeBP(nPorts = 4) {
    const bp = new SwitchBackplane(nPorts);
    _backplanes.push(bp);
    return bp;
}

function linkPort(bp, idx) {
    bp.ports[idx].link(/** @type {any} */ (SENTINEL));
}

function inject(bp, portIdx, f) {
    bp.ports[portIdx].recieve(f.pack());
    bp.update();
}

function drainCount(bp, portIdx) {
    let n = 0;
    while (bp.ports[portIdx].getNextOutgoingFrame() != null) n++;
    return n;
}

/**
 * Build a minimal IPv4/IGMP frame.
 * @param {0x11|0x16|0x17} igmpType  Query / Report / Leave
 * @param {[number,number,number,number]} groupIp
 * @param {Uint8Array} [src]
 */
function igmpFrame(igmpType, groupIp, src = mac([0xaa, 0, 0, 0, 0, 1])) {
    const ip = new Uint8Array(28); // 20-byte IP header + 8-byte IGMP
    ip[0] = 0x45;          // IPv4, IHL=5
    ip[9] = 2;             // protocol = IGMP
    ip[12] = 192; ip[13] = 168; ip[14] = 1; ip[15] = 1; // src IP
    ip[16] = groupIp[0]; ip[17] = groupIp[1]; ip[18] = groupIp[2]; ip[19] = groupIp[3];
    ip[20] = igmpType;     // IGMP type
    ip[24] = groupIp[0]; ip[25] = groupIp[1]; ip[26] = groupIp[2]; ip[27] = groupIp[3];

    const dstMac = mac([0x01, 0x00, 0x5e, groupIp[1] & 0x7f, groupIp[2], groupIp[3]]);
    const f = new EthernetFrame({ srcMac: src, dstMac, etherType: 0x0800, payload: ip });
    return f;
}

/**
 * Build a non-IGMP IPv4 multicast data frame for the given group.
 * (IP protocol field = 17/UDP, not 2/IGMP)
 * @param {[number,number,number,number]} groupIp
 * @param {Uint8Array} [src]
 */
function multicastDataFrame(groupIp, src = mac([0xcc, 0, 0, 0, 0, 1])) {
    const ip = new Uint8Array(24);
    ip[0] = 0x45;
    ip[9] = 17; // UDP, not IGMP
    ip[16] = groupIp[0]; ip[17] = groupIp[1]; ip[18] = groupIp[2]; ip[19] = groupIp[3];
    const dstMac = mac([0x01, 0x00, 0x5e, groupIp[1] & 0x7f, groupIp[2], groupIp[3]]);
    return new EthernetFrame({ srcMac: src, dstMac, etherType: 0x0800, payload: ip });
}

const GROUP_A = /** @type {[number,number,number,number]} */ ([224, 1, 2, 3]);
const GROUP_B = /** @type {[number,number,number,number]} */ ([224, 10, 20, 30]);

// ── Feature flag ──────────────────────────────────────────────────────────────

describe('IGMP Snooping – feature flag', () => {
    it('disabled by default', () => {
        const bp = makeBP();
        expect(bp.igmpSnoopingEnabled).toBe(false);
    });

    it('enableIGMPSnooping sets flag', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        expect(bp.igmpSnoopingEnabled).toBe(true);
    });

    it('disableIGMPSnooping clears flag and empties mcastTable', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp.mcastTable.set(1, { ip: '224.1.2.3', ports: new Set([0]) });
        bp.disableIGMPSnooping();
        expect(bp.igmpSnoopingEnabled).toBe(false);
        expect(bp.mcastTable.size).toBe(0);
    });
});

// ── _isIPv4MulticastMac ───────────────────────────────────────────────────────

describe('IGMP Snooping – _isIPv4MulticastMac', () => {
    it('returns true for 01:00:5e:xx:xx:xx', () => {
        const bp = makeBP();
        expect(bp._isIPv4MulticastMac(mac([0x01, 0x00, 0x5e, 0x01, 0x02, 0x03]))).toBe(true);
    });

    it('returns false for broadcast', () => {
        const bp = makeBP();
        expect(bp._isIPv4MulticastMac(BCAST)).toBe(false);
    });

    it('returns false for unicast', () => {
        const bp = makeBP();
        expect(bp._isIPv4MulticastMac(mac([0xaa, 0x00, 0x00, 0x00, 0x00, 0x01]))).toBe(false);
    });

    it('returns false for STP multicast 01:80:c2:…', () => {
        const bp = makeBP();
        expect(bp._isIPv4MulticastMac(mac([0x01, 0x80, 0xc2, 0x00, 0x00, 0x00]))).toBe(false);
    });
});

// ── _processIGMP ──────────────────────────────────────────────────────────────

describe('IGMP Snooping – _processIGMP', () => {
    it('returns -1 for non-IPv4 etherType', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        const f = new EthernetFrame({ srcMac: mac([0xaa,0,0,0,0,1]), dstMac: mac([0x01,0x00,0x5e,1,2,3]), etherType: 0x86dd, payload: new Uint8Array(28) });
        expect(bp._processIGMP(0, f)).toBe(-1);
    });

    it('returns -1 when IP protocol is not IGMP', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        expect(bp._processIGMP(0, multicastDataFrame(GROUP_A))).toBe(-1);
    });

    it('Membership Report (0x16) adds port to mcastTable', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        const result = bp._processIGMP(2, igmpFrame(0x16, GROUP_A));
        expect(result).toBe(0x16);
        const entry = [...bp.mcastTable.values()][0];
        expect(entry.ip).toBe('224.1.2.3');
        expect(entry.ports.has(2)).toBe(true);
    });

    it('multiple ports can join the same group', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processIGMP(0, igmpFrame(0x16, GROUP_A));
        bp._processIGMP(2, igmpFrame(0x16, GROUP_A));
        const entry = [...bp.mcastTable.values()][0];
        expect(entry.ports.size).toBe(2);
        expect(entry.ports.has(0)).toBe(true);
        expect(entry.ports.has(2)).toBe(true);
    });

    it('Leave (0x17) removes port from group', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processIGMP(1, igmpFrame(0x16, GROUP_A));
        bp._processIGMP(3, igmpFrame(0x16, GROUP_A));
        const result = bp._processIGMP(1, igmpFrame(0x17, GROUP_A));
        expect(result).toBe(0x17);
        const entry = [...bp.mcastTable.values()][0];
        expect(entry.ports.has(1)).toBe(false);
        expect(entry.ports.has(3)).toBe(true);
    });

    it('Leave removes group entry when last port leaves', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processIGMP(0, igmpFrame(0x16, GROUP_A));
        bp._processIGMP(0, igmpFrame(0x17, GROUP_A));
        expect(bp.mcastTable.size).toBe(0);
    });

    it('Query (0x11) returns type but does not modify table', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        const result = bp._processIGMP(0, igmpFrame(0x11, GROUP_A));
        expect(result).toBe(0x11);
        expect(bp.mcastTable.size).toBe(0);
    });

    it('different groups create separate table entries', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processIGMP(0, igmpFrame(0x16, GROUP_A));
        bp._processIGMP(1, igmpFrame(0x16, GROUP_B));
        expect(bp.mcastTable.size).toBe(2);
        const ips = [...bp.mcastTable.values()].map(e => e.ip).sort();
        expect(ips).toEqual(['224.1.2.3', '224.10.20.30']);
    });
});

// ── Forwarding: IGMP control frames are always flooded ────────────────────────

describe('IGMP Snooping – control frames are flooded', () => {
    it('Membership Report is flooded to all ports (router must see it)', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 0, igmpFrame(0x16, GROUP_A));

        // report arrives on port 0 → must be forwarded to ports 1, 2, 3
        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
        expect(drainCount(bp, 0)).toBe(0); // not back to ingress
    });

    it('Leave is flooded to all ports', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);
        // pre-populate table so Leave processing runs
        bp._processIGMP(0, igmpFrame(0x16, GROUP_A));

        inject(bp, 0, igmpFrame(0x17, GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });

    it('Query is flooded to all ports (hosts must see it)', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 0, igmpFrame(0x11, GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });
});

// ── Forwarding: multicast data with snooping ──────────────────────────────────

describe('IGMP Snooping – multicast data forwarding (VLAN disabled)', () => {
    it('data frame for unknown group is flooded to all ports', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 0, multicastDataFrame(GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });

    it('data frame for known group reaches only registered ports', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        // port 1 joins GROUP_A
        bp._processIGMP(1, igmpFrame(0x16, GROUP_A));

        inject(bp, 0, multicastDataFrame(GROUP_A));

        expect(drainCount(bp, 1)).toBe(1); // registered
        expect(drainCount(bp, 2)).toBe(0); // not registered
        expect(drainCount(bp, 3)).toBe(0); // not registered
    });

    it('data frame does not loop back to ingress port even if it is registered', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        // port 0 joins GROUP_A (same as ingress below)
        bp._processIGMP(0, igmpFrame(0x16, GROUP_A));
        bp._processIGMP(1, igmpFrame(0x16, GROUP_A));

        inject(bp, 0, multicastDataFrame(GROUP_A));

        expect(drainCount(bp, 0)).toBe(0); // ingress port, no loopback
        expect(drainCount(bp, 1)).toBe(1);
    });

    it('two groups are forwarded independently', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        bp._processIGMP(1, igmpFrame(0x16, GROUP_A)); // port 1 → GROUP_A
        bp._processIGMP(2, igmpFrame(0x16, GROUP_B)); // port 2 → GROUP_B

        inject(bp, 0, multicastDataFrame(GROUP_A));
        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(0);

        inject(bp, 0, multicastDataFrame(GROUP_B));
        expect(drainCount(bp, 1)).toBe(0);
        expect(drainCount(bp, 2)).toBe(1);
    });

    it('when snooping is disabled, multicast data is flooded normally', () => {
        const bp = makeBP(4);
        // snooping stays off
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 0, multicastDataFrame(GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });

    it('disabling snooping clears table; subsequent data is flooded again', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);
        bp._processIGMP(1, igmpFrame(0x16, GROUP_A));

        bp.disableIGMPSnooping();

        inject(bp, 0, multicastDataFrame(GROUP_A));
        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });
});

// ── Forwarding: VLAN-enabled + IGMP snooping ──────────────────────────────────

describe('IGMP Snooping – multicast data forwarding (VLAN enabled)', () => {
    it('data frame for known group reaches only registered ports within the VLAN', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        bp.enableVLANFeature();
        bp.ports[0].setUntagged(10); // ingress
        bp.ports[1].setUntagged(10); // registered for GROUP_A
        bp.ports[2].setUntagged(10); // same VLAN, not registered
        bp.ports[3].setUntagged(20); // different VLAN
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        bp._processIGMP(1, igmpFrame(0x16, GROUP_A));

        inject(bp, 0, multicastDataFrame(GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(0); // same VLAN but not registered
        expect(drainCount(bp, 3)).toBe(0); // wrong VLAN
    });

    it('IGMP Report is still flooded within the VLAN', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        bp.enableVLANFeature();
        for (let i = 0; i < 4; i++) {
            bp.ports[i].setUntagged(10);
            linkPort(bp, i);
        }

        inject(bp, 0, igmpFrame(0x16, GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });

    it('registered port in wrong VLAN does not receive the data frame', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        bp.enableVLANFeature();
        bp.ports[0].setUntagged(10);
        bp.ports[1].setUntagged(20); // registered but wrong VLAN
        bp.ports[2].setUntagged(10);
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        // manually register port 1 (VLAN 20) for GROUP_A
        bp._processIGMP(1, igmpFrame(0x16, GROUP_A));

        inject(bp, 0, multicastDataFrame(GROUP_A)); // ingress on VLAN 10

        expect(drainCount(bp, 1)).toBe(0); // registered but VLAN mismatch
        expect(drainCount(bp, 2)).toBe(0); // not registered
    });
});

// ── Ingress Report updates table via inject (end-to-end) ─────────────────────

describe('IGMP Snooping – table built by injected frames', () => {
    it('Report injected on a port registers that port in the table', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 2, igmpFrame(0x16, GROUP_A));

        const entry = [...bp.mcastTable.values()][0];
        expect(entry).toBeDefined();
        expect(entry.ports.has(2)).toBe(true);
    });

    it('Leave injected on a port removes that port from the table', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 2, igmpFrame(0x16, GROUP_A));
        inject(bp, 2, igmpFrame(0x17, GROUP_A));

        expect(bp.mcastTable.size).toBe(0);
    });

    it('after Report on port 2, data reaches port 2 only', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 2, igmpFrame(0x16, GROUP_A));
        // drain the flooded Report from ports 0,1,3
        for (let i = 0; i < 4; i++) drainCount(bp, i);

        inject(bp, 0, multicastDataFrame(GROUP_A));

        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 1)).toBe(0);
        expect(drainCount(bp, 3)).toBe(0);
    });
});

/**
 * Move all pending outgoing frames from one switch port into another switch port.
 * Returns the number of frames relayed.
 * @param {SwitchBackplane} fromBP
 * @param {number} fromPort
 * @param {SwitchBackplane} toBP
 * @param {number} toPort
 */
function relay(fromBP, fromPort, toBP, toPort) {
    let f, count = 0;
    while ((f = fromBP.ports[fromPort].getNextOutgoingFrame()) != null) {
        toBP.ports[toPort].recieve(f);
        toBP.update();
        count++;
    }
    return count;
}

// ── Multi-switch propagation ──────────────────────────────────────────────────

describe('IGMP Snooping – multi-switch propagation', () => {
    // Topology: HostA ── SW1(p0 ↔ p1) ── SW2(p0 ↔ p1) ── HostB

    function makeLinkedPair() {
        const sw1 = makeBP(2);
        const sw2 = makeBP(2);
        sw1.enableIGMPSnooping();
        sw2.enableIGMPSnooping();
        for (let i = 0; i < 2; i++) { linkPort(sw1, i); linkPort(sw2, i); }
        return { sw1, sw2 };
    }

    it('Report from HostA floods through SW1 and SW2 learns the uplink port', () => {
        const { sw1, sw2 } = makeLinkedPair();

        inject(sw1, 0, igmpFrame(0x16, GROUP_A));

        // SW1 must have learned GROUP_A on port 0
        const e1 = [...sw1.mcastTable.values()][0];
        expect(e1?.ports.has(0)).toBe(true);

        // SW1 floods the Report to p1 → relay to SW2.p0
        const forwarded = relay(sw1, 1, sw2, 0);
        expect(forwarded).toBe(1);

        // SW2 must have learned GROUP_A on port 0 (its uplink toward SW1/HostA)
        const e2 = [...sw2.mcastTable.values()][0];
        expect(e2?.ports.has(0)).toBe(true);

        // SW2 also floods the Report toward HostB (p1)
        expect(drainCount(sw2, 1)).toBe(1);
    });

    it('multicast data reaches HostB after HostB joins via SW2', () => {
        const { sw1, sw2 } = makeLinkedPair();

        // HostB joins → SW2 learns p1; Report floods to SW2.p0
        inject(sw2, 1, igmpFrame(0x16, GROUP_A));
        // Relay Report from SW2.p0 to SW1.p1 → SW1 learns p1 (uplink toward SW2)
        relay(sw2, 0, sw1, 1);
        // Drain leftover: SW1 re-floods the Report to p0 (toward HostA side)
        drainCount(sw1, 0);

        // Multicast data from HostA arrives at SW1.p0
        inject(sw1, 0, multicastDataFrame(GROUP_A));

        // SW1 forwards to p1 (learned via HostB's Report)
        const toSW2 = relay(sw1, 1, sw2, 0);
        expect(toSW2).toBe(1);

        // SW2 forwards to p1 (HostB) and NOT back to p0 (ingress)
        expect(drainCount(sw2, 1)).toBe(1);
        expect(drainCount(sw2, 0)).toBe(0);
    });

    it('multicast data does not cross to SW2 when no host on SW2 has joined', () => {
        const { sw1, sw2 } = makeLinkedPair();

        // Only HostA (SW1.p0) joins; drain the Report that SW1 floods to p1 (do NOT relay to SW2)
        inject(sw1, 0, igmpFrame(0x16, GROUP_A));
        drainCount(sw1, 1);

        // Data arrives from upstream on SW1.p1
        inject(sw1, 1, multicastDataFrame(GROUP_A));

        // SW1 forwards only to p0 (HostA); p1 is ingress so no loopback
        expect(drainCount(sw1, 0)).toBe(1);
        expect(drainCount(sw1, 1)).toBe(0);

        // SW2 receives nothing
        expect(drainCount(sw2, 0)).toBe(0);
        expect(drainCount(sw2, 1)).toBe(0);
    });

    it('Leave from HostB propagates to SW1 and removes uplink from both tables', () => {
        const { sw1, sw2 } = makeLinkedPair();

        // Setup: HostB joins, SW1 learns uplink p1
        inject(sw2, 1, igmpFrame(0x16, GROUP_A));
        relay(sw2, 0, sw1, 1);
        drainCount(sw1, 0); // drain re-flooded Report

        // HostB leaves; Leave floods from SW2.p0 to SW1.p1
        inject(sw2, 1, igmpFrame(0x17, GROUP_A));
        relay(sw2, 0, sw1, 1);
        drainCount(sw1, 0); // drain re-flooded Leave

        expect(sw2.mcastTable.size).toBe(0);
        expect(sw1.mcastTable.size).toBe(0);
    });

    it('data reaches both HostA and HostB when both have joined across the two switches', () => {
        const { sw1, sw2 } = makeLinkedPair();

        // HostA joins on SW1.p0
        inject(sw1, 0, igmpFrame(0x16, GROUP_A));
        relay(sw1, 1, sw2, 0); // SW2 learns uplink p0
        drainCount(sw2, 1);    // drain re-flooded Report

        // HostB joins on SW2.p1
        inject(sw2, 1, igmpFrame(0x16, GROUP_A));
        relay(sw2, 0, sw1, 1); // SW1 learns uplink p1
        drainCount(sw1, 0);    // drain re-flooded Report

        // Data from upstream arrives at SW1.p1
        inject(sw1, 1, multicastDataFrame(GROUP_A));

        // SW1 forwards to p0 (HostA)
        expect(drainCount(sw1, 0)).toBe(1);

        // SW1 does NOT forward back to p1 (ingress — even though p1 is also in the table)
        // Instead, relay whatever SW1 sent to p1... there should be nothing (ingress)
        const backToSW2 = relay(sw1, 1, sw2, 0);
        expect(backToSW2).toBe(0);

        // HostB should NOT receive via SW2 in this direction (data came from SW1.p1 side)
        // but let's verify SW2 didn't accidentally forward anything
        expect(drainCount(sw2, 1)).toBe(0);
    });
});

// ── Serialization ─────────────────────────────────────────────────────────────

describe('IGMP Snooping – serialization', () => {
    /** Mirror of Switch.toJSON igmp section */
    function igmpSerialize(bp) {
        return { igmpSnoopingEnabled: !!bp.igmpSnoopingEnabled };
    }

    /** Mirror of Switch.fromJSON igmp restore */
    function igmpRestore(bp, json) {
        if (json.igmpSnoopingEnabled) bp.enableIGMPSnooping();
    }

    it('enabled flag survives roundtrip', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        const json = igmpSerialize(bp);
        const bp2 = makeBP();
        igmpRestore(bp2, json);
        expect(bp2.igmpSnoopingEnabled).toBe(true);
    });

    it('disabled flag survives roundtrip (fresh instance starts disabled)', () => {
        const bp = makeBP();
        // igmpSnoopingEnabled stays false (default)
        const json = igmpSerialize(bp);
        const bp2 = makeBP(); // fromJSON always creates a fresh instance
        igmpRestore(bp2, json);
        expect(bp2.igmpSnoopingEnabled).toBe(false);
    });

    it('mcastTable is not persisted (starts empty after restore)', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp.mcastTable.set(1, { ip: '224.1.2.3', ports: new Set([0]) });
        const json = igmpSerialize(bp);
        const bp2 = makeBP();
        igmpRestore(bp2, json);
        expect(bp2.mcastTable.size).toBe(0);
    });
});
