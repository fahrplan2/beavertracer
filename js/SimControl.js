//@ts-check
import { SimulatedObject } from "./simulation/SimulatedObject.js";
import { Link } from "./simulation/Link.js";

export class SimControl {
    static tick = 1000;

    /** @type {Array<SimulatedObject>} */
    simobjects;
    endStep = false;

    /** @type {HTMLElement|null} */
    root;

    /** @type {HTMLElement|null} */
    Fieldroot;

    /** @type {HTMLDivElement|null} */
    nodesLayer = null;

    /** @type {number|null} */
    timeoutId = null;

    isPaused = false;

    /**
     * @type {HTMLElement|null} movement Boundary for user drag&drop
     */
    static movementBoundary;

    /**
     * @param {HTMLElement|null} root
     * @param {HTMLElement|null} Fieldroot
     */
    constructor(root, Fieldroot) {
        this.simobjects = [];
        this.root = root;
        this.Fieldroot = Fieldroot;
        this.render();
        this.scheduleNextStep();
    }

    scheduleNextStep() {
        if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
        if (this.isPaused) return;
        this.timeoutId = window.setTimeout(() => this.step(), SimControl.tick);
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

        this.redrawLinks();
        this.endStep = !this.endStep;
        this.scheduleNextStep();
    }

    /** @param {SimulatedObject} obj */
    addObject(obj) {
        if (this.simobjects.includes(obj)) return;
        this.simobjects.push(obj);
        this.render();
    }

    /** @param {SimulatedObject} obj */
    setFocus(obj) {
        // @ts-ignore (falls focusedObject nicht typisiert ist)
        this.focusedObject = obj;
        this.render();
    }

    setTick(ms) {
        // sinnvolle Grenzen
        SimControl.tick = Math.max(16, Math.min(5000, Math.round(ms)));
        this.render(); // Toolbar-Label aktualisieren
        this.scheduleNextStep(); // sofort neue Geschwindigkeit übernehmen
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        this.render(); // Button-Text aktualisieren
        this.scheduleNextStep();
    }

    render() {
        const root = this.Fieldroot;
        if (!root) return;

        root.replaceChildren();
        root.classList.add("sim-root");

        // ====== Toolbar oben ======
        const toolbar = document.createElement("div");
        toolbar.className = "sim-toolbar";
        root.appendChild(toolbar);

        // Play/Pause
        const btnPause = document.createElement("button");
        btnPause.type = "button";
        btnPause.textContent = this.isPaused ? "▶ Play" : "⏸ Pause";
        btnPause.addEventListener("click", () => this.togglePause());
        toolbar.appendChild(btnPause);

        // Speed buttons
        const speeds = [
            { label: "0.25×", ms: 4000 },
            { label: "0.5×", ms: 2000 },
            { label: "1×", ms: 1000 },
            { label: "2×", ms: 500 },
            { label: "4×", ms: 250 },
        ];

        for (const s of speeds) {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = s.label;
            if (SimControl.tick === s.ms) b.classList.add("active");
            b.addEventListener("click", () => this.setTick(s.ms));
            toolbar.appendChild(b);
        }

        // ====== Nodes Layer ======
        const nodes = document.createElement("div");
        nodes.className = "sim-nodes";
        root.appendChild(nodes);
        this.nodesLayer = nodes;
        SimControl.movementBoundary = nodes;

        for (const obj of this.simobjects) {
            const el = obj.render();
            el.addEventListener("pointermove", () => {
                this.redrawLinks();
            });
            nodes.appendChild(el);
        }

        this.redrawLinks();
        
    }

    redrawLinks() {
        for (const obj of this.simobjects) {
            if (obj instanceof Link) {
                obj.redrawLinks();
                obj.renderPacket(SimControl.tick);
            }
        }
    }
}
