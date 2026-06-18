//@ts-check

/**
 * End-to-end HTTPS integration test.
 *
 * Topology: clientStack (10.0.0.2/24) ─── directWire ─── serverStack (10.0.0.1/24)
 *
 * Certificate chain:
 *   TestCA  (self-signed CA)
 *   └── server.local  (signed by TestCA)
 *
 * Test flow:
 *   1. Generate a CA certificate (mirrors CertManagerApp's "Create CA" action).
 *   2. Generate a server certificate signed by the CA ("Sign with CA" action).
 *   3. Configure SimpleHTTPServerApp in HTTPS mode with the signed certificate.
 *   4. Client connects via TCP to port 443.
 *   5. Client creates a TlsSession and runs the TLS 1.2 handshake; the server-side
 *      handshake runs concurrently inside SimpleHTTPServerApp._ioForConn().
 *   6. Client sends an HTTP GET through the TLS tunnel.
 *   7. Server decrypts, serves /index.html, encrypts the response, and closes
 *      the connection with a close_notify alert.
 *   8. Client collects response chunks until recv() returns null (close_notify).
 *   9. Assert 200 OK and correct body content.
 */

import { describe, it, expect, vi } from 'vitest';

// SimControl pulls in browser UI code — mock to break the circular dependency.
vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { IPStack } from '../../src/net/IPStack.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { TlsCertificate, TlsTrustStore } from '../../src/net/models/TlsCertificate.js';
import { TlsSession } from '../../src/net/TlsSession.js';
import { SimpleHTTPServerApp } from '../../src/apps/SimpleHTTPServerApp.js';

// ── Minimal DOM stub ──────────────────────────────────────────────────────────

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
 * Two IPStack instances connected by a synchronous direct wire.
 * ARP caches are pre-seeded; frames are delivered instantly without EthernetLink.
 */
function makeNetworkPair() {
    const serverStack = new IPStack(1, 'server');
    const clientStack = new IPStack(1, 'client');

    serverStack.configureInterface(0, { ip: SERVER_IP, prefixLength: 24 });
    clientStack.configureInterface(0, { ip: CLIENT_IP, prefixLength: 24 });

    const itfS = serverStack.interfaces[0];
    const itfC = clientStack.interfaces[0];

    itfS.neighborCache.set(CLIENT_IP, itfC.mac.slice());
    itfC.neighborCache.set(SERVER_IP, itfS.mac.slice());

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

// ── Test ──────────────────────────────────────────────────────────────────────

describe('e2e: HTTPS request (CA-signed cert, TLS 1.2)', () => {
    it('client fetches /index.html over HTTPS and receives 200 OK', async () => {

        // ── 1. Certificate chain ──────────────────────────────────────────────
        //
        // Replicates the two steps a user performs in CertManagerApp:
        //   a) "Create CA certificate" → TlsCertificate.generate(cn, null, { isCA: true })
        //   b) "Sign server cert with CA" → TlsCertificate.generate(cn, caCert)

        const caCert     = await TlsCertificate.generate('Test CA', null, { isCA: true });
        const serverCert = await TlsCertificate.generate('server.local', caCert);

        // Client trust store: trust the CA, which transitively trusts the server cert.
        const trustStore = new TlsTrustStore();
        trustStore.add(caCert);

        // ── 2. Network topology ───────────────────────────────────────────────

        const { serverStack, clientStack } = makeNetworkPair();

        const INDEX_CONTENT = '<html><body>HTTPS works!</body></html>';
        const mockFS = makeMockFS({ '/var/www/index.html': INDEX_CONTENT });
        const serverOS = { net: serverStack, fs: mockFS, exit() {}, dns: null };

        // ── 3. HTTPS server ───────────────────────────────────────────────────

        const httpsApp = new SimpleHTTPServerApp(serverOS);
        httpsApp.httpsEnabled = true;
        httpsApp._cert = serverCert;
        httpsApp.httpsPort = 443;
        httpsApp._start();

        // Yield so both accept loops reach their first await (acceptTCPConn).
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        try {
            // ── 4. TCP connect to the HTTPS port ──────────────────────────────
            //
            // connectTCPConn awaits the full TCP three-way handshake.  The SYN,
            // SYN-ACK, and ACK travel through the direct wire via microtasks.

            const tcpConn = await clientStack.connectTCPConn(
                IPAddress.fromString(SERVER_IP), 443,
            );
            expect(tcpConn.state).toBe('ESTABLISHED');

            // ── 5. TLS 1.2 handshake ──────────────────────────────────────────
            //
            // The client TLS session wraps the TCP connection.  sleepFn never
            // resolves so the handshake timeout never fires — data arrival always
            // wins the race inside _readRecordTimeout().
            //
            // SimpleHTTPServerApp creates the server-side TlsSession in
            // _ioForConn() and calls tls.handshake() there.  Both sides run as
            // concurrent async tasks and interleave naturally through the JS
            // event loop; no explicit flush is needed.

            const enc = new TextEncoder();
            const dec = new TextDecoder();

            const clientTls = new TlsSession({
                send:      (d) => clientStack.sendTCPConn(tcpConn.key, d),
                recv:      ()  => clientStack.recvTCPConn(tcpConn.key),
                isServer:  false,
                trustStore,
                timeoutMs: 30000,
                sleepFn:   () => new Promise(() => {}), // never resolves → timeout never fires
            });

            await clientTls.handshake();

            // Verify the server's certificate was presented and is trusted.
            expect(clientTls.peerCert).not.toBeNull();
            expect(clientTls.peerCert?.subject).toContain('server.local');

            // ── 6. HTTP GET over the TLS tunnel ──────────────────────────────

            await clientTls.send(
                enc.encode('GET /index.html HTTP/1.1\r\nHost: server.local\r\nConnection: close\r\n\r\n'),
            );

            // ── 7. Collect response chunks ────────────────────────────────────
            //
            // After serving the response, SimpleHTTPServerApp calls tls.close(),
            // which sends a TLS close_notify alert.  TlsSession.recv() returns
            // null when it receives close_notify, terminating the loop.

            const chunks = /** @type {Uint8Array[]} */ ([]);
            let chunk;
            while ((chunk = await clientTls.recv()) !== null) {
                chunks.push(chunk);
            }

            const response = dec.decode(concat(chunks));

            // ── 8. Assertions ─────────────────────────────────────────────────

            expect(response).toContain('HTTP/1.1 200');
            expect(response).toContain(INDEX_CONTENT);

        } finally {
            httpsApp._stop();
        }
    });
});
