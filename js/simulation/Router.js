//@ts-check

import { IPStack } from "../devices/IPStack.js";
import { SimulatedObject } from "./SimulatedObject.js";

export class Router extends SimulatedObject {

    device;

    /**
     * 
     * @param {String} name 
     */
    constructor(name='Router') {
        super(name);
        this.device = new IPStack(2,name);
    }
}