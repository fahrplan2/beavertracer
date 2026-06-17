//@ts-check

import { isEqualUint8, MACToNumber } from "../lib/helpers.js";
import { IPAddress } from "./models/IPAddress.js";
import { EthernetPort } from "./EthernetPort.js";
import { Observable } from "../lib/Observeable.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { STPBPDU, RSTP_FLAG_TC, RSTP_FLAG_PROPOSAL, RSTP_FLAG_LEARNING, RSTP_FLAG_FORWARDING, RSTP_FLAG_AGREEMENT, RSTP_PORT_ROLE } from "../net/pdu/STPBPDU.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";

/** IEEE 802.1D / 802.1w port states. */
export const STP_STATE = Object.freeze({
    DISABLED:    "disabled",
    BLOCKING:    "blocking",
    LISTENING:   "listening",
    LEARNING:    "learning",
    FORWARDING:  "forwarding",
    DISCARDING:  "discarding", // RSTP (802.1w): replaces Blocking+Listening
});

/**
 * STP (classic-ish) in this simulator is encoded as IEEE 802.3 + LLC (not EtherType).
 * Destination MAC is the standard STP multicast.
 *
 * LLC for STP: DSAP=0x42, SSAP=0x42, CTRL=0x03
 */
const STP_DEST_MAC = new Uint8Array([0x01, 0x80, 0xc2, 0x00, 0x00, 0x00]);
const STP_LLC = new Uint8Array([0x42, 0x42, 0x03]); // DSAP/SSAP/UI

/** IEEE 802.1D flags byte bits (classic STP Config BPDU) */
const STP_FLAG_TC  = 0x80; // Topology Change
const STP_FLAG_TCA = 0x01; // Topology Change Acknowledgment

/**
 * Compare STP tuples (lower is better):
 * (rootId, cost, senderBridgeId, senderPortId)
 * @param {{rootId: bigint, cost: number, bridgeId: bigint, portId: number}} a
 * @param {{rootId: bigint, cost: number, bridgeId: bigint, portId: number}} b
 * @returns {-1|0|1}
 */
function compareTuple(a, b) {
    if (a.rootId !== b.rootId) return a.rootId < b.rootId ? -1 : 1;
    if (a.cost !== b.cost) return a.cost < b.cost ? -1 : 1;
    if (a.bridgeId !== b.bridgeId) return a.bridgeId < b.bridgeId ? -1 : 1;
    if (a.portId !== b.portId) return a.portId < b.portId ? -1 : 1;
    return 0;
}

/**
 * Turn a bigint into a locally-administered unicast MAC (low 48 bits).
 * @param {bigint} b
 * @returns {Uint8Array}
 */
function bigintToMac(b) {
    const mac = new Uint8Array(6);
    let x = b & ((1n << 48n) - 1n);
    for (let i = 5; i >= 0; i--) {
        mac[i] = Number(x & 0xffn);
        x >>= 8n;
    }
    // unicast + locally administered
    mac[0] = (mac[0] & 0xfe) | 0x02;
    return mac;
}

function randomBridgeId() {
    let r = 0xAAn;
    for (let i = 1; i < 6; i++) r = (r << 8n) | BigInt(Math.floor(Math.random() * 256));
    return r;
}

export class SwitchBackplane extends Observable {
    /** @type {Array<EthernetPort>} */
    ports = [];

    // -------------------- Feature flags --------------------
    vlanEnabled = false;

    // -------------------- IGMP Snooping --------------------
    igmpSnoopingEnabled = false;

    /**
     * Multicast membership table built by IGMP snooping.
     * Key: MACToNumber of the multicast MAC, Value: { ip, ports }
     * @type {Map<bigint, {ip: string, ports: Set<number>}>}
     */
    mcastTable = new Map();

    /**
     * STP/RSTP operating mode.
     * 'off'  – no spanning tree
     * 'stp'  – IEEE 802.1D classic STP
     * 'rstp' – IEEE 802.1w Rapid STP
     * @type {'off'|'stp'|'rstp'}
     */
    stpMode = 'off';

    /** True whenever any spanning-tree mode is active. */
    get stpEnabled() { return this.stpMode !== 'off'; }

    // -------------------- LAG --------------------
    /**
     * @type {Array<{id: number, name: string, mode: 'static'|'lacp', members: number[]}>}
     */
    lagGroups = [];

    /** portIdx → lag group id, -1 if none. @type {number[]} */
    portLagId = [];

    _nextLagId = 0;

    /**
     * VLAN disabled:
     *   Map<bigint, number>
     *
     * VLAN enabled:
     *   Map<number, Map<bigint, number>>
     *
     * @type {any}
     */
    sat = new Map();

    // -------------------- STP identity --------------------
    /** @type {bigint} */
    bridgeId;

    /** @type {Uint8Array} */
    stpBridgeIdBytes;

    /** @type {bigint} */
    stpBridgeIdVal;

    /** @type {number} Bridge priority (multiple of 4096, 0–61440, default 32768) */
    _stpBridgePriority = 32768;

    // -------------------- STP state --------------------
    /** @type {bigint} root bridge id (as bigint of 8-byte bridge-id) */
    stpRootId;

    /** @type {number} */
    stpRootCost = 0;

    /** @type {number|null} */
    stpRootPort = null;

    /**
     * Best STP info received on each port (from neighbor).
     * messageAge is stored so non-root bridges can increment it when forwarding.
     * @type {Array<{rootId: bigint, cost: number, bridgeId: bigint, portId: number, messageAge: number} | null>}
     */
    stpRxBest = [];

    /**
     * IEEE 802.1D port state per port (STP_STATE values).
     * When STP feature is disabled, all ports are in FORWARDING.
     * @type {Array<string>}
     */
    stpPortState = [];

    /**
     * IEEE 802.1D port role per port: 'root' | 'designated' | 'nondesignated'.
     * Only designated ports send Config BPDUs.
     * @type {Array<string>}
     */
    stpPortRole = [];

    /** Pending ForwardDelay timer ID per port (null = no timer). @type {Array<number|null>} */
    _stpPortTimers = [];

    /** simTimer.currentTick when stpRxBest[i] was last updated. @type {Array<number>} */
    _stpRxBestTick = [];

    /** Periodic Hello timer ID. @type {number|null} */
    _stpHelloTimer = null;

    /** @type {string} */
    _stpLastSnapshot = "";

    /** @type {Array<boolean>} */
    stpPortLinkedLast = [];

    /** Force emitting HELLO BPDUs once, even if snapshot did not change */
    _stpForceEmit = false;

    // -------------------- TC / TCN state --------------------
    /** messageAge from the last BPDU received on the root port (0 when we are root) */
    _stpRootPortMessageAge = 0;

    /** TC bit active — set in all Config BPDUs for maxAge + forwardDelay after a topology change */
    _stpTcActive = false;

    /** @type {number|null} */
    _stpTcTimer = null;

    /** TCN BPDUs pending to be sent on the root port until TCA is received */
    _stpTcnPending = false;

    /** @type {number|null} */
    _stpTcnTimer = null;

    /** Per-port: include TCA bit in the next Config BPDU (after receiving a TCN). @type {Array<boolean>} */
    _stpTcaOnPort = [];

    // -------------------- RSTP per-port state --------------------
    /** Count of consecutive Hello intervals without a received BPDU (fast aging). @type {Array<number>} */
    _rstpMissedHellos = [];

    /** True while this Designated port is sending Proposal and awaiting Agreement. @type {Array<boolean>} */
    _rstpProposing = [];

    /**
     * Backward-compat getter: true when port is in FORWARDING state.
     * @returns {Array<boolean>}
     */
    get stpForwarding() {
        return this.stpPortState.map(s => s === STP_STATE.FORWARDING);
    }

    /**
     * @param {number} numberOfPorts
     */
    constructor(numberOfPorts) {
        super();

        this.bridgeId = randomBridgeId();

        // STP identity (priority + MAC)
        this.stpBridgeIdBytes = this._makeBridgeId(this._stpBridgePriority);
        this.stpBridgeIdVal = this._bridgeIdBytesToBigInt(this.stpBridgeIdBytes);

        // root starts as self
        this.stpRootId = this.stpBridgeIdVal;

        // Create ports FIRST (addPort pushes to all arrays)
        for (let i = 0; i < numberOfPorts; i++) {
            this.addPort(new EthernetPort("" + i));
        }

        // Default: STP disabled => all forwarding, all designated
        this.stpPortState      = this.ports.map(() => STP_STATE.FORWARDING);
        this.stpPortRole       = this.ports.map(() => "designated");
        this._stpPortTimers    = this.ports.map(/** @returns {null} */ () => null);
        this._stpRxBestTick    = this.ports.map(() => 0);
        this.stpRxBest         = this.ports.map(/** @returns {null} */ () => null);
        this._stpTcaOnPort     = this.ports.map(() => false);
        this._rstpMissedHellos = this.ports.map(() => 0);
        this._rstpProposing    = this.ports.map(() => false);
        this.stpPortLinkedLast = this.ports.map(p => p.isLinked());
    }

    // ---------------------------------------------------------------------------
    // Feature toggles
    // ---------------------------------------------------------------------------

    enableVLANFeature() {
        this.vlanEnabled = true;
        this.sat.clear();
    }

    disableVLANFeature() {
        this.vlanEnabled = false;
        this.sat.clear();
    }

    enableIGMPSnooping() {
        this.igmpSnoopingEnabled = true;
    }

    disableIGMPSnooping() {
        this.igmpSnoopingEnabled = false;
        this.mcastTable.clear();
    }

    enableSTPFeature() {
        this.stpMode = 'stp';
        this._stpStartHello();

        this._initStpArrays();
        this._resetStpToSelfRoot();

        this.stpPortLinkedLast = this.ports.map(p => p.isLinked());

        this._stpForceEmit = true;
        this._recomputeStpAndMaybeEmit();
    }

    enableRSTPFeature() {
        this.stpMode = 'rstp';
        this._stpStartHello();

        this._initStpArrays();
        this._initRstpArrays();
        this._resetStpToSelfRoot();

        this.stpPortLinkedLast = this.ports.map(p => p.isLinked());

        this._stpForceEmit = true;
        this._recomputeRstpAndMaybeEmit();
    }

    disableSTPFeature() {
        this.stpMode = 'off';
        this._stpStopHello();
        this._stpStopTc();
        this._stpStopTcn();

        // Cancel all per-port ForwardDelay timers
        for (let i = 0; i < this._stpPortTimers.length; i++) {
            if (this._stpPortTimers[i] != null) {
                simTimer.cancel(/** @type {number} */ (this._stpPortTimers[i]));
                this._stpPortTimers[i] = null;
            }
        }

        this.stpRxBest         = this.ports.map(/** @returns {null} */ () => null);
        this.stpPortState      = this.ports.map(() => STP_STATE.FORWARDING);
        this.stpPortRole       = this.ports.map(() => "designated");
        this._stpTcaOnPort     = this.ports.map(() => false);
        this._rstpMissedHellos = this.ports.map(() => 0);
        this._rstpProposing    = this.ports.map(() => false);

        // root resets to self
        this.stpRootId   = this.stpBridgeIdVal;
        this.stpRootCost = 0;
        this.stpRootPort = null;
        this._stpRootPortMessageAge = 0;

        this._stpLastSnapshot = "";
        this._stpForceEmit = false;
    }

    /**
     * Optional: deterministic override for experiments.
     * Note: this changes the Ethernet source MAC derived from bridgeId,
     * so we also rebuild STP bridge identity.
     *
     * @param {bigint} id
     */
    setBridgeId(id) {
        this.bridgeId = id;

        // rebuild STP identity to match new MAC
        this.stpBridgeIdBytes = this._makeBridgeId(this._stpBridgePriority);
        this.stpBridgeIdVal = this._bridgeIdBytesToBigInt(this.stpBridgeIdBytes);

        this._recomputeAfterIdentityChange();
    }

    /**
     * Set STP bridge priority. Must be a multiple of 4096 (0–61440, default 32768).
     * Lower value = higher priority = more likely to become root bridge.
     *
     * @param {number} priority
     */
    setBridgePriority(priority) {
        const p = priority & 0xffff;
        if (p % 4096 !== 0 || p > 61440) {
            throw new Error("Bridge priority must be a multiple of 4096 (0–61440)");
        }
        this._stpBridgePriority = p;
        this.stpBridgeIdBytes = this._makeBridgeId(p);
        this.stpBridgeIdVal = this._bridgeIdBytesToBigInt(this.stpBridgeIdBytes);

        this._recomputeAfterIdentityChange();
    }

    _recomputeAfterIdentityChange() {
        if (this.stpMode === 'rstp') {
            this._resetStpToSelfRoot();
            this._stpForceEmit = true;
            this._recomputeRstpAndMaybeEmit();
        } else if (this.stpMode === 'stp') {
            this._resetStpToSelfRoot();
            this._stpForceEmit = true;
            this._recomputeStpAndMaybeEmit();
        } else {
            this.stpRootId = this.stpBridgeIdVal;
        }
    }

    // ---------------------------------------------------------------------------
    // Ports
    // ---------------------------------------------------------------------------

    /**
     * @param {EthernetPort} port
     */
    addPort(port) {
        this.ports.push(port);
        port.subscribe(this);

        this.portLagId.push(-1);

        // keep STP/RSTP arrays in sync
        this.stpRxBest.push(null);
        this.stpPortState.push(this.stpEnabled ? (this.stpMode === 'rstp' ? STP_STATE.DISCARDING : STP_STATE.BLOCKING) : STP_STATE.FORWARDING);
        this.stpPortRole.push(this.stpEnabled ? (this.stpMode === 'rstp' ? "alternate" : "nondesignated") : "designated");
        this._stpPortTimers.push(null);
        this._stpRxBestTick.push(0);
        this._stpTcaOnPort.push(false);
        this._rstpMissedHellos.push(0);
        this._rstpProposing.push(false);
        this.stpPortLinkedLast.push(port.isLinked());
    }

    /**
     * @param {number} index
     */
    getPort(index) {
        return this.ports[index];
    }

    /**
     * gives a free Port from this device
     * @returns {EthernetPort|null}
     */
    getNextFreePort() {
        for (let i = 0; i < this.ports.length; i++) {
            if (this.ports[i].linkref == null) return this.ports[i];
        }
        return null;
    }

    // ---------------------------------------------------------------------------
    // LAG helpers
    // ---------------------------------------------------------------------------

    /** @param {'static'|'lacp'} [mode] */
    createLagGroup(mode = 'static') {
        const id = this._nextLagId++;
        const group = { id, name: `bond${id}`, mode, members: [] };
        this.lagGroups.push(group);
        return group;
    }

    /** @param {number} id */
    deleteLagGroup(id) {
        const idx = this.lagGroups.findIndex(g => g.id === id);
        if (idx < 0) return;
        for (const m of this.lagGroups[idx].members) this.portLagId[m] = -1;
        this.lagGroups.splice(idx, 1);
        this.sat.clear();
    }

    /** @param {number} portIdx @param {number} groupId */
    addPortToLag(portIdx, groupId) {
        this.removePortFromLag(portIdx);
        const group = this.lagGroups.find(g => g.id === groupId);
        if (!group) return;
        group.members.push(portIdx);
        group.members.sort((a, b) => a - b);
        this.portLagId[portIdx] = groupId;
        this.sat.clear();
    }

    /** @param {number} portIdx */
    removePortFromLag(portIdx) {
        const gid = this.portLagId[portIdx];
        if (gid < 0) return;
        const g = this.lagGroups.find(g => g.id === gid);
        if (g) g.members = g.members.filter(m => m !== portIdx);
        this.portLagId[portIdx] = -1;
        this.sat.clear();
    }

    /** @param {number} portIdx */
    _lagRepresentative(portIdx) {
        const gid = this.portLagId[portIdx] ?? -1;
        if (gid < 0) return portIdx;
        const g = this.lagGroups.find(g => g.id === gid);
        return (g && g.members.length) ? g.members[0] : portIdx;
    }

    /** @param {number} groupId @param {EthernetFrame} frame */
    _lagEgressMember(groupId, frame) {
        const g = this.lagGroups.find(g => g.id === groupId);
        if (!g) return null;
        const active = g.members.filter(idx => this.ports[idx]?.isLinked());
        if (!active.length) return null;
        const hash = (frame.srcMac[4] ^ frame.srcMac[5] ^ frame.dstMac[4] ^ frame.dstMac[5]) & 0xff;
        return active[hash % active.length];
    }

    /**
     * Returns true if this port should be used as an egress port for a frame
     * that arrived on ingressPortIdx. For LAG members, only one member per group
     * is elected per frame.
     * @param {number} portIdx
     * @param {number} ingressPortIdx
     * @param {EthernetFrame} frame
     */
    _lagShouldEgress(portIdx, ingressPortIdx, frame) {
        const gid = this.portLagId[portIdx] ?? -1;
        if (gid < 0) return true;
        if ((this.portLagId[ingressPortIdx] ?? -1) === gid) return false;
        return this._lagEgressMember(gid, frame) === portIdx;
    }

    /**
     * Resolves actual egress port: if portIdx is a LAG representative, picks
     * an active member for this frame; otherwise returns portIdx unchanged.
     * @param {number} portIdx
     * @param {EthernetFrame} frame
     */
    _lagResolveEgress(portIdx, frame) {
        const gid = this.portLagId[portIdx] ?? -1;
        if (gid < 0) return portIdx;
        return this._lagEgressMember(gid, frame) ?? portIdx;
    }

    // ---------------------------------------------------------------------------
    // STP + LAG integration helpers
    // ---------------------------------------------------------------------------

    /**
     * True if this port is a "logical STP port": not in a LAG, or the LAG representative.
     * Non-representative LAG members are invisible to STP; they inherit the rep's state.
     * @param {number} i
     */
    _stpIsLogicalPort(i) {
        const gid = this.portLagId[i] ?? -1;
        return gid < 0 || this._lagRepresentative(i) === i;
    }

    /**
     * True if the logical port (or its LAG group) has at least one linked physical port.
     * @param {number} i  logical port index (representative or non-LAG)
     */
    _stpIsLinked(i) {
        const gid = this.portLagId[i] ?? -1;
        if (gid < 0) return this.ports[i].isLinked();
        const g = this.lagGroups.find(g => g.id === gid);
        return g ? g.members.some(m => this.ports[m]?.isLinked()) : this.ports[i].isLinked();
    }

    /**
     * Copy the STP state and role of each LAG representative to its non-representative members.
     * Cancels any stale timers on members so they don't override the synced state.
     */
    _lagSyncStpStates() {
        for (const group of this.lagGroups) {
            if (group.members.length < 2) continue;
            const rep = group.members[0];
            for (let mi = 1; mi < group.members.length; mi++) {
                const m = group.members[mi];
                if (this._stpPortTimers[m] != null) {
                    simTimer.cancel(/** @type {number} */ (this._stpPortTimers[m]));
                    this._stpPortTimers[m] = null;
                }
                this.stpPortState[m] = this.stpPortState[rep];
                this.stpPortRole[m]  = this.stpPortRole[rep];
            }
        }
    }

    // ---------------------------------------------------------------------------
    // VLAN helpers
    // ---------------------------------------------------------------------------

    /**
     * Clone frame so tagging/untagging on egress can't mutate a shared object.
     * @param {EthernetFrame} frame
     * @returns {EthernetFrame}
     */
    cloneFrame(frame) {
        const f = new EthernetFrame({
            dstMac: frame.dstMac.slice(),
            srcMac: frame.srcMac.slice(),
            etherType: frame.etherType,
            payload: frame.payload.slice(),
        });
        f.vlan  = frame.vlan  ? { ...frame.vlan  } : null;
        f.svlan = frame.svlan ? { ...frame.svlan } : null;

        // Preserve 802.3 vs Ethernet-II format
        f.useLengthField = !!frame.useLengthField;
        f.length = frame.length ?? 0;

        return f;
    }

    /**
     * Ingress VLAN policy (per your spec):
     * - tagged: untagged ingress maps to pvid; tagged ingress must be allowed
     * - untagged: tagged ingress is dropped; untagged ingress maps to pvid
     *
     * @param {EthernetPort} port
     * @param {EthernetFrame} frame
     * @returns {number|null} VLAN ID, or null to drop
     */
    getIngressVid(port, frame) {
        // QinQ port: outer S-VID determines the VLAN; C-tag (frame.vlan) is opaque
        if (port.svid !== null) {
            return port.svid;
        }

        if (port.vlanMode === "untagged") {
            if (frame.vlan != null) return null; // drop
            return port.pvid;
        }

        if (port.vlanMode === "hybrid") {
            if (frame.vlan == null) return port.pvid;
            const vid = frame.vlan.vid;
            if (vid === port.pvid || port.allowedVlans.has(vid)) return vid;
            return null;
        }

        // tagged port
        if (frame.vlan == null) return port.pvid;

        const vid = frame.vlan.vid;
        if (!port.allowedVlans.has(vid)) return null;
        return vid;
    }

    /**
     * @param {EthernetPort} port
     * @param {number} vid
     * @returns {boolean}
     */
    portAllowsVid(port, vid) {
        if (port.svid !== null) return vid === port.svid;
        if (port.vlanMode === "untagged") return vid === port.pvid;
        if (port.vlanMode === "hybrid") return vid === port.pvid || port.allowedVlans.has(vid);
        return port.allowedVlans.has(vid);
    }

    /**
     * Send out of a port applying tagging/untagging rules.
     * @param {number} vid
     * @param {EthernetPort} outPort
     * @param {EthernetFrame} inFrame
     */
    sendOut(vid, outPort, inFrame) {
        // QinQ egress: pop outer S-tag, deliver with C-tag (or untagged) intact
        if (outPort.svid !== null) {
            if (vid !== outPort.svid) return;
            const f = this.cloneFrame(inFrame);
            f.svlan = null;
            outPort.send(f);
            return;
        }

        if (outPort.vlanMode === "untagged") {
            if (vid !== outPort.pvid) return;
            const f = this.cloneFrame(inFrame);
            f.vlan = null; // strip
            outPort.send(f);
            return;
        }

        if (outPort.vlanMode === "hybrid") {
            if (vid !== outPort.pvid && !outPort.allowedVlans.has(vid)) return;
            const f = this.cloneFrame(inFrame);
            f.vlan = vid === outPort.pvid ? null : { vid };
            outPort.send(f);
            return;
        }

        if (!outPort.allowedVlans.has(vid)) return;
        const f = this.cloneFrame(inFrame);
        f.vlan = { vid }; // ensure tagged
        outPort.send(f);
    }

    // ---------------------------------------------------------------------------
    // IGMP Snooping helpers
    // ---------------------------------------------------------------------------

    /** @param {Uint8Array} mac */
    _isIPv4MulticastMac(mac) {
        return mac[0] === 0x01 && mac[1] === 0x00 && mac[2] === 0x5e;
    }

    /** @param {Uint8Array} mac */
    _isIPv6MulticastMac(mac) {
        return mac[0] === 0x33 && mac[1] === 0x33;
    }

    /**
     * Parse IGMP from frame payload. Updates mcastTable on Report/Leave.
     * Returns the IGMP type byte (0x11/0x16/0x17), or -1 if not an IGMP frame.
     * @param {number} portIdx
     * @param {EthernetFrame} frame
     * @returns {number}
     */
    _processIGMP(portIdx, frame) {
        if (frame.etherType !== 0x0800) return -1;
        const ip = frame.payload;
        if (!ip || ip.length < 24) return -1;
        const ihl = (ip[0] & 0x0f) * 4;
        if (ip[9] !== 2) return -1; // IP protocol ≠ IGMP
        if (ip.length < ihl + 8) return -1;

        const igmpType = ip[ihl];
        const g = ip.slice(ihl + 4, ihl + 8); // group address bytes
        const groupMac = new Uint8Array([0x01, 0x00, 0x5e, g[1] & 0x7f, g[2], g[3]]);
        const groupKey = MACToNumber(groupMac);
        const groupIp = `${g[0]}.${g[1]}.${g[2]}.${g[3]}`;

        if (igmpType === 0x16) { // Membership Report v2
            if (!this.mcastTable.has(groupKey)) this.mcastTable.set(groupKey, { ip: groupIp, ports: new Set() });
            /** @type {{ip:string,ports:Set<number>}} */ (this.mcastTable.get(groupKey)).ports.add(portIdx);
        } else if (igmpType === 0x17) { // Leave Group
            const entry = this.mcastTable.get(groupKey);
            if (entry) {
                entry.ports.delete(portIdx);
                if (entry.ports.size === 0) this.mcastTable.delete(groupKey);
            }
        }
        return igmpType;
    }

    /**
     * Parse MLD from frame payload (ICMPv6 types 130/131/132). Updates mcastTable on Report/Done.
     * Returns the MLD type byte (0x82/0x83/0x84), or -1 if not an MLD frame.
     * @param {number} portIdx
     * @param {EthernetFrame} frame
     * @returns {number}
     */
    _processMLD(portIdx, frame) {
        if (frame.etherType !== 0x86DD) return -1;
        const ip6 = frame.payload;
        if (!ip6 || ip6.length < 64) return -1; // 40-byte IPv6 hdr + 24-byte MLD
        if (ip6[6] !== 58) return -1; // nextHeader ≠ ICMPv6
        const mldType = ip6[40]; // ICMPv6 type
        if (mldType !== 0x82 && mldType !== 0x83 && mldType !== 0x84) return -1;

        const g = ip6.slice(48, 64); // multicast group address (16 bytes, at ICMPv6 byte 8)
        const groupMac = new Uint8Array([0x33, 0x33, g[12], g[13], g[14], g[15]]);
        const groupKey = MACToNumber(groupMac);
        const groupIp = IPAddress.fromUInt8(g).toString();

        if (mldType === 0x83) { // Multicast Listener Report (join)
            if (!this.mcastTable.has(groupKey)) this.mcastTable.set(groupKey, { ip: groupIp, ports: new Set() });
            /** @type {{ip:string,ports:Set<number>}} */ (this.mcastTable.get(groupKey)).ports.add(portIdx);
        } else if (mldType === 0x84) { // Multicast Listener Done (leave)
            const entry = this.mcastTable.get(groupKey);
            if (entry) {
                entry.ports.delete(portIdx);
                if (entry.ports.size === 0) this.mcastTable.delete(groupKey);
            }
        }
        return mldType;
    }

    // ---------------------------------------------------------------------------
    // STP helpers
    // ---------------------------------------------------------------------------

    /**
     * Build an 8-byte STP Bridge ID: [priority(2 bytes), mac(6 bytes)].
     * @param {number} [priority]
     * @returns {Uint8Array}
     */
    _makeBridgeId(priority = this._stpBridgePriority) {
        const mac = bigintToMac(this.bridgeId); // 6 bytes
        const out = new Uint8Array(8);
        const pr = priority & 0xffff;
        out[0] = (pr >> 8) & 0xff;
        out[1] = pr & 0xff;
        out.set(mac, 2);
        return out;
    }

    _initStpArrays() {
        this.stpRxBest      = this.ports.map(/** @returns {null} */ () => null);
        this.stpPortState   = this.ports.map(() => STP_STATE.BLOCKING);
        this.stpPortRole    = this.ports.map(() => "nondesignated");
        this._stpPortTimers = this.ports.map(/** @returns {null} */ () => null);
        this._stpRxBestTick = this.ports.map(() => 0);
        this._stpTcaOnPort  = this.ports.map(() => false);
    }

    _initRstpArrays() {
        this.stpPortState      = this.ports.map(() => STP_STATE.DISCARDING);
        this.stpPortRole       = this.ports.map(() => "alternate");
        this._rstpMissedHellos = this.ports.map(() => 0);
        this._rstpProposing    = this.ports.map(() => false);
    }

    _resetStpToSelfRoot() {
        this.stpRootId   = this.stpBridgeIdVal;
        this.stpRootCost = 0;
        this.stpRootPort = null;
        this._stpRootPortMessageAge = 0;
        this.stpRxBest    = this.ports.map(/** @returns {null} */ () => null);
        this.stpPortState = this.ports.map(() => STP_STATE.BLOCKING);
        this.stpPortRole  = this.ports.map(() => "nondesignated");
        // Cancel any pending port timers
        for (let i = 0; i < this._stpPortTimers.length; i++) {
            if (this._stpPortTimers[i] != null) {
                simTimer.cancel(/** @type {number} */ (this._stpPortTimers[i]));
                this._stpPortTimers[i] = null;
            }
        }
        this._stpStopTc();
        this._stpStopTcn();
    }

    /**
     * Snapshot for "emit BPDU on state change"
     * @returns {string}
     */
    _stpSnapshot() {
        const states = this.stpPortState.map(s => s[0]).join("");
        return `${this.stpRootId.toString(16)}|${this.stpRootCost}|${this.stpRootPort ?? -1}|${states}`;
    }

    /**
     * STP BPDU detection: 802.3+LLC frame with STP multicast and LLC header (0x42 0x42 0x03).
     * @param {EthernetFrame} frame
     * @returns {boolean}
     */
    _isBpdu(frame) {
        if (!frame.useLengthField) return false;
        if (!isEqualUint8(frame.dstMac, STP_DEST_MAC)) return false;
        if (!(frame.payload instanceof Uint8Array) || frame.payload.length < 3) return false;
        return frame.payload[0] === 0x42 && frame.payload[1] === 0x42 && frame.payload[2] === 0x03;
    }

    /**
     * Bridge Group Address range 01:80:c2:00:00:00–0f (IEEE 802.1D §7.12.6).
     * These frames must be terminated at the bridge and never forwarded.
     * @param {EthernetFrame} frame
     * @returns {boolean}
     */
    _isBridgeGroupAddress(frame) {
        const m = frame.dstMac;
        return m[0] === 0x01 && m[1] === 0x80 && m[2] === 0xc2 &&
               m[3] === 0x00 && m[4] === 0x00 && m[5] <= 0x0f;
    }

    /**
     * Convert 8-byte bridge ID into bigint for comparisons.
     * @param {Uint8Array} id8
     * @returns {bigint}
     */
    _bridgeIdBytesToBigInt(id8) {
        let x = 0n;
        for (let i = 0; i < 8; i++) x = (x << 8n) | BigInt(id8[i]);
        return x;
    }

    /**
     * @param {bigint} x
     * @returns {Uint8Array}
     */
    _bigIntTo8Bytes(x) {
        const out = new Uint8Array(8);
        let v = x & ((1n << 64n) - 1n);
        for (let i = 7; i >= 0; i--) {
            out[i] = Number(v & 0xffn);
            v >>= 8n;
        }
        return out;
    }

    /**
     * Create full LLC+BPDU payload for a Configuration BPDU.
     * @param {Uint8Array} rootId 8 bytes
     * @param {number} cost
     * @param {Uint8Array} bridgeId 8 bytes
     * @param {number} portId
     * @param {number} [messageAge] in 1/256 s ticks (0 for root bridge)
     * @param {number} [flags] TC/TCA bits
     * @returns {Uint8Array}
     */
    _packConfigBpduPayload(rootId, cost, bridgeId, portId, messageAge = 0, flags = 0) {
        const bpdu = new STPBPDU({
            protocolId: 0x0000,
            protocolVersion: 0,
            bpduType: 0x00, // Configuration BPDU
            flags: flags & 0xff,

            rootId,
            rootPathCost: cost >>> 0,
            bridgeId,
            portId: portId & 0xffff,

            messageAge: messageAge & 0xffff,
            maxAge: 20 * 256,
            helloTime: 2 * 256,
            forwardDelay: 15 * 256,
        });

        const bpduBytes = bpdu.pack();

        const out = new Uint8Array(STP_LLC.length + bpduBytes.length);
        out.set(STP_LLC, 0);
        out.set(bpduBytes, STP_LLC.length);
        return out;
    }

    /**
     * Parse LLC+BPDU payload.
     * @param {Uint8Array} payload
     * @returns {STPBPDU|null}
     */
    _unpackBpdu(payload) {
        if (!(payload instanceof Uint8Array)) return null;
        if (payload.length < 3 + 4) return null; // LLC + minimal BPDU
        if (payload[0] !== 0x42 || payload[1] !== 0x42 || payload[2] !== 0x03) return null;

        const bpduBytes = payload.subarray(3);
        try {
            return STPBPDU.fromBytes(bpduBytes);
        } catch {
            return null;
        }
    }

    /**
     * Transition a port toward the desired forwarding target.
     * Blocking is immediate; Forwarding goes Blocking→Listening→Learning→Forwarding,
     * with one ForwardDelay timer per phase.
     * TC is triggered when a port enters or leaves Forwarding/Learning state.
     * @param {number} portIdx
     * @param {boolean} shouldForward
     */
    _setPortTargetState(portIdx, shouldForward) {
        const cur = this.stpPortState[portIdx];

        if (!shouldForward) {
            // Immediately block — cancel any pending transition timer
            if (this._stpPortTimers[portIdx] != null) {
                simTimer.cancel(this._stpPortTimers[portIdx]);
                this._stpPortTimers[portIdx] = null;
            }
            if (cur !== STP_STATE.BLOCKING) {
                // A formerly active port going to Blocking = topology change
                if (cur === STP_STATE.FORWARDING || cur === STP_STATE.LEARNING) {
                    this._stpTriggerTc();
                }
                this.stpPortState[portIdx] = STP_STATE.BLOCKING;
            }
            return;
        }

        // Already transitioning or forwarding — don't restart the timers
        if (cur === STP_STATE.FORWARDING ||
            cur === STP_STATE.LEARNING   ||
            cur === STP_STATE.LISTENING) return;

        // Start Listening phase
        this.stpPortState[portIdx] = STP_STATE.LISTENING;
        this._stpPortTimers[portIdx] = simTimer.schedule(() => {
            this._stpPortTimers[portIdx] = null;
            if (this.stpPortState[portIdx] !== STP_STATE.LISTENING) return;
            this.stpPortState[portIdx] = STP_STATE.LEARNING;

            this._stpPortTimers[portIdx] = simTimer.schedule(() => {
                this._stpPortTimers[portIdx] = null;
                if (this.stpPortState[portIdx] !== STP_STATE.LEARNING) return;
                this.stpPortState[portIdx] = STP_STATE.FORWARDING;
                // Port entering Forwarding = topology change per IEEE 802.1D
                this._stpTriggerTc();
            }, SimTimer.STP_FORWARD_DELAY_MS);
        }, SimTimer.STP_FORWARD_DELAY_MS);
    }

    /**
     * Start or restart the periodic Hello BPDU timer.
     * Dispatches to STP or RSTP emit/aging based on current stpMode.
     */
    _stpStartHello() {
        if (this._stpHelloTimer != null) simTimer.cancel(this._stpHelloTimer);
        this._stpHelloTimer = simTimer.schedule(() => {
            this._stpHelloTimer = null;
            if (!this.stpEnabled) return;
            if (this.stpMode === 'rstp') {
                this._rstpCheckFastAging();
                this._emitRstBpdus();
            } else {
                this._stpCheckAging();
                this._emitBPDUs();
            }
            this._stpStartHello();
        }, SimTimer.STP_HELLO_MS);
    }

    /**
     * Stop the periodic Hello BPDU timer.
     */
    _stpStopHello() {
        if (this._stpHelloTimer != null) {
            simTimer.cancel(this._stpHelloTimer);
            this._stpHelloTimer = null;
        }
    }

    /**
     * Expire received BPDU info older than Max Age and retrigger computation.
     */
    _stpCheckAging() {
        const now = simTimer.currentTick;
        const maxAgeTicks = SimTimer.toTicks(SimTimer.STP_MAX_AGE_MS);
        let changed = false;
        for (let i = 0; i < this.ports.length; i++) {
            if (this.stpRxBest[i] == null) continue;
            if (now - this._stpRxBestTick[i] > maxAgeTicks) {
                this.stpRxBest[i] = null;
                changed = true;
            }
        }
        if (changed) this._recomputeStpAndMaybeEmit();
    }

    /**
     * Recompute root / root port / designated ports.
     * Port cost is fixed at 1 in this simplified model.
     * Emits BPDU only if state changed (or forced).
     */
    _recomputeStpAndMaybeEmit() {
        // Best tuple for *us* if we are root
        let best = { rootId: this.stpBridgeIdVal, cost: 0, bridgeId: this.stpBridgeIdVal, portId: 0 };
        let bestPort = null;

        // pick root port — only look at logical STP ports (LAG representatives + non-LAG)
        for (let i = 0; i < this.ports.length; i++) {
            if (!this._stpIsLogicalPort(i)) continue;
            if (!this._stpIsLinked(i)) continue;

            const rx = this.stpRxBest[i];
            if (!rx) continue;

            const cand = {
                rootId: rx.rootId,
                cost: rx.cost + 1, // fixed link cost
                bridgeId: rx.bridgeId,
                portId: rx.portId,
            };

            if (compareTuple(cand, best) < 0) {
                best = cand;
                bestPort = i;
            }
        }

        this.stpRootId   = best.rootId;
        this.stpRootCost = bestPort == null ? 0 : best.cost;
        this.stpRootPort = bestPort;

        // Update messageAge from root port info (non-root bridges add ~1 s per hop)
        if (this.stpRootPort !== null && this.stpRxBest[this.stpRootPort]) {
            this._stpRootPortMessageAge = /** @type {any} */ (this.stpRxBest[this.stpRootPort]).messageAge;
        } else {
            this._stpRootPortMessageAge = 0;
        }

        // designated-port election per segment (logical ports only)
        const ourAdvBase = { rootId: this.stpRootId, cost: this.stpRootCost, bridgeId: this.stpBridgeIdVal };

        for (let i = 0; i < this.ports.length; i++) {
            if (!this._stpIsLogicalPort(i)) continue;

            if (!this._stpIsLinked(i)) {
                this.stpPortRole[i] = "nondesignated";
                this._setPortTargetState(i, false);
                continue;
            }

            if (this.stpRootPort === i) {
                this.stpPortRole[i] = "root";
                this._setPortTargetState(i, true);
                continue;
            }

            const rx = this.stpRxBest[i];
            if (!rx) {
                // no neighbor info => assume designated
                this.stpPortRole[i] = "designated";
                this._setPortTargetState(i, true);
                continue;
            }

            const ourTuple = { ...ourAdvBase, portId: this._makePortId(i) };

            const isDesignated = compareTuple(ourTuple, rx) < 0;
            this.stpPortRole[i] = isDesignated ? "designated" : "nondesignated";
            this._setPortTargetState(i, isDesignated);
        }

        // Propagate logical port state to all non-representative LAG members
        this._lagSyncStpStates();

        const snap = this._stpSnapshot();
        if (this._stpForceEmit || snap !== this._stpLastSnapshot) {
            this._stpForceEmit = false;
            this._stpLastSnapshot = snap;
            this._emitBPDUs();
        }
    }

    /**
     * Port ID encoding (priority 0x80, port number in low byte).
     * @param {number} portIndex
     * @returns {number}
     */
    _makePortId(portIndex) {
        return ((0x80 << 8) | ((portIndex + 1) & 0xff)) & 0xffff;
    }

    /**
     * Send Config BPDUs out all designated ports (IEEE 802.1D: only designated ports
     * originate Configuration BPDUs; root and non-designated ports do not).
     */
    _emitBPDUs() {
        const srcMac = bigintToMac(this.bridgeId);
        const ourBridgeIdBytes = this.stpBridgeIdBytes;

        const rootIdBytes =
            (this.stpRootId === this.stpBridgeIdVal)
                ? ourBridgeIdBytes
                : this._bigIntTo8Bytes(this.stpRootId);

        // Non-root bridges increment messageAge by ~1 s (256 ticks in 1/256 s encoding)
        const messageAge = this.stpRootPort === null
            ? 0
            : Math.min(this._stpRootPortMessageAge + 256, 20 * 256 - 256);

        for (let i = 0; i < this.ports.length; i++) {
            // Only designated logical ports send Config BPDUs (IEEE 802.1D §8.5.3)
            if (this.stpPortRole[i] !== "designated") continue;
            if (!this._stpIsLogicalPort(i)) continue;

            const flags = (this._stpTcActive     ? STP_FLAG_TC  : 0) |
                          (this._stpTcaOnPort[i] ? STP_FLAG_TCA : 0);
            this._stpTcaOnPort[i] = false; // clear after sending

            const payload = this._packConfigBpduPayload(
                rootIdBytes,
                this.stpRootCost >>> 0,
                ourBridgeIdBytes,
                this._makePortId(i),
                messageAge,
                flags,
            );

            const f = new EthernetFrame({
                dstMac: STP_DEST_MAC,
                srcMac: srcMac,
                etherType: 0,
                payload: payload,
            });
            f.vlan = null;
            f.useLengthField = true;
            f.length = payload.length;

            // For LAG: send on every linked physical member of this logical port
            const gid = this.portLagId[i] ?? -1;
            if (gid >= 0) {
                const g = this.lagGroups.find(g => g.id === gid);
                if (g) for (const m of g.members) { if (this.ports[m]?.isLinked()) this.ports[m].send(f); }
            } else {
                if (this.ports[i].isLinked()) this.ports[i].send(f);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // RSTP (IEEE 802.1w)
    // ---------------------------------------------------------------------------

    /**
     * Build and send one RST BPDU (protocolVersion=2, bpduType=0x02) on a port.
     * @param {number} portIdx        physical port to send on
     * @param {number} flags          full 8-bit RSTP flags byte
     * @param {Uint8Array} [rootIdBytes]
     * @param {number} [rootCost]
     * @param {number} [logicalPortIdx]  logical port for port-ID field (defaults to portIdx)
     */
    _sendRstBpdu(portIdx, flags, rootIdBytes, rootCost, logicalPortIdx = portIdx) {
        const srcMac = bigintToMac(this.bridgeId);
        const ourBridgeIdBytes = this.stpBridgeIdBytes;

        const ri = rootIdBytes ?? (
            (this.stpRootId === this.stpBridgeIdVal)
                ? ourBridgeIdBytes
                : this._bigIntTo8Bytes(this.stpRootId)
        );
        const cost = rootCost ?? this.stpRootCost;
        const messageAge = this.stpRootPort === null
            ? 0
            : Math.min(this._stpRootPortMessageAge + 256, 20 * 256 - 256);

        const bpdu = new STPBPDU({
            protocolId: 0x0000,
            protocolVersion: 2,
            bpduType: 0x02,
            flags: flags & 0xff,
            rootId: ri,
            rootPathCost: cost >>> 0,
            bridgeId: ourBridgeIdBytes,
            portId: this._makePortId(logicalPortIdx),
            messageAge,
            maxAge: 20 * 256,
            helloTime: 2 * 256,
            forwardDelay: 15 * 256,
        });

        const bpduBytes = bpdu.pack();
        const payload = new Uint8Array(STP_LLC.length + bpduBytes.length);
        payload.set(STP_LLC, 0);
        payload.set(bpduBytes, STP_LLC.length);

        const f = new EthernetFrame({ dstMac: STP_DEST_MAC, srcMac, etherType: 0, payload });
        f.vlan = null;
        f.useLengthField = true;
        f.length = payload.length;
        this.ports[portIdx].send(f);
    }

    /**
     * Emit RST BPDUs on all designated ports and on the root port (for Proposal/Agreement).
     * In RSTP every designated port actively proposes while it is in Discarding state.
     */
    _emitRstBpdus() {
        const rootIdBytes = (this.stpRootId === this.stpBridgeIdVal)
            ? this.stpBridgeIdBytes
            : this._bigIntTo8Bytes(this.stpRootId);

        for (let i = 0; i < this.ports.length; i++) {
            if (!this._stpIsLogicalPort(i)) continue;
            if (!this._stpIsLinked(i)) continue;

            const role = this.stpPortRole[i];
            const state = this.stpPortState[i];

            if (role === 'designated') {
                const isProposing = this._rstpProposing[i];
                const isFwd = state === STP_STATE.FORWARDING;
                const isLrn = isFwd || state === STP_STATE.LEARNING;
                const flags =
                    (this._stpTcActive ? RSTP_FLAG_TC : 0) |
                    (isProposing ? RSTP_FLAG_PROPOSAL : 0) |
                    (RSTP_PORT_ROLE.DESIGNATED << 2) |
                    (isLrn ? RSTP_FLAG_LEARNING : 0) |
                    (isFwd ? RSTP_FLAG_FORWARDING : 0);

                // For LAG: send on every linked physical member, using logical port for BPDU port-ID
                const gid = this.portLagId[i] ?? -1;
                if (gid >= 0) {
                    const g = this.lagGroups.find(g => g.id === gid);
                    if (g) for (const m of g.members) {
                        if (this.ports[m]?.isLinked()) this._sendRstBpdu(m, flags, rootIdBytes, this.stpRootCost, i);
                    }
                } else {
                    this._sendRstBpdu(i, flags, rootIdBytes, this.stpRootCost);
                }
            }
        }
    }

    /**
     * Recompute RSTP root / roles / states.  Similar to STP but with
     * Alternate/Backup roles and Proposal/Agreement rapid-transition logic.
     */
    _recomputeRstpAndMaybeEmit() {
        // Root election (identical to STP)
        let best = { rootId: this.stpBridgeIdVal, cost: 0, bridgeId: this.stpBridgeIdVal, portId: 0 };
        let bestPort = null;

        // Root election — logical ports only
        for (let i = 0; i < this.ports.length; i++) {
            if (!this._stpIsLogicalPort(i)) continue;
            if (!this._stpIsLinked(i)) continue;
            const rx = this.stpRxBest[i];
            if (!rx) continue;
            const cand = { rootId: rx.rootId, cost: rx.cost + 1, bridgeId: rx.bridgeId, portId: rx.portId };
            if (compareTuple(cand, best) < 0) { best = cand; bestPort = i; }
        }

        this.stpRootId   = best.rootId;
        this.stpRootCost = bestPort == null ? 0 : best.cost;
        this.stpRootPort = bestPort;

        if (this.stpRootPort !== null && this.stpRxBest[this.stpRootPort]) {
            this._stpRootPortMessageAge = /** @type {any} */ (this.stpRxBest[this.stpRootPort]).messageAge;
        } else {
            this._stpRootPortMessageAge = 0;
        }

        const ourAdvBase = { rootId: this.stpRootId, cost: this.stpRootCost, bridgeId: this.stpBridgeIdVal };

        // Role assignment — logical ports only
        for (let i = 0; i < this.ports.length; i++) {
            if (!this._stpIsLogicalPort(i)) continue;

            if (!this._stpIsLinked(i)) {
                this.stpPortRole[i] = "alternate";
                this._rstpSetDiscarding(i);
                continue;
            }

            if (this.stpRootPort === i) {
                const wasRoot = this.stpPortRole[i] === "root";
                this.stpPortRole[i] = "root";
                this._rstpProposing[i] = false;
                if (!wasRoot) {
                    this._rstpStartFwd(i);
                }
                continue;
            }

            const rx = this.stpRxBest[i];
            if (!rx) {
                const wasDesignated = this.stpPortRole[i] === "designated";
                this.stpPortRole[i] = "designated";
                if (!wasDesignated && this.stpPortState[i] !== STP_STATE.FORWARDING) {
                    this._rstpSetDiscarding(i);
                    this._rstpProposing[i] = true;
                    this._rstpStartFwd(i);
                } else if (!wasDesignated) {
                    this._rstpProposing[i] = true;
                }
                continue;
            }

            const ourTuple = { ...ourAdvBase, portId: this._makePortId(i) };

            if (compareTuple(ourTuple, rx) < 0) {
                const wasDesignated = this.stpPortRole[i] === "designated";
                this.stpPortRole[i] = "designated";
                if (!wasDesignated && this.stpPortState[i] !== STP_STATE.FORWARDING) {
                    this._rstpSetDiscarding(i);
                    this._rstpProposing[i] = true;
                    this._rstpStartFwd(i);
                } else if (!wasDesignated) {
                    this._rstpProposing[i] = true;
                }
            } else {
                this.stpPortRole[i] = (rx.bridgeId === this.stpBridgeIdVal) ? "backup" : "alternate";
                this._rstpSetDiscarding(i);
            }
        }

        // Propagate logical port state to all non-representative LAG members
        this._lagSyncStpStates();

        const snap = this._stpSnapshot();
        if (this._stpForceEmit || snap !== this._stpLastSnapshot) {
            this._stpForceEmit = false;
            this._stpLastSnapshot = snap;
            this._emitRstBpdus();
        }
    }

    /**
     * Immediately set port to Discarding (RSTP equivalent of blocking).
     * Cancels any pending forwarding timer.
     * @param {number} portIdx
     */
    _rstpSetDiscarding(portIdx) {
        const cur = this.stpPortState[portIdx];
        if (this._stpPortTimers[portIdx] != null) {
            simTimer.cancel(/** @type {number} */ (this._stpPortTimers[portIdx]));
            this._stpPortTimers[portIdx] = null;
        }
        if (cur === STP_STATE.FORWARDING || cur === STP_STATE.LEARNING) {
            this._rstpTriggerTc();
        }
        this.stpPortState[portIdx] = STP_STATE.DISCARDING;
        this._rstpProposing[portIdx] = false;
    }

    /**
     * Start timer-based Discarding→Learning→Forwarding transition (RSTP fallback).
     * Skips Listening state.  P/A Agreement will short-circuit this via _rstpImmedFwd().
     * @param {number} portIdx
     */
    _rstpStartFwd(portIdx) {
        const cur = this.stpPortState[portIdx];
        if (cur === STP_STATE.FORWARDING || cur === STP_STATE.LEARNING) return;

        this.stpPortState[portIdx] = STP_STATE.LEARNING;
        if (this._stpPortTimers[portIdx] != null) {
            simTimer.cancel(/** @type {number} */ (this._stpPortTimers[portIdx]));
        }
        this._stpPortTimers[portIdx] = simTimer.schedule(() => {
            this._stpPortTimers[portIdx] = null;
            if (this.stpPortState[portIdx] !== STP_STATE.LEARNING) return;
            this._rstpImmedFwd(portIdx);
        }, SimTimer.STP_FORWARD_DELAY_MS);
    }

    /**
     * Immediately transition port to Forwarding (P/A agreement completed, or timer expired).
     * @param {number} portIdx
     */
    _rstpImmedFwd(portIdx) {
        if (this._stpPortTimers[portIdx] != null) {
            simTimer.cancel(/** @type {number} */ (this._stpPortTimers[portIdx]));
            this._stpPortTimers[portIdx] = null;
        }
        const cur = this.stpPortState[portIdx];
        if (cur !== STP_STATE.FORWARDING) {
            this.stpPortState[portIdx] = STP_STATE.FORWARDING;
            this._rstpTriggerTc();
            this._lagSyncStpStates();
        }
    }

    /**
     * Process a received RST BPDU on port i.
     * @param {number} portIdx
     * @param {STPBPDU} bpdu
     */
    _handleRstBpdu(portIdx, bpdu) {
        // TC: flush MAC table on all ports except the receiving port
        if (bpdu.isTc) {
            this._rstpHandleTcReceived(portIdx);
        }

        // Agreement received on a port we were proposing (= our Designated Port)
        if (bpdu.isAgreement && this.stpPortRole[portIdx] === "designated" && this._rstpProposing[portIdx]) {
            this._rstpProposing[portIdx] = false;
            this._rstpImmedFwd(portIdx);
        }

        // Update root info
        const rx = {
            rootId:     this._bridgeIdBytesToBigInt(bpdu.rootId),
            cost:       bpdu.rootPathCost >>> 0,
            bridgeId:   this._bridgeIdBytesToBigInt(bpdu.bridgeId),
            portId:     bpdu.portId & 0xffff,
            messageAge: bpdu.messageAge,
        };

        const prev = this.stpRxBest[portIdx];
        if (!prev || compareTuple(rx, prev) < 0) {
            this.stpRxBest[portIdx] = rx;
            this._stpRxBestTick[portIdx] = simTimer.currentTick;
            this._rstpMissedHellos[portIdx] = 0;

            this._recomputeRstpAndMaybeEmit();

            // Proposal: if this port is now our root port and upstream is proposing, do P/A sync
            if (bpdu.isProposal && this.stpRootPort === portIdx) {
                this._rstpHandleProposal(portIdx);
            }
        } else if (prev && compareTuple(rx, prev) === 0) {
            this._stpRxBestTick[portIdx] = simTimer.currentTick;
            this._rstpMissedHellos[portIdx] = 0;

            // Still proposing from upstream — re-send Agreement if we already synced
            if (bpdu.isProposal && this.stpRootPort === portIdx) {
                this._rstpSendAgreement(portIdx);
            }
        }
    }

    /**
     * Handle upstream Proposal: sync all non-root ports to Discarding, send Agreement.
     * @param {number} rootPortIdx
     */
    _rstpHandleProposal(rootPortIdx) {
        // Sync: set all non-root, non-edge designated ports to Discarding and re-propose
        for (let i = 0; i < this.ports.length; i++) {
            if (i === rootPortIdx) continue;
            const role = this.stpPortRole[i];
            if (role === "designated") {
                if (this.stpPortState[i] === STP_STATE.FORWARDING || this.stpPortState[i] === STP_STATE.LEARNING) {
                    this._rstpSetDiscarding(i);
                    this._rstpProposing[i] = true;
                    this._rstpStartFwd(i); // fallback if downstream never sends Agreement
                }
            }
            // Alternate/Backup ports are already Discarding — nothing to do
        }
        // Send Agreement back upstream, then immediately go to Forwarding (P/A complete)
        this._rstpSendAgreement(rootPortIdx);
        this._rstpImmedFwd(rootPortIdx);
    }

    /**
     * Send an RST BPDU with Agreement bit set on portIdx (root port → upstream).
     * @param {number} portIdx
     */
    _rstpSendAgreement(portIdx) {
        const isFwd = this.stpPortState[portIdx] === STP_STATE.FORWARDING;
        const isLrn = isFwd || this.stpPortState[portIdx] === STP_STATE.LEARNING;
        const flags =
            (this._stpTcActive ? RSTP_FLAG_TC : 0) |
            (RSTP_PORT_ROLE.ROOT << 2) |          // Port Role = Root
            (isLrn ? RSTP_FLAG_LEARNING : 0) |
            (isFwd ? RSTP_FLAG_FORWARDING : 0) |
            RSTP_FLAG_AGREEMENT;
        this._sendRstBpdu(portIdx, flags);
    }

    /**
     * RSTP topology change: set TC active and flush MAC table (no TCN BPDUs needed).
     */
    _rstpTriggerTc() {
        this.sat.clear();
        this._stpTcActive = true;
        if (this._stpTcTimer != null) simTimer.cancel(this._stpTcTimer);
        // tcWhile = Hello Time + 1 s ≈ 3 Hello periods
        this._stpTcTimer = simTimer.schedule(() => {
            this._stpTcActive = false;
            this._stpTcTimer = null;
        }, SimTimer.STP_HELLO_MS * 3);
    }

    /**
     * Handle TC bit received from a neighbor: flush MAC table on all ports except fromPort.
     * @param {number} fromPort
     */
    _rstpHandleTcReceived(fromPort) {
        this.sat.clear();
        // Also propagate TC via our RST BPDUs for tcWhile
        this._stpTcActive = true;
        if (this._stpTcTimer != null) simTimer.cancel(this._stpTcTimer);
        this._stpTcTimer = simTimer.schedule(() => {
            this._stpTcActive = false;
            this._stpTcTimer = null;
        }, SimTimer.STP_HELLO_MS * 3);
    }

    /**
     * Fast aging: expire BPDU info on ports that have missed 3 consecutive Hello intervals.
     * Called at each Hello tick in RSTP mode instead of _stpCheckAging().
     */
    _rstpCheckFastAging() {
        let changed = false;
        for (let i = 0; i < this.ports.length; i++) {
            if (this.stpRxBest[i] == null) continue;
            this._rstpMissedHellos[i]++;
            if (this._rstpMissedHellos[i] >= 3) {
                this.stpRxBest[i] = null;
                this._rstpMissedHellos[i] = 0;
                changed = true;
            }
        }
        if (changed) this._recomputeRstpAndMaybeEmit();
    }

    // ---------------------------------------------------------------------------
    // TC / TCN
    // ---------------------------------------------------------------------------

    /**
     * Trigger a topology change.
     * Activates the TC bit in Config BPDUs for maxAge + forwardDelay, flushes the
     * MAC table, and — for non-root bridges — starts sending TCN BPDUs upstream.
     */
    _stpTriggerTc() {
        if (!this.stpEnabled) return;

        // Flush MAC table so stale entries don't cause black holes
        this.sat.clear();

        if (this._stpTcTimer != null) simTimer.cancel(this._stpTcTimer);
        this._stpTcActive = true;
        this._stpTcTimer = simTimer.schedule(() => {
            this._stpTcActive = false;
            this._stpTcTimer = null;
        }, SimTimer.STP_MAX_AGE_MS + SimTimer.STP_FORWARD_DELAY_MS);

        if (this.stpRootPort !== null) {
            // Non-root bridge: send TCN BPDUs up the root port until TCA received
            this._stpStartTcn();
        }
    }

    _stpStopTc() {
        this._stpTcActive = false;
        if (this._stpTcTimer != null) {
            simTimer.cancel(this._stpTcTimer);
            this._stpTcTimer = null;
        }
    }

    _stpStartTcn() {
        if (this._stpTcnPending) return; // already running
        this._stpTcnPending = true;
        this._stpSendTcnNow();
    }

    _stpSendTcnNow() {
        if (!this._stpTcnPending || this.stpRootPort === null || !this.stpEnabled) {
            this._stpStopTcn();
            return;
        }

        const port = this.ports[this.stpRootPort];
        if (port && port.isLinked()) {
            this._sendTcnBpdu(this.stpRootPort);
        }

        // Retry every Hello interval until TCA received
        this._stpTcnTimer = simTimer.schedule(() => {
            this._stpTcnTimer = null;
            this._stpSendTcnNow();
        }, SimTimer.STP_HELLO_MS);
    }

    _stpStopTcn() {
        this._stpTcnPending = false;
        if (this._stpTcnTimer != null) {
            simTimer.cancel(this._stpTcnTimer);
            this._stpTcnTimer = null;
        }
    }

    /**
     * Send a single TCN BPDU (type 0x80) out the specified port.
     * @param {number} portIdx
     */
    _sendTcnBpdu(portIdx) {
        const srcMac = bigintToMac(this.bridgeId);
        const bpduBytes = new STPBPDU({ bpduType: 0x80 }).pack();
        const payload = new Uint8Array(STP_LLC.length + bpduBytes.length);
        payload.set(STP_LLC, 0);
        payload.set(bpduBytes, STP_LLC.length);

        const f = new EthernetFrame({ dstMac: STP_DEST_MAC, srcMac, etherType: 0, payload });
        f.vlan = null;
        f.useLengthField = true;
        f.length = payload.length;
        this.ports[portIdx].send(f);
    }

    // ---------------------------------------------------------------------------
    // Link-change detection
    // ---------------------------------------------------------------------------

    /**
     * Clear neighbor info for ports that changed link state and trigger recompute.
     * TC is fired naturally via _setPortTargetState when ports change state.
     */
    _stpHandleLinkChanges() {
        let changed = false;

        for (let i = 0; i < this.ports.length; i++) {
            const linkedNow = this.ports[i].isLinked();
            const linkedBefore = this.stpPortLinkedLast[i];

            if (linkedNow === linkedBefore) continue;
            this.stpPortLinkedLast[i] = linkedNow;
            changed = true;

            // Forget neighbor BPDU on the logical port (representative) when the
            // whole LAG group goes down; for non-LAG ports, clear immediately.
            const rep = this._lagRepresentative(i);
            if (!this._stpIsLinked(rep)) {
                this.stpRxBest[rep] = null;
            }
        }

        if (changed) {
            this._stpForceEmit = true;
            if (this.stpMode === 'rstp') {
                this._recomputeRstpAndMaybeEmit();
            } else {
                this._recomputeStpAndMaybeEmit();
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Main update
    // ---------------------------------------------------------------------------

    update() {
        if (this.stpEnabled) {
            this._stpHandleLinkChanges();
        }

        // Drain ingress queues
        for (let i = 0; i < this.ports.length; i++) {
            const inPort = this.ports[i];

            while (true) {
                let frame = inPort.getNextIncomingFrame();
                if (frame == null) break;

                // ---------------- STP BPDU receive ----------------
                if (this.stpEnabled && this._isBpdu(frame)) {
                    const bpdu = this._unpackBpdu(frame.payload);
                    // All STP state is on the logical port (LAG representative).
                    const stpPort = this._lagRepresentative(i);

                    // TCN BPDU: received on a designated port, relay toward root
                    if (bpdu && bpdu.bpduType === 0x80) {
                        if (this.stpPortRole[stpPort] === "designated") {
                            this._stpTcaOnPort[stpPort] = true;
                            if (this.stpRootPort === null) {
                                this._stpTriggerTc();
                            } else {
                                this._stpStartTcn();
                                this.sat.clear();
                            }
                        }
                        continue;
                    }

                    // RST BPDU (IEEE 802.1w, protocolVersion 2)
                    if (bpdu && bpdu.bpduType === 0x02 && this.stpMode === 'rstp') {
                        this._handleRstBpdu(stpPort, bpdu);
                        continue;
                    }

                    // Config BPDU (classic STP only)
                    if (bpdu && bpdu.bpduType === 0x00 && this.stpMode === 'stp') {
                        if (bpdu.flags & STP_FLAG_TC) {
                            this.sat.clear();
                        }

                        if (stpPort === this.stpRootPort && (bpdu.flags & STP_FLAG_TCA)) {
                            this._stpStopTcn();
                        }

                        const rx = {
                            rootId:     this._bridgeIdBytesToBigInt(bpdu.rootId),
                            cost:       bpdu.rootPathCost >>> 0,
                            bridgeId:   this._bridgeIdBytesToBigInt(bpdu.bridgeId),
                            portId:     bpdu.portId & 0xffff,
                            messageAge: bpdu.messageAge,
                        };

                        const prev = this.stpRxBest[stpPort];
                        if (!prev || compareTuple(rx, prev) < 0) {
                            this.stpRxBest[stpPort] = rx;
                            this._stpRxBestTick[stpPort] = simTimer.currentTick;
                            this._recomputeStpAndMaybeEmit();
                        } else if (prev && compareTuple(rx, prev) === 0) {
                            this._stpRxBestTick[stpPort] = simTimer.currentTick;
                        }
                    }

                    continue; // do not forward BPDUs as data
                }

                // After BPDU handling, enforce STP on ingress for DATA frames.
                // For LAG members, look up the representative's state.
                if (this.stpEnabled) {
                    const ps = this.stpPortState[this._lagRepresentative(i)];
                    if (ps === STP_STATE.BLOCKING || ps === STP_STATE.LISTENING || ps === STP_STATE.DISCARDING) continue;
                }

                // ---------------- Data forwarding ----------------
                const stpLearningOnly = this.stpEnabled && this.stpPortState[this._lagRepresentative(i)] === STP_STATE.LEARNING;

                // Bridge Group Address (01:80:c2:00:00:00–0f): terminate at bridge, never forward
                if (this._isBridgeGroupAddress(frame)) continue;

                // VLAN DISABLED
                if (!this.vlanEnabled) {
                    // Learn source MAC globally (IEEE 802.1D §7.8: never learn multicast source MACs)
                    // For LAG members, learn on the group representative so all members share one SAT slot.
                    if (!(frame.srcMac[0] & 0x01)) {
                        const srcKey = MACToNumber(frame.srcMac);
                        this.sat.set(srcKey, this._lagRepresentative(i));
                    }

                    if (stpLearningOnly) continue;

                    const isBroadcast = isEqualUint8(frame.dstMac, new Uint8Array([255, 255, 255, 255, 255, 255]));
                    if (isBroadcast) {
                        for (let j = 0; j < this.ports.length; j++) {
                            if (j === i) continue;
                            if (!this._lagShouldEgress(j, i, frame)) continue;
                            if (this.stpEnabled && this.stpPortState[this._lagRepresentative(j)] !== STP_STATE.FORWARDING) continue;
                            this.ports[j].send(frame);
                        }
                        continue;
                    }

                    // IGMP snooping (non-broadcast multicast only)
                    if (this.igmpSnoopingEnabled && this._isIPv4MulticastMac(frame.dstMac)) {
                        const igmpType = this._processIGMP(i, frame);
                        if (igmpType === -1) {
                            // Non-IGMP multicast data: forward only to registered ports
                            const entry = this.mcastTable.get(MACToNumber(frame.dstMac));
                            if (entry && entry.ports.size > 0) {
                                for (const j of entry.ports) {
                                    if (j === i) continue;
                                    if (!this._lagShouldEgress(j, i, frame)) continue;
                                    if (this.stpEnabled && this.stpPortState[this._lagRepresentative(j)] !== STP_STATE.FORWARDING) continue;
                                    this.ports[j].send(frame);
                                }
                                continue;
                            }
                        }
                        // IGMP control (query/report/leave) or unknown group → flood below
                    }

                    // MLD snooping (non-broadcast IPv6 multicast only)
                    if (this.igmpSnoopingEnabled && this._isIPv6MulticastMac(frame.dstMac)) {
                        const mldType = this._processMLD(i, frame);
                        if (mldType === -1) {
                            // Non-MLD IPv6 multicast data: forward only to registered ports
                            const entry = this.mcastTable.get(MACToNumber(frame.dstMac));
                            if (entry && entry.ports.size > 0) {
                                for (const j of entry.ports) {
                                    if (j === i) continue;
                                    if (!this._lagShouldEgress(j, i, frame)) continue;
                                    if (this.stpEnabled && this.stpPortState[this._lagRepresentative(j)] !== STP_STATE.FORWARDING) continue;
                                    this.ports[j].send(frame);
                                }
                                continue;
                            }
                        }
                        // MLD control (130/131/132) or unknown group → flood below
                    }

                    const dstKey = MACToNumber(frame.dstMac);
                    const outIndex = this.sat.get(dstKey);

                    if (outIndex == null) {
                        // Unknown unicast -> flood
                        for (let j = 0; j < this.ports.length; j++) {
                            if (j === i) continue;
                            if (!this._lagShouldEgress(j, i, frame)) continue;
                            if (this.stpEnabled && this.stpPortState[this._lagRepresentative(j)] !== STP_STATE.FORWARDING) continue;
                            this.ports[j].send(frame);
                        }
                    } else {
                        // Known unicast -> forward; resolve LAG member if needed
                        const actualOut = this._lagResolveEgress(outIndex, frame);
                        if (actualOut === i) continue;
                        if (this.stpEnabled && this.stpPortState[this._lagRepresentative(actualOut)] !== STP_STATE.FORWARDING) continue;
                        this.ports[actualOut].send(frame);
                    }

                    continue;
                }

                // VLAN ENABLED
                const vid = this.getIngressVid(inPort, frame);
                if (vid == null) continue; // dropped by VLAN ingress rules

                // QinQ ingress: push outer S-tag so forwarded frames carry it
                if (inPort.svid !== null) {
                    frame = this.cloneFrame(frame);
                    frame.svlan = { vid: inPort.svid };
                }

                // Learn source MAC per VLAN (IEEE 802.1D §7.8: never learn multicast source MACs)
                if (!(frame.srcMac[0] & 0x01)) {
                    const srcKey = MACToNumber(frame.srcMac);
                    let vlanMap = this.sat.get(vid);
                    if (!vlanMap) {
                        vlanMap = new Map();
                        this.sat.set(vid, vlanMap);
                    }
                    vlanMap.set(srcKey, this._lagRepresentative(i));
                }

                if (stpLearningOnly) continue;

                const isBroadcast = isEqualUint8(frame.dstMac, new Uint8Array([255, 255, 255, 255, 255, 255]));
                const dstKey = MACToNumber(frame.dstMac);
                const outIndex = isBroadcast ? null : (this.sat.get(vid)?.get(dstKey) ?? null);

                // IGMP snooping (non-broadcast multicast only)
                if (!isBroadcast && this.igmpSnoopingEnabled && this._isIPv4MulticastMac(frame.dstMac)) {
                    const igmpType = this._processIGMP(i, frame);
                    if (igmpType === -1) {
                        // Non-IGMP multicast data: forward only to registered ports (still VLAN-filtered)
                        const entry = this.mcastTable.get(dstKey);
                        if (entry && entry.ports.size > 0) {
                            for (const j of entry.ports) {
                                if (j === i) continue;
                                if (!this._lagShouldEgress(j, i, frame)) continue;
                                if (this.stpEnabled && this.stpPortState[this._lagRepresentative(j)] !== STP_STATE.FORWARDING) continue;
                                const outPort = this.ports[j];
                                if (!this.portAllowsVid(outPort, vid)) continue;
                                this.sendOut(vid, outPort, frame);
                            }
                            continue;
                        }
                    }
                    // IGMP control or unknown group → flood within VLAN below
                }

                // MLD snooping (non-broadcast IPv6 multicast only)
                if (!isBroadcast && this.igmpSnoopingEnabled && this._isIPv6MulticastMac(frame.dstMac)) {
                    const mldType = this._processMLD(i, frame);
                    if (mldType === -1) {
                        // Non-MLD IPv6 multicast data: forward only to registered ports (VLAN-filtered)
                        const entry = this.mcastTable.get(dstKey);
                        if (entry && entry.ports.size > 0) {
                            for (const j of entry.ports) {
                                if (j === i) continue;
                                if (!this._lagShouldEgress(j, i, frame)) continue;
                                if (this.stpEnabled && this.stpPortState[this._lagRepresentative(j)] !== STP_STATE.FORWARDING) continue;
                                const outPort = this.ports[j];
                                if (!this.portAllowsVid(outPort, vid)) continue;
                                this.sendOut(vid, outPort, frame);
                            }
                            continue;
                        }
                    }
                    // MLD control (130/131/132) or unknown group → flood within VLAN below
                }

                if (isBroadcast || outIndex == null) {
                    // Flood within VLAN
                    for (let j = 0; j < this.ports.length; j++) {
                        if (j === i) continue;
                        if (!this._lagShouldEgress(j, i, frame)) continue;
                        if (this.stpEnabled && this.stpPortState[this._lagRepresentative(j)] !== STP_STATE.FORWARDING) continue;

                        const outPort = this.ports[j];
                        if (!this.portAllowsVid(outPort, vid)) continue;
                        this.sendOut(vid, outPort, frame);
                    }
                } else {
                    // Known unicast; resolve LAG member if needed
                    const actualOut = this._lagResolveEgress(outIndex, frame);
                    if (actualOut === i) continue;
                    if (this.stpEnabled && this.stpPortState[this._lagRepresentative(actualOut)] !== STP_STATE.FORWARDING) continue;

                    const outPort = this.ports[actualOut];
                    if (!this.portAllowsVid(outPort, vid)) continue;
                    this.sendOut(vid, outPort, frame);
                }
            }
        }
    }
}
