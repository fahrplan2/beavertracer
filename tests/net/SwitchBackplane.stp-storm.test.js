//@ts-check
// Broadcast storms vs. STP/RSTP: BPDU priority queueing, discarding queued data on
// blocked ports, and RSTP ↔ STP interoperability (IEEE 802.1w Port Protocol Migration).
import { vi, describe, it, expect, afterEach } from 'vitest';

// Break the EthernetLink → SimControl import chain (see SwitchBackplane.rstp.test.js)
vi.mock('../../src/net/EthernetLink.js', () => ({ EthernetLink: class EthernetLink {} }));

import { SwitchBackplane, STP_STATE } from '../../src/net/SwitchBackplane.js';
import { EthernetPort } from '../../src/net/EthernetPort.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';
import { STPBPDU } from '../../src/net/pdu/STPBPDU.js';
import { simTimer, SimTimer } from '../../src/lib/SimTimer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _backplanes = [];
let _wires      = [];

afterEach(() => {
    for (const bp of _backplanes) bp.disableSTPFeature();
    for (const w  of _wires)      w.destroy();
    _backplanes = [];
    _wires      = [];
});

const FWD_TICKS = SimTimer.toTicks(SimTimer.STP_FORWARD_DELAY_MS);

/**
 * @param {bigint} id
 * @param {'off'|'stp'|'rstp'} [mode]
 */
function makeSwitch(id, mode = 'off') {
    const bp = new SwitchBackplane(4);
    bp.setBridgeId(id);
    if (mode === 'stp')  bp.enableSTPFeature();
    if (mode === 'rstp') bp.enableRSTPFeature();
    _backplanes.push(bp);
    return bp;
}

/** @param {SwitchBackplane} bp @param {'stp'|'rstp'} mode */
function enable(bp, mode) {
    if (mode === 'stp') bp.enableSTPFeature(); else bp.enableRSTPFeature();
}

/**
 * Cable between two ports that, like EthernetLink, moves at most one frame per
 * direction per tick. `data` counts transferred non-BPDU frames.
 * @param {EthernetPort} a
 * @param {EthernetPort} b
 */
function wire(a, b) {
    const sentinel = {};
    a.link(/** @type {any} */ (sentinel));
    b.link(/** @type {any} */ (sentinel));
    const w = {
        data: 0,
        transfer() {
            const ab = a.getNextOutgoingFrame();
            const ba = b.getNextOutgoingFrame();
            for (const f of [ab, ba]) if (f && !isBpduBytes(f)) w.data++;
            if (ab) b.recieve(ab);
            if (ba) a.recieve(ba);
        },
        destroy() { a.unlink(); b.unlink(); },
    };
    _wires.push(w);
    return w;
}

/** 802.3 length field (< 0x0600) + STP multicast = BPDU in this simulator. @param {Uint8Array} f */
function isBpduBytes(f) {
    return ((f[12] << 8) | f[13]) < 0x0600 && f[0] === 0x01 && f[1] === 0x80 && f[2] === 0xc2;
}

/** @param {number} n @param {Array<{transfer():void}>} wires */
function tick(n, wires) {
    for (let i = 0; i < n; i++) {
        simTimer.tick();
        for (const w of wires) w.transfer();
    }
}

/** @param {{data:number}[]} wires */
const dataCount = (wires) => wires.reduce((a, w) => a + w.data, 0);
/** @param {{data:number}[]} wires */
const resetCount = (wires) => { for (const w of wires) w.data = 0; };

/** @param {number} [vid] */
function broadcastFrame(vid) {
    const f = new EthernetFrame({
        dstMac: new Uint8Array(6).fill(0xff),
        srcMac: new Uint8Array([0x02, 0, 0, 0, 0, 0x09]),
        etherType: 0x0800,
        payload: new Uint8Array(46),
    });
    if (vid != null) f.vlan = { vid };
    return f;
}

/** Inject a broadcast as if a host on port 3 sent it. @param {SwitchBackplane} bp @param {number} [vid] */
function inject(bp, vid) {
    bp.ports[3].recieve(broadcastFrame(vid).pack());
}

/**
 * Ring of switches: sw[k].port0 ↔ sw[k+1].port1. Port 3 is the (unlinked) host port.
 * @param {SwitchBackplane[]} sws
 */
function ring(sws) {
    return sws.map((sw, k) => wire(sw.ports[0], sws[(k + 1) % sws.length].ports[1]));
}

/** @param {SwitchBackplane[]} sws */
function blockedRingPorts(sws) {
    let n = 0;
    for (const sw of sws) for (const p of [0, 1]) {
        if (sw.stpPortState[p] !== STP_STATE.FORWARDING) n++;
    }
    return n;
}

// ── EthernetPort priority queue ───────────────────────────────────────────────

describe('EthernetPort – priority (control) frames', () => {
    it('priority frames go ahead of data, in their own FIFO order', () => {
        const p = new EthernetPort('p');
        const d1 = broadcastFrame(), d2 = broadcastFrame(), c1 = broadcastFrame(), c2 = broadcastFrame();
        p.send(d1);
        p.send(c1, true);
        p.send(d2);
        p.send(c2, true);
        expect(p.outBuffer).toEqual([c1, c2, d1, d2]);
        expect(p.outBuffer[0]).toBe(c1);
        expect(p.outBuffer[1]).toBe(c2);
    });

    it('a full queue drops data but never priority frames', () => {
        const p = new EthernetPort('p');
        for (let i = 0; i < 150; i++) p.send(broadcastFrame());
        const len = p.outBuffer.length;
        const c = broadcastFrame();
        p.send(c, true);
        expect(p.outBuffer.length).toBe(len + 1);
        expect(p.outBuffer[0]).toBe(c);
    });

    it('discardQueuedData() keeps only priority frames', () => {
        const p = new EthernetPort('p');
        const c = broadcastFrame();
        p.send(broadcastFrame());
        p.send(c, true);
        p.send(broadcastFrame());
        p.discardQueuedData();
        expect(p.outBuffer.length).toBe(1);
        expect(p.outBuffer[0]).toBe(c);
    });
});

// ── STP vs. broadcast storm ───────────────────────────────────────────────────

for (const mode of /** @type {const} */ (['stp', 'rstp'])) {
    describe(`${mode.toUpperCase()} – stopping a running broadcast storm (3-switch ring, VLANs)`, () => {
        function stormRing() {
            const sws = [1n, 2n, 3n].map(id => makeSwitch(id));
            for (const sw of sws) {
                sw.enableVLANFeature();
                for (const p of sw.ports) p.setTagged([1, 10, 20], 1);
            }
            const wires = ring(sws);
            // each broadcast keeps two copies circling the ring; enough of them fill the queues
            for (let i = 0; i < 300; i++) inject(sws[i % 3], 10);
            tick(500, wires);
            // the storm is running and the ring queues are full
            expect(sws.some(sw => sw.ports[0].outBuffer.length > 50)).toBe(true);
            return { sws, wires };
        }

        it('enabling STP discards the queued storm frames immediately', () => {
            const { sws, wires } = stormRing();
            for (const sw of sws) enable(sw, mode);
            for (const sw of sws) for (const p of sw.ports) {
                expect(p.outBuffer.every(f => f.useLengthField)).toBe(true); // only BPDUs left
            }
            resetCount(wires);
            tick(5, wires);
            expect(dataCount(wires)).toBe(0);
        });

        it('a BPDU overtakes a full queue of data frames on a forwarding port', () => {
            const sw = makeSwitch(1n, mode);
            const peer = new EthernetPort('peer');
            const w = wire(sw.ports[0], peer);
            tick(4 * FWD_TICKS, [w]);
            expect(sw.stpPortState[0]).toBe(STP_STATE.FORWARDING);

            sw.ports[0].outBuffer = [];
            for (let i = 0; i < 100; i++) sw.ports[0].send(broadcastFrame());
            if (mode === 'stp') sw._emitBPDUs(); else sw._emitRstBpdus();

            const first = sw.ports[0].getNextOutgoingFrame();
            expect(first && isBpduBytes(first)).toBe(true);
        });

        it('after convergence the ring stays quiet, and a new VLAN-10 broadcast does not loop', () => {
            const { sws, wires } = stormRing();
            for (const sw of sws) { enable(sw, mode); tick(40, wires); }
            tick(1000, wires);
            expect(blockedRingPorts(sws)).toBe(1);

            resetCount(wires);
            tick(300, wires);
            expect(dataCount(wires)).toBe(0);

            inject(sws[1], 10);
            tick(1000, wires);
            // one copy per forwarding ring link at most (3 links, one end blocked)
            expect(dataCount(wires)).toBeLessThanOrEqual(3);
        });
    });
}

describe('STP – blocked port drops data that was queued before', () => {
    it('_setPortTargetState(false) clears queued data but keeps BPDUs', () => {
        const sw = makeSwitch(1n, 'stp');
        const port = sw.ports[0];
        port.send(broadcastFrame());
        const bpdu = broadcastFrame();
        port.send(bpdu, true);
        port.send(broadcastFrame());
        sw._setPortTargetState(0, false);
        expect(port.outBuffer).toEqual([bpdu]);
    });

    it('RSTP: _rstpSetDiscarding() clears queued data', () => {
        const sw = makeSwitch(1n, 'rstp');
        sw.ports[0].send(broadcastFrame());
        sw._rstpSetDiscarding(0);
        expect(sw.ports[0].outBuffer.length).toBe(0);
    });
});

describe('STP – Config BPDU flag bits (IEEE 802.1D)', () => {
    it('TC is bit 1 (0x01), not the TCA bit 8 (0x80)', () => {
        const root = makeSwitch(1n, 'stp');
        wire(root.ports[0], new EthernetPort('peer'));
        root._stpTcActive = true;
        root._stpTcaOnPort[0] = false;
        root.ports[0].outBuffer = [];
        root._emitBPDUs();
        const f = root.ports[0].outBuffer[0];
        const bpdu = STPBPDU.fromBytes(/** @type {Uint8Array} */ (f.payload).subarray(3));
        expect(bpdu.flags).toBe(0x01);
        expect(bpdu.isTc).toBe(true);
        expect(bpdu.isTca).toBe(false);
    });
});

// ── RSTP ↔ STP interoperability ──────────────────────────────────────────────

describe('RSTP – STP compatibility (Port Protocol Migration)', () => {
    it('RSTP port that receives a Config BPDU switches to compat mode and answers with Config BPDUs', () => {
        const rstp = makeSwitch(1n, 'rstp');
        const stp  = makeSwitch(2n, 'stp');
        const w = wire(rstp.ports[0], stp.ports[0]);
        tick(5, [w]);
        expect(rstp._rstpStpCompat[0]).toBe(true);

        rstp.ports[0].outBuffer = [];
        rstp._emitRstBpdus();
        const f = rstp.ports[0].outBuffer[0];
        const bpdu = STPBPDU.fromBytes(/** @type {Uint8Array} */ (f.payload).subarray(3));
        expect(bpdu.bpduType).toBe(0x00);
        expect(bpdu.protocolVersion).toBe(0);
    });

    it('two-switch link STP ↔ RSTP: one root, the STP side learns it', () => {
        const rstp = makeSwitch(1n, 'rstp'); // lower ID → root
        const stp  = makeSwitch(2n, 'stp');
        const w = wire(rstp.ports[0], stp.ports[0]);
        tick(4 * FWD_TICKS, [w]);
        expect(rstp.stpRootPort).toBe(null);
        expect(stp.stpRootId).toBe(rstp.stpBridgeIdVal);
        expect(stp.stpRootPort).toBe(0);
        expect(rstp.stpPortState[0]).toBe(STP_STATE.FORWARDING);
        expect(stp.stpPortState[0]).toBe(STP_STATE.FORWARDING);
    });

    it('compat mode is cleared when the link goes down', () => {
        const rstp = makeSwitch(1n, 'rstp');
        const stp  = makeSwitch(2n, 'stp');
        const w = wire(rstp.ports[0], stp.ports[0]);
        tick(5, [w]);
        expect(rstp._rstpStpCompat[0]).toBe(true);
        w.destroy();
        _wires = _wires.filter(x => x !== w);
        rstp.update();
        expect(rstp._rstpStpCompat[0]).toBe(false);
    });

    it('4-switch ring with alternating STP/RSTP converges to one blocked port, no storm', () => {
        const sws = [
            makeSwitch(1n, 'stp'),
            makeSwitch(2n, 'rstp'),
            makeSwitch(3n, 'stp'),
            makeSwitch(4n, 'rstp'),
        ];
        const wires = ring(sws);
        tick(1500, wires);
        expect(blockedRingPorts(sws)).toBe(1);
        for (const sw of sws) expect(sw.stpRootId).toBe(sws[0].stpBridgeIdVal);

        resetCount(wires);
        inject(sws[2]);
        tick(1000, wires);
        expect(dataCount(wires)).toBeLessThanOrEqual(4);
    });

    it('TC from an RSTP bridge reaches an STP root via TCN and is acknowledged', () => {
        const stpRoot = makeSwitch(1n, 'stp');
        const rstp    = makeSwitch(2n, 'rstp');
        const w = wire(stpRoot.ports[0], rstp.ports[0]);
        tick(4 * FWD_TICKS, [w]);
        expect(rstp.stpRootPort).toBe(0);
        stpRoot._stpStopTc();

        rstp._rstpTriggerTc();
        expect(rstp._stpTcnPending).toBe(true);
        tick(5, [w]);
        expect(stpRoot._stpTcActive).toBe(true);   // root got the TCN
        tick(SimTimer.toTicks(SimTimer.STP_HELLO_MS) + 5, [w]);
        expect(rstp._stpTcnPending).toBe(false);   // TCA came back in a Config BPDU
    });
});
