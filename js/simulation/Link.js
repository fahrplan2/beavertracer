//@ts-check

import { EthernetPort } from "../devices/EthernetPort.js";
import { EthernetLink } from "../devices/EthernetLink.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { Router } from "./Router.js";
import { Switch } from "./Switch.js";
import { PC } from "./PC.js";

export class Link extends SimulatedObject {

    link;
    A;
    B;

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
        this.A = A;
        this.B = B;
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

    /**@override */
    render() {
        this.root.className = "sim-link";
        this.root.textContent = this.name;
        return this.root;
    }


    redrawLinks() {
        if (!this.root || !(this.root instanceof HTMLElement)) return;

        const line = this.root;

        const x1 = this.A.getX();
        const y1 = this.A.getY();
        const x2 = this.B.getX();
        const y2 = this.B.getY();

        const dx = x2 - x1;
        const dy = y2 - y1;

        const length = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        line.style.width = `${length}px`;
        line.style.left = `${x1}px`;
        line.style.top = `${y1}px`;
        line.style.transform = `rotate(${angle}deg)`;
    }
}
