//@ts-check

import { isEqualUint8, MACToNumber } from "../lib/helpers.js";
import { EthernetPort } from "./EthernetPort.js";
import { Observable } from "../lib/Observeable.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { STPBPDU } from "../net/pdu/STPBPDU.js";

/**
 * STP (classic-ish) in this simulator is encoded as IEEE 802.3 + LLC (not EtherType).
 * Destination MAC is the standard STP multicast.
 *
 * LLC for STP: DSAP=0x42, SSAP=0x42, CTRL=0x03
 */
const STP_DEST_MAC = new Uint8Array([0x01, 0x80, 0xc2, 0x00, 0x00, 0x00]);
const STP_LLC = new Uint8Array([0x42, 0x42, 0x03]); // DSAP/SSAP/UI

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

let _switchIdCounter = 1n;

export class SwitchBackplane extends Observable {
    /** @type {Array<EthernetPort>} */
    ports = [];

    // -------------------- Feature flags --------------------
    vlanEnabled = false;
    stpEnabled = false;

    // -------------------- SAT --------------------
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

    // -------------------- STP state --------------------
    /** @type {bigint} root bridge id (as bigint of 8-byte bridge-id) */
    stpRootId;

    /** @type {number} */
    stpRootCost = 0;

    /** @type {number|null} */
    stpRootPort = null;

    /**
     * Best STP info received on each port (from neighbor).
     * Tuple stores *bridge-id bigints* (consistent across all devices).
     * @type {Array<{rootId: bigint, cost: number, bridgeId: bigint, portId: number} | null>}
     */
    stpRxBest = [];

    /**
     * Whether a port is forwarding data frames (true) or blocking (false).
     * When STP feature is disabled, all ports are forwarding.
     * @type {Array<boolean>}
     */
    stpForwarding = [];

    /** @type {string} */
    _stpLastSnapshot = "";

    /** @type {Array<boolean>} */
    stpPortLinkedLast = [];

    /** Force emitting HELLO BPDUs once, even if snapshot did not change */
    _stpForceEmit = false;

    /**
     * @param {number} numberOfPorts
     */
    constructor(numberOfPorts) {
        super();

        this.bridgeId = _switchIdCounter++;

        // STP identity (priority + MAC)
        this.stpBridgeIdBytes = this._makeBridgeId(32768);
        this.stpBridgeIdVal = this._bridgeIdBytesToBigInt(this.stpBridgeIdBytes);

        // root starts as self (in the same ID space!)
        this.stpRootId = this.stpBridgeIdVal;

        // Create ports FIRST
        for (let i = 0; i < numberOfPorts; i++) {
            this.addPort(new EthernetPort("" + i));
        }

        // Default: STP disabled => all forwarding
        this.stpForwarding = this.ports.map(() => true);
        this.stpRxBest = this.ports.map(() => null);
        this.stpPortLinkedLast = this.ports.map(p => p.isLinked());

        // If you want STP on by default:
        this.enableSTPFeature();
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
        this.stpRxBest = this.ports.map(() => null);
        this.stpForwarding = this.ports.map(() => true);

        // root resets to self
        this.stpRootId = this.stpBridgeIdVal;
        this.stpRootCost = 0;
        this.stpRootPort = null;

        this._stpLastSnapshot = "";
        this._stpForceEmit = false;
    }

    /**
     * Optional: deterministic override for experiments
     * Note: this changes the Ethernet source MAC derived from bridgeId,
     * so we also rebuild STP bridge identity.
     *
     * @param {bigint} id
     */
    setBridgeId(id) {
        this.bridgeId = id;

        // rebuild STP identity to match new MAC
        this.stpBridgeIdBytes = this._makeBridgeId(32768);
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
        this.stpForwarding.push(true);
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
     * @param {number} priority
     * @returns {Uint8Array}
     */
    _makeBridgeId(priority = 32768) {
        const mac = bigintToMac(this.bridgeId); // 6 bytes
        const out = new Uint8Array(8);
        const pr = priority & 0xffff;
        out[0] = (pr >> 8) & 0xff;
        out[1] = pr & 0xff;
        out.set(mac, 2);
        return out;
    }

    _initStpArrays() {
        this.stpRxBest = this.ports.map(() => null);
        this.stpForwarding = this.ports.map(() => true);
    }

    _resetStpToSelfRoot() {
        this.stpRootId = this.stpBridgeIdVal;
        this.stpRootCost = 0;
        this.stpRootPort = null;
        this.stpRxBest = this.ports.map(() => null);
        this.stpForwarding = this.ports.map(() => true);
    }

    /**
     * Snapshot for "emit BPDU on state change"
     * @returns {string}
     */
    _stpSnapshot() {
        const fw = this.stpForwarding.map(v => (v ? "1" : "0")).join("");
        return `${this.stpRootId.toString(16)}|${this.stpRootCost}|${this.stpRootPort ?? -1}|${fw}`;
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
     * @returns {Uint8Array}
     */
    _packConfigBpduPayload(rootId, cost, bridgeId, portId) {
        const bpdu = new STPBPDU({
            protocolId: 0x0000,
            protocolVersion: 0,
            bpduType: 0x00, // Configuration BPDU
            flags: 0,

            rootId,
            rootPathCost: cost >>> 0,
            bridgeId,
            portId: portId & 0xffff,

            // timers in 1/256s ticks (Wireshark likes sane defaults)
            messageAge: 0,
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
     * Recompute root / root port / forwarding ports.
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

        this.stpRootId = best.rootId;
        this.stpRootCost = bestPort == null ? 0 : best.cost;
        this.stpRootPort = bestPort;

        // designated-port election per segment:
        // our advertised tuple on that port vs neighbor's advertised tuple on that port
        const ourAdvBase = { rootId: this.stpRootId, cost: this.stpRootCost, bridgeId: this.stpBridgeIdVal };

        for (let i = 0; i < this.ports.length; i++) {
            if (!this.ports[i].isLinked()) {
                this.stpForwarding[i] = true;
                continue;
            }

            if (this.stpRootPort === i) {
                this.stpForwarding[i] = true;
                continue;
            }

            const rx = this.stpRxBest[i];
            if (!rx) {
                // no neighbor info => assume designated
                this.stpForwarding[i] = true;
                continue;
            }

            const ourTuple = { ...ourAdvBase, portId: this._makePortId(i) };
            const neighTuple = rx;

            // If our tuple is better, we are designated => forward, else block
            this.stpForwarding[i] = compareTuple(ourTuple, neighTuple) < 0;
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

    _emitBPDUs() {
        const srcMac = bigintToMac(this.bridgeId);
        const ourBridgeIdBytes = this.stpBridgeIdBytes;

        const rootIdBytes =
            (this.stpRootId === this.stpBridgeIdVal)
                ? ourBridgeIdBytes
                : this._bigIntTo8Bytes(this.stpRootId);

        for (let i = 0; i < this.ports.length; i++) {
            const p = this.ports[i];
            if (!p.isLinked()) continue;

            const payload = this._packConfigBpduPayload(
                rootIdBytes,
                this.stpRootCost >>> 0,
                ourBridgeIdBytes,
                this._makePortId(i)
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

    /**
     * Clear neighbor info for ports that changed link state and trigger recompute.
     * Timer-free topology change handling.
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

                    // Handle only config BPDUs in this simplified sim
                    if (bpdu && bpdu.bpduType === 0x00) {
                        const rx = {
                            rootId: this._bridgeIdBytesToBigInt(bpdu.rootId),
                            cost: bpdu.rootPathCost >>> 0,
                            bridgeId: this._bridgeIdBytesToBigInt(bpdu.bridgeId),
                            portId: bpdu.portId & 0xffff,
                        };

                        const prev = this.stpRxBest[i];
                        if (!prev || compareTuple(rx, prev) < 0) {
                            this.stpRxBest[i] = rx;
                            this._recomputeStpAndMaybeEmit();
                        }
                    }

                    continue; // do not forward BPDUs as data
                }

                // After BPDU handling, enforce STP on ingress for DATA frames.
                // Blocking ports must not forward user traffic (only BPDUs are processed above).
                if (this.stpEnabled && !this.stpForwarding[i]) {
                    continue; // drop data frame arriving on a blocked port
                }

                // ---------------- Data forwarding ----------------
                // When STP enabled: never forward OUT of blocked ports.

                // VLAN DISABLED
                if (!this.vlanEnabled) {
                    // Learn source MAC globally
                    const srcKey = MACToNumber(frame.srcMac);
                    this.sat.set(srcKey, i);

                    const isBroadcast = isEqualUint8(frame.dstMac, new Uint8Array([255, 255, 255, 255, 255, 255]));
                    if (isBroadcast) {
                        for (let j = 0; j < this.ports.length; j++) {
                            if (j === i) continue;
                            if (this.stpEnabled && !this.stpForwarding[j]) continue;
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
                            if (this.stpEnabled && !this.stpForwarding[j]) continue;
                            this.ports[j].send(frame);
                        }
                    } else {
                        // Known unicast -> forward (but don't loop back to ingress)
                        if (outIndex === i) continue;
                        if (this.stpEnabled && !this.stpForwarding[outIndex]) continue;
                        this.ports[outIndex].send(frame);
                    }

                    continue;
                }

                // VLAN ENABLED
                const vid = this.getIngressVid(inPort, frame);
                if (vid == null) continue; // dropped by VLAN ingress rules

                // Learn source MAC per VLAN
                const srcKey = MACToNumber(frame.srcMac);
                let vlanMap = this.sat.get(vid);
                if (!vlanMap) {
                    vlanMap = new Map();
                    this.sat.set(vid, vlanMap);
                }
                vlanMap.set(srcKey, i);

                const isBroadcast = isEqualUint8(frame.dstMac, new Uint8Array([255, 255, 255, 255, 255, 255]));
                const dstKey = MACToNumber(frame.dstMac);
                const outIndex = isBroadcast ? null : (this.sat.get(vid)?.get(dstKey) ?? null);

                if (isBroadcast || outIndex == null) {
                    // Flood within VLAN
                    for (let j = 0; j < this.ports.length; j++) {
                        if (j === i) continue;
                        if (this.stpEnabled && !this.stpForwarding[j]) continue;

                        const outPort = this.ports[j];
                        if (!this.portAllowsVid(outPort, vid)) continue;
                        this.sendOut(vid, outPort, frame);
                    }
                } else {
                    // Known unicast
                    if (outIndex === i) continue;
                    if (this.stpEnabled && !this.stpForwarding[outIndex]) continue;

                    const outPort = this.ports[outIndex];
                    if (!this.portAllowsVid(outPort, vid)) continue;
                    this.sendOut(vid, outPort, frame);
                }
            }
        }
    }
}
