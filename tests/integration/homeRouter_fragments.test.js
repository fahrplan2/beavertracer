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
import { ICMPPacket } from '../../src/net/pdu/ICMPPacket.js';
import { onesComplementChecksum } from '../../src/net/util/checksumUtils.js';

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


/** All pending outgoing frames on a port, parsed as IPv4. */
function drainIp(port) {
    const out = [];
    let raw;
    while ((raw = port.getNextOutgoingFrame())) {
        const eth = EthernetFrame.fromBytes(raw);
        if (eth.etherType !== 0x0800) continue;
        out.push({ eth, ip: IPv4Packet.fromBytes(eth.payload), size: eth.payload.length });
    }
    return out;
}

/** @param {IPv4Packet[]} frags */
function reassemble(frags) {
    const len = frags.reduce((n, f) => Math.max(n, f.fragmentOffset * 8 + f.payload.length), 0);
    const buf = new Uint8Array(len);
    for (const f of frags) buf.set(f.payload, f.fragmentOffset * 8);
    return buf;
}

/** @param {Uint8Array} seg @param {string} src @param {string} dst */
function udpChecksumOk(seg, src, dst) {
    const ph = new Uint8Array(12);
    ph.set(IPAddress.fromString(src).toUInt8(), 0); ph.set(IPAddress.fromString(dst).toUInt8(), 4);
    ph[9] = 17; ph[10] = seg.length >> 8; ph[11] = seg.length & 0xff;
    return onesComplementChecksum([ph, seg]) === 0;
}

/** IPv4 packets of one UDP datagram, fragmented at `mtu` (mtu=0 → unfragmented). */
function udpDatagram({ src, dst, sp, dp, size, mtu = 0, flags = 0, id = 0x1111 }) {
    const s = IPAddress.fromString(src), d = IPAddress.fromString(dst);
    const seg = new UDPPacket({ srcPort: sp, dstPort: dp, payload: new Uint8Array(size).map((_, i) => i & 0xff) }).pack({ srcIp: s, dstIp: d });
    if (!mtu) return [new IPv4Packet({ src: s, dst: d, protocol: 17, ttl: 64, identification: id, flags, payload: seg })];
    const max = Math.floor((mtu - 20) / 8) * 8;
    const out = [];
    for (let pos = 0; pos < seg.length; pos += max) {
        const last = pos + max >= seg.length;
        out.push(new IPv4Packet({ src: s, dst: d, protocol: 17, ttl: 64, identification: id,
            flags: last ? 0 : 1, fragmentOffset: pos / 8, payload: seg.slice(pos, pos + max) }));
    }
    return out;
}

const toFrame = (/** @type {Uint8Array} */ dstMac, /** @type {Uint8Array} */ srcMac, /** @type {IPv4Packet} */ p) =>
    new EthernetFrame({ dstMac, srcMac, etherType: 0x0800, payload: p.pack() }).pack();

describe('HomeRouter – fragments through NAT', () => {
    /** @type {HomeRouter} */
    let router;
    beforeEach(() => { router = makeRouter(); });

    it('NATs a fragmented UDP datagram LAN → WAN and the WAN reply back (ports + checksum after reassembly)', async () => {
        for (const p of udpDatagram({ src: LAN_HOST_IP, dst: WAN_HOST_IP, sp: 4000, dp: 5004, size: 3000, mtu: 1500 }))
            router.eth1.recieve(toFrame(router._lanMac, LAN_HOST_MAC, p));
        await flush(40);

        const out = drainIp(router.wan0).map(o => o.ip);
        expect(out.length).toBe(3);
        expect(out.every(p => p.src.toString() === WAN_ROUTER_IP)).toBe(true);
        const seg = reassemble(out);
        const udp = UDPPacket.fromBytes(seg);
        expect(udp.srcPort).not.toBe(4000);
        expect(udp.dstPort).toBe(5004);
        expect(udpChecksumOk(seg, WAN_ROUTER_IP, WAN_HOST_IP)).toBe(true);
        const natPort = udp.srcPort;

        for (const p of udpDatagram({ src: WAN_HOST_IP, dst: WAN_ROUTER_IP, sp: 5004, dp: natPort, size: 3000, mtu: 1500, id: 0x2222 }))
            router.wan0.recieve(toFrame(router._wanMac, WAN_HOST_MAC, p));
        await flush(40);

        const back = drainIp(router.eth1).map(o => o.ip);
        expect(back.length).toBe(3);
        expect(back.every(p => p.dst.toString() === LAN_HOST_IP)).toBe(true);
        const seg2 = reassemble(back);
        expect(UDPPacket.fromBytes(seg2).dstPort).toBe(4000);
        expect(udpChecksumOk(seg2, WAN_HOST_IP, LAN_HOST_IP)).toBe(true);
    });

    it('fragments a non-DF packet to the WAN link MTU', async () => {
        router.wan0.linkref = /** @type {any} */ ({ mtu: 1400 });
        const [p] = udpDatagram({ src: LAN_HOST_IP, dst: WAN_HOST_IP, sp: 4000, dp: 5004, size: 1472 });
        router.eth1.recieve(toFrame(router._lanMac, LAN_HOST_MAC, p));
        await flush(40);

        const out = drainIp(router.wan0);
        expect(out.length).toBe(2);
        expect(out.every(o => o.size <= 1400)).toBe(true);
        const seg = reassemble(out.map(o => o.ip));
        expect(udpChecksumOk(seg, WAN_ROUTER_IP, WAN_HOST_IP)).toBe(true);
    });

    it('PMTUD: a DF packet larger than the WAN MTU yields Fragmentation Needed to the LAN host (RFC 1191)', async () => {
        router.wan0.linkref = /** @type {any} */ ({ mtu: 1400 });
        const [p] = udpDatagram({ src: LAN_HOST_IP, dst: WAN_HOST_IP, sp: 4000, dp: 5004, size: 1472, flags: 0x02 });
        router.eth1.recieve(toFrame(router._lanMac, LAN_HOST_MAC, p));
        await flush(40);

        expect(drainIp(router.wan0).length).toBe(0);
        const back = drainIp(router.eth1);
        expect(back.length).toBe(1);
        const { eth, ip } = back[0];
        expect(eth.dstMac).toEqual(LAN_HOST_MAC);
        expect(ip.dst.toString()).toBe(LAN_HOST_IP);
        expect(ip.protocol).toBe(1);
        const icmp = ip.payload;
        expect(icmp[0]).toBe(3);
        expect(icmp[1]).toBe(4);
        expect((icmp[6] << 8) | icmp[7]).toBe(1400);
        expect(onesComplementChecksum([icmp])).toBe(0);
        // quoted header is the original (un-NATed) one
        const quoted = icmp.slice(8);
        expect(Array.from(quoted.slice(12, 16)).join('.')).toBe(LAN_HOST_IP);
        expect((quoted[20] << 8) | quoted[21]).toBe(4000);
        expect(router._nat.getEntries()).toHaveLength(0); // no NAT session for a dropped packet
    });

    it('sends Destination Unreachable to the LAN host when there is no WAN route', async () => {
        router._wanStack.routingTable = router._wanStack.routingTable.filter(r => r.prefixLength !== 0);
        const [p] = udpDatagram({ src: LAN_HOST_IP, dst: '198.51.100.1', sp: 4000, dp: 5004, size: 10 });
        router.eth1.recieve(toFrame(router._lanMac, LAN_HOST_MAC, p));
        await flush(40);
        const back = drainIp(router.eth1);
        expect(back.length).toBe(1);
        expect(back[0].ip.dst.toString()).toBe(LAN_HOST_IP);
        expect(back[0].ip.payload[0]).toBe(3);
        expect(back[0].ip.payload[1]).toBe(0);
    });
});
