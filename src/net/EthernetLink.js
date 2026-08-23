//@ts-check

import { Link } from "../sim/Link.js";
import { EthernetPort } from "./EthernetPort.js";

/**
 * This class simulates a simple physical link between two ports
 */
export class EthernetLink {

    portA;
    portB;

    /** @type {Link | undefined} */
    link;

    /** Maximum Transmission Unit in bytes (Ethernet default: 1500) */
    mtu = 1500;

    /** When true, no frames are transferred — simulates a broken cable. */
    broken = false;

    /** Fraction (0..1) of frames dropped per direction — simulates a lossy/unreliable link. */
    lossRate = 0;

    /** @type {*} */
    AtoB;

    /** @type {*} */
    BtoA;

    /**
     * 
     * @param {EthernetPort} A 
     * @param {EthernetPort} B 
     */
    constructor(A,B) {
        if(!(A instanceof EthernetPort)) {
            throw new Error("Link must be connected to a Port")
        } 
        if(!(B instanceof EthernetPort)) {
            throw new Error("Link must be connected to a Port")
        } 

        this.portA = A;
        A.link(this);
        this.portB = B;
        B.link(this);
    }
    
    step1() {
        this._startTransfer();    
    }

    step2() {
        this._endTransfer();
    }

    _startTransfer() {
        if (this.broken) return;
        this.AtoB = this._maybeDrop(this.portA.getNextOutgoingFrame());
        this.BtoA = this._maybeDrop(this.portB.getNextOutgoingFrame());
    }

    /**
     * Randomly discards a frame according to lossRate, simulating packet
     * loss on an otherwise-working link. The frame has already left the
     * sending port (and is thus visible in its own capture) — it simply
     * never arrives at the other end, just like a real dropped packet.
     * @param {Uint8Array|null} frame
     * @returns {Uint8Array|null}
     */
    _maybeDrop(frame) {
        if (frame == null || this.lossRate <= 0) return frame;
        return Math.random() < this.lossRate ? null : frame;
    }

    _endTransfer() {
        if(this.AtoB != null) {
            this.portB.recieve(this.AtoB);
            this.AtoB = null;
        }
        if(this.BtoA != null) {
            this.portA.recieve(this.BtoA);
            this.BtoA = null;
        }
    }

    destroy() {
        this.portA.unlink();
        this.portB.unlink();
    }
}