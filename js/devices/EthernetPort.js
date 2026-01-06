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
        this.doUpdate();
        this.loggedFrames.push(new LoggedFrame(bytes));
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
    }

    unlink() {
        this.linkref = null;
        this.inBuffer = [];
        this.outBuffer = [];
        this.loggedFrames = [];
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