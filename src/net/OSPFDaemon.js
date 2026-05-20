//@ts-check
// OSPFv2 daemon — RFC 2328 (single area, broadcast network type)

import { simTimer, SimTimer } from "../lib/SimTimer.js";
import { IPAddress } from "./models/IPAddress.js";
import {
    OSPF_PROTO, OSPF_VERSION, OSPF_ALL_SPF, OSPF_ALL_DR,
    OSPF_TYPE_HELLO, OSPF_TYPE_DBD, OSPF_TYPE_LSR, OSPF_TYPE_LSU, OSPF_TYPE_LSACK,
    LSA_TYPE_ROUTER, LSA_TYPE_NETWORK,
    LINK_TYPE_TRANSIT, LINK_TYPE_STUB,
    DBD_FLAG_I, DBD_FLAG_M, DBD_FLAG_MS,
    LSA_INIT_SEQ, LSA_MAX_AGE,
    OspfPacket, OspfHeader, OspfHello, OspfDBD, OspfLSR, OspfLSU, OspfLSAck,
    LsaHeader, RouterLSA, RouterLink, NetworkLSA, Lsa, LsaRequest,
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
 *   ddSeqNum: number,
 *   ddFlags: number,
 *   isMaster: boolean,
 *   pendingLSRs: import("./pdu/OSPFPacket.js").LsaRequest[],
 *   unackedLSUs: Map<string, {lsaBytes: Uint8Array, timerId: number|null}>,
 * }} OspfNeighbor
 *
 * @typedef {{
 *   ifIndex: number,
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
 *   body: RouterLSA|NetworkLSA,
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

        this._running = false;
        /** @type {Map<number, OspfIface>} ifIndex → OspfIface */
        this._ifaces = new Map();
        /** @type {Map<string, LsaEntry>} */
        this._lsdb = new Map();
        /** @type {Array<{dst: IPAddress, prefix: number, ifIndex: number, nexthop: IPAddress}>} */
        this._installedRoutes = [];
        /** @type {number|null} pending SPF timer */
        this._spfTimer = null;
        /** @type {number} own Router-ID (u32, computed at start) */
        this._myRouterId = 0;
        /** @type {number} own area ID (always 0) */
        this._areaId = 0;
        /** @type {Map<string, number>} lsaKey → current seqNum */
        this._ownLsaSeq = new Map();

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
            if (!iface.port?.linkref) continue;
            this._initIface(i);
        }

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
        this._lsdb.clear();
        this._ownLsaSeq.clear();
        if (this._spfTimer != null) { simTimer.cancel(this._spfTimer); this._spfTimer = null; }
        this._removeLearnedRoutes();
        this._log("OSPF stopped");
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

    // ── interface init/teardown ───────────────────────────────────────────────

    /** @param {number} ifIndex */
    _initIface(ifIndex) {
        /** @type {OspfIface} */
        const oif = {
            ifIndex,
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
            areaId:   this._areaId,
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

        const rid = hdr.routerId;
        let nb = oif.neighbors.get(rid);

        if (!nb) {
            nb = {
                routerId: rid, ip: src, ifIndex,
                state: "Down",
                priority: hello.routerPriority,
                dr: hello.dr, bdr: hello.bdr,
                deadTimer: null, rxmtTimer: null,
                ddSeqNum: 0, ddFlags: 0, isMaster: false,
                pendingLSRs: [],
                unackedLSUs: new Map(),
            };
            oif.neighbors.set(rid, nb);
        }

        nb.ip       = src;
        nb.priority = hello.routerPriority;
        nb.dr       = hello.dr;
        nb.bdr      = hello.bdr;

        // Reset dead timer
        if (nb.deadTimer != null) simTimer.cancel(nb.deadTimer);
        nb.deadTimer = simTimer.schedule(() => {
            this._neighborDown(nb, oif);
        }, SimTimer.OSPF_DEAD_MS);

        const prevState = nb.state;

        // Advance FSM: Down → Init
        if (nb.state === "Down") nb.state = "Init";

        // Init → 2-Way: our Router-ID appears in neighbor's Hello
        if (nb.state === "Init" && hello.neighbors.includes(this._myRouterId)) {
            nb.state = "2-Way";
        }

        // DR/BDR field changed → re-elect
        const drChanged = (nb.dr !== hello.dr || nb.bdr !== hello.bdr);
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
            this._originateRouterLSA();
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

    /** @param {number} ifIndex */
    _electDRBDR(ifIndex) {
        const oif = this._ifaces.get(ifIndex);
        if (!oif) return;

        // Collect candidates: all neighbors in 2-Way or above + self
        const iface = this._net.interfaces[ifIndex];
        const selfPri = 1; // own priority

        /** @type {{rid: number, pri: number, dr: number, bdr: number}[]} */
        const candidates = [];
        if (selfPri > 0) candidates.push({ rid: this._myRouterId, pri: selfPri, dr: oif.dr, bdr: oif.bdr });
        for (const [, nb] of oif.neighbors) {
            if (nb.state === "Down" || nb.state === "Init") continue;
            if (nb.priority > 0) candidates.push({ rid: nb.routerId, pri: nb.priority, dr: nb.dr, bdr: nb.bdr });
        }

        if (candidates.length === 0) {
            oif.dr = 0; oif.bdr = 0;
            oif.state = "DR-Other";
            return;
        }

        // Step 1: elect BDR (highest pri among non-self-declared-DR, then highest RID)
        const notDr = candidates.filter(c => c.dr !== c.rid);
        let bdr = 0;
        if (notDr.length > 0) {
            const bdrs = notDr.filter(c => c.bdr === c.rid);
            const pool = bdrs.length > 0 ? bdrs : notDr;
            bdr = pool.reduce((best, c) =>
                c.pri > best.pri || (c.pri === best.pri && c.rid > best.rid) ? c : best
            ).rid;
        }

        // Step 2: elect DR (highest pri among self-declared-DR, else BDR takes over)
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
            this._originateRouterLSA();
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

        if (nb.state === "ExStart") {
            const theyClaimMaster = !!(dbd.flags & DBD_FLAG_MS);
            if ((dbd.flags & DBD_FLAG_I) && theyClaimMaster && nb.routerId > this._myRouterId) {
                // They are master
                nb.isMaster  = false;
                nb.ddSeqNum  = dbd.ddSeqNum;
                nb.state     = "Exchange";
                this._log(`Neighbor ${src} state: ExStart → Exchange (slave)`);
                const myHeaders = [...this._lsdb.values()].map(e => e.header);
                const moreFlag  = 0; // send all at once for simplicity
                this._sendDBD(nb, ifIndex, myHeaders, moreFlag);
            } else if (!(dbd.flags & DBD_FLAG_I) && !theyClaimMaster && iAmMaster &&
                       dbd.ddSeqNum === nb.ddSeqNum) {
                // We are master, they acked our initial
                nb.isMaster = true;
                nb.state    = "Exchange";
                nb.ddSeqNum++;
                this._log(`Neighbor ${src} state: ExStart → Exchange (master)`);
                const myHeaders = [...this._lsdb.values()].map(e => e.header);
                this._sendDBD(nb, ifIndex, myHeaders, DBD_FLAG_MS);
            }
            return;
        }

        if (nb.state === "Exchange") {
            // Process received headers — queue any LSAs we don't have or are older
            for (const rxHdr of dbd.lsaHeaders) {
                const existing = this._lsdb.get(rxHdr.key);
                if (!existing || seqNewer(rxHdr.seqNum, existing.header.seqNum)) {
                    nb.pendingLSRs.push(new LsaRequest({
                        lsType: rxHdr.type,
                        lsId:   rxHdr.lsId,
                        advertisingRouter: rxHdr.advertisingRouter,
                    }));
                }
            }

            const moreFromThem = !!(dbd.flags & DBD_FLAG_M);
            if (!moreFromThem) {
                // Exchange complete on their side
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
        const lsas = [];
        for (const req of lsr.requests) {
            const key   = `${req.lsType}-${req.lsId}-${req.advertisingRouter}`;
            const entry = this._lsdb.get(key);
            if (entry) lsas.push(new Lsa({ header: entry.header, body: entry.body }));
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

        for (const lsa of lsu.lsas) {
            if (lsa.header.type !== LSA_TYPE_ROUTER && lsa.header.type !== LSA_TYPE_NETWORK) continue;

            const key      = lsa.key;
            const existing = this._lsdb.get(key);

            if (existing && !seqNewer(lsa.header.seqNum, existing.header.seqNum)) {
                // Not newer — send ACK but don't install
                ackHeaders.push(lsa.header);
                continue;
            }

            // Install into LSDB
            const rawBytes = lsa.pack();
            if (existing?.ageTimer != null) simTimer.cancel(existing.ageTimer);
            const ageTimer = simTimer.schedule(() => {
                this._lsdb.delete(key);
                this._scheduleSPF();
            }, LSA_MAX_AGE * 1000);

            this._lsdb.set(key, { header: lsa.header, body: lsa.body, rawBytes, ageTimer });
            ackHeaders.push(lsa.header);
            changed = true;

            // Flood to other interfaces (not the incoming one)
            this._floodLSA(lsa, ifIndex);
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
        this._originateRouterLSA();
        const oif = this._ifaces.get(ifIndex);
        if (oif?.state === "DR") this._originateNetworkLSA(ifIndex);
        this._scheduleSPF();
    }

    // ── LSA Origination ───────────────────────────────────────────────────────

    _originateRouterLSA() {
        if (!this._running) return;
        const links = [];

        for (let i = 0; i < this._net.interfaces.length; i++) {
            const iface = this._net.interfaces[i];
            if (!iface.ip?.isV4() || ip2n(iface.ip) === 0) continue;
            const oif = this._ifaces.get(i);
            if (!oif) continue;

            const mask32 = prefixToMask32(iface.prefixLength ?? 0);
            const net32  = (ip2n(iface.ip) & mask32) >>> 0;

            // Full neighbors → transit link (to DR)
            const fullNeighbors = [...(oif.neighbors.values())].filter(nb => nb.state === "Full");
            if (fullNeighbors.length > 0 && oif.dr !== 0) {
                links.push(new RouterLink({
                    linkId:   oif.dr,           // DR's interface address (= network DR's interface IP)
                    linkData: ip2n(iface.ip),   // our own interface address
                    type:     LINK_TYPE_TRANSIT,
                    metric:   10,
                }));
            } else {
                // Stub: no full adjacency on this segment
                links.push(new RouterLink({
                    linkId:   net32,
                    linkData: mask32,
                    type:     LINK_TYPE_STUB,
                    metric:   10,
                }));
            }
        }

        const key    = `${LSA_TYPE_ROUTER}-${this._myRouterId}-${this._myRouterId}`;
        const oldSeq = this._ownLsaSeq.get(key) ?? (LSA_INIT_SEQ - 1);
        const seqNum = (oldSeq + 1) >>> 0;
        this._ownLsaSeq.set(key, seqNum);

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

        if (this._lsdb.get(key)?.ageTimer != null) {
            simTimer.cancel(/** @type {number} */ (this._lsdb.get(key)?.ageTimer));
        }
        const ageTimer = simTimer.schedule(() => {
            this._lsdb.delete(key);
            this._scheduleSPF();
        }, LSA_MAX_AGE * 1000);

        this._lsdb.set(key, { header, body, rawBytes, ageTimer });
        this._floodLSA(lsa, -1);
    }

    /** @param {number} ifIndex */
    _originateNetworkLSA(ifIndex) {
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
        const key    = `${LSA_TYPE_NETWORK}-${lsId}-${this._myRouterId}`;
        const oldSeq = this._ownLsaSeq.get(key) ?? (LSA_INIT_SEQ - 1);
        const seqNum = (oldSeq + 1) >>> 0;
        this._ownLsaSeq.set(key, seqNum);

        const header = new LsaHeader({
            age: 0, type: LSA_TYPE_NETWORK,
            lsId, advertisingRouter: this._myRouterId,
            seqNum, length: 20 + body.pack().length,
        });
        const lsa      = new Lsa({ header, body });
        const rawBytes = lsa.pack();

        if (this._lsdb.get(key)?.ageTimer != null) {
            simTimer.cancel(/** @type {number} */ (this._lsdb.get(key)?.ageTimer));
        }
        const ageTimer = simTimer.schedule(() => { this._lsdb.delete(key); this._scheduleSPF(); }, LSA_MAX_AGE * 1000);
        this._lsdb.set(key, { header, body, rawBytes, ageTimer });
        this._floodLSA(lsa, -1);
    }

    /** @param {number} ifIndex */
    _withdrawNetworkLSA(ifIndex) {
        const iface = this._net.interfaces[ifIndex];
        if (!iface?.ip?.isV4()) return;
        const lsId = ip2n(iface.ip);
        const key  = `${LSA_TYPE_NETWORK}-${lsId}-${this._myRouterId}`;
        const entry = this._lsdb.get(key);
        if (!entry) return;

        // Flood MaxAge LSA to trigger removal everywhere
        const hdr = new LsaHeader({ ...entry.header, age: LSA_MAX_AGE, seqNum: entry.header.seqNum });
        const maxAgeLsa = new Lsa({ header: hdr, body: entry.body });
        this._floodLSA(maxAgeLsa, -1);

        if (entry.ageTimer != null) simTimer.cancel(entry.ageTimer);
        this._lsdb.delete(key);
        this._ownLsaSeq.delete(key);
    }

    // ── Flooding ──────────────────────────────────────────────────────────────

    /**
     * Flood an LSA to all Full neighbors except those on fromIfIndex.
     * @param {Lsa} lsa
     * @param {number} fromIfIndex
     */
    _floodLSA(lsa, fromIfIndex) {
        for (const [ifIndex, oif] of this._ifaces) {
            if (ifIndex === fromIfIndex) continue;
            for (const [, nb] of oif.neighbors) {
                if (nb.state !== "Full") continue;
                const dst = (oif.state === "DR" || oif.state === "BDR")
                    ? IPAddress.fromString(OSPF_ALL_SPF)
                    : nb.ip;
                const lsu = new OspfLSU({ lsas: [lsa] });
                this._sendOSPF(ifIndex, dst, OSPF_TYPE_LSU, lsu);
            }
        }
    }

    // ── SPF ───────────────────────────────────────────────────────────────────

    _scheduleSPF() {
        if (this._spfTimer != null) return;
        this._spfTimer = simTimer.schedule(() => {
            this._spfTimer = null;
            this._runSPF();
        }, SimTimer.OSPF_SPF_DELAY_MS);
    }

    _runSPF() {
        // Dijkstra on the LSDB graph
        // Nodes: Router-IDs and Network-LSA node-IDs (= DR interface IP on that segment)
        // Edge: RouterLSA Transit link → NetworkLSA; NetworkLSA attachedRouter → RouterLSA

        /** @type {Map<number, number>} nodeId → cost */
        const dist = new Map();
        /** @type {Map<number, {prevNode: number, ifIndex: number, nexthop: IPAddress}>} */
        const prev = new Map();
        /** @type {Set<number>} */
        const visited = new Set();

        const myId = this._myRouterId;
        dist.set(myId, 0);

        /** Simple priority queue via sorted array (small graph) */
        const queue = [{ id: myId, cost: 0 }];

        while (queue.length > 0) {
            queue.sort((a, b) => a.cost - b.cost);
            const { id: u, cost: uCost } = queue.shift();
            if (visited.has(u)) continue;
            visited.add(u);

            const routerKey  = `${LSA_TYPE_ROUTER}-${u}-${u}`;
            const networkKey = [...this._lsdb.keys()].find(k => k.startsWith(`${LSA_TYPE_NETWORK}-`) && k.endsWith(`-${u}`));

            const rEntry = this._lsdb.get(routerKey);
            if (rEntry && rEntry.body instanceof RouterLSA) {
                for (const link of rEntry.body.links) {
                    if (link.type === LINK_TYPE_TRANSIT) {
                        // link.linkId = DR's interface IP = NetworkLSA LS-ID
                        const netNodeId = link.linkId;
                        const alt       = uCost + link.metric;
                        if (!dist.has(netNodeId) || alt < (dist.get(netNodeId) ?? Infinity)) {
                            dist.set(netNodeId, alt);
                            prev.set(netNodeId, { prevNode: u, ifIndex: this._ifIndexForNeighbor(u), nexthop: n2ip(0) });
                            queue.push({ id: netNodeId, cost: alt });
                        }
                    }
                }
            }

            // From a Network-LSA node, expand to attached routers
            const netEntry = [...this._lsdb.values()].find(
                e => e.header.type === LSA_TYPE_NETWORK && e.header.lsId === u
            );
            if (netEntry && netEntry.body instanceof NetworkLSA) {
                for (const attRouter of netEntry.body.attachedRouters) {
                    if (attRouter === myId) continue;
                    const alt = uCost; // no cost from network node to router
                    if (!dist.has(attRouter) || alt < (dist.get(attRouter) ?? Infinity)) {
                        dist.set(attRouter, alt);
                        const parentEntry = prev.get(u);
                        prev.set(attRouter, {
                            prevNode: u,
                            ifIndex:  parentEntry?.ifIndex ?? -1,
                            nexthop:  n2ip(0),
                        });
                        queue.push({ id: attRouter, cost: alt });
                    }
                }
            }
        }

        // Resolve nexthops and collect routes
        /** @type {{dst: IPAddress, prefix: number, ifIndex: number, nexthop: IPAddress}[]} */
        const newRoutes = [];

        for (const [, entry] of this._lsdb) {
            if (entry.header.type !== LSA_TYPE_ROUTER) continue;
            if (!(entry.body instanceof RouterLSA)) continue;
            const rid = entry.header.advertisingRouter;
            if (rid === myId) continue;

            for (const link of entry.body.links) {
                if (link.type !== LINK_TYPE_STUB) continue;
                const prefix  = mask32ToPrefix(link.linkData);
                const net32   = (link.linkId & link.linkData) >>> 0;
                const routerDist = dist.get(rid);
                if (routerDist === undefined) continue;

                const { ifIndex, nexthop } = this._resolveNexthop(rid, prev, dist) ?? { ifIndex: -1, nexthop: n2ip(0) };
                if (ifIndex < 0) continue;

                newRoutes.push({ dst: n2ip(net32), prefix, ifIndex, nexthop });
            }
        }

        this._removeLearnedRoutes();
        for (const r of newRoutes) {
            try { this._net.addRoute(r.dst, r.prefix, r.ifIndex, r.nexthop); } catch {}
        }
        this._installedRoutes = newRoutes;
        this._log(`SPF: ${newRoutes.length} routes installed`);
    }

    /**
     * Walk prev-map back to find the first-hop (ifIndex + nexthop IP) from myId.
     * @param {number} target
     * @param {Map<number, {prevNode: number, ifIndex: number, nexthop: IPAddress}>} prev
     * @param {Map<number, number>} dist
     * @returns {{ifIndex: number, nexthop: IPAddress}|null}
     */
    _resolveNexthop(target, prev, dist) {
        const myId = this._myRouterId;
        let node = target;
        let hops = 0;
        while (node !== myId && hops < 64) {
            const p = prev.get(node);
            if (!p) return null;
            if (p.prevNode === myId) {
                // Direct first hop — find neighbor IP
                const ifIndex = this._ifIndexForNeighbor(node);
                const nb      = this._neighborByRouterId(node);
                return { ifIndex: ifIndex >= 0 ? ifIndex : (p.ifIndex >= 0 ? p.ifIndex : 0), nexthop: nb?.ip ?? n2ip(0) };
            }
            node = p.prevNode;
            hops++;
        }
        return null;
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
        const hdr = new OspfHeader({ type, length: 0, routerId: this._myRouterId, areaId: this._areaId });
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

        let ospf;
        try { ospf = OspfPacket.fromBytes(ipPkt.payload); } catch { return; }

        if (ospf.header.version !== OSPF_VERSION) return;
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
        };
    }

    /** @param {any} data */
    applyJSON(data) {
        if (!data) return;
        this.enabled           = !!data.enabled;
        this.passiveInterfaces = new Set(Array.isArray(data.passive) ? data.passive : []);
        this._routerIdOverride = typeof data.routerIdOverride === "number" ? data.routerIdOverride : null;
        if (this.enabled) this.start();
    }
}
