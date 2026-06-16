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

function relay(fromBP, fromPort, toBP, toPort) {
    let f, count = 0;
    while ((f = fromBP.ports[fromPort].getNextOutgoingFrame()) != null) {
        toBP.ports[toPort].recieve(f);
        toBP.update();
        count++;
    }
    return count;
}

/**
 * Build a minimal IPv6/ICMPv6/MLD frame.
 * @param {0x82|0x83|0x84} mldType  Query / Report / Done
 * @param {number[]} groupBytes16   16-byte IPv6 multicast group address
 * @param {Uint8Array} [src]
 */
function mldFrame(mldType, groupBytes16, src = mac([0xaa, 0, 0, 0, 0, 1])) {
    const ip6 = new Uint8Array(64); // 40-byte IPv6 hdr + 24-byte MLD body
    ip6[6] = 58;       // nextHeader = ICMPv6
    ip6[40] = mldType; // ICMPv6 / MLD type
    // MLD group address: ICMPv6 payload byte 8 = IPv6 frame byte 48
    for (let i = 0; i < 16; i++) ip6[48 + i] = groupBytes16[i];

    const dstMac = mac([0x33, 0x33,
        groupBytes16[12], groupBytes16[13], groupBytes16[14], groupBytes16[15]]);
    return new EthernetFrame({ srcMac: src, dstMac, etherType: 0x86DD, payload: ip6 });
}

/**
 * Build a non-MLD IPv6 multicast data frame (nextHeader = 17/UDP).
 * @param {number[]} groupBytes16
 * @param {Uint8Array} [src]
 */
function mcastV6DataFrame(groupBytes16, src = mac([0xcc, 0, 0, 0, 0, 1])) {
    const ip6 = new Uint8Array(48);
    ip6[6] = 17; // UDP, not ICMPv6
    for (let i = 0; i < 16; i++) ip6[24 + i] = groupBytes16[i]; // dst addr
    const dstMac = mac([0x33, 0x33,
        groupBytes16[12], groupBytes16[13], groupBytes16[14], groupBytes16[15]]);
    return new EthernetFrame({ srcMac: src, dstMac, etherType: 0x86DD, payload: ip6 });
}

/**
 * Build an NDP Neighbor Solicitation (ICMPv6 type 135) targeting a solicited-node address.
 * MAC is 33:33:ff:xx:xx:xx — a 33:33 frame that is NOT MLD.
 */
function ndpNSFrame(src = mac([0xaa, 0, 0, 0, 0, 1])) {
    const groupBytes16 = [0xff, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xff, 0x01, 0x02, 0x03];
    const ip6 = new Uint8Array(64);
    ip6[6] = 58;   // ICMPv6
    ip6[40] = 135; // Neighbor Solicitation — NOT a MLD type
    for (let i = 0; i < 16; i++) ip6[48 + i] = groupBytes16[i];
    const dstMac = mac([0x33, 0x33, 0xff, 0x01, 0x02, 0x03]);
    return new EthernetFrame({ srcMac: src, dstMac, etherType: 0x86DD, payload: ip6 });
}

// Well-known test groups (ff02::/16 scope)
const GROUP_A = [0xff, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01, 0x02, 0x03];
const GROUP_B = [0xff, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x0a, 0x14, 0x1e];

// ── Feature flag ─────────────────────────────────────────────────────────────
// Shared with IGMP snooping — just verify the same flag covers MLD.

describe('MLD Snooping – feature flag', () => {
    it('disabled by default', () => {
        expect(makeBP().igmpSnoopingEnabled).toBe(false);
    });

    it('enableIGMPSnooping enables MLD snooping too', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        expect(bp.igmpSnoopingEnabled).toBe(true);
    });

    it('disableIGMPSnooping clears mcastTable including MLD entries', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processMLD(0, mldFrame(0x83, GROUP_A));
        expect(bp.mcastTable.size).toBe(1);
        bp.disableIGMPSnooping();
        expect(bp.mcastTable.size).toBe(0);
    });
});

// ── _isIPv6MulticastMac ───────────────────────────────────────────────────────

describe('MLD Snooping – _isIPv6MulticastMac', () => {
    it('returns true for 33:33:xx:xx:xx:xx', () => {
        const bp = makeBP();
        expect(bp._isIPv6MulticastMac(mac([0x33, 0x33, 0x00, 0x01, 0x02, 0x03]))).toBe(true);
    });

    it('returns false for broadcast', () => {
        expect(makeBP()._isIPv6MulticastMac(BCAST)).toBe(false);
    });

    it('returns false for unicast', () => {
        expect(makeBP()._isIPv6MulticastMac(mac([0xaa, 0x00, 0x00, 0x00, 0x00, 0x01]))).toBe(false);
    });

    it('returns false for IPv4 multicast 01:00:5e:...', () => {
        expect(makeBP()._isIPv6MulticastMac(mac([0x01, 0x00, 0x5e, 0x01, 0x02, 0x03]))).toBe(false);
    });
});

// ── _processMLD ───────────────────────────────────────────────────────────────

describe('MLD Snooping – _processMLD', () => {
    it('returns -1 for non-IPv6 etherType', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        const f = new EthernetFrame({
            srcMac: mac([0xaa,0,0,0,0,1]),
            dstMac: mac([0x33,0x33,0,0,0,1]),
            etherType: 0x0800,
            payload: new Uint8Array(64),
        });
        expect(bp._processMLD(0, f)).toBe(-1);
    });

    it('returns -1 when nextHeader is not ICMPv6', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        expect(bp._processMLD(0, mcastV6DataFrame(GROUP_A))).toBe(-1);
    });

    it('returns -1 for ICMPv6 type that is not 130/131/132 (e.g. NDP type 135)', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        expect(bp._processMLD(0, ndpNSFrame())).toBe(-1);
    });

    it('Membership Report (0x83) adds port to mcastTable', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        const result = bp._processMLD(2, mldFrame(0x83, GROUP_A));
        expect(result).toBe(0x83);
        const entry = [...bp.mcastTable.values()][0];
        expect(entry).toBeDefined();
        expect(entry.ports.has(2)).toBe(true);
    });

    it('group IP is stored as IPv6 string', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processMLD(0, mldFrame(0x83, GROUP_A));
        const entry = [...bp.mcastTable.values()][0];
        expect(entry.ip).toContain(':'); // IPv6 notation
    });

    it('multiple ports can join the same group', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processMLD(0, mldFrame(0x83, GROUP_A));
        bp._processMLD(2, mldFrame(0x83, GROUP_A));
        const entry = [...bp.mcastTable.values()][0];
        expect(entry.ports.size).toBe(2);
        expect(entry.ports.has(0)).toBe(true);
        expect(entry.ports.has(2)).toBe(true);
    });

    it('Done (0x84) removes port from group', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processMLD(1, mldFrame(0x83, GROUP_A));
        bp._processMLD(3, mldFrame(0x83, GROUP_A));
        const result = bp._processMLD(1, mldFrame(0x84, GROUP_A));
        expect(result).toBe(0x84);
        const entry = [...bp.mcastTable.values()][0];
        expect(entry.ports.has(1)).toBe(false);
        expect(entry.ports.has(3)).toBe(true);
    });

    it('Done removes group entry when last port leaves', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processMLD(0, mldFrame(0x83, GROUP_A));
        bp._processMLD(0, mldFrame(0x84, GROUP_A));
        expect(bp.mcastTable.size).toBe(0);
    });

    it('Query (0x82) returns type but does not modify table', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        const result = bp._processMLD(0, mldFrame(0x82, GROUP_A));
        expect(result).toBe(0x82);
        expect(bp.mcastTable.size).toBe(0);
    });

    it('different groups create separate table entries', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processMLD(0, mldFrame(0x83, GROUP_A));
        bp._processMLD(1, mldFrame(0x83, GROUP_B));
        expect(bp.mcastTable.size).toBe(2);
    });
});

// ── Forwarding: MLD control frames are always flooded ─────────────────────────

describe('MLD Snooping – control frames are flooded', () => {
    it('Membership Report is flooded to all ports', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 0, mldFrame(0x83, GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
        expect(drainCount(bp, 0)).toBe(0); // not back to ingress
    });

    it('Done is flooded to all ports', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);
        bp._processMLD(0, mldFrame(0x83, GROUP_A));

        inject(bp, 0, mldFrame(0x84, GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });

    it('Query is flooded to all ports', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 0, mldFrame(0x82, GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });
});

// ── Forwarding: multicast data (VLAN disabled) ────────────────────────────────

describe('MLD Snooping – multicast data forwarding (VLAN disabled)', () => {
    it('data frame for unknown group is flooded to all ports', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 0, mcastV6DataFrame(GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });

    it('data frame for known group reaches only registered ports', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        bp._processMLD(1, mldFrame(0x83, GROUP_A));

        inject(bp, 0, mcastV6DataFrame(GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(0);
        expect(drainCount(bp, 3)).toBe(0);
    });

    it('data frame does not loop back to ingress port even if registered', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        bp._processMLD(0, mldFrame(0x83, GROUP_A));
        bp._processMLD(1, mldFrame(0x83, GROUP_A));

        inject(bp, 0, mcastV6DataFrame(GROUP_A));

        expect(drainCount(bp, 0)).toBe(0);
        expect(drainCount(bp, 1)).toBe(1);
    });

    it('two groups are forwarded independently', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        bp._processMLD(1, mldFrame(0x83, GROUP_A));
        bp._processMLD(2, mldFrame(0x83, GROUP_B));

        inject(bp, 0, mcastV6DataFrame(GROUP_A));
        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(0);

        inject(bp, 0, mcastV6DataFrame(GROUP_B));
        expect(drainCount(bp, 1)).toBe(0);
        expect(drainCount(bp, 2)).toBe(1);
    });

    it('when snooping is disabled, multicast data is flooded normally', () => {
        const bp = makeBP(4);
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 0, mcastV6DataFrame(GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });

    it('disabling snooping clears table; subsequent data floods again', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);
        bp._processMLD(1, mldFrame(0x83, GROUP_A));

        bp.disableIGMPSnooping();

        inject(bp, 0, mcastV6DataFrame(GROUP_A));
        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });
});

// ── NDP frames must not be suppressed ────────────────────────────────────────

describe('MLD Snooping – NDP frames unaffected', () => {
    it('NDP Neighbor Solicitation (ICMPv6 type 135, 33:33:ff:...) is always flooded', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 0, ndpNSFrame());

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });

    it('NDP frame is flooded even when snooping is enabled and table is populated', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);
        // populate table so snooping is active
        bp._processMLD(1, mldFrame(0x83, GROUP_A));

        inject(bp, 0, ndpNSFrame());

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });
});

// ── Forwarding: VLAN-enabled + MLD snooping ──────────────────────────────────

describe('MLD Snooping – multicast data forwarding (VLAN enabled)', () => {
    it('data frame for known group reaches only registered ports within the VLAN', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        bp.enableVLANFeature();
        bp.ports[0].setUntagged(10);
        bp.ports[1].setUntagged(10);
        bp.ports[2].setUntagged(10);
        bp.ports[3].setUntagged(20); // different VLAN
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        bp._processMLD(1, mldFrame(0x83, GROUP_A));

        inject(bp, 0, mcastV6DataFrame(GROUP_A));

        expect(drainCount(bp, 1)).toBe(1); // registered, same VLAN
        expect(drainCount(bp, 2)).toBe(0); // same VLAN but not registered
        expect(drainCount(bp, 3)).toBe(0); // wrong VLAN
    });

    it('MLD Report is flooded within the VLAN', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        bp.enableVLANFeature();
        for (let i = 0; i < 4; i++) {
            bp.ports[i].setUntagged(10);
            linkPort(bp, i);
        }

        inject(bp, 0, mldFrame(0x83, GROUP_A));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(1);
    });

    it('registered port in wrong VLAN does not receive data frame', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        bp.enableVLANFeature();
        bp.ports[0].setUntagged(10);
        bp.ports[1].setUntagged(20); // registered but wrong VLAN
        bp.ports[2].setUntagged(10);
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        bp._processMLD(1, mldFrame(0x83, GROUP_A)); // registered on VLAN 20

        inject(bp, 0, mcastV6DataFrame(GROUP_A)); // ingress on VLAN 10

        expect(drainCount(bp, 1)).toBe(0); // VLAN mismatch
        expect(drainCount(bp, 2)).toBe(0); // not registered
    });
});

// ── End-to-end via injected frames ───────────────────────────────────────────

describe('MLD Snooping – table built by injected frames', () => {
    it('Report injected on a port registers that port', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 2, mldFrame(0x83, GROUP_A));

        const entry = [...bp.mcastTable.values()][0];
        expect(entry).toBeDefined();
        expect(entry.ports.has(2)).toBe(true);
    });

    it('Done injected on a port removes that port from the table', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 2, mldFrame(0x83, GROUP_A));
        inject(bp, 2, mldFrame(0x84, GROUP_A));

        expect(bp.mcastTable.size).toBe(0);
    });

    it('after Report on port 2, data reaches only port 2', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        for (let i = 0; i < 4; i++) linkPort(bp, i);

        inject(bp, 2, mldFrame(0x83, GROUP_A));
        for (let i = 0; i < 4; i++) drainCount(bp, i); // drain flooded Report

        inject(bp, 0, mcastV6DataFrame(GROUP_A));

        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 1)).toBe(0);
        expect(drainCount(bp, 3)).toBe(0);
    });
});

// ── Multi-switch propagation ──────────────────────────────────────────────────

describe('MLD Snooping – multi-switch propagation', () => {
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

        inject(sw1, 0, mldFrame(0x83, GROUP_A));

        expect([...sw1.mcastTable.values()][0]?.ports.has(0)).toBe(true);

        const forwarded = relay(sw1, 1, sw2, 0);
        expect(forwarded).toBe(1);

        expect([...sw2.mcastTable.values()][0]?.ports.has(0)).toBe(true);
        expect(drainCount(sw2, 1)).toBe(1); // flooded toward HostB
    });

    it('multicast data reaches HostB after HostB joins via SW2', () => {
        const { sw1, sw2 } = makeLinkedPair();

        inject(sw2, 1, mldFrame(0x83, GROUP_A));
        relay(sw2, 0, sw1, 1);
        drainCount(sw1, 0);

        inject(sw1, 0, mcastV6DataFrame(GROUP_A));

        const toSW2 = relay(sw1, 1, sw2, 0);
        expect(toSW2).toBe(1);

        expect(drainCount(sw2, 1)).toBe(1);
        expect(drainCount(sw2, 0)).toBe(0);
    });

    it('multicast data does not cross to SW2 when no host on SW2 joined', () => {
        const { sw1, sw2 } = makeLinkedPair();

        inject(sw1, 0, mldFrame(0x83, GROUP_A));
        drainCount(sw1, 1); // drain Report, do NOT relay to SW2

        inject(sw1, 1, mcastV6DataFrame(GROUP_A));

        expect(drainCount(sw1, 0)).toBe(1);
        expect(drainCount(sw1, 1)).toBe(0);
        expect(drainCount(sw2, 0)).toBe(0);
        expect(drainCount(sw2, 1)).toBe(0);
    });

    it('Done propagates and removes uplink from both tables', () => {
        const { sw1, sw2 } = makeLinkedPair();

        inject(sw2, 1, mldFrame(0x83, GROUP_A));
        relay(sw2, 0, sw1, 1);
        drainCount(sw1, 0);

        inject(sw2, 1, mldFrame(0x84, GROUP_A));
        relay(sw2, 0, sw1, 1);
        drainCount(sw1, 0);

        expect(sw2.mcastTable.size).toBe(0);
        expect(sw1.mcastTable.size).toBe(0);
    });
});

// ── IGMP and MLD coexist in the same table ───────────────────────────────────

describe('MLD Snooping – IGMP and MLD coexistence', () => {
    it('IPv4 and IPv6 multicast entries can coexist in mcastTable', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();

        // Build a minimal IGMP Report manually
        const igmpIp = new Uint8Array(28);
        igmpIp[0] = 0x45; igmpIp[9] = 2;
        igmpIp[16] = 224; igmpIp[17] = 1; igmpIp[18] = 2; igmpIp[19] = 3;
        igmpIp[20] = 0x16;
        igmpIp[24] = 224; igmpIp[25] = 1; igmpIp[26] = 2; igmpIp[27] = 3;
        const igmpMac = new Uint8Array([0x01, 0x00, 0x5e, 0x01, 0x02, 0x03]);
        const igmpF = new EthernetFrame({
            srcMac: new Uint8Array([0xaa,0,0,0,0,1]),
            dstMac: igmpMac, etherType: 0x0800, payload: igmpIp,
        });

        bp._processIGMP(0, igmpF);
        bp._processMLD(1, mldFrame(0x83, GROUP_A));

        expect(bp.mcastTable.size).toBe(2);
        const ips = [...bp.mcastTable.values()].map(e => e.ip);
        expect(ips.some(ip => ip.includes('.'))).toBe(true);  // IPv4 entry
        expect(ips.some(ip => ip.includes(':'))).toBe(true);  // IPv6 entry
    });

    it('disabling snooping clears both IPv4 and IPv6 entries', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        bp._processMLD(0, mldFrame(0x83, GROUP_A));
        bp._processMLD(0, mldFrame(0x83, GROUP_B));
        expect(bp.mcastTable.size).toBe(2);

        bp.disableIGMPSnooping();
        expect(bp.mcastTable.size).toBe(0);
    });
});
