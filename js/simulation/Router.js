//@ts-check

import { IPForwarder } from "../devices/IPForwarder.js";
import { SimulatedObject } from "./SimulatedObject.js";

export class Router extends SimulatedObject {

    device;

    /**
     * 
     * @param {String} name 
     */
    constructor(name='Router') {
        super(name);
        this.device = new IPForwarder(2,name);
    }
}