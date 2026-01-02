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

        // Optional: Links regelmäßig refreshen (z.B. falls Layout/Fonts ändern)
        this.redrawLinks();

        window.setTimeout(() => this.step(), SimControl.tick);
    }

    /**
     * @param {SimulatedObject} obj
     */
    addObject(obj) {
        if (this.simobjects.includes(obj)) return;
        this.simobjects.push(obj);
        this.renderField();
    }


    /**
     * 
     * @param {SimulatedObject} obj 
     */
    setFocus(obj) {
        this.focusedObject = obj;
        this.render();
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

    renderField() {
        const root = this.Fieldroot;
        if (!root) return;

        root.replaceChildren();
        root.classList.add("sim-root");

        // SVG Layer für Links
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("sim-links");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        root.appendChild(svg);
        this.svg = svg;

        // Nodes Layer
        const nodes = document.createElement("div");
        nodes.className = "sim-nodes";
        root.appendChild(nodes);
        this.nodesLayer = nodes;

        // Nodes rendern
        for (const obj of this.simobjects) {
            if (obj instanceof Link) continue;
            const el = obj.renderIcon();
            nodes.appendChild(el);
            this.enableDragging(obj, el);
        }

        this.redrawLinks();
    }

    redrawLinks() {
        if (!this.svg || !this.Fieldroot) return;
        this.svg.replaceChildren();

        const rootRect = this.Fieldroot.getBoundingClientRect();

        /*for (const obj of this.simobjects) {
            if (!(obj instanceof Link)) continue;

            const a = obj.a;
            const b = obj.b;

            // Port-Positionen in Screen-Koords
            const pa = a.getPortPosition(obj.portA);
            const pb = b.getPortPosition(obj.portB);

            // Umrechnen in Workspace-Koords (relativ zum root)
            const x1 = pa.x - rootRect.left;
            const y1 = pa.y - rootRect.top;
            const x2 = pb.x - rootRect.left;
            const y2 = pb.y - rootRect.top;

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", String(x1));
            line.setAttribute("y1", String(y1));
            line.setAttribute("x2", String(x2));
            line.setAttribute("y2", String(y2));
            this.svg.appendChild(line);
        }
        */
    }

    /**
     * @param {SimulatedObject} obj
     * @param {HTMLElement} el
     */
    enableDragging(obj, el) {
        let dragging = false;
        let startX = 0, startY = 0;
        let baseX = 0, baseY = 0;

        /**@param {any} e */
        const onPointerDown = (e) => {
            // Port-Klicks später für "Link ziehen" reservieren:
            const target = e.target;
            if (target instanceof HTMLElement && target.classList.contains("sim-port")) return;

            dragging = true;
            el.setPointerCapture(e.pointerId);
            startX = e.clientX;
            startY = e.clientY;
            baseX = obj.x;
            baseY = obj.y;
            e.preventDefault();
        };

        /**@param {any} e */
        const onPointerMove = (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            obj.x = baseX + dx;
            obj.y = baseY + dy;

            el.style.left = obj.x + "px";
            el.style.top = obj.y + "px";

            this.redrawLinks();
        };

        /**@param {any} e */
        const onPointerUp = (e) => {
            dragging = false;
            try { el.releasePointerCapture(e.pointerId); } catch { }
        };

        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("pointermove", onPointerMove);
        el.addEventListener("pointerup", onPointerUp);
        el.addEventListener("pointercancel", onPointerUp);
    }


}
