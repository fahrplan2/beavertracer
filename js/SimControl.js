//@ts-check

import { Link } from "./simulation/Link.js";
import { SimulatedObject } from "./simulation/SimulatedObject.js";

export class SimControl {
    static tick = 100;
    static drawtick = 100;

    /** @type { Array<SimulatedObject> } */
    simobjects;

    endStep=false;

    constructor() {
        this.simobjects=[];
        window.setTimeout(() => this.draw(), SimControl.tick);
        window.setTimeout(() => this.step(), SimControl.drawtick);

    }

    draw() {
        window.setTimeout(() => this.draw(), SimControl.drawtick);
    }

    step() {
        try {
            for(let i=0;i<this.simobjects.length;i++) {
                const x = this.simobjects[i];
                if (x instanceof Link) {
                    if(this.endStep) {
                        x.step2();
                    } else {
                        x.step1();
                    }
                }
            }
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
        }
        this.endStep = !this.endStep;
        window.setTimeout(() => this.step(), SimControl.tick);
    }

    /**
     * 
     * @param {SimulatedObject} obj 
     */
    addObject(obj) {
        if(this.simobjects.includes(obj)) {
            return;
        }
        this.simobjects.push(obj);
    }
       
}