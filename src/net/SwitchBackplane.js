//@ts-check

import { isEqualUint8, MACToNumber } from "../lib/helpers.js";
import { EthernetPort } from "./EthernetPort.js";
import { Observable } from "../lib/Observeable.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { STPBPDU } from "../net/pdu/STPBPDU.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";

/** IEEE 802.1D port states. */
export const STP_STATE = Object.freeze({
    DISABLED:   "disabled",
    BLOCKING:   "blocking",
    LISTENING:  "listening",
    LEARNING:   "learning",
    FORWARDING: "forwarding",
});

/**
 * STP (classic-ish) in this simulator is encoded as IEEE 802.3 + LLC (not EtherType).
 * Destination MAC is the standard STP multicast.
 *
 * LLC for STP: DSAP=0x42, SSAP=0x42, CTRL=0x03
 */
const STP_DEST_MAC = new Uint8Array([0x01, 0x80, 0xc2, 0x00, 0x00, 0x00]);
const STP_LLC = new Uint8Array([0x42, 0x42, 0x03]); // DSAP/SSAP/UI

/** IEEE 802.1D flags byte bits */
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
    stpEnabled = false;

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
        this.stpPortState   = this.ports.map(() => STP_STATE.FORWARDING);
        this.stpPortRole    = this.ports.map(() => "designated");
        this._stpPortTimers = this.ports.map(/** @returns {null} */ () => null);
        this._stpRxBestTick = this.ports.map(() => 0);
        this.stpRxBest      = this.ports.map(/** @returns {null} */ () => null);
        this._stpTcaOnPort  = this.ports.map(() => false);
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

    enableSTPFeature() {
        this.stpEnabled = true;
        this._stpStartHello();

        this._initStpArrays();
        this._resetStpToSelfRoot();

        // Initialize link-state memory so link-up/down detection works
        this.stpPortLinkedLast = this.ports.map(p => p.isLinked());

        // "first thing": emit hello on all *currently linked* ports
        this._stpForceEmit = true;
        this._recomputeStpAndMaybeEmit(); // will emit because forceEmit
    }

    disableSTPFeature() {
        this.stpEnabled = false;
        this._stpStopHello();
        this._stpStopTc();
        this._stpStopTcn();

        // Cancel all per-port ForwardDelay timers
        for (let i = 0; i < this._stpPortTimers.length; i++) {
            if (this._stpPortTimers[i] != null) {
                simTimer.cancel(this._stpPortTimers[i]);
                this._stpPortTimers[i] = null;
            }
        }

        this.stpRxBest    = this.ports.map(/** @returns {null} */ () => null);
        this.stpPortState = this.ports.map(() => STP_STATE.FORWARDING);
        this.stpPortRole  = this.ports.map(() => "designated");
        this._stpTcaOnPort = this.ports.map(() => false);

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

        if (this.stpEnabled) {
            this._resetStpToSelfRoot();
            this._stpForceEmit = true;
            this._recomputeStpAndMaybeEmit();
        } else {
            this.stpRootId = this.stpBridgeIdVal;
        }
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

        if (this.stpEnabled) {
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

        // keep STP arrays in sync
        this.stpRxBest.push(null);
        this.stpPortState.push(this.stpEnabled ? STP_STATE.BLOCKING : STP_STATE.FORWARDING);
        this.stpPortRole.push(this.stpEnabled ? "nondesignated" : "designated");
        this._stpPortTimers.push(null);
        this._stpRxBestTick.push(0);
        this._stpTcaOnPort.push(false);
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
        f.vlan = frame.vlan ? { ...frame.vlan } : null;

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
        if (port.vlanMode === "untagged") {
            if (frame.vlan != null) return null; // drop
            return port.pvid;
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
        if (port.vlanMode === "untagged") return vid === port.pvid;
        return port.allowedVlans.has(vid);
    }

    /**
     * Send out of a port applying tagging/untagging rules.
     * @param {number} vid
     * @param {EthernetPort} outPort
     * @param {EthernetFrame} inFrame
     */
    sendOut(vid, outPort, inFrame) {
        if (outPort.vlanMode === "untagged") {
            if (vid !== outPort.pvid) return;
            const f = this.cloneFrame(inFrame);
            f.vlan = null; // strip
            outPort.send(f);
            return;
        }

        if (!outPort.allowedVlans.has(vid)) return;
        const f = this.cloneFrame(inFrame);
        f.vlan = { vid }; // ensure tagged
        outPort.send(f);
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
                simTimer.cancel(this._stpPortTimers[i]);
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
     */
    _stpStartHello() {
        if (this._stpHelloTimer != null) simTimer.cancel(this._stpHelloTimer);
        this._stpHelloTimer = simTimer.schedule(() => {
            this._stpHelloTimer = null;
            if (!this.stpEnabled) return;
            this._stpCheckAging();
            this._emitBPDUs();
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

        // pick root port by best received info
        for (let i = 0; i < this.ports.length; i++) {
            if (!this.ports[i].isLinked()) continue;

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
            this._stpRootPortMessageAge = this.stpRxBest[this.stpRootPort].messageAge;
        } else {
            this._stpRootPortMessageAge = 0;
        }

        // designated-port election per segment:
        // our advertised tuple on that port vs neighbor's advertised tuple on that port
        const ourAdvBase = { rootId: this.stpRootId, cost: this.stpRootCost, bridgeId: this.stpBridgeIdVal };

        for (let i = 0; i < this.ports.length; i++) {
            if (!this.ports[i].isLinked()) {
                // Unlinked ports are non-designated and stay blocking
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
            const neighTuple = rx;

            // If our tuple is better, we are designated => forward, else block
            const isDesignated = compareTuple(ourTuple, neighTuple) < 0;
            this.stpPortRole[i] = isDesignated ? "designated" : "nondesignated";
            this._setPortTargetState(i, isDesignated);
        }

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
            // Only designated ports send Config BPDUs (IEEE 802.1D §8.5.3)
            if (this.stpPortRole[i] !== "designated") continue;

            const p = this.ports[i];
            if (!p.isLinked()) continue;

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
                etherType: 0, // not used for 802.3 length frames
                payload: payload, // includes LLC+BPDU
            });

            f.vlan = null;
            f.useLengthField = true;
            f.length = payload.length;

            p.send(f);
        }
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

            if (linkedNow !== linkedBefore) {
                this.stpPortLinkedLast[i] = linkedNow;
                changed = true;

                // if link went down, forget neighbor BPDU learned on it
                if (!linkedNow) {
                    this.stpRxBest[i] = null;
                }
            }
        }

        if (changed) {
            this._stpForceEmit = true; // hello on topology changes (incl. link-up)
            this._recomputeStpAndMaybeEmit();
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
                const frame = inPort.getNextIncomingFrame();
                if (frame == null) break;

                // ---------------- STP BPDU receive ----------------
                if (this.stpEnabled && this._isBpdu(frame)) {
                    const bpdu = this._unpackBpdu(frame.payload);

                    // TCN BPDU: received on a designated port, relay toward root
                    if (bpdu && bpdu.bpduType === 0x80) {
                        if (this.stpPortRole[i] === "designated") {
                            // Acknowledge with TCA in next Config BPDU on this port
                            this._stpTcaOnPort[i] = true;
                            if (this.stpRootPort === null) {
                                // We are root — activate TC period
                                this._stpTriggerTc();
                            } else {
                                // Relay TCN upstream
                                this._stpStartTcn();
                                this.sat.clear();
                            }
                        }
                        continue;
                    }

                    // Config BPDU
                    if (bpdu && bpdu.bpduType === 0x00) {
                        // TC bit: flush MAC table to avoid stale forwarding during reconvergence
                        if (bpdu.flags & STP_FLAG_TC) {
                            this.sat.clear();
                        }

                        // TCA bit on root port: the designated bridge ack'd our TCN
                        if (i === this.stpRootPort && (bpdu.flags & STP_FLAG_TCA)) {
                            this._stpStopTcn();
                        }

                        const rx = {
                            rootId:     this._bridgeIdBytesToBigInt(bpdu.rootId),
                            cost:       bpdu.rootPathCost >>> 0,
                            bridgeId:   this._bridgeIdBytesToBigInt(bpdu.bridgeId),
                            portId:     bpdu.portId & 0xffff,
                            messageAge: bpdu.messageAge,
                        };

                        const prev = this.stpRxBest[i];
                        if (!prev || compareTuple(rx, prev) < 0) {
                            this.stpRxBest[i] = rx;
                            this._stpRxBestTick[i] = simTimer.currentTick;
                            this._recomputeStpAndMaybeEmit();
                        } else if (prev && compareTuple(rx, prev) === 0) {
                            // Same info refreshed — update timestamp to prevent aging
                            this._stpRxBestTick[i] = simTimer.currentTick;
                        }
                    }

                    continue; // do not forward BPDUs as data
                }

                // After BPDU handling, enforce STP on ingress for DATA frames.
                // BLOCKING and LISTENING ports drop all data frames.
                // LEARNING ports participate in MAC learning but do not forward.
                if (this.stpEnabled) {
                    const ps = this.stpPortState[i];
                    if (ps === STP_STATE.BLOCKING || ps === STP_STATE.LISTENING) continue;
                }

                // ---------------- Data forwarding ----------------
                // When STP enabled: never forward OUT of non-FORWARDING ports.
                // LEARNING ports may update the CAM but must not send frames out.
                const stpLearningOnly = this.stpEnabled && this.stpPortState[i] === STP_STATE.LEARNING;

                // Bridge Group Address (01:80:c2:00:00:00–0f): terminate at bridge, never forward
                if (this._isBridgeGroupAddress(frame)) continue;

                // VLAN DISABLED
                if (!this.vlanEnabled) {
                    // Learn source MAC globally (IEEE 802.1D §7.8: never learn multicast source MACs)
                    if (!(frame.srcMac[0] & 0x01)) {
                        const srcKey = MACToNumber(frame.srcMac);
                        this.sat.set(srcKey, i);
                    }

                    if (stpLearningOnly) continue;

                    const isBroadcast = isEqualUint8(frame.dstMac, new Uint8Array([255, 255, 255, 255, 255, 255]));
                    if (isBroadcast) {
                        for (let j = 0; j < this.ports.length; j++) {
                            if (j === i) continue;
                            if (this.stpEnabled && this.stpPortState[j] !== STP_STATE.FORWARDING) continue;
                            this.ports[j].send(frame);
                        }
                        continue;
                    }

                    const dstKey = MACToNumber(frame.dstMac);
                    const outIndex = this.sat.get(dstKey);

                    if (outIndex == null) {
                        // Unknown unicast -> flood
                        for (let j = 0; j < this.ports.length; j++) {
                            if (j === i) continue;
                            if (this.stpEnabled && this.stpPortState[j] !== STP_STATE.FORWARDING) continue;
                            this.ports[j].send(frame);
                        }
                    } else {
                        // Known unicast -> forward (but don't loop back to ingress)
                        if (outIndex === i) continue;
                        if (this.stpEnabled && this.stpPortState[outIndex] !== STP_STATE.FORWARDING) continue;
                        this.ports[outIndex].send(frame);
                    }

                    continue;
                }

                // VLAN ENABLED
                const vid = this.getIngressVid(inPort, frame);
                if (vid == null) continue; // dropped by VLAN ingress rules

                // Learn source MAC per VLAN (IEEE 802.1D §7.8: never learn multicast source MACs)
                if (!(frame.srcMac[0] & 0x01)) {
                    const srcKey = MACToNumber(frame.srcMac);
                    let vlanMap = this.sat.get(vid);
                    if (!vlanMap) {
                        vlanMap = new Map();
                        this.sat.set(vid, vlanMap);
                    }
                    vlanMap.set(srcKey, i);
                }

                if (stpLearningOnly) continue;

                const isBroadcast = isEqualUint8(frame.dstMac, new Uint8Array([255, 255, 255, 255, 255, 255]));
                const dstKey = MACToNumber(frame.dstMac);
                const outIndex = isBroadcast ? null : (this.sat.get(vid)?.get(dstKey) ?? null);

                if (isBroadcast || outIndex == null) {
                    // Flood within VLAN
                    for (let j = 0; j < this.ports.length; j++) {
                        if (j === i) continue;
                        if (this.stpEnabled && this.stpPortState[j] !== STP_STATE.FORWARDING) continue;

                        const outPort = this.ports[j];
                        if (!this.portAllowsVid(outPort, vid)) continue;
                        this.sendOut(vid, outPort, frame);
                    }
                } else {
                    // Known unicast
                    if (outIndex === i) continue;
                    if (this.stpEnabled && this.stpPortState[outIndex] !== STP_STATE.FORWARDING) continue;

                    const outPort = this.ports[outIndex];
                    if (!this.portAllowsVid(outPort, vid)) continue;
                    this.sendOut(vid, outPort, frame);
                }
            }
        }
    }
}
