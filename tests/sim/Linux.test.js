//@ts-check
import { describe, it, expect, vi } from 'vitest';
// Importing SimControl.js before any sim/*.js class breaks a circular-import
// cycle (SimulatedObject.js <-> SimControl.js <-> Link.js) that otherwise throws
// "Class extends value undefined" when a sim/*.js module is the graph entry point.
import '../../src/SimControl.js';
import { Linux } from '../../src/sim/Linux.js';
import { EthernetPort } from '../../src/net/EthernetPort.js';

// Real "v86" fetches its wasm/bios/cdrom assets from disk/network on
// construction — not something this suite should exercise. Stub just enough
// of the surface Linux.js touches (add_listener/bus.send/run/stop/destroy).
class FakeV86 {
    /** @param {any} opts */
    constructor(opts) {
        this.opts = opts;
        this.bus = { send: vi.fn() };
        this.run = vi.fn();
        this.stop = vi.fn();
        this.destroy = vi.fn();
    }
    add_listener() {}
}
vi.mock('v86', () => ({ V86: FakeV86 }));

// SimulatedObject's constructor creates a `<div>` via document.createElement.
// This suite runs in the 'node' test environment (no real DOM); Linux never
// touches the DOM unless its panel is actually rendered/opened, so a minimal
// stub is enough (see tests/sim/Firewall.test.js for the same pattern).
globalThis.document = /** @type {any} */ ({
    createElement: () => ({
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild() {},
        remove() {},
        style: {},
    }),
});

describe('Linux', () => {
    it('exposes a single eth0 EthernetPort via listPorts/getPortByKey', () => {
        const node = new Linux('Test Linux');
        const ports = node.listPorts();
        expect(ports).toHaveLength(1);
        expect(ports[0].key).toBe('eth0');
        expect(ports[0].port).toBeInstanceOf(EthernetPort);
        expect(node.getPortByKey('eth0')).toBe(node.port);
        expect(node.getPortByKey('eth1')).toBeNull();
    });

    it('never boots a v86 instance unless its panel is opened (lazy init)', () => {
        const node = new Linux('Test Linux');
        expect(node._emulator).toBeNull();
        // Constructing/destroying without ever calling render()/setPanelOpen()
        // must not touch v86 or throw, even though the port was subscribed to.
        expect(() => node.destroy()).not.toThrow();
        expect(node._emulator).toBeNull();
    });

    it('round-trips through toJSON/fromJSON with only base fields (no VM state persisted)', () => {
        const node = new Linux('My Linux');
        node.x = 12; node.y = 34;
        const json = node.toJSON();
        expect(json.kind).toBe('Linux');

        const restored = Linux.fromJSON(json);
        expect(restored.name).toBe('My Linux');
        expect(restored.x).toBe(12);
        expect(restored.y).toBe(34);
        expect(restored._emulator).toBeNull();
    });

    it('queues (does not drop) incoming frames when no VM is booted yet', () => {
        const node = new Linux('Test Linux');
        // Simulate a frame arriving on the wire before the panel was ever opened.
        node.port.recieve(new Uint8Array([
            0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // dst
            0, 1, 2, 3, 4, 5,                   // src
            0x08, 0x06,                          // ARP ethertype
        ]));
        expect(() => node.update()).not.toThrow();
        expect(node.port.getNextIncomingFrame()).toBeNull();
        // Frame must be held for delivery once the VM exists, not discarded.
        expect(node._pendingFrames).toHaveLength(1);
    });

    it('does not start a second VM if the panel is reopened while v86 is still importing', async () => {
        const node = new Linux('Test Linux');
        node._serialEl = /** @type {any} */ ({}); // real code checks this before constructing V86
        node._ensureBooted();
        expect(node._booting).toBe(true);
        node._ensureBooted(); // e.g. quick close/reopen before the dynamic import() resolves
        expect(node._booting).toBe(true);

        await vi.waitFor(() => expect(node._emulator).not.toBeNull());
        // Only one V86 must have been constructed despite the double call.
        expect(node._booting).toBe(false);
    });

    it('flushes frames queued while booting into the VM once it exists', async () => {
        const node = new Linux('Test Linux');
        node._serialEl = /** @type {any} */ ({});
        node.port.recieve(new Uint8Array([
            0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
            0, 1, 2, 3, 4, 5,
            0x08, 0x06,
        ]));
        node.update();
        expect(node._pendingFrames).toHaveLength(1);

        node._ensureBooted();
        await vi.waitFor(() => expect(node._emulator).not.toBeNull());

        expect(node._pendingFrames).toHaveLength(0);
        expect(/** @type {any} */ (node._emulator).bus.send).toHaveBeenCalledWith("net0-receive", expect.any(Uint8Array));
    });
});
