//@ts-check
import { IPAddress } from "./models/IPAddress.js";
import { IPv6Packet } from "./pdu/IPv6Packet.js";
import { UDPPacket } from "./pdu/UDPPacket.js";
import { simTimer } from "../lib/SimTimer.js";
import {
    RIPPacket, RIPEntry,
    RIP_CMD_RESPONSE, RIP_AFI_IP, RIP_INFINITY, RIP_PORT,
} from "./pdu/RIPPacket.js";
import {
    RIPngPacket, RIPngEntry,
    RIPNG_CMD_RESPONSE, RIPNG_INFINITY, RIPNG_PORT, RIPNG_MCAST,
} from "./pdu/RIPngPacket.js";

const UPDATE_MS =  5_000;
const EXPIRE_MS = 30_000;
const DELETE_MS = 20_000;

// ── IPv4 helpers ────────────────────────────────────────────────────────────

/** @param {Uint8Array} a @param {number} [off] */
function u8ToU32(a, off = 0) {
    return (((a[off] << 24) | (a[off+1] << 16) | (a[off+2] << 8) | a[off+3]) >>> 0);
}
/** @param {number} n */
function u32ToU8(n) {
    const v = n >>> 0;
    return new Uint8Array([(v>>>24)&0xff, (v>>>16)&0xff, (v>>>8)&0xff, v&0xff]);
}
/** @param {IPAddress} ip */
function ipToU32(ip) { return /** @type {number} */ (ip.getNumber()) >>> 0; }
/** @param {number} n */
function u32ToIp(n) { return new IPAddress(4, n >>> 0); }
/** @param {number} prefix */
function prefixToMask(prefix) {
    if (prefix <= 0) return 0;
    if (prefix >= 32) return 0xffffffff >>> 0;
    return ((0xffffffff << (32 - prefix)) >>> 0);
}
/** @param {number} mask32 */
function maskToPrefix(mask32) {
    let p = 0, m = mask32 >>> 0;
    while (m & 0x80000000) { p++; m = (m << 1) >>> 0; }
    return p;
}

// ── IPv6 helpers ────────────────────────────────────────────────────────────

/** fe80::/10 check @param {IPAddress} ip */
function isLinkLocal6(ip) {
    const b = ip.toUInt8();
    return b[0] === 0xfe && (b[1] & 0xc0) === 0x80;
}
/** @param {Uint8Array} bytes16 @param {number} prefLen @returns {Uint8Array} */
function maskPrefix6(bytes16, prefLen) {
    const out = new Uint8Array(16);
    let rem = prefLen | 0;
    for (let i = 0; i < 16; i++) {
        if (rem >= 8) { out[i] = bytes16[i]; rem -= 8; }
        else if (rem > 0) { out[i] = bytes16[i] & ((0xff << (8 - rem)) & 0xff); rem = 0; }
    }
    return out;
}
/** @param {Uint8Array} a @param {Uint8Array} b @param {number} prefLen @returns {boolean} */
function prefixEqual6(a, b, prefLen) {
    let rem = prefLen | 0;
    for (let i = 0; i < 16 && rem > 0; i++) {
        if (rem >= 8) { if (a[i] !== b[i]) return false; rem -= 8; }
        else { const m = (0xff << (8 - rem)) & 0xff; if ((a[i] & m) !== (b[i] & m)) return false; rem = 0; }
    }
    return true;
}

// ── RIPDaemon ───────────────────────────────────────────────────────────────

export class RIPDaemon {
    /**
     * @param {import("./IPStack.js").IPStack} net
     * @param {4|6} [af] address family: 4 = RIP (default), 6 = RIPng
     */
    constructor(net, af = 4) {
        this._net      = net;
        this._af       = af;
        this._name     = af === 4 ? "RIP" : "RIPng";
        this._port     = af === 4 ? RIP_PORT : RIPNG_PORT;
        this._infinity = af === 4 ? RIP_INFINITY : RIPNG_INFINITY;

        /** @type {boolean} */
        this.enabled = false;
        /** @type {Set<string>} */
        this.passiveInterfaces = new Set();

        this._running = false;
        /** @type {number|null} */ this._socketPort  = null;
        /** @type {number|null} */ this._updateTimer = null;

        /** @type {Map<string, any>} */
        this._routes = new Map();

        /** @type {string[]} */
        this.log = [];
        /** @type {(() => void)|null} */
        this.onLogUpdate = null;
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    start() {
        if (this._running) return;
        try {
            const bind = this._af === 4 ? new IPAddress(4, 0) : IPAddress.fromString("::");
            this._socketPort = this._net.openUDPSocket(bind, this._port);
            this._running = true;
            this._scheduleUpdate(0);
            void this._recvLoop();
            this._log(`${this._name} gestartet`);
        } catch (e) {
            this._log(`${this._name} Start fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    stop() {
        if (!this._running && this._socketPort == null) return;
        this._running = false;
        if (this._updateTimer != null) { simTimer.cancel(this._updateTimer); this._updateTimer = null; }
        if (this._socketPort != null) {
            try { this._net.closeUDPSocket(this._socketPort); } catch {}
            this._socketPort = null;
        }
        this._clearAllRoutes();
        this._log(`${this._name} gestoppt`);
    }

    /** @param {boolean} enabled */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled) this.start(); else this.stop();
    }

    /** @param {string} ifName @param {boolean} passive */
    setPassive(ifName, passive) {
        if (passive) this.passiveInterfaces.add(ifName);
        else         this.passiveInterfaces.delete(ifName);
    }

    // ── periodic update ────────────────────────────────────────────────────

    /** @param {number} delayMs */
    _scheduleUpdate(delayMs) {
        if (!this._running) return;
        if (this._updateTimer != null) simTimer.cancel(this._updateTimer);
        this._updateTimer = simTimer.schedule(() => {
            if (!this._running) return;
            this._updateTimer = null;
            this._sendAllUpdates();
            this._scheduleUpdate(UPDATE_MS);
        }, Math.max(1, delayMs));
    }

    _sendAllUpdates() {
        if (this._af === 4) {
            if (this._socketPort === null) return;
            for (let i = 0; i < this._net.interfaces.length; i++) {
                const iface = this._net.interfaces[i];
                if (this.passiveInterfaces.has(`eth${i}`)) continue;
                if (!iface.ip?.isV4() || ipToU32(iface.ip) === 0) continue;
                if (iface.prefixLength === null || !iface.port?.linkref) continue;
                const entries = this._buildEntries(i);
                if (entries.length === 0) continue;
                const bcast = this._directedBcast(iface.ip, iface.prefixLength);
                try {
                    this._net.sendUDPSocket(this._socketPort, bcast, RIP_PORT,
                        new RIPPacket({ command: RIP_CMD_RESPONSE, entries }).pack());
                } catch { /* link gone */ }
            }
        } else {
            for (let i = 0; i < this._net.interfaces.length; i++) {
                const iface = this._net.interfaces[i];
                if (this.passiveInterfaces.has(iface.name)) continue;
                if (!iface.ip6LL || !iface.port?.linkref) continue;
                const entries = this._buildEntries(i);
                if (entries.length === 0) continue;
                const dst    = IPAddress.fromString(RIPNG_MCAST);
                const dstMac = new Uint8Array([0x33, 0x33, 0x00, 0x00, 0x00, 0x09]);
                const udp = new UDPPacket({ srcPort: RIPNG_PORT, dstPort: RIPNG_PORT,
                    payload: new RIPngPacket({ command: RIPNG_CMD_RESPONSE, entries }).pack(),
                }).pack({ srcIp: iface.ip6LL, dstIp: dst });
                const ip6 = new IPv6Packet({ src: iface.ip6LL, dst, nextHeader: 17,
                    hopLimit: 255, payload: udp }).pack();
                try { iface.sendFrame(dstMac, 0x86DD, ip6); } catch { /* link gone */ }
            }
        }
    }

    /** @param {number} ifIndex @returns {any[]} */
    _buildEntries(ifIndex) {
        if (this._af === 4) {
            const entries = [];
            for (let i = 0; i < this._net.interfaces.length; i++) {
                if (i === ifIndex) continue;
                const iface = this._net.interfaces[i];
                if (!iface.ip?.isV4() || ipToU32(iface.ip) === 0) continue;
                const mask32 = prefixToMask(iface.prefixLength);
                entries.push(new RIPEntry({
                    ip: u32ToU8((ipToU32(iface.ip) & mask32) >>> 0), mask: u32ToU8(mask32),
                    nexthop: new Uint8Array(4), metric: 1,
                }));
            }
            for (const [, r] of this._routes) {
                if (r.learnedIfIndex === ifIndex || r.metric >= RIP_INFINITY) continue;
                entries.push(new RIPEntry({
                    ip:      u32ToU8((ipToU32(r.dst) & prefixToMask(r.prefix)) >>> 0),
                    mask:    u32ToU8(prefixToMask(r.prefix)),
                    nexthop: new Uint8Array(4),
                    metric:  Math.min(r.metric, RIP_INFINITY),
                }));
            }
            return entries;
        } else {
            const entries = [];
            for (let i = 0; i < this._net.interfaces.length; i++) {
                if (i === ifIndex) continue;
                const iface = this._net.interfaces[i];
                if (!iface.ip6?.isV6() || isLinkLocal6(iface.ip6)) continue;
                entries.push(new RIPngEntry({
                    prefix: maskPrefix6(iface.ip6.toUInt8(), iface.prefixLength6),
                    prefixLen: iface.prefixLength6, metric: 1,
                }));
            }
            for (const [, r] of this._routes) {
                if (r.learnedIfIndex === ifIndex || r.metric >= RIPNG_INFINITY) continue;
                entries.push(new RIPngEntry({
                    prefix: maskPrefix6(r.dst.toUInt8(), r.prefix),
                    prefixLen: r.prefix, metric: Math.min(r.metric, RIPNG_INFINITY),
                }));
            }
            return entries;
        }
    }

    // ── receive loop ───────────────────────────────────────────────────────

    async _recvLoop() {
        while (this._running && this._socketPort != null) {
            const port = this._socketPort;
            let msg = null;
            try { msg = await this._net.recvUDPSocket(port); } catch { break; }
            if (!this._running || msg == null) break;
            if (msg.srcPort !== this._port) continue;
            this._handleMsg(msg);
        }
    }

    /** @param {any} msg */
    _handleMsg(msg) {
        if (this._af === 4) {
            let pkt;
            try { pkt = RIPPacket.fromBytes(msg.payload); } catch { return; }
            if (pkt.command !== RIP_CMD_RESPONSE) return;
            const srcIp = msg.src instanceof IPAddress ? msg.src : null;
            if (!srcIp) return;
            const ifIndex = this._ifIndexForSrc4(srcIp);
            if (ifIndex < 0) return;
            for (const e of pkt.entries) {
                if (e.afi !== RIP_AFI_IP) continue;
                const received = e.metric >>> 0;
                if (received >= RIP_INFINITY) {
                    const key = this._entryKey4(e); if (key) this._expireRoute(key);
                    continue;
                }
                const metric = Math.min(received + 1, RIP_INFINITY);
                const dst32  = (u8ToU32(e.ip) & u8ToU32(e.mask)) >>> 0;
                const prefix = maskToPrefix(u8ToU32(e.mask));
                const dst    = u32ToIp(dst32);
                const key    = `${dst}/${prefix}`;
                if (this._isConnected4(dst32, prefix)) continue;
                const existing = this._routes.get(key);
                if (!existing || metric < existing.metric ||
                    (metric === existing.metric && existing.learnedIfIndex === ifIndex))
                    this._learnRoute(key, dst, prefix, srcIp, metric, ifIndex);
            }
        } else {
            const srcIp = msg.src instanceof IPAddress ? msg.src : null;
            if (!srcIp?.isV6() || !isLinkLocal6(srcIp)) return;
            const ifIndex = typeof msg.recvIfIndex === "number" ? msg.recvIfIndex : -1;
            if (ifIndex < 0) return;
            let pkt;
            try { pkt = RIPngPacket.fromBytes(msg.payload); } catch { return; }
            if (pkt.command !== RIPNG_CMD_RESPONSE) return;
            let nexthop = srcIp;
            for (const e of pkt.entries) {
                if (e.isNexthop) {
                    nexthop = e.prefix.every(b => b === 0) ? srcIp : IPAddress.fromUInt8(new Uint8Array(e.prefix));
                    continue;
                }
                const received  = e.metric & 0xFF;
                const prefBytes = maskPrefix6(new Uint8Array(e.prefix), e.prefixLen);
                const dst       = IPAddress.fromUInt8(prefBytes);
                const key       = `${dst}/${e.prefixLen}`;
                if (received >= RIPNG_INFINITY) { this._expireRoute(key); continue; }
                const metric = Math.min(received + 1, RIPNG_INFINITY);
                if (isLinkLocal6(dst) || this._isConnected6(prefBytes, e.prefixLen)) continue;
                const existing = this._routes.get(key);
                if (!existing || metric < existing.metric ||
                    (metric === existing.metric && existing.learnedIfIndex === ifIndex))
                    this._learnRoute(key, dst, e.prefixLen, nexthop, metric, ifIndex);
            }
        }
    }

    // ── route management ──────────────────────────────────────────────────

    /**
     * @param {string} key
     * @param {IPAddress} dst
     * @param {number} prefix
     * @param {IPAddress} nexthop
     * @param {number} metric
     * @param {number} ifIndex
     */
    _learnRoute(key, dst, prefix, nexthop, metric, ifIndex) {
        const existing = this._routes.get(key);
        if (existing) {
            if (existing.expireTimer != null) simTimer.cancel(existing.expireTimer);
            if (existing.deleteTimer != null) simTimer.cancel(existing.deleteTimer);
            if (existing.metric < this._infinity) {
                const nhChanged     = existing.nexthop.toString() !== nexthop.toString();
                const metricChanged = existing.metric !== metric;
                if (nhChanged || metricChanged) {
                    this._removeFromStack(existing);
                    this._addToStack(dst, prefix, ifIndex, nexthop);
                    this._log(`[${this._name}] aktualisiert ${dst}/${prefix} via ${nexthop} metric ${metric}`);
                }
            } else {
                this._addToStack(dst, prefix, ifIndex, nexthop);
                this._log(`[${this._name}] wiederhergestellt ${dst}/${prefix} via ${nexthop} metric ${metric}`);
            }
        } else {
            this._addToStack(dst, prefix, ifIndex, nexthop);
            this._log(`[${this._name}] gelernt ${dst}/${prefix} via ${nexthop} metric ${metric}`);
        }
        const expireTimer = simTimer.schedule(() => this._expireRoute(key), EXPIRE_MS);
        this._routes.set(key, { dst, prefix, nexthop, metric, learnedIfIndex: ifIndex, expireTimer, deleteTimer: null });
    }

    /** @param {string} key */
    _expireRoute(key) {
        const r = this._routes.get(key);
        if (!r || r.metric >= this._infinity) return;
        if (r.expireTimer != null) simTimer.cancel(r.expireTimer);
        this._removeFromStack(r);
        this._log(`[${this._name}] abgelaufen ${r.dst}/${r.prefix}`);
        const deleteTimer = simTimer.schedule(() => { this._routes.delete(key); }, DELETE_MS);
        this._routes.set(key, { ...r, metric: this._infinity, expireTimer: null, deleteTimer });
    }

    _clearAllRoutes() {
        for (const [, r] of this._routes) {
            if (r.expireTimer != null) simTimer.cancel(r.expireTimer);
            if (r.deleteTimer != null) simTimer.cancel(r.deleteTimer);
            if (r.metric < this._infinity) this._removeFromStack(r);
        }
        this._routes.clear();
    }

    /**
     * @param {IPAddress} dst @param {number} prefix
     * @param {number} ifIndex @param {IPAddress} nexthop
     */
    _addToStack(dst, prefix, ifIndex, nexthop) {
        try { this._net.addRoute(dst, prefix, ifIndex, nexthop, "rip"); } catch {}
    }

    /** @param {{dst: IPAddress, prefix: number, learnedIfIndex: number, nexthop: IPAddress}} r */
    _removeFromStack(r) {
        try { this._net.delRoute(r.dst, r.prefix, r.learnedIfIndex, r.nexthop); } catch {}
    }

    // ── protocol helpers ───────────────────────────────────────────────────

    /** @param {IPAddress} src @returns {number} */
    _ifIndexForSrc4(src) {
        const src32 = ipToU32(src);
        for (let i = 0; i < this._net.interfaces.length; i++) {
            const iface = this._net.interfaces[i];
            if (!iface.ip?.isV4()) continue;
            const mask = prefixToMask(iface.prefixLength);
            if ((src32 & mask) === (ipToU32(iface.ip) & mask)) return i;
        }
        return -1;
    }

    /** @param {number} net32 @param {number} prefix @returns {boolean} */
    _isConnected4(net32, prefix) {
        for (const iface of this._net.interfaces) {
            if (!iface.ip?.isV4()) continue;
            const mask = prefixToMask(iface.prefixLength);
            if (iface.prefixLength === prefix && (ipToU32(iface.ip) & mask) === net32) return true;
        }
        return false;
    }

    /** @param {IPAddress} ip @param {number} prefix @returns {IPAddress} */
    _directedBcast(ip, prefix) {
        const mask = prefixToMask(prefix);
        return u32ToIp(((ipToU32(ip) & mask) | (~mask >>> 0)) >>> 0);
    }

    /** @param {RIPEntry} e @returns {string|null} */
    _entryKey4(e) {
        try {
            const dst32  = (u8ToU32(e.ip) & u8ToU32(e.mask)) >>> 0;
            return `${u32ToIp(dst32)}/${maskToPrefix(u8ToU32(e.mask))}`;
        } catch { return null; }
    }

    /** @param {Uint8Array} prefBytes @param {number} prefLen @returns {boolean} */
    _isConnected6(prefBytes, prefLen) {
        for (const iface of this._net.interfaces) {
            if (!iface.ip6?.isV6() || iface.prefixLength6 !== prefLen) continue;
            if (prefixEqual6(prefBytes, maskPrefix6(iface.ip6.toUInt8(), prefLen), prefLen)) return true;
        }
        return false;
    }

    // ── logging & persistence ──────────────────────────────────────────────

    /** @param {string} line */
    _log(line) {
        const now = new Date().toLocaleTimeString();
        this.log.push(`[${now}] ${line}`);
        if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
        this.onLogUpdate?.();
    }

    toJSON() {
        return { enabled: this.enabled, passive: [...this.passiveInterfaces] };
    }

    /** @param {any} data */
    applyJSON(data) {
        if (!data) return;
        this.enabled           = !!data.enabled;
        this.passiveInterfaces = new Set(Array.isArray(data.passive) ? data.passive : []);
        if (this.enabled) this.start();
    }
}
