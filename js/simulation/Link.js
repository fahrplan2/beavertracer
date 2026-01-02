//@ts-check

import { EthernetPort } from "../devices/EthernetPort.js";
import { EthernetLink } from "../devices/EthernetLink.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { Router } from "./Router.js";
import { Switch } from "./Switch.js";
import { PC } from "./PC.js";

export class Link extends SimulatedObject {

    link;

    /**
     * 
     * @param {SimulatedObject} A 
     * @param {SimulatedObject} B 
     */
    constructor(A, B) {
        super('Link');

        const portA = this._getNextFreePortFromObject(A);
        const portB = this._getNextFreePortFromObject(B);

        if (portA == null || portB == null) {
            throw new Error("No free ports availbie");
        }
        this.link = new EthernetLink(portA, portB);
    }

    /**
     * 
     * @param {SimulatedObject} obj 
     * @return {EthernetPort|null} 
     */

    _getNextFreePortFromObject(obj) {
        if (obj instanceof Switch) {
            return obj.device.getNextFreePort();
        }
        if (obj instanceof Router) {
            return obj.device.getNextFreeInterfacePort();
        }
        if (obj instanceof PC) {
            return obj.os.ipforwarder.getNextFreeInterfacePort();
        }
        return null;
    }

    step1() {
        this.link.step1();
    }

    step2() {
        this.link.step2();
    }

    destroy() {
        this.link.destroy();
    }

    renderIcon() {
        const dummy = document.createElement("div");
        return dummy;
    }
}
