//@ts-check
import { SimulatedObject } from "./simulation/SimulatedObject.js";
import { Link } from "./simulation/Link.js";
import { PCapViewer } from "./pcap/PCapViewer.js";
import { TabController } from "./TabControler.js";
import { PC } from "./simulation/PC.js";
import { Switch } from "./simulation/Switch.js";
import { Router } from "./simulation/Router.js";

/**
 * @typedef {Object} PortDescriptor
 * @property {string} key
 * @property {string} label
 * @property {any} port
 */

export class SimControl {


    /**
     * @type {Array<SimulatedObject>} array of all simulated objects
     */
    static simobjects;

    /**
     * @type {TabController} reference to the tabcontroller
     */

    static tabControler;

    /**
     * @type {PCapViewer} reference to the pcapviewer
     */
    static pcapViewer;


    /**
     * @type {number} simulation speed
     */
    static tick = 500;

    /**
     * @type {number} ID of the simulation step
     */
    tickId = 0;

    /**
     * @type {boolean} is the simulation paused?
     */
    isPaused = true;

    /**
     * @type {boolean} are we in a endstep? (false=step1, true=step2)
     */
    endStep = false;

    /**
     * @type {HTMLElement|null} HTML-Element where everything gets renderd into
     */
    root;

    /** @type {HTMLDivElement|null} */
    nodesLayer = null;

    /** @type {HTMLDivElement|null} */
    static packetsLayer = null;

    /** @type {number|null} */
    timeoutId = null;

    /**
     * @type {HTMLElement|null} movement Boundary for user drag&drop (so that it stays inside root element)
     */
    static movementBoundary;

    /**** EDIT MODE Variables *****/

    /** @type {boolean} */
    static isEditMode = true;

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

    /** @type {string|null} */
    linkStartKey = null;

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

    /**
     * queues and sets timeout for the next step in the simulation
     * @returns 
     */
    scheduleNextStep() {
        if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
        if (this.isPaused) return;
        this.timeoutId = window.setTimeout(() => this.step(), SimControl.tick);
    }

    /**
     * advances the simulation in 1 step
     */
    step() {
        try {
            for (let i = 0; i < this.simobjects.length; i++) {
                const x = this.simobjects[i];

                //Links have two internal steps which need to be called "abwechselnd"
                if (x instanceof Link) {
                    //if (this.endStep) {
                        x.step2();
                        x.step1();
                        this.tickId++;
                    //} else {
                    //    
                    //}
                }
            }
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
        }

        this.redrawLinks();
        this.endStep = !this.endStep;
        this.scheduleNextStep();
    }

    /**
     *  adds a object to the simulation
     *  @param {SimulatedObject} obj 
     */
    addObject(obj) {
        if (this.simobjects.includes(obj)) return;
        this.simobjects.push(obj);
        obj.simcontrol = this;
        this.render();
    }

    /**
     *  deletes an object form the simulation
     *  @param {SimulatedObject} obj 
     */
    deleteObject(obj) {
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


    /**
     *  sets Focus of an object 
     *  @param {SimulatedObject} obj 
     */
    setFocus(obj) {
        this.focusedObject = obj;
        this.render();
    }

    /**
     * 
     * @param {number} ms
     */
    setTick(ms) {
        //no effect while in edit mode
        if (SimControl.isEditMode) {
            return;
        }
        SimControl.tick = Math.max(16, Math.min(5000, Math.round(ms)));

        this.isPaused = false; //unpause
        this.render();
        this.scheduleNextStep();
    }

    /**
     * pauses the simulation
     */
    pause() {
        if (this.isPaused) return;
        this.isPaused = true;
        this.render();
        this.scheduleNextStep(); // will stop scheduling
    }

    /**
     * renders the SIM
     * @returns 
     */
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
            this.new();
        });
        gProject.appendChild(btnNew);

        // Load
        const btnLoad = document.createElement("button");
        btnLoad.type = "button";
        btnLoad.textContent = "Load";
        btnLoad.addEventListener("click", () => {
            if (!confirm("Discard current simulation and load another one?")) return;
            this.open();
        });
        gProject.appendChild(btnLoad);

        // Save
        const btnSave = document.createElement("button");
        btnSave.type = "button";
        btnSave.textContent = "Save";
        btnSave.addEventListener("click", () => this.download());
        gProject.appendChild(btnSave);



        // --- Edit group
        addSeparator();
        const gMode = addGroup("Mode");

        // Edit button
        const btnEdit = document.createElement("button");
        btnEdit.type = "button";
        btnEdit.textContent = "Edit";
        if (SimControl.isEditMode) btnEdit.classList.add("active");
        btnEdit.addEventListener("click", () => {
            if (SimControl.isEditMode) {
                // leaving edit mode → stay paused, user must choose speed
                SimControl.isEditMode = false;
                if (this.root) {
                    this.root.classList.remove("edit-mode");
                    delete this.root.dataset.tool;
                }
                this.render();
            } else {
                this.enterEditMode();
            }
        });
        gMode.appendChild(btnEdit);

        // Run button
        const btnRun = document.createElement("button");
        btnRun.type = "button";
        btnRun.textContent = "Run";
        if (!SimControl.isEditMode) btnRun.classList.add("active");
        btnRun.addEventListener("click", () => {
            if (SimControl.isEditMode) {
                SimControl.isEditMode = false;
                this.tool = "select";
                this.isPaused = false;
                if (this.root) {
                    this.root.classList.remove("edit-mode");
                    delete this.root.dataset.tool;
                }
                this._cancelLinking();
                this._removeGhostNode();
                this.render();
                this.scheduleNextStep();
            }
        });
        gMode.appendChild(btnRun);



        if (!SimControl.isEditMode) {
            addSeparator();
            const gSpeeds = addGroup("Speed");

            // Pause (only pauses)
            const btnPause = document.createElement("button");
            btnPause.type = "button";
            btnPause.textContent = "Pause";
            btnPause.disabled = this.isPaused; // optional: disable if already paused
            btnPause.addEventListener("click", () => this.pause());
            gSpeeds.appendChild(btnPause);

            // Speed buttons (also start/resume)
            const speeds = [
                { label: "0.25×", ms: 1000 },
                { label: "0.5×", ms: 500 },
                { label: "1×", ms: 250 },
                { label: "2×", ms: 125 },
                { label: "4×", ms: 62 },
                { label: "8×", ms: 32 },
            ];

            for (const s of speeds) {
                const b = document.createElement("button");
                b.type = "button";
                b.textContent = s.label;
                if (SimControl.tick === s.ms) b.classList.add("active");

                // Clicking a speed sets tick + starts simulation
                b.addEventListener("click", () => this.setTick(s.ms));

                gSpeeds.appendChild(b);
            }
        }

        //End of toolbar

        //********* BODY (SIDEBAR + NODES) ***************
        const body = document.createElement("div");
        body.className = "sim-body";
        root.appendChild(body);

        // Left sidebar (only in edit mode)
        if (SimControl.isEditMode) {
            const sidebar = document.createElement("div");
            sidebar.className = "sim-sidebar";
            body.appendChild(sidebar);

            // Tools header
            const h = document.createElement("div");
            h.className = "sim-sidebar-title";
            h.textContent = "Edit Tools";
            sidebar.appendChild(h);

            const toolsWrap = document.createElement("div");
            toolsWrap.className = "sim-sidebar-tools";
            sidebar.appendChild(toolsWrap);

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
                b.className = "sim-sidebar-btn";
                b.textContent = label;
                if (this.tool === id) b.classList.add("active");
                b.addEventListener("click", () => {
                    this.tool = /** @type {any} */ (id);
                    if (this.root) this.root.dataset.tool = this.tool;

                    if (this.tool !== "link") this._cancelLinking();
                    if (!(this.tool === "place-pc" || this.tool === "place-switch" || this.tool === "place-router")) {
                        this._removeGhostNode();
                    }
                    this.render();
                });
                toolsWrap.appendChild(b);
            }
        }

        // Nodes layer goes into body (right side)
        const nodes = document.createElement("div");
        nodes.className = "sim-nodes";
        body.appendChild(nodes);

        this.nodesLayer = nodes;
        SimControl.movementBoundary = nodes;

        const packetsLayer = document.createElement("div");
        packetsLayer.className = "sim-packets-layer";
        nodes.appendChild(packetsLayer);

        SimControl.packetsLayer = packetsLayer;

        // re-attach packet elements after rerender
        for (const obj of this.simobjects) {
            if (obj instanceof Link) {
                for (const p of obj._packets) {
                    SimControl.packetsLayer.appendChild(p.el);
                }
            }
        }

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


    /**
     * redraw all links (after drag&drop or other changes)
     */
    redrawLinks() {
        for (const obj of this.simobjects) {
            if (obj instanceof Link) {
                obj.redrawLinks();
            }
        }
    }

    /***************************** SAVE AND LOAD **********************************/

    /**
     * saves the simulation state
     * @returns 
     */
    toJSON() {
        return {
            version: 3,
            tick: SimControl.tick,
            objects: this.simobjects.map(o => o.toJSON()),
        };
    }

    download() {
        const json = JSON.stringify(this.toJSON(), null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "simulation.json";
        a.click();

        URL.revokeObjectURL(url);
    }

    /**
     * restore a state
     * @param {*} state 
     * @returns 
     */
    restore(state) {
        //@ts-ignore
        const REGISTRY = new Map([
            ["PC", PC],
            ["Router", Router],
            ["Switch", Switch],
            // Link handled separately
        ]);

        if (!state || !Array.isArray(state.objects)) {
            console.warn("Invalid scene file");
            return;
        }

        // cleanup old links properly
        for (const o of this.simobjects) if (o instanceof Link) o.destroy();
        this.simobjects = [];

        // restore tick
        if (typeof state.tick === "number") SimControl.tick = state.tick;

        /** @type {Map<number, SimulatedObject>} */
        const byId = new Map();

        let maxId = 0;

        // 1) create nodes first
        for (const n of state.objects) {
            if (!n || n.kind === "Link") continue;

            const node = REGISTRY.get(String(n.kind));
            if (!node || typeof node.fromJSON !== "function") {
                console.warn("Unknown kind", n.kind);
                continue;
            }

            const obj = node.fromJSON(n);
            byId.set(obj.id, obj);
            this.simobjects.push(obj);
            if (obj.id > maxId) maxId = obj.id;
        }

        // 2) create links
        for (const l of state.objects) {
            if (!l || l.kind !== "Link") continue;
            try {
                const link = Link.fromJSON(l, byId);
                this.simobjects.push(link);
                if (link.id > maxId) maxId = link.id;
            } catch (e) {
                console.warn("Failed to recreate link:", e);
            }
        }

        // 3) fix id generator
        SimulatedObject.idnumber = maxId + 1;

        // resets the ui
        this.enterEditMode();
        this.isPaused = true;
        this.redrawLinks();
    }

    /**
     * shows a open dialog and loads a state
     */
    open() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";

        input.addEventListener("change", async () => {
            const file = input.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const scene = JSON.parse(text);
                this.restore(scene);
            } catch (e) {
                console.error("Load failed:", e);
            }
        });

        input.click();
    }

    /**
     * creates a new state
     */
    new() {
        // cleanup links
        for (const o of this.simobjects) {
            if (o instanceof Link) o.destroy();
        }

        this.simobjects = [];
        SimulatedObject.idnumber = 0;

        SimControl.tick = 500;
        this.isPaused = true;

        this.enterEditMode();
    }


    /*************************** ANIMATION LOOP FOR PACKETS **********************************/
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


    /***************************** EDIT MODE **********************************/

    /**
     * enters editMode
     */
    enterEditMode() {
        SimControl.isEditMode = true;

        this.isPaused = true;

        // reset tool state
        this.tool = "select";
        this._cancelLinking();
        this._removeGhostNode();

        if (this.root) {
            this.root.classList.add("edit-mode");
            this.root.dataset.tool = this.tool;
        }

        SimulatedObject.closeAllPanels();
        this.render();
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
        this.linkStartKey = null;
        if (this.ghostLink) this.ghostLink.remove();
        this.ghostLink = null;
    }

    _ensureGhostLink() {
        if (!this.nodesLayer) return;
        if (this.ghostLink) return;

        const g = document.createElement("div");
        g.className = "sim-link sim-link-ghost";
        g.style.pointerEvents = "none";
        g.style.transformOrigin = "0 0";

        const hit = document.createElement("div");
        hit.className = "sim-link-hit";
        hit.style.pointerEvents = "none"; // ghost darf niemals clicks fangen

        const line = document.createElement("div");
        line.className = "sim-link-line";
        line.style.pointerEvents = "none";

        g.appendChild(hit);
        g.appendChild(line);

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
    async _onPointerDown(ev) {
        if (!SimControl.isEditMode) return;

        const obj = this._getObjFromEvent(ev);
        const link = this._getLinkFromEvent(ev); // may be null

        // DELETE tool: click link or node
        if (this.tool === "delete") {
            if (link instanceof Link) {
                ev.preventDefault();
                ev.stopPropagation();
                this.deleteObject(link);
                return;
            }
            if (obj) {
                ev.preventDefault();
                ev.stopPropagation();
                this.deleteObject(obj);
                return;
            }
            return;
        }

        if (this.tool === "link") {
            if (!obj) return;
            ev.preventDefault();
            ev.stopPropagation();

            // First click: pick A port (dialog only if >=2 ports; auto if exactly 1)
            if (!this.linkStart) {
                const pickA = await this._pickPortForObjectAt(obj, ev.clientX + 8, ev.clientY + 8);
                if (!pickA) return;

                this.linkStart = obj;
                this.linkStartKey = pickA.key;

                this._ensureGhostLink();
                const p = this._getLocalPoint(ev);
                this._updateGhost(p.x, p.y);
                return;
            }

            // Clicking same node cancels
            if (obj === this.linkStart) {
                this._cancelLinking();
                return;
            }

            const A = this.linkStart;
            const AKey = this.linkStartKey;
            if (!AKey) {
                this._cancelLinking();
                return;
            }

            // Second click: pick B port
            const pickB = await this._pickPortForObjectAt(obj, ev.clientX + 8, ev.clientY + 8);
            if (!pickB) return;

            const B = obj;
            const BKey = pickB.key;

            try {
                const portA = A.getPortByKey(AKey);
                const portB = B.getPortByKey(BKey);

                if (!portA || !portB) throw new Error("Selected port not found");

                // At this point ports must be free (dialog disabled occupied),
                // but keep sanity check anyway:
                if (!this._isPortFree(portA)) throw new Error(`Port ${AKey} is already in use`);
                if (!this._isPortFree(portB)) throw new Error(`Port ${BKey} is already in use`);

                const l = new Link(A, portA, AKey, B, portB, BKey);
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
            if (obj || link) return;
            if (!this.ghostNodeEl || !this.ghostReady) return;

            const p = this._getLocalPoint(ev);

            let newObj = null;
            if (this.tool === "place-pc") newObj = new PC("PC");
            if (this.tool === "place-switch") newObj = new Switch("Switch");
            if (this.tool === "place-router") newObj = new Router("Router");
            if (!newObj) return;

            const w = this.ghostNodeEl.offsetWidth || 0;
            const h = this.ghostNodeEl.offsetHeight || 0;

            newObj.x = p.x - w / 2;
            newObj.y = p.y - h / 2;

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
            this._removeGhostNode();

            /** @type {SimulatedObject|null} */
            let tmp = null;
            if (type === "place-pc") tmp = new PC("PC");
            if (type === "place-switch") tmp = new Switch("Switch");
            if (type === "place-router") tmp = new Router("Router");
            if (!tmp) return;

            const el = tmp.buildIcon();

            // Ghost: gleicher Node, aber nicht klickbar + absolute positioning
            el.classList.add("sim-node-ghost");
            el.style.position = "absolute";
            el.style.pointerEvents = "none";
            el.style.left = "0px";
            el.style.top = "0px";

            // Ghost soll nicht als echtes Objekt erkannt werden
            delete el.dataset.objid;

            this.nodesLayer.appendChild(el);

            this.ghostNodeEl = /** @type {HTMLDivElement} */ (el);
            this.ghostNodeType = type;
            this.ghostReady = false;

            // Dummy wieder aus instances raus (DOM vom Ghost bleibt!)
            tmp.destroy();
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

    /** 
     * helper function to try to call listPorts() on an object
     * @param {any} obj @returns {PortDescriptor[]} 
     */
    _getPorts(obj) {
        if (typeof obj.listPorts === "function") return obj.listPorts();
        return [];
    }

    /** 
     * helper function to try to call isFree();
     * @param {any} port 
     */
    _isPortFree(port) {
        if (typeof port.isFree === "function") return port.isFree();
        return port.linkref == null;
    }

    /**
     * shows the port selection tool when connecting two nodes with more than one port
     * @param {SimulatedObject} obj
     * @param {number} x screen coords
     * @param {number} y screen coords
     * @returns {Promise<{key:string, port:any} | null>}
     */
    _pickPortForObjectAt(obj, x, y) {
        return new Promise((resolve) => {
            const ports = this._getPorts(obj);

            if (ports.length === 1) {
                resolve({ key: ports[0].key, port: ports[0].port });
                return;
            }
            if (ports.length === 0) {
                resolve(null);
                return;
            }

            let done = false;

            const panel = document.createElement("div");
            panel.className = "sim-port-picker";
            panel.style.position = "fixed";

            // start position (we'll clamp after measuring)
            panel.style.left = `${x}px`;
            panel.style.top = `${y}px`;

            const cleanup = (result) => {
                if (done) return;
                done = true;
                document.removeEventListener("pointerdown", onOutside, { capture: true });
                window.removeEventListener("keydown", onKeyDown);
                panel.remove();
                resolve(result ?? null);
            };

            const onOutside = (ev) => {
                // click outside closes
                if (!panel.contains(/** @type {Node} */(ev.target))) cleanup(null);
            };

            const onKeyDown = (ev) => {
                if (ev.key === "Escape") cleanup(null);
            };

            for (const d of ports) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "sim-port-chip";

                const free = this._isPortFree(d.port);
                btn.disabled = !free;
                btn.textContent = d.label;
                if (!free) btn.classList.add("in-use");

                btn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    cleanup({ key: d.key, port: d.port });
                });

                panel.appendChild(btn);
            }

            document.body.appendChild(panel);

            // clamp into viewport after it has a size
            const r = panel.getBoundingClientRect();
            const pad = 8;
            const maxLeft = window.innerWidth - r.width - pad;
            const maxTop = window.innerHeight - r.height - pad;
            panel.style.left = `${Math.max(pad, Math.min(x, maxLeft))}px`;
            panel.style.top = `${Math.max(pad, Math.min(y, maxTop))}px`;

            document.addEventListener("pointerdown", onOutside, { capture: true });
            window.addEventListener("keydown", onKeyDown);
        });
    }


}

