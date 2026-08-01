//@ts-check
import { describe, it, expect, vi } from 'vitest';

// SimControl pulls in browser UI code; CheckApi only needs a plain object
// with `simobjects`, so avoid importing the real class (same technique as
// tests/integration/e2e_httpsRequest.test.js).
vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

// GenericProcess (base of TerminalApp) creates a DOM element in its
// constructor; stub just enough of `document` for that to work headless.
if (!globalThis.document) {
    const makeFakeEl = () => {
        const el = {
            classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
            style: {},
            dataset: {},
            disabled: false,
            value: '',
            checked: false,
            textContent: '',
            childElementCount: 0,
            get scrollTop() { return 0; },
            set scrollTop(_v) {},
            get scrollHeight() { return 0; },
            replaceChildren() {},
            appendChild() { return el; },
            removeChild() { return el; },
            addEventListener() {},
            setAttribute() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
        };
        return el;
    };
    // @ts-expect-error minimal stub, not a real Document
    globalThis.document = {
        createElement: (/** @type {string} */ _tag) => makeFakeEl(),
        createTextNode: (/** @type {string} */ _t) => ({}),
        createDocumentFragment: () => ({ appendChild() {} }),
    };
}

const { Computer } = await import('../../src/sim/Computer.js');
const { CheckApi } = await import('../../src/lessons/CheckApi.js');

/** @param {number} id @param {string} ip @param {string} [route] */
function makeComputer(id, ip, route = '0.0.0.0') {
    return Computer.fromJSON({
        kind: 'Computer', id, name: `PC${id}`, x: 0, y: 0,
        net: {
            name: 'PC', forwarding: false,
            interfaces: [{ name: 'eth0', ip, prefixLength: 24, ip6: null, prefixLength6: 0, ip6LL: null }],
            routes: [{ dst: route, prefixLength: 0, interf: 0, nexthop: '192.168.0.1' }],
        },
        fs: {
            type: 'dir', name: '', ctime: 0, mtime: 0,
            children: [{ type: 'file', name: 'hosts', ctime: 0, mtime: 0, content: '' }],
        },
        dns: null,
    });
}

/** @param {import("../../src/sim/Computer.js").Computer[]} objects */
function fakeSimControl(objects) {
    return /** @type {any} */ ({
        simobjects: objects,
        isPaused: true,
        scheduleNextStep() {},
        _invalidateUI() {},
    });
}

describe('CheckApi', () => {
    it('ip(): true when the device has an address inside the CIDR', async () => {
        const c = makeComputer(9, '192.168.0.11');
        const api = new CheckApi(fakeSimControl([c]));
        expect(await api.ip(9, '192.168.0.0/24')).toBe(true);
    });

    it('ip(): false when the device address is outside the CIDR', async () => {
        const c = makeComputer(9, '192.168.0.11');
        const api = new CheckApi(fakeSimControl([c]));
        expect(await api.ip(9, '10.0.0.0/8')).toBe(false);
    });

    it('ip(): respects the prefix boundary exactly (/25 split)', async () => {
        const inRange = makeComputer(1, '192.168.0.100');
        const outOfRange = makeComputer(2, '192.168.0.200');
        const api = new CheckApi(fakeSimControl([inRange, outOfRange]));
        expect(await api.ip(1, '192.168.0.0/25')).toBe(true);
        expect(await api.ip(2, '192.168.0.0/25')).toBe(false);
    });

    it('hasRoute(): matches an exact network+prefix entry', async () => {
        const c = makeComputer(9, '192.168.0.11', '0.0.0.0');
        const api = new CheckApi(fakeSimControl([c]));
        expect(await api.hasRoute(9, '0.0.0.0/0')).toBe(true);
        expect(await api.hasRoute(9, '10.0.0.0/8')).toBe(false);
    });

    it('fileExists(): reflects the device filesystem', async () => {
        const c = makeComputer(9, '192.168.0.11');
        const api = new CheckApi(fakeSimControl([c]));
        expect(await api.fileExists(9, '/hosts')).toBe(true);
        expect(await api.fileExists(9, '/nope')).toBe(false);
    });

    it('throws for a device id that does not resolve to a Computer', async () => {
        const api = new CheckApi(fakeSimControl([]));
        await expect(api.ip(999, '192.168.0.0/24')).rejects.toThrow();
    });

    it('runChecks(): aggregates per-check pass/fail and survives an unknown check name', async () => {
        const c = makeComputer(9, '192.168.0.11');
        const api = new CheckApi(fakeSimControl([c]));
        const results = await api.runChecks([
            { fn: 'ip', args: [9, '192.168.0.0/24'] },
            { fn: 'ip', args: [9, '10.0.0.0/8'] },
            { fn: 'notARealCheck', args: [] },
        ]);
        expect(results).toEqual([
            { fn: 'ip', args: [9, '192.168.0.0/24'], ok: true },
            { fn: 'ip', args: [9, '10.0.0.0/8'], ok: false },
            { fn: 'notARealCheck', args: [], ok: false, error: 'Unknown check: notARealCheck' },
        ]);
    });

    it('pingOk(): resolves true on a real ICMP echo/reply exchange between two wired computers', async () => {
        const a = makeComputer(1, '10.0.0.1');
        const b = makeComputer(2, '10.0.0.2');

        // Synchronous direct wire + pre-seeded ARP cache, same technique as
        // tests/integration/e2e_webRequest.test.js's makeNetworkPair().
        const itfA = a.net.interfaces[0];
        const itfB = b.net.interfaces[0];
        itfA.neighborCache.set('10.0.0.2', itfB.mac.slice());
        itfB.neighborCache.set('10.0.0.1', itfA.mac.slice());
        const { IPv4Packet } = await import('../../src/net/pdu/IPv4Packet.js');
        itfA.sendFrame = (/** @type {*} */ _mac, /** @type {number} */ etherType, /** @type {Uint8Array} */ payload) => {
            if (etherType !== 0x0800) return;
            itfB.inQueue.push(IPv4Packet.fromBytes(payload)); itfB.doUpdate();
        };
        itfB.sendFrame = (/** @type {*} */ _mac, /** @type {number} */ etherType, /** @type {Uint8Array} */ payload) => {
            if (etherType !== 0x0800) return;
            itfA.inQueue.push(IPv4Packet.fromBytes(payload)); itfA.doUpdate();
        };

        const api = new CheckApi(fakeSimControl([a, b]));
        expect(await api.pingOk(1, 2)).toBe(true);
        expect(await api.pingOk(1, '10.0.0.2')).toBe(true);
    });

    it('pingOk(): resolves false when the destination is unreachable', async () => {
        // icmpEcho()'s timeout runs on simTimer ticks (only advanced by
        // SimControl.step() in the real app), not real time — so this test
        // has to drive it manually, same as IPStack.fragmentation.test.js.
        const { simTimer } = await import('../../src/lib/SimTimer.js');
        const a = makeComputer(1, '10.0.0.1');
        // No wiring at all — the echo request goes nowhere and times out.
        const api = new CheckApi(fakeSimControl([a]));

        const outcome = api.pingOk(1, '10.0.0.99');
        // 3000ms timeout / 5ms-per-tick = 600 ticks; a bit of headroom on top.
        for (let i = 0; i < 650; i++) {
            simTimer.tick();
            await Promise.resolve();
        }
        expect(await outcome).toBe(false);
    });

    it('runChecks(): temporarily unpauses the sim and restores the previous pause state', async () => {
        const c = makeComputer(9, '192.168.0.11');
        const sim = fakeSimControl([c]);
        sim.isPaused = true;
        const api = new CheckApi(sim);

        let sawUnpaused = false;
        const originalIp = api.ip.bind(api);
        api.ip = async (...args) => {
            sawUnpaused = sim.isPaused === false;
            return originalIp(...args);
        };

        await api.runChecks([{ fn: 'ip', args: [9, '192.168.0.0/24'] }]);
        expect(sawUnpaused).toBe(true);
        expect(sim.isPaused).toBe(true);
    });
});
