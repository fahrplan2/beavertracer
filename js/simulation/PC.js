//@ts-check

import { OS } from "../apps/OS.js";
import { SimulatedObject } from "./SimulatedObject.js";

export class PC extends SimulatedObject {

    os;

    constructor(name='PC'){
        super(name);
        this.root.classList.add("pc");
        this.os = new OS(name);
        this.os.mount(this.root);
    }
    
}