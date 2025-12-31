//@ts-check

import { isEqualUint8, MACToNumber } from "../helpers.js";
import { EthernetPort } from "./EthernetPort.js";
import { Observable } from "./Observeable.js";

export class SwitchBackplane extends Observable {
   
    /** @type {Array<EthernetPort>} */
    #ports = [];

    /** @type {Map<BigInt,Number>} */
    #sat=new Map();

    /**
     * @param {Number} numberOfPorts
     */
    constructor(numberOfPorts) {
        super();
        for(let i=0;i<numberOfPorts;i++) {
            this.addPort(new EthernetPort());
        }
    }   

    /**
     * 
     * @param {EthernetPort} port 
     */
    addPort(port) {
        this.#ports.push(port);
        port.subscribe(this);
    }

    /**
     * @param {Number} index 
     */
    getPort(index) {
        return this.#ports[index];
    }

    /**
     * gives a free Port from this device
     * @returns {EthernetPort|null} free Port
     */

    getNextFreePort() {
        for(let i=0;i<this.#ports.length;i++) {
            if(this.#ports[i].linkref == null) {
                return this.#ports[i];
            }
        }
        return null;
    }

    update() {
        //check all ports for new frames
        for(let i=0;i<this.#ports.length;i++) {
            let frame = this.#ports[i].getNextIncomingFrame();
            if(frame==null){
                continue;
            }

            //Learn the MAC
            this.#sat.set(MACToNumber(frame.srcMac),i);

            //We have a broadcast-frame, forward everywehre except sender
            if(isEqualUint8(frame.dstMac,new Uint8Array([255,255,255,255,255,255]))) {
                for(let j=0;j<this.#ports.length;j++) {
                    if(i==j) {
                        continue;
                    }
                    this.#ports[j].send(frame);
                }
                return;
            }

            //Try to forward to one specific port from the SAT
            const port = this.#sat.get(MACToNumber(frame.dstMac));

            if(port==null) {
                //defaults to "everyone but sender", if mac is unknown
                for(let j=0;j<this.#ports.length;j++) {
                    if(i==j) {
                        continue;
                    }
                    this.#ports[j].send(frame);
                }
            } else {
                this.#ports[port].send(frame);
            }
        }
    }
}