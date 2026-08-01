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
const { IPv4Packet } = await import('../../src/net/pdu/IPv4Packet.js');
const { IPAddress } = await import('../../src/net/models/IPAddress.js');
const { SimpleHTTPServerApp } = await import('../../src/apps/SimpleHTTPServerApp.js');
const { SparktailHTTPClientApp } = await import('../../src/apps/SparktailHTTPClientApp.js');
const fs = await import('node:fs');
const path = await import('node:path');

function loadScenario() {
    const raw = fs.readFileSync(
        path.resolve(__dirname, '../../public/sims/lesson-1.3-webrequest.btsim'),
        'utf8',
    );
    const scene = JSON.parse(raw);
    const [clientNode, serverNode] = scene.objects.filter((/** @type {any} */ o) => o.kind === 'Computer');
    return { client: Computer.fromJSON(clientNode), server: Computer.fromJSON(serverNode) };
}

/** Direct-wires two Computers' first interface together (see e2e_webRequest.test.js). */
function wire(/** @type {any} */ client, /** @type {any} */ server) {
    const itfC = client.net.interfaces[0];
    const itfS = server.net.interfaces[0];
    itfC.neighborCache.set(itfS.ip.toString(), itfS.mac.slice());
    itfS.neighborCache.set(itfC.ip.toString(), itfC.mac.slice());
    itfC.sendFrame = (/** @type {*} */ _mac, /** @type {number} */ etherType, /** @type {Uint8Array} */ payload) => {
        if (etherType !== 0x0800) return;
        itfS.inQueue.push(IPv4Packet.fromBytes(payload)); itfS.doUpdate();
    };
    itfS.sendFrame = (/** @type {*} */ _mac, /** @type {number} */ etherType, /** @type {Uint8Array} */ payload) => {
        if (etherType !== 0x0800) return;
        itfC.inQueue.push(IPv4Packet.fromBytes(payload)); itfC.doUpdate();
    };
}

describe('lesson-1.3-webrequest.btsim', () => {
    it('parses via Computer.fromJSON and has valid, distinct IPs for both PCs', () => {
        const { client, server } = loadScenario();
        expect(client.net.interfaces[0].ip.toString()).toBe('192.168.0.10');
        expect(server.net.interfaces[0].ip.toString()).toBe('192.168.0.20');
        expect(client.net.interfaces[0].prefixLength).toBe(24);
        expect(server.fs.exists('/var/www/index.html')).toBe(true);
    });

    it('only installs the apps each PC actually needs (no clutter)', () => {
        const { client, server } = loadScenario();
        const nonMandatoryIds = (/** @type {any} */ computer) =>
            computer.os.runningApps.filter((/** @type {any} */ a) => !a._mandatory).map((/** @type {any} */ a) => a._appId);

        expect(nonMandatoryIds(client)).toEqual(['SparktailHTTPClientApp']);
        expect(nonMandatoryIds(server)).toEqual(['SimpleHTTPServerApp']);
    });

    it('the web server actually starts listening on load (autostart via /etc/httpd.conf)', async () => {
        const { server } = loadScenario();
        // _tryAutostart() is deferred via setTimeout(0) — a real macrotask,
        // not just a microtask — so it needs a real timer tick to fire.
        await new Promise((resolve) => setTimeout(resolve, 10));

        const httpApp = /** @type {InstanceType<typeof SimpleHTTPServerApp>} */ (
            server.os.runningApps.find((/** @type {any} */ a) => a instanceof SimpleHTTPServerApp)
        );
        expect(httpApp).toBeTruthy();
        expect(httpApp.running).toBe(true);
    });

    it('client can reach the server: real ICMP echo over a direct-wired link', async () => {
        const { client, server } = loadScenario();
        wire(client, server);
        const reply = await client.net.icmpEcho(IPAddress.fromString('192.168.0.20'), { timeoutMs: 500 });
        expect(reply).toBeTruthy();
    });

    it('client fetches the real page over HTTP (full TCP handshake + GET + response)', async () => {
        const { client, server } = loadScenario();
        wire(client, server);
        await new Promise((resolve) => setTimeout(resolve, 10)); // let the server autostart

        const conn = await client.net.connectTCPConn(IPAddress.fromString('192.168.0.20'), 80);
        expect(conn.state).toBe('ESTABLISHED');

        const enc = new TextEncoder();
        const dec = new TextDecoder();
        client.net.sendTCPConn(
            conn.key,
            enc.encode('GET /index.html HTTP/1.1\r\nHost: 192.168.0.20\r\nConnection: close\r\n\r\n'),
        );

        /** @type {Uint8Array[]} */
        const chunks = [];
        let chunk;
        while ((chunk = await client.net.recvTCPConn(conn.key)) !== null) {
            chunks.push(chunk);
        }
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
        const response = dec.decode(buf);

        expect(response).toContain('HTTP/1.1 200');
        expect(response).toContain('It works!');
    });

    it('SparktailHTTPClientApp (the "Browser" app the lesson tells students to use) is installed on the client', () => {
        const { client } = loadScenario();
        expect(client.os.runningApps.some((/** @type {any} */ a) => a instanceof SparktailHTTPClientApp)).toBe(true);
    });
});
