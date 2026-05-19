//@ts-check
import { IPAddress } from "./models/IPAddress.js";
import { simTimer } from "../lib/SimTimer.js";
import { IPv6Packet } from "./pdu/IPv6Packet.js";
import { UDPPacket } from "./pdu/UDPPacket.js";
import {
    RIPngPacket, RIPngEntry,
    RIPNG_CMD_RESPONSE, RIPNG_INFINITY, RIPNG_PORT, RIPNG_MCAST,
} from "./pdu/RIPngPacket.js";

const UPDATE_MS =  5_000;
const EXPIRE_MS = 30_000;
const DELETE_MS = 20_000;

// ── IPv6 helpers ────────────────────────────────────────────────────────────

/** fe80::/10 check @param {import("./models/IPAddress.js").IPAddress} ip */
function isLinkLocal6(ip) {
    const b = ip.toUInt8();
    return b[0] === 0xfe && (b[1] & 0xc0) === 0x80;
}

/**
 * Zero bits of bytes16 beyond prefLen, return new Uint8Array(16).
 * @param {Uint8Array} bytes16
 * @param {number} prefLen
 * @returns {Uint8Array}
 */
function maskPrefix6(bytes16, prefLen) {
    const out = new Uint8Array(16);
    let rem = prefLen | 0;
    for (let i = 0; i < 16; i++) {
        if (rem >= 8) { out[i] = bytes16[i]; rem -= 8; }
        else if (rem > 0) { out[i] = bytes16[i] & ((0xff << (8 - rem)) & 0xff); rem = 0; }
    }
    return out;
}

/**
 * Compare first prefLen bits of two Uint8Array(16).
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @param {number} prefLen
 * @returns {boolean}
 */
function prefixEqual6(a, b, prefLen) {
    let rem = prefLen | 0;
    for (let i = 0; i < 16 && rem > 0; i++) {
        if (rem >= 8) {
            if (a[i] !== b[i]) return false;
            rem -= 8;
        } else {
            const mask = (0xff << (8 - rem)) & 0xff;
            if ((a[i] & mask) !== (b[i] & mask)) return false;
            rem = 0;
        }
    }
    return true;
}

// ── types ──────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   dst: IPAddress,
 *   prefix: number,
 *   nexthop: IPAddress,
 *   metric: number,
 *   learnedIfIndex: number,
 *   expireTimer: number|null,
 *   deleteTimer: number|null,
 * }} RIPngRoute
 */

// ── RIPngDaemon ────────────────────────────────────────────────────────────

export class RIPngDaemon {
    /**
     * @param {import("./IPStack.js").IPStack} net
     */
    constructor(net) {
        this._net = net;

        /** @type {boolean} */
        this.enabled = false;
        /** @type {Set<string>} interface names that don't send updates */
        this.passiveInterfaces = new Set();

        this._running = false;
        /** @type {number|null} */
        this._socketPort = null;
        /** @type {number|null} */
        this._updateTimer = null;

        /** @type {Map<string, RIPngRoute>} key = `${dst}/${prefix}` */
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
            this._socketPort = this._net.openUDPSocket(IPAddress.fromString("::"), RIPNG_PORT);
            this._running = true;
            this._scheduleUpdate(0);
            void this._recvLoop();
            this._log("RIPng gestartet");
        } catch (e) {
            this._log(`RIPng Start fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
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
        this._log("RIPng gestoppt");
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
        for (let i = 0; i < this._net.interfaces.length; i++) {
            const iface = this._net.interfaces[i];
            if (this.passiveInterfaces.has(iface.name)) continue;
            if (!iface.ip6LL) continue;
            if (!iface.port?.linkref) continue;
            this._sendUpdate(i);
        }
    }

    /**
     * Build per-interface entry list, apply split horizon, then send directly
     * on the interface so we can scope multicast per link.
     * @param {number} ifIndex
     */
    _sendUpdate(ifIndex) {
        const iface = this._net.interfaces[ifIndex];
        if (!iface.ip6LL) return;

        const entries = this._buildEntries(ifIndex);
        if (entries.length === 0) return;

        const ripPkt  = new RIPngPacket({ command: RIPNG_CMD_RESPONSE, entries });
        const dst     = IPAddress.fromString(RIPNG_MCAST);
        // 33:33:00:00:00:09 — IPv6 multicast MAC for ff02::9
        const dstMac  = new Uint8Array([0x33, 0x33, 0x00, 0x00, 0x00, 0x09]);

        const udpBytes = new UDPPacket({
            srcPort: RIPNG_PORT,
            dstPort: RIPNG_PORT,
            payload: ripPkt.pack(),
        }).pack({ srcIp: iface.ip6LL, dstIp: dst });

        const ipv6Bytes = new IPv6Packet({
            src:        iface.ip6LL,
            dst,
            nextHeader: 17,
            hopLimit:   255,
            payload:    udpBytes,
        }).pack();

        try { iface.sendFrame(dstMac, 0x86DD, ipv6Bytes); } catch { /* link gone */ }
    }

    /**
     * @param {number} ifIndex
     * @returns {RIPngEntry[]}
     */
    _buildEntries(ifIndex) {
        const entries = [];

        // connected routes (metric 1)
        for (let i = 0; i < this._net.interfaces.length; i++) {
            if (i === ifIndex) continue; // split horizon
            const iface = this._net.interfaces[i];
            if (!iface.ip6 || !iface.ip6.isV6()) continue;
            if (isLinkLocal6(iface.ip6)) continue;
            const prefBytes = maskPrefix6(iface.ip6.toUInt8(), iface.prefixLength6);
            entries.push(new RIPngEntry({ prefix: prefBytes, prefixLen: iface.prefixLength6, metric: 1 }));
        }

        // learned RIPng routes
        for (const [, r] of this._routes) {
            if (r.learnedIfIndex === ifIndex) continue; // split horizon
            if (r.metric >= RIPNG_INFINITY) continue;
            entries.push(new RIPngEntry({
                prefix:    maskPrefix6(r.dst.toUInt8(), r.prefix),
                prefixLen: r.prefix,
                metric:    Math.min(r.metric, RIPNG_INFINITY),
            }));
        }

        return entries;
    }

    // ── receive loop ───────────────────────────────────────────────────────

    async _recvLoop() {
        while (this._running && this._socketPort != null) {
            const port = this._socketPort;
            let msg = null;
            try { msg = await this._net.recvUDPSocket(port); } catch { break; }
            if (!this._running || msg == null) break;
            if (msg.srcPort !== RIPNG_PORT) continue;
            this._handleMsg(msg);
        }
    }

    /** @param {any} msg */
    _handleMsg(msg) {
        const srcIp = msg.src instanceof IPAddress ? msg.src : null;
        if (!srcIp || !srcIp.isV6()) return;
        if (!isLinkLocal6(srcIp)) return; // RFC 2080: must originate from link-local

        const ifIndex = typeof msg.recvIfIndex === "number" ? msg.recvIfIndex : -1;
        if (ifIndex < 0) return;

        /** @type {RIPngPacket} */
        let pkt;
        try { pkt = RIPngPacket.fromBytes(msg.payload); } catch { return; }
        if (pkt.command !== RIPNG_CMD_RESPONSE) return;

        let nexthop = srcIp; // default nexthop = link-local source of sender
        for (const e of pkt.entries) {
            if (e.isNexthop) {
                // next-hop RTE: all-zeros → revert to packet source
                nexthop = e.prefix.every(b => b === 0)
                    ? srcIp
                    : IPAddress.fromUInt8(new Uint8Array(e.prefix));
                continue;
            }

            const received = e.metric & 0xFF;
            const prefBytes = maskPrefix6(new Uint8Array(e.prefix), e.prefixLen);
            const dst = IPAddress.fromUInt8(prefBytes);
            const key = `${dst}/${e.prefixLen}`;

            if (received >= RIPNG_INFINITY) {
                this._expireRoute(key);
                continue;
            }

            const metric = Math.min(received + 1, RIPNG_INFINITY);
            if (isLinkLocal6(dst)) continue; // never route link-local prefixes
            if (this._isConnected(prefBytes, e.prefixLen)) continue;

            const existing = this._routes.get(key);
            if (!existing || metric < existing.metric ||
                (metric === existing.metric && existing.learnedIfIndex === ifIndex)) {
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
            if (existing.metric < RIPNG_INFINITY) {
                const nhChanged     = existing.nexthop.toString() !== nexthop.toString();
                const metricChanged = existing.metric !== metric;
                if (nhChanged || metricChanged) {
                    this._removeFromStack(existing);
                    this._addToStack(dst, prefix, ifIndex, nexthop);
                    this._log(`[RIPng] aktualisiert ${dst}/${prefix} via ${nexthop} metric ${metric}`);
                }
            } else {
                this._addToStack(dst, prefix, ifIndex, nexthop);
                this._log(`[RIPng] wiederhergestellt ${dst}/${prefix} via ${nexthop} metric ${metric}`);
            }
        } else {
            this._addToStack(dst, prefix, ifIndex, nexthop);
            this._log(`[RIPng] gelernt ${dst}/${prefix} via ${nexthop} metric ${metric}`);
        }

        const expireTimer = simTimer.schedule(() => this._expireRoute(key), EXPIRE_MS);
        this._routes.set(key, { dst, prefix, nexthop, metric, learnedIfIndex: ifIndex, expireTimer, deleteTimer: null });
    }

    /** @param {string} key */
    _expireRoute(key) {
        const r = this._routes.get(key);
        if (!r || r.metric >= RIPNG_INFINITY) return;
        if (r.expireTimer != null) simTimer.cancel(r.expireTimer);
        this._removeFromStack(r);
        this._log(`[RIPng] abgelaufen ${r.dst}/${r.prefix}`);
        const deleteTimer = simTimer.schedule(() => { this._routes.delete(key); }, DELETE_MS);
        this._routes.set(key, { ...r, metric: RIPNG_INFINITY, expireTimer: null, deleteTimer });
    }

    _clearAllRoutes() {
        for (const [, r] of this._routes) {
            if (r.expireTimer != null) simTimer.cancel(r.expireTimer);
            if (r.deleteTimer != null) simTimer.cancel(r.deleteTimer);
            if (r.metric < RIPNG_INFINITY) this._removeFromStack(r);
        }
        this._routes.clear();
    }

    /**
     * @param {IPAddress} dst @param {number} prefix
     * @param {number} ifIndex @param {IPAddress} nexthop
     */
    _addToStack(dst, prefix, ifIndex, nexthop) {
        try { this._net.addRoute(dst, prefix, ifIndex, nexthop); } catch {}
    }

    /** @param {RIPngRoute} r */
    _removeFromStack(r) {
        try { this._net.delRoute(r.dst, r.prefix, r.learnedIfIndex, r.nexthop); } catch {}
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /**
     * @param {Uint8Array} prefBytes
     * @param {number} prefLen
     * @returns {boolean}
     */
    _isConnected(prefBytes, prefLen) {
        for (const iface of this._net.interfaces) {
            if (!iface.ip6 || !iface.ip6.isV6()) continue;
            if (iface.prefixLength6 !== prefLen) continue;
            const ifPref = maskPrefix6(iface.ip6.toUInt8(), prefLen);
            if (prefixEqual6(prefBytes, ifPref, prefLen)) return true;
        }
        return false;
    }

    /** @param {string} line */
    _log(line) {
        const now = new Date().toLocaleTimeString();
        this.log.push(`[${now}] ${line}`);
        if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
        this.onLogUpdate?.();
    }

    // ── persistence ────────────────────────────────────────────────────────

    toJSON() {
        return {
            enabled: this.enabled,
            passive: [...this.passiveInterfaces],
        };
    }

    /** @param {any} data */
    applyJSON(data) {
        if (!data) return;
        this.enabled           = !!data.enabled;
        this.passiveInterfaces = new Set(Array.isArray(data.passive) ? data.passive : []);
        if (this.enabled) this.start();
    }
}
