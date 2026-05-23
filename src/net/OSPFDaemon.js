//@ts-check
// OSPFv2 daemon — RFC 2328 (multi-area, broadcast network type)

import { simTimer, SimTimer } from "../lib/SimTimer.js";
import { IPAddress } from "./models/IPAddress.js";
import {
    OSPF_PROTO, OSPF_VERSION, OSPF_ALL_SPF, OSPF_ALL_DR,
    OSPF_TYPE_HELLO, OSPF_TYPE_DBD, OSPF_TYPE_LSR, OSPF_TYPE_LSU, OSPF_TYPE_LSACK,
    LSA_TYPE_ROUTER, LSA_TYPE_NETWORK, LSA_TYPE_SUMMARY,
    LINK_TYPE_TRANSIT, LINK_TYPE_STUB,
    DBD_FLAG_I, DBD_FLAG_M, DBD_FLAG_MS,
    LSA_INIT_SEQ, LSA_MAX_AGE, LSA_MAX_SEQ,
    ospfChecksum,
    OspfPacket, OspfHeader, OspfHello, OspfDBD, OspfLSR, OspfLSU, OspfLSAck,
    LsaHeader, RouterLSA, RouterLink, NetworkLSA, SummaryLSA, Lsa, LsaRequest,
} from "./pdu/OSPFPacket.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** @param {IPAddress} ip @returns {number} */
function ip2n(ip) { return /** @type {number} */ (ip.getNumber()) >>> 0; }

/** @param {number} n @returns {IPAddress} */
function n2ip(n) { return new IPAddress(4, n >>> 0); }

/** @param {number} prefix @returns {number} */
function prefixToMask32(prefix) {
    if (prefix <= 0) return 0;
    if (prefix >= 32) return 0xffffffff >>> 0;
    return ((0xffffffff << (32 - prefix)) >>> 0);
}

/** @param {number} mask32 @returns {number} */
function mask32ToPrefix(mask32) {
    let p = 0, m = mask32 >>> 0;
    while (m & 0x80000000) { p++; m = (m << 1) >>> 0; }
    return p;
}

/** @param {number} a @param {number} b — OSPF sequence number comparison per RFC 2328 §12.1 */
function seqNewer(a, b) {
    const diff = (a - b) | 0;
    return diff > 0;
}

// ── typedefs ─────────────────────────────────────────────────────────────────

/**
 * @typedef {"Down"|"Init"|"2-Way"|"ExStart"|"Exchange"|"Loading"|"Full"} NeighborState
 * @typedef {"Down"|"Waiting"|"DR-Other"|"BDR"|"DR"} IfaceState
 *
 * @typedef {{
 *   routerId: number,
 *   ip: IPAddress,
 *   ifIndex: number,
 *   state: NeighborState,
 *   priority: number,
 *   dr: number,
 *   bdr: number,
 *   deadTimer: number|null,
 *   rxmtTimer: number|null,
 *   lastHelloTick: number,
 *   ddSeqNum: number,
 *   ddFlags: number,
 *   isMaster: boolean,
 *   pendingLSRs: import("./pdu/OSPFPacket.js").LsaRequest[],
 *   unackedLSUs: Map<string, {lsaBytes: Uint8Array, timerId: number|null}>,
 * }} OspfNeighbor
 *
 * @typedef {{
 *   ifIndex: number,
 *   areaId: number,
 *   state: IfaceState,
 *   dr: number,
 *   bdr: number,
 *   waitTimer: number|null,
 *   helloTimer: number|null,
 *   neighbors: Map<number, OspfNeighbor>,
 * }} OspfIface
 *
 * @typedef {{
 *   header: LsaHeader,
 *   body: RouterLSA|NetworkLSA|SummaryLSA,
 *   rawBytes: Uint8Array,
 *   ageTimer: number|null,
 * }} LsaEntry
 */

// ── OSPFDaemon ────────────────────────────────────────────────────────────────

export class OSPFDaemon {
    /**
     * @param {import("./IPStack.js").IPStack} net
     */
    constructor(net) {
        this._net = net;

        this.enabled = false;
        /** @type {Set<string>} interface names that don't send Hellos */
        this.passiveInterfaces = new Set();
        /** @type {number|null} manually configured Router-ID (u32) */
        this._routerIdOverride = null;
        /** @type {Map<string, number>} ifName → areaId (u32); default area 0 */
        this._ifaceAreaMap = new Map();

        this._running = false;
        /** @type {Map<number, OspfIface>} ifIndex → OspfIface */
        this._ifaces = new Map();
        /** @type {Map<number, Map<string, LsaEntry>>} areaId → lsaKey → LsaEntry */
        this._lsdbByArea = new Map();
        /** @type {Array<{dst: IPAddress, prefix: number, ifIndex: number, nexthop: IPAddress}>} */
        this._installedRoutes = [];
        /** @type {number|null} pending SPF timer */
        this._spfTimer = null;
        /** @type {number} own Router-ID (u32, computed at start) */
        this._myRouterId = 0;
        /** @type {Map<string, number>} "${areaId}-${lsaKey}" → current seqNum */
        this._ownLsaSeq = new Map();
        /** @type {Map<string, number>} "${areaId}-${lsaKey}" → simTimer tick of last origination */
        this._ownLsaOriginatedAt = new Map();
        /** @type {number|null} global age-increment interval timer */
        this._ageIntervalTimer = null;
        /** @type {Map<string, {targetAreaId: number, lsId: number, mask32: number}>} active Summary-LSAs originated by this ABR */
        this._summaryLsaKeys = new Map();

        /** @type {string[]} */
        this.log = [];
        /** @type {(() => void)|null} */
        this.onLogUpdate = null;
    }

    // ── lifecycle ─────────────────────────────────────────────────────────────

    start() {
        if (this._running) return;
        this._myRouterId = this._computeRouterId();
        if (this._myRouterId === 0) {
            this._log("OSPF: no IPv4 address configured, cannot start");
            return;
        }
        this._running = true;
        this._net.registerProtoHandler(OSPF_PROTO, (pkt, ifIdx) => this._handleOSPF(pkt, ifIdx));

        for (let i = 0; i < this._net.interfaces.length; i++) {
            const iface = this._net.interfaces[i];
            if (!iface.ip?.isV4() || ip2n(iface.ip) === 0) continue;
            this._initIface(i);
        }

        this._scheduleAgeInterval();
        this._log(`OSPF started (Router-ID: ${n2ip(this._myRouterId)})`);
    }

    stop() {
        if (!this._running && this._ifaces.size === 0) return;
        this._running = false;
        this._net.unregisterProtoHandler(OSPF_PROTO);

        for (const [, oif] of this._ifaces) {
            this._teardownIface(oif);
        }
        this._ifaces.clear();
        this._lsdbByArea.clear();
        this._summaryLsaKeys.clear();
        this._ownLsaSeq.clear();
        this._ownLsaOriginatedAt.clear();
        if (this._ageIntervalTimer != null) { simTimer.cancel(this._ageIntervalTimer); this._ageIntervalTimer = null; }
        if (this._spfTimer != null) { simTimer.cancel(this._spfTimer); this._spfTimer = null; }
        this._removeLearnedRoutes();
        this._log("OSPF stopped");
    }

    /** @param {boolean} enabled */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled) this.start(); else this.stop();
    }

    /** Call when an interface IP or prefix changes while OSPF is running. */
    onInterfaceChange() {
        if (!this.enabled) return;
        this._originateAllRouterLSAs();
        this._scheduleSPF();
    }

    /** @param {string} ifName @param {boolean} passive */
    setPassive(ifName, passive) {
        if (passive) this.passiveInterfaces.add(ifName);
        else         this.passiveInterfaces.delete(ifName);
    }

    /** @param {string} ifName @param {number} areaId */
    setIfaceArea(ifName, areaId) {
        this._ifaceAreaMap.set(ifName, areaId >>> 0);
        if (this._running) { this.stop(); this.start(); }
    }

    // ── LSDB helpers ─────────────────────────────────────────────────────────

    /** @param {number} areaId @returns {Map<string, LsaEntry>} */
    _lsdbFor(areaId) {
        if (!this._lsdbByArea.has(areaId)) this._lsdbByArea.set(areaId, new Map());
        return /** @type {Map<string, LsaEntry>} */ (this._lsdbByArea.get(areaId));
    }

    /** @returns {Set<number>} area IDs with at least one active interface */
    _activeAreas() {
        const s = new Set();
        for (const [, oif] of this._ifaces) s.add(oif.areaId);
        return s;
    }

    /** @returns {boolean} true if this router has interfaces in more than one area */
    _isABR() {
        return this._activeAreas().size > 1;
    }

    /** Originate Router-LSA in every active area (called on topology changes). */
    _originateAllRouterLSAs(force = false) {
        for (const areaId of this._activeAreas()) this._originateRouterLSA(areaId, force);
    }

    // ── interface init/teardown ───────────────────────────────────────────────

    /** @param {number} ifIndex */
    _initIface(ifIndex) {
        const ifName = `eth${ifIndex}`;
        const areaId = this._ifaceAreaMap.get(ifName) ?? 0;
        /** @type {OspfIface} */
        const oif = {
            ifIndex,
            areaId,
            state: "Waiting",
            dr: 0, bdr: 0,
            waitTimer: null,
            helloTimer: null,
            neighbors: new Map(),
        };
        this._ifaces.set(ifIndex, oif);
        // Start Wait timer — after OSPF_WAIT_MS elect DR/BDR without hearing from others
        oif.waitTimer = simTimer.schedule(() => {
            oif.waitTimer = null;
            this._electDRBDR(ifIndex);
        }, SimTimer.OSPF_WAIT_MS);
        this._scheduleHello(ifIndex, 0);
    }

    /** @param {OspfIface} oif */
    _teardownIface(oif) {
        if (oif.helloTimer != null) { simTimer.cancel(oif.helloTimer); oif.helloTimer = null; }
        if (oif.waitTimer  != null) { simTimer.cancel(oif.waitTimer);  oif.waitTimer  = null; }
        for (const [, nb] of oif.neighbors) this._resetNeighbor(nb);
        oif.neighbors.clear();
        oif.state = "Down";
    }

    // ── LSA age increment ─────────────────────────────────────────────────────

    _scheduleAgeInterval() {
        if (!this._running) return;
        this._ageIntervalTimer = simTimer.schedule(() => {
            if (!this._running) return;
            this._ageIntervalTimer = null;
            this._tickAge();
            this._scheduleAgeInterval();
        }, SimTimer.OSPF_AGE_INTERVAL_MS);
    }

    _tickAge() {
        for (const [, lsdb] of this._lsdbByArea) {
            for (const [, entry] of lsdb) {
                entry.header.age = Math.min(entry.header.age + 1, LSA_MAX_AGE);
            }
        }
    }

    /**
     * Called when a per-LSA age timer fires (LSA_MAX_AGE reached).
     * @param {string} key
     * @param {number} areaId
     */
    _expireLsa(key, areaId) {
        const lsdb  = this._lsdbFor(areaId);
        const entry = lsdb.get(key);
        if (!entry) return;
        if (entry.header.advertisingRouter === this._myRouterId) {
            // Re-originate own LSA (force: bypass MinLSInterval)
            if (entry.header.type === LSA_TYPE_ROUTER) {
                this._originateRouterLSA(areaId, true);
            } else if (entry.header.type === LSA_TYPE_NETWORK) {
                const ifIndex = this._ifaceForNetworkLsaLsId(entry.header.lsId);
                if (ifIndex >= 0) this._originateNetworkLSA(ifIndex, true);
            }
            // Summary-LSAs: let _reconcileSummaryLSAs re-originate on next SPF
        } else {
            // Flood MaxAge copy so other routers flush it, then delete locally
            const maxAgeHdr = new LsaHeader({ ...entry.header, age: LSA_MAX_AGE });
            const maxAgeLsa = new Lsa({ header: maxAgeHdr, body: entry.body });
            this._floodLSA(maxAgeLsa, -1, areaId);
            lsdb.delete(key);
            this._scheduleSPF();
        }
    }

    /** @param {number} lsId @returns {number} ifIndex or -1 */
    _ifaceForNetworkLsaLsId(lsId) {
        for (const [ifIndex] of this._ifaces) {
            const iface = this._net.interfaces[ifIndex];
            if (iface?.ip && ip2n(iface.ip) === lsId) return ifIndex;
        }
        return -1;
    }

    // ── Hello & Interface FSM ─────────────────────────────────────────────────

    /** @param {number} ifIndex @param {number} delayMs */
    _scheduleHello(ifIndex, delayMs) {
        if (!this._running) return;
        const oif = this._ifaces.get(ifIndex);
        if (!oif) return;
        if (oif.helloTimer != null) { simTimer.cancel(oif.helloTimer); oif.helloTimer = null; }
        oif.helloTimer = simTimer.schedule(() => {
            if (!this._running) return;
            oif.helloTimer = null;
            this._sendHello(ifIndex);
            this._scheduleHello(ifIndex, SimTimer.OSPF_HELLO_MS);
        }, Math.max(1, delayMs));
    }

    /** @param {number} ifIndex */
    _sendHello(ifIndex) {
        if (this.passiveInterfaces.has(`eth${ifIndex}`)) return;
        const iface = this._net.interfaces[ifIndex];
        if (!iface?.ip?.isV4() || ip2n(iface.ip) === 0) return;
        if (!iface.port?.linkref) return;

        const oif = this._ifaces.get(ifIndex);
        if (!oif) return;

        const mask32  = prefixToMask32(iface.prefixLength ?? 0);
        const nbIds   = [...oif.neighbors.values()]
            .filter(nb => nb.state !== "Down")
            .map(nb => nb.routerId);

        const helloBody = new OspfHello({
            networkMask:    mask32,
            helloInterval:  SimTimer.OSPF_HELLO_MS / 1000,
            deadInterval:   SimTimer.OSPF_DEAD_MS  / 1000,
            routerPriority: 1,
            dr:  oif.dr,
            bdr: oif.bdr,
            neighbors: nbIds,
        });

        const hdr = new OspfHeader({
            type:     OSPF_TYPE_HELLO,
            length:   0,
            routerId: this._myRouterId,
            areaId:   oif.areaId,
        });

        const pkt = new OspfPacket({ header: hdr, body: helloBody });
        this._net.sendOnInterface(ifIndex, IPAddress.fromString(OSPF_ALL_SPF), OSPF_PROTO, pkt.pack())
            .catch(() => {});
    }

    /**
     * @param {OspfHello} hello
     * @param {OspfHeader} hdr
     * @param {number} ifIndex
     * @param {IPAddress} src
     */
    _handleHello(hello, hdr, ifIndex, src) {
        const oif = this._ifaces.get(ifIndex);
        if (!oif) return;

        // RFC §10.5 parameter validation — discard on mismatch
        const iface = this._net.interfaces[ifIndex];
        const expectedMask  = prefixToMask32(iface.prefixLength ?? 0);
        const expectedHello = Math.trunc(SimTimer.OSPF_HELLO_MS / 1000);
        const expectedDead  = Math.trunc(SimTimer.OSPF_DEAD_MS  / 1000);
        if (hello.networkMask   !== expectedMask)  return;
        if (hello.helloInterval !== expectedHello) return;
        if (hello.deadInterval  !== expectedDead)  return;

        const rid = hdr.routerId;
        let nb = oif.neighbors.get(rid);

        if (!nb) {
            nb = {
                routerId: rid, ip: src, ifIndex,
                state: "Down",
                priority: hello.routerPriority,
                dr: hello.dr, bdr: hello.bdr,
                deadTimer: null, rxmtTimer: null,
                lastHelloTick: simTimer.currentTick,
                ddSeqNum: 0, ddFlags: 0, isMaster: false,
                pendingLSRs: [],
                unackedLSUs: new Map(),
            };
            oif.neighbors.set(rid, nb);
        }

        nb.ip       = src;
        nb.priority = hello.routerPriority;
        const prevNbDr  = nb.dr;
        const prevNbBdr = nb.bdr;
        nb.dr       = hello.dr;
        nb.bdr      = hello.bdr;

        // Reset dead timer
        nb.lastHelloTick = simTimer.currentTick;
        if (nb.deadTimer != null) simTimer.cancel(nb.deadTimer);
        nb.deadTimer = simTimer.schedule(() => {
            this._neighborDown(nb, oif);
        }, SimTimer.OSPF_DEAD_MS);

        const prevState = nb.state;

        // Down → Init
        if (nb.state === "Down") nb.state = "Init";

        const iSeeMyself = hello.neighbors.includes(this._myRouterId);

        if (!iSeeMyself && nb.state !== "Init") {
            // 1-Way: neighbor no longer lists us → regress to Init (RFC §10.3)
            const wasAdj = nb.state === "Full" || nb.state === "Loading";
            if (nb.rxmtTimer != null) { simTimer.cancel(nb.rxmtTimer); nb.rxmtTimer = null; }
            for (const [, e] of nb.unackedLSUs) { if (e.timerId != null) simTimer.cancel(e.timerId); }
            nb.unackedLSUs.clear();
            nb.pendingLSRs = [];
            nb.state = "Init";
            if (wasAdj) {
                this._electDRBDR(ifIndex);
                this._originateAllRouterLSAs();
                this._scheduleSPF();
            }
        } else if (iSeeMyself && nb.state === "Init") {
            // 2-Way: we appear in neighbor's Hello
            nb.state = "2-Way";
        }

        // DR/BDR field changed → re-elect
        const drChanged = (prevNbDr !== hello.dr || prevNbBdr !== hello.bdr);
        if (drChanged && oif.state !== "Waiting") {
            this._electDRBDR(ifIndex);
        }

        // Should we form adjacency?
        if (nb.state === "2-Way" && this._shouldFormAdjacency(nb, oif)) {
            nb.state = "ExStart";
            this._startAdjacency(nb, oif);
        }

        if (nb.state !== prevState) {
            this._log(`Neighbor ${src} state: ${prevState} → ${nb.state}`);
        }

        // Cancel Wait timer if we see DR/BDR announced in Hello
        if (oif.waitTimer != null && (hello.dr !== 0 || hello.bdr !== 0)) {
            simTimer.cancel(oif.waitTimer);
            oif.waitTimer = null;
            this._electDRBDR(ifIndex);
        }
    }

    /** @param {OspfNeighbor} nb @param {OspfIface} oif */
    _neighborDown(nb, oif) {
        this._log(`Neighbor ${nb.ip} -> Down (Dead timer expired)`);
        const wasFullOrLoading = nb.state === "Full" || nb.state === "Loading";
        this._resetNeighbor(nb);
        nb.state = "Down";
        oif.neighbors.delete(nb.routerId);

        if (wasFullOrLoading) {
            this._electDRBDR(oif.ifIndex);
            this._originateAllRouterLSAs();
            this._scheduleSPF();
        }
    }

    /** @param {OspfNeighbor} nb */
    _resetNeighbor(nb) {
        if (nb.deadTimer != null) { simTimer.cancel(nb.deadTimer); nb.deadTimer = null; }
        if (nb.rxmtTimer != null) { simTimer.cancel(nb.rxmtTimer); nb.rxmtTimer = null; }
        for (const [, entry] of nb.unackedLSUs) {
            if (entry.timerId != null) simTimer.cancel(entry.timerId);
        }
        nb.unackedLSUs.clear();
        nb.pendingLSRs = [];
    }

    // ── DR/BDR election (RFC 2328 §9.4) ─────────────────────────────────────

    /**
     * Single-pass DR/BDR calculation from a candidate list (RFC §9.4 inner loop).
     * @param {{rid: number, pri: number, dr: number, bdr: number}[]} candidates
     * @returns {{dr: number, bdr: number}}
     */
    _calcDRBDR(candidates) {
        // Step 1: elect BDR — highest pri among those not declaring themselves DR
        const notDr = candidates.filter(c => c.dr !== c.rid);
        let bdr = 0;
        if (notDr.length > 0) {
            const bdrs = notDr.filter(c => c.bdr === c.rid);
            const pool = bdrs.length > 0 ? bdrs : notDr;
            bdr = pool.reduce((best, c) =>
                c.pri > best.pri || (c.pri === best.pri && c.rid > best.rid) ? c : best
            ).rid;
        }

        // Step 2: elect DR — highest pri among those declaring themselves DR, else BDR becomes DR
        let dr = 0;
        const drCands = candidates.filter(c => c.dr === c.rid);
        if (drCands.length > 0) {
            dr = drCands.reduce((best, c) =>
                c.pri > best.pri || (c.pri === best.pri && c.rid > best.rid) ? c : best
            ).rid;
        } else {
            dr = bdr;
            bdr = candidates.filter(c => c.rid !== dr).reduce((best, c) =>
                c.pri > best.pri || (c.pri === best.pri && c.rid > best.rid) ? c : best, { rid: 0, pri: -1 }
            ).rid;
        }

        return { dr, bdr };
    }

    /** @param {number} ifIndex */
    _electDRBDR(ifIndex) {
        const oif = this._ifaces.get(ifIndex);
        if (!oif) return;

        const selfPri = 1; // own priority

        /** Build candidate list using current declared dr/bdr values. */
        const buildCandidates = (selfDr, selfBdr) => {
            /** @type {{rid: number, pri: number, dr: number, bdr: number}[]} */
            const list = [];
            if (selfPri > 0) list.push({ rid: this._myRouterId, pri: selfPri, dr: selfDr, bdr: selfBdr });
            for (const [, nb] of oif.neighbors) {
                if (nb.state === "Down" || nb.state === "Init") continue;
                if (nb.priority > 0) list.push({ rid: nb.routerId, pri: nb.priority, dr: nb.dr, bdr: nb.bdr });
            }
            return list;
        };

        let candidates = buildCandidates(oif.dr, oif.bdr);

        if (candidates.length === 0) {
            oif.dr = 0; oif.bdr = 0;
            oif.state = "DR-Other";
            return;
        }

        // RFC §9.4: first pass
        let { dr, bdr } = this._calcDRBDR(candidates);

        // RFC §9.4: if own claim changed, run a second pass with updated self entry
        const selfWasDR  = oif.dr  === this._myRouterId;
        const selfWasBDR = oif.bdr === this._myRouterId;
        const selfIsDR   = dr  === this._myRouterId;
        const selfIsBDR  = bdr === this._myRouterId;
        if (selfWasDR !== selfIsDR || selfWasBDR !== selfIsBDR) {
            candidates = buildCandidates(
                selfIsDR  ? this._myRouterId : 0,
                selfIsBDR ? this._myRouterId : 0,
            );
            ({ dr, bdr } = this._calcDRBDR(candidates));
        }

        const prevDR  = oif.dr;
        const prevBDR = oif.bdr;
        oif.dr  = dr;
        oif.bdr = bdr;

        // Set interface state
        if (dr === this._myRouterId) {
            if (oif.state !== "DR") this._log(`Elected as DR on eth${ifIndex}`);
            oif.state = "DR";
        } else if (bdr === this._myRouterId) {
            if (oif.state !== "BDR") this._log(`Elected as BDR on eth${ifIndex}`);
            oif.state = "BDR";
        } else {
            oif.state = "DR-Other";
        }

        // If DR/BDR changed, re-check adjacencies
        if (dr !== prevDR || bdr !== prevBDR) {
            for (const [, nb] of oif.neighbors) {
                if (nb.state === "2-Way" && this._shouldFormAdjacency(nb, oif)) {
                    nb.state = "ExStart";
                    this._startAdjacency(nb, oif);
                }
            }
            // If we just became DR, generate Network-LSA
            if (dr === this._myRouterId) {
                this._originateNetworkLSA(ifIndex);
            } else if (prevDR === this._myRouterId) {
                this._withdrawNetworkLSA(ifIndex);
            }
            this._originateAllRouterLSAs();
        }
    }

    /**
     * @param {OspfNeighbor} nb
     * @param {OspfIface} oif
     * @returns {boolean}
     */
    _shouldFormAdjacency(nb, oif) {
        return (
            nb.routerId === oif.dr  ||
            nb.routerId === oif.bdr ||
            oif.dr  === this._myRouterId ||
            oif.bdr === this._myRouterId
        );
    }

    // ── Adjacency: ExStart → Exchange → Loading → Full ────────────────────────

    /**
     * @param {OspfNeighbor} nb
     * @param {OspfIface} oif
     */
    _startAdjacency(nb, oif) {
        nb.ddSeqNum  = (Math.random() * 0x7fffffff) | 1;
        nb.isMaster  = this._myRouterId > nb.routerId;
        nb.ddFlags   = DBD_FLAG_I | DBD_FLAG_M | DBD_FLAG_MS;
        this._sendDBD(nb, oif.ifIndex, [], DBD_FLAG_I | DBD_FLAG_M | DBD_FLAG_MS);
    }

    /**
     * @param {OspfNeighbor} nb
     * @param {number} ifIndex
     * @param {LsaHeader[]} lsaHeaders
     * @param {number} flags
     */
    _sendDBD(nb, ifIndex, lsaHeaders, flags) {
        const body = new OspfDBD({ flags, ddSeqNum: nb.ddSeqNum, lsaHeaders });
        this._sendOSPF(ifIndex, nb.ip, OSPF_TYPE_DBD, body);
    }

    /**
     * @param {OspfDBD} dbd
     * @param {OspfHeader} hdr
     * @param {number} ifIndex
     * @param {IPAddress} src
     */
    _handleDBD(dbd, hdr, ifIndex, src) {
        const oif = this._ifaces.get(ifIndex);
        if (!oif) return;
        const nb = oif.neighbors.get(hdr.routerId);
        if (!nb || nb.state === "Down" || nb.state === "Init" || nb.state === "2-Way") return;

        const iAmMaster = this._myRouterId > nb.routerId;

        const lsdb = this._lsdbFor(oif.areaId);

        if (nb.state === "ExStart") {
            const theyClaimMaster = !!(dbd.flags & DBD_FLAG_MS);
            if ((dbd.flags & DBD_FLAG_I) && theyClaimMaster && nb.routerId > this._myRouterId) {
                // They are master
                nb.isMaster  = false;
                nb.ddSeqNum  = dbd.ddSeqNum;
                nb.state     = "Exchange";
                this._log(`Neighbor ${src} state: ExStart → Exchange (slave)`);
                const myHeaders = [...lsdb.values()].map(e => e.header);
                this._sendDBD(nb, ifIndex, myHeaders, 0);
            } else if (!(dbd.flags & DBD_FLAG_I) && !theyClaimMaster && iAmMaster &&
                       dbd.ddSeqNum === nb.ddSeqNum) {
                // We are master; slave's first response carries their headers — process them now
                nb.isMaster = true;
                nb.state    = "Exchange";
                nb.ddSeqNum++;
                this._log(`Neighbor ${src} state: ExStart → Exchange (master)`);
                for (const rxHdr of dbd.lsaHeaders) {
                    const existing = lsdb.get(rxHdr.key);
                    if (!existing || seqNewer(rxHdr.seqNum, existing.header.seqNum)) {
                        nb.pendingLSRs.push(new LsaRequest({
                            lsType: rxHdr.type, lsId: rxHdr.lsId, advertisingRouter: rxHdr.advertisingRouter,
                        }));
                    }
                }
                const myHeaders = [...lsdb.values()].map(e => e.header);
                this._sendDBD(nb, ifIndex, myHeaders, DBD_FLAG_MS);
            }
            return;
        }

        if (nb.state === "Exchange") {
            if (!nb.isMaster) {
                // Slave: master must increment its own seq each step (RFC §10.6)
                if (dbd.ddSeqNum !== nb.ddSeqNum + 1) {
                    this._log(`Neighbor ${src}: SeqNumberMismatch (slave)`);
                    this._restartAdjacency(nb, oif);
                    return;
                }
                // Slave: receiving master's DBD with headers — process, ACK, then finish
                for (const rxHdr of dbd.lsaHeaders) {
                    const existing = lsdb.get(rxHdr.key);
                    if (!existing || seqNewer(rxHdr.seqNum, existing.header.seqNum)) {
                        nb.pendingLSRs.push(new LsaRequest({
                            lsType: rxHdr.type, lsId: rxHdr.lsId, advertisingRouter: rxHdr.advertisingRouter,
                        }));
                    }
                }
                // Update slave's seq to master's and send ACK (empty DBD, no flags)
                nb.ddSeqNum = dbd.ddSeqNum;
                this._sendDBD(nb, ifIndex, [], 0);

                if (!(dbd.flags & DBD_FLAG_M)) {
                    if (nb.pendingLSRs.length > 0) {
                        nb.state = "Loading";
                        this._log(`Neighbor ${src} state: Exchange → Loading`);
                        this._sendLSR(nb, ifIndex);
                    } else {
                        nb.state = "Full";
                        this._log(`Neighbor ${src} -> Full`);
                        this._onNeighborFull(nb, ifIndex);
                    }
                }
            } else {
                // Master: receiving slave's ACK — seq must match what we sent
                if (dbd.ddSeqNum !== nb.ddSeqNum) {
                    this._log(`Neighbor ${src}: SeqNumberMismatch`);
                    this._restartAdjacency(nb, oif);
                    return;
                }
                // Any additional slave headers (multi-packet; in practice empty on ACK)
                for (const rxHdr of dbd.lsaHeaders) {
                    const existing = lsdb.get(rxHdr.key);
                    if (!existing || seqNewer(rxHdr.seqNum, existing.header.seqNum)) {
                        nb.pendingLSRs.push(new LsaRequest({
                            lsType: rxHdr.type, lsId: rxHdr.lsId, advertisingRouter: rxHdr.advertisingRouter,
                        }));
                    }
                }
                if (!(dbd.flags & DBD_FLAG_M)) {
                    if (nb.pendingLSRs.length > 0) {
                        nb.state = "Loading";
                        this._log(`Neighbor ${src} state: Exchange → Loading`);
                        this._sendLSR(nb, ifIndex);
                    } else {
                        nb.state = "Full";
                        this._log(`Neighbor ${src} -> Full`);
                        this._onNeighborFull(nb, ifIndex);
                    }
                }
            }
            return;
        }
    }

    /**
     * @param {OspfNeighbor} nb
     * @param {number} ifIndex
     */
    _sendLSR(nb, ifIndex) {
        if (nb.pendingLSRs.length === 0) return;
        const body = new OspfLSR({ requests: nb.pendingLSRs.slice(0, 50) });
        this._sendOSPF(ifIndex, nb.ip, OSPF_TYPE_LSR, body);
    }

    /**
     * @param {OspfLSR} lsr
     * @param {OspfHeader} hdr
     * @param {number} ifIndex
     * @param {IPAddress} src
     */
    _handleLSR(lsr, hdr, ifIndex, src) {
        const oif = this._ifaces.get(ifIndex);
        if (!oif) return;
        const nb = oif.neighbors.get(hdr.routerId);

        const lsas = [];
        const lsrLsdb = this._lsdbFor(oif.areaId);
        for (const req of lsr.requests) {
            const key   = `${req.lsType}-${req.lsId}-${req.advertisingRouter}`;
            const entry = lsrLsdb.get(key);
            if (!entry) {
                // BadLSReq: requested LSA unknown → restart adjacency (RFC §10.3)
                if (nb) {
                    this._log(`Neighbor ${src}: BadLSReq`);
                    this._restartAdjacency(nb, oif);
                }
                return;
            }
            lsas.push(new Lsa({ header: entry.header, body: entry.body }));
        }
        if (lsas.length === 0) return;
        const body = new OspfLSU({ lsas });
        this._sendOSPF(ifIndex, src, OSPF_TYPE_LSU, body);
    }

    /**
     * @param {OspfLSU} lsu
     * @param {OspfHeader} hdr
     * @param {number} ifIndex
     * @param {IPAddress} src
     */
    _handleLSU(lsu, hdr, ifIndex, src) {
        const oif = this._ifaces.get(ifIndex);
        if (!oif) return;
        const nb  = oif.neighbors.get(hdr.routerId);

        const ackHeaders = [];
        let changed = false;
        const lsdb = this._lsdbFor(oif.areaId);

        for (const lsa of lsu.lsas) {
            if (lsa.header.type !== LSA_TYPE_ROUTER &&
                lsa.header.type !== LSA_TYPE_NETWORK &&
                lsa.header.type !== LSA_TYPE_SUMMARY) continue;

            // Self-originated LSA with a newer seq: re-originate to reclaim ownership (RFC §13.4)
            if (lsa.header.advertisingRouter === this._myRouterId) {
                if (lsa.header.type === LSA_TYPE_ROUTER) {
                    this._originateRouterLSA(oif.areaId, true);
                } else if (lsa.header.type === LSA_TYPE_NETWORK) {
                    const ifIdx = this._ifaceForNetworkLsaLsId(lsa.header.lsId);
                    if (ifIdx >= 0) this._originateNetworkLSA(ifIdx, true);
                }
                // Own Summary-LSAs: let _reconcileSummaryLSAs handle them
                continue;
            }

            const key      = lsa.key;
            const existing = lsdb.get(key);

            if (existing && !seqNewer(lsa.header.seqNum, existing.header.seqNum)) {
                // Not newer — send ACK but don't install
                ackHeaders.push(lsa.header);
                continue;
            }

            // Install into area LSDB
            const rawBytes = lsa.pack();
            if (existing?.ageTimer != null) simTimer.cancel(existing.ageTimer);
            const areaId   = oif.areaId;
            const ageTimer = simTimer.schedule(() => this._expireLsa(key, areaId), LSA_MAX_AGE * 1000);

            lsdb.set(key, { header: lsa.header, body: lsa.body, rawBytes, ageTimer });
            ackHeaders.push(lsa.header);
            changed = true;

            // Flood within area (not the incoming interface)
            this._floodLSA(lsa, ifIndex, oif.areaId);
        }

        // Send ACK
        if (ackHeaders.length > 0) {
            const dst = (oif.state === "DR" || oif.state === "BDR")
                ? IPAddress.fromString(OSPF_ALL_SPF)
                : src;
            const ack = new OspfLSAck({ lsaHeaders: ackHeaders });
            this._sendOSPF(ifIndex, dst, OSPF_TYPE_LSACK, ack);
        }

        // Advance Loading neighbor
        if (nb && nb.state === "Loading") {
            // Remove requests we just received
            const receivedKeys = new Set(lsu.lsas.map(l => l.key));
            nb.pendingLSRs = nb.pendingLSRs.filter(
                r => !receivedKeys.has(`${r.lsType}-${r.lsId}-${r.advertisingRouter}`)
            );
            if (nb.pendingLSRs.length === 0) {
                nb.state = "Full";
                this._log(`Neighbor ${src} -> Full`);
                this._onNeighborFull(nb, ifIndex);
            } else {
                this._sendLSR(nb, ifIndex);
            }
        }

        if (changed) this._scheduleSPF();
    }

    /**
     * @param {OspfLSAck} lsack
     * @param {OspfHeader} hdr
     * @param {number} ifIndex
     * @param {IPAddress} src
     */
    _handleLSAck(lsack, hdr, ifIndex, src) {
        const oif = this._ifaces.get(ifIndex);
        if (!oif) return;
        const nb = oif.neighbors.get(hdr.routerId);
        if (!nb) return;
        for (const ackHdr of lsack.lsaHeaders) {
            const entry = nb.unackedLSUs.get(ackHdr.key);
            if (entry) {
                if (entry.timerId != null) simTimer.cancel(entry.timerId);
                nb.unackedLSUs.delete(ackHdr.key);
            }
        }
    }

    /** @param {OspfNeighbor} nb @param {number} ifIndex */
    _onNeighborFull(nb, ifIndex) {
        this._originateAllRouterLSAs(true);
        const oif = this._ifaces.get(ifIndex);
        if (oif?.state === "DR") this._originateNetworkLSA(ifIndex, true);
        this._scheduleSPF();
    }

    /**
     * SeqNumberMismatch / BadLSReq recovery: reset neighbor and restart ExStart.
     * @param {OspfNeighbor} nb
     * @param {OspfIface} oif
     */
    _restartAdjacency(nb, oif) {
        this._resetNeighbor(nb);
        nb.state = "ExStart";
        this._startAdjacency(nb, oif);
    }

    // ── LSA Origination ───────────────────────────────────────────────────────

    /**
     * @param {number} areaId  area to originate Router-LSA into
     * @param {boolean} [force] bypass MinLSInterval
     */
    _originateRouterLSA(areaId, force = false) {
        if (!this._running) return;
        const lsaKey = `${LSA_TYPE_ROUTER}-${this._myRouterId}-${this._myRouterId}`;
        const seqKey = `${areaId}-${lsaKey}`;
        if (!force) {
            const lastTick = this._ownLsaOriginatedAt.get(seqKey) ?? -Infinity;
            if (simTimer.currentTick - lastTick < SimTimer.toTicks(SimTimer.OSPF_MIN_LS_INTERVAL_MS)) return;
        }
        const links = [];

        for (let i = 0; i < this._net.interfaces.length; i++) {
            const iface = this._net.interfaces[i];
            if (!iface.ip?.isV4() || ip2n(iface.ip) === 0) continue;
            const oif = this._ifaces.get(i);
            if (!oif || oif.areaId !== areaId) continue;  // only links in this area

            const mask32 = prefixToMask32(iface.prefixLength ?? 0);
            const net32  = (ip2n(iface.ip) & mask32) >>> 0;

            // Full neighbors → transit link (to DR)
            const fullNeighbors = [...(oif.neighbors.values())].filter(nb => nb.state === "Full");
            if (fullNeighbors.length > 0 && oif.dr !== 0) {
                // linkId = DR's interface IP on this segment (= Network-LSA lsId)
                let drIfaceIp;
                if (oif.dr === this._myRouterId) {
                    drIfaceIp = ip2n(iface.ip);
                } else {
                    const drNb = [...oif.neighbors.values()].find(nb => nb.routerId === oif.dr);
                    drIfaceIp = drNb ? ip2n(drNb.ip) : oif.dr;
                }
                links.push(new RouterLink({
                    linkId:   drIfaceIp,
                    linkData: ip2n(iface.ip),
                    type:     LINK_TYPE_TRANSIT,
                    metric:   10,
                }));
            } else {
                links.push(new RouterLink({
                    linkId:   net32,
                    linkData: mask32,
                    type:     LINK_TYPE_STUB,
                    metric:   10,
                }));
            }
        }

        const lsdb   = this._lsdbFor(areaId);
        const oldSeq = this._ownLsaSeq.get(seqKey) ?? (LSA_INIT_SEQ - 1);
        if (oldSeq === LSA_MAX_SEQ) {
            const existing = lsdb.get(lsaKey);
            if (existing) {
                const maxAgeHdr = new LsaHeader({ ...existing.header, age: LSA_MAX_AGE });
                this._floodLSA(new Lsa({ header: maxAgeHdr, body: existing.body }), -1, areaId);
                if (existing.ageTimer != null) simTimer.cancel(existing.ageTimer);
                lsdb.delete(lsaKey);
            }
            this._ownLsaSeq.delete(seqKey);
            simTimer.schedule(() => this._originateRouterLSA(areaId, true), 1);
            return;
        }
        const seqNum = (oldSeq + 1) >>> 0;
        this._ownLsaSeq.set(seqKey, seqNum);
        this._ownLsaOriginatedAt.set(seqKey, simTimer.currentTick);

        const body   = new RouterLSA({ links });
        const header = new LsaHeader({
            age:               0,
            type:              LSA_TYPE_ROUTER,
            lsId:              this._myRouterId,
            advertisingRouter: this._myRouterId,
            seqNum,
            length:            20 + body.pack().length,
        });
        const lsa      = new Lsa({ header, body });
        const rawBytes = lsa.pack();

        if (lsdb.get(lsaKey)?.ageTimer != null) {
            simTimer.cancel(/** @type {number} */ (lsdb.get(lsaKey)?.ageTimer));
        }
        const ageTimer = simTimer.schedule(() => this._expireLsa(lsaKey, areaId), LSA_MAX_AGE * 1000);

        lsdb.set(lsaKey, { header, body, rawBytes, ageTimer });
        this._floodLSA(lsa, -1, areaId);
    }

    /** @param {number} ifIndex @param {boolean} [force] bypass MinLSInterval */
    _originateNetworkLSA(ifIndex, force = false) {
        if (!this._running) return;
        const iface = this._net.interfaces[ifIndex];
        if (!iface?.ip?.isV4()) return;
        const oif = this._ifaces.get(ifIndex);
        if (!oif || oif.state !== "DR") return;

        const mask32 = prefixToMask32(iface.prefixLength ?? 0);
        const fullRouters = [
            this._myRouterId,
            ...[...oif.neighbors.values()].filter(nb => nb.state === "Full").map(nb => nb.routerId),
        ];

        const body   = new NetworkLSA({ networkMask: mask32, attachedRouters: fullRouters });
        const lsId   = ip2n(iface.ip);
        const lsaKey = `${LSA_TYPE_NETWORK}-${lsId}-${this._myRouterId}`;
        const seqKey = `${oif.areaId}-${lsaKey}`;
        if (!force) {
            const lastTick = this._ownLsaOriginatedAt.get(seqKey) ?? -Infinity;
            if (simTimer.currentTick - lastTick < SimTimer.toTicks(SimTimer.OSPF_MIN_LS_INTERVAL_MS)) return;
        }
        const lsdb   = this._lsdbFor(oif.areaId);
        const oldSeq = this._ownLsaSeq.get(seqKey) ?? (LSA_INIT_SEQ - 1);
        if (oldSeq === LSA_MAX_SEQ) {
            const existing = lsdb.get(lsaKey);
            if (existing) {
                const maxAgeHdr = new LsaHeader({ ...existing.header, age: LSA_MAX_AGE });
                this._floodLSA(new Lsa({ header: maxAgeHdr, body: existing.body }), -1, oif.areaId);
                if (existing.ageTimer != null) simTimer.cancel(existing.ageTimer);
                lsdb.delete(lsaKey);
            }
            this._ownLsaSeq.delete(seqKey);
            simTimer.schedule(() => this._originateNetworkLSA(ifIndex, true), 1);
            return;
        }
        const seqNum = (oldSeq + 1) >>> 0;
        this._ownLsaSeq.set(seqKey, seqNum);
        this._ownLsaOriginatedAt.set(seqKey, simTimer.currentTick);

        const header = new LsaHeader({
            age: 0, type: LSA_TYPE_NETWORK,
            lsId, advertisingRouter: this._myRouterId,
            seqNum, length: 20 + body.pack().length,
        });
        const lsa      = new Lsa({ header, body });
        const rawBytes = lsa.pack();

        if (lsdb.get(lsaKey)?.ageTimer != null) {
            simTimer.cancel(/** @type {number} */ (lsdb.get(lsaKey)?.ageTimer));
        }
        const netAreaId = oif.areaId;
        const ageTimer = simTimer.schedule(() => this._expireLsa(lsaKey, netAreaId), LSA_MAX_AGE * 1000);
        lsdb.set(lsaKey, { header, body, rawBytes, ageTimer });
        this._floodLSA(lsa, -1, oif.areaId);
    }

    /** @param {number} ifIndex */
    _withdrawNetworkLSA(ifIndex) {
        const iface = this._net.interfaces[ifIndex];
        if (!iface?.ip?.isV4()) return;
        const oif  = this._ifaces.get(ifIndex);
        if (!oif) return;
        const lsId = ip2n(iface.ip);
        const key  = `${LSA_TYPE_NETWORK}-${lsId}-${this._myRouterId}`;
        const lsdb = this._lsdbFor(oif.areaId);
        const entry = lsdb.get(key);
        if (!entry) return;

        const hdr = new LsaHeader({ ...entry.header, age: LSA_MAX_AGE, seqNum: entry.header.seqNum });
        const maxAgeLsa = new Lsa({ header: hdr, body: entry.body });
        this._floodLSA(maxAgeLsa, -1, oif.areaId);

        if (entry.ageTimer != null) simTimer.cancel(entry.ageTimer);
        lsdb.delete(key);
        this._ownLsaSeq.delete(`${oif.areaId}-${key}`);
    }

    // ── Flooding ──────────────────────────────────────────────────────────────

    /**
     * Flood an LSA within an area. RFC 2328 §13.3.
     *   DR/BDR  → AllSPFRouters (224.0.0.5)
     *   DR-Other → AllDRouters   (224.0.0.6)
     * @param {Lsa} lsa
     * @param {number} fromIfIndex  incoming interface index (-1 for self-originated)
     * @param {number} areaId       only flood on interfaces in this area
     */
    _floodLSA(lsa, fromIfIndex, areaId) {
        const rawBytes = lsa.pack();
        for (const [ifIndex, oif] of this._ifaces) {
            if (ifIndex === fromIfIndex) continue;
            if (oif.areaId !== areaId) continue;
            const fullNeighbors = [...oif.neighbors.values()].filter(nb => nb.state === "Full");
            if (fullNeighbors.length === 0) continue;

            const dst = (oif.state === "DR" || oif.state === "BDR")
                ? IPAddress.fromString(OSPF_ALL_SPF)
                : IPAddress.fromString(OSPF_ALL_DR);

            // RFC §12.1: increment age by InfTransDelay (1 s) before sending
            const txHdr = new LsaHeader({ ...lsa.header, age: Math.min(lsa.header.age + 1, LSA_MAX_AGE) });
            const txLsa = new Lsa({ header: txHdr, body: lsa.body });
            this._sendOSPF(ifIndex, dst, OSPF_TYPE_LSU, new OspfLSU({ lsas: [txLsa] }));

            // Track per-neighbor so each ACK can cancel the retransmit timer
            for (const nb of fullNeighbors) {
                this._trackUnacked(nb, ifIndex, lsa.key, rawBytes);
            }
        }
    }

    /**
     * Register an unacknowledged LSU for a neighbor and arm the retransmit timer.
     * @param {OspfNeighbor} nb
     * @param {number} ifIndex
     * @param {string} lsaKey
     * @param {Uint8Array} rawBytes
     */
    _trackUnacked(nb, ifIndex, lsaKey, rawBytes) {
        const existing = nb.unackedLSUs.get(lsaKey);
        if (existing?.timerId != null) simTimer.cancel(existing.timerId);
        const timerId = simTimer.schedule(
            () => this._retransmitLSU(nb, ifIndex, lsaKey),
            SimTimer.OSPF_RXMT_MS,
        );
        nb.unackedLSUs.set(lsaKey, { lsaBytes: rawBytes, timerId });
    }

    /**
     * Retransmit a single unacknowledged LSA to a specific neighbor (unicast).
     * Reschedules itself until an LSAck is received or the neighbor goes down.
     * @param {OspfNeighbor} nb
     * @param {number} ifIndex
     * @param {string} lsaKey
     */
    _retransmitLSU(nb, ifIndex, lsaKey) {
        if (nb.state !== "Full") { nb.unackedLSUs.delete(lsaKey); return; }
        const areaId    = this._ifaces.get(ifIndex)?.areaId ?? 0;
        const lsdbEntry = this._lsdbFor(areaId).get(lsaKey);
        if (!lsdbEntry) { nb.unackedLSUs.delete(lsaKey); return; }

        const lsa = new Lsa({ header: lsdbEntry.header, body: lsdbEntry.body });
        this._sendOSPF(ifIndex, nb.ip, OSPF_TYPE_LSU, new OspfLSU({ lsas: [lsa] }));

        const timerId = simTimer.schedule(
            () => this._retransmitLSU(nb, ifIndex, lsaKey),
            SimTimer.OSPF_RXMT_MS,
        );
        const entry = nb.unackedLSUs.get(lsaKey);
        if (entry) entry.timerId = timerId;
    }

    // ── SPF ───────────────────────────────────────────────────────────────────

    _scheduleSPF() {
        if (this._spfTimer != null) return;
        this._spfTimer = simTimer.schedule(() => {
            this._spfTimer = null;
            this._runSPF();
        }, SimTimer.OSPF_SPF_DELAY_MS);
    }

    /**
     * Dijkstra for one area.
     * Returns reach map (routerId → {ifIndex, nexthop, cost}) and intra-area routes.
     * @param {number} areaId
     * @returns {{ reach: Map<number,{ifIndex:number,nexthop:IPAddress,cost:number}>, intraRoutes: {dst:IPAddress,prefix:number,ifIndex:number,nexthop:IPAddress,cost:number}[] }}
     */
    _runSPFArea(areaId) {
        const lsdb  = this._lsdbFor(areaId);
        const myId  = this._myRouterId;

        /** @type {Map<number, number>} routerId �� cost */
        const dist = new Map();
        /** @type {Map<number, {ifIndex: number, nexthop: IPAddress, cost: number}>} */
        const reach = new Map();
        /** @type {Set<number>} */
        const visited = new Set();

        dist.set(myId, 0);
        const queue = [{ id: myId, cost: 0 }];

        while (queue.length > 0) {
            queue.sort((a, b) => a.cost - b.cost);
            const { id: u, cost: uCost } = queue.shift();
            if (visited.has(u)) continue;
            visited.add(u);

            const rEntry = lsdb.get(`${LSA_TYPE_ROUTER}-${u}-${u}`);
            if (!(rEntry?.body instanceof RouterLSA)) continue;

            for (const link of rEntry.body.links) {
                if (link.type !== LINK_TYPE_TRANSIT) continue;

                const netLsId  = link.linkId;
                const netEntry = [...lsdb.values()].find(
                    e => e.header.type === LSA_TYPE_NETWORK && e.header.lsId === netLsId
                );
                if (!(netEntry?.body instanceof NetworkLSA)) continue;

                const segCost = uCost + link.metric;

                let ifIndex, baseNexthop;
                if (u === myId) {
                    ifIndex = -1;
                    for (const [idx, oif] of this._ifaces) {
                        if (oif.areaId !== areaId) continue;
                        const iface = this._net.interfaces[idx];
                        if (iface?.ip && ip2n(iface.ip) === link.linkData) { ifIndex = idx; break; }
                    }
                    baseNexthop = null;
                } else {
                    const ri = reach.get(u);
                    ifIndex    = ri?.ifIndex ?? -1;
                    baseNexthop = ri?.nexthop ?? n2ip(0);
                }

                for (const attRouter of netEntry.body.attachedRouters) {
                    if (attRouter === myId) continue;
                    const prev = dist.get(attRouter) ?? Infinity;
                    if (prev <= segCost) continue;
                    dist.set(attRouter, segCost);

                    const nexthop = (u === myId)
                        ? (this._neighborByRouterId(attRouter)?.ip ?? n2ip(0))
                        : (baseNexthop ?? n2ip(0));
                    reach.set(attRouter, { ifIndex, nexthop, cost: segCost });
                    queue.push({ id: attRouter, cost: segCost });
                }
            }
        }

        /** @type {{dst:IPAddress,prefix:number,ifIndex:number,nexthop:IPAddress,cost:number}[]} */
        const intraRoutes = [];

        // Stub-network routes from reachable remote routers
        for (const [, entry] of lsdb) {
            if (entry.header.type !== LSA_TYPE_ROUTER) continue;
            if (!(entry.body instanceof RouterLSA)) continue;
            const rid  = entry.header.advertisingRouter;
            if (rid === myId) continue;
            const info = reach.get(rid);
            if (!info || info.ifIndex < 0) continue;

            for (const link of entry.body.links) {
                if (link.type !== LINK_TYPE_STUB) continue;
                const prefix = mask32ToPrefix(link.linkData);
                const net32  = (link.linkId & link.linkData) >>> 0;
                const cost   = info.cost + link.metric;
                intraRoutes.push({ dst: n2ip(net32), prefix, ifIndex: info.ifIndex, nexthop: info.nexthop, cost });
            }
        }

        // RFC §16.1 step 3: transit network routes (Network-LSAs)
        for (const [, entry] of lsdb) {
            if (entry.header.type !== LSA_TYPE_NETWORK) continue;
            if (!(entry.body instanceof NetworkLSA)) continue;
            if (entry.body.attachedRouters.includes(myId)) continue;
            const info = reach.get(entry.header.advertisingRouter);
            if (!info || info.ifIndex < 0) continue;
            const mask32 = entry.body.networkMask;
            const net32  = (entry.header.lsId & mask32) >>> 0;
            const prefix = mask32ToPrefix(mask32);
            intraRoutes.push({ dst: n2ip(net32), prefix, ifIndex: info.ifIndex, nexthop: info.nexthop, cost: info.cost });
        }

        return { reach, intraRoutes };
    }

    _runSPF() {
        this._removeLearnedRoutes();

        /** @type {Map<number, Map<number,{ifIndex:number,nexthop:IPAddress,cost:number}>>} */
        const reachByArea = new Map();
        /** @type {{dst:IPAddress,prefix:number,ifIndex:number,nexthop:IPAddress,cost:number}[]} */
        const allRoutes = [];

        for (const areaId of this._activeAreas()) {
            const { reach, intraRoutes } = this._runSPFArea(areaId);
            reachByArea.set(areaId, reach);
            allRoutes.push(...intraRoutes);
        }

        allRoutes.push(...this._computeInterAreaRoutes(reachByArea));

        if (this._isABR()) this._reconcileSummaryLSAs(reachByArea);

        // De-duplicate: for same dst/prefix keep lowest cost
        const best = new Map();
        for (const r of allRoutes) {
            const k = `${ip2n(r.dst)}-${r.prefix}`;
            if (!best.has(k) || r.cost < best.get(k).cost) best.set(k, r);
        }

        const finalRoutes = [...best.values()];
        for (const r of finalRoutes) {
            try { this._net.addRoute(r.dst, r.prefix, r.ifIndex, r.nexthop, "ospf"); } catch {}
        }
        this._installedRoutes = finalRoutes;
        this._log(`SPF: ${finalRoutes.length} routes installed`);
    }

    /**
     * Compute inter-area routes from Summary-LSAs (RFC §16.2).
     * @param {Map<number, Map<number,{ifIndex:number,nexthop:IPAddress,cost:number}>>} reachByArea
     * @returns {{dst:IPAddress,prefix:number,ifIndex:number,nexthop:IPAddress,cost:number}[]}
     */
    _computeInterAreaRoutes(reachByArea) {
        /** @type {Map<string, {dst:IPAddress,prefix:number,ifIndex:number,nexthop:IPAddress,cost:number}>} */
        const best = new Map();

        for (const [areaId, reach] of reachByArea) {
            const lsdb = this._lsdbFor(areaId);
            for (const [, entry] of lsdb) {
                if (entry.header.type !== LSA_TYPE_SUMMARY) continue;
                if (!(entry.body instanceof SummaryLSA)) continue;
                const abrRid  = entry.header.advertisingRouter;
                const abrInfo = reach.get(abrRid);
                if (!abrInfo || abrInfo.ifIndex < 0) continue;
                const totalCost = abrInfo.cost + entry.body.metric;
                const mask32    = entry.body.networkMask;
                const net32     = (entry.header.lsId & mask32) >>> 0;
                const prefix    = mask32ToPrefix(mask32);
                const k         = `${net32}-${prefix}`;
                if (!best.has(k) || totalCost < best.get(k).cost) {
                    best.set(k, { dst: n2ip(net32), prefix, ifIndex: abrInfo.ifIndex, nexthop: abrInfo.nexthop, cost: totalCost });
                }
            }
        }
        return [...best.values()];
    }

    /**
     * ABR: originate/withdraw Summary-LSAs based on current SPF results.
     * @param {Map<number, Map<number,{ifIndex:number,nexthop:IPAddress,cost:number}>>} reachByArea
     */
    _reconcileSummaryLSAs(reachByArea) {
        const myAreas = [...this._activeAreas()];
        /** @type {Map<string, {targetAreaId:number,lsId:number,mask32:number,metric:number}>} */
        const newSummaries = new Map();  // key = "${targetAreaId}-${net32}-${mask32}"

        for (const [srcAreaId, reach] of reachByArea) {
            const lsdb = this._lsdbFor(srcAreaId);

            // Collect intra-area destinations from this area's LSDB
            for (const [, entry] of lsdb) {
                if (entry.header.type === LSA_TYPE_ROUTER && entry.body instanceof RouterLSA) {
                    const rid  = entry.header.advertisingRouter;
                    const cost = rid === this._myRouterId ? 0 : (reach.get(rid)?.cost ?? null);
                    if (cost === null) continue;
                    for (const link of entry.body.links) {
                        if (link.type !== LINK_TYPE_STUB) continue;
                        const net32  = (link.linkId & link.linkData) >>> 0;
                        const mask32 = link.linkData;
                        const metric = cost + link.metric;
                        for (const tgt of myAreas) {
                            if (tgt === srcAreaId) continue;
                            const k = `${tgt}-${net32}-${mask32}`;
                            if (!newSummaries.has(k) || newSummaries.get(k).metric > metric)
                                newSummaries.set(k, { targetAreaId: tgt, lsId: net32, mask32, metric });
                        }
                    }
                }
                if (entry.header.type === LSA_TYPE_NETWORK && entry.body instanceof NetworkLSA) {
                    if (entry.body.attachedRouters.includes(this._myRouterId)) continue;
                    const drInfo = reach.get(entry.header.advertisingRouter);
                    if (!drInfo) continue;
                    const mask32 = entry.body.networkMask;
                    const net32  = (entry.header.lsId & mask32) >>> 0;
                    const metric = drInfo.cost;
                    for (const tgt of myAreas) {
                        if (tgt === srcAreaId) continue;
                        const k = `${tgt}-${net32}-${mask32}`;
                        if (!newSummaries.has(k) || newSummaries.get(k).metric > metric)
                            newSummaries.set(k, { targetAreaId: tgt, lsId: net32, mask32, metric });
                    }
                }
            }
        }

        // Withdraw stale Summary-LSAs
        for (const [mapKey, info] of this._summaryLsaKeys) {
            if (!newSummaries.has(mapKey)) {
                const lsaKey = `${LSA_TYPE_SUMMARY}-${info.lsId}-${this._myRouterId}`;
                const lsdb   = this._lsdbFor(info.targetAreaId);
                const entry  = lsdb.get(lsaKey);
                if (entry) {
                    const hdr = new LsaHeader({ ...entry.header, age: LSA_MAX_AGE });
                    this._floodLSA(new Lsa({ header: hdr, body: entry.body }), -1, info.targetAreaId);
                    if (entry.ageTimer != null) simTimer.cancel(entry.ageTimer);
                    lsdb.delete(lsaKey);
                    this._ownLsaSeq.delete(`${info.targetAreaId}-${lsaKey}`);
                }
            }
        }

        // Originate new/updated Summary-LSAs
        for (const [mapKey, info] of newSummaries) {
            this._originateSummaryLSA(info.targetAreaId, info.lsId, info.mask32, info.metric);
        }

        this._summaryLsaKeys = newSummaries;
    }

    /**
     * @param {number} areaId   target area to originate into
     * @param {number} lsId     network address (u32)
     * @param {number} mask32   network mask (u32)
     * @param {number} metric   cost
     */
    _originateSummaryLSA(areaId, lsId, mask32, metric) {
        if (!this._running) return;
        const lsaKey = `${LSA_TYPE_SUMMARY}-${lsId}-${this._myRouterId}`;
        const seqKey = `${areaId}-${lsaKey}`;
        const lsdb   = this._lsdbFor(areaId);
        const oldSeq = this._ownLsaSeq.get(seqKey) ?? (LSA_INIT_SEQ - 1);
        const seqNum = (oldSeq + 1) >>> 0;
        this._ownLsaSeq.set(seqKey, seqNum);

        const body   = new SummaryLSA({ networkMask: mask32, metric });
        const header = new LsaHeader({
            age: 0, type: LSA_TYPE_SUMMARY,
            lsId, advertisingRouter: this._myRouterId,
            seqNum, length: 20 + body.pack().length,
        });
        const lsa      = new Lsa({ header, body });
        const rawBytes = lsa.pack();

        const existing = lsdb.get(lsaKey);
        if (existing?.ageTimer != null) simTimer.cancel(existing.ageTimer);
        const sumAreaId = areaId;
        const ageTimer  = simTimer.schedule(() => this._expireLsa(lsaKey, sumAreaId), LSA_MAX_AGE * 1000);
        lsdb.set(lsaKey, { header, body, rawBytes, ageTimer });
        this._floodLSA(lsa, -1, areaId);
    }

    /** @param {number} rid @returns {number} */
    _ifIndexForNeighbor(rid) {
        for (const [ifIndex, oif] of this._ifaces) {
            if (oif.neighbors.has(rid)) return ifIndex;
        }
        return -1;
    }

    /** @param {number} rid @returns {OspfNeighbor|null} */
    _neighborByRouterId(rid) {
        for (const [, oif] of this._ifaces) {
            const nb = oif.neighbors.get(rid);
            if (nb) return nb;
        }
        return null;
    }

    // ── Route management ─────────────────────────────────────────────────────

    _removeLearnedRoutes() {
        for (const r of this._installedRoutes) {
            try { this._net.delRoute(r.dst, r.prefix, r.ifIndex, r.nexthop); } catch {}
        }
        this._installedRoutes = [];
    }

    // ── Packet send/receive ──────────────────────────────────────────────────

    /**
     * @param {number} ifIndex
     * @param {IPAddress} dst
     * @param {number} type
     * @param {OspfHello|OspfDBD|OspfLSR|OspfLSU|OspfLSAck} body
     */
    _sendOSPF(ifIndex, dst, type, body) {
        const areaId = this._ifaces.get(ifIndex)?.areaId ?? 0;
        const hdr = new OspfHeader({ type, length: 0, routerId: this._myRouterId, areaId });
        const pkt = new OspfPacket({ header: hdr, body });
        this._net.sendOnInterface(ifIndex, dst, OSPF_PROTO, pkt.pack()).catch(() => {});
    }

    /**
     * Called by IPStack when an IP packet with protocol=89 arrives.
     * @param {import("./pdu/IPv4Packet.js").IPv4Packet} ipPkt
     * @param {number} ifIndex
     */
    _handleOSPF(ipPkt, ifIndex) {
        if (!this._running) return;
        if (!this._ifaces.has(ifIndex)) return;

        // Verify OSPF header checksum (auth bytes 16-23 are always 0 in this implementation)
        if (ospfChecksum(ipPkt.payload) !== 0) return;

        let ospf;
        try { ospf = OspfPacket.fromBytes(ipPkt.payload); } catch { return; }

        if (ospf.header.version !== OSPF_VERSION) return;
        const oifCheck = this._ifaces.get(ifIndex);
        if (!oifCheck || ospf.header.areaId !== oifCheck.areaId) return;  // RFC §10.5
        // Ignore our own packets
        if (ospf.header.routerId === this._myRouterId) return;

        const src = ipPkt.src;
        const hdr = ospf.header;

        switch (hdr.type) {
            case OSPF_TYPE_HELLO: this._handleHello(/** @type {OspfHello} */ (ospf.body), hdr, ifIndex, src); break;
            case OSPF_TYPE_DBD:   this._handleDBD(  /** @type {OspfDBD}   */ (ospf.body), hdr, ifIndex, src); break;
            case OSPF_TYPE_LSR:   this._handleLSR(  /** @type {OspfLSR}   */ (ospf.body), hdr, ifIndex, src); break;
            case OSPF_TYPE_LSU:   this._handleLSU(  /** @type {OspfLSU}   */ (ospf.body), hdr, ifIndex, src); break;
            case OSPF_TYPE_LSACK: this._handleLSAck(/** @type {OspfLSAck} */ (ospf.body), hdr, ifIndex, src); break;
        }
    }

    // ── Router-ID ─────────────────────────────────────────────────────────────

    _computeRouterId() {
        if (this._routerIdOverride !== null) return this._routerIdOverride;
        let best = 0;
        for (const iface of this._net.interfaces) {
            if (!iface.ip?.isV4()) continue;
            const n = ip2n(iface.ip);
            if (n > best) best = n;
        }
        return best;
    }

    // ── Logging ───────────────────────────────────────────────────────────────

    /** @param {string} line */
    _log(line) {
        const now = new Date().toLocaleTimeString();
        this.log.push(`[${now}] ${line}`);
        if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
        this.onLogUpdate?.();
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    toJSON() {
        return {
            enabled:          this.enabled,
            passive:          [...this.passiveInterfaces],
            routerIdOverride: this._routerIdOverride,
            interfaceAreas:   Object.fromEntries(this._ifaceAreaMap),
        };
    }

    /** @param {any} data */
    applyJSON(data) {
        if (!data) return;
        this.enabled           = !!data.enabled;
        this.passiveInterfaces = new Set(Array.isArray(data.passive) ? data.passive : []);
        this._routerIdOverride = typeof data.routerIdOverride === "number" ? data.routerIdOverride : null;
        if (data.interfaceAreas && typeof data.interfaceAreas === "object") {
            for (const [ifName, areaId] of Object.entries(data.interfaceAreas))
                this._ifaceAreaMap.set(ifName, (areaId >>> 0));
        }
        if (this.enabled) this.start();
    }
}
