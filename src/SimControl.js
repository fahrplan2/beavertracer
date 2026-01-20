//@ts-check
import { SimulatedObject } from "./sim/SimulatedObject.js";
import { Link } from "./sim/Link.js";
import { PCapViewer } from "./tracer/PCapViewer.js";
import { PC } from "./sim/PC.js";
import { Switch } from "./sim/Switch.js";
import { Router } from "./sim/Router.js";
import { TextBox } from "./sim/TextBox.js";
import { RectOverlay } from "./sim/RectOverlay.js";
import { t, getLocale, setLocale, getLocales } from "./i18n/index.js";
import { StaticPageRouter } from "./StaticPageRouter.js";
import { PCapController } from "./tracer/PCapControler.js";
import { DOMBuilder } from "./lib/DomBuilder.js";
import { version } from "./lib/version.js";

/**
 * @typedef {Object} PortDescriptor
 * @property {string} key
 * @property {string} label
 * @property {any} port
 */

export class SimControl {
    /** @type {Array<SimulatedObject>} array of all simulation objects */
    simobjects = [];

    /** @type {PCapController} linked pcapController */
    pcapController;

    /** @type {PCapViewer} */
    pcapViewer;

    /** @type {number} simulation speed (time it takes to do one tick in ms) */
    static tick = 500;

    /** @type {number} ID of the simulation step */
    tickId = 0;

    /** @type {boolean} is the simulation paused? */
    isPaused = true;

    /** @type {HTMLElement|null} HTML-Element to render everything in*/
    root; 

    /** @type {HTMLDivElement|null} */
    nodesLayer = null;

    /** @type {HTMLDivElement|null} */
    static packetsLayer = null;

    /** @type {number|null} */
    timeoutId = null;

    /** @type {HTMLElement|null} */
    movementBoundary = null;

    /** @type {"edit"|"run"|"trace"|"page"} */
    mode = "edit";

    /** @type {"select"|"place-pc"|"place-switch"|"place-router"|"place-text"|"place-rect"|"link"|"delete"} */
    tool = "select";

    /** @type {SimulatedObject|null} */
    focusedObject = null;

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

    /** @type {HTMLDivElement|null} */
    _langPanel = null;

    // --- New: DOM refs so we can update without rebuilding
    /** @type {HTMLDivElement|null} */
    _toolbar = null;

    /** @type {HTMLDivElement|null} */
    _simBody = null;

    /** @type {HTMLDivElement|null} */
    _sidebar = null;

    /** @type {HTMLDivElement|null} */
    _toolsWrap = null;

    /** @type {HTMLDivElement|null} */
    _tracerBody = null;

    /** @type {HTMLDivElement|null} */
    _pageBody = null;

    /** @type {Map<number, HTMLElement>} */
    _objEls = new Map();

    /** @type {boolean} */
    _mounted = false;

    /** @type {boolean} */
    _uiDirty = false;

    /** @type {number|null} */
    _uiRaf = null;

    /** @type {boolean} */
    _redrawReq = false;

    /** @type {number|null} */
    _rafId = null;

    /** @type {number} */
    _rafLastTs = performance.now();

    /** @type {StaticPageRouter|null} */
    _staticRouter = null;

    /** @type {HTMLDivElement|null} */
    _pageContent = null;

    /**
     * @param {HTMLElement|null} root
     */
    constructor(root) {
        this.root = root;

        this.pcapViewer = new PCapViewer(null, {
            hideComputedTreeNodes: true,
            simControl: this,
        });
        this.pcapController = new PCapController(this.pcapViewer);

        this._mount();          // build DOM once
        this._syncSceneDOM();   // render current objects
        this._updateUI();       // set active states

        this.scheduleNextStep();
        this._startRafLoop();
    }

    scheduleNextStep() {
        if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
        if (this.isPaused) return;
        this.timeoutId = window.setTimeout(() => this.step(), SimControl.tick);
    }

    step() {
        for (let i = 0; i < this.simobjects.length; i++) {
            const x = this.simobjects[i];
            if (x instanceof Link) {
                x.step2();
            }
        }
        for (let i = 0; i < this.simobjects.length; i++) {
            const x = this.simobjects[i];
            if (x instanceof Link) {
                x.step1();
            }
        }
        this.tickId++;



        this._requestRedrawLinks();
        this.endStep = !this.endStep;
        this.scheduleNextStep();
    }

    setTick(ms) {
        if (this.mode !== "run") return;

        //Upper bound: 5000, lower bound: 16
        SimControl.tick = Math.max(16, Math.min(5000, Math.round(ms)));

        for(const o of this.simobjects) {
            if(o instanceof Link) {
                o.setStepMs(SimControl.tick);
            }
        }
        this.isPaused = false;
        this._invalidateUI();
        this.scheduleNextStep();
    }

    pause() {
        if (this.isPaused) return;
        this.isPaused = true;
        this._invalidateUI();
        this.scheduleNextStep();
    }

    // ---------------------------------------------------------------------------
    // Public scene operations: do NOT full-render; update incrementally
    // ---------------------------------------------------------------------------

    addObject(obj) {
        if (this.simobjects.includes(obj)) return;
        this.simobjects.push(obj);
        obj.simcontrol = this;

        this._syncSceneDOM();     // add just this node (and link)
        this._requestRedrawLinks();
    }

    deleteObject(obj) {
        if (this._linkStart === obj) this._cancelLinking();

        const attachedLinks = this.simobjects.filter(
            (o) => o instanceof Link && (o.A === obj || o.B === obj)
        );

        for (const l of attachedLinks) l.destroy();
        if (obj instanceof Link) obj.destroy();

        const toRemove = new Set([obj, ...attachedLinks]);
        this.simobjects = this.simobjects.filter((o) => !toRemove.has(o));

        // remove DOM for deleted objects
        for (const o of toRemove) {
            const el = this._objEls.get(o.id);
            if (el) el.remove();
            this._objEls.delete(o.id);

            // also remove packet elements if it was a Link
            if (o instanceof Link) {
                for (const p of o._packets) p.el?.remove?.();
            }
        }

        this._requestRedrawLinks();
        this._invalidateUI();
    }

    setFocus(obj) {
        if (this.focusedObject === obj) return;

        // cheap: toggle class, no rebuild
        const prev = this.focusedObject;
        this.focusedObject = obj;

        if (prev) {
            const elPrev = this._objEls.get(prev.id);
            elPrev?.classList?.remove("is-focused");
        }
        const elNow = this._objEls.get(obj.id);
        elNow?.classList?.add("is-focused");

        this._invalidateUI(); // if toolbar/panels depend on focus
    }

    // ---------------------------------------------------------------------------
    // Mount once: build all “frame” DOM
    // ---------------------------------------------------------------------------

    _mount() {
        if (this._mounted) return;
        this._mounted = true;

        const root = this.root;
        if (!root) return;

        root.replaceChildren();
        root.classList.add("sim-root");

        // Toolbar
        const toolbar = document.createElement("div");
        toolbar.className = "sim-toolbar";
        root.appendChild(toolbar);
        this._toolbar = toolbar;

        // Sim body (sidebar + nodes)
        const simbody = document.createElement("div");
        simbody.className = "sim-body tab-content";
        simbody.id = "sim";
        root.appendChild(simbody);
        this._simBody = simbody;

        // Sidebar (always mounted; we show/hide based on mode)
        const sidebar = document.createElement("div");
        sidebar.className = "sim-sidebar";
        simbody.appendChild(sidebar);
        this._sidebar = sidebar;

        const toolsWrap = document.createElement("div");
        toolsWrap.className = "sim-sidebar-tools";
        sidebar.appendChild(toolsWrap);
        this._toolsWrap = toolsWrap;

        // Nodes layer
        const nodes = document.createElement("div");
        nodes.className = "sim-nodes";
        simbody.appendChild(nodes);

        this.nodesLayer = nodes;
        this.movementBoundary = nodes;

        const packetsLayer = document.createElement("div");
        packetsLayer.className = "sim-packets-layer";
        nodes.appendChild(packetsLayer);
        SimControl.packetsLayer = packetsLayer;

        // Bind once
        nodes.onpointerdown = (ev) => this._onPointerDown(ev);
        nodes.onpointermove = (ev) => this._onPointerMove(ev);

        nodes.oncontextmenu = (ev) => {
            if (this.mode !== "edit") return;
            if (this.tool !== "select") {
                ev.preventDefault();
                this._cancelLinking();
                this._removeGhostNode();
                this.tool = "select";
                if (this.root) this.root.dataset.tool = this.tool;
                this._invalidateUI();
            }
        };

        window.addEventListener("keydown", (ev) => {
            if (ev.key === "Escape") this._cancelLinking();
        });

        // Trace tab
        const tracerbody = document.createElement("div");
        tracerbody.className = "analyzer tab-content";
        tracerbody.id = "tracer";
        root.appendChild(tracerbody);
        this._tracerBody = tracerbody;

        this.pcapViewer.setMount(tracerbody);

        // Page tab 
        const pagebody = document.createElement("div");
        pagebody.className = "page tab-content";
        pagebody.id = "page";
        root.appendChild(pagebody);
        this._pageBody = pagebody;

        // create inner container for static pages
        const pageContent = document.createElement("div");
        pageContent.className = "page-content";
        pagebody.appendChild(pageContent);
        this._pageContent = pageContent;

        // mount router once; we keep it mounted even when tab hidden
        this._staticRouter = new StaticPageRouter({
            fallbackLocale: "en",
            onRoute: ({ route }) => {
                // whenever we are on a static page route, switch UI to about tab
                if (this.mode !== "page") {
                    this.mode = "page";
                    this.isPaused = true;
                    this._invalidateUI();
                }
            },
        });
        this._staticRouter.mount(pageContent, { initial: window.location.pathname });

        // Build toolbar + sidebar buttons once
        this._buildToolbar();
        this._buildSidebar();
    }

    _buildToolbar() {
        const toolbar = this._toolbar;
        if (!toolbar) return;
        toolbar.replaceChildren();

        // Branding group
        const brandingGroup = document.createElement("div");
        brandingGroup.className = "sim-toolbar-group sim-toolbar-branding-group";
        toolbar.appendChild(brandingGroup);

        const branding = document.createElement("div");
        branding.className = "sim-toolbar-branding";
        branding.textContent = "Beaver Tracer"
        brandingGroup.appendChild(branding);

        const ver = document.createElement("div");
        ver.className = "sim-toolbar-branding-version";
        ver.textContent = "v" + version(true);
        brandingGroup.appendChild(ver);

        const addSeparator = (role) => {
            const sep = document.createElement("div");
            sep.className = "sim-toolbar-sep";
            if (role) sep.dataset.role = role;
            toolbar.appendChild(sep);
            return sep;
        };


        //********** MODES  *********/
        addSeparator("sep-mode");
        const gMode = DOMBuilder.buttongroup(t("sim.mode"), toolbar);
        gMode.dataset.group = "mode";

        // store buttons by dataset for easy update
        const btnEdit = DOMBuilder.iconbutton({
            label: t("sim.edit"),
            icon: "fa-pencil",
            onClick: () => {
                if (window.location.pathname !== "/") {
                    history.pushState({}, "", "/");
                }
                this._enterEditMode();
            },
        });
        btnEdit.dataset.role = "mode-edit";
        gMode.appendChild(btnEdit);

        const btnRun = DOMBuilder.iconbutton({
            label: t("sim.run"),
            icon: "fa-play",
            onClick: () => {
                if (window.location.pathname !== "/") {
                    history.pushState({}, "", "/");
                }
                if (this.mode === "edit") this._leaveEditMode();
                else this.pause();

                this.mode = "run";
                this.isPaused = false;

                if (this.root) {
                    this.root.classList.remove("edit-mode");
                    delete this.root.dataset.tool;
                }

                this._invalidateUI();
                this.scheduleNextStep();
            },
        });
        btnRun.dataset.role = "mode-run";
        gMode.appendChild(btnRun);

        const btnTrace = DOMBuilder.iconbutton({
            label: t("sim.trace"),
            icon: "fa-magnifying-glass",
            onClick: () => {
                if (window.location.pathname !== "/") {
                    history.pushState({}, "", "/");
                }
                if (this.mode === "edit") this._leaveEditMode();
                this.mode = "trace";
                this._invalidateUI();
                this.pcapViewer.render();
            },
        });
        btnTrace.dataset.role = "mode-trace";
        gMode.appendChild(btnTrace);

        //********** SPEED  *********/
        addSeparator("sep-speeds");
        const gSpeeds = DOMBuilder.buttongroup(t("sim.speed"), toolbar);
        gSpeeds.dataset.group = "speeds";

        const pauseBtn = DOMBuilder.iconbutton({
            label: t("sim.pause"),
            icon: "fa-pause",
            onClick: () => this.pause(),
        });
        pauseBtn.dataset.role = "pause";
        gSpeeds.appendChild(pauseBtn);

        const speeds = [
            { label: "1×", ms: 2000, icon: "fa-1" },
            { label: "4×", ms: 1000, icon: "fa-2" },
            { label: "8×", ms: 125, icon: "fa-3" },
            { label: "16×", ms: 32, icon: "fa-4" },
        ];

        for (const s of speeds) {
            const b = DOMBuilder.iconbutton({
                label: s.label,
                icon: s.icon,
                onClick: () => {
                    this.setTick(s.ms);
                }
            });
            b.dataset.role = `speed-${s.ms}`;
            gSpeeds.appendChild(b);
        }

        const resetBtn = DOMBuilder.iconbutton({
            label: t("sim.reset"),
            icon: "fa-arrow-rotate-left",
            onClick: () => {
                this.restore(this.toJSON());
                this.mode = "run";
                this.pause();
            },
        });
        resetBtn.dataset.role = "reset";
        gSpeeds.appendChild(resetBtn);

        //******** PROJECT ***********/
        addSeparator("sep-project");
        const gProject = DOMBuilder.buttongroup(t("sim.project"), toolbar);
        gProject.dataset.group = "project";

        // New
        const btnNew = DOMBuilder.iconbutton({
            label: t("sim.new"),
            icon: "fa-file",
            onClick: () => {
                if (!confirm(t("sim.discardandnewwarning"))) return;
                this.new();
            },
        });
        btnNew.dataset.role = "project-new";
        gProject.appendChild(btnNew);

        // Load
        const btnLoad = DOMBuilder.iconbutton({
            label: t("sim.load"),
            icon: "fa-file-arrow-up",
            onClick: () => {
                if (!confirm(t("sim.discardandloadwarning"))) return;
                this.open();
            },
        });
        btnLoad.dataset.role = "project-load";
        gProject.appendChild(btnLoad);

        // Save
        const btnSave = DOMBuilder.iconbutton({
            label: t("sim.save"),
            icon: "fa-file-arrow-down",
            onClick: () => {
                this.download();
            },
        });
        btnSave.dataset.role = "project-save";
        gProject.appendChild(btnSave);


        //******** COMMON ***********/
        addSeparator("sep-common");
        const gCommon = DOMBuilder.buttongroup(t("sim.common"), toolbar);
        gCommon.dataset.group = "common";

        const langBtn = DOMBuilder.iconbutton({
            label: t("sim.language"),
            icon: "fa-language",
            onClick: (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this._openLanguageDialog(gCommon);
            },
        });
        langBtn.dataset.role = "lang";
        gCommon.appendChild(langBtn);

        const aboutBtn = DOMBuilder.iconbutton({
            label: t("sim.about"),
            icon: "fa-circle-question",
            onClick: () => {
                this.pause();
                this.mode = "page";
                this._invalidateUI();
                this._staticRouter.navigate("/about", { replace: true });
            },
        });
        aboutBtn.dataset.role = "mode-page";
        gCommon.appendChild(aboutBtn);

    }

    _buildSidebar() {
        const toolsWrap = this._toolsWrap;
        if (!toolsWrap) return;
        toolsWrap.replaceChildren();

        const tools = [
            ["select", t("sim.tool.select"), "fa-arrow-pointer"],
            ["link", t("sim.tool.link"), "fa-link"],
            ["place-pc", t("sim.tool.pc"), "fa-desktop"],
            ["place-switch", t("sim.tool.switch"), "my-icon-switch"],
            ["place-router", t("sim.tool.router"), "my-icon-router"],
            ["place-text", t("sim.tool.textbox"), "fa-t"],
            ["place-rect", t("sim.tool.rectangle"), "fa-square"],
            ["delete", t("sim.tool.delete"), "fa-ban"],
        ];

        for (const [id, label, icon] of tools) {
            const b = DOMBuilder.iconbutton({
                className: "sim-sidebar-btn",
                label,
                icon,
                onClick: () => {
                    this.tool = /** @type {any} */ (id);
                    if (this.root) this.root.dataset.tool = this.tool;

                    if (this.tool !== "link") this._cancelLinking();
                    if (
                        !(
                            this.tool === "place-pc" ||
                            this.tool === "place-switch" ||
                            this.tool === "place-router" ||
                            this.tool === "place-text" ||
                            this.tool === "place-rect"
                        )
                    ) {
                        this._removeGhostNode();
                    }

                    this._invalidateUI();
                },
            });
            b.dataset.role = `tool-${id}`;
            toolsWrap.appendChild(b);
        }
    }

    // ---------------------------------------------------------------------------
    // UI updates: cheap class toggles + active buttons
    // ---------------------------------------------------------------------------

    _invalidateUI() {
        if (this._uiDirty) return;
        this._uiDirty = true;
        this._uiRaf = requestAnimationFrame(() => {
            this._uiDirty = false;
            this._uiRaf = null;
            this._updateUI();
            this._requestRedrawLinks();
        });
    }

    _updateUI() {
        const root = this.root;
        if (!root) return;

        // mode classes
        root.classList.toggle("edit-mode", this.mode === "edit");
        if (this.mode === "edit") root.dataset.tool = this.tool;
        else delete root.dataset.tool;

        // tab visibility (mounted once; just toggle active)
        const isSim = (this.mode === "edit" || this.mode === "run");
        this._simBody.classList.toggle("active", isSim);
        this._tracerBody.classList.toggle("active", this.mode === "trace");
        this._pageBody.classList.toggle("active", this.mode === "page");

        // sidebar only in edit
        this._sidebar.classList.toggle("hidden", this.mode !== "edit");

        // toolbar updates
        const toolbar = this._toolbar;
        if (toolbar) {
            const setActive = (role, active) => {
                const el = toolbar.querySelector(`[data-role="${role}"]`);
                el?.classList?.toggle("active", !!active);
            };

            // --- active states for mode buttons
            setActive("mode-edit", this.mode === "edit");
            setActive("mode-run", this.mode === "run");
            setActive("mode-trace", this.mode === "trace");
            setActive("mode-page", this.mode === "page");

            // --- active state for pause
            setActive("pause", this.mode === "run" && this.isPaused);

            // --- active state for speed buttons
            const speedRoles = [2000, 1000, 500, 250, 125, 62, 32];
            for (const ms of speedRoles) {
                setActive(`speed-${ms}`, this.mode === "run" && !this.isPaused && SimControl.tick === ms);
            }

            // --- hide/show whole groups + their separators
            const speedsInner = toolbar.querySelector(`[data-group="speeds"]`);
            const projectInner = toolbar.querySelector(`[data-group="project"]`);

            const speedsGroup = speedsInner?.closest(".sim-toolbar-group") ?? speedsInner;
            const projectGroup = projectInner?.closest(".sim-toolbar-group") ?? projectInner;

            const sepSpeeds = toolbar.querySelector(`[data-role="sep-speeds"]`);
            const sepProject = toolbar.querySelector(`[data-role="sep-project"]`);

            const setHidden = (el, hidden) => el?.classList?.toggle("hidden", !!hidden);

            const showSpeeds = (this.mode === "run");
            const showProject = (this.mode === "edit");

            setHidden(speedsGroup, !showSpeeds);
            setHidden(sepSpeeds, !showSpeeds);

            setHidden(projectGroup, !showProject);
            setHidden(sepProject, !showProject);

        }

        // sidebar tool actives
        const toolsWrap = this._toolsWrap;
        if (toolsWrap) {
            for (const btn of toolsWrap.querySelectorAll("[data-role^='tool-']")) {
                const role = btn.getAttribute("data-role") || "";
                const id = role.slice("tool-".length);
                btn.classList.toggle("active", this.mode === "edit" && this.tool === id);
            }
        }
    }


    // ---------------------------------------------------------------------------
    // Scene DOM sync: add/remove nodes incrementally, no full rebuild
    // ---------------------------------------------------------------------------

    _syncSceneDOM() {
        const nodes = this.nodesLayer;
        if (!nodes) return;

        // 1) Ensure node elements exist and attached
        for (const obj of this.simobjects) {
            if (obj instanceof Link) continue; // links are drawn via their own DOM; still include if your Link.render returns an element

            if (!this._objEls.has(obj.id)) {
                const el = obj.render();
                this._objEls.set(obj.id, el);

                // optional focus class
                if (this.focusedObject?.id === obj.id) el.classList.add("is-focused");

                nodes.appendChild(el);
            } else {
                // already exists, ensure in DOM
                const el = this._objEls.get(obj.id);
                if (el && el.parentElement !== nodes) nodes.appendChild(el);
            }
        }

        // 2) Links: make sure their DOM exists too (if Link.render creates one)
        for (const obj of this.simobjects) {
            if (!(obj instanceof Link)) continue;

            if (!this._objEls.has(obj.id)) {
                const el = obj.render();
                this._objEls.set(obj.id, el);
                nodes.appendChild(el);

                // attach packet elements once
                for (const p of obj._packets) {
                    if (SimControl.packetsLayer && p.el && p.el.parentElement !== SimControl.packetsLayer) {
                        SimControl.packetsLayer.appendChild(p.el);
                    }
                }
            }
        }

        // 3) Remove orphan DOM elements
        const alive = new Set(this.simobjects.map((o) => o.id));
        for (const [id, el] of this._objEls) {
            if (!alive.has(id)) {
                el.remove();
                this._objEls.delete(id);
            }
        }

        this._requestRedrawLinks();
    }

    _requestRedrawLinks() {
        if (this._redrawReq) return;
        this._redrawReq = true;
        requestAnimationFrame(() => {
            this._redrawReq = false;
            this.redrawLinks();
        });
    }

    redrawLinks() {
        for (const obj of this.simobjects) {
            if (obj instanceof Link) obj.redrawLinks();
        }
    }

    async _openLanguageDialog(anchorEl) {
        if (this._langPanel) {
            this._closeLanguageDialog();
            return;
        }

        const panel = document.createElement("div");
        panel.className = "sim-lang-picker";
        panel.style.position = "fixed";

        const locales = await getLocales();
        const current = getLocale();

        for (const loc of locales) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "sim-lang-option";
            b.textContent = loc.label;
            if (loc.key === current) b.classList.add("active");

            b.addEventListener("click", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();

                if (loc.key === getLocale()) {
                    this._closeLanguageDialog();
                    return;
                }

                const oldLoc = getLocale();
                await setLocale(loc.key);
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

        const ar = anchorEl.getBoundingClientRect();
        const r = panel.getBoundingClientRect();
        const pad = 8;

        let left = ar.left;
        let top = ar.bottom + 6;
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

    // --------------------
    // RAF loop for packets
    // --------------------

    _startRafLoop() {
        if (this._rafId != null) return;

        this._rafLastTs = performance.now();

        const loop = (ts) => {
            this._rafId = requestAnimationFrame(loop);
            const dt = ts - this._rafLastTs;
            this._rafLastTs = ts;

            if (this.mode !== "run") {
                return;
            }

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

    // ---------------------
    // Edit mode transitions 
    // ---------------------

    _enterEditMode() {
        this.mode = "edit";
        this.isPaused = true;
        this.closeAllPanels();

        this._leaveEditMode(); //does the same thing; selects default tool and 
                               //redraws UI
    }

    _leaveEditMode() {
        this.tool = "select";
        this._cancelLinking();
        this._removeGhostNode();
        this._clearDeleteHover();
        this._invalidateUI();
    }

    // -------------
    // Pointer Logic
    // -------------

    /** @param {PointerEvent} ev */
    _getLocalPoint(ev) {
        const layer = this.nodesLayer;
        if (!layer) return { x: ev.clientX, y: ev.clientY };

        const r = layer.getBoundingClientRect();

        // IMPORTANT: include scroll offset because ghosts are positioned in the scroll content space
        return {
            x: (ev.clientX - r.left) + layer.scrollLeft,
            y: (ev.clientY - r.top) + layer.scrollTop,
        };
    }

    /** @param {Event} ev */
    _getObjFromEvent(ev) {
        const t = /** @type {HTMLElement} */ (ev.target);
        const icon = t.closest("[data-objid]");
        if (!icon) return null;
        const id = Number(icon.getAttribute("data-objid"));
        if (!Number.isFinite(id)) return null;
        return this.simobjects.find((o) => o.id === id) ?? null;
    }

    /** @param {Event} ev */
    _getLinkFromEvent(ev) {
        const t = /** @type {HTMLElement} */ (ev.target);
        const el = t.closest(".sim-link");
        if (!el) return null;
        const objid = el.getAttribute("data-objid");
        if (!objid) return null;
        const id = Number(objid);
        return this.simobjects.find((o) => o.id === id) ?? null;
    }

    _cancelLinking() {
        this._linkStart = null;
        this._linkStartKey = null;
        if (this._ghostLink) this._ghostLink.remove();
        this._ghostLink = null;
    }

    /** @param {PointerEvent} ev */
    _onPointerMove(ev) {
        if (this.mode !== "edit") return;

        const p = this._getLocalPoint(ev);

        if (
            this.tool === "place-pc" ||
            this.tool === "place-router" ||
            this.tool === "place-switch" ||
            this.tool === "place-text" ||
            this.tool === "place-rect"
        ) {
            this._ensureGhostNode(this.tool);
            this._moveGhostNode(p.x, p.y);
        } else {
            this._removeGhostNode();
        }

        if (this.tool === "link" && this._linkStart) {
            this._ensureGhostLink();
            this._updateGhost(p.x, p.y);
        }

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

        // Right click: cancel current tool (if not select)
        // (Your oncontextmenu handler already does this on empty canvas,
        // but this handles right-click on objects/links too.)
        if (ev.button === 2 && this.tool !== "select") {
            ev.preventDefault();
            ev.stopPropagation();

            this._cancelLinking();
            this._removeGhostNode();
            this._clearDeleteHover();

            this.tool = "select";
            if (this.root) this.root.dataset.tool = this.tool;
            this._invalidateUI();
            return;
        }

        // DELETE tool: click link or node to delete
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

        // LINK tool: two-click connect, with port picker
        if (this.tool === "link") {
            if (!obj) return; // must click a node
            ev.preventDefault();
            ev.stopPropagation();

            // First click: pick A port
            if (!this._linkStart) {
                const pickA = await this._pickPortForObjectAt(obj, ev.clientX + 8, ev.clientY + 8);
                if (!pickA) {
                    throw Error("No free ports");
                }

                this._linkStart = obj;
                this._linkStartKey = pickA.key;

                // start ghost link
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

                if (!portA || !portB) {
                    throw Error("Port not found");
                }

                // Sanity check: should already be ensured by disabled buttons
                if (!this._isPortFree(portA)) {
                    throw Error("Port in use.");
                }
                if (!this._isPortFree(portB)) {
                    throw Error("Port in use.");
                }

                const l = new Link(A, portA, AKey, B, portB, BKey, this);
                l.simcontrol = this;
                this.addObject(l);
            } catch (e) {
                alert(t("sim.link.error"));
            } finally {
                this._cancelLinking();
            }

            return;
        }

        // PLACE tools: click empty canvas places
        if (this.tool.startsWith("place-")) {
            // Only place if ghost exists and has size
            if (!this._ghostNodeEl || !this._ghostReady) return;

            ev.preventDefault();
            ev.stopPropagation();

            const p = this._getLocalPoint(ev);

            /** @type {SimulatedObject|null} */
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
            this._requestRedrawLinks();

            // Clean up placement tool state
            this._removeGhostNode();
            this.tool = "select";
            if (this.root) this.root.dataset.tool = this.tool;
            this._invalidateUI();
            return;
        }

        // SELECT tool: focus node
        if (this.tool === "select") {
            if (obj) this.setFocus(obj);
            return;
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

    _ensureGhostLink() {
        if (!this.nodesLayer) return;
        if (this._ghostLink) return;

        const g = document.createElement("div");
        g.className = "sim-link sim-link-ghost";
        g.style.pointerEvents = "none";
        g.style.transformOrigin = "0 0";

        const hit = document.createElement("div");
        hit.className = "sim-link-hit";
        hit.style.pointerEvents = "none";

        const line = document.createElement("div");
        line.className = "sim-link-line";
        line.style.pointerEvents = "none";

        g.appendChild(hit);
        g.appendChild(line);

        this.nodesLayer.appendChild(g);
        this._ghostLink = g;
    }

    /** @param {number} endX local @param {number} endY local */
    _updateGhost(endX, endY) {
        if (!this._ghostLink || !this._linkStart) return;
        const x1 = this._linkStart.getX();
        const y1 = this._linkStart.getY();

        const dx = endX - x1;
        const dy = endY - y1;
        const length = Math.hypot(dx, dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

        this._ghostLink.style.width = `${length}px`;
        this._ghostLink.style.left = `${x1}px`;
        this._ghostLink.style.top = `${y1}px`;
        this._ghostLink.style.transform = `rotate(${angle}deg)`;
    }

    // -----------
    // Save / Load
    // -----------

    toJSON() {
        return {
            version: 4,
            tick: SimControl.tick,
            objects: this.simobjects.map((o) => o.toJSON()),
        };
    }

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

        this._clearScene();

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

        this.isPaused = true;
        this._syncSceneDOM();
        this.redrawLinks();
    }

    new() {
        this._clearScene();
        SimulatedObject.idnumber = 0;
        SimControl.tick = 500;
        this.isPaused = true;

        for (const el of this._objEls.values()) el.remove();
        this._objEls.clear();

        this._enterEditMode();
        this._syncSceneDOM();
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

    closeAllPanels() {
        for (const obj of this.simobjects) {
            if (obj instanceof SimulatedObject) obj.setPanelOpen(false);
        }
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

    _clearScene() {
        // 1) stop simulation timers (optional but recommended)
        if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
        this.timeoutId = null;

        // 2) destroy links first (they may own packet DOM)
        for (const o of this.simobjects) {
            if (o instanceof Link) {
                // remove packet dom if Link doesn't fully do it
                for (const p of o._packets ?? []) p.el?.remove?.();
                o.destroy?.();
            }
        }

        // 3) destroy remaining objects
        for (const o of this.simobjects) {
            if (!(o instanceof Link)) o.destroy?.();
        }

        // 4) clear arrays + maps
        this.simobjects = [];
        this.focusedObject = null;
        this._linkStart = null;
        this._linkStartKey = null;

        // 5) remove all known DOM nodes we mounted for objects/links
        for (const el of this._objEls.values()) el.remove();
        this._objEls.clear();

        // 6) clear packets layer completely (safest)
        SimControl.packetsLayer?.replaceChildren();

        // 7) clear ghost/delete states
        this._cancelLinking();
        this._removeGhostNode();
        this._clearDeleteHover();

        // 8) redraw request reset
        this._redrawReq = false;
    }

    _syncInitialModeFromUrl() {
        const router = this._staticRouter;
        if (!router) return;

        // normalize path: strip ? # and trailing slash
        let p = window.location.pathname || "/";
        if (p.length > 1) p = p.replace(/\/+$/g, "");
        // (pathname already excludes ?/#, but keep it defensive)
        p = p.split("?")[0].split("#")[0];

        const routes = router.getRoutes();
        if (routes.includes(p)) {
            this.mode = "page";
            this.isPaused = true;
            router.navigate(p, { replace: true });
        }
    }
}
