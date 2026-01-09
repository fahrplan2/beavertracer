//@ts-check
import { SimulatedObject } from "./simobjects/SimulatedObject.js";
import { Link } from "./simobjects/Link.js";
import { PCapViewer } from "./pcap/PCapViewer.js";
import { TabController } from "./TabController.js";
import { PC } from "./simobjects/PC.js";
import { Switch } from "./simobjects/Switch.js";
import { Router } from "./simobjects/Router.js";
import { TextBox } from "./simobjects/TextBox.js";
import { RectOverlay } from "./simobjects/RectOverlay.js";
import { t, getLocale, setLocale, getLocales, onLocaleChange } from "./i18n/index.js";
import { StaticPageLoader } from "./StaticPageLoader.js";
import { PCapController } from "./pcap/PCapControler.js";
import { DOMBuilder } from "./lib/DomBuilder.js";



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
    simobjects;

    /**
     * @type {TabController} reference to the tabcontroller
     */

    tabControler;

    /**
     * @type {PCapController} 
     */
    pcapController;

    /**
     * @type {PCapViewer} reference to the pcapviewer
     */
    pcapViewer;

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
    movementBoundary;



    /**** EDIT MODE Variables *****/
    /** @type {"edit"|"run"|"trace"|"about"} */
    mode = "edit";

    /** @type {"select"|"place-pc"|"place-switch"|"place-router"|"place-text"|"place-rect"|"link"|"delete"} */
    tool = "select";

    /** @type {SimulatedObject|null} */
    _linkStart = null;

    /** @type {HTMLDivElement|null} */
    _ghostLink = null;

    /** @type {HTMLDivElement|null} */
    _ghostNodeEl = null;

    /** @type {"place-pc"|"place-switch"|"place-router"|"place-text"|"place-rect"|null} */
    _ghostNodeType = null;

    /** @type {boolean} */
    _ghostReady = false;

    /** @type {string|null} */
    _linkStartKey = null;

    /** @type {HTMLElement|null} */
    _deleteHoverEl = null;


    /** @type {null|(()=>void)} */
    _langCleanup = null;

    /** @type {null|(()=>void)} */
    _unsubLocale = null;


    /**
     * @param {HTMLElement|null} root
     */
    constructor(root) {
        this.simobjects = [];
        this.root = root;

        this.pcapViewer = new PCapViewer(null, {
            hideComputedTreeNodes: true
        });
        this.pcapController = new PCapController(this.pcapViewer);

        this.render();

        //change when locale changes
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
        if (this._linkStart === obj) this._cancelLinking();

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
        //no effect while not in run mode
        if (this.mode !== "run") {
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

        //*********** TOOLBAR (TOP) ***********
        const toolbar = document.createElement("div");
        toolbar.className = "sim-toolbar";
        root.appendChild(toolbar);

        // Branding group (left, styled like other groups)
        const brandingGroup = document.createElement("div");
        brandingGroup.className = "sim-toolbar-group sim-toolbar-branding-group";

        toolbar.appendChild(brandingGroup);

        const branding = document.createElement("div");
        branding.className = "sim-toolbar-branding";
        branding.textContent = t("name");
        brandingGroup.appendChild(branding);

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

        //EDIT GROUP
        addSeparator();
        const gMode = DOMBuilder.buttongroup(t("sim.mode"), toolbar);

        //Edit
        gMode.appendChild(DOMBuilder.iconbutton({
            label: t("sim.edit"),
            icon: "fa-pencil",
            active: this.mode === "edit",
            onClick: () => {
                if (this.mode !== "edit") {
                    this.tabControler.gotoTab("sim");
                }
                this._enterEditMode();
            }
        }));

        //Run
        gMode.appendChild(DOMBuilder.iconbutton({
            label: t("sim.run"),
            icon: "fa-play",
            active: this.mode === "run",
            onClick: () => {
                if (this.mode === "edit") {
                    this._leaveEditMode();
                } else {
                    this.pause();
                }

                this.tabControler.gotoTab("sim");
                this.mode = "run";
                this.isPaused = false;

                if (this.root) {
                    this.root.classList.remove("edit-mode");
                    delete this.root.dataset.tool;
                }

                this.render();
                this.scheduleNextStep();
            }
        }));

        //Trace
        gMode.appendChild(DOMBuilder.iconbutton({
            label: t("sim.trace"),
            icon: "fa-magnifying-glass",
            active: this.mode === "trace",
            onClick: () => {
                //leave edit mode
                if (this.mode === "edit") {
                    this._leaveEditMode();
                } else {
                    this.pause();  //just in case
                }
                this.tabControler.gotoTab("trace");
                this.mode = "trace";

                this.render();
            }
        }));

        //PROJECT GROUP
        if (this.mode === "edit") {

            addSeparator();
            const gProject = DOMBuilder.buttongroup(t("sim.project"), toolbar);

            //New
            gProject.appendChild(DOMBuilder.iconbutton({
                label: t("sim.new"),
                icon: "fa-file",
                onClick: () => {
                    if (!confirm(t("sim.discardandnewwarning"))) return;
                    this.new();
                }
            }));

            //Load
            gProject.appendChild(DOMBuilder.iconbutton({
                label: t("sim.load"),
                icon: "fa-file-arrow-up",
                onClick: () => {
                    if (!confirm(t("sim.discardandloadwarning"))) return;
                    this.open();
                }
            }));

            // Save
            gProject.appendChild(DOMBuilder.iconbutton({
                label: t("sim.save"),
                icon: "fa-file-arrow-down",
                onClick: () => {
                    this.download();
                }
            }));
        }

        //SPEED BAR
        if (this.mode === "run") {
            addSeparator();
            const gSpeeds = DOMBuilder.buttongroup(t("sim.speed"), toolbar);

            // Pause (only pauses)

            gSpeeds.appendChild(DOMBuilder.iconbutton({
                label: t("sim.pause"),
                icon: "fa-pause",
                active: this.isPaused,
                onClick: () => {
                    this.pause();
                }
            }));


            // Speed buttons (also start/resume)
            const speeds = [
                { label: "0.25×", ms: 1000, icon: "fa-1" },
                { label: "0.5×", ms: 500, icon: "fa-2" },
                { label: "1×", ms: 250, icon: "fa-3" },
                { label: "2×", ms: 125, icon: "fa-4" },
                { label: "4×", ms: 62, icon: "fa-5" },
                { label: "8×", ms: 32, icon: "fa-6" },
            ];

            for (const s of speeds) {
                gSpeeds.appendChild(DOMBuilder.iconbutton({
                    label: s.label,
                    active: SimControl.tick === s.ms && !this.isPaused,
                    icon: s.icon,
                    onClick: () => {
                        this.setTick(s.ms)
                    }
                }));
            }
        }

        addSeparator();

        const gCommon = DOMBuilder.buttongroup(t("sim.common"), toolbar);

        // Language
        gCommon.appendChild(DOMBuilder.iconbutton({
            label: t("sim.language"),
            icon: "fa-language",
            onClick: (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this._openLanguageDialog(gCommon);
            }
        }));

        //About
        gCommon.appendChild(DOMBuilder.iconbutton({
            label: t("sim.about"),
            icon: "fa-circle-question",
            active: this.mode === "about",
            onClick: () => {
                if (this.mode === "edit") {
                    this._leaveEditMode;
                }
                this.pause();
                this.tabControler.gotoTab("about");
                this.mode = "about";
                this.render();
            }
        }));

        //End of toolbar

        //********* BODY (SIDEBAR + NODES) ***************
        const simbody = document.createElement("div");
        simbody.className = "sim-body";
        if (this.mode === "run" || this.mode === "edit") {
            simbody.classList.add("active"); //for tabs
        }
        simbody.id = "sim";

        // Left sidebar (only in edit mode)
        if (this.mode === "edit") {
            const sidebar = document.createElement("div");
            sidebar.className = "sim-sidebar";
            simbody.appendChild(sidebar);
            const toolsWrap = document.createElement("div");
            toolsWrap.className = "sim-sidebar-tools";
            sidebar.appendChild(toolsWrap);

            const tools = [
                ["select", t("sim.tool.select"), "fa-arrow-pointer"],
                ["link", t("sim.tool.link"), "fa-link"],
                ["place-pc", t("sim.tool.pc"), "fa-desktop"],
                ["place-switch", t("sim.tool.switch"), "fa-heart"],
                ["place-router", t("sim.tool.router"), "fa-heart"],
                ["place-text", t("sim.tool.textbox"), "fa-t"],
                ["place-rect", t("sim.tool.rectangle"), "fa-square"],
                ["delete", t("sim.tool.delete"), "fa-ban"],
            ];

            for (const [id, label, icon] of tools) {

                const b = DOMBuilder.iconbutton({
                    className: "sim-sidebar-btn",
                    label: label,
                    icon: icon,
                    active: this.tool === id,
                    onClick: () => {
                        this.tool = /** @type {any} */ (id);
                        if (this.root) this.root.dataset.tool = this.tool;

                        if (this.tool !== "link") this._cancelLinking();
                        if (!(this.tool === "place-pc" || this.tool === "place-switch" || this.tool === "place-router" || this.tool === "place-text" || this.tool === "place-rect")) {
                            this._removeGhostNode();
                        }
                        this.render();
                    }
                });

                toolsWrap.appendChild(b);
            }
        }

        // Nodes layer goes into body (right side)
        const nodes = document.createElement("div");
        nodes.className = "sim-nodes";
        simbody.appendChild(nodes);

        this.nodesLayer = nodes;
        this.movementBoundary = nodes;

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

                if (this.mode !== "edit") return;

                // If a tool is active, right-click = cancel tool
                if (this.tool !== "select") {
                    ev.preventDefault();

                    this._cancelLinking();
                    this._removeGhostNode();

                    this.tool = "select";
                    if (this.root) this.root.dataset.tool = this.tool;

                    this.render();
                }

            };

            // ESC cancels link
            window.onkeydown = (ev) => {
                if (ev.key === "Escape") this._cancelLinking();
            };
        }

        /** TAB CONTROLLER */
        this.tabControler = new TabController();






        //****************** PCAP VIEWER ********************************/

        if (this.mode === "trace") {
            const tracerbody = document.createElement("div");
            tracerbody.className = "analyzer";
            tracerbody.classList.add("tab-content"); //for tabs
            tracerbody.id = "tracer";
            root.appendChild(tracerbody);

            this.pcapViewer.setMount(tracerbody);
            tracerbody.classList.add("active");
            this.pcapViewer.render();

        }

        //****************** ABOUT ********************************/

        if (this.mode === "about") {
            const aboutbody = document.createElement("div");
            aboutbody.className = "about";
            aboutbody.id = "about";
            aboutbody.classList.add("tab-content");
            new StaticPageLoader().load(aboutbody, "/pages/about/index.html");
            aboutbody.classList.add("active");
            root.appendChild(aboutbody);
        }

        if (this.mode === "run") {
            simbody.classList.add("active");
            root.appendChild(simbody);
            this.redrawLinks();
        }

        if (this.mode === "edit") {
            simbody.classList.add("active");
            root.appendChild(simbody);
            this.redrawLinks();
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

    /** @type {HTMLDivElement|null} */
    _langPanel = null;

    _openLanguageDialog(anchorEl) {
        // toggle
        if (this._langPanel) {
            this._closeLanguageDialog();
            return;
        }

        const panel = document.createElement("div");
        panel.className = "sim-lang-picker";
        panel.style.position = "fixed";

        const locales = getLocales();
        const current = getLocale();

        for (const loc of locales) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "sim-lang-option";
            b.textContent = loc.label;

            if (loc.key === current) b.classList.add("active");

            b.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();

                if (loc.key === getLocale()) {
                    this._closeLanguageDialog();
                    return;
                }

                const oldLoc = getLocale();
                setLocale(loc.key);
                const ok = confirm(t("sim.langswitch.confirmdiscard"));
                if (!ok) {
                    setLocale(oldLoc);
                    return;
                }

                setLocale(loc.key);
                window.location.reload();
            });

            panel.appendChild(b);
        }

        document.body.appendChild(panel);
        this._langPanel = panel;

        // position near button
        const ar = anchorEl.getBoundingClientRect();
        const r = panel.getBoundingClientRect();
        const pad = 8;

        let left = ar.left;
        let top = ar.bottom + 6;

        // clamp
        left = Math.max(pad, Math.min(left, window.innerWidth - r.width - pad));
        top = Math.max(pad, Math.min(top, window.innerHeight - r.height - pad));

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;

        const onOutside = (ev) => {
            if (!panel.contains(/** @type {Node} */(ev.target))) this._closeLanguageDialog();
        };
        const onKey = (ev) => {
            if (ev.key === "Escape") this._closeLanguageDialog();
        };

        this._langCleanup = () => {
            document.removeEventListener("pointerdown", onOutside, { capture: true });
            window.removeEventListener("keydown", onKey);
        };

        document.addEventListener("pointerdown", onOutside, { capture: true });
        window.addEventListener("keydown", onKey);
    }

    _closeLanguageDialog() {
        if (this._langCleanup) this._langCleanup();
        this._langCleanup = null;

        if (this._langPanel) this._langPanel.remove();
        this._langPanel = null;
    }

    /***************************** SAVE AND LOAD **********************************/

    /**
     * saves the simulation state
     * @returns 
     */
    toJSON() {
        return {
            version: 4,
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
            ["TextBox", TextBox],
            ["RectOverlay", RectOverlay],
            // Link handled separately
        ]);

        if (!state || !Array.isArray(state.objects)) {
            alert(t("sim.invalidfilewarning"));
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
            obj.simcontrol = this;
            if (obj.id > maxId) maxId = obj.id;
        }

        // 2) create links
        for (const l of state.objects) {
            if (!l || l.kind !== "Link") continue;
            try {
                const link = Link.fromJSON(l, byId, this);
                this.simobjects.push(link);
                if (link.id > maxId) maxId = link.id;
            } catch (e) {
                console.warn("Failed to recreate link:", e);
            }
        }

        // 3) fix id generator
        SimulatedObject.idnumber = maxId + 1;

        // resets the ui
        this._enterEditMode();
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
                alert(t("sim.loadfailederror"));
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

        this._enterEditMode();
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
    _enterEditMode() {
        this.mode = "edit";

        this.isPaused = true;

        // reset tool state
        this.tool = "select";
        this._cancelLinking();
        this._removeGhostNode();
        this._clearDeleteHover();

        if (this.root) {
            this.root.classList.add("edit-mode");
            this.root.dataset.tool = this.tool;
        }

        this.closeAllPanels();
        this.render();
    }

    _leaveEditMode() {
        this.tool = "select";
        this._cancelLinking();
        this._removeGhostNode();
        this._clearDeleteHover();
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
        this._linkStart = null;
        this._linkStartKey = null;
        if (this._ghostLink) this._ghostLink.remove();
        this._ghostLink = null;
    }

    _ensureGhostLink() {
        if (!this.nodesLayer) return;
        if (this._ghostLink) return;

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
        this._ghostLink = g;
    }

    /** @param {number} endX local coords @param {number} endY local coords */
    _updateGhost(endX, endY) {
        if (!this._ghostLink || !this._linkStart) return;
        const x1 = this._linkStart.getX();
        const y1 = this._linkStart.getY();

        const dx = endX - x1;
        const dy = endY - y1;
        const length = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        this._ghostLink.style.width = `${length}px`;
        this._ghostLink.style.left = `${x1}px`;
        this._ghostLink.style.top = `${y1}px`;
        this._ghostLink.style.transformOrigin = "0 0";
        this._ghostLink.style.transform = `rotate(${angle}deg)`;
    }

    /** @param {PointerEvent} ev */
    _onPointerMove(ev) {
        if (this.mode !== "edit") return;

        const p = this._getLocalPoint(ev);

        // Ghost for placing nodes
        if (this.tool === "place-pc" || this.tool === "place-router" || this.tool === "place-switch" || this.tool === "place-text" || this.tool === "place-rect") {
            this._ensureGhostNode(this.tool);
            this._moveGhostNode(p.x, p.y);
        } else {
            this._removeGhostNode();
        }

        // Ghost for linking
        if (this.tool === "link" && this._linkStart) {
            this._ensureGhostLink();
            this._updateGhost(p.x, p.y);
        }

        // delete-tool hover highlight
        if (this.tool === "delete") {
            this._setDeleteHover(this._getHoverTargetEl(ev));
        } else {
            this._clearDeleteHover();
        }
    }


    /** @param {PointerEvent} ev */
    async _onPointerDown(ev) {
        if (this.mode !== "edit") return;

        const obj = this._getObjFromEvent(ev);
        const link = this._getLinkFromEvent(ev); // may be null

        //right click should cancel the tool
        if (ev.button === 2 && !obj && !link && this.tool !== "select") {
            // cancel any transient state first
            this._cancelLinking();
            this._removeGhostNode();

            this.tool = "select";
            if (this.root) this.root.dataset.tool = this.tool;
            ev.preventDefault();
            this.render();
            return;
        }

        // DELETE tool: click link or node
        if (this.tool === "delete") {
            const targetEl = this._getHoverTargetEl(ev);
            this._clearDeleteHover();

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
            if (!this._linkStart) {
                const pickA = await this._pickPortForObjectAt(obj, ev.clientX + 8, ev.clientY + 8);
                if (!pickA) return;

                this._linkStart = obj;
                this._linkStartKey = pickA.key;

                this._ensureGhostLink();
                const p = this._getLocalPoint(ev);
                this._updateGhost(p.x, p.y);
                return;
            }

            // Clicking same node cancels
            if (obj === this._linkStart) {
                this._cancelLinking();
                return;
            }

            const A = this._linkStart;
            const AKey = this._linkStartKey;
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

                const l = new Link(A, portA, AKey, B, portB, BKey, this);
                l.simcontrol = this;
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
            if (!this._ghostNodeEl || !this._ghostReady) return;

            const p = this._getLocalPoint(ev);

            let newObj = null;
            if (this.tool === "place-pc") newObj = new PC();
            if (this.tool === "place-switch") newObj = new Switch();
            if (this.tool === "place-router") newObj = new Router();
            if (this.tool === "place-text") newObj = new TextBox();
            if (this.tool === "place-rect") newObj = new RectOverlay();
            if (!newObj) return;

            const w = this._ghostNodeEl.offsetWidth || 0;
            const h = this._ghostNodeEl.offsetHeight || 0;

            newObj.x = p.x - w / 2;
            newObj.y = p.y - h / 2;

            this.addObject(newObj);
            this.redrawLinks();
            this._removeGhostNode();
            this.tool = "select";
            this.render();
            return;
        }


        // SELECT tool
        if (this.tool === "select") {
            if (obj) this.setFocus(obj);
        }
    }


    /** @param {"place-pc"|"place-switch"|"place-router"|"place-text"|"place-rect"} type */
    _ensureGhostNode(type) {
        if (!this.nodesLayer) return;

        if (!this._ghostNodeEl || this._ghostNodeType !== type) {
            this._removeGhostNode();

            /** @type {SimulatedObject|null} */
            let tmp = null;
            if (type === "place-pc") tmp = new PC();
            if (type === "place-switch") tmp = new Switch();
            if (type === "place-router") tmp = new Router();
            if (type === "place-text") tmp = new TextBox();
            if (type === "place-rect") tmp = new RectOverlay();
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

            this._ghostNodeEl = /** @type {HTMLDivElement} */ (el);
            this._ghostNodeType = type;
            this._ghostReady = false;

            // Dummy wieder aus instances raus (DOM vom Ghost bleibt!)
            tmp.destroy();
        }
    }

    _removeGhostNode() {
        if (this._ghostNodeEl) this._ghostNodeEl.remove();
        this._ghostNodeEl = null;
        this._ghostNodeType = null;
        this._ghostReady = false;
    }

    /** @param {number} x local coords @param {number} y local coords */
    _moveGhostNode(x, y) {
        if (!this._ghostNodeEl) return;

        const w = this._ghostNodeEl.offsetWidth || 0;
        const h = this._ghostNodeEl.offsetHeight || 0;

        this._ghostNodeEl.style.left = `${x - w / 2}px`;
        this._ghostNodeEl.style.top = `${y - h / 2}px`;

        this._ghostReady = true;
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

    /** @param {HTMLElement|null} el */
    _setDeleteHover(el) {
        if (this._deleteHoverEl === el) return;

        if (this._deleteHoverEl) this._deleteHoverEl.classList.remove("sim-delete-hover");
        this._deleteHoverEl = el;

        if (this._deleteHoverEl) this._deleteHoverEl.classList.add("sim-delete-hover");
    }

    _clearDeleteHover() {
        this._setDeleteHover(null);
    }

    /** find the clickable root element for node/link under cursor */
    _getHoverTargetEl(ev) {
        const t = /** @type {HTMLElement} */ (ev.target);
        // nodes: anything with data-objid (your icons already have this)
        const nodeEl = t.closest("[data-objid]");
        if (nodeEl) return /** @type {HTMLElement} */ (nodeEl);

        // links: your _getLinkFromEvent expects .sim-link with data-objid
        const linkEl = t.closest(".sim-link");
        if (linkEl && linkEl.getAttribute("data-objid")) return /** @type {HTMLElement} */ (linkEl);

        return null;
    }

    closeAllPanels() {
        for (const obj of this.simobjects) {
            if (obj instanceof SimulatedObject) {
                obj.setPanelOpen(false);
            }
        }
    }
}
