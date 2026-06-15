//@ts-check
import { IPAddress } from "./models/IPAddress.js";
import { simTimer } from "../lib/SimTimer.js";
import { nowStamp } from "../lib/helpers.js";
import { VRRPPacket } from "./pdu/VRRPPacket.js";
import { ArpPacket } from "./pdu/ArpPacket.js";
import { EthernetFrame } from "./pdu/EthernetFrame.js";
import { ICMPv6Packet } from "./pdu/ICMPv6Packet.js";
import { IPv6Packet } from "./pdu/IPv6Packet.js";

const VRRP_PROTO = 112;
const VRRP_MCAST_V4_STR = "224.0.0.18";
const VRRP_MCAST_V6_STR = "ff02::12";

/** VRRP advertisement interval (simulation ms, ≈ 1s real) */
const VRRP_ADV_MS = 500;

/**
 * @param {number} vrid
 * @param {number} [ipVersion]  4 → 00:00:5e:00:01:XX  /  6 → 00:00:5e:00:02:XX
 * @returns {Uint8Array}
 */
function makeVirtualMAC(vrid, ipVersion = 4) {
    return new Uint8Array([0x00, 0x00, 0x5e, 0x00, ipVersion === 6 ? 0x02 : 0x01, vrid & 0xff]);
}

class VRRPGroup {
    /**
     * @param {{
     *   ifIndex: number,
     *   vrid: number,
     *   virtualIP: IPAddress,
     *   priority?: number,
     *   advIntervalMs?: number,
     *   preempt?: boolean,
     *   ipVersion?: number
     * }} opts
     */
    constructor({ ifIndex, vrid, virtualIP, priority = 100, advIntervalMs = VRRP_ADV_MS, preempt = true, ipVersion = 4 }) {
        this.ifIndex = ifIndex;
        this.vrid = vrid;
        this.virtualIP = virtualIP;
        this.priority = priority;
        this.advIntervalMs = advIntervalMs;
        this.preempt = preempt;
        this.ipVersion = ipVersion;
        /** @type {'initialize'|'backup'|'master'} */
        this.state = 'initialize';
        this.virtualMAC = makeVirtualMAC(vrid, ipVersion);
        /** @type {number|null} */
        this._advTimer = null;
        /** @type {number|null} */
        this._masterDownTimer = null;
    }

    masterDownInterval() {
        const skew = ((256 - this.priority) / 256) * this.advIntervalMs;
        return 3 * this.advIntervalMs + skew;
    }
}

export class VRRPDaemon {
    /** @param {import("./IPStack.js").IPStack} net */
    constructor(net) {
        this._net = net;
        /** @type {VRRPGroup[]} */
        this.groups = [];
        /** @type {string[]} */
        this.log = [];
        /** @type {(() => void) | null} */
        this.onLogUpdate = null;
        this._running = false;
        this._vrrpMcast4 = IPAddress.fromString(VRRP_MCAST_V4_STR);
        this._vrrpMcast6 = IPAddress.fromString(VRRP_MCAST_V6_STR);
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._net.registerProtoHandler(VRRP_PROTO, (pkt, ifIdx) => this._onReceive(pkt, ifIdx));
        for (const g of this.groups) this._startGroup(g);
    }

    stop() {
        if (!this._running) return;
        this._running = false;
        this._net.unregisterProtoHandler(VRRP_PROTO);
        for (const g of this.groups) this._stopGroup(g);
    }

    /**
     * @param {{
     *   ifIndex: number,
     *   vrid: number,
     *   virtualIP: IPAddress|string,
     *   priority?: number,
     *   advIntervalMs?: number,
     *   preempt?: boolean,
     *   ipVersion?: number
     * }} opts
     */
    addGroup(opts) {
        if (this.groups.find(g => g.ifIndex === opts.ifIndex && g.vrid === opts.vrid)) return;
        const vip = opts.virtualIP instanceof IPAddress
            ? opts.virtualIP
            : IPAddress.fromString(String(opts.virtualIP));
        const ipVersion = opts.ipVersion ?? (vip.isV6() ? 6 : 4);
        const g = new VRRPGroup({ ...opts, virtualIP: vip, ipVersion });
        this.groups.push(g);
        if (this._running) this._startGroup(g);
    }

    /** @param {number} ifIndex @param {number} vrid */
    removeGroup(ifIndex, vrid) {
        const idx = this.groups.findIndex(g => g.ifIndex === ifIndex && g.vrid === vrid);
        if (idx < 0) return;
        const [g] = this.groups.splice(idx, 1);
        this._stopGroup(g);
        this._clearVirtualIP(g);
    }

    toJSON() {
        return {
            groups: this.groups.map(g => ({
                ifIndex: g.ifIndex,
                vrid: g.vrid,
                virtualIP: g.virtualIP.toString(),
                priority: g.priority,
                advIntervalMs: g.advIntervalMs,
                preempt: g.preempt,
                ipVersion: g.ipVersion,
            })),
        };
    }

    /** @param {any} n */
    applyJSON(n) {
        if (!n?.groups?.length) return;
        for (const raw of n.groups) {
            try {
                this.addGroup({
                    ifIndex: Number(raw.ifIndex),
                    vrid: Number(raw.vrid),
                    virtualIP: IPAddress.fromString(String(raw.virtualIP)),
                    priority: raw.priority ?? 100,
                    advIntervalMs: raw.advIntervalMs ?? VRRP_ADV_MS,
                    preempt: raw.preempt ?? true,
                    ipVersion: raw.ipVersion ?? undefined,
                });
            } catch { /* invalid config, skip */ }
        }
        this.start();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    /** @param {string} msg */
    _log(msg) {
        this.log.push(`[${nowStamp()}] ${msg}`);
        if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
        this.onLogUpdate?.();
    }

    /** @param {VRRPGroup} g @returns {string} */
    _ifName(g) {
        return this._net.interfaces[g.ifIndex]?.name ?? `if${g.ifIndex}`;
    }

    /** @param {VRRPGroup} g */
    _startGroup(g) {
        g.state = 'initialize';
        // Wait one master-down interval; if no advertisement heard → become master
        g._masterDownTimer = simTimer.schedule(() => {
            if (g.state === 'initialize') this._becomeMaster(g, 'INITIALIZE');
        }, g.masterDownInterval());
    }

    /** @param {VRRPGroup} g */
    _stopGroup(g) {
        if (g._advTimer !== null) { simTimer.cancel(g._advTimer); g._advTimer = null; }
        if (g._masterDownTimer !== null) { simTimer.cancel(g._masterDownTimer); g._masterDownTimer = null; }
        if (g.state === 'master') this._clearVirtualIP(g);
        g.state = 'initialize';
    }

    /** @param {VRRPGroup} g @param {string} [fromState] */
    _becomeMaster(g, fromState = g.state.toUpperCase()) {
        if (g._masterDownTimer !== null) { simTimer.cancel(g._masterDownTimer); g._masterDownTimer = null; }
        g.state = 'master';
        this._log(`${this._ifName(g)} VRID=${g.vrid}  ${fromState} → MASTER`);
        this._setVirtualIP(g);
        if (g.ipVersion === 6) {
            this._sendUnsolicitedNA(g);
        } else {
            this._sendGratuitousARP(g);
        }
        this._sendAdv(g);
        this._scheduleAdv(g);
    }

    /** @param {VRRPGroup} g */
    _becomeBackup(g) {
        const was = g.state.toUpperCase();
        if (g._advTimer !== null) { simTimer.cancel(g._advTimer); g._advTimer = null; }
        g.state = 'backup';
        this._log(`${this._ifName(g)} VRID=${g.vrid}  ${was} → BACKUP`);
        this._clearVirtualIP(g);
        this._scheduleMasterDown(g);
    }

    /** @param {VRRPGroup} g */
    _scheduleAdv(g) {
        g._advTimer = simTimer.schedule(() => {
            if (g.state !== 'master') return;
            this._sendAdv(g);
            this._scheduleAdv(g);
        }, g.advIntervalMs);
    }

    /** @param {VRRPGroup} g @param {number} [delayMs] */
    _scheduleMasterDown(g, delayMs) {
        if (g._masterDownTimer !== null) { simTimer.cancel(g._masterDownTimer); g._masterDownTimer = null; }
        g._masterDownTimer = simTimer.schedule(() => {
            if (g.state === 'backup') this._becomeMaster(g, 'BACKUP');
        }, delayMs ?? g.masterDownInterval());
    }

    /** @param {VRRPGroup} g */
    _sendAdv(g) {
        if (g.ipVersion === 6) {
            const advCenti = Math.max(1, Math.round(g.advIntervalMs / 100));
            const iface = this._net.interfaces[g.ifIndex];
            const srcIp = iface?.ip6LL ?? iface?.ip6 ?? null;
            const dstIp = this._vrrpMcast6;
            const pkt = new VRRPPacket({
                version: 3, vrid: g.vrid, priority: g.priority,
                advInterval: advCenti, virtualIPs: [g.virtualIP], ipVersion: 6,
            });
            const payload = srcIp ? pkt.pack(srcIp, dstIp) : pkt.pack();
            this._net.sendOnInterfaceV6(g.ifIndex, dstIp, VRRP_PROTO, payload).catch(() => {});
        } else {
            const advSec = Math.max(1, Math.round(g.advIntervalMs / 1000));
            const pkt = new VRRPPacket({
                vrid: g.vrid, priority: g.priority,
                advInterval: advSec, virtualIPs: [g.virtualIP],
            });
            this._net.sendOnInterface(g.ifIndex, this._vrrpMcast4, VRRP_PROTO, pkt.pack()).catch(() => {});
        }
        this._log(`${this._ifName(g)} VRID=${g.vrid}  Advertisement gesendet (prio=${g.priority})`);
    }

    /** @param {VRRPGroup} g */
    _setVirtualIP(g) {
        const iface = this._net.interfaces[g.ifIndex];
        if (!iface) return;
        const key = g.virtualIP.toString();
        iface.virtualIPs.set(key, g.virtualMAC);
        iface.neighborCache.set(key, g.virtualMAC);
    }

    /** @param {VRRPGroup} g */
    _clearVirtualIP(g) {
        const iface = this._net.interfaces[g.ifIndex];
        if (!iface) return;
        const key = g.virtualIP.toString();
        iface.virtualIPs.delete(key);
        iface.neighborCache.delete(key);
    }

    /** @param {VRRPGroup} g */
    _sendGratuitousARP(g) {
        const iface = this._net.interfaces[g.ifIndex];
        if (!iface?.port) return;
        this._log(`${this._ifName(g)} VRID=${g.vrid}  Gratuitous ARP für ${g.virtualIP}`);
        try {
            const arp = new ArpPacket({
                htype: 1, ptype: 0x0800, hlen: 6, plen: 4, oper: 1,
                sha: g.virtualMAC,
                spa: g.virtualIP.toUInt8(),
                tha: new Uint8Array(6),
                tpa: g.virtualIP.toUInt8(),
            });
            const frame = new EthernetFrame({
                dstMac: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
                srcMac: g.virtualMAC,
                etherType: 0x0806,
                payload: arp.pack(),
            });
            iface.port.send(frame);
        } catch { /* port not connected, skip */ }
    }

    /** @param {VRRPGroup} g */
    _sendUnsolicitedNA(g) {
        const iface = this._net.interfaces[g.ifIndex];
        if (!iface?.port) return;
        const srcIp = iface.ip6LL ?? iface.ip6;
        if (!srcIp) return;
        this._log(`${this._ifName(g)} VRID=${g.vrid}  Unsolicited NA für ${g.virtualIP}`);
        try {
            const allNodes = IPAddress.fromString('ff02::1');
            const na = ICMPv6Packet.buildNA(g.virtualIP, g.virtualMAC, false); // unsolicited → S=0
            const ipv6 = new IPv6Packet({
                src: srcIp,
                dst: allNodes,
                nextHeader: 58,
                hopLimit: 255,
                payload: na.pack(srcIp, allNodes),
            });
            const frame = new EthernetFrame({
                dstMac: new Uint8Array([0x33, 0x33, 0x00, 0x00, 0x00, 0x01]),
                srcMac: g.virtualMAC,
                etherType: 0x86DD,
                payload: ipv6.pack(),
            });
            iface.port.send(frame);
        } catch { /* port not connected, skip */ }
    }

    /**
     * @param {import("./pdu/IPv4Packet.js").IPv4Packet} pkt
     * @param {number} ifIdx
     */
    _onReceive(pkt, ifIdx) {
        const ipVersion = pkt.src?.isV6() ? 6 : 4;
        let vrrp;
        try { vrrp = VRRPPacket.fromBytes(pkt.payload, ipVersion); } catch { return; }
        if (!vrrp) return;

        const g = this.groups.find(gr => gr.vrid === vrrp.vrid && gr.ifIndex === ifIdx);
        if (!g) return;

        const srcStr = pkt.src?.toString() ?? '?';
        this._log(`${this._ifName(g)} VRID=${g.vrid}  Advertisement empfangen von ${srcStr} (prio=${vrrp.priority})`);

        if (g.state === 'initialize') {
            g.state = 'backup';
            if (g._masterDownTimer !== null) { simTimer.cancel(g._masterDownTimer); g._masterDownTimer = null; }
            this._log(`${this._ifName(g)} VRID=${g.vrid}  INITIALIZE → BACKUP`);
            this._scheduleMasterDown(g);
            return;
        }

        if (g.state === 'backup') {
            if (vrrp.priority === 0) {
                // Master stepping down → accelerated takeover via skew time
                const skew = ((256 - g.priority) / 256) * g.advIntervalMs;
                this._scheduleMasterDown(g, skew);
            } else if (g.preempt && g.priority > vrrp.priority) {
                this._becomeMaster(g, 'BACKUP');
            } else {
                // Reset master-down timer (master is alive)
                this._scheduleMasterDown(g);
            }
            return;
        }

        if (g.state === 'master') {
            if (vrrp.priority > g.priority) {
                this._becomeBackup(g);
            } else if (vrrp.priority === g.priority) {
                // Tie-break: higher source IP wins
                const srcN = pkt.src ? (Number(pkt.src.getNumber()) >>> 0) : 0;
                const myIp = this._net.interfaces[ifIdx]?.ip;
                const myN = myIp ? (Number(myIp.getNumber()) >>> 0) : 0;
                if (srcN > myN) this._becomeBackup(g);
            }
        }
    }
}
