//@ts-check

import { Link } from "./simulation/Link.js";
import { SimulatedObject } from "./simulation/SimulatedObject.js";

export class SimControl {
    static tick = 100;

    /** @type { Array<SimulatedObject> } */
    simobjects;
    endStep = false;

    /** @type {SimulatedObject|null} */
    focusedObject = null;

    /** @type {HTMLElement|null} */
    root;

    /**
     * 
     * @param {HTMLElement|null} root 
     */
    constructor(root) {
        this.simobjects = [];
        this.root = root;
        window.setTimeout(() => this.step(), SimControl.tick);
    }

    /**
     * 
     */
    render() {
        const root = this.root;
        if (!root) return;

        root.replaceChildren();

        if (!this.focusedObject) {
            const el = document.createElement("div");
            el.textContent = "NO Focus";
            root.appendChild(el);
            return;
        }

        if (!this.simobjects.includes(this.focusedObject)) {
            return;
        }

        root.appendChild(this.focusedObject.render());
    }

    /**
     * 
     * @param {SimulatedObject} obj 
     */
    setFocus(obj) {
        this.focusedObject = obj;
        this.render();
    }

    step() {
        try {
            for (let i = 0; i < this.simobjects.length; i++) {
                const x = this.simobjects[i];
                if (x instanceof Link) {
                    if (this.endStep) {
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
        if (this.simobjects.includes(obj)) {
            return;
        }
        this.simobjects.push(obj);
    }
}