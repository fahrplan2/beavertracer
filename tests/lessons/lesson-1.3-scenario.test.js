//@ts-check
import { describe, it, expect, vi } from 'vitest';

// Same DOM-stub + circular-import workaround as tests/lessons/CheckApi.test.js.
vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

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
const fs = await import('node:fs');
const path = await import('node:path');

describe('lesson-1.3-webrequest.btsim', () => {
    it('parses via Computer.fromJSON and has valid, distinct IPs for both PCs', () => {
        const raw = fs.readFileSync(
            path.resolve(__dirname, '../../public/sims/lesson-1.3-webrequest.btsim'),
            'utf8',
        );
        const scene = JSON.parse(raw);
        const computers = scene.objects.filter((/** @type {any} */ o) => o.kind === 'Computer');
        expect(computers).toHaveLength(2);

        const [client, server] = computers.map((/** @type {any} */ n) => Computer.fromJSON(n));
        expect(client.net.interfaces[0].ip.toString()).toBe('192.168.0.10');
        expect(server.net.interfaces[0].ip.toString()).toBe('192.168.0.20');
        expect(client.net.interfaces[0].prefixLength).toBe(24);

        // Default filesystem (fs omitted from the scenario on purpose) should
        // still carry the default /var/www/index.html SimpleHTTPServerApp serves.
        expect(server.fs.exists('/var/www/index.html')).toBe(true);
    });

    it('client can reach the server: real ICMP echo over a direct-wired link', async () => {
        const raw = fs.readFileSync(
            path.resolve(__dirname, '../../public/sims/lesson-1.3-webrequest.btsim'),
            'utf8',
        );
        const scene = JSON.parse(raw);
        const [clientNode, serverNode] = scene.objects.filter((/** @type {any} */ o) => o.kind === 'Computer');
        const client = Computer.fromJSON(clientNode);
        const server = Computer.fromJSON(serverNode);

        const itfC = client.net.interfaces[0];
        const itfS = server.net.interfaces[0];
        itfC.neighborCache.set('192.168.0.20', itfS.mac.slice());
        itfS.neighborCache.set('192.168.0.10', itfC.mac.slice());
        const { IPv4Packet } = await import('../../src/net/pdu/IPv4Packet.js');
        itfC.sendFrame = (/** @type {*} */ _mac, /** @type {number} */ etherType, /** @type {Uint8Array} */ payload) => {
            if (etherType !== 0x0800) return;
            itfS.inQueue.push(IPv4Packet.fromBytes(payload)); itfS.doUpdate();
        };
        itfS.sendFrame = (/** @type {*} */ _mac, /** @type {number} */ etherType, /** @type {Uint8Array} */ payload) => {
            if (etherType !== 0x0800) return;
            itfC.inQueue.push(IPv4Packet.fromBytes(payload)); itfC.doUpdate();
        };

        const { IPAddress } = await import('../../src/net/models/IPAddress.js');
        const reply = await client.net.icmpEcho(IPAddress.fromString('192.168.0.20'), { timeoutMs: 500 });
        expect(reply).toBeTruthy();
    });
});
