//@ts-check
import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('../../src/net/EthernetLink.js', () => ({ EthernetLink: class EthernetLink {} }));

import { SwitchBackplane } from '../../src/net/SwitchBackplane.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';
import { MACToNumber } from '../../src/lib/helpers.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SENTINEL = {};
const BCAST = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

/** @param {number[]} bytes */
const mac = (bytes) => new Uint8Array(bytes);

/**
 * Untagged unicast frame.
 * @param {Uint8Array} src
 * @param {Uint8Array} [dst]
 */
function frame(src, dst = BCAST) {
    return new EthernetFrame({ srcMac: src, dstMac: dst, etherType: 0x0800, payload: new Uint8Array(4) });
}

/**
 * Tagged frame with the given VID.
 * @param {Uint8Array} src
 * @param {number} vid
 * @param {Uint8Array} [dst]
 */
function taggedFrame(src, vid, dst = BCAST) {
    const f = new EthernetFrame({ srcMac: src, dstMac: dst, etherType: 0x0800, payload: new Uint8Array(4) });
    f.vlan = { vid };
    return f;
}

const _backplanes = /** @type {SwitchBackplane[]} */ ([]);

afterEach(() => {
    for (const bp of _backplanes) bp.disableSTPFeature?.();
    _backplanes.length = 0;
});

/** @param {number} [nPorts] */
function makeBP(nPorts = 4) {
    const bp = new SwitchBackplane(nPorts);
    bp.enableVLANFeature();
    _backplanes.push(bp);
    return bp;
}

function linkPort(bp, idx) {
    bp.ports[idx].link(/** @type {any} */ (SENTINEL));
}

/** Inject a packed frame into port i and run one update cycle. */
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

/** Drain the next outgoing frame from a port and parse it. */
function drainOne(bp, portIdx) {
    const raw = bp.ports[portIdx].getNextOutgoingFrame();
    return raw ? EthernetFrame.fromBytes(raw) : null;
}

// ── EthernetPort VLAN config ──────────────────────────────────────────────────

describe('VLAN – port config', () => {
    it('default port is untagged on PVID 1', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        expect(p.vlanMode).toBe('untagged');
        expect(p.pvid).toBe(1);
    });

    it('setUntagged sets mode and pvid', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setUntagged(10);
        expect(p.vlanMode).toBe('untagged');
        expect(p.pvid).toBe(10);
    });

    it('setTagged sets mode, pvid and allowedVlans', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setTagged([10, 20, 30], 10);
        expect(p.vlanMode).toBe('tagged');
        expect(p.pvid).toBe(10);
        expect(p.allowedVlans.has(10)).toBe(true);
        expect(p.allowedVlans.has(20)).toBe(true);
        expect(p.allowedVlans.has(99)).toBe(false);
    });

    it('setHybrid sets mode, pvid and allowedVlans (pvid not in allowedVlans)', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        expect(p.vlanMode).toBe('hybrid');
        expect(p.pvid).toBe(10);
        expect(p.allowedVlans.has(20)).toBe(true);
        expect(p.allowedVlans.has(30)).toBe(true);
        expect(p.allowedVlans.has(10)).toBe(false); // pvid is separate from tagged list
        expect(p.allowedVlans.has(99)).toBe(false);
    });
});

// ── Ingress VLAN policy ───────────────────────────────────────────────────────

describe('VLAN – ingress policy (getIngressVid)', () => {
    it('untagged port: untagged frame gets pvid', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setUntagged(10);
        const vid = bp.getIngressVid(p, frame(mac([0xaa, 0, 0, 0, 0, 1])));
        expect(vid).toBe(10);
    });

    it('untagged port: tagged frame is dropped (returns null)', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setUntagged(10);
        const vid = bp.getIngressVid(p, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 10));
        expect(vid).toBeNull();
    });

    it('tagged port: untagged frame gets pvid', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setTagged([10, 20], 10);
        const vid = bp.getIngressVid(p, frame(mac([0xaa, 0, 0, 0, 0, 1])));
        expect(vid).toBe(10);
    });

    it('tagged port: tagged frame with allowed VID passes', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setTagged([10, 20], 10);
        const vid = bp.getIngressVid(p, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 20));
        expect(vid).toBe(20);
    });

    it('tagged port: tagged frame with disallowed VID is dropped', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setTagged([10, 20], 10);
        const vid = bp.getIngressVid(p, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 99));
        expect(vid).toBeNull();
    });

    it('hybrid port: untagged frame gets pvid', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        const vid = bp.getIngressVid(p, frame(mac([0xaa, 0, 0, 0, 0, 1])));
        expect(vid).toBe(10);
    });

    it('hybrid port: tagged frame with pvid is accepted', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        const vid = bp.getIngressVid(p, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 10));
        expect(vid).toBe(10);
    });

    it('hybrid port: tagged frame with allowed VID passes', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        const vid = bp.getIngressVid(p, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 20));
        expect(vid).toBe(20);
    });

    it('hybrid port: tagged frame with disallowed VID is dropped', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        const vid = bp.getIngressVid(p, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 99));
        expect(vid).toBeNull();
    });
});

// ── Egress VLAN policy ────────────────────────────────────────────────────────

describe('VLAN – egress policy (portAllowsVid)', () => {
    it('untagged port: allows only its pvid', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setUntagged(10);
        expect(bp.portAllowsVid(p, 10)).toBe(true);
        expect(bp.portAllowsVid(p, 20)).toBe(false);
    });

    it('tagged port: allows all vids in allowedVlans', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setTagged([10, 20, 30], 10);
        expect(bp.portAllowsVid(p, 10)).toBe(true);
        expect(bp.portAllowsVid(p, 20)).toBe(true);
        expect(bp.portAllowsVid(p, 99)).toBe(false);
    });

    it('hybrid port: allows pvid', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        expect(bp.portAllowsVid(p, 10)).toBe(true);
    });

    it('hybrid port: allows VIDs in allowedVlans', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        expect(bp.portAllowsVid(p, 20)).toBe(true);
        expect(bp.portAllowsVid(p, 30)).toBe(true);
    });

    it('hybrid port: rejects VIDs not in pvid or allowedVlans', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        expect(bp.portAllowsVid(p, 99)).toBe(false);
    });
});

// ── sendOut: tagging/stripping ────────────────────────────────────────────────

describe('VLAN – sendOut tagging', () => {
    it('untagged port: frame egresses without VLAN tag', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setUntagged(10);
        linkPort(bp, 0);
        const f = frame(mac([0xaa, 0, 0, 0, 0, 1]));
        bp.sendOut(10, p, f);
        const out = drainOne(bp, 0);
        expect(out).not.toBeNull();
        expect(out?.vlan).toBeNull();
    });

    it('untagged port: frame with wrong VID is not sent', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setUntagged(10);
        linkPort(bp, 0);
        const f = frame(mac([0xaa, 0, 0, 0, 0, 1]));
        bp.sendOut(20, p, f);
        expect(drainCount(bp, 0)).toBe(0);
    });

    it('tagged port: frame egresses with correct VLAN tag', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setTagged([10, 20], 10);
        linkPort(bp, 0);
        const f = frame(mac([0xaa, 0, 0, 0, 0, 1]));
        bp.sendOut(20, p, f);
        const out = drainOne(bp, 0);
        expect(out).not.toBeNull();
        expect(out?.vlan?.vid).toBe(20);
    });

    it('tagged port: disallowed VID is not sent', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setTagged([10, 20], 10);
        linkPort(bp, 0);
        const f = frame(mac([0xaa, 0, 0, 0, 0, 1]));
        bp.sendOut(99, p, f);
        expect(drainCount(bp, 0)).toBe(0);
    });

    it('hybrid port: pvid frame egresses untagged', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        linkPort(bp, 0);
        bp.sendOut(10, p, frame(mac([0xaa, 0, 0, 0, 0, 1])));
        const out = drainOne(bp, 0);
        expect(out).not.toBeNull();
        expect(out?.vlan).toBeNull();
    });

    it('hybrid port: allowed tagged VID egresses with tag', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        linkPort(bp, 0);
        bp.sendOut(20, p, frame(mac([0xaa, 0, 0, 0, 0, 1])));
        const out = drainOne(bp, 0);
        expect(out).not.toBeNull();
        expect(out?.vlan?.vid).toBe(20);
    });

    it('hybrid port: disallowed VID is not sent', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.setHybrid(10, [20, 30]);
        linkPort(bp, 0);
        bp.sendOut(99, p, frame(mac([0xaa, 0, 0, 0, 0, 1])));
        expect(drainCount(bp, 0)).toBe(0);
    });
});

// ── VLAN isolation (broadcast flood) ─────────────────────────────────────────

describe('VLAN – broadcast isolation', () => {
    it('broadcast on VLAN 10 does not reach ports in VLAN 20', () => {
        // port 0: ingress, untagged VLAN 10
        // port 1: untagged VLAN 10  → should receive
        // port 2: untagged VLAN 20  → must NOT receive
        const bp = makeBP();
        bp.ports[0].setUntagged(10);
        bp.ports[1].setUntagged(10);
        bp.ports[2].setUntagged(20);
        linkPort(bp, 0);
        linkPort(bp, 1);
        linkPort(bp, 2);

        inject(bp, 0, frame(mac([0xaa, 0, 0, 0, 0, 1])));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(0);
    });

    it('broadcast on tagged trunk reaches only ports that allow the VID', () => {
        // port 0: tagged trunk allowing VIDs 10 and 20 (ingress tagged VID 10)
        // port 1: tagged trunk allowing VIDs 10 and 20 → should receive (VID 10)
        // port 2: untagged VLAN 10 → should receive (stripped)
        // port 3: untagged VLAN 20 → must NOT receive
        const bp = makeBP();
        bp.ports[0].setTagged([10, 20], 10);
        bp.ports[1].setTagged([10, 20], 10);
        bp.ports[2].setUntagged(10);
        bp.ports[3].setUntagged(20);
        linkPort(bp, 0);
        linkPort(bp, 1);
        linkPort(bp, 2);
        linkPort(bp, 3);

        inject(bp, 0, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 10));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(1);
        expect(drainCount(bp, 3)).toBe(0);
    });

    it('hybrid port receives pvid traffic untagged from a trunk', () => {
        // port 0: tagged trunk (VIDs 10, 20)
        // port 1: hybrid pvid=10, tagged=[20]
        const bp = makeBP(4);
        bp.ports[0].setTagged([10, 20], 10);
        bp.ports[1].setHybrid(10, [20]);
        linkPort(bp, 0);
        linkPort(bp, 1);

        inject(bp, 0, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 10));

        const out = drainOne(bp, 1);
        expect(out).not.toBeNull();
        expect(out?.vlan).toBeNull(); // pvid → untagged on egress
    });

    it('hybrid port receives tagged-vlan traffic with tag preserved', () => {
        const bp = makeBP(4);
        bp.ports[0].setTagged([10, 20], 10);
        bp.ports[1].setHybrid(10, [20]);
        linkPort(bp, 0);
        linkPort(bp, 1);

        inject(bp, 0, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 20));

        const out = drainOne(bp, 1);
        expect(out).not.toBeNull();
        expect(out?.vlan?.vid).toBe(20); // tagged VLAN → stays tagged
    });

    it('hybrid port does not receive traffic from a foreign VLAN', () => {
        const bp = makeBP(4);
        bp.ports[0].setUntagged(30); // ingress VLAN 30
        bp.ports[1].setHybrid(10, [20]);
        linkPort(bp, 0);
        linkPort(bp, 1);

        inject(bp, 0, frame(mac([0xaa, 0, 0, 0, 0, 1])));

        expect(drainCount(bp, 1)).toBe(0);
    });

    it('untagged ingress on hybrid port enters pvid VLAN and floods correctly', () => {
        // port 0: hybrid pvid=10, tagged=[20] (ingress, untagged frame)
        // port 1: untagged VLAN 10  → should receive
        // port 2: untagged VLAN 20  → must NOT receive (different VLAN)
        const bp = makeBP(4);
        bp.ports[0].setHybrid(10, [20]);
        bp.ports[1].setUntagged(10);
        bp.ports[2].setUntagged(20);
        linkPort(bp, 0);
        linkPort(bp, 1);
        linkPort(bp, 2);

        inject(bp, 0, frame(mac([0xaa, 0, 0, 0, 0, 1]))); // untagged → PVID 10

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(0);
    });

    it('broadcast does not loop back to the ingress port', () => {
        const bp = makeBP();
        bp.ports[0].setUntagged(10);
        bp.ports[1].setUntagged(10);
        linkPort(bp, 0);
        linkPort(bp, 1);

        inject(bp, 0, frame(mac([0xaa, 0, 0, 0, 0, 1])));

        expect(drainCount(bp, 0)).toBe(0);
    });
});

// ── Per-VLAN MAC learning and unicast ─────────────────────────────────────────

describe('VLAN – MAC learning and unicast forwarding', () => {
    it('MAC is learned per VLAN (SAT keyed by VID)', () => {
        const bp = makeBP();
        bp.ports[0].setUntagged(10);
        linkPort(bp, 0);

        const src = mac([0xaa, 0, 0, 0, 0, 1]);
        inject(bp, 0, frame(src));

        const vlanMap = bp.sat.get(10);
        expect(vlanMap).toBeDefined();
        expect(vlanMap?.get(MACToNumber(src))).toBe(0);
    });

    it('MACs learned on different VLANs do not collide in the SAT', () => {
        const bp = makeBP();
        bp.ports[0].setUntagged(10);
        bp.ports[1].setUntagged(20);
        linkPort(bp, 0);
        linkPort(bp, 1);

        const src = mac([0xaa, 0, 0, 0, 0, 1]);
        inject(bp, 0, frame(src));
        inject(bp, 1, frame(src)); // same MAC, different VLAN

        expect(bp.sat.get(10)?.get(MACToNumber(src))).toBe(0);
        expect(bp.sat.get(20)?.get(MACToNumber(src))).toBe(1);
    });

    it('known unicast is forwarded only to the correct port within the VLAN', () => {
        // port 0: untagged VLAN 10 (source/ingress)
        // port 1: untagged VLAN 10 (known destination)
        // port 2: untagged VLAN 10 (should NOT receive — not the known destination)
        const bp = makeBP();
        bp.ports[0].setUntagged(10);
        bp.ports[1].setUntagged(10);
        bp.ports[2].setUntagged(10);
        linkPort(bp, 0);
        linkPort(bp, 1);
        linkPort(bp, 2);

        const dst = mac([0xbb, 0, 0, 0, 0, 1]);
        const src = mac([0xaa, 0, 0, 0, 0, 1]);

        // teach SAT: dst is at port 1 in VLAN 10
        const vlanMap = new Map();
        vlanMap.set(MACToNumber(dst), 1);
        bp.sat.set(10, vlanMap);

        inject(bp, 0, frame(src, dst));

        expect(drainCount(bp, 1)).toBe(1);
        expect(drainCount(bp, 2)).toBe(0);
    });

    it('known unicast is not forwarded across VLAN boundary', () => {
        // dst is known at port 1 (VLAN 10), but ingress is port 0 on VLAN 20
        const bp = makeBP();
        bp.ports[0].setUntagged(20);
        bp.ports[1].setUntagged(10);
        linkPort(bp, 0);
        linkPort(bp, 1);

        const dst = mac([0xbb, 0, 0, 0, 0, 1]);
        const src = mac([0xaa, 0, 0, 0, 0, 1]);

        const vlanMap = new Map();
        vlanMap.set(MACToNumber(dst), 1);
        bp.sat.set(10, vlanMap); // dst known in VLAN 10, not VLAN 20

        inject(bp, 0, frame(src, dst)); // ingress on VLAN 20 → floods within 20

        // port 1 is in VLAN 10 only, so it must not receive the frame
        expect(drainCount(bp, 1)).toBe(0);
    });
});

// ── QinQ (IEEE 802.1ad) ──────────────────────────────────────────────────────

describe('QinQ – getIngressVid', () => {
    it('QinQ port returns svid regardless of frame tag state', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.svid = 100;
        // untagged frame
        expect(bp.getIngressVid(p, frame(mac([0xaa, 0, 0, 0, 0, 1])))).toBe(100);
        // C-tagged frame
        expect(bp.getIngressVid(p, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 42))).toBe(100);
    });
});

describe('QinQ – portAllowsVid', () => {
    it('QinQ port allows only its svid', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.svid = 100;
        expect(bp.portAllowsVid(p, 100)).toBe(true);
        expect(bp.portAllowsVid(p, 200)).toBe(false);
    });
});

describe('QinQ – sendOut (pop)', () => {
    it('QinQ egress port pops the outer S-tag', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.svid = 100;
        linkPort(bp, 0);

        // Frame with S-tag pushed (simulates what update() does on ingress)
        const f = frame(mac([0xaa, 0, 0, 0, 0, 1]));
        f.svlan = { vid: 100 };
        f.vlan  = { vid: 42 }; // inner C-tag preserved

        bp.sendOut(100, p, f);

        const out = drainOne(bp, 0);
        expect(out).not.toBeNull();
        expect(out?.svlan).toBeNull();  // S-tag popped
        expect(out?.vlan?.vid).toBe(42); // C-tag preserved
    });

    it('QinQ egress port drops frame with wrong S-VID', () => {
        const bp = makeBP();
        const p = bp.ports[0];
        p.svid = 100;
        linkPort(bp, 0);

        const f = frame(mac([0xaa, 0, 0, 0, 0, 1]));
        f.svlan = { vid: 200 }; // wrong S-VID

        bp.sendOut(200, p, f);
        expect(drainCount(bp, 0)).toBe(0);
    });
});

describe('QinQ – end-to-end push/pop', () => {
    it('frame arriving on QinQ UNI exits opposite QinQ UNI without S-tag', () => {
        // port 0: QinQ UNI, svid=100, untagged customer traffic
        // port 1: QinQ UNI, svid=100, same S-VLAN → should receive without S-tag
        const bp = makeBP(4);
        bp.ports[0].svid = 100;
        bp.ports[1].svid = 100;
        linkPort(bp, 0);
        linkPort(bp, 1);

        // Customer sends untagged broadcast
        inject(bp, 0, frame(mac([0xaa, 0, 0, 0, 0, 1])));

        const out = drainOne(bp, 1);
        expect(out).not.toBeNull();
        expect(out?.svlan).toBeNull(); // S-tag popped on egress
        expect(out?.vlan).toBeNull();  // was untagged originally
    });

    it('C-tag is preserved end-to-end through QinQ switch', () => {
        // Customer sends C-tagged frame (VID 42); switch wraps in S-tag (VID 100)
        const bp = makeBP(4);
        bp.ports[0].svid = 100;
        bp.ports[1].svid = 100;
        linkPort(bp, 0);
        linkPort(bp, 1);

        inject(bp, 0, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 42));

        const out = drainOne(bp, 1);
        expect(out).not.toBeNull();
        expect(out?.svlan).toBeNull();  // S-tag popped
        expect(out?.vlan?.vid).toBe(42); // C-tag intact
    });

    it('QinQ ports in different S-VLANs are isolated', () => {
        // port 0: svid=100, port 1: svid=200 → traffic must not cross
        const bp = makeBP(4);
        bp.ports[0].svid = 100;
        bp.ports[1].svid = 200;
        linkPort(bp, 0);
        linkPort(bp, 1);

        inject(bp, 0, frame(mac([0xaa, 0, 0, 0, 0, 1])));

        expect(drainCount(bp, 1)).toBe(0);
    });

    it('trunk port (tagged) carries double-tagged frame between two QinQ domains', () => {
        // port 0: QinQ UNI svid=100, port 2: trunk (tagged, allows S-VID 100), port 3: QinQ UNI svid=100
        const bp = makeBP(4);
        bp.ports[0].svid = 100;
        bp.ports[2].setTagged([100], 100); // NNI trunk
        bp.ports[3].svid = 100;
        linkPort(bp, 0);
        linkPort(bp, 2);
        linkPort(bp, 3);

        // Inject untagged from UNI
        inject(bp, 0, frame(mac([0xaa, 0, 0, 0, 0, 1])));

        // Trunk port (port 2) should receive double-tagged frame (S-tag + no C-tag)
        const trunkOut = drainOne(bp, 2);
        expect(trunkOut).not.toBeNull();
        expect(trunkOut?.svlan?.vid).toBe(100);

        // UNI port (port 3) should receive with S-tag popped
        const uniOut = drainOne(bp, 3);
        expect(uniOut).not.toBeNull();
        expect(uniOut?.svlan).toBeNull();
    });

    it('customer C-tag survives the S-tagged trunk hop unmodified', () => {
        // port 0: QinQ UNI svid=100, port 2: trunk (tagged, allows S-VID 100), port 3: QinQ UNI svid=100
        const bp = makeBP(4);
        bp.ports[0].svid = 100;
        bp.ports[2].setTagged([100], 100); // NNI trunk
        bp.ports[3].svid = 100;
        linkPort(bp, 0);
        linkPort(bp, 2);
        linkPort(bp, 3);

        // Customer sends a C-tagged frame (VID 42) into the QinQ UNI
        inject(bp, 0, taggedFrame(mac([0xaa, 0, 0, 0, 0, 1]), 42));

        // Trunk port must carry S-tag=100 while leaving the C-tag untouched
        const trunkOut = drainOne(bp, 2);
        expect(trunkOut?.svlan?.vid).toBe(100);
        expect(trunkOut?.vlan?.vid).toBe(42);

        // Opposite QinQ UNI must deliver with S-tag popped and C-tag intact
        const uniOut = drainOne(bp, 3);
        expect(uniOut?.svlan).toBeNull();
        expect(uniOut?.vlan?.vid).toBe(42);
    });
});

describe('QinQ – EthernetFrame double-tag pack/fromBytes', () => {
    it('pack produces 0x88a8 outer + 0x8100 inner headers', () => {
        const f = new EthernetFrame({ srcMac: mac([0xaa, 0, 0, 0, 0, 1]), dstMac: mac([0xbb, 0, 0, 0, 0, 2]), etherType: 0x0800 });
        f.svlan = { vid: 100 };
        f.vlan  = { vid: 42 };
        const bytes = f.pack();
        expect(bytes[12]).toBe(0x88);
        expect(bytes[13]).toBe(0xa8);
        expect(((bytes[14] << 8) | bytes[15]) & 0x0fff).toBe(100);
        expect(bytes[16]).toBe(0x81);
        expect(bytes[17]).toBe(0x00);
        expect(((bytes[18] << 8) | bytes[19]) & 0x0fff).toBe(42);
    });

    it('fromBytes round-trips double-tagged frame', () => {
        const f = new EthernetFrame({ srcMac: mac([0xaa, 0, 0, 0, 0, 1]), dstMac: mac([0xbb, 0, 0, 0, 0, 2]), etherType: 0x0800 });
        f.svlan = { vid: 100, pcp: 2 };
        f.vlan  = { vid: 42,  pcp: 0 };
        const parsed = EthernetFrame.fromBytes(f.pack());
        expect(parsed.svlan?.vid).toBe(100);
        expect(parsed.svlan?.pcp).toBe(2);
        expect(parsed.vlan?.vid).toBe(42);
        expect(parsed.etherType).toBe(0x0800);
    });
});

// ── LAG + VLAN integration ────────────────────────────────────────────────────

describe('VLAN + LAG integration', () => {
    it('broadcast on VLAN 10 reaches exactly one LAG member', () => {
        const bp = makeBP(4);
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        bp.ports[0].setUntagged(10);
        bp.ports[1].setUntagged(10);
        bp.ports[2].setUntagged(10); // ingress
        linkPort(bp, 0);
        linkPort(bp, 1);
        linkPort(bp, 2);

        inject(bp, 2, frame(mac([0xaa, 0, 0, 0, 0, 1])));

        const toPort0 = drainCount(bp, 0);
        const toPort1 = drainCount(bp, 1);
        expect(toPort0 + toPort1).toBe(1);
    });

    it('broadcast does not cross VLAN boundary even through a LAG', () => {
        const bp = makeBP(4);
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        bp.ports[0].setUntagged(20); // bond in VLAN 20
        bp.ports[1].setUntagged(20);
        bp.ports[2].setUntagged(10); // ingress, VLAN 10
        linkPort(bp, 0);
        linkPort(bp, 1);
        linkPort(bp, 2);

        inject(bp, 2, frame(mac([0xaa, 0, 0, 0, 0, 1])));

        expect(drainCount(bp, 0)).toBe(0);
        expect(drainCount(bp, 1)).toBe(0);
    });

    it('MAC learned on LAG member is stored under the representative in per-VLAN SAT', () => {
        const bp = makeBP(4);
        const g = bp.createLagGroup();
        bp.addPortToLag(0, g.id);
        bp.addPortToLag(1, g.id);
        bp.ports[0].setUntagged(10);
        bp.ports[1].setUntagged(10);
        linkPort(bp, 1); // only non-rep is linked

        const src = mac([0xaa, 0, 0, 0, 0, 1]);
        inject(bp, 1, frame(src));

        // learned at the representative (port 0), not the physical ingress (port 1)
        expect(bp.sat.get(10)?.get(MACToNumber(src))).toBe(0);
    });
});

// ── Serialization ─────────────────────────────────────────────────────────────

/** Mirror of Switch.toJSON() VLAN section */
function vlanSerialize(bp) {
    return {
        vlanEnabled: bp.vlanEnabled,
        vlanPorts: bp.ports.map(p => ({
            vlanMode: p.vlanMode,
            pvid: p.pvid,
            allowedVlans: [...p.allowedVlans].sort((a, b) => a - b),
        })),
    };
}

/** Mirror of Switch.fromJSON() VLAN restore block */
function vlanRestore(bp, json) {
    if (json.vlanEnabled) bp.enableVLANFeature();
    else bp.disableVLANFeature();
    if (Array.isArray(json.vlanPorts)) {
        for (let i = 0; i < bp.ports.length && i < json.vlanPorts.length; i++) {
            const cfg = json.vlanPorts[i];
            if (cfg.vlanMode === 'tagged') {
                bp.ports[i].setTagged(cfg.allowedVlans ?? [cfg.pvid], cfg.pvid);
            } else if (cfg.vlanMode === 'hybrid') {
                bp.ports[i].setHybrid(cfg.pvid ?? 1, cfg.allowedVlans ?? []);
            } else {
                bp.ports[i].setUntagged(cfg.pvid ?? 1);
            }
        }
    }
}

describe('VLAN – serialization roundtrip', () => {
    it('preserves vlanEnabled flag', () => {
        const bp = makeBP();
        const json = vlanSerialize(bp);
        const bp2 = new SwitchBackplane(4);
        vlanRestore(bp2, json);
        expect(bp2.vlanEnabled).toBe(true);
    });

    it('preserves untagged port config', () => {
        const bp = makeBP();
        bp.ports[0].setUntagged(42);
        const json = vlanSerialize(bp);
        const bp2 = new SwitchBackplane(4);
        vlanRestore(bp2, json);
        expect(bp2.ports[0].vlanMode).toBe('untagged');
        expect(bp2.ports[0].pvid).toBe(42);
    });

    it('preserves tagged port config including allowedVlans', () => {
        const bp = makeBP();
        bp.ports[1].setTagged([10, 20, 30], 10);
        const json = vlanSerialize(bp);
        const bp2 = new SwitchBackplane(4);
        vlanRestore(bp2, json);
        expect(bp2.ports[1].vlanMode).toBe('tagged');
        expect(bp2.ports[1].pvid).toBe(10);
        expect([...bp2.ports[1].allowedVlans].sort((a, b) => a - b)).toEqual([10, 20, 30]);
    });

    it('preserves hybrid port config', () => {
        const bp = makeBP();
        bp.ports[2].setHybrid(10, [20, 30]);
        const json = vlanSerialize(bp);
        const bp2 = new SwitchBackplane(4);
        vlanRestore(bp2, json);
        expect(bp2.ports[2].vlanMode).toBe('hybrid');
        expect(bp2.ports[2].pvid).toBe(10);
        expect([...bp2.ports[2].allowedVlans].sort((a, b) => a - b)).toEqual([20, 30]);
    });

    it('disabledVLAN flag survives roundtrip', () => {
        const bp = new SwitchBackplane(4); // vlanEnabled = false by default
        const json = vlanSerialize(bp);
        const bp2 = new SwitchBackplane(4);
        bp2.enableVLANFeature();
        vlanRestore(bp2, json);
        expect(bp2.vlanEnabled).toBe(false);
    });
});
