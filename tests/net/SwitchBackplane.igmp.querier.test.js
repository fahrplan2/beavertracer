//@ts-check
import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('../../src/net/EthernetLink.js', () => ({ EthernetLink: class EthernetLink {} }));

import { SwitchBackplane } from '../../src/net/SwitchBackplane.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';
import { simTimer } from '../../src/lib/SimTimer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SENTINEL = {};
/** @param {number[]} bytes */
const mac = (bytes) => new Uint8Array(bytes);

const _backplanes = /** @type {SwitchBackplane[]} */ ([]);

afterEach(() => {
    for (const bp of _backplanes) {
        bp.disableIGMPSnooping?.();
        bp.disableSTPFeature?.();
    }
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

/** @param {0x11|0x16|0x17} igmpType @param {[number,number,number,number]} groupIp */
function igmpFrame(igmpType, groupIp, src = mac([0xaa, 0, 0, 0, 0, 1])) {
    const ip = new Uint8Array(28);
    ip[0] = 0x45; ip[9] = 2;
    ip[12] = 192; ip[13] = 168; ip[14] = 1; ip[15] = 1;
    ip[16] = groupIp[0]; ip[17] = groupIp[1]; ip[18] = groupIp[2]; ip[19] = groupIp[3];
    ip[20] = igmpType;
    ip[24] = groupIp[0]; ip[25] = groupIp[1]; ip[26] = groupIp[2]; ip[27] = groupIp[3];
    const dstMac = mac([0x01, 0x00, 0x5e, groupIp[1] & 0x7f, groupIp[2], groupIp[3]]);
    return new EthernetFrame({ srcMac: src, dstMac, etherType: 0x0800, payload: ip });
}

/** @param {0x82|0x83|0x84} mldType @param {number[]} groupBytes16 */
function mldFrame(mldType, groupBytes16, src = mac([0xaa, 0, 0, 0, 0, 1])) {
    const ip6 = new Uint8Array(64);
    ip6[6] = 58;
    ip6[40] = mldType;
    for (let i = 0; i < 16; i++) ip6[48 + i] = groupBytes16[i];
    const dstMac = mac([0x33, 0x33, groupBytes16[12], groupBytes16[13], groupBytes16[14], groupBytes16[15]]);
    return new EthernetFrame({ srcMac: src, dstMac, etherType: 0x86DD, payload: ip6 });
}

const GROUP_A = /** @type {[number,number,number,number]} */ ([224, 1, 2, 3]);
const GROUP_A6 = [0xff, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3];

// ── _mcastExpiry tracking ─────────────────────────────────────────────────────

describe('IGMP Querier – _mcastExpiry tracking', () => {
    it('IGMP Report populates _mcastExpiry for the joining port', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        inject(bp, 0, igmpFrame(0x16, GROUP_A));

        expect(bp._mcastExpiry.size).toBe(1);
        const [groupKey] = bp.mcastTable.keys();
        const portExpiry = bp._mcastExpiry.get(groupKey);
        expect(portExpiry?.has(0)).toBe(true);
        expect(portExpiry?.get(0)).toBeGreaterThan(simTimer.currentTick);
    });

    it('IGMP Leave removes port from _mcastExpiry', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        inject(bp, 0, igmpFrame(0x16, GROUP_A));
        inject(bp, 0, igmpFrame(0x17, GROUP_A));

        expect(bp._mcastExpiry.size).toBe(0);
    });

    it('second IGMP Report from same port refreshes expiry timestamp', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        inject(bp, 0, igmpFrame(0x16, GROUP_A));
        const [groupKey] = bp.mcastTable.keys();
        const before = /** @type {number} */ (bp._mcastExpiry.get(groupKey)?.get(0));

        for (let i = 0; i < 10; i++) simTimer.tick();

        inject(bp, 0, igmpFrame(0x16, GROUP_A));
        const after = /** @type {number} */ (bp._mcastExpiry.get(groupKey)?.get(0));
        expect(after).toBeGreaterThan(before);
    });

    it('MLD Report populates _mcastExpiry', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        inject(bp, 0, mldFrame(0x83, GROUP_A6));

        expect(bp._mcastExpiry.size).toBe(1);
        const [groupKey] = bp.mcastTable.keys();
        expect(bp._mcastExpiry.get(groupKey)?.has(0)).toBe(true);
    });

    it('MLD Done removes port from _mcastExpiry', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        inject(bp, 0, mldFrame(0x83, GROUP_A6));
        inject(bp, 0, mldFrame(0x84, GROUP_A6));

        expect(bp._mcastExpiry.size).toBe(0);
    });

    it('disableIGMPSnooping clears _mcastExpiry and cancels timer', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        inject(bp, 0, igmpFrame(0x16, GROUP_A));
        expect(bp._mcastExpiry.size).toBe(1);

        bp.disableIGMPSnooping();
        expect(bp._mcastExpiry.size).toBe(0);
        expect(bp._igmpQuerierTimer).toBeNull();
    });
});

// ── Querier timer lifecycle ───────────────────────────────────────────────────

describe('IGMP Querier – timer lifecycle', () => {
    it('enableIGMPSnooping registers querier timer', () => {
        const bp = makeBP();
        expect(bp._igmpQuerierTimer).toBeNull();
        bp.enableIGMPSnooping();
        expect(bp._igmpQuerierTimer).not.toBeNull();
    });

    it('disableIGMPSnooping cancels querier timer', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        expect(bp._igmpQuerierTimer).not.toBeNull();
        bp.disableIGMPSnooping();
        expect(bp._igmpQuerierTimer).toBeNull();
    });
});

// ── _expireMcastEntries ───────────────────────────────────────────────────────

describe('IGMP Querier – _expireMcastEntries', () => {
    it('keeps entries whose TTL has not expired', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        inject(bp, 0, igmpFrame(0x16, GROUP_A));

        bp['_expireMcastEntries']();

        expect(bp.mcastTable.size).toBe(1);
    });

    it('removes TTL-expired port from mcastTable and _mcastExpiry', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        inject(bp, 0, igmpFrame(0x16, GROUP_A));
        const [groupKey] = bp.mcastTable.keys();
        bp._mcastExpiry.get(groupKey)?.set(0, simTimer.currentTick - 1);

        bp['_expireMcastEntries']();

        expect(bp.mcastTable.size).toBe(0);
        expect(bp._mcastExpiry.size).toBe(0);
    });

    it('removes unlinked port immediately regardless of TTL', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        inject(bp, 0, igmpFrame(0x16, GROUP_A));
        bp.ports[0].unlink();

        bp['_expireMcastEntries']();

        expect(bp.mcastTable.size).toBe(0);
    });

    it('only removes the expired port when sibling port is still valid', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        linkPort(bp, 1);
        inject(bp, 0, igmpFrame(0x16, GROUP_A));
        inject(bp, 1, igmpFrame(0x16, GROUP_A, mac([0xbb, 0, 0, 0, 0, 2])));
        const [groupKey] = bp.mcastTable.keys();
        bp._mcastExpiry.get(groupKey)?.set(0, simTimer.currentTick - 1);

        bp['_expireMcastEntries']();

        const entry = bp.mcastTable.get(groupKey);
        expect(entry).toBeDefined();
        expect(entry?.ports.has(0)).toBe(false);
        expect(entry?.ports.has(1)).toBe(true);
    });

    it('removes group entirely when all ports expire', () => {
        const bp = makeBP();
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        linkPort(bp, 1);
        inject(bp, 0, igmpFrame(0x16, GROUP_A));
        inject(bp, 1, igmpFrame(0x16, GROUP_A, mac([0xbb, 0, 0, 0, 0, 2])));
        const [groupKey] = bp.mcastTable.keys();
        bp._mcastExpiry.get(groupKey)?.set(0, simTimer.currentTick - 1);
        bp._mcastExpiry.get(groupKey)?.set(1, simTimer.currentTick - 1);

        bp['_expireMcastEntries']();

        expect(bp.mcastTable.has(groupKey)).toBe(false);
        expect(bp._mcastExpiry.has(groupKey)).toBe(false);
    });
});

// ── _buildIGMPQueryFrame ──────────────────────────────────────────────────────

describe('IGMP Querier – _buildIGMPQueryFrame', () => {
    it('returns an EthernetFrame with etherType 0x0800', () => {
        const bp = makeBP();
        const frame = bp['_buildIGMPQueryFrame']();
        expect(frame).toBeInstanceOf(EthernetFrame);
        expect(frame.etherType).toBe(0x0800);
    });

    it('uses dst MAC 01:00:5e:00:00:01 (224.0.0.1)', () => {
        const bp = makeBP();
        const frame = bp['_buildIGMPQueryFrame']();
        expect(Array.from(frame.dstMac)).toEqual([0x01, 0x00, 0x5e, 0x00, 0x00, 0x01]);
    });

    it('sets IGMP type byte 0x11 (General Query)', () => {
        const bp = makeBP();
        const frame = bp['_buildIGMPQueryFrame']();
        // payload: 20-byte IP header then IGMP; type at payload[20]
        expect(frame.payload[20]).toBe(0x11);
    });
});

// ── _buildMLDQueryFrame ───────────────────────────────────────────────────────

describe('IGMP Querier – _buildMLDQueryFrame', () => {
    it('returns an EthernetFrame with etherType 0x86DD', () => {
        const bp = makeBP();
        const frame = bp['_buildMLDQueryFrame']();
        expect(frame).toBeInstanceOf(EthernetFrame);
        expect(frame.etherType).toBe(0x86DD);
    });

    it('uses dst MAC 33:33:00:00:00:01 (ff02::1)', () => {
        const bp = makeBP();
        const frame = bp['_buildMLDQueryFrame']();
        expect(Array.from(frame.dstMac)).toEqual([0x33, 0x33, 0x00, 0x00, 0x00, 0x01]);
    });

    it('sets ICMPv6 type byte 0x82 (MLD Query)', () => {
        const bp = makeBP();
        const frame = bp['_buildMLDQueryFrame']();
        // payload: 40-byte IPv6 header then ICMPv6; type at payload[40]
        expect(frame.payload[40]).toBe(0x82);
    });
});

// ── _sendGeneralQueries ───────────────────────────────────────────────────────

describe('IGMP Querier – _sendGeneralQueries', () => {
    it('sends IGMP and MLD query frames on every linked port', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        linkPort(bp, 0);
        linkPort(bp, 2);

        bp['_sendGeneralQueries']();

        let count0 = 0, count2 = 0;
        while (bp.ports[0].getNextOutgoingFrame() != null) count0++;
        while (bp.ports[2].getNextOutgoingFrame() != null) count2++;
        expect(count0).toBe(2);
        expect(count2).toBe(2);
    });

    it('sends nothing on unlinked ports', () => {
        const bp = makeBP(4);
        bp.enableIGMPSnooping();
        linkPort(bp, 0);

        bp['_sendGeneralQueries']();

        while (bp.ports[0].getNextOutgoingFrame() != null) {}
        expect(bp.ports[1].getNextOutgoingFrame()).toBeNull();
        expect(bp.ports[2].getNextOutgoingFrame()).toBeNull();
        expect(bp.ports[3].getNextOutgoingFrame()).toBeNull();
    });
});
