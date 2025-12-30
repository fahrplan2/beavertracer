import { EthernetFrame } from "../pdu/EthernetFrame.js";
import { Observable } from "./Observeable.js";


/**
 * This class simulates an "Layer 2" ethernet Port
 */
export class EthernetPort extends Observable {

     /** @type {Array<EthernetFrame>} */
    outBuffer=[];

    /** @type {Array<EthernetFrame>} */
    inBuffer=[];


    /** @type {Array<Uint8Array>} */
    packetlog=[];


    /**
     * 
     * @param {EthernetFrame} frame 
     */
    send(frame){
        if(! (frame instanceof EthernetFrame)) {
            throw new Error("Can only send EthernetFrame");
        }
        this.outBuffer.push(frame);
        this.packetlog.push(frame.pack());
    }

    /**
     * 
     * @param {Uint8Array} bytes 
     */
    recieve(bytes) {
        let frame = EthernetFrame.fromBytes(bytes);
        this.inBuffer.push(frame);
        this.doUpdate();

        this.packetlog.push(bytes);
    }

    getNextOutgoingFrame() {
        if(this.outBuffer.length == 0) {
            return null;
        }
        return this.outBuffer.shift().pack();
    }

    getNextIncomingFrame() {
        if(this.inBuffer.length == 0) {
            return null;
        }
        return this.inBuffer.shift();
    }
}