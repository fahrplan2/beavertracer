//@ts-check

/**
 * Integration test: HomeRouter NAT (SNAT + port forwarding) end-to-end.
 *
 * Topology:
 *   LAN host (192.168.1.50) ── eth1 ── [HomeRouter] ── wan0 ── WAN host (203.0.113.50)
 *
 * Frames are injected directly at the EthernetPort level (recieve()/getNextOutgoingFrame()),
 * bypassing EthernetLink/SimControl — same approach as the SwitchBackplane and
 * IPStack.fragmentation integration tests. HomeRouter's ports auto-drive update()
 * via the Observable.doUpdate() → subscriber.update() hook on every recieve()/send(),
 * so only the async LAN→WAN / WAN→LAN forwarding hops need an explicit microtask flush.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// SimControl pulls in browser UI code — mock to break the circular dependency
// (EthernetPort → EthernetLink → sim/Link → SimControl → AccessPoint → WirelessPort).
vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

// ── Minimal DOM stub (HomeRouter extends SimulatedObject, which touches document in its ctor) ──
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

import { HomeRouter } from '../../src/sim/HomeRouter.js';
import { IPStack } from '../../src/net/IPStack.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { UDPPacket } from '../../src/net/pdu/UDPPacket.js';
import { TCPPacket } from '../../src/net/pdu/TCPPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

// ── Topology constants ───────────────────────────────────────────────────────

const LAN_HOST_IP = '192.168.1.50';
const LAN_HOST_MAC = new Uint8Array([0xaa, 0, 0, 0, 0, 0x01]);

const WAN_ROUTER_IP = '203.0.113.1';
const WAN_HOST_IP = '203.0.113.50';
const WAN_HOST_MAC = new Uint8Array([0xaa, 0, 0, 0, 0, 0x02]);

/** @param {string} s @returns {number} */
const ipn = (s) => /** @type {number} */ (IPAddress.fromString(s).getNumber());

/** Flush the microtask queue n times, letting async continuations (await resolveNeighbor etc.) run. */
async function flush(n = 15) {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

/** Build a HomeRouter with a static WAN config and the WAN host's MAC pre-cached (no ARP RTT). */
function makeRouter() {
    const router = new HomeRouter('R1');
    router._wanMode = 'static';
    router._wanIp = ipn(WAN_ROUTER_IP);
    router._wanPrefix = 24;
    router._wanGw = 0; // WAN host is directly connected, no gateway needed
    router._applyWanConfig();

    // WAN host is directly connected: pre-seed the neighbor cache so resolveNeighbor()
    // resolves instantly instead of running a (fake-timer-less) ARP round trip.
    router._wanStack.interfaces[0].neighborCache.set(WAN_HOST_IP, WAN_HOST_MAC.slice());

    return router;
}

/**
 * @param {Uint8Array} dstMac @param {Uint8Array} srcMac
 * @param {IPAddress} src @param {IPAddress} dst
 * @param {number} srcPort @param {number} dstPort @param {number} [ttl]
 */
function buildUdpFrame(dstMac, srcMac, src, dst, srcPort, dstPort, ttl = 64) {
    const udp = new UDPPacket({ srcPort, dstPort, payload: new Uint8Array([1, 2, 3, 4]) });
    const ip = new IPv4Packet({
        src, dst, protocol: 17, ttl,
        payload: udp.pack({ srcIp: src, dstIp: dst }),
    });
    return new EthernetFrame({ dstMac, srcMac, etherType: 0x0800, payload: ip.pack() });
}

/** Parse the next outgoing frame on a port as {eth, ip, udp}, or null if none pending. */
function drainUdp(port) {
    const raw = port.getNextOutgoingFrame();
    if (!raw) return null;
    const eth = EthernetFrame.fromBytes(raw);
    const ip = IPv4Packet.fromBytes(eth.payload);
    const udp = UDPPacket.fromBytes(ip.payload);
    return { eth, ip, udp };
}

describe('HomeRouter NAT integration', () => {
    /** @type {HomeRouter} */
    let router;

    beforeEach(() => {
        router = makeRouter();
    });

    it('SNATs an outbound LAN→WAN UDP packet and forwards it out wan0', async () => {
        const frame = buildUdpFrame(
            router._lanMac, LAN_HOST_MAC,
            IPAddress.fromString(LAN_HOST_IP), IPAddress.fromString(WAN_HOST_IP),
            4000, 53,
        );
        router.eth1.recieve(frame.pack());
        await flush();

        const out = drainUdp(router.wan0);
        expect(out).not.toBeNull();
        expect(out.ip.src.toString()).toBe(WAN_ROUTER_IP); // SNAT'd source IP
        expect(out.ip.dst.toString()).toBe(WAN_HOST_IP);
        expect(out.udp.srcPort).not.toBe(4000); // SNAT'd source port
        expect(out.udp.dstPort).toBe(53);
        expect(out.ip.ttl).toBe(63); // decremented once by the WAN IPStack

        const entries = router._nat.getEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].proto).toBe('UDP');
        expect(entries[0].lanIpNum).toBe(ipn(LAN_HOST_IP));
        expect(entries[0].natPort).toBe(out.udp.srcPort);
    });

    it('routes the WAN reply back to the originating LAN host with the original port restored', async () => {
        // Prime the NAT session (LAN → WAN leg) exactly like the previous test.
        const outFrame = buildUdpFrame(
            router._lanMac, LAN_HOST_MAC,
            IPAddress.fromString(LAN_HOST_IP), IPAddress.fromString(WAN_HOST_IP),
            4000, 53,
        );
        router.eth1.recieve(outFrame.pack());
        await flush();
        const out = drainUdp(router.wan0);
        const natPort = out.udp.srcPort;

        // WAN host replies to the router's WAN IP:natPort.
        const replyFrame = buildUdpFrame(
            router._wanMac, WAN_HOST_MAC,
            IPAddress.fromString(WAN_HOST_IP), IPAddress.fromString(WAN_ROUTER_IP),
            53, natPort,
        );
        router.wan0.recieve(replyFrame.pack());
        await flush();

        const delivered = drainUdp(router.eth1);
        expect(delivered).not.toBeNull();
        expect(delivered.eth.dstMac).toEqual(LAN_HOST_MAC);
        expect(delivered.ip.src.toString()).toBe(WAN_HOST_IP);
        expect(delivered.ip.dst.toString()).toBe(LAN_HOST_IP);
        expect(delivered.udp.srcPort).toBe(53);
        expect(delivered.udp.dstPort).toBe(4000); // un-NAT'd back to the LAN host's original port
    });

    it('an unsolicited WAN packet with no NAT session is dropped (no port forward rule)', async () => {
        const frame = buildUdpFrame(
            router._wanMac, WAN_HOST_MAC,
            IPAddress.fromString(WAN_HOST_IP), IPAddress.fromString(WAN_ROUTER_IP),
            53, 55555, // 55555 was never allocated by natOutbound
        );
        router.wan0.recieve(frame.pack());
        await flush();

        expect(router.eth1.getNextOutgoingFrame()).toBeNull();
    });

    it('forwards an inbound WAN TCP connection to a LAN server via a port forwarding rule', async () => {
        const LAN_SERVER_IP = '192.168.1.80';
        router._portRules.push({ proto: 6, wanPort: 8080, lanIp: ipn(LAN_SERVER_IP), lanPort: 80 });

        // So the router can deliver the forwarded SYN to the LAN server's MAC without an ARP round trip.
        router._lanArpCache.set(ipn(LAN_SERVER_IP), new Uint8Array([0xaa, 0, 0, 0, 0, 0x99]));

        const tcp = new TCPPacket({ srcPort: 40000, dstPort: 8080, seq: 1, flags: TCPPacket.FLAG_SYN });
        const src = IPAddress.fromString(WAN_HOST_IP);
        const dst = IPAddress.fromString(WAN_ROUTER_IP);
        const ip = new IPv4Packet({
            src, dst, protocol: 6, ttl: 64,
            payload: tcp.pack({ srcIp: src, dstIp: dst }),
        });
        const frame = new EthernetFrame({ dstMac: router._wanMac, srcMac: WAN_HOST_MAC, etherType: 0x0800, payload: ip.pack() });

        router.wan0.recieve(frame.pack());
        await flush();

        const raw = router.eth1.getNextOutgoingFrame();
        expect(raw).not.toBeNull();
        const eth = EthernetFrame.fromBytes(raw);
        const fwdIp = IPv4Packet.fromBytes(eth.payload);
        const fwdTcp = TCPPacket.fromBytes(fwdIp.payload);
        expect(fwdIp.dst.toString()).toBe(LAN_SERVER_IP);
        expect(fwdTcp.dstPort).toBe(80);
        expect(fwdTcp.srcPort).toBe(40000);

        // installDnatSession must have locked the LAN server's reply path to the forwarded WAN port.
        expect(router._nat._out.get(`${ipn(LAN_SERVER_IP)}:80:6`)).toBe(8080);
    });
});

// ── Full TCP session through NAT (real IPStack client + server) ────────────────

/**
 * Wire a plain IPStack interface to one of the HomeRouter's EthernetPorts so
 * both sides drive each other purely via Observable.doUpdate(), like the
 * direct-wire pattern in e2e_webRequest.test.js, but with the router's NAT
 * sitting in between instead of a plain wire.
 * @param {import('../../src/net/NetworkInterface.js').NetworkInterface} hostIf
 * @param {import('../../src/net/EthernetPort.js').EthernetPort} routerPort
 */
function wireHostToRouterPort(hostIf, routerPort) {
    hostIf.sendFrame = (dstMac, etherType, payload) => {
        if (etherType !== 0x0800) return;
        try {
            routerPort.recieve(new EthernetFrame({ dstMac, srcMac: hostIf.mac, etherType, payload }).pack());
        } catch { /* ignore malformed frames in test wiring */ }
    };
    routerPort.send = (frame) => {
        if (frame.etherType !== 0x0800) return;
        try { hostIf.inQueue.push(IPv4Packet.fromBytes(frame.payload)); hostIf.doUpdate(); } catch { /* ignore */ }
    };
}

const CLIENT_IP = '192.168.1.50';
const LAN_ROUTER_IP = '192.168.1.1'; // HomeRouter's default LAN IP
const SERVER_IP = '203.0.113.50';

/** Build a HomeRouter + a LAN client IPStack + a WAN server IPStack, all wired together. */
function makeNatTopology() {
    const router = makeRouter();

    const client = new IPStack(1, 'client');
    client.configureInterface(0, { ip: CLIENT_IP, prefixLength: 24 });
    client.addRoute(IPAddress.fromString('0.0.0.0'), 0, 0, IPAddress.fromString(LAN_ROUTER_IP), 'static');

    const server = new IPStack(1, 'server');
    server.configureInterface(0, { ip: SERVER_IP, prefixLength: 24 });

    const clientIf = client.interfaces[0];
    const serverIf = server.interfaces[0];

    // Pre-seed ARP so resolveNeighbor() never has to wait on a real ARP round trip
    // (nothing in this test harness drives simTimer.tick(), so any cache miss hangs forever).
    clientIf.neighborCache.set(LAN_ROUTER_IP, router._lanMac.slice());
    router._wanStack.interfaces[0].neighborCache.set(SERVER_IP, serverIf.mac.slice());
    serverIf.neighborCache.set(WAN_ROUTER_IP, router._wanMac.slice());

    wireHostToRouterPort(clientIf, router.eth1);
    wireHostToRouterPort(serverIf, router.wan0);

    return { router, client, server };
}

describe('HomeRouter NAT integration – full TCP session through NAT', () => {
    it('LAN client completes a TCP handshake and exchanges data with a WAN server via SNAT', async () => {
        const { router, client, server } = makeNatTopology();

        server.openTCPServerSocket(IPAddress.fromString('0.0.0.0'), 80);
        const acceptPromise = server.acceptTCPConn(80);

        const clientConn = await client.connectTCPConn(IPAddress.fromString(SERVER_IP), 80);
        expect(clientConn.state).toBe('ESTABLISHED');

        const serverConnKey = await acceptPromise;
        expect(serverConnKey).not.toBeNull();
        const serverConn = server.tcp.conns.get(serverConnKey);
        // The server sees the router's WAN IP as the peer, not the real LAN client — that's the NAT contract.
        expect(serverConn.peerIP.toString()).toBe(WAN_ROUTER_IP);

        // Exactly one NAT session should have been created for this TCP flow.
        const entries = router._nat.getEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].proto).toBe('TCP');
        expect(entries[0].lanIpNum).toBe(ipn(CLIENT_IP));

        // ── Client → server ────────────────────────────────────────────────
        const enc = new TextEncoder();
        const dec = new TextDecoder();

        client.sendTCPConn(clientConn.key, enc.encode('hello from LAN client'));
        await flush(30);

        const serverChunk = await server.recvTCPConn(serverConn.key);
        expect(dec.decode(serverChunk)).toBe('hello from LAN client');

        // ── Server → client ────────────────────────────────────────────────
        server.sendTCPConn(serverConn.key, enc.encode('hello from WAN server'));
        await flush(30);

        const clientChunk = await client.recvTCPConn(clientConn.key);
        expect(dec.decode(clientChunk)).toBe('hello from WAN server');

        client.closeTCPConn(clientConn.key);
        server.closeTCPConn(serverConn.key);
    });

    it('two LAN hosts opening TCP connections to the same WAN server get distinct NAT ports', async () => {
        const { router, client, server } = makeNatTopology();

        const client2 = new IPStack(1, 'client2');
        const CLIENT2_IP = '192.168.1.51';
        client2.configureInterface(0, { ip: CLIENT2_IP, prefixLength: 24 });
        client2.addRoute(IPAddress.fromString('0.0.0.0'), 0, 0, IPAddress.fromString(LAN_ROUTER_IP), 'static');
        const client2If = client2.interfaces[0];
        client2If.neighborCache.set(LAN_ROUTER_IP, router._lanMac.slice());
        wireHostToRouterPort(client2If, router.eth2);

        server.openTCPServerSocket(IPAddress.fromString('0.0.0.0'), 80);
        const accept1 = server.acceptTCPConn(80);
        const conn1 = await client.connectTCPConn(IPAddress.fromString(SERVER_IP), 80);
        const serverConn1Key = await accept1;
        const serverConn1 = server.tcp.conns.get(serverConn1Key);

        const accept2 = server.acceptTCPConn(80);
        const conn2 = await client2.connectTCPConn(IPAddress.fromString(SERVER_IP), 80);
        const serverConn2Key = await accept2;
        const serverConn2 = server.tcp.conns.get(serverConn2Key);

        expect(conn1.state).toBe('ESTABLISHED');
        expect(conn2.state).toBe('ESTABLISHED');
        // Same NAT'd peer IP (router's WAN IP) but must be distinguishable by port.
        expect(serverConn1.peerIP.toString()).toBe(WAN_ROUTER_IP);
        expect(serverConn2.peerIP.toString()).toBe(WAN_ROUTER_IP);
        expect(serverConn1.peerPort).not.toBe(serverConn2.peerPort);

        const entries = router._nat.getEntries();
        expect(entries).toHaveLength(2);
        expect(new Set(entries.map(e => e.lanIpNum))).toEqual(new Set([ipn(CLIENT_IP), ipn(CLIENT2_IP)]));

        client.closeTCPConn(conn1.key);
        client2.closeTCPConn(conn2.key);
        server.closeTCPConn(serverConn1Key);
        server.closeTCPConn(serverConn2Key);
    });
});
