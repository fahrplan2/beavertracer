//@ts-check

import { UDPPacket } from "./pdu/UDPPacket.js";
import { TCPPacket } from "./pdu/TCPPacket.js";
import { ICMPPacket } from "./pdu/ICMPPacket.js";
import { IPAddress } from "./models/IPAddress.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";
import { onesComplementChecksum } from "./util/checksumUtils.js";

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
    /** how long an inbound fragment mapping waits for the rest of its datagram (RFC 791 reassembly timeout ballpark) */
    static FRAG_IDLE_MS = 15_000;
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
    /** @type {Map<string, {lanIpNum:number, lastSeenTick:number}>} `src:dst:proto:id` (as seen on the WAN) → LAN IP for inbound non-first fragments */
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
        // First fragment of a fragmented datagram (RFC 3022 §4.1): the L4 header
        // is there, but the datagram is not — UDPPacket/TCPPacket.fromBytes would
        // reject it (UDP length > fragment length). Read ports from the raw bytes.
        const isFirstFrag = (packet.flags & 0x01) !== 0;
        let srcPort, tcp;
        /** @type {number} */
        let tcpFlags = 0;
        if (isFirstFrag) {
            if (!NatEngine._hasL4Header(packet)) return false;
            srcPort = (packet.payload[0] << 8) | packet.payload[1];
            if (!isUdp) tcpFlags = packet.payload[13];
        } else {
            try {
                if (isUdp) { srcPort = UDPPacket.fromBytes(packet.payload).srcPort; }
                else        { tcp = TCPPacket.fromBytes(packet.payload); srcPort = tcp.srcPort; tcpFlags = tcp.flags; }
            } catch { return false; }
        }

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
        if (!isUdp && (tcpFlags & (TCPPacket.FLAG_FIN | TCPPacket.FLAG_RST))) session.closing = true;

        const natPort = session.natPort;
        if (isFirstFrag) {
            NatEngine._rewriteRaw(packet, "src", wanIpNum, natPort);
            return true;
        }
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
        if (packet.fragmentOffset !== 0) return false; // non-first fragments go through natInbound()
        if ((packet.flags & 0x01) !== 0) {
            // first fragment: rewrite in place, remember where the rest has to go
            if (!NatEngine._hasL4Header(packet)) return false;
            const fragKey = this._fragKey(packet);
            NatEngine._rewriteRaw(packet, "dst", lanIpNum, lanPort);
            this._fragIn.set(fragKey, { lanIpNum, lastSeenTick: simTimer.currentTick });
            return true;
        }
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

        const isFrag = (packet.flags & 0x01) !== 0;
        const fragKey = this._fragKey(packet); // computed before dst is rewritten

        // Non-first fragment: no transport header; it belongs to the datagram
        // whose first fragment we already translated (keyed by src, dst, proto, id).
        if (packet.fragmentOffset !== 0) {
            const m = this._fragIn.get(fragKey);
            if (m === undefined) return null;
            m.lastSeenTick = simTimer.currentTick;
            packet.dst = new IPAddress(4, m.lanIpNum);
            packet.headerChecksum = 0;
            if (!isFrag) this._fragIn.delete(fragKey);
            return m.lanIpNum;
        }

        if (proto === 1) {
            const result = this._inIcmp(packet);
            if (result !== null && isFrag)
                this._fragIn.set(fragKey, { lanIpNum: result, lastSeenTick: simTimer.currentTick });
            return result;
        }
        if (proto !== 6 && proto !== 17) return null;

        const isUdp = proto === 17;
        let dstPort, tcp;
        /** @type {number} */
        let tcpFlags = 0;
        if (isFrag) {
            if (!NatEngine._hasL4Header(packet)) return null;
            dstPort = (packet.payload[2] << 8) | packet.payload[3];
            if (!isUdp) tcpFlags = packet.payload[13];
        } else {
            try {
                if (isUdp) dstPort = UDPPacket.fromBytes(packet.payload).dstPort;
                else        { tcp = TCPPacket.fromBytes(packet.payload); dstPort = tcp.dstPort; tcpFlags = tcp.flags; }
            } catch { return null; }
        }

        const session = this._in.get(`${dstPort}:${proto}`);
        if (!session) return null;
        session.lastSeenTick = simTimer.currentTick;
        if (!isUdp && (tcpFlags & (TCPPacket.FLAG_FIN | TCPPacket.FLAG_RST))) session.closing = true;

        if (isFrag) {
            NatEngine._rewriteRaw(packet, "dst", session.srcIpNum, session.srcPort);
            this._fragIn.set(fragKey, { lanIpNum: session.srcIpNum, lastSeenTick: simTimer.currentTick });
            return session.srcIpNum;
        }

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

        p.src = new IPAddress(4, wanIpNum);
        p.headerChecksum = 0;
        if ((p.flags & 0x01) !== 0) {
            // fragmented echo: the ICMP checksum covers the whole message, adjust it (RFC 1624)
            p.payload = NatEngine._patchIcmpId(p.payload, mapping.natId);
            return true;
        }
        icmp.identifier = mapping.natId;
        icmp.checksum = 0;
        p.payload = icmp.pack();
        return true;
    }

    /** @param {import("./pdu/IPv4Packet.js").IPv4Packet} p @returns {number|null} */
    _inIcmp(p) {
        let icmp;
        try { icmp = ICMPPacket.fromBytes(p.payload); } catch { return null; }
        if (icmp.type === 3 || icmp.type === 11 || icmp.type === 12) return this._inIcmpError(p, icmp);
        if (icmp.type !== 0) return null;

        const mapping = this._icmpIn.get(icmp.identifier);
        if (!mapping) return null;
        mapping.lastSeenTick = simTimer.currentTick;
        const outMapping = this._icmpOut.get(mapping.key);
        if (outMapping) outMapping.lastSeenTick = simTimer.currentTick;

        p.dst = new IPAddress(4, mapping.srcIpNum);
        p.headerChecksum = 0;
        if ((p.flags & 0x01) !== 0) {
            p.payload = NatEngine._patchIcmpId(p.payload, mapping.origId);
            return mapping.srcIpNum;
        }
        icmp.identifier = mapping.origId;
        icmp.checksum = 0;
        p.payload = icmp.pack();
        return mapping.srcIpNum;
    }

    /**
     * Un-NAT an ICMP error (Destination Unreachable, Time Exceeded, Parameter
     * Problem) that refers to a packet we translated on its way out — so that
     * e.g. traceroute works from behind the router (RFC 5508 §4). The quoted
     * original header (src = our WAN IP, src port / echo id = NAT port) is
     * mapped back to the LAN host, and the outer packet is sent to that host.
     * @param {import("./pdu/IPv4Packet.js").IPv4Packet} p
     * @param {ICMPPacket} icmp
     * @returns {number|null} LAN host IP (uint32) or null if no mapping
     */
    _inIcmpError(p, icmp) {
        const q = new Uint8Array(icmp.payload); // quoted: original IP header + 8 bytes
        if (q.length < 20) return null;
        const ihl = (q[0] & 0x0f) * 4;
        if (q.length < ihl + 8) return null;
        const proto = q[9];
        const l4 = ihl;

        const quotedSrc = ((q[12] << 24) | (q[13] << 16) | (q[14] << 8) | q[15]) >>> 0;
        let lanIpNum, origPortOrId;
        if (proto === 6 || proto === 17) {
            const natPort = (q[l4] << 8) | q[l4 + 1];
            const session = this._in.get(`${natPort}:${proto}`);
            if (!session) return null;
            lanIpNum = session.srcIpNum; origPortOrId = session.srcPort;
            q[l4] = origPortOrId >> 8; q[l4 + 1] = origPortOrId & 0xff;
            // RFC 5508 §4: also fix the quoted TCP/UDP checksum (pseudo-header src
            // IP + src port changed), as far as it was quoted. UDP 0 = no checksum.
            const csOff = l4 + (proto === 17 ? 6 : 16);
            if (q.length >= csOff + 2) {
                const cs = (q[csOff] << 8) | q[csOff + 1];
                if (!(proto === 17 && cs === 0)) {
                    let ncs = NatEngine._csumAdjust(cs,
                        [quotedSrc >>> 16, quotedSrc & 0xffff, natPort],
                        [lanIpNum >>> 16, lanIpNum & 0xffff, origPortOrId]);
                    if (proto === 17 && ncs === 0) ncs = 0xffff;
                    q[csOff] = ncs >> 8; q[csOff + 1] = ncs & 0xff;
                }
            }
        } else if (proto === 1) {
            const natId = (q[l4 + 4] << 8) | q[l4 + 5];
            const mapping = this._icmpIn.get(natId);
            if (!mapping) return null;
            lanIpNum = mapping.srcIpNum; origPortOrId = mapping.origId;
            q[l4 + 4] = origPortOrId >> 8; q[l4 + 5] = origPortOrId & 0xff;
            // quoted ICMP checksum (no pseudo-header): only the identifier changed
            const cs = (q[l4 + 2] << 8) | q[l4 + 3];
            const ncs = NatEngine._csumAdjust(cs, [natId], [origPortOrId]);
            q[l4 + 2] = ncs >> 8; q[l4 + 3] = ncs & 0xff;
        } else {
            return null;
        }

        // quoted source IP back to the LAN host, fix the quoted header checksum
        q[12] = lanIpNum >>> 24; q[13] = (lanIpNum >>> 16) & 0xff; q[14] = (lanIpNum >>> 8) & 0xff; q[15] = lanIpNum & 0xff;
        q[10] = 0; q[11] = 0;
        const cs = onesComplementChecksum([q.subarray(0, ihl)]);
        q[10] = cs >> 8; q[11] = cs & 0xff;

        icmp.payload = q;
        icmp.checksum = 0;
        p.payload = icmp.pack();
        p.dst = new IPAddress(4, lanIpNum);
        p.headerChecksum = 0;
        return lanIpNum;
    }

    /**
     * Fragment correlation key: (src, dst, proto, identification) as seen on the
     * wire before translation — the identification alone is only unique per
     * (src, dst, proto) (RFC 791).
     * @param {import("./pdu/IPv4Packet.js").IPv4Packet} p
     */
    _fragKey(p) {
        return `${this._ipNum(p.src)}:${this._ipNum(p.dst)}:${p.protocol}:${p.identification}`;
    }

    /**
     * Does a first fragment carry enough of the L4 header to translate it?
     * UDP: the full 8-byte header. TCP: ports, flags and checksum (≥ 20 bytes);
     * shorter first fragments are the RFC 1858 tiny-fragment pattern.
     * @param {import("./pdu/IPv4Packet.js").IPv4Packet} p
     */
    static _hasL4Header(p) {
        return p.payload.length >= (p.protocol === 17 ? 8 : 20);
    }

    /**
     * RFC 1624 incremental checksum update: HC' = ~(~HC + ~m + m') per 16-bit word.
     * @param {number} cs old checksum
     * @param {number[]} oldWords @param {number[]} newWords
     * @returns {number}
     */
    static _csumAdjust(cs, oldWords, newWords) {
        let sum = (~cs) & 0xffff;
        for (let i = 0; i < oldWords.length; i++) {
            sum += (~oldWords[i]) & 0xffff;
            sum += newWords[i] & 0xffff;
        }
        while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16);
        return (~sum) & 0xffff;
    }

    /**
     * Rewrite src (or dst) IP + port of a TCP/UDP packet in place, without
     * parsing the L4 PDU — needed for first fragments, whose L4 checksum covers
     * the whole (not present) datagram and so can only be patched incrementally
     * (RFC 3022 §4.1, RFC 1624). UDP checksum 0 ("none") stays 0.
     * @param {import("./pdu/IPv4Packet.js").IPv4Packet} p
     * @param {"src"|"dst"} which
     * @param {number} newIpNum @param {number} newPort
     */
    static _rewriteRaw(p, which, newIpNum, newPort) {
        const isUdp = p.protocol === 17;
        const b = new Uint8Array(p.payload);
        const portOff = which === "src" ? 0 : 2;
        const csOff = isUdp ? 6 : 16;
        const oldIp = (/** @type {number} */ ((which === "src" ? p.src : p.dst).getNumber())) >>> 0;
        const oldPort = (b[portOff] << 8) | b[portOff + 1];
        const cs = (b[csOff] << 8) | b[csOff + 1];
        if (!(isUdp && cs === 0)) {
            let ncs = NatEngine._csumAdjust(cs,
                [oldIp >>> 16, oldIp & 0xffff, oldPort],
                [newIpNum >>> 16, newIpNum & 0xffff, newPort]);
            if (isUdp && ncs === 0) ncs = 0xffff;
            b[csOff] = ncs >> 8; b[csOff + 1] = ncs & 0xff;
        }
        b[portOff] = (newPort >> 8) & 0xff; b[portOff + 1] = newPort & 0xff;
        p.payload = b;
        if (which === "src") p.src = new IPAddress(4, newIpNum >>> 0);
        else p.dst = new IPAddress(4, newIpNum >>> 0);
        p.headerChecksum = 0;
    }

    /**
     * Replace the identifier of an ICMP echo (bytes 4-5) and adjust its checksum
     * incrementally — for fragmented echoes whose checksum spans all fragments.
     * @param {Uint8Array} payload @param {number} newId @returns {Uint8Array}
     */
    static _patchIcmpId(payload, newId) {
        const b = new Uint8Array(payload);
        const oldId = (b[4] << 8) | b[5];
        const cs = (b[2] << 8) | b[3];
        const ncs = NatEngine._csumAdjust(cs, [oldId], [newId]);
        b[2] = ncs >> 8; b[3] = ncs & 0xff;
        b[4] = (newId >> 8) & 0xff; b[5] = newId & 0xff;
        return b;
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

        const fragLimitTicks = SimTimer.toTicks(NatEngine.FRAG_IDLE_MS);
        for (const [k, m] of this._fragIn) {
            if (now - m.lastSeenTick >= fragLimitTicks) this._fragIn.delete(k);
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
