//@ts-check

import { IPForwarder } from "../devices/IPForwarder.js";
import { SimulatedObject } from "./SimulatedObject.js";

export class PC extends SimulatedObject{

    device;

    /**
     * 
     * @param {String} name 
     */
    constructor(name="PC") {
        super(name);
        this.device = new IPForwarder(1,name);
    }

}