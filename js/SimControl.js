//@ts-check
import { SimulatedObject } from "./simulation/SimulatedObject.js";
import { Link } from "./simulation/Link.js";

export class SimControl {
    static tick = 100;

    /** @type {Array<SimulatedObject>} */
    simobjects;
    endStep = false;

    /** @type {HTMLElement|null} */
    root;

    /** @type {HTMLElement|null} */
    Fieldroot;

    /** @type {SVGSVGElement|null} */
    svg = null;

    /** @type {HTMLDivElement|null} */
    nodesLayer = null;


    /**
     * @type {HTMLElement|null} movement Boundary for user drag&drop
     */
    static movementBoundary;

    /**
     * 
     * @param {HTMLElement|null} root 
     * @param {HTMLElement|null} Fieldroot
     */
    constructor(root, Fieldroot) {
        this.simobjects = [];
        this.root = root;
        this.Fieldroot=Fieldroot;
        this.render();
        window.setTimeout(() => this.step(), SimControl.tick);
    }


    step() {
        try {
            for (let i = 0; i < this.simobjects.length; i++) {
                const x = this.simobjects[i];
                if (x instanceof Link) {
                    if (this.endStep) x.step2?.();
                    else x.step1?.();
                }
            }
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
        }
        this.endStep = !this.endStep;
        window.setTimeout(() => this.step(), SimControl.tick);
    }

    /**
     * @param {SimulatedObject} obj
     */
    addObject(obj) {
        if (this.simobjects.includes(obj)) return;
        this.simobjects.push(obj);
        this.render();
    }

    /**
     * 
     * @param {SimulatedObject} obj 
     */
    setFocus(obj) {
        this.focusedObject = obj;
        this.render();
    }

    render() {
        const root = this.Fieldroot;
        if (!root) return;

        root.replaceChildren();
        root.classList.add("sim-root");

        //layer for all the nodes
        const nodes = document.createElement("div");
        nodes.className = "sim-nodes";
        root.appendChild(nodes);
        this.nodesLayer = nodes;

        // render the nodes
        for (const obj of this.simobjects) {
            const el = obj.render();
            el.addEventListener("pointermove", () =>{
                this.redrawLinks();
            });
            nodes.appendChild(el);
        }

        this.redrawLinks();

        SimControl.movementBoundary = root;
    }

    redrawLinks() {
        for (const obj of this.simobjects) {
            if(obj instanceof Link) {
                obj.redrawLinks();
            }
        }
    }
}
