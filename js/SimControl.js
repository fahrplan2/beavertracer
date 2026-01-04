//@ts-check
import { SimulatedObject } from "./simulation/SimulatedObject.js";
import { Link } from "./simulation/Link.js";
import { PCapViewer } from "./pcap/PCapViewer.js";
import { TabController } from "./TabControler.js";
import { PC } from "./simulation/PC.js";
import { Switch } from "./simulation/Switch.js";
import { Router } from "./simulation/Router.js";

export class SimControl {
    static tick = 500;

    /** @type {Array<SimulatedObject>} */
    simobjects;
    endStep = false;

    /** @type {HTMLElement|null} */
    root;

    /** @type {HTMLDivElement|null} */
    nodesLayer = null;

    /** @type {number|null} */
    timeoutId = null;

    isPaused = false;

    tickId = 0;

    /** @type {boolean} */
    static isEditMode = false;

    /** @type {"select"|"place-pc"|"place-switch"|"place-router"|"link"|"delete"} */
    tool = "select";

    /** @type {SimulatedObject|null} */
    linkStart = null;

    /** @type {HTMLDivElement|null} */
    ghostLink = null;

    /** @type {HTMLDivElement|null} */
    ghostNodeEl = null;

    /** @type {"place-pc"|"place-switch"|"place-router"|null} */
    ghostNodeType = null;

    /** @type {boolean} */
    ghostReady = false;

    /**
     * @type {HTMLElement|null} movement Boundary for user drag&drop
     */
    static movementBoundary;

    /**
     * @type {PCapViewer}
     */
    static pcapViewer;

    /**
     * @type {TabController}
     */

    static tabControler;

    /**
     * @param {HTMLElement|null} root
     */
    constructor(root) {
        this.simobjects = [];
        this.root = root;
        this.render();
        this.scheduleNextStep();
        this._startRafLoop();
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
                    if (this.endStep) {
                        x.step2();
                    } else {
                        x.step1();
                        this.tickId++;
                    }
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

    /**
     * @param {number} ms 
     */
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
        const root = this.root;
        if (!root) return;

        root.replaceChildren();
        root.classList.add("sim-root");

        //*********** TOOLBAR ***********


        const toolbar = document.createElement("div");
        toolbar.className = "sim-toolbar";
        root.appendChild(toolbar);


        /** @param {string} title */
        const addGroup = (title) => {
            const g = document.createElement("div");
            g.className = "sim-toolbar-group";

            const label = document.createElement("div");
            label.className = "sim-toolbar-group-label";
            label.textContent = title;

            const buttons = document.createElement("div");
            buttons.className = "sim-toolbar-buttons";

            g.appendChild(label);
            g.appendChild(buttons);
            toolbar.appendChild(g);

            return buttons;
        };

        const addSeparator = () => {
            const sep = document.createElement("div");
            sep.className = "sim-toolbar-sep";
            toolbar.appendChild(sep);
        };


        // --- Project group
        addSeparator();
        const gProject = addGroup("Project");


        // New
        const btnNew = document.createElement("button");
        btnNew.type = "button";
        btnNew.textContent = "New";
        btnNew.addEventListener("click", () => {
            if (!confirm("Discard current simulation and start a new one?")) return;
            this.newScene();
        });
        gProject.appendChild(btnNew);

        // Load
        const btnLoad = document.createElement("button");
        btnLoad.type = "button";
        btnLoad.textContent = "Load";
        btnLoad.addEventListener("click", () => {
            if (!confirm("Discard current simulation and load another one?")) return;
            this.openLoadDialog();
        });
        gProject.appendChild(btnLoad);

        // Save
        const btnSave = document.createElement("button");
        btnSave.type = "button";
        btnSave.textContent = "Save";
        btnSave.addEventListener("click", () => this.downloadScene());
        gProject.appendChild(btnSave);



        // --- Edit group
        addSeparator();
        const gEdit = addGroup("Edit");

        // Edit toggle
        const btnEdit = document.createElement("button");
        btnEdit.type = "button";
        btnEdit.textContent = SimControl.isEditMode ? "Exit Edit" : "Edit";
        btnEdit.addEventListener("click", () => {
            SimControl.isEditMode = !SimControl.isEditMode;
            this.tool = "select";
            if (this.root) {
                this.root.classList.toggle("edit-mode", SimControl.isEditMode);
                this.root.dataset.tool = this.tool;
            }
            SimulatedObject.closeAllPanels();

            //Delete Cursor "icon"
            if (!SimControl.isEditMode) {
                delete this.root.dataset.tool;
            }
            this._cancelLinking();
            this._removeGhostNode();
            this.render();
        });
        gEdit.appendChild(btnEdit);

        // Tool buttons (only show in edit mode)
        if (SimControl.isEditMode) {
            const tools = [
                ["select", "Select"],
                ["place-pc", "PC"],
                ["place-switch", "Switch"],
                ["place-router", "Router"],
                ["link", "Link"],
                ["delete", "Delete"],
            ];

            for (const [id, label] of tools) {
                const b = document.createElement("button");
                b.type = "button";
                b.textContent = label;
                if (this.tool === id) b.classList.add("active");
                b.addEventListener("click", () => {
                    this.tool = /** @type {any} */ (id);
                    if (this.root) {
                        this.root.dataset.tool = this.tool;
                    }


                    if (this.tool !== "link") this._cancelLinking();
                    if (!(this.tool === "place-pc" || this.tool === "place-switch" || this.tool === "place-router")) {
                        this._removeGhostNode();
                    }

                    this.render();
                });
                gEdit.appendChild(b);
            }
        }

        addSeparator();
        const gSpeeds = addGroup("Speed");

        // Play/Pause
        const btnPause = document.createElement("button");
        btnPause.type = "button";
        btnPause.textContent = this.isPaused ? " Play" : "Pause";
        btnPause.addEventListener("click", () => this.togglePause());
        gSpeeds.appendChild(btnPause);

        // Speed buttons
        const speeds = [
            { label: "0.25×", ms: 2000 },
            { label: "0.5×", ms: 1000 },
            { label: "1×", ms: 500 },
            { label: "2×", ms: 200 },
            { label: "4×", ms: 100 },
            { label: "8×", ms: 50 },
        ];

        for (const s of speeds) {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = s.label;
            if (SimControl.tick === s.ms) b.classList.add("active");
            b.addEventListener("click", () => this.setTick(s.ms));
            gSpeeds.appendChild(b);
        }

        //End of toolbar

        //********* NODES LAYER ***************
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

        if (this.nodesLayer) {
            // avoid stacking listeners after rerender
            this.nodesLayer.onpointerdown = (ev) => this._onPointerDown(ev);
            this.nodesLayer.onpointermove = (ev) => this._onPointerMove(ev);

            // cancel link with right click
            this.nodesLayer.oncontextmenu = (ev) => {
                if (SimControl.isEditMode && this.tool === "link" && this.linkStart) {
                    ev.preventDefault();
                    this._cancelLinking();
                }
            };

            // ESC cancels link
            window.onkeydown = (ev) => {
                if (ev.key === "Escape") this._cancelLinking();
            };
        }

    }

    redrawLinks() {
        for (const obj of this.simobjects) {
            if (obj instanceof Link) {
                obj.redrawLinks();
            }
        }
    }

    saveScene() {
        const nodes = [];
        const links = [];

        for (const o of this.simobjects) {
            if (o instanceof Link) {
                links.push({ id: o.id, type: "Link", a: o.A.id, b: o.B.id });
            } else {
                nodes.push({
                    id: o.id,
                    type: o.constructor?.name ?? "Node",
                    name: o.name,
                    x: o.x, y: o.y,
                    px: o.px, py: o.py,
                    panelOpen: !!o.panelOpen
                });
            }
        }

        return {
            version: 1,
            tick: SimControl.tick,
            nodes,
            links
        };
    }

    downloadScene() {
        const json = JSON.stringify(this.saveScene(), null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "simulation.json";
        a.click();

        URL.revokeObjectURL(url);
    }

    /** @param {any} scene */
    loadScene(scene) {
        // basic validation
        if (!scene || !Array.isArray(scene.nodes) || !Array.isArray(scene.links)) {
            console.warn("Invalid scene file");
            return;
        }

        // destroy old links (cleanup EthernetLink)
        for (const o of this.simobjects) {
            if (o instanceof Link) o.destroy();
        }
        this.simobjects = [];

        /** @type {Map<number, SimulatedObject>} */
        const byId = new Map();
        let maxId = 0;

        // restore tick
        if (typeof scene.tick === "number") SimControl.tick = scene.tick;

        // create nodes first
        for (const n of scene.nodes) {
            /** @type {SimulatedObject|null} */
            let obj = null;

            // IMPORTANT: since you used constructor?.name above, map it back here
            if (n.type === "PC") obj = new PC(n.name ?? "PC");
            else if (n.type === "Switch") obj = new Switch(n.name ?? "Switch");
            else if (n.type === "Router") obj = new Router(n.name ?? "Router");
            else {
                console.warn("Unknown node type", n.type);
                continue;
            }

            // force id + ui state
            obj.id = Number(n.id);
            obj.name = n.name ?? obj.name;
            obj.x = Number(n.x ?? obj.x);
            obj.y = Number(n.y ?? obj.y);
            obj.px = Number(n.px ?? obj.px);
            obj.py = Number(n.py ?? obj.py);
            obj.panelOpen = !!n.panelOpen;

            byId.set(obj.id, obj);
            this.simobjects.push(obj);
            if (obj.id > maxId) maxId = obj.id;
        }

        // create links
        for (const l of scene.links) {
            const A = byId.get(Number(l.a));
            const B = byId.get(Number(l.b));
            if (!A || !B) continue;

            try {
                const link = new Link(A, B);
                link.id = Number(l.id);
                this.simobjects.push(link);
                if (link.id > maxId) maxId = link.id;
            } catch (e) {
                console.warn("Failed to recreate link:", e);
            }
        }

        // fix id generator to avoid collisions
        SimulatedObject.idnumber = maxId + 1;

        // reset edit transient UI
        this._cancelLinking();
        this._removeGhostNode();
        this.render();
        this.redrawLinks();
    }

    openLoadDialog() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";

        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const scene = JSON.parse(text);
                this.loadScene(scene);
            } catch (e) {
                console.error("Load failed:", e);
            }
        });

        input.click();
    }

    newScene() {
        // cleanup links properly
        for (const o of this.simobjects) {
            if (o instanceof Link) o.destroy();
        }

        // clear objects
        this.simobjects = [];

        // reset ID generator
        SimulatedObject.idnumber = 0;

        // reset editor transient state
        this._cancelLinking();
        this._removeGhostNode();
        SimControl.tick = 500;
        this.isPaused = false;
        SimControl.isEditMode = false;

        this.render();
    }

    running = true;

    last = performance.now();

    _startRafLoop() {
        if (this._rafId != null) return;

        this._rafLastTs = performance.now();

        const loop = (ts) => {
            this._rafId = requestAnimationFrame(loop);
            const dt = ts - this._rafLastTs;
            this._rafLastTs = ts;

            if (!this.isPaused) {
                for (const obj of this.simobjects) {
                    if (obj instanceof Link) obj.advance(dt);
                }
            }

            for (const obj of this.simobjects) {
                if (obj instanceof Link) obj.renderPacket();
            }
        };

        this._rafId = requestAnimationFrame(loop);
    }

    /** @param {PointerEvent} ev */
    _getLocalPoint(ev) {
        const layer = this.nodesLayer;
        if (!layer) return { x: ev.clientX, y: ev.clientY };
        const r = layer.getBoundingClientRect();
        return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    /** @param {Event} ev */
    _getObjFromEvent(ev) {
        const t = /** @type {HTMLElement} */ (ev.target);
        const icon = t.closest("[data-objid]");
        if (!icon) return null;
        const id = Number(icon.getAttribute("data-objid"));
        if (!Number.isFinite(id)) return null;
        return this.simobjects.find(o => o.id === id) ?? null;
    }

    /** @param {Event} ev */
    _getLinkFromEvent(ev) {
        const t = /** @type {HTMLElement} */ (ev.target);
        // depends on where you set class; your Link.render() sets root.className="sim-link"
        const el = t.closest(".sim-link");
        if (!el) return null;
        // map DOM -> object: easiest is to set dataset on link root too
        const objid = el.getAttribute("data-objid");
        if (!objid) return null;
        const id = Number(objid);
        return this.simobjects.find(o => o.id === id) ?? null;
    }

    _cancelLinking() {
        this.linkStart = null;
        if (this.ghostLink) this.ghostLink.remove();
        this.ghostLink = null;
    }

    _ensureGhostLink() {
        if (!this.nodesLayer) return;
        if (this.ghostLink) return;
        const g = document.createElement("div");
        g.className = "sim-link sim-link-ghost";
        g.style.pointerEvents = "none";
        this.nodesLayer.appendChild(g);
        this.ghostLink = g;
    }

    /** @param {number} endX local coords @param {number} endY local coords */
    _updateGhost(endX, endY) {
        if (!this.ghostLink || !this.linkStart) return;
        const x1 = this.linkStart.getX();
        const y1 = this.linkStart.getY();

        const dx = endX - x1;
        const dy = endY - y1;
        const length = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        this.ghostLink.style.width = `${length}px`;
        this.ghostLink.style.left = `${x1}px`;
        this.ghostLink.style.top = `${y1}px`;
        this.ghostLink.style.transformOrigin = "0 0";
        this.ghostLink.style.transform = `rotate(${angle}deg)`;
    }

    /** @param {SimulatedObject} obj */
    _deleteObject(obj) {
        // cancel pending link if needed
        if (this.linkStart === obj) this._cancelLinking();

        // remove attached links first
        const attachedLinks = this.simobjects.filter(o =>
            o instanceof Link && (o.A === obj || o.B === obj)
        );

        for (const l of attachedLinks) l.destroy();
        if (obj instanceof Link) obj.destroy();

        const toRemove = new Set([obj, ...attachedLinks]);
        this.simobjects = this.simobjects.filter(o => !toRemove.has(o));

        this.render();
    }

    /** @param {PointerEvent} ev */
    _onPointerMove(ev) {
        if (!SimControl.isEditMode) return;

        const p = this._getLocalPoint(ev);

        // Ghost for placing nodes
        if (this.tool === "place-pc" || this.tool === "place-switch" || this.tool === "place-router") {
            this._ensureGhostNode(this.tool);
            this._moveGhostNode(p.x, p.y);
        } else {
            this._removeGhostNode();
        }

        // Ghost for linking
        if (this.tool === "link" && this.linkStart) {
            this._ensureGhostLink();
            this._updateGhost(p.x, p.y);
        }
    }


    /** @param {PointerEvent} ev */
    _onPointerDown(ev) {
        if (!SimControl.isEditMode) return;

        const obj = this._getObjFromEvent(ev);
        const link = this._getLinkFromEvent(ev); // may be null

        // DELETE tool: click link or node
        if (this.tool === "delete") {
            if (link instanceof Link) {
                ev.preventDefault();
                ev.stopPropagation();
                this._deleteObject(link);
                return;
            }
            if (obj) {
                ev.preventDefault();
                ev.stopPropagation();
                this._deleteObject(obj);
                return;
            }
            return;
        }

        // LINK tool: 2-click
        if (this.tool === "link") {
            if (!obj) return; // must click a node icon
            ev.preventDefault();
            ev.stopPropagation();

            if (!this.linkStart) {
                this.linkStart = obj;
                this._ensureGhostLink();
                const p = this._getLocalPoint(ev);
                this._updateGhost(p.x, p.y);
                return;
            }

            // second click
            if (obj === this.linkStart) {
                // clicking same node cancels
                this._cancelLinking();
                return;
            }

            try {
                const l = new Link(this.linkStart, obj);
                this.addObject(l);
            } catch (e) {
                console.warn("Cannot create link:", e);
            } finally {
                this._cancelLinking();
            }
            return;
        }

        // PLACE tools: click empty canvas places
        if (this.tool.startsWith("place-")) {
            if (obj || link) return; // don't place on top of objects

            if (!this.ghostNodeEl || !this.ghostReady) return;

            const p = this._getLocalPoint(ev);

            /** @type {SimulatedObject|null} */
            let newObj = null;
            if (this.tool === "place-pc") newObj = new PC("PC");
            if (this.tool === "place-switch") newObj = new Switch("Switch");
            if (this.tool === "place-router") newObj = new Router("Router");

            if (!newObj) return;

            // place at click
            newObj.x = p.x;
            newObj.y = p.y;

            this.addObject(newObj);
            this.redrawLinks();

            this._removeGhostNode();
            return;
        }

        // SELECT tool
        if (this.tool === "select") {
            if (obj) this.setFocus(obj);
        }
    }


    /** @param {"place-pc"|"place-switch"|"place-router"} type */
    _ensureGhostNode(type) {
        if (!this.nodesLayer) return;

        if (!this.ghostNodeEl || this.ghostNodeType !== type) {
            // rebuild if type changed
            this._removeGhostNode();

            const el = document.createElement("div");
            el.className = "sim-node sim-node-ghost";
            el.style.position = "absolute";
            el.style.pointerEvents = "none"; // IMPORTANT: don't block clicks
            el.style.left = "0px";
            el.style.top = "0px";

            const title = document.createElement("div");
            title.className = "title";
            title.textContent =
                type === "place-pc" ? "PC" :
                    type === "place-switch" ? "Switch" :
                        "Router";

            el.appendChild(title);

            // Put it in the same coordinate space as real nodes
            this.nodesLayer.appendChild(el);

            this.ghostNodeEl = el;
            this.ghostNodeType = type;
        }
    }

    _removeGhostNode() {
        if (this.ghostNodeEl) this.ghostNodeEl.remove();
        this.ghostNodeEl = null;
        this.ghostNodeType = null;
        this.ghostReady = false;
    }

    /** @param {number} x local coords @param {number} y local coords */
    _moveGhostNode(x, y) {
        if (!this.ghostNodeEl) return;

        const w = this.ghostNodeEl.offsetWidth || 0;
        const h = this.ghostNodeEl.offsetHeight || 0;

        this.ghostNodeEl.style.left = `${x - w / 2}px`;
        this.ghostNodeEl.style.top = `${y - h / 2}px`;

        this.ghostReady = true;
    }
}

