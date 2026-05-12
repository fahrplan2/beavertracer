//@ts-check
import { IPAddress } from "./models/IPAddress.js";
import { simTimer } from "../lib/SimTimer.js";
import {
    RIPPacket, RIPEntry,
    RIP_CMD_RESPONSE, RIP_AFI_IP, RIP_INFINITY, RIP_PORT,
} from "./pdu/RIPPacket.js";

const UPDATE_MS =  5_000;   // send update every 5 s sim-time
const EXPIRE_MS = 30_000;   // route expires after 6 missed intervals
const DELETE_MS = 20_000;   // hold-down before full removal

// ── helpers ────────────────────────────────────────────────────────────────

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
    let p = 0;
    let m = mask32 >>> 0;
    while (m & 0x80000000) { p++; m = (m << 1) >>> 0; }
    return p;
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
 * }} RIPRoute
 */

// ── RIPDaemon ──────────────────────────────────────────────────────────────

export class RIPDaemon {
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

        /** @type {Map<string, RIPRoute>} key = `${dst}/${prefix}` */
        this._routes = new Map();

        /** @type {string[]} */
        this.log = [];
        /** @type {(() => void)|null} called whenever log changes */
        this.onLogUpdate = null;
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    start() {
        if (this._running) return;
        try {
            this._socketPort = this._net.openUDPSocket(new IPAddress(4, 0), RIP_PORT);
            this._running = true;
            this._scheduleUpdate(0);        // immediate first send
            void this._recvLoop();
            this._log("RIP gestartet");
        } catch (e) {
            this._log(`RIP Start fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
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
        this._log("RIP gestoppt");
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
        if (this._socketPort === null) return;
        const net = this._net;
        for (let i = 0; i < net.interfaces.length; i++) {
            const iface = net.interfaces[i];
            if (this.passiveInterfaces.has(`eth${i}`)) continue;
            if (!iface.ip?.isV4() || ipToU32(iface.ip) === 0) continue;
            if (iface.prefixLength === null) continue;
            if (!iface.port?.linkref) continue;

            const entries = this._buildEntries(i);
            if (entries.length === 0) continue;

            const bcast = this._directedBcast(iface.ip, iface.prefixLength);
            const pkt   = new RIPPacket({ command: RIP_CMD_RESPONSE, entries });
            try {
                this._net.sendUDPSocket(this._socketPort, bcast, RIP_PORT, pkt.pack());
            } catch { /* link might be gone */ }
        }
    }

    /**
     * Build per-interface entry list applying split horizon.
     * @param {number} ifIndex
     * @returns {RIPEntry[]}
     */
    _buildEntries(ifIndex) {
        const entries = [];

        // connected routes (metric 1)
        for (let i = 0; i < this._net.interfaces.length; i++) {
            if (i === ifIndex) continue;                          // split horizon
            const iface = this._net.interfaces[i];
            if (!iface.ip?.isV4() || ipToU32(iface.ip) === 0) continue;
            const mask32 = prefixToMask(iface.prefixLength);
            const net32  = (ipToU32(iface.ip) & mask32) >>> 0;
            entries.push(new RIPEntry({
                ip:      u32ToU8(net32),
                mask:    u32ToU8(mask32),
                nexthop: new Uint8Array(4),
                metric:  1,
            }));
        }

        // learned RIP routes
        for (const [, r] of this._routes) {
            if (r.learnedIfIndex === ifIndex) continue;           // split horizon
            if (r.metric >= RIP_INFINITY) continue;               // don't propagate expired
            entries.push(new RIPEntry({
                ip:      u32ToU8((ipToU32(r.dst) & prefixToMask(r.prefix)) >>> 0),
                mask:    u32ToU8(prefixToMask(r.prefix)),
                nexthop: new Uint8Array(4),
                metric:  Math.min(r.metric, RIP_INFINITY),
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
            if (msg.srcPort !== RIP_PORT) continue;
            this._handleMsg(msg);
        }
    }

    /** @param {any} msg */
    _handleMsg(msg) {
        /** @type {RIPPacket} */
        let pkt;
        try { pkt = RIPPacket.fromBytes(msg.payload); } catch { return; }
        if (pkt.command !== RIP_CMD_RESPONSE) return;

        const srcIp = msg.src instanceof IPAddress ? msg.src : null;
        if (!srcIp) return;
        const ifIndex = this._ifIndexForSrc(srcIp);
        if (ifIndex < 0) return;

        for (const e of pkt.entries) {
            if (e.afi !== RIP_AFI_IP) continue;
            const received = e.metric >>> 0;
            if (received >= RIP_INFINITY) {
                const key = this._entryKey(e);
                if (key) this._expireRoute(key);
                continue;
            }
            const metric = Math.min(received + 1, RIP_INFINITY);
            const dst32  = (u8ToU32(e.ip) & u8ToU32(e.mask)) >>> 0;
            const prefix = maskToPrefix(u8ToU32(e.mask));
            const dst    = u32ToIp(dst32);
            const key    = `${dst}/${prefix}`;

            // skip routes to my own connected networks
            if (this._isConnected(dst32, prefix)) continue;

            const existing = this._routes.get(key);
            if (!existing || metric < existing.metric ||
                (metric === existing.metric && existing.learnedIfIndex === ifIndex)) {
                this._learnRoute(key, dst, prefix, srcIp, metric, ifIndex);
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
            if (existing.metric < RIP_INFINITY) {
                // update nexthop/metric in stack only if changed
                const nhChanged = existing.nexthop.toString() !== nexthop.toString();
                const metricChanged = existing.metric !== metric;
                if (nhChanged || metricChanged) {
                    this._removeFromStack(existing);
                    this._addToStack(dst, prefix, ifIndex, nexthop);
                    this._log(`[RIP] aktualisiert ${dst}/${prefix} via ${nexthop} metric ${metric}`);
                }
            } else {
                // route was expired, re-add
                this._addToStack(dst, prefix, ifIndex, nexthop);
                this._log(`[RIP] wiederhergestellt ${dst}/${prefix} via ${nexthop} metric ${metric}`);
            }
        } else {
            this._addToStack(dst, prefix, ifIndex, nexthop);
            this._log(`[RIP] gelernt ${dst}/${prefix} via ${nexthop} metric ${metric}`);
        }

        const expireTimer = simTimer.schedule(() => this._expireRoute(key), EXPIRE_MS);
        this._routes.set(key, { dst, prefix, nexthop, metric, learnedIfIndex: ifIndex, expireTimer, deleteTimer: null });
    }

    /** @param {string} key */
    _expireRoute(key) {
        const r = this._routes.get(key);
        if (!r || r.metric >= RIP_INFINITY) return;
        if (r.expireTimer != null) simTimer.cancel(r.expireTimer);
        this._removeFromStack(r);
        this._log(`[RIP] abgelaufen ${r.dst}/${r.prefix}`);
        const deleteTimer = simTimer.schedule(() => { this._routes.delete(key); }, DELETE_MS);
        this._routes.set(key, { ...r, metric: RIP_INFINITY, expireTimer: null, deleteTimer });
    }

    _clearAllRoutes() {
        for (const [, r] of this._routes) {
            if (r.expireTimer  != null) simTimer.cancel(r.expireTimer);
            if (r.deleteTimer  != null) simTimer.cancel(r.deleteTimer);
            if (r.metric < RIP_INFINITY) this._removeFromStack(r);
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

    /** @param {RIPRoute} r */
    _removeFromStack(r) {
        try { this._net.delRoute(r.dst, r.prefix, r.learnedIfIndex, r.nexthop); } catch {}
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /** @param {IPAddress} src @returns {number} */
    _ifIndexForSrc(src) {
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
    _isConnected(net32, prefix) {
        for (const iface of this._net.interfaces) {
            if (!iface.ip?.isV4()) continue;
            const mask = prefixToMask(iface.prefixLength);
            if (iface.prefixLength === prefix && (ipToU32(iface.ip) & mask) === net32) return true;
        }
        return false;
    }

    /**
     * Compute directed broadcast for an interface IP + prefix.
     * @param {IPAddress} ip @param {number} prefix @returns {IPAddress}
     */
    _directedBcast(ip, prefix) {
        const mask = prefixToMask(prefix);
        return u32ToIp(((ipToU32(ip) & mask) | (~mask >>> 0)) >>> 0);
    }

    /** @param {RIPEntry} e @returns {string|null} */
    _entryKey(e) {
        try {
            const dst32  = (u8ToU32(e.ip) & u8ToU32(e.mask)) >>> 0;
            const prefix = maskToPrefix(u8ToU32(e.mask));
            return `${u32ToIp(dst32)}/${prefix}`;
        } catch { return null; }
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
            enabled:  this.enabled,
            passive:  [...this.passiveInterfaces],
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
