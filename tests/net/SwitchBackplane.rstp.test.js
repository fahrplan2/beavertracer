//@ts-check
// EthernetPort → EthernetLink → sim/Link → SimControl → AccessPoint → WirelessPort → EthernetPort
// The circular chain makes WirelessPort see EthernetPort as undefined during module init.
// Mock EthernetLink early (hoisted by Vitest) to break the chain before it reaches SimControl.
import { vi, describe, it, expect, afterEach } from 'vitest';

vi.mock('../../src/net/EthernetLink.js', () => ({ EthernetLink: class EthernetLink {} }));

import { SwitchBackplane, STP_STATE } from '../../src/net/SwitchBackplane.js';
import { EthernetPort } from '../../src/net/EthernetPort.js';
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

/**
 * Create an RSTP-enabled SwitchBackplane.
 * @param {number} priority  Bridge priority (multiple of 4096)
 * @param {bigint} [id]      Deterministic bridgeId (low 48 bits → MAC)
 * @param {number} [nPorts]
 */
function makeSwitch(priority = 32768, id = undefined, nPorts = 4) {
    const bp = new SwitchBackplane(nPorts);
    if (id !== undefined) bp.setBridgeId(id);
    bp.setBridgePriority(priority);
    bp.enableRSTPFeature();
    _backplanes.push(bp);
    return bp;
}

/**
 * Connect two EthernetPorts without importing EthernetLink
 * (which drags in SimControl → AccessPoint → WirelessPort and breaks in Node).
 *
 * Returns a handle with transfer() and destroy().
 * transfer() drains all pending outgoing frames from both sides in one call.
 */
function wire(a, b) {
    const sentinel = {}; // minimal linkref — just needs to be non-null
    a.link(sentinel);
    b.link(sentinel);

    const w = {
        transfer() {
            let pkt;
            while ((pkt = a.getNextOutgoingFrame()) != null) b.recieve(pkt);
            while ((pkt = b.getNextOutgoingFrame()) != null) a.recieve(pkt);
        },
        destroy() { a.unlink(); b.unlink(); },
    };
    _wires.push(w);
    return w;
}

/**
 * Advance the sim by n ticks:
 *   1. fire timers (may queue BPDUs)
 *   2. transfer all queued frames across each wire
 *   3. run update() on every switch (processes inBuffers, may queue more)
 */
function tick(n, switches, wires) {
    for (let i = 0; i < n; i++) {
        simTimer.tick();
        for (const w  of wires)    w.transfer();
        for (const sw of switches) sw.update();
    }
}

const HELLO_TICKS = SimTimer.toTicks(SimTimer.STP_HELLO_MS);         // 100
const FWD_TICKS   = SimTimer.toTicks(SimTimer.STP_FORWARD_DELAY_MS); //  30

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RSTP – mode switching', () => {
    it('default mode is off, all ports start FORWARDING', () => {
        const sw = new SwitchBackplane(4);
        _backplanes.push(sw);
        expect(sw.stpMode).toBe('off');
        expect(sw.stpEnabled).toBe(false);
        expect(sw.stpPortState.every(s => s === STP_STATE.FORWARDING)).toBe(true);
    });

    it('enableRSTPFeature() → mode rstp, all ports DISCARDING', () => {
        const sw = new SwitchBackplane(4);
        _backplanes.push(sw);
        sw.enableRSTPFeature();
        expect(sw.stpMode).toBe('rstp');
        expect(sw.stpEnabled).toBe(true);
        expect(sw.stpPortState.every(s => s === STP_STATE.DISCARDING)).toBe(true);
    });

    it('disableSTPFeature() → mode off, all ports FORWARDING again', () => {
        const sw = makeSwitch();
        sw.disableSTPFeature();
        expect(sw.stpMode).toBe('off');
        expect(sw.stpPortState.every(s => s === STP_STATE.FORWARDING)).toBe(true);
    });

    it('classic STP mode also still selectable', () => {
        const sw = new SwitchBackplane(4);
        _backplanes.push(sw);
        sw.enableSTPFeature();
        expect(sw.stpMode).toBe('stp');
    });
});

describe('RSTP – P/A handshake between two switches', () => {
    it('both ports reach FORWARDING within a few ticks (no ForwardDelay wait)', () => {
        const swA = makeSwitch(4096,  1n); // lower priority → root
        const swB = makeSwitch(32768, 2n);
        const w   = wire(swA.ports[0], swB.ports[0]);

        tick(10, [swA, swB], [w]);

        expect(swA.stpPortState[0]).toBe(STP_STATE.FORWARDING);
        expect(swB.stpPortState[0]).toBe(STP_STATE.FORWARDING);
    });

    it('converges well before one ForwardDelay timer would expire', () => {
        const swA = makeSwitch(4096,  1n);
        const swB = makeSwitch(32768, 2n);
        const w   = wire(swA.ports[0], swB.ports[0]);

        // P/A handshake needs ~3 ticks; ForwardDelay = 30 ticks
        tick(5, [swA, swB], [w]);

        expect(swA.stpPortState[0]).toBe(STP_STATE.FORWARDING);
        expect(swB.stpPortState[0]).toBe(STP_STATE.FORWARDING);
        expect(5).toBeLessThan(FWD_TICKS); // sanity: the test actually proves speed
    });

    it('assigns correct port roles after convergence', () => {
        const swA = makeSwitch(4096,  1n);
        const swB = makeSwitch(32768, 2n);
        const w   = wire(swA.ports[0], swB.ports[0]);

        tick(10, [swA, swB], [w]);

        expect(swA.stpRootPort).toBeNull();            // swA is root
        expect(swA.stpPortRole[0]).toBe('designated'); // downstream
        expect(swB.stpPortRole[0]).toBe('root');        // upstream
    });
});

describe('RSTP – Alternate port in a triangle topology', () => {
    //        swA  ← root (priority 4096)
    //        / \
    //      swB   swC
    //       \_____/  ← redundant link; swC port 1 becomes Alternate

    it('elects an Alternate (Discarding) port on the redundant link', () => {
        const swA = makeSwitch(4096,  1n);
        const swB = makeSwitch(32768, 2n); // lower MAC → wins Designated on B–C
        const swC = makeSwitch(32768, 3n);

        const wAB = wire(swA.ports[0], swB.ports[0]);
        const wAC = wire(swA.ports[1], swC.ports[0]);
        const wBC = wire(swB.ports[1], swC.ports[1]);

        // port B→C has no P/A partner (C's port is Alternate), so B uses the ForwardDelay
        // fallback; give it FWD_TICKS + a few propagation ticks
        tick(FWD_TICKS + 10, [swA, swB, swC], [wAB, wAC, wBC]);

        expect(swC.stpPortRole[1]).toBe('alternate');
        expect(swC.stpPortState[1]).toBe(STP_STATE.DISCARDING);
    });

    it('all non-alternate ports reach FORWARDING', () => {
        const swA = makeSwitch(4096,  1n);
        const swB = makeSwitch(32768, 2n);
        const swC = makeSwitch(32768, 3n);

        const wAB = wire(swA.ports[0], swB.ports[0]);
        const wAC = wire(swA.ports[1], swC.ports[0]);
        const wBC = wire(swB.ports[1], swC.ports[1]);

        tick(FWD_TICKS + 10, [swA, swB, swC], [wAB, wAC, wBC]);

        expect(swA.stpPortState[0]).toBe(STP_STATE.FORWARDING);
        expect(swA.stpPortState[1]).toBe(STP_STATE.FORWARDING);
        expect(swB.stpPortState[0]).toBe(STP_STATE.FORWARDING);
        expect(swB.stpPortState[1]).toBe(STP_STATE.FORWARDING);
        expect(swC.stpPortState[0]).toBe(STP_STATE.FORWARDING);
    });

    it('swA is the root, swB and swC have root ports toward swA', () => {
        const swA = makeSwitch(4096,  1n);
        const swB = makeSwitch(32768, 2n);
        const swC = makeSwitch(32768, 3n);

        const wAB = wire(swA.ports[0], swB.ports[0]);
        const wAC = wire(swA.ports[1], swC.ports[0]);
        const wBC = wire(swB.ports[1], swC.ports[1]);

        tick(FWD_TICKS + 10, [swA, swB, swC], [wAB, wAC, wBC]);

        expect(swA.stpRootPort).toBeNull();
        expect(swB.stpPortRole[0]).toBe('root');
        expect(swC.stpPortRole[0]).toBe('root');
    });
});

describe('RSTP – fast aging (3 × Hello expiry)', () => {
    it('rx info expires after 3 missed Hello intervals', () => {
        const swA = makeSwitch(4096,  1n);
        const swB = makeSwitch(32768, 2n);
        const w   = wire(swA.ports[0], swB.ports[0]);

        tick(10, [swA, swB], [w]);
        expect(swB.stpRxBest[0]).not.toBeNull();

        // Sever the link — swA stops delivering BPDUs to swB
        w.destroy();
        _wires = _wires.filter(x => x !== w);

        tick(HELLO_TICKS * 3 + 5, [swA, swB], []);

        expect(swB.stpRxBest[0]).toBeNull();
    });

    it('swB declares itself root after neighbor ages out', () => {
        const swA = makeSwitch(4096,  1n);
        const swB = makeSwitch(32768, 2n);
        const w   = wire(swA.ports[0], swB.ports[0]);

        tick(10, [swA, swB], [w]);
        expect(swB.stpRootPort).toBe(0);

        w.destroy();
        _wires = _wires.filter(x => x !== w);

        tick(HELLO_TICKS * 3 + 10, [swA, swB], []);

        expect(swB.stpRootId).toBe(swB.stpBridgeIdVal);
        expect(swB.stpRootPort).toBeNull();
    });
});

describe('RSTP – TC (Topology Change) propagation', () => {
    it('TC flag in RST BPDU clears the neighbor MAC table', () => {
        const swA = makeSwitch(4096,  1n);
        const swB = makeSwitch(32768, 2n);
        const w   = wire(swA.ports[0], swB.ports[0]);

        tick(10, [swA, swB], [w]);

        // Seed swB's MAC table with a dummy entry
        swB.sat.set(0xdeadbeef, 1);
        expect(swB.sat.size).toBeGreaterThan(0);

        // Trigger TC on swA; next Hello BPDU will carry the TC flag
        swA._rstpTriggerTc();
        tick(HELLO_TICKS + 5, [swA, swB], [w]);

        expect(swB.sat.size).toBe(0);
    });

    it('TC active flag clears itself after tcWhile (3 × Hello)', () => {
        const sw = makeSwitch();
        sw._rstpTriggerTc();
        expect(sw._stpTcActive).toBe(true);

        tick(HELLO_TICKS * 3 + 5, [sw], []);

        expect(sw._stpTcActive).toBe(false);
    });
});

describe('RSTP – fallback timer (no P/A partner)', () => {
    it('designated port reaches FORWARDING via ForwardDelay when no Agreement comes', () => {
        const sw    = makeSwitch(4096, 1n);
        const dummy = new EthernetPort('dummy');
        const w     = wire(sw.ports[0], dummy);

        // Tick 1: link-change detected → port becomes Designated + LEARNING
        tick(1, [sw], [w]);
        expect(sw.stpPortRole[0]).toBe('designated');
        expect(sw.stpPortState[0]).toBe(STP_STATE.LEARNING);

        // After ForwardDelay timer (30 ticks) the port advances to FORWARDING
        tick(FWD_TICKS + 2, [sw], [w]);
        expect(sw.stpPortState[0]).toBe(STP_STATE.FORWARDING);
    });
});
