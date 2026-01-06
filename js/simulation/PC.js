//@ts-check

import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { OS } from "../apps/OS.js";
import { IPStack } from "../devices/IPStack.js";
import { SimulatedObject } from "./SimulatedObject.js";

export class PC extends SimulatedObject {

    /** @type {IPStack} */
    net;

    /** @type {OS} */
    os;

    constructor(name='PC'){
        super(name);
        this.root.classList.add("pc");
        this.fs = new VirtualFileSystem();
        this.net = new IPStack(1,name);
        this.os = new OS(name, this.fs, this.net);

        

        /**@param {HTMLElement} body */
        this.onPanelCreated = (body) => {
            this.os.mount(body);
        };
    }
    
    // Looking for the code of the PC? Look in ../apps/OS.js.

}