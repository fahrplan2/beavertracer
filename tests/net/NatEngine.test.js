//@ts-check
import { describe, it, expect } from 'vitest';
import { NatEngine } from '../../src/net/NatEngine.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { UDPPacket } from '../../src/net/pdu/UDPPacket.js';
import { TCPPacket } from '../../src/net/pdu/TCPPacket.js';
import { ICMPPacket } from '../../src/net/pdu/ICMPPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

const LAN_IP = '192.168.1.10';
const LAN_IP_2 = '192.168.1.11';
const WAN_IP = '203.0.113.5';
const REMOTE_IP = '198.51.100.7';

/** @param {string} s @returns {number} */
const ipn = (s) => /** @type {number} */ (IPAddress.fromString(s).getNumber());

/** @param {number} srcPort @param {number} [dstPort] @param {string} [srcIp] */
function makeUdpPacket(srcPort, dstPort = 53, srcIp = LAN_IP) {
    const udp = new UDPPacket({ srcPort, dstPort, payload: new Uint8Array([1, 2, 3]) });
    const src = IPAddress.fromString(srcIp);
    const dst = IPAddress.fromString(REMOTE_IP);
    return new IPv4Packet({
        src, dst, protocol: 17,
        payload: udp.pack({ srcIp: src, dstIp: dst }),
    });
}

/** @param {number} srcPort @param {number} [dstPort] */
function makeTcpPacket(srcPort, dstPort = 80) {
    const tcp = new TCPPacket({ srcPort, dstPort, seq: 1000, flags: TCPPacket.FLAG_SYN });
    const src = IPAddress.fromString(LAN_IP);
    const dst = IPAddress.fromString(REMOTE_IP);
    return new IPv4Packet({
        src, dst, protocol: 6,
        payload: tcp.pack({ srcIp: src, dstIp: dst }),
    });
}

/** @param {number} identifier @param {number} [type] */
function makeIcmpPacket(identifier, type = 8) {
    const icmp = new ICMPPacket({ type, code: 0, identifier, sequence: 1 });
    return new IPv4Packet({
        src: IPAddress.fromString(LAN_IP),
        dst: IPAddress.fromString(REMOTE_IP),
        protocol: 1,
        payload: icmp.pack(),
    });
}

function wanIpNum() {
    return ipn(WAN_IP);
}

// ─── _allocPort ────────────────────────────────────────────────────────────

describe('NatEngine – _allocPort', () => {
    it('allocates ports from the configured pool without collisions', () => {
        const nat = new NatEngine();
        const a = nat._allocPort(17);
        const b = nat._allocPort(17);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a).not.toBe(b);
        expect(a).toBeGreaterThanOrEqual(10000);
        expect(a).toBeLessThanOrEqual(60000);
    });

    it('returns null instead of looping forever when the port pool is exhausted', () => {
        const nat = new NatEngine();
        for (let p = 10000; p <= 60000; p++) {
            nat._in.set(`${p}:17`, { srcIpNum: 0, srcPort: 0 });
        }
        const result = nat._allocPort(17);
        expect(result).toBeNull();
    });

    it('keeps TCP and UDP port pools independent', () => {
        const nat = new NatEngine();
        for (let p = 10000; p <= 60000; p++) {
            nat._in.set(`${p}:17`, { srcIpNum: 0, srcPort: 0 }); // fill only UDP (proto 17)
        }
        expect(nat._allocPort(17)).toBeNull();
        expect(nat._allocPort(6)).not.toBeNull(); // TCP pool still free
    });
});

// ─── natOutbound (SNAT, LAN → WAN) ──────────────────────────────────────────

describe('NatEngine – natOutbound', () => {
    it('rewrites source IP/port and creates a session mapping (UDP)', () => {
        const nat = new NatEngine();
        const pkt = makeUdpPacket(4000);
        const ok = nat.natOutbound(wanIpNum(), pkt);
        expect(ok).toBe(true);
        expect(pkt.src.toString()).toBe(WAN_IP);

        const u = UDPPacket.fromBytes(pkt.payload);
        expect(u.srcPort).not.toBe(4000);
        expect(nat._in.has(`${u.srcPort}:17`)).toBe(true);
    });

    it('rewrites source IP/port and creates a session mapping (TCP)', () => {
        const nat = new NatEngine();
        const pkt = makeTcpPacket(5000);
        const ok = nat.natOutbound(wanIpNum(), pkt);
        expect(ok).toBe(true);
        expect(pkt.src.toString()).toBe(WAN_IP);

        const t = TCPPacket.fromBytes(pkt.payload);
        expect(t.srcPort).not.toBe(5000);
        expect(nat._in.has(`${t.srcPort}:6`)).toBe(true);
    });

    it('reuses the same NAT port for repeated packets of the same flow', () => {
        const nat = new NatEngine();
        const pkt1 = makeUdpPacket(4000);
        const pkt2 = makeUdpPacket(4000);
        nat.natOutbound(wanIpNum(), pkt1);
        nat.natOutbound(wanIpNum(), pkt2);

        const p1 = UDPPacket.fromBytes(pkt1.payload).srcPort;
        const p2 = UDPPacket.fromBytes(pkt2.payload).srcPort;
        expect(p1).toBe(p2);
        expect(nat._out.size).toBe(1);
    });

    it('assigns distinct NAT ports to different LAN hosts using the same source port', () => {
        const nat = new NatEngine();
        const pktA = makeUdpPacket(4000, 53, LAN_IP);
        const pktB = makeUdpPacket(4000, 53, LAN_IP_2);
        nat.natOutbound(wanIpNum(), pktA);
        nat.natOutbound(wanIpNum(), pktB);

        const portA = UDPPacket.fromBytes(pktA.payload).srcPort;
        const portB = UDPPacket.fromBytes(pktB.payload).srcPort;
        expect(portA).not.toBe(portB);
    });

    it('drops the packet instead of hanging when no NAT port is available', () => {
        const nat = new NatEngine();
        for (let p = 10000; p <= 60000; p++) {
            nat._in.set(`${p}:17`, { srcIpNum: 0, srcPort: 0 });
        }
        const pkt = makeUdpPacket(4001);
        const ok = nat.natOutbound(wanIpNum(), pkt);
        expect(ok).toBe(false);
    });

    it('passes through non-first fragments by rewriting only the source IP', () => {
        const nat = new NatEngine();
        const pkt = new IPv4Packet({
            src: IPAddress.fromString(LAN_IP),
            dst: IPAddress.fromString(REMOTE_IP),
            protocol: 17,
            identification: 4242,
            fragmentOffset: 185, // non-first fragment, no transport header in payload
            payload: new Uint8Array([9, 9, 9, 9]),
        });
        const ok = nat.natOutbound(wanIpNum(), pkt);
        expect(ok).toBe(true);
        expect(pkt.src.toString()).toBe(WAN_IP);
        expect(pkt.payload).toEqual(new Uint8Array([9, 9, 9, 9])); // untouched
    });

    it('passes through other IP protocols by rewriting only the source IP', () => {
        const nat = new NatEngine();
        const pkt = new IPv4Packet({
            src: IPAddress.fromString(LAN_IP),
            dst: IPAddress.fromString(REMOTE_IP),
            protocol: 47, // GRE
            payload: new Uint8Array([1, 2, 3]),
        });
        const ok = nat.natOutbound(wanIpNum(), pkt);
        expect(ok).toBe(true);
        expect(pkt.src.toString()).toBe(WAN_IP);
    });
});

// ─── ICMP echo NAT round-trip ────────────────────────────────────────────────

describe('NatEngine – ICMP echo NAT', () => {
    it('rewrites the echo request identifier outbound and restores it inbound', () => {
        const nat = new NatEngine();
        const req = makeIcmpPacket(0x1234, 8);
        expect(nat.natOutbound(wanIpNum(), req)).toBe(true);

        const rewrittenIcmp = ICMPPacket.fromBytes(req.payload);
        expect(rewrittenIcmp.identifier).not.toBe(0x1234);
        expect(req.src.toString()).toBe(WAN_IP);

        // Simulate the echo reply coming back from the WAN host, addressed to the NAT'd identifier
        const reply = new IPv4Packet({
            src: IPAddress.fromString(REMOTE_IP),
            dst: IPAddress.fromString(WAN_IP),
            protocol: 1,
            payload: new ICMPPacket({ type: 0, code: 0, identifier: rewrittenIcmp.identifier, sequence: 1 }).pack(),
        });

        const origSrc = nat.natInbound(reply);
        expect(origSrc).toBe(ipn(LAN_IP));
        expect(reply.dst.toString()).toBe(LAN_IP);
        expect(ICMPPacket.fromBytes(reply.payload).identifier).toBe(0x1234);
    });

    it('ignores an inbound echo reply for an identifier with no mapping', () => {
        const nat = new NatEngine();
        const reply = new IPv4Packet({
            src: IPAddress.fromString(REMOTE_IP),
            dst: IPAddress.fromString(WAN_IP),
            protocol: 1,
            payload: new ICMPPacket({ type: 0, code: 0, identifier: 0xBEEF, sequence: 1 }).pack(),
        });
        expect(nat.natInbound(reply)).toBeNull();
    });
});

// ─── dnat / installDnatSession (port forwarding) ────────────────────────────

describe('NatEngine – dnat', () => {
    it('rewrites destination IP/port for UDP', () => {
        const nat = new NatEngine();
        const udp = new UDPPacket({ srcPort: 40000, dstPort: 8080, payload: new Uint8Array([1]) });
        const src = IPAddress.fromString(REMOTE_IP);
        const dst = IPAddress.fromString(WAN_IP);
        const pkt = new IPv4Packet({
            src, dst, protocol: 17,
            payload: udp.pack({ srcIp: src, dstIp: dst }),
        });

        const ok = nat.dnat(pkt, ipn(LAN_IP), 8000);
        expect(ok).toBe(true);
        expect(pkt.dst.toString()).toBe(LAN_IP);
        expect(UDPPacket.fromBytes(pkt.payload).dstPort).toBe(8000);
    });

    it('rewrites destination IP/port for TCP', () => {
        const nat = new NatEngine();
        const tcp = new TCPPacket({ srcPort: 40000, dstPort: 8080, seq: 1, flags: TCPPacket.FLAG_SYN });
        const src = IPAddress.fromString(REMOTE_IP);
        const dst = IPAddress.fromString(WAN_IP);
        const pkt = new IPv4Packet({
            src, dst, protocol: 6,
            payload: tcp.pack({ srcIp: src, dstIp: dst }),
        });

        const ok = nat.dnat(pkt, ipn(LAN_IP), 80);
        expect(ok).toBe(true);
        expect(pkt.dst.toString()).toBe(LAN_IP);
        expect(TCPPacket.fromBytes(pkt.payload).dstPort).toBe(80);
    });

    it('refuses to rewrite protocols other than TCP/UDP', () => {
        const nat = new NatEngine();
        const pkt = new IPv4Packet({
            src: IPAddress.fromString(REMOTE_IP),
            dst: IPAddress.fromString(WAN_IP),
            protocol: 1,
            payload: new ICMPPacket({ type: 8 }).pack(),
        });
        expect(nat.dnat(pkt, ipn(LAN_IP), 80)).toBe(false);
    });

    it('installDnatSession locks the LAN host\'s outbound SNAT to the forwarded WAN port', () => {
        const nat = new NatEngine();
        nat.installDnatSession(6, 8080, ipn(LAN_IP), 80);

        // The LAN server's reply (LAN_IP:80 → REMOTE_IP) must be SNAT'd to the forwarded port, not a fresh one
        const tcp = new TCPPacket({ srcPort: 80, dstPort: 40000, seq: 1, flags: TCPPacket.FLAG_SYN | TCPPacket.FLAG_ACK });
        const src = IPAddress.fromString(LAN_IP);
        const dst = IPAddress.fromString(REMOTE_IP);
        const pkt = new IPv4Packet({
            src, dst, protocol: 6,
            payload: tcp.pack({ srcIp: src, dstIp: dst }),
        });

        nat.natOutbound(wanIpNum(), pkt);
        expect(TCPPacket.fromBytes(pkt.payload).srcPort).toBe(8080);
    });
});

// ─── natInbound (WAN → LAN, stateful un-NAT) ────────────────────────────────

describe('NatEngine – natInbound', () => {
    it('un-NATs a UDP reply for an existing outbound session', () => {
        const nat = new NatEngine();
        const outPkt = makeUdpPacket(4000);
        nat.natOutbound(wanIpNum(), outPkt);
        const natPort = UDPPacket.fromBytes(outPkt.payload).srcPort;

        const udp = new UDPPacket({ srcPort: 53, dstPort: natPort, payload: new Uint8Array([1]) });
        const src = IPAddress.fromString(REMOTE_IP);
        const dst = IPAddress.fromString(WAN_IP);
        const inPkt = new IPv4Packet({
            src, dst, protocol: 17,
            payload: udp.pack({ srcIp: src, dstIp: dst }),
        });

        const origSrc = nat.natInbound(inPkt);
        expect(origSrc).toBe(ipn(LAN_IP));
        expect(inPkt.dst.toString()).toBe(LAN_IP);
        expect(UDPPacket.fromBytes(inPkt.payload).dstPort).toBe(4000);
    });

    it('returns null for an inbound packet with no matching session', () => {
        const nat = new NatEngine();
        const udp = new UDPPacket({ srcPort: 53, dstPort: 12345, payload: new Uint8Array([1]) });
        const src = IPAddress.fromString(REMOTE_IP);
        const dst = IPAddress.fromString(WAN_IP);
        const pkt = new IPv4Packet({
            src, dst, protocol: 17,
            payload: udp.pack({ srcIp: src, dstIp: dst }),
        });
        expect(nat.natInbound(pkt)).toBeNull();
    });

    it('returns null for unsupported protocols with no fragment/ICMP mapping', () => {
        const nat = new NatEngine();
        const pkt = new IPv4Packet({
            src: IPAddress.fromString(REMOTE_IP),
            dst: IPAddress.fromString(WAN_IP),
            protocol: 47, // GRE
            payload: new Uint8Array([1, 2, 3]),
        });
        expect(nat.natInbound(pkt)).toBeNull();
    });

    it('routes subsequent non-first fragments to the same LAN host as the first fragment', () => {
        const nat = new NatEngine();
        const outPkt = makeUdpPacket(4000);
        nat.natOutbound(wanIpNum(), outPkt);
        const natPort = UDPPacket.fromBytes(outPkt.payload).srcPort;

        const udp = new UDPPacket({ srcPort: 53, dstPort: natPort, payload: new Uint8Array([1]) });
        const src = IPAddress.fromString(REMOTE_IP);
        const dst = IPAddress.fromString(WAN_IP);
        const firstFrag = new IPv4Packet({
            src, dst, protocol: 17,
            identification: 777,
            flags: 0x01, // MF=1
            payload: udp.pack({ srcIp: src, dstIp: dst }),
        });
        expect(nat.natInbound(firstFrag)).toBe(ipn(LAN_IP));
        expect(nat._fragIn.get(777)).toBe(ipn(LAN_IP));

        const lastFrag = new IPv4Packet({
            src, dst, protocol: 17,
            identification: 777,
            flags: 0x00, // MF=0, last fragment
            fragmentOffset: 185,
            payload: new Uint8Array([9, 9]),
        });
        const lanIp = nat.natInbound(lastFrag);
        expect(lanIp).toBe(ipn(LAN_IP));
        expect(lastFrag.dst.toString()).toBe(LAN_IP);
        // Last fragment (MF=0) must clear the reassembly mapping
        expect(nat._fragIn.has(777)).toBe(false);
    });

    it('drops a non-first fragment with an unknown identification', () => {
        const nat = new NatEngine();
        const pkt = new IPv4Packet({
            src: IPAddress.fromString(REMOTE_IP),
            dst: IPAddress.fromString(WAN_IP),
            protocol: 17,
            identification: 999,
            fragmentOffset: 185,
            payload: new Uint8Array([1, 2]),
        });
        expect(nat.natInbound(pkt)).toBeNull();
    });
});

// ─── getEntries / clear ──────────────────────────────────────────────────────

describe('NatEngine – getEntries / clear', () => {
    it('lists active UDP, TCP and ICMP sessions', () => {
        const nat = new NatEngine();
        nat.natOutbound(wanIpNum(), makeUdpPacket(4000));
        nat.natOutbound(wanIpNum(), makeTcpPacket(5000));
        nat.natOutbound(wanIpNum(), makeIcmpPacket(0x1234));

        const entries = nat.getEntries();
        const protos = entries.map(e => e.proto).sort();
        expect(protos).toEqual(['ICMP', 'TCP', 'UDP']);
        expect(entries.every(e => e.lanIpNum === ipn(LAN_IP))).toBe(true);
    });

    it('clear() resets all session tables', () => {
        const nat = new NatEngine();
        nat.natOutbound(wanIpNum(), makeUdpPacket(4000));
        nat.natOutbound(wanIpNum(), makeIcmpPacket(0x1234));
        nat._fragIn.set(1, ipn(LAN_IP));

        nat.clear();

        expect(nat._out.size).toBe(0);
        expect(nat._in.size).toBe(0);
        expect(nat._icmpOut.size).toBe(0);
        expect(nat._icmpIn.size).toBe(0);
        expect(nat._fragIn.size).toBe(0);
        expect(nat.getEntries()).toEqual([]);
    });
});
