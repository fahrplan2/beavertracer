//@ts-check

import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { Observable } from "../lib/Observeable.js";
import { LoggedFrame } from "../tracer/loggedFrame.js";
import { EthernetLink } from "./EthernetLink.js";
import { isTrafficSuppressed } from "../lib/CheckState.js";


/**
 * This class simulates an "Layer 2" ethernet Port
 */
export class EthernetPort extends Observable {

    /** @type {Array<EthernetFrame>} */
    outBuffer = [];

    /** @type {Array<EthernetFrame>} */
    inBuffer = [];

    /** @type {Array<LoggedFrame>} */
    loggedFrames = [];

    /** Monotonically increasing counter — never decreases, even when ring buffer wraps */
    frameSeq = 0;

    static MAX_LOGGED_FRAMES = 10_000;

    /** @type {EthernetLink|Null} */
    linkref = null;

    /** @type {string} */

    name;

    /** @type {"tagged"|"untagged"|"hybrid"} */
    vlanMode = "untagged";

    /** Port VLAN ID for untagged ingress / untagged membership */
    pvid = 1;

    /** @type {Set<number>} */
    allowedVlans = new Set([1]);

    /** Outer S-VID for QinQ (IEEE 802.1ad). null = no QinQ. @type {number|null} */
    svid = null;

    /**
     * Control frames (e.g. BPDUs) queued with priority. They sit at the head of
     * outBuffer, bypass the queue limit and survive discardQueuedData().
     * @type {WeakSet<EthernetFrame>}
     */
    #priorityFrames = new WeakSet();

    /**
     * 
     * @param {string} name 
     */
    constructor(name) {
        super();
        this.name = name;
    }


    setTagged(allowed = [1], pvid = 1) {
        this.vlanMode = "tagged";
        this.allowedVlans = new Set(allowed);
        this.pvid = pvid;
    }

    setUntagged(pvid = 1) {
        this.vlanMode = "untagged";
        this.pvid = pvid;
        // allowedVlans not used
    }

    /**
     * Hybrid: pvid exits untagged, allowedVlans are forwarded tagged.
     * @param {number} pvid
     * @param {number[]} allowed
     */
    setHybrid(pvid = 1, allowed = []) {
        this.vlanMode = "hybrid";
        this.pvid = pvid;
        this.allowedVlans = new Set(allowed);
    }

    /**
     *
     * @param {EthernetFrame} frame
     * @param {boolean} [priority] control frame: jump ahead of queued data, never dropped
     */
    send(frame, priority = false) {
        if (!(frame instanceof EthernetFrame)) {
            throw new Error("Can only send EthernetFrame");
        }
        if (priority) {
            // Strict priority queue (like the control-plane CoS queue on real switches):
            // behind earlier control frames, ahead of all data frames
            let pos = this.outBuffer.findIndex(f => !this.#priorityFrames.has(f));
            if (pos < 0) pos = this.outBuffer.length;
            this.#priorityFrames.add(frame);
            this.outBuffer.splice(pos, 0, frame);
        } else if(this.outBuffer.length > 100) {
            //Skip packet if queue is too big
            return;
        } else {
            this.outBuffer.push(frame);
        }
        // Synthetic traffic from an active ":::task" check still gets
        // delivered (see below) — only its visibility in the capture log
        // is suppressed, so the check itself is unaffected. frameSeq must
        // stay in lockstep with loggedFrames.length — PCapController (the
        // only consumer of frameSeq) assumes frameSeq counts exactly the
        // frames that were actually appended, and slices loggedFrames by
        // that assumption; incrementing it without appending desyncs the
        // two and corrupts its next incremental read.
        if (!isTrafficSuppressed()) {
            this.loggedFrames.push(new LoggedFrame(frame.pack()));
            if (this.loggedFrames.length > EthernetPort.MAX_LOGGED_FRAMES) this.loggedFrames.shift();
            this.frameSeq++;
        }
        this.doUpdate();
    }

    /**
     *
     * @param {Uint8Array} bytes
     */
    recieve(bytes) {
        if(this.inBuffer.length > 100) {
            //Skip packet if queue is too big
            return;
        }

        let frame = EthernetFrame.fromBytes(bytes);
        this.inBuffer.push(frame);
        // See send() above — frameSeq must only advance alongside loggedFrames.
        if (!isTrafficSuppressed()) {
            this.loggedFrames.push(new LoggedFrame(bytes));
            if (this.loggedFrames.length > EthernetPort.MAX_LOGGED_FRAMES) this.loggedFrames.shift();
            this.frameSeq++;
        }
        this.doUpdate();
    }

    getNextOutgoingFrame() {
        let frame = this.outBuffer.shift();
        if (frame == null) {
            return null;
        }
        return frame.pack();
    }

    /**
     * Drop all queued data frames; priority (control) frames stay queued.
     * Used when a port leaves the Forwarding state (IEEE 802.1D: a non-forwarding
     * port must not transmit data frames, including ones queued earlier).
     */
    discardQueuedData() {
        this.outBuffer = this.outBuffer.filter(f => this.#priorityFrames.has(f));
    }

    getNextIncomingFrame() {
        if (this.inBuffer.length == 0) {
            return null;
        }
        return this.inBuffer.shift();
    }

    /**
     * 
     * @param {EthernetLink} link 
     */
    link(link) {
        this.linkref = link;
        this.doUpdate();
    }

    unlink() {
        this.linkref = null;
        this.inBuffer = [];
        this.outBuffer = [];
        this.loggedFrames = [];
        this.frameSeq = 0;
        this.doUpdate();
    }

    /** @returns {boolean} */
    isFree() {
        return this.linkref == null;
    }

    /** @returns {boolean} */
    isLinked() {
        return this.linkref != null && !this.linkref.broken;
    }
}