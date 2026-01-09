//@ts-check

import { EthernetFrame } from "../pdu/EthernetFrame.js";
import { Observable } from "../common/Observeable.js";
import { LoggedFrame } from "../pcap/loggedFrame.js";
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

    /** @type {EthernetLink|Null} */
    linkref = null;

    /** @type {string} */

    name;

    /** @type {"tagged"|"untagged"} */
    vlanMode = "untagged";

    /** Port VLAN ID for untagged ingress / untagged membership */
    pvid = 1;

    /** @type {Set<number>} */
    allowedVlans = new Set([1]);

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
     * 
     * @param {EthernetFrame} frame 
     */
    send(frame) {
        if (!(frame instanceof EthernetFrame)) {
            throw new Error("Can only send EthernetFrame");
        }
        this.outBuffer.push(frame);
        this.loggedFrames.push(new LoggedFrame(frame.pack()));
    }

    /**
     * 
     * @param {Uint8Array} bytes 
     */
    recieve(bytes) {
        let frame = EthernetFrame.fromBytes(bytes);
        this.inBuffer.push(frame);
        this.loggedFrames.push(new LoggedFrame(bytes));
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