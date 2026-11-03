//@ts-check
import { describe, it, expect } from 'vitest';
// Importing SimControl.js before any sim/*.js class breaks a circular-import
// cycle (SimulatedObject.js <-> SimControl.js <-> Link.js) that otherwise throws
// "Class extends value undefined" when a sim/*.js module is the graph entry point.
import '../../src/SimControl.js';
import { Firewall, STATE_IDLE_TIMEOUT_MS } from '../../src/sim/Firewall.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { IPv6Packet } from '../../src/net/pdu/IPv6Packet.js';
import { TCPPacket } from '../../src/net/pdu/TCPPacket.js';
import { UDPPacket } from '../../src/net/pdu/UDPPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { simTimer, SimTimer } from '../../src/lib/SimTimer.js';

// SimulatedObject's constructor creates a `<div>` via document.createElement.
// This suite runs in the 'node' test environment (no real DOM), and Firewall's
// packet-processing logic never touches the DOM, so a minimal stub is enough.
globalThis.document = /** @type {any} */ ({
    createElement: () => ({
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild() {},
        remove() {},
        style: {},
    }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const SENTINEL = {};
const MAC_A = new Uint8Array([0, 1, 2, 3, 4, 0xaa]);
const MAC_B = new Uint8Array([0, 1, 2, 3, 4, 0xbb]);
const BCAST = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

const HOST_A = '10.0.0.1';
const HOST_B = '10.0.0.2';

let _ruleId = 1;
/** @param {object} [overrides] */
function rule(overrides = {}) {
    return {
        id: _ruleId++, enabled: true, direction: 'both', ipVersion: 'any',
        protocol: 'any', srcIp: '', srcPort: '', dstIp: '', dstPort: '', action: 'allow',
        ...overrides,
    };
}

/** Fakes both ports as "linked" (truthy linkref) without a real EthernetLink peer. */
function linkFw(fw) {
    fw._port0.link(/** @type {any} */ (SENTINEL));
    fw._port1.link(/** @type {any} */ (SENTINEL));
}

/**
 * @param {object} o
 * @param {number} o.protocol
 * @param {string} [o.srcIp] @param {string} [o.dstIp]
 * @param {number} [o.srcPort] @param {number} [o.dstPort]
 */
function ipv4Frame({ protocol, srcIp = HOST_A, dstIp = HOST_B, srcPort = 1234, dstPort = 80 }) {
    const src = IPAddress.fromString(srcIp);
    const dst = IPAddress.fromString(dstIp);
    let payload;
    if (protocol === 6) {
        payload = new TCPPacket({ srcPort, dstPort, seq: 1, flags: TCPPacket.FLAG_SYN }).pack({ srcIp: src, dstIp: dst });
    } else if (protocol === 17) {
        payload = new UDPPacket({ srcPort, dstPort, payload: new Uint8Array([1, 2, 3]) }).pack({ srcIp: src, dstIp: dst });
    } else {
        payload = new Uint8Array([8, 0, 0, 0]); // e.g. ICMP echo — Firewall never inspects this payload
    }
    const ip = new IPv4Packet({ src, dst, protocol, payload });
    return new EthernetFrame({ srcMac: MAC_A, dstMac: MAC_B, etherType: 0x0800, payload: ip.pack() });
}

/**
 * @param {object} o
 * @param {number} o.nextHeader
 * @param {string} [o.srcIp] @param {string} [o.dstIp]
 */
function ipv6Frame({ nextHeader, srcIp = 'fd00::1', dstIp = 'fd00::2' }) {
    const ip = new IPv6Packet({
        src: IPAddress.fromString(srcIp), dst: IPAddress.fromString(dstIp),
        nextHeader, payload: new Uint8Array([0, 0, 0, 0]),
    });
    return new EthernetFrame({ srcMac: MAC_A, dstMac: MAC_B, etherType: 0x86dd, payload: ip.pack() });
}

function arpFrame() {
    return new EthernetFrame({ srcMac: MAC_A, dstMac: BCAST, etherType: 0x0806, payload: new Uint8Array(28) });
}

/** Injects a frame into port A (index 0) and lets the firewall process it synchronously. */
function sendAtoB(fw, frame) { fw._port0.recieve(frame.pack()); }
/** Injects a frame into port B (index 1) — simulates the reply direction. */
function sendBtoA(fw, frame) { fw._port1.recieve(frame.pack()); }

/** @returns {EthernetFrame|null} */
function drain(port) {
    const raw = port.getNextOutgoingFrame();
    return raw ? EthernetFrame.fromBytes(raw) : null;
}

/** Advance the shared simTimer by the given number of simulated ms. */
function advance(simMs) {
    for (let i = 0; i < SimTimer.toTicks(simMs); i++) simTimer.tick();
}


/** Build the IPv4 fragments of one UDP/TCP datagram (as IPStack would). */
function fragFrames({ protocol = 17, dstPort = 53, id = 0x4242, size = 3000, mtu = 1500 } = {}) {
    const src = IPAddress.fromString(HOST_A), dst = IPAddress.fromString(HOST_B);
    const data = new Uint8Array(size).fill(0x5a);
    const seg = protocol === 17
        ? new UDPPacket({ srcPort: 40000, dstPort, payload: data }).pack({ srcIp: src, dstIp: dst })
        : new TCPPacket({ srcPort: 40000, dstPort, seq: 1, flags: TCPPacket.FLAG_ACK, payload: data }).pack({ srcIp: src, dstIp: dst });
    const max = Math.floor((mtu - 20) / 8) * 8;
    const frames = [];
    for (let pos = 0; pos < seg.length; pos += max) {
        const last = pos + max >= seg.length;
        const ip = new IPv4Packet({ src, dst, protocol, identification: id, flags: last ? 0 : 1,
            fragmentOffset: pos / 8, payload: seg.slice(pos, pos + max) });
        frames.push(new EthernetFrame({ srcMac: MAC_A, dstMac: MAC_B, etherType: 0x0800, payload: ip.pack() }));
    }
    return frames;
}

/** @param {object} o */
function rawFrag({ protocol, flags, fragmentOffset, payload, id = 7 }) {
    const ip = new IPv4Packet({ src: IPAddress.fromString(HOST_A), dst: IPAddress.fromString(HOST_B),
        protocol, identification: id, flags, fragmentOffset, payload });
    return new EthernetFrame({ srcMac: MAC_A, dstMac: MAC_B, etherType: 0x0800, payload: ip.pack() });
}

function drainAll(port) { let n = 0; while (drain(port)) n++; return n; }

describe('Firewall – IPv4 fragments (RFC 1858)', () => {
    it('a "deny UDP 53" rule also blocks a fragmented UDP datagram (all fragments)', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [rule({ protocol: 'udp', dstPort: '53', action: 'deny' })];
        const frames = fragFrames({ dstPort: 53 });
        expect(frames.length).toBe(3);
        for (const f of frames) sendAtoB(fw, f);
        expect(drainAll(fw._port1)).toBe(0);
        expect(fw._stats.dropped).toBe(3);
    });

    it('lets all fragments of an allowed datagram through', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [rule({ protocol: 'udp', dstPort: '53', action: 'deny' })];
        for (const f of fragFrames({ dstPort: 5060 })) sendAtoB(fw, f);
        expect(drainAll(fw._port1)).toBe(3);
    });

    it('matches the ports of a fragmented TCP segment from its first fragment only', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.defaultPolicy = 'deny';
        fw.rules = [rule({ protocol: 'tcp', dstPort: '80', action: 'allow' })];
        for (const f of fragFrames({ protocol: 6, dstPort: 80, id: 1 })) sendAtoB(fw, f);
        expect(drainAll(fw._port1)).toBe(3);
        for (const f of fragFrames({ protocol: 6, dstPort: 22, id: 2 })) sendAtoB(fw, f);
        expect(drainAll(fw._port1)).toBe(0);
    });

    it('drops non-first fragments whose first fragment was never seen', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [];
        const [, second, third] = fragFrames({ dstPort: 5060, id: 99 });
        sendAtoB(fw, second);
        sendAtoB(fw, third);
        expect(drainAll(fw._port1)).toBe(0);
    });

    it('drops a tiny first fragment that does not hold the whole TCP header', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = []; // default allow
        sendAtoB(fw, rawFrag({ protocol: 6, flags: 1, fragmentOffset: 0, payload: new Uint8Array([0x9c, 0x40, 0, 80, 0, 0, 0, 1]) }));
        expect(drainAll(fw._port1)).toBe(0);
        expect(fw._stats.dropped).toBe(1);
    });

    it('drops a fragment with offset 1 (overlapping the L4 header)', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [];
        const frames = fragFrames({ protocol: 6, dstPort: 80, id: 5 });
        sendAtoB(fw, frames[0]); // allowed first fragment
        sendAtoB(fw, rawFrag({ protocol: 6, flags: 0, fragmentOffset: 1, payload: new Uint8Array(16), id: 5 }));
        expect(drainAll(fw._port1)).toBe(1);
    });

    it('stateful mode: return fragments follow their first fragment matched via the state table', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.statefulMode = true;
        fw.defaultPolicy = 'deny';
        fw.rules = [rule({ direction: 'AtoB', protocol: 'udp', action: 'allow' })];
        sendAtoB(fw, ipv4Frame({ protocol: 17, srcPort: 40000, dstPort: 53 }));
        expect(drainAll(fw._port1)).toBe(1);
        // fragmented reply B → A (ports swapped)
        const src = IPAddress.fromString(HOST_B), dst = IPAddress.fromString(HOST_A);
        const seg = new UDPPacket({ srcPort: 53, dstPort: 40000, payload: new Uint8Array(2000) }).pack({ srcIp: src, dstIp: dst });
        const mk = (/** @type {number} */ off, /** @type {number} */ fl, /** @type {Uint8Array} */ p) => new EthernetFrame({ srcMac: MAC_B, dstMac: MAC_A, etherType: 0x0800,
            payload: new IPv4Packet({ src, dst, protocol: 17, identification: 3, flags: fl, fragmentOffset: off, payload: p }).pack() });
        sendBtoA(fw, mk(0, 1, seg.slice(0, 1480)));
        sendBtoA(fw, mk(185, 0, seg.slice(1480)));
        expect(drainAll(fw._port0)).toBe(2);
    });

    it('drops an IPv4 packet with a bad header checksum instead of passing it as "non-IP"', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [rule({ protocol: 'udp', dstPort: '53', action: 'deny' })];
        const f = ipv4Frame({ protocol: 17, dstPort: 53 });
        f.payload[10] ^= 0xff;
        sendAtoB(fw, f);
        expect(drainAll(fw._port1)).toBe(0);
    });
});
