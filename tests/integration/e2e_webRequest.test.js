//@ts-check

/**
 * End-to-end integration test: DNS resolution + HTTP fetch across two real IPStack instances.
 *
 * Topology: clientStack (10.0.0.2/24) ─── directWire ─── serverStack (10.0.0.1/24)
 *
 * serverStack runs:
 *   - DNSServerApp  on UDP/53  (authoritative for example.com → 10.0.0.1)
 *   - SimpleHTTPServerApp on TCP/80  (serves /var/www/index.html)
 *
 * Test flow:
 *   1. Client sends a DNS A query for "example.com" → receives 10.0.0.1.
 *   2. Client connects to the resolved IP on TCP/80.
 *   3. Client sends an HTTP GET for /index.html.
 *   4. Server reads the file, sends a 200 response, and closes the connection.
 *   5. Client verifies status 200 and the expected body content.
 *
 * Frame delivery uses the direct-wire pattern from IPStack.fragmentation.test.js:
 * each interface's sendFrame is overridden to push IPv4 packets straight into the
 * peer's inQueue and call doUpdate() synchronously, bypassing EthernetLink / SimControl.
 * ARP caches are pre-populated so resolveNeighbor() is immediate (no wait loop).
 */

import { describe, it, expect, vi } from 'vitest';

// SimControl pulls in browser UI code via AccessPoint/WirelessPort.
// Mocking it breaks the circular dependency without affecting networking.
vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { IPStack } from '../../src/net/IPStack.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { DNSServerApp } from '../../src/apps/DNSServerApp.js';
import { SimpleHTTPServerApp } from '../../src/apps/SimpleHTTPServerApp.js';
import { DNSPacket } from '../../src/net/pdu/DNSPacket.js';

// ── Minimal DOM stub (LoggedProcess / GenericProcess access document) ─────────

if (!globalThis.document) {
    const makeFakeEl = () => {
        const el = {
            classList: { add() {}, remove() {} },
            style: {},
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
            querySelectorAll() { return []; },
        };
        return el;
    };
    // @ts-ignore
    globalThis.document = {
        createElement: (_tag) => makeFakeEl(),
        createTextNode: (_t) => ({}),
        createDocumentFragment: () => ({ appendChild() {} }),
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Drain the microtask queue n times.
 * Each iteration yields once; because JavaScript drains the full microtask queue
 * before running the continuation, all transitively-scheduled microtasks (route(),
 * resolveNeighbor(), app receive loops, etc.) settle within a small number of
 * iterations even for multi-hop async chains.
 * @param {number} [n]
 */
async function flush(n = 20) {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

/** Concatenate Uint8Array chunks into one buffer. */
function concat(/** @type {Uint8Array[]} */ chunks) {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
}

// ── Topology ──────────────────────────────────────────────────────────────────

const SERVER_IP = '10.0.0.1';
const CLIENT_IP = '10.0.0.2';

/**
 * Create two IPStack instances connected by a synchronous direct wire.
 *
 * Frames are delivered instantly — no EthernetLink tick loop needed.
 * ARP caches are pre-seeded so resolveNeighbor() returns from cache immediately.
 */
function makeNetworkPair() {
    const serverStack = new IPStack(1, 'server');
    const clientStack = new IPStack(1, 'client');

    serverStack.configureInterface(0, { ip: SERVER_IP, prefixLength: 24 });
    clientStack.configureInterface(0, { ip: CLIENT_IP, prefixLength: 24 });

    const itfS = serverStack.interfaces[0];
    const itfC = clientStack.interfaces[0];

    // Pre-populate ARP cache: each side already knows the peer's MAC.
    itfS.neighborCache.set(CLIENT_IP, itfC.mac.slice());
    itfC.neighborCache.set(SERVER_IP, itfS.mac.slice());

    // Synchronous direct wire: override sendFrame on each interface.
    // IPv4 frames are parsed and pushed directly into the peer's inQueue;
    // doUpdate() propagates through the observer chain to IPStack.update() / tcp.handle().
    itfS.sendFrame = (_mac, etherType, payload) => {
        if (etherType !== 0x0800) return;
        try { itfC.inQueue.push(IPv4Packet.fromBytes(payload)); itfC.doUpdate(); } catch (_) {}
    };
    itfC.sendFrame = (_mac, etherType, payload) => {
        if (etherType !== 0x0800) return;
        try { itfS.inQueue.push(IPv4Packet.fromBytes(payload)); itfS.doUpdate(); } catch (_) {}
    };

    return { serverStack, clientStack };
}

/** Minimal in-memory file system for the HTTP server. */
function makeMockFS(/** @type {Record<string,string>} */ files = {}) {
    return {
        mkdir(_path, _opts) {},
        readFile(/** @type {string} */ path) {
            if (Object.prototype.hasOwnProperty.call(files, path)) return files[path];
            throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
        },
        writeFile(_path, _data) {},
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('e2e: DNS resolution + HTTP page fetch', () => {
    it('client resolves example.com via DNS and fetches /index.html via HTTP', async () => {
        const { serverStack, clientStack } = makeNetworkPair();

        const INDEX_CONTENT = '<html><body>Hello, World!</body></html>';
        const mockFS = makeMockFS({ '/var/www/index.html': INDEX_CONTENT });
        const serverOS = { net: serverStack, fs: mockFS, exit() {}, dns: null };

        // ── Start server-side apps ────────────────────────────────────────────

        const dnsApp = new DNSServerApp(serverOS);
        dnsApp.cfg = {
            a:     [{ name: 'example.com', ip: SERVER_IP, ttl: 60 }],
            aaaa:  [],
            cname: [],
            mx:    [],
            ns:    [],
            mode:  'authoritative',
            forwarderIp: '',
        };
        dnsApp._start();

        const httpApp = new SimpleHTTPServerApp(serverOS);
        httpApp._start();

        // Give the apps a moment to reach their first async await (accept/recv loops).
        await flush(5);

        try {
            // ── Step 1: DNS resolution ────────────────────────────────────────
            //
            // The client opens a UDP socket, registers a receive waiter, then
            // sends a DNS A query.  The query travels through the direct wire
            // (clientStack → serverStack), the DNS app processes it and sends a
            // response back, and the response arrives at the client's socket.

            const UDP_SRC_PORT = 5353;
            clientStack.openUDPSocket(IPAddress.fromString('0.0.0.0'), UDP_SRC_PORT);

            const dnsQuery = new DNSPacket({
                id: 0x4242,
                qr: 0,
                questions: [{ name: 'example.com', type: DNSPacket.TYPE_A, cls: DNSPacket.CLASS_IN }],
                answers: [],
                authorities: [],
                additionals: [],
            }).pack();

            // Register the waiter before firing the query so the response is caught.
            const dnsRespPromise = clientStack.recvUDPSocket(UDP_SRC_PORT);
            clientStack.sendUDPSocket(UDP_SRC_PORT, IPAddress.fromString(SERVER_IP), 53, dnsQuery);
            await flush(20);

            const dnsMsg = await dnsRespPromise;
            expect(dnsMsg).not.toBeNull();

            const dnsResp = DNSPacket.fromBytes(/** @type {any} */ (dnsMsg).payload);
            expect(dnsResp.rcode).toBe(0);
            expect(dnsResp.answers.length).toBeGreaterThan(0);

            const aRecord = dnsResp.answers.find(a => a.type === DNSPacket.TYPE_A);
            expect(aRecord).toBeDefined();

            const resolvedIp = Array.from(/** @type {Uint8Array} */ (aRecord.data)).join('.');
            expect(resolvedIp).toBe(SERVER_IP);

            clientStack.closeUDPSocket(UDP_SRC_PORT);

            // ── Step 2: TCP connection to the resolved IP ─────────────────────
            //
            // connectTCPConn awaits the full three-way handshake.  The SYN, SYN-ACK,
            // and ACK travel through the direct wire entirely within the microtask
            // queue — no explicit flush is needed before the await returns.

            const serverIP = IPAddress.fromString(resolvedIp);
            const tcpConn = await clientStack.connectTCPConn(serverIP, 80);
            expect(tcpConn.state).toBe('ESTABLISHED');

            // ── Step 3: HTTP GET ──────────────────────────────────────────────
            //
            // The request data is sent synchronously into the TCP send buffer and
            // reaches the server via the direct wire.  flush(40) is enough for the
            // full round-trip: server receives request → reads file → sends 200
            // response → closes connection → FIN arrives at client.
            //
            // After the flush both the response chunk and the EOF (FIN) are already
            // in the client's TCP receive buffer, so recvTCPConn() returns immediately.

            const enc = new TextEncoder();
            const dec = new TextDecoder();

            clientStack.sendTCPConn(
                tcpConn.key,
                enc.encode('GET /index.html HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n'),
            );
            await flush(40);

            const chunks = /** @type {Uint8Array[]} */ ([]);
            let chunk;
            while ((chunk = await clientStack.recvTCPConn(tcpConn.key)) !== null) {
                chunks.push(chunk);
            }

            const response = dec.decode(concat(chunks));

            // ── Assertions ────────────────────────────────────────────────────

            // Status line
            expect(response).toContain('HTTP/1.1 200');

            // Body contains the file content served by the HTTP server
            expect(response).toContain(INDEX_CONTENT);

        } finally {
            dnsApp._stop();
            httpApp._stop();
        }
    });
});
