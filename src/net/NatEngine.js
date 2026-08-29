//@ts-check

import { UDPPacket } from "./pdu/UDPPacket.js";
import { TCPPacket } from "./pdu/TCPPacket.js";
import { ICMPPacket } from "./pdu/ICMPPacket.js";
import { IPAddress } from "./models/IPAddress.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";

/**
 * @typedef {Object} NatSession
 * @property {string} outKey
 * @property {number} srcIpNum
 * @property {number} srcPort
 * @property {number} natPort
 * @property {number} proto  6=TCP, 17=UDP
 * @property {number} lastSeenTick
 * @property {boolean} closing   TCP only: a FIN or RST has been observed on this flow
 * @property {boolean} pinned    true for port-forward (DNAT) sessions — never idle-expired
 */

/**
 * Stateful SNAT engine for IPv4: maps (srcIp, srcPort, proto) → natPort.
 * Handles UDP, TCP, and ICMP echo (identifier rewriting).
 * Modifies IPv4Packet objects in-place; caller must re-pack.
 *
 * Sessions are garbage-collected so closed/abandoned connections free their
 * NAT port back to the pool instead of pinning it forever: TCP flows get a
 * short grace period once a FIN/RST is seen (long enough for a straggling
 * retransmit to still find its way back), everything else expires after a
 * plain idle timeout. Port-forward (DNAT) sessions are pinned — they're a
 * standing rule, not a per-connection flow, and refresh themselves on every
 * inbound packet anyway.
 */
export class NatEngine {
    /** Idle timeout for an established TCP flow with no FIN/RST seen yet.
     *  TcpEngine doesn't send keepalives, so a quiet-but-still-open connection
     *  (e.g. an idle IRC/mail session while a lesson pauses) produces no
     *  traffic at all — this is a leak safety net, not a real conntrack
     *  timeout, and must stay long enough to never fire on a live connection. */
    static TCP_IDLE_MS = 180_000;  // 36000 ticks → 1h @1×
    /** grace period after a FIN or RST is observed, before the mapping is freed */
    static TCP_CLOSE_GRACE_MS = 2_000;
    /** idle timeout for a UDP flow */
    static UDP_IDLE_MS = 15_000;
    /** idle timeout for an ICMP echo mapping */
    static ICMP_IDLE_MS = 5_000;
    /** how often the expiry sweep runs */
    static SWEEP_MS = 2_000;

    /** @type {Map<string, NatSession>} outbound key (`srcIp:srcPort:proto`) → session */
    _out = new Map();
    /** @type {Map<string, NatSession>} `natPort:proto` → session */
    _in = new Map();
    /** @type {Map<string, {natId:number, srcIpNum:number, origId:number, lastSeenTick:number}>} `srcIpNum:id` → mapping */
    _icmpOut = new Map();
    /** @type {Map<number, {key:string, srcIpNum:number, origId:number, lastSeenTick:number}>} natId → mapping */
    _icmpIn = new Map();
    /** @type {Map<number, number>} IPv4 identification → LAN IP for inbound non-first fragments */
    _fragIn = new Map();

    _nextPort = 10000;
    _nextIcmpId = 0xF000;

    /** @type {number|null} */
    _sweepTimer = null;

    constructor() {
        this._scheduleSweep();
    }

    _scheduleSweep() {
        this._sweepTimer = simTimer.schedule(() => {
            this.expire();
            this._scheduleSweep();
        }, NatEngine.SWEEP_MS);
    }

    /** Stop the periodic expiry sweep (call when the owning router is destroyed). */
    destroy() {
        if (this._sweepTimer != null) simTimer.cancel(this._sweepTimer);
        this._sweepTimer = null;
    }

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

        // Non-first fragment: no transport header present, just rewrite source IP
        if (packet.fragmentOffset !== 0) {
            packet.src = new IPAddress(4, wanIpNum);
            packet.headerChecksum = 0;
            return true;
        }

        if (proto === 1) return this._outIcmp(wanIpNum, srcNum, packet);

        if (proto !== 6 && proto !== 17) {
            packet.src = new IPAddress(4, wanIpNum);
            packet.headerChecksum = 0;
            return true;
        }

        const isUdp = proto === 17;
        let srcPort, dstPort, tcp;
        try {
            if (isUdp) { const u = UDPPacket.fromBytes(packet.payload); srcPort = u.srcPort; dstPort = u.dstPort; }
            else        { tcp = TCPPacket.fromBytes(packet.payload); srcPort = tcp.srcPort; dstPort = tcp.dstPort; }
        } catch { return false; }

        const outKey = `${srcNum}:${srcPort}:${proto}`;
        let session = this._out.get(outKey);
        if (!session) {
            const allocated = this._allocPort(proto);
            if (allocated == null) return false; // port pool exhausted, drop
            session = {
                outKey, srcIpNum: srcNum, srcPort, natPort: allocated, proto,
                lastSeenTick: simTimer.currentTick, closing: false, pinned: false,
            };
            this._out.set(outKey, session);
            this._in.set(`${allocated}:${proto}`, session);
        }
        session.lastSeenTick = simTimer.currentTick;
        if (!isUdp && tcp && tcp.hasFlag(TCPPacket.FLAG_FIN | TCPPacket.FLAG_RST)) session.closing = true;

        const natPort = session.natPort;
        packet.src = new IPAddress(4, wanIpNum);
        packet.headerChecksum = 0;

        try {
            if (isUdp) {
                const u = UDPPacket.fromBytes(packet.payload);
                u.srcPort = natPort; u.checksum = 0;
                packet.payload = u.pack({ srcIp: packet.src, dstIp: packet.dst });
            } else {
                /** @type {TCPPacket} */ (tcp).srcPort = natPort; /** @type {TCPPacket} */ (tcp).checksum = 0;
                packet.payload = /** @type {TCPPacket} */ (tcp).pack({ srcIp: packet.src, dstIp: packet.dst });
            }
        } catch { return false; }

        return true;
    }

    /**
     * Apply stateless DNAT for an inbound packet (port forwarding).
     * Rewrites destination IP and port without consulting the session table.
     * @param {import("./pdu/IPv4Packet.js").IPv4Packet} packet
     * @param {number} lanIpNum uint32 - target LAN host IP
     * @param {number} lanPort  destination port to rewrite to
     * @returns {boolean} false if packet could not be rewritten
     */
    dnat(packet, lanIpNum, lanPort) {
        const proto = packet.protocol;
        if (proto !== 6 && proto !== 17) return false;

        const isUdp = proto === 17;
        packet.dst = new IPAddress(4, lanIpNum);
        packet.headerChecksum = 0;

        try {
            if (isUdp) {
                const u = UDPPacket.fromBytes(packet.payload);
                u.dstPort = lanPort; u.checksum = 0;
                packet.payload = u.pack({ srcIp: packet.src, dstIp: packet.dst });
            } else {
                const t = TCPPacket.fromBytes(packet.payload);
                t.dstPort = lanPort; t.checksum = 0;
                packet.payload = t.pack({ srcIp: packet.src, dstIp: packet.dst });
            }
        } catch { return false; }

        return true;
    }

    /**
     * Pre-populate the SNAT session for the return path of a DNAT'd connection.
     * Without this, SNAT allocates a random port for the LAN host's replies,
     * so the client sees the SYN-ACK from an unexpected src port and sends RST.
     * Calling this locks the LAN host's (lanIpNum:lanPort:proto) outbound SNAT
     * to use wanPort, so replies reach the client with the expected src port.
     *
     * The session is pinned: it's a standing port-forward rule, not a
     * per-connection flow, so it isn't subject to idle/close expiry. It's
     * called again on every inbound packet for the rule anyway, which keeps
     * it fresh for as long as the rule sees traffic.
     * @param {number} proto 6=TCP, 17=UDP
     * @param {number} wanPort the forwarded WAN port (e.g. 8080)
     * @param {number} lanIpNum target LAN host IP
     * @param {number} lanPort target LAN port (e.g. 80)
     */
    installDnatSession(proto, wanPort, lanIpNum, lanPort) {
        const outKey = `${lanIpNum}:${lanPort}:${proto}`;
        const session = {
            outKey, srcIpNum: lanIpNum, srcPort: lanPort, natPort: wanPort, proto,
            lastSeenTick: simTimer.currentTick, closing: false, pinned: true,
        };
        this._out.set(outKey, session);
        this._in.set(`${wanPort}:${proto}`, session);
    }

    /**
     * Apply inbound un-NAT (WAN → LAN).
     * @param {import("./pdu/IPv4Packet.js").IPv4Packet} packet
     * @returns {number|null} original LAN host IP (uint32) or null if no mapping
     */
    natInbound(packet) {
        const proto = packet.protocol;

        // Non-first fragment: no transport header, look up LAN host by identification
        if (packet.fragmentOffset !== 0) {
            const lanIpNum = this._fragIn.get(packet.identification);
            if (lanIpNum === undefined) return null;
            packet.dst = new IPAddress(4, lanIpNum);
            packet.headerChecksum = 0;
            if ((packet.flags & 0x01) === 0) this._fragIn.delete(packet.identification);
            return lanIpNum;
        }

        if (proto === 1) {
            const result = this._inIcmp(packet);
            if (result !== null && (packet.flags & 0x01) !== 0)
                this._fragIn.set(packet.identification, result);
            return result;
        }
        if (proto !== 6 && proto !== 17) return null;

        const isUdp = proto === 17;
        let dstPort, tcp;
        try {
            if (isUdp) dstPort = UDPPacket.fromBytes(packet.payload).dstPort;
            else        { tcp = TCPPacket.fromBytes(packet.payload); dstPort = tcp.dstPort; }
        } catch { return null; }

        const session = this._in.get(`${dstPort}:${proto}`);
        if (!session) return null;
        session.lastSeenTick = simTimer.currentTick;
        if (!isUdp && tcp && tcp.hasFlag(TCPPacket.FLAG_FIN | TCPPacket.FLAG_RST)) session.closing = true;

        packet.dst = new IPAddress(4, session.srcIpNum);
        packet.headerChecksum = 0;

        try {
            if (isUdp) {
                const u = UDPPacket.fromBytes(packet.payload);
                u.dstPort = session.srcPort; u.checksum = 0;
                packet.payload = u.pack({ srcIp: packet.src, dstIp: packet.dst });
            } else {
                /** @type {TCPPacket} */ (tcp).dstPort = session.srcPort; /** @type {TCPPacket} */ (tcp).checksum = 0;
                packet.payload = /** @type {TCPPacket} */ (tcp).pack({ srcIp: packet.src, dstIp: packet.dst });
            }
        } catch { return null; }

        if ((packet.flags & 0x01) !== 0)
            this._fragIn.set(packet.identification, session.srcIpNum);

        return session.srcIpNum;
    }

    /** @param {number} wanIpNum @param {number} srcNum @param {import("./pdu/IPv4Packet.js").IPv4Packet} p */
    _outIcmp(wanIpNum, srcNum, p) {
        let icmp;
        try { icmp = ICMPPacket.fromBytes(p.payload); } catch { return false; }
        if (icmp.type !== 8) return false;

        const key = `${srcNum}:${icmp.identifier}`;
        let mapping = this._icmpOut.get(key);
        if (mapping === undefined) {
            const natId = this._nextIcmpId & 0xffff;
            this._nextIcmpId = ((this._nextIcmpId + 1) & 0xffff) || 0xF000;
            mapping = { natId, srcIpNum: srcNum, origId: icmp.identifier, lastSeenTick: simTimer.currentTick };
            this._icmpOut.set(key, mapping);
            this._icmpIn.set(natId, { key, srcIpNum: srcNum, origId: icmp.identifier, lastSeenTick: simTimer.currentTick });
        }
        mapping.lastSeenTick = simTimer.currentTick;
        const inMapping = this._icmpIn.get(mapping.natId);
        if (inMapping) inMapping.lastSeenTick = simTimer.currentTick;

        icmp.identifier = mapping.natId;
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
        mapping.lastSeenTick = simTimer.currentTick;
        const outMapping = this._icmpOut.get(mapping.key);
        if (outMapping) outMapping.lastSeenTick = simTimer.currentTick;

        p.dst = new IPAddress(4, mapping.srcIpNum);
        p.headerChecksum = 0;
        icmp.identifier = mapping.origId;
        icmp.checksum = 0;
        p.payload = icmp.pack();
        return mapping.srcIpNum;
    }

    /** @param {number} proto @returns {number|null} null if the port pool is exhausted */
    _allocPort(proto) {
        const start = this._nextPort;
        let p = start;
        do {
            if (!this._in.has(`${p}:${proto}`)) {
                this._nextPort = (p >= 60000) ? 10000 : p + 1;
                return p;
            }
            p = (p >= 60000) ? 10000 : p + 1;
        } while (p !== start);
        return null;
    }

    /**
     * Evict sessions that have gone idle (or, for TCP, sat past their
     * close-grace period since a FIN/RST was seen). Frees NAT ports back to
     * the allocation pool. Pinned (port-forward) sessions are never evicted.
     * Runs periodically off the sim timer; safe to call directly too.
     */
    expire() {
        const now = simTimer.currentTick;
        for (const [inKey, session] of this._in) {
            if (session.pinned) continue;

            const idleTicks = now - session.lastSeenTick;
            const limitMs = session.proto === 6
                ? (session.closing ? NatEngine.TCP_CLOSE_GRACE_MS : NatEngine.TCP_IDLE_MS)
                : NatEngine.UDP_IDLE_MS;
            if (idleTicks < SimTimer.toTicks(limitMs)) continue;

            this._in.delete(inKey);
            this._out.delete(session.outKey);
        }

        const icmpLimitTicks = SimTimer.toTicks(NatEngine.ICMP_IDLE_MS);
        for (const [natId, mapping] of this._icmpIn) {
            if (now - mapping.lastSeenTick < icmpLimitTicks) continue;
            this._icmpIn.delete(natId);
            this._icmpOut.delete(mapping.key);
        }
    }

    /**
     * Returns all active NAT mappings as a flat list for display.
     * @returns {Array<{proto: string, lanIpNum: number, lanPort: number, natPort: number}>}
     */
    getEntries() {
        const entries = [];
        for (const session of this._out.values()) {
            entries.push({
                proto: session.proto === 6 ? "TCP" : "UDP",
                lanIpNum: session.srcIpNum, lanPort: session.srcPort, natPort: session.natPort,
            });
        }
        for (const [key, mapping] of this._icmpOut) {
            const [a] = key.split(":");
            entries.push({ proto: "ICMP", lanIpNum: Number(a), lanPort: mapping.origId, natPort: mapping.natId });
        }
        return entries;
    }

    /** @param {IPAddress} ip @returns {number} */
    _ipNum(ip) { return ip.isV4() ? /** @type {number} */ (ip.getNumber()) >>> 0 : 0; }

    clear() {
        this._out.clear(); this._in.clear();
        this._icmpOut.clear(); this._icmpIn.clear();
        this._fragIn.clear();
    }
}
