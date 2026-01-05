//@ts-check

import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { IPStack } from "../devices/IPStack.js";
import { SimulatedObject } from "./SimulatedObject.js";

export class Router extends SimulatedObject {

    /**
     *  @type { IPStack } 
     */
    net;

    /**
     * @type {VirtualFileSystem}
     */
    fs;

    /**
     * 
     * @param {String} name 
     */
    constructor(name='Router') {
        super(name);
        this.net = new IPStack(2,name);
        this.fs = new VirtualFileSystem();
    }

    /** 
     * @type {HTMLElement} Element where everything gets renderd into
     */
    root = document.createElement("div");

    render () {
        return this.root;
    }
}