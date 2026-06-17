//@ts-check

import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { Observable } from "../lib/Observeable.js";
import { LoggedFrame } from "../tracer/loggedFrame.js";
import { EthernetLink } from "./EthernetLink.js";


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
     */
    send(frame) {
        if (!(frame instanceof EthernetFrame)) {
            throw new Error("Can only send EthernetFrame");
        }
        if(this.outBuffer.length > 100) {
            //Skip packet if queue is too big
            return;
        }
        this.outBuffer.push(frame);
        this.loggedFrames.push(new LoggedFrame(frame.pack()));
        if (this.loggedFrames.length > EthernetPort.MAX_LOGGED_FRAMES) this.loggedFrames.shift();
        this.frameSeq++;
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
        this.loggedFrames.push(new LoggedFrame(bytes));
        if (this.loggedFrames.length > EthernetPort.MAX_LOGGED_FRAMES) this.loggedFrames.shift();
        this.frameSeq++;
        this.doUpdate();
    }

    getNextOutgoingFrame() {
        let frame = this.outBuffer.shift();
        if (frame == null) {
            return null;
        }
        return frame.pack();
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
        return this.linkref != null;
    }
}