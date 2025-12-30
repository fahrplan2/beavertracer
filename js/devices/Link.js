//@ts-check

import { EthernetPort } from "./EthernetPort.js";

/**
 * This class simulates a simple physical link between two ports
 */
export class Link {

    #portA;
    #portB;

    /** @type {*} */
    #AtoB;

    /** @type {*} */
    #BtoA;

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

        this.#portA = A;
        this.#portB = B;
    }
    
    step() {
        this.step1();
        this.step2();
    }

    step1() {
        this._startTransfer();    
    }

    step2() {
        this._endTransfer();
    }


    _startTransfer() {
        this.#AtoB = this.#portA.getNextOutgoingFrame();
        this.#BtoA = this.#portB.getNextOutgoingFrame();
    }

    _endTransfer() {
        if(this.#AtoB != null) {
            this.#portB.recieve(this.#AtoB);
            this.#AtoB = null;
        }
        if(this.#BtoA != null) {
            this.#portA.recieve(this.#BtoA);
            this.#BtoA = null;
        }
    }
}