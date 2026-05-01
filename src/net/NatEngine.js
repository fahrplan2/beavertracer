//@ts-check

import { UDPPacket } from "./pdu/UDPPacket.js";
import { TCPPacket } from "./pdu/TCPPacket.js";
import { ICMPPacket } from "./pdu/ICMPPacket.js";
import { IPAddress } from "./models/IPAddress.js";

/**
 * Stateful SNAT engine for IPv4: maps (srcIp, srcPort, proto) → natPort.
 * Handles UDP, TCP, and ICMP echo (identifier rewriting).
 * Modifies IPv4Packet objects in-place; caller must re-pack.
 */
export class NatEngine {
    /** @type {Map<string, number>} outbound key → natPort */
    _out = new Map();
    /** @type {Map<string, {srcIpNum:number, srcPort:number}>} `natPort:proto` → orig */
    _in = new Map();
    /** @type {Map<string, number>} `srcIpNum:id` → natId */
    _icmpOut = new Map();
    /** @type {Map<number, {srcIpNum:number, origId:number}>} natId → orig */
    _icmpIn = new Map();

    _nextPort = 10000;
    _nextIcmpId = 0xF000;

    /**
     * Apply SNAT for an outbound packet (LAN → WAN).
     * Modifies packet.src and transport header in-place.
     * @param {number} wanIpNum uint32
     * @param {import("./pdu/IPv4Packet.js").IPv4Packet} packet
     * @returns {boolean} false if packet should be dropped
     */
    natOutbound(wanIpNum, packet) {
        const proto = packet.protocol;
        const srcNum = this._ipNum(packet.src);

        if (proto === 1) return this._outIcmp(wanIpNum, srcNum, packet);

        if (proto !== 6 && proto !== 17) {
            packet.src = new IPAddress(4, wanIpNum);
            packet.headerChecksum = 0;
            return true;
        }

        const isUdp = proto === 17;
        let srcPort, dstPort;
        try {
            if (isUdp) { const u = UDPPacket.fromBytes(packet.payload); srcPort = u.srcPort; dstPort = u.dstPort; }
            else        { const t = TCPPacket.fromBytes(packet.payload); srcPort = t.srcPort; dstPort = t.dstPort; }
        } catch { return false; }

        const outKey = `${srcNum}:${srcPort}:${proto}`;
        let natPort = this._out.get(outKey);
        if (!natPort) {
            natPort = this._allocPort(proto);
            this._out.set(outKey, natPort);
            this._in.set(`${natPort}:${proto}`, { srcIpNum: srcNum, srcPort });
        }

        packet.src = new IPAddress(4, wanIpNum);
        packet.headerChecksum = 0;

        try {
            if (isUdp) {
                const u = UDPPacket.fromBytes(packet.payload);
                u.srcPort = natPort; u.checksum = 0;
                packet.payload = u.pack({ srcIp: packet.src, dstIp: packet.dst });
            } else {
                const t = TCPPacket.fromBytes(packet.payload);
                t.srcPort = natPort; t.checksum = 0;
                packet.payload = t.pack({ srcIp: packet.src, dstIp: packet.dst });
            }
        } catch { return false; }

        return true;
    }

    /**
     * Apply inbound un-NAT (WAN → LAN).
     * @param {import("./pdu/IPv4Packet.js").IPv4Packet} packet
     * @returns {number|null} original LAN host IP (uint32) or null if no mapping
     */
    natInbound(packet) {
        const proto = packet.protocol;
        if (proto === 1) return this._inIcmp(packet);
        if (proto !== 6 && proto !== 17) return null;

        const isUdp = proto === 17;
        let dstPort;
        try {
            if (isUdp) dstPort = UDPPacket.fromBytes(packet.payload).dstPort;
            else        dstPort = TCPPacket.fromBytes(packet.payload).dstPort;
        } catch { return null; }

        const mapping = this._in.get(`${dstPort}:${proto}`);
        if (!mapping) return null;

        packet.dst = new IPAddress(4, mapping.srcIpNum);
        packet.headerChecksum = 0;

        try {
            if (isUdp) {
                const u = UDPPacket.fromBytes(packet.payload);
                u.dstPort = mapping.srcPort; u.checksum = 0;
                packet.payload = u.pack({ srcIp: packet.src, dstIp: packet.dst });
            } else {
                const t = TCPPacket.fromBytes(packet.payload);
                t.dstPort = mapping.srcPort; t.checksum = 0;
                packet.payload = t.pack({ srcIp: packet.src, dstIp: packet.dst });
            }
        } catch { return null; }

        return mapping.srcIpNum;
    }

    /** @param {number} wanIpNum @param {number} srcNum @param {import("./pdu/IPv4Packet.js").IPv4Packet} p */
    _outIcmp(wanIpNum, srcNum, p) {
        let icmp;
        try { icmp = ICMPPacket.fromBytes(p.payload); } catch { return false; }
        if (icmp.type !== 8) return false;

        const key = `${srcNum}:${icmp.identifier}`;
        let natId = this._icmpOut.get(key);
        if (natId === undefined) {
            natId = this._nextIcmpId & 0xffff;
            this._nextIcmpId = ((this._nextIcmpId + 1) & 0xffff) || 0xF000;
            this._icmpOut.set(key, natId);
            this._icmpIn.set(natId, { srcIpNum: srcNum, origId: icmp.identifier });
        }

        icmp.identifier = natId;
        icmp.checksum = 0;
        p.src = new IPAddress(4, wanIpNum);
        p.headerChecksum = 0;
        p.payload = icmp.pack();
        return true;
    }

    /** @param {import("./pdu/IPv4Packet.js").IPv4Packet} p @returns {number|null} */
    _inIcmp(p) {
        let icmp;
        try { icmp = ICMPPacket.fromBytes(p.payload); } catch { return null; }
        if (icmp.type !== 0) return null;

        const mapping = this._icmpIn.get(icmp.identifier);
        if (!mapping) return null;

        p.dst = new IPAddress(4, mapping.srcIpNum);
        p.headerChecksum = 0;
        icmp.identifier = mapping.origId;
        icmp.checksum = 0;
        p.payload = icmp.pack();
        return mapping.srcIpNum;
    }

    /** @param {number} proto */
    _allocPort(proto) {
        while (this._in.has(`${this._nextPort}:${proto}`)) {
            if (++this._nextPort > 60000) this._nextPort = 10000;
        }
        return this._nextPort++;
    }

    /** @param {IPAddress} ip @returns {number} */
    _ipNum(ip) { return ip.isV4() ? /** @type {number} */ (ip.getNumber()) >>> 0 : 0; }

    clear() {
        this._out.clear(); this._in.clear();
        this._icmpOut.clear(); this._icmpIn.clear();
    }
}
