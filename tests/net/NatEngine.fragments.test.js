//@ts-check
/**
 * NatEngine with fragmented datagrams (RFC 3022 §4.1, RFC 1624) and the
 * embedded L4 checksum of translated ICMP errors (RFC 5508 §4).
 */
import { describe, it, expect } from 'vitest';
import { NatEngine } from '../../src/net/NatEngine.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { UDPPacket } from '../../src/net/pdu/UDPPacket.js';
import { TCPPacket } from '../../src/net/pdu/TCPPacket.js';
import { ICMPPacket } from '../../src/net/pdu/ICMPPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { onesComplementChecksum } from '../../src/net/util/checksumUtils.js';

const LAN_IP = '192.168.1.10';
const WAN_IP = '203.0.113.5';
const REMOTE_IP = '198.51.100.7';
/** @param {string} s */
const ipn = (s) => /** @type {number} */ (IPAddress.fromString(s).getNumber()) >>> 0;
const ip = (/** @type {string} */ s) => IPAddress.fromString(s);

/** Split an IPv4 packet like IPStack._sendFragments does. @param {IPv4Packet} p @param {number} mtu */
function fragment(p, mtu) {
    const max = Math.floor((mtu - 20) / 8) * 8;
    const out = [];
    for (let pos = 0; pos < p.payload.length; pos += max) {
        const last = pos + max >= p.payload.length;
        out.push(new IPv4Packet({
            src: p.src, dst: p.dst, protocol: p.protocol, ttl: p.ttl,
            identification: p.identification, flags: last ? 0 : 1, fragmentOffset: pos / 8,
            payload: p.payload.slice(pos, pos + max),
        }));
    }
    // round-trip through bytes so every fragment is a wire-accurate packet
    return out.map(f => IPv4Packet.fromBytes(f.pack()));
}

/** @param {IPv4Packet[]} frags */
function reassemble(frags) {
    const sorted = [...frags].sort((a, b) => a.fragmentOffset - b.fragmentOffset);
    const len = sorted.reduce((n, f) => n + f.payload.length, 0);
    const buf = new Uint8Array(len);
    for (const f of sorted) buf.set(f.payload, f.fragmentOffset * 8);
    return buf;
}

/** Verify a TCP/UDP checksum over the IPv4 pseudo header (sum incl. checksum must be 0). */
function l4ChecksumOk(/** @type {Uint8Array} */ seg, /** @type {string} */ src, /** @type {string} */ dst, /** @type {number} */ proto) {
    const ph = new Uint8Array(12);
    ph.set(ip(src).toUInt8(), 0); ph.set(ip(dst).toUInt8(), 4);
    ph[9] = proto; ph[10] = seg.length >> 8; ph[11] = seg.length & 0xff;
    return onesComplementChecksum([ph, seg]) === 0;
}

function bigUdp(/** @type {string} */ src, /** @type {string} */ dst, /** @type {number} */ sp, /** @type {number} */ dp, id = 4711) {
    const data = new Uint8Array(3000).map((_, i) => (i * 7) & 0xff);
    const udp = new UDPPacket({ srcPort: sp, dstPort: dp, payload: data });
    return new IPv4Packet({ src: ip(src), dst: ip(dst), protocol: 17, identification: id, payload: udp.pack({ srcIp: ip(src), dstIp: ip(dst) }) });
}

describe('NatEngine – fragmented UDP (RFC 3022 §4.1)', () => {
    it('translates an outbound fragmented UDP datagram: ports + checksum valid after reassembly', () => {
        const nat = new NatEngine();
        const frags = fragment(bigUdp(LAN_IP, REMOTE_IP, 4000, 53), 1500);
        expect(frags.length).toBe(3);
        for (const f of frags) expect(nat.natOutbound(ipn(WAN_IP), f)).toBe(true);
        for (const f of frags) expect(f.src.toString()).toBe(WAN_IP);

        const seg = reassemble(frags);
        const udp = UDPPacket.fromBytes(seg);
        const session = nat._out.get(`${ipn(LAN_IP)}:4000:17`);
        expect(session).toBeDefined();
        expect(udp.srcPort).toBe(session?.natPort);
        expect(udp.dstPort).toBe(53);
        expect(udp.payload.length).toBe(3000);
        expect(l4ChecksumOk(seg, WAN_IP, REMOTE_IP, 17)).toBe(true);
        nat.destroy();
    });

    it('translates an inbound fragmented UDP reply back to the LAN host (all fragments, valid checksum)', () => {
        const nat = new NatEngine();
        const first = bigUdp(LAN_IP, REMOTE_IP, 4000, 53);
        // unfragmented outbound packet primes the session
        const small = new IPv4Packet({ src: ip(LAN_IP), dst: ip(REMOTE_IP), protocol: 17,
            payload: new UDPPacket({ srcPort: 4000, dstPort: 53, payload: new Uint8Array([1]) }).pack({ srcIp: ip(LAN_IP), dstIp: ip(REMOTE_IP) }) });
        nat.natOutbound(ipn(WAN_IP), small);
        const natPort = UDPPacket.fromBytes(small.payload).srcPort;
        expect(first).toBeDefined();

        const frags = fragment(bigUdp(REMOTE_IP, WAN_IP, 53, natPort, 999), 1500);
        for (const f of frags) expect(nat.natInbound(f)).toBe(ipn(LAN_IP));
        for (const f of frags) expect(f.dst.toString()).toBe(LAN_IP);

        const seg = reassemble(frags);
        const udp = UDPPacket.fromBytes(seg);
        expect(udp.srcPort).toBe(53);
        expect(udp.dstPort).toBe(4000);
        expect(l4ChecksumOk(seg, REMOTE_IP, LAN_IP, 17)).toBe(true);
        expect(nat._fragIn.size).toBe(0); // last fragment cleared the mapping
        nat.destroy();
    });

    it('keys inbound fragments by (src, dst, proto, id), not by the identification alone', () => {
        const nat = new NatEngine();
        const small = new IPv4Packet({ src: ip(LAN_IP), dst: ip(REMOTE_IP), protocol: 17,
            payload: new UDPPacket({ srcPort: 4000, dstPort: 53, payload: new Uint8Array([1]) }).pack({ srcIp: ip(LAN_IP), dstIp: ip(REMOTE_IP) }) });
        nat.natOutbound(ipn(WAN_IP), small);
        const natPort = UDPPacket.fromBytes(small.payload).srcPort;
        const [first] = fragment(bigUdp(REMOTE_IP, WAN_IP, 53, natPort, 1234), 1500);
        expect(nat.natInbound(first)).toBe(ipn(LAN_IP));

        // a non-first fragment from a different sender with the same identification
        const foreign = new IPv4Packet({ src: ip('192.0.2.66'), dst: ip(WAN_IP), protocol: 17,
            identification: 1234, fragmentOffset: 185, payload: new Uint8Array(16) });
        expect(nat.natInbound(foreign)).toBeNull();
        nat.destroy();
    });

    it('DNATs a fragmented UDP datagram via a port-forward rule', () => {
        const nat = new NatEngine();
        const frags = fragment(bigUdp(REMOTE_IP, WAN_IP, 5000, 9000, 77), 1500);
        expect(nat.dnat(frags[0], ipn(LAN_IP), 9001)).toBe(true);
        for (const f of frags.slice(1)) expect(nat.natInbound(f)).toBe(ipn(LAN_IP));
        const seg = reassemble(frags);
        expect(UDPPacket.fromBytes(seg).dstPort).toBe(9001);
        expect(l4ChecksumOk(seg, REMOTE_IP, LAN_IP, 17)).toBe(true);
        nat.destroy();
    });

    it('drops a too-short first fragment (tiny fragment)', () => {
        const nat = new NatEngine();
        const tiny = new IPv4Packet({ src: ip(LAN_IP), dst: ip(REMOTE_IP), protocol: 6,
            identification: 5, flags: 1, payload: new Uint8Array([0x0f, 0xa0, 0, 80, 0, 0, 0, 1]) });
        expect(nat.natOutbound(ipn(WAN_IP), tiny)).toBe(false);
        nat.destroy();
    });

    it('translates a fragmented ICMP echo with a valid ICMP checksum', () => {
        const nat = new NatEngine();
        const echo = new ICMPPacket({ type: 8, code: 0, identifier: 0x1234, sequence: 1, payload: new Uint8Array(3000).fill(0xab) });
        const p = new IPv4Packet({ src: ip(LAN_IP), dst: ip(REMOTE_IP), protocol: 1, identification: 42, payload: echo.pack() });
        const frags = fragment(p, 1500);
        for (const f of frags) expect(nat.natOutbound(ipn(WAN_IP), f)).toBe(true);
        const msg = reassemble(frags);
        expect(onesComplementChecksum([msg])).toBe(0);
        expect((msg[4] << 8) | msg[5]).not.toBe(0x1234);
        nat.destroy();
    });
});

describe('NatEngine – ICMP error with embedded L4 checksum (RFC 5508 §4)', () => {
    it('restores the quoted UDP checksum together with the quoted source IP/port', () => {
        const nat = new NatEngine();
        const udp = new UDPPacket({ srcPort: 4000, dstPort: 33434, payload: new Uint8Array([1, 2, 3, 4]) });
        const orig = new IPv4Packet({ src: ip(LAN_IP), dst: ip(REMOTE_IP), protocol: 17, payload: udp.pack({ srcIp: ip(LAN_IP), dstIp: ip(REMOTE_IP) }) });
        const origCs = (orig.payload[6] << 8) | orig.payload[7];
        expect(origCs).not.toBe(0);
        nat.natOutbound(ipn(WAN_IP), orig);

        const icmp = new ICMPPacket({ type: 3, code: 3, payload: orig.pack().slice(0, 28) });
        const err = new IPv4Packet({ src: ip(REMOTE_IP), dst: ip(WAN_IP), protocol: 1, payload: icmp.pack() });
        expect(nat.natInbound(err)).toBe(ipn(LAN_IP));

        const q = err.payload.slice(8);
        expect((q[20] << 8) | q[21]).toBe(4000);
        expect((q[26] << 8) | q[27]).toBe(origCs);
        nat.destroy();
    });

    it('leaves a quoted UDP checksum of 0 (none) untouched', () => {
        const nat = new NatEngine();
        const udp = new UDPPacket({ srcPort: 4000, dstPort: 33434, payload: new Uint8Array([1, 2, 3, 4]) });
        const orig = new IPv4Packet({ src: ip(LAN_IP), dst: ip(REMOTE_IP), protocol: 17, payload: udp.pack({ srcIp: ip(LAN_IP), dstIp: ip(REMOTE_IP) }) });
        nat.natOutbound(ipn(WAN_IP), orig);
        const quoted = orig.pack().slice(0, 28);
        quoted[26] = 0; quoted[27] = 0;
        const err = new IPv4Packet({ src: ip(REMOTE_IP), dst: ip(WAN_IP), protocol: 1,
            payload: new ICMPPacket({ type: 3, code: 3, payload: quoted }).pack() });
        expect(nat.natInbound(err)).toBe(ipn(LAN_IP));
        const q = err.payload.slice(8);
        expect((q[26] << 8) | q[27]).toBe(0);
        nat.destroy();
    });

    it('restores the quoted TCP checksum when it is part of the quote', () => {
        const nat = new NatEngine();
        const tcp = new TCPPacket({ srcPort: 5000, dstPort: 80, seq: 1, flags: TCPPacket.FLAG_SYN });
        const orig = new IPv4Packet({ src: ip(LAN_IP), dst: ip(REMOTE_IP), protocol: 6, payload: tcp.pack({ srcIp: ip(LAN_IP), dstIp: ip(REMOTE_IP) }) });
        const origCs = (orig.payload[16] << 8) | orig.payload[17];
        nat.natOutbound(ipn(WAN_IP), orig);
        // RFC 1812 routers may quote more than 8 bytes
        const err = new IPv4Packet({ src: ip(REMOTE_IP), dst: ip(WAN_IP), protocol: 1,
            payload: new ICMPPacket({ type: 3, code: 1, payload: orig.pack() }).pack() });
        expect(nat.natInbound(err)).toBe(ipn(LAN_IP));
        const q = err.payload.slice(8);
        expect((q[36] << 8) | q[37]).toBe(origCs);
        nat.destroy();
    });
});
