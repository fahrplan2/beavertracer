//@ts-check

import { SwitchBackplane } from "../devices/SwitchBackplane.js";
import { SimulatedObject } from "./SimulatedObject.js";

export class Switch extends SimulatedObject {

    /** @type { SwitchBackplane } */
    device;

    /**
     * 
     * @param {String} name 
     */
    constructor(name) {
        super(name);
        this.device = new SwitchBackplane(4);
    }

}