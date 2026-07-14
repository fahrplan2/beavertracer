//@ts-check
import { SimulatedObject } from "./sim/SimulatedObject.js";
import { Link } from "./sim/Link.js";
import { PCapViewer } from "./tracer/PCapViewer.js";
import { Computer } from "./sim/Computer.js";
import { Switch } from "./sim/Switch.js";
import { Router } from "./sim/Router.js";
import { TextBox } from "./sim/TextBox.js";
import { RectOverlay } from "./sim/RectOverlay.js";
import { AccessPoint } from "./sim/AccessPoint.js";
import { Tablet } from "./sim/Tablet.js";
import { HomeRouter } from "./sim/HomeRouter.js";
import { Firewall } from "./sim/Firewall.js";
import { WifiMedium } from "./net/WifiMedium.js";
import { simTimer } from "./lib/SimTimer.js";
import { t, getLocale, setLocale, getLocales } from "./i18n/index.js";
import { StaticPageRouter } from "./StaticPageRouter.js";
import { PCapController } from "./tracer/PCapControler.js";
import { UILib } from "./lib/UILib.js";
import { SimDialog } from "./lib/SimDialog.js";
import { WelcomeDialog } from "./lib/WelcomeDialog.js";
import { version } from "./lib/version.js";
import { isTauri } from "./tauri.js";
import { CompanionBridge } from "./sim/CompanionBridge.js";

/**
 * @typedef {Object} PortDescriptor
 * @property {string} key
 * @property {string} label
 * @property {any} port
 */

/** Maps place-tool id → constructor */
const PLACE_TOOL_CTOR = /** @type {Record<string, new(...args: any[]) => SimulatedObject>} */ ({
    "place-computer":          Computer,
    "place-tablet":            Tablet,
    "place-switch":            Switch,
    "place-router":            Router,
    "place-homerouter":        HomeRouter,
    "place-ap":                AccessPoint,
    "place-firewall":          Firewall,
    "place-text":              TextBox,
    "place-rect":              RectOverlay,
    "place-companion-bridge":  CompanionBridge,
});

/** Maps place-tool id → i18n name key (undefined = no default name) */
const PLACE_TOOL_NAME_KEY = /** @type {Record<string, string>} */ ({
    "place-computer":   "computer.title",
    "place-tablet":     "tablet.title",
    "place-switch":     "switch.title",
    "place-router":     "router.title",
    "place-homerouter": "homerouter.title",
    "place-ap":         "ap.title",
    "place-firewall":   "firewall.title",
});

export class SimControl {

    // ── Fields ───────────────────────────────────────────────────────────────

    /** @type {Array<SimulatedObject>} array of all simulation objects */
    simobjects = [];

    /** @type {Array<import("./sim/Link.js").Link>} fast-path subset for the RAF loop */
    _links = [];

    /** @type {PCapController} linked pcapController */
    pcapController;

    /** @type {PCapViewer} */
    pcapViewer;

    /** @type {number} simulation speed (time it takes to do one tick in ms) */
    static tick = 100;

    /** @type {number} ID of the simulation step */
    tickId = 0;

    /** @type {boolean} is the simulation paused? */
    isPaused = true;

    /** @type {{ wasPaused: boolean, tick: number }|null} saved state when entering trace mode */
    _tracePreState = null;

    /** @type {HTMLElement|null} HTML-Element to render everything in*/
    root;

    /** @type {HTMLDivElement|null} */
    nodesLayer = null;

    /** @type {HTMLDivElement|null} */
    static packetsLayer = null;

    /** @type {HTMLDivElement|null} */
    static portLabelsLayer = null;

    wifiMedium = new WifiMedium();

    /** @type {number|null} */
    timeoutId = null;

    /** @type {HTMLElement|null} */
    movementBoundary = null;

    /** @type {"edit"|"run"|"trace"|"page"} */
    mode = "edit";

    /** @type {"select"|"place-computer"|"place-tablet"|"place-switch"|"place-router"|"place-homerouter"|"place-ap"|"place-firewall"|"place-text"|"place-rect"|"link"|"delete"} */
    tool = "select";

    /** @type {SimulatedObject|null} */
    focusedObject = null;

    /** @type {SimulatedObject|null} */
    _linkStart = null;

    /** @type {HTMLDivElement|null} */
    _ghostLink = null;

    /** @type {HTMLDivElement|null} */
    _ghostNodeEl = null;

    /** @type {"place-computer"|"place-tablet"|"place-switch"|"place-router"|"place-homerouter"|"place-ap"|"place-firewall"|"place-text"|"place-rect"|null} */
    _ghostNodeType = null;

    /** @type {boolean} */
    _ghostReady = false;

    /** @type {string|null} */
    _linkStartKey = null;

    /** @type {boolean} */
    _linkPaused = false;

    /** @type {HTMLElement|null} */
    _deleteHoverEl = null;

    /** @type {import('./lib/Tour.js').Tour|null} */
    _activeTour = null;

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

    /** @type {HTMLDivElement|null} */
    _tooltipEl = null;

    /** @type {number|null} */
    _tooltipTimer = null;

    /** @type {boolean} */
    _mounted = false;

    // --- Zoom / pan state ---

    /** @type {number} current zoom factor (1.0 = 100 %) */
    _zoom = 1.0;

    /** @type {number} canvas pan X in screen pixels */
    _panX = 0;

    /** @type {number} canvas pan Y in screen pixels */
    _panY = 0;

    /** @type {HTMLDivElement|null} inner canvas that receives the CSS scale transform */
    _simCanvas = null;

    // pinch-to-zoom touch state
    /** @type {number} */ _pinchStartDist = 0;
    /** @type {number} */ _pinchStartZoom = 1;
    /** @type {number} */ _pinchMidX = 0;
    /** @type {number} */ _pinchMidY = 0;
    /** @type {boolean} */ _pinchActive = false;

    // middle-mouse / space pan state
    /** @type {boolean} */ _isPanning = false;
    /** @type {number|null} */ _panPointerId = null;
    /** @type {number} */ _panStartClientX = 0;
    /** @type {number} */ _panStartClientY = 0;
    /** @type {number} */ _panStartX = 0;
    /** @type {number} */ _panStartY = 0;
    /** @type {boolean} */ _spaceDown = false;
    /** @type {boolean} */ _isDragPanning = false;

    /** @type {boolean} */
    _uiDirty = false;

    /** @type {boolean} */
    _isDirty = false;

    /** @type {number|null} */
    _uiRaf = null;

    /** @type {boolean} */
    _redrawReq = false;

    /** @type {boolean} */
    _justPlaced = false;

    /** @type {number|null} */
    _rafId = null;

    /** @type {number} */
    _rafLastTs = performance.now();

    /** @type {StaticPageRouter|null} */
    _staticRouter = null;

    /** @type {HTMLDivElement|null} */
    _pageContent = null;

    /** @type {boolean} */
    embedded = false;

    // ── Constructor & lifecycle ───────────────────────────────────────────────

    /** @type {boolean} */
    debug = false;

    /**
     * @param {HTMLElement|null} root
     * @param {{ embedded?: boolean, debug?: boolean }} [opts]
     */
    constructor(root, opts = {}) {
        this.root = root;
        this.embedded = opts.embedded ?? false;
        this.debug = opts.debug ?? false;

        if (this.embedded) {
            this.mode = "run";
        }

        this.pcapViewer = new PCapViewer(null, {
            hideComputedTreeNodes: true,
            simControl: this,
            onActiveTabChange: (name) => this.pcapController.setActive(name),
        });
        this.pcapController = new PCapController(this.pcapViewer);
        this.wifiMedium.setPcapController(this.pcapController);

        this._mount();          // build DOM once
        this._syncSceneDOM();   // render current objects
        this._updateUI();       // set active states

        this.scheduleNextStep();
        this._startRafLoop();

        if (!this.embedded && !isTauri()) {
            window.addEventListener("beforeunload", this._onBeforeUnload);
        }

        document.addEventListener("show-pcap", (ev) => {
            const { sessionName, port } = /** @type {any} */ (ev).detail;
            this.pcapController.addIf(sessionName, port);
            this.pcapViewer.switchTab(sessionName);
            if (this.mode === "edit") this._resetEditTools();
            this.mode = "trace";
            this._invalidateUI();
            this.pcapViewer.render();
        });
    }

    _onBeforeUnload = (/** @type {BeforeUnloadEvent} */ ev) => {
        if (this._isDirty) ev.preventDefault();
    };

    _mount() {
        if (this._mounted) return;
        this._mounted = true;

        const root = this.root;
        if (!root) return;

        root.replaceChildren();
        root.classList.add("sim-root");
        if (this.embedded) root.classList.add("is-embedded");

        // Logo (shares its grid column with the sidebar and its grid row with
        // the toolbar, so it is always exactly as wide as the sidebar and as
        // tall as the toolbar, at any viewport size or zoom level).
        const logoCell = document.createElement("div");
        logoCell.className = "sim-logo-cell";
        logoCell.title = t("sim.welcome");
        logoCell.addEventListener("click", () => { if (!this.embedded) WelcomeDialog.show(this); });
        root.appendChild(logoCell);
        this._logoCell = logoCell;

        const brandingText = document.createElement("div");
        brandingText.className = "sim-toolbar-branding-text";
        logoCell.appendChild(brandingText);

        const branding = document.createElement("div");
        branding.className = "sim-toolbar-branding";
        branding.textContent = "Beaver Tracer";
        brandingText.appendChild(branding);

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

        // Nodes layer (outer container, never scrolls or scales)
        const nodes = document.createElement("div");
        nodes.className = "sim-nodes";
        simbody.appendChild(nodes);

        this.nodesLayer = nodes;
        this.movementBoundary = nodes;

        const updateSizeVar = () => {
            nodes.style.setProperty("--sim-area-height", nodes.clientHeight + "px");
        };
        updateSizeVar();
        new ResizeObserver(updateSizeVar).observe(nodes);

        // Inner canvas — receives translate + scale transform for zoom/pan
        const simCanvas = document.createElement("div");
        simCanvas.className = "sim-canvas";
        nodes.appendChild(simCanvas);
        this._simCanvas = simCanvas;

        const packetsLayer = document.createElement("div");
        packetsLayer.className = "sim-packets-layer";
        simCanvas.appendChild(packetsLayer);
        SimControl.packetsLayer = packetsLayer;

        const portLabelsLayer = document.createElement("div");
        portLabelsLayer.className = "sim-port-labels-layer";
        simCanvas.appendChild(portLabelsLayer);
        SimControl.portLabelsLayer = portLabelsLayer;

        // Bind pointer events on the outer nodesLayer
        nodes.addEventListener("pointerdown", (ev) => this._onPointerDown(ev));
        nodes.addEventListener("pointermove", (ev) => this._onPointerMove(ev));

        // ── Mouse wheel: Ctrl/Cmd → zoom, plain → pan ─────────────────────
        nodes.addEventListener("wheel", (ev) => {
            // Let panels scroll their own content
            if (ev.target instanceof Element && ev.target.closest(".sim-panel")) return;

            ev.preventDefault();

            if (ev.ctrlKey || ev.metaKey) {
                // Zoom centred on cursor
                const r = nodes.getBoundingClientRect();
                const factor = ev.deltaY > 0 ? (1 / 1.12) : 1.12;
                this._zoomAt(factor, ev.clientX - r.left, ev.clientY - r.top);
            } else {
                // Pan (same direction as native scroll)
                this._panX -= ev.deltaX;
                this._panY -= ev.deltaY;
                this._applyCanvasTransform();
                this._requestRedrawLinks();
            }
        }, { passive: false });

        // ── Touch pinch-to-zoom ────────────────────────────────────────────
        nodes.addEventListener("touchstart", (ev) => {
            if (ev.touches.length !== 2) return;
            ev.preventDefault();
            this._pinchActive = true;
            this._pinchStartDist = Math.hypot(
                ev.touches[0].clientX - ev.touches[1].clientX,
                ev.touches[0].clientY - ev.touches[1].clientY,
            );
            this._pinchStartZoom = this._zoom;
            const r = nodes.getBoundingClientRect();
            this._pinchMidX = (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - r.left;
            this._pinchMidY = (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - r.top;
        }, { passive: false });

        nodes.addEventListener("touchmove", (ev) => {
            if (!this._pinchActive || ev.touches.length !== 2) return;
            ev.preventDefault();
            const dist = Math.hypot(
                ev.touches[0].clientX - ev.touches[1].clientX,
                ev.touches[0].clientY - ev.touches[1].clientY,
            );
            if (this._pinchStartDist < 1) return;
            const targetZoom = Math.max(0.15, Math.min(4, this._pinchStartZoom * dist / this._pinchStartDist));
            const factor = targetZoom / this._zoom;
            this._panX = this._pinchMidX - (this._pinchMidX - this._panX) * factor;
            this._panY = this._pinchMidY - (this._pinchMidY - this._panY) * factor;
            this._zoom = targetZoom;
            this._applyCanvasTransform();
            this._requestRedrawLinks();
        }, { passive: false });

        nodes.addEventListener("touchend", () => { this._pinchActive = false; });
        nodes.addEventListener("touchcancel", () => { this._pinchActive = false; });

        // ── Middle-mouse drag → pan ────────────────────────────────────────
        nodes.addEventListener("pointerdown", (ev) => {
            const isMiddle = ev.button === 1;
            const isSpaceDrag = ev.button === 0 && this._spaceDown;
            if (!isMiddle && !isSpaceDrag) return;
            ev.preventDefault();
            ev.stopPropagation();
            this._startDragPan(ev);
        });

        window.addEventListener("pointermove", (ev) => {
            if (!this._isPanning || ev.pointerId !== this._panPointerId) return;
            this._panX = this._panStartX + (ev.clientX - this._panStartClientX);
            this._panY = this._panStartY + (ev.clientY - this._panStartClientY);
            this._applyCanvasTransform();
            this._requestRedrawLinks();
        });

        window.addEventListener("pointerup", (ev) => {
            if (!this._isPanning || ev.pointerId !== this._panPointerId) return;
            this._isPanning = false;
            this._isDragPanning = false;
            this._panPointerId = null;
            nodes.style.cursor = "";
        });

        // ── Space key → pan mode cursor ────────────────────────────────────
        window.addEventListener("keydown", (ev) => {
            if (ev.code === "Space" && !ev.repeat && document.activeElement === document.body) {
                this._spaceDown = true;
                if (nodes) nodes.style.cursor = "grab";
            }
        });
        window.addEventListener("keyup", (ev) => {
            if (ev.code === "Space") {
                this._spaceDown = false;
                if (!this._isPanning && nodes) nodes.style.cursor = "";
            }
        });

        // ── Arrow keys → pan ────────────────────────────────────────────────
        window.addEventListener("keydown", (ev) => {
            const active = document.activeElement;
            const tag = active?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
            if (active?.classList.contains("term") || active?.classList.contains("term-mobile-input")) return;
            const STEP = 40;
            if (ev.key === "ArrowLeft")  { this._panX += STEP; this._applyCanvasTransform(); this._requestRedrawLinks(); ev.preventDefault(); }
            else if (ev.key === "ArrowRight") { this._panX -= STEP; this._applyCanvasTransform(); this._requestRedrawLinks(); ev.preventDefault(); }
            else if (ev.key === "ArrowUp")   { this._panY += STEP; this._applyCanvasTransform(); this._requestRedrawLinks(); ev.preventDefault(); }
            else if (ev.key === "ArrowDown") { this._panY -= STEP; this._applyCanvasTransform(); this._requestRedrawLinks(); ev.preventDefault(); }
        });

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
            if (ev.key === "Escape") {
                this._cancelLinking();
                if (this.tool.startsWith("place-")) {
                    this._removeGhostNode();
                    this.tool = "select";
                    if (this.root) this.root.dataset.tool = this.tool;
                    this._invalidateUI();
                }
            }
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
        this._currentRoute = "";
        this._staticRouter = new StaticPageRouter({
            fallbackLocale: "en",
            onRoute: ({ route }) => {
                this._currentRoute = route;
                // whenever we are on a static page route, switch UI to about tab
                if (this.mode !== "page") {
                    this.mode = "page";
                    this.isPaused = true;
                }
                this._invalidateUI();
            },
        });
        this._staticRouter.mount(pageContent, { initial: window.location.pathname });

        // Build toolbar + sidebar buttons once
        this._buildToolbar();
        this._buildSidebar();
        this._setupTooltip();
    }

    // ── Simulation loop ───────────────────────────────────────────────────────

    step() {
        // deliver in-flight packets first so simTimer.tick() sees them immediately
        this.wifiMedium.step2(this.simobjects);
        for (let i = 0; i < this.simobjects.length; i++) {
            const x = this.simobjects[i];
            if (x instanceof Link) {
                x.step2();
            }
        }
        simTimer.tick();
        this.wifiMedium.step1(this.simobjects);
        for (let i = 0; i < this.simobjects.length; i++) {
            const x = this.simobjects[i];
            if (x instanceof Link) {
                x.step1();
            }
        }
        this.tickId++;

        this._requestRedrawLinks();
        this.scheduleNextStep();
    }

    scheduleNextStep() {
        if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
        if (this.isPaused) return;
        this.timeoutId = window.setTimeout(() => this.step(), SimControl.tick);
    }

    /** @param {number} ms */
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

    _startRafLoop() {
        if (this._rafId != null) return;

        this._rafLastTs = performance.now();

        /** @param {number} ts */
        const loop = (ts) => {
            this._rafId = requestAnimationFrame(loop);
            const dt = ts - this._rafLastTs;
            this._rafLastTs = ts;

            if (this.mode !== "run") {
                return;
            }

            if (!this.isPaused) {
                for (const link of this._links) link.advance(dt);
            }
            for (const link of this._links) link.renderPacket();
        };

        this._rafId = requestAnimationFrame(loop);
    }

    // ── Mode transitions ──────────────────────────────────────────────────────

    _enterEditMode() {
        this.mode = "edit";
        this.isPaused = true;
        this.closeAllPanels();

        for (const link of this._links) this._clearLinkPackets(link);

        this._resetEditTools();
    }

    _resetEditTools() {
        this.tool = "select";
        this.closeAllPanels();
        this._cancelLinking();
        this._removeGhostNode();
        this._clearDeleteHover();
        this._invalidateUI();
    }

    _enterTraceMode() {
        this._tracePreState = { wasPaused: this.isPaused, tick: SimControl.tick };
        this.isPaused = true;
        this.mode = "trace";
        this._invalidateUI();
        this.pcapViewer.render();
        this.scheduleNextStep();
    }

    _leaveTraceMode() {
        const pre = this._tracePreState;
        this._tracePreState = null;
        this.mode = "run";
        if (pre) {
            SimControl.tick = pre.tick;
            this.isPaused = pre.wasPaused;
        } else {
            this.isPaused = false;
        }
        this._invalidateUI();
        this.scheduleNextStep();
    }

    /** @param {string} path */
    navigateTo(path) {
        this.pause();
        this.mode = "page";
        this._invalidateUI();
        this._staticRouter?.navigate(path, { replace: true });
    }

    // ── Scene management ──────────────────────────────────────────────────────

    /** @param {SimulatedObject} obj */
    addObject(obj) {
        if (this.simobjects.includes(obj)) return;
        this.simobjects.push(obj);
        if (obj instanceof Link) this._links.push(obj);
        obj.simcontrol = this;

        if (/** @type {any} */ (obj)._wPort) {
            this.pcapController.addIf(`${obj.id}: ${/** @type {any} */ (obj)._wPort.name}`, /** @type {any} */ (obj)._wPort);
        }

        this._syncSceneDOM();     // add just this node (and link)
        this._requestRedrawLinks();
        this.markDirty();
    }

    /** @param {SimulatedObject} obj */
    deleteObject(obj) {
        if (this._linkStart === obj) this._cancelLinking();

        const attachedLinks = this.simobjects.filter(
            (o) => o instanceof Link && (o.A === obj || o.B === obj)
        );

        for (const l of attachedLinks) l.destroy();
        if (obj instanceof Link) obj.destroy();

        const toRemove = new Set([obj, ...attachedLinks]);
        this.simobjects = this.simobjects.filter((o) => !toRemove.has(o));
        this._links = this._links.filter((l) => !toRemove.has(l));

        // remove DOM for deleted objects
        for (const o of toRemove) {
            const el = this._objEls.get(o.id);
            if (el) el.remove();
            this._objEls.delete(o.id);

            if (o instanceof Link) this._clearLinkPackets(o);

            // panels now live in nodesLayer (outside obj.root) — remove explicitly
            if (!(o instanceof Link) && o instanceof SimulatedObject) {
                o.panelEl?.remove();
                /** @type {any} */ (o).panelEl = null;
            }

            if (/** @type {any} */ (o)._wPort) {
                this.pcapController.removeIf(`${o.id}: ${/** @type {any} */ (o)._wPort.name}`);
            }
        }

        this._requestRedrawLinks();
        this._invalidateUI();
        this.markDirty();
    }

    /** @param {SimulatedObject|null} obj */
    setFocus(obj) {
        if (this.focusedObject === obj) return;

        // cheap: toggle class, no rebuild
        const prev = this.focusedObject;
        this.focusedObject = obj;

        if (prev) {
            const elPrev = this._objEls.get(prev.id);
            elPrev?.classList?.remove("is-focused");
        }
        if (obj) {
            const elNow = this._objEls.get(obj.id);
            elNow?.classList?.add("is-focused");
        }

        this._invalidateUI(); // if toolbar/panels depend on focus
    }

    closeAllPanels() {
        for (const obj of this.simobjects) {
            if (obj instanceof SimulatedObject) obj.setPanelOpen(false);
        }
    }

    markDirty() {
        this._isDirty = true;
    }

    _clearScene() {
        // 1) stop simulation timers (optional but recommended)
        if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
        this.timeoutId = null;

        // 2) destroy links first (they may own packet DOM)
        for (const o of this.simobjects) {
            if (o instanceof Link) {
                this._clearLinkPackets(o);
                o.destroy?.();
            }
        }

        // 3) destroy remaining objects + unregister wifi pcap sessions
        for (const o of this.simobjects) {
            if (!(o instanceof Link)) {
                if (/** @type {any} */ (o)._wPort) {
                    this.pcapController.removeIf(`${o.id}: ${/** @type {any} */ (o)._wPort.name}`);
                }
                o.destroy?.();
            }
        }

        // 4) clear arrays + maps
        this.simobjects = [];
        this._links = [];
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

    // ── Serialization ─────────────────────────────────────────────────────────

    toJSON() {
        return {
            version: 5,
            appVersion: version(),
            savedAt: new Date().toISOString(),
            tick: SimControl.tick,
            objects: this.simobjects.map((o) => o.toJSON()),
        };
    }

    /** @param {*} state */
    restore(state) {
        this._isDirty = false;
        //@ts-ignore
        const REGISTRY = new Map([
            ["Computer", Computer],
            ["Router", Router],
            ["Switch", Switch],
            ["TextBox", TextBox],
            ["RectOverlay", RectOverlay],
            ["AccessPoint", AccessPoint],
            ["Tablet", Tablet],
            ["HomeRouter", HomeRouter],
            ["Firewall", Firewall],
            ["CompanionBridge", CompanionBridge],
            // Link handled separately
        ]);

        if (!state || !Array.isArray(state.objects)) {
            SimDialog.alert(t("sim.invalidfilewarning"));
            return;
        }

        // v4 → v5: PC renamed to Computer, Laptop renamed to Tablet
        if ((state.version ?? 0) <= 4) {
            /** @type {Record<string, string>} */
            const KIND_V4 = { "PC": "Computer", "Laptop": "Tablet" };
            state = {
                ...state,
                objects: state.objects.map((/** @type {any} */ o) =>
                    o && KIND_V4[o.kind] ? { ...o, kind: KIND_V4[o.kind] } : o
                ),
            };
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
                this._links.push(link);
                if (link.id > maxId) maxId = link.id;
            } catch (e) {
                console.warn("Failed to recreate link:", e);
            }
        }

        // 3) fix id generator
        SimulatedObject.idnumber = maxId + 1;

        // 4) register wifi pcap interfaces (bypassed addObject, so do it here)
        for (const obj of this.simobjects) {
            if (/** @type {any} */ (obj)._wPort) {
                this.pcapController.addIf(`${obj.id}: ${/** @type {any} */ (obj)._wPort.name}`, /** @type {any} */ (obj)._wPort);
            }
        }

        if (this.embedded) {
            this.isPaused = false;
            this.mode = "run";
            this._invalidateUI();
        } else {
            this._enterEditMode();
        }
        this._syncSceneDOM();
        this.redrawLinks();
        requestAnimationFrame(() => this._fitToContent(1));
    }

    new() {
        this._clearScene();
        SimulatedObject.idnumber = 0;
        SimControl.tick = 100;
        this.isPaused = true;

        for (const el of this._objEls.values()) el.remove();
        this._objEls.clear();

        if (this.embedded) {
            this.isPaused = false;
            this.mode = "run";
            this._invalidateUI();
        } else {
            this._enterEditMode();
        }
        this._syncSceneDOM();
        this._isDirty = false;
    }

    /**
     * shows a open dialog and loads a state
     */
    open() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".btsim,.json";

        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const scene = JSON.parse(text);
                this.restore(scene);
            } catch (e) {
                SimDialog.alert(t("sim.loadfailederror"));
            }
        });

        input.click();
    }

    async download() {
        const name = await SimDialog.prompt(t("sim.save.filename"), "simulation");
        if (name === null) return;

        const filename = name.trim() || "simulation";
        const data = {
            _info: "This file was created by BeaverTracer, a network simulation tool. Open it with the BeaverTracer app or at https://beavertracer.eu/",
            ...this.toJSON(),
        };
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename.endsWith(".btsim") ? filename : filename + ".btsim";
        a.click();

        URL.revokeObjectURL(url);
        this._isDirty = false;
    }

    // ── DOM setup ─────────────────────────────────────────────────────────────

    _buildToolbar() {
        const toolbar = this._toolbar;
        if (!toolbar) return;
        toolbar.replaceChildren();

        /** @param {string} [role] */
        const addSeparator = (role) => {
            const sep = document.createElement("div");
            sep.className = "sim-toolbar-sep";
            if (role) sep.dataset.role = role;
            toolbar.appendChild(sep);
            return sep;
        };

        //********** MODES  *********/
        addSeparator("sep-mode");
        const gMode = UILib.buttongroup(t("sim.mode"), toolbar);
        gMode.dataset.group = "mode";

        if (!this.embedded) {
            const btnEdit = UILib.iconbutton({
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
        }

        const btnRun = UILib.iconbutton({
            label: t("sim.run"),
            icon: "fa-play",
            onClick: () => {
                if (!this.embedded && window.location.pathname !== "/") {
                    history.pushState({}, "", "/");
                }
                if (!this.embedded && this.mode === "edit") this._resetEditTools();
                if (this.mode === "trace") {
                    this._leaveTraceMode();
                    return;
                }

                this.mode = "run";
                this.isPaused = false;
                this.markDirty();

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

        const btnTrace = UILib.iconbutton({
            label: t("sim.trace"),
            icon: "fa-magnifying-glass",
            onClick: () => {
                if (!this.embedded && window.location.pathname !== "/") {
                    history.pushState({}, "", "/");
                }
                if (!this.embedded && this.mode === "edit") this._resetEditTools();
                this._enterTraceMode();
            },
        });
        btnTrace.dataset.role = "mode-trace";
        gMode.appendChild(btnTrace);

        //********** SPEED  *********/
        addSeparator("sep-speeds");
        const gSpeeds = UILib.buttongroup(t("sim.simulation"), toolbar);
        gSpeeds.dataset.group = "speeds";

        const pauseBtn = UILib.iconbutton({
            label: t("sim.pause"),
            icon: "fa-pause",
            onClick: () => this.pause(),
        });
        pauseBtn.dataset.role = "pause";
        gSpeeds.appendChild(pauseBtn);

        const speeds = [
            { label: "0.5×", ms: 500 },
            { label: "1×",   ms: 100 },
            { label: "4×",   ms: 40  },
            { label: "8×",   ms: 20  },
        ];

        const speedGrid = document.createElement("div");
        speedGrid.className = "sim-speed-grid";

        for (const s of speeds) {
            const b = UILib.iconbutton({
                label: s.label,
                onClick: () => this.setTick(s.ms),
            });
            b.dataset.role = `speed-${s.ms}`;
            speedGrid.appendChild(b);
        }
        gSpeeds.appendChild(speedGrid);

        const resetBtn = UILib.iconbutton({
            label: t("sim.reset"),
            icon: "fa-arrow-rotate-left",
            onClick: async () => {
                if (!await SimDialog.confirm(t("sim.resetwarning"))) return;
                this.restore(this.toJSON());
                this.mode = "run";
                this.isPaused = false;
                this._invalidateUI();
                this.scheduleNextStep();
            },
        });
        resetBtn.dataset.role = "reset";
        gSpeeds.appendChild(resetBtn);

        if (!this.embedded) {
            //******** PROJECT ***********/
            addSeparator("sep-project");
            const gProject = UILib.buttongroup(t("sim.project"), toolbar);
            gProject.dataset.group = "project";

            // New
            const btnNew = UILib.iconbutton({
                label: t("sim.new"),
                icon: "fa-file",
                onClick: async () => {
                    if (this._isDirty && !await SimDialog.confirm(t("sim.discardandnewwarning"))) return;
                    this.new();
                },
            });
            btnNew.dataset.role = "project-new";
            gProject.appendChild(btnNew);

            // Load
            const btnLoad = UILib.iconbutton({
                label: t("sim.load"),
                icon: "fa-file-arrow-up",
                onClick: async () => {
                    if (this._isDirty && !await SimDialog.confirm(t("sim.discardandloadwarning"))) return;
                    this.open();
                },
            });
            btnLoad.dataset.role = "project-load";
            gProject.appendChild(btnLoad);

            // Save
            const btnSave = UILib.iconbutton({
                label: t("sim.save"),
                icon: "fa-file-arrow-down",
                onClick: () => {
                    this.download();
                },
            });
            btnSave.dataset.role = "project-save";
            gProject.appendChild(btnSave);
        }

        //******** ZOOM ***********/
        addSeparator("sep-zoom");
        const gZoom = UILib.buttongroup(t("sim.zoom"), toolbar);
        gZoom.dataset.group = "zoom";

        const btnZoomOut = UILib.iconbutton({
            label: "−",
            icon: "fa-magnifying-glass-minus",
            onClick: () => {
                const layer = this.nodesLayer;
                if (!layer) return;
                this._zoomAt(1 / 1.25, layer.clientWidth / 2, layer.clientHeight / 2);
            },
        });
        btnZoomOut.dataset.role = "zoom-out";
        btnZoomOut.title = t("sim.zoom.out");
        gZoom.appendChild(btnZoomOut);

        const btnFit = UILib.iconbutton({
            label: t("sim.zoom.fit"),
            icon: "fa-expand",
            onClick: () => this._fitToContent(),
        });
        btnFit.dataset.role = "zoom-fit";
        btnFit.title = t("sim.zoom.fit");
        gZoom.appendChild(btnFit);

        const btnZoomIn = UILib.iconbutton({
            label: "+",
            icon: "fa-magnifying-glass-plus",
            onClick: () => {
                const layer = this.nodesLayer;
                if (!layer) return;
                this._zoomAt(1.25, layer.clientWidth / 2, layer.clientHeight / 2);
            },
        });
        btnZoomIn.dataset.role = "zoom-in";
        btnZoomIn.title = t("sim.zoom.in");
        gZoom.appendChild(btnZoomIn);


        //******** TRACING ***********/
        addSeparator("sep-tracing");
        const gTracing = UILib.buttongroup(t("sim.tracing"), toolbar);
        gTracing.dataset.group = "tracing";

        const btnTracePrev = UILib.iconbutton({
            label: t("pcap.btn.prev"),
            icon: "fa-chevron-left",
            onClick: () => this.pcapViewer.prevPage(),
        });
        btnTracePrev.dataset.role = "tracing-prev";
        gTracing.appendChild(btnTracePrev);

        const btnTraceNext = UILib.iconbutton({
            label: t("pcap.btn.next"),
            icon: "fa-chevron-right",
            onClick: () => this.pcapViewer.nextPage(),
        });
        btnTraceNext.dataset.role = "tracing-next";
        gTracing.appendChild(btnTraceNext);

        const btnTraceFollow = UILib.iconbutton({
            label: t("pcap.btn.follow"),
            icon: "fa-exchange-alt",
            onClick: () => this.pcapViewer.followTcpStream(),
        });
        btnTraceFollow.dataset.role = "tracing-follow";
        gTracing.appendChild(btnTraceFollow);

        if (!this.embedded) {
            //******** COMMON ***********/
            addSeparator("sep-common");
            const gCommon = UILib.buttongroup(t("sim.common"), toolbar);
            gCommon.dataset.group = "common";

            const langBtn = UILib.iconbutton({
                label: t("sim.language"),
                icon: "fa-language",
                onClick: (/** @type {MouseEvent} */ ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    this._openLanguageDialog();
                },
            });
            langBtn.dataset.role = "lang";
            gCommon.appendChild(langBtn);

            const helpBtn = UILib.iconbutton({
                label: t("sim.help"),
                icon: "fa-circle-question",
                onClick: () => {
                    this.pause();
                    this.mode = "page";
                    this._invalidateUI();
                    this._staticRouter?.navigate("/help", { replace: true });
                },
            });
            helpBtn.dataset.role = "mode-help";
            gCommon.appendChild(helpBtn);

            const aboutBtn = UILib.iconbutton({
                label: t("sim.about"),
                icon: "fa-circle-info",
                onClick: () => {
                    this.pause();
                    this.mode = "page";
                    this._invalidateUI();
                    this._staticRouter?.navigate("/about", { replace: true });
                },
            });
            aboutBtn.dataset.role = "mode-about";
            gCommon.appendChild(aboutBtn);
        }

        if (this.embedded) {
            addSeparator("sep-embed-open");
            const btnOpen = UILib.iconbutton({
                label: t("sim.embed.open"),
                icon: "fa-up-right-from-square",
                onClick: () => {
                    const url = new URL(window.location.href);
                    url.searchParams.delete("embed");
                    window.open(url.toString(), "_blank");
                },
            });
            btnOpen.dataset.role = "embed-open";
            toolbar.appendChild(btnOpen);
        }
    }

    _buildSidebar() {
        const toolsWrap = this._toolsWrap;
        if (!toolsWrap) return;
        toolsWrap.replaceChildren();

        const tools = [
            ["select", t("sim.tool.select"), "fa-arrow-pointer"],
            ["link", t("sim.tool.link"), "fa-link"],
            ["place-computer", t("sim.tool.computer"), "fa-desktop"],
            ["place-tablet", t("sim.tool.tablet"), "fa-tablet-screen-button"],
            ["place-switch", t("sim.tool.switch"), "my-icon-switch"],
            ["place-router", t("sim.tool.router"), "my-icon-router"],
            ["place-homerouter", t("sim.tool.homerouter"), "fa-house-signal"],
            ["place-ap", t("sim.tool.ap"), "fa-wifi"],
            ["place-firewall", t("sim.tool.firewall"), "fa-shield-halved"],
            ["place-text", t("sim.tool.textbox"), "fa-font"],
            ["place-rect", t("sim.tool.rectangle"), "fa-square"],
            ...(this.debug ? [["place-companion-bridge", "Companion Bridge", "fa-network-wired"]] : []),
            ["delete", t("sim.tool.delete"), "fa-ban"],
        ];

        for (const [id, label, icon] of tools) {
            const b = UILib.iconbutton({
                className: "sim-sidebar-btn",
                label,
                icon,
                onClick: () => {
                    this.tool = /** @type {any} */ (id);
                    if (this.root) this.root.dataset.tool = this.tool;

                    if (this.tool !== "link") this._cancelLinking();
                    if (!this.tool.startsWith("place-")) {
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
    // Node tooltip (run mode)
    // ---------------------------------------------------------------------------

    _setupTooltip() {
        const el = /** @type {HTMLDivElement} */ (document.createElement("div"));
        el.className = "sim-node-tooltip";
        el.style.display = "none";
        document.body.appendChild(el);
        this._tooltipEl = el;

        const nodes = this.nodesLayer;
        if (!nodes) return;

        nodes.addEventListener("mousemove", (ev) => {
            if (this._tooltipTimer !== null) { clearTimeout(this._tooltipTimer); this._tooltipTimer = null; }
            this._hideTooltip();

            if (this.mode !== "run") return;
            const nodeEl = /** @type {HTMLElement|null} */ (
                (ev.target instanceof Element) ? ev.target.closest(".sim-node") : null
            );
            if (!nodeEl) return;
            const id = Number(nodeEl.dataset.objid);
            const obj = this.simobjects.find(o => o.id === id);
            if (!obj) return;

            const cx = ev.clientX, cy = ev.clientY;
            this._tooltipTimer = window.setTimeout(() => {
                this._tooltipTimer = null;
                this._showTooltip(obj, cx, cy);
            }, 300);
        });

        nodes.addEventListener("mouseleave", () => {
            if (this._tooltipTimer !== null) { clearTimeout(this._tooltipTimer); this._tooltipTimer = null; }
            this._hideTooltip();
        });
    }

    /**
     * @param {import("./sim/SimulatedObject.js").SimulatedObject} obj
     * @param {number} cx  clientX
     * @param {number} cy  clientY
     */
    _showTooltip(obj, cx, cy) {
        const el = this._tooltipEl;
        if (!el) return;

        el.replaceChildren();

        const nameEl = document.createElement("div");
        nameEl.className = "sim-node-tooltip-name";
        nameEl.textContent = obj.name;
        el.appendChild(nameEl);

        const o = /** @type {any} */ (obj);

        // SSID for access points
        if (typeof o._ssid === "string") {
            const row = document.createElement("div");
            row.className = "sim-node-tooltip-row";
            row.textContent = `SSID: ${o._ssid || "-"}`;
            el.appendChild(row);
        }

        // IP interfaces
        const ifaces = /** @type {any[]|undefined} */ (o.net?.interfaces);
        if (Array.isArray(ifaces) && ifaces.length > 0) {
            for (const iface of ifaces) {
                const v4 = (iface.ip?.toString() !== "0.0.0.0")
                    ? `${iface.ip.toString()}/${iface.prefixLength}`
                    : "-";
                let v6;
                if (iface.ip6) {
                    v6 = `${iface.ip6.toString()}/${iface.prefixLength6}`;
                } else if (iface._tentativeIp6) {
                    v6 = `(${iface._tentativeIp6.toString()}/${iface.prefixLength6})`;
                } else {
                    v6 = "-";
                }
                const row = document.createElement("div");
                row.className = "sim-node-tooltip-row";
                row.textContent = `${iface.name}:  IPv4: ${v4}  IPv6: ${v6}`;
                el.appendChild(row);
            }
        }

        el.style.display = "block";
        const GAP = 14;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        el.style.left = "0";
        el.style.top = "0";
        const { width: tw, height: th } = el.getBoundingClientRect();
        const left = (cx + GAP + tw > vw) ? cx - GAP - tw : cx + GAP;
        const top  = (cy + GAP + th > vh) ? cy - GAP - th : cy + GAP;
        el.style.left = `${left}px`;
        el.style.top  = `${top}px`;
    }

    _hideTooltip() {
        if (this._tooltipTimer !== null) { clearTimeout(this._tooltipTimer); this._tooltipTimer = null; }
        if (this._tooltipEl) this._tooltipEl.style.display = "none";
    }

    // ── UI updates ────────────────────────────────────────────────────────────

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

        if (this.mode !== "run") this._hideTooltip();

        // tab visibility (mounted once; just toggle active)
        const isSim = (this.mode === "edit" || this.mode === "run");
        this._simBody?.classList.toggle("active", isSim);
        this._tracerBody?.classList.toggle("active", this.mode === "trace");
        this._pageBody?.classList.toggle("active", this.mode === "page");

        // sidebar only in edit
        this._sidebar?.classList.toggle("hidden", this.mode !== "edit");

        // toolbar updates
        const toolbar = this._toolbar;
        if (toolbar) {
            /** @param {string} role @param {boolean} active */
            const setActive = (role, active) => {
                const el = toolbar.querySelector(`[data-role="${role}"]`);
                el?.classList?.toggle("active", !!active);
            };

            // --- active states for mode buttons
            setActive("mode-edit", this.mode === "edit");
            setActive("mode-run", this.mode === "run");
            setActive("mode-trace", this.mode === "trace");
            setActive("mode-help",      this.mode === "page" && this._currentRoute === "/help");
            setActive("mode-about",     this.mode === "page" && this._currentRoute === "/about");
            setActive("mode-downloads", this.mode === "page" && this._currentRoute === "/downloads");

            // --- active state for pause
            setActive("pause", this.mode === "run" && this.isPaused);

            // --- active state for speed buttons
            const speedRoles = [500, 100, 40, 20];
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

            /** @param {Element|null|undefined} el @param {boolean} hidden */
            const setHidden = (el, hidden) => el?.classList?.toggle("hidden", !!hidden);

            const showSpeeds  = (this.mode === "run");
            const showProject = (this.mode === "edit");
            const showZoom    = (this.mode === "edit" || this.mode === "run");

            setHidden(speedsGroup, !showSpeeds);
            setHidden(sepSpeeds, !showSpeeds);

            setHidden(projectGroup, !showProject);
            setHidden(sepProject, !showProject);

            const zoomInner = toolbar.querySelector(`[data-group="zoom"]`);
            const zoomGroup = zoomInner?.closest(".sim-toolbar-group") ?? zoomInner;
            const sepZoom   = toolbar.querySelector(`[data-role="sep-zoom"]`);
            setHidden(zoomGroup, !showZoom);
            setHidden(sepZoom, !showZoom);

            const showTracing = (this.mode === "trace");
            const tracingInner = toolbar.querySelector(`[data-group="tracing"]`);
            const tracingGroup = tracingInner?.closest(".sim-toolbar-group") ?? tracingInner;
            const sepTracing   = toolbar.querySelector(`[data-role="sep-tracing"]`);
            setHidden(tracingGroup, !showTracing);
            setHidden(sepTracing, !showTracing);

            if (showTracing) {
                /** @param {string} role @param {boolean} disabled */
                const setDisabled = (role, disabled) => {
                    const el = /** @type {HTMLButtonElement|null} */ (toolbar.querySelector(`[data-role="${role}"]`));
                    if (el) el.disabled = disabled;
                };
                setDisabled("tracing-prev",   !this.pcapViewer.canPrevPage());
                setDisabled("tracing-next",   !this.pcapViewer.canNextPage());
                setDisabled("tracing-follow", !this.pcapViewer.canFollowTcpStream());
            }

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

    // ── Scene DOM sync ────────────────────────────────────────────────────────

    _syncSceneDOM() {
        const nodes = this.nodesLayer;
        if (!nodes) return;

        const simCanvas = this._simCanvas ?? nodes;

        // 1) Ensure node elements exist and attached
        for (const obj of this.simobjects) {
            if (obj instanceof Link) continue; // links are drawn via their own DOM; still include if your Link.render returns an element

            if (!this._objEls.has(obj.id)) {
                // Place panel in nodesLayer (outside sim-canvas) so it is never zoomed
                obj.panelRoot = nodes;
                const el = obj.render();
                this._objEls.set(obj.id, el);

                // optional focus class
                if (this.focusedObject?.id === obj.id) el.classList.add("is-focused");

                simCanvas.appendChild(el);
            } else {
                // already exists, ensure in DOM
                const el = this._objEls.get(obj.id);
                if (el && el.parentElement !== simCanvas) simCanvas.appendChild(el);
            }
        }

        // 2) Links: make sure their DOM exists too (if Link.render creates one)
        for (const obj of this.simobjects) {
            if (!(obj instanceof Link)) continue;

            if (!this._objEls.has(obj.id)) {
                const el = obj.render();
                this._objEls.set(obj.id, el);
                simCanvas.appendChild(el);

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
        const GAP = 8;

        // Group parallel links by unordered endpoint pair
        /** @type {Map<string, Link[]>} */
        const groups = new Map();
        for (const obj of this.simobjects) {
            if (!(obj instanceof Link)) continue;
            const key = obj.A.id < obj.B.id
                ? `${obj.A.id}-${obj.B.id}`
                : `${obj.B.id}-${obj.A.id}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)?.push(obj);
        }

        // Assign perpendicular offsets, centred around 0
        for (const links of groups.values()) {
            const n = links.length;
            for (let i = 0; i < n; i++) {
                links[i]._parallelOffset = (i - (n - 1) / 2) * GAP;
            }
        }

        for (const obj of this.simobjects) {
            if (obj instanceof Link) obj.redrawLinks();
        }
    }

    /**
     * @param {import("./sim/SimulatedObject.js").SimulatedObject} node
     * @param {boolean} entering
     */
    _onNodeHover(node, entering) {
        for (const obj of this.simobjects) {
            if (!(obj instanceof Link)) continue;
            if (obj.A === node || obj.B === node) obj.setNodeHovered(node, entering);
        }
    }

    // ── Language dialog ───────────────────────────────────────────────────────

    async _openLanguageDialog() {
        if (this._langPanel) {
            this._closeLanguageDialog();
            return;
        }

        const backdrop = document.createElement("div");
        backdrop.className = "sim-dialog-backdrop";

        const dlg = document.createElement("div");
        dlg.className = "sim-langdialog";
        dlg.setAttribute("role", "dialog");
        dlg.setAttribute("aria-modal", "true");

        const header = document.createElement("div");
        header.className = "sim-langdialog-header";
        const title = document.createElement("span");
        title.textContent = t("sim.language");
        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "sim-langdialog-close";
        closeBtn.innerHTML = "&times;";
        closeBtn.addEventListener("click", () => this._closeLanguageDialog());
        header.appendChild(title);
        header.appendChild(closeBtn);
        dlg.appendChild(header);

        const search = document.createElement("input");
        search.type = "search";
        search.className = "sim-langdialog-search";
        search.placeholder = "Filter…";
        dlg.appendChild(search);

        const locales = await getLocales();
        const current = getLocale();

        const FEATURED = new Set(["de", "en"]);

        /** @param {{ key: string, label: string }} loc */
        const makeClickHandler = (loc) => async (/** @type {MouseEvent} */ ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (loc.key === getLocale()) { this._closeLanguageDialog(); return; }
            if (this._isDirty) {
                const ok = await SimDialog.confirm(t("sim.langswitch.confirmdiscard"));
                if (!ok) return;
            }
            await setLocale(loc.key);
            this._isDirty = false;
            window.location.reload();
        };

        const featured = document.createElement("div");
        featured.className = "sim-langdialog-featured";

        const sep = document.createElement("hr");
        sep.className = "sim-langdialog-sep";

        const list = document.createElement("div");
        list.className = "sim-langlist";

        let hasAI = false;

        for (const loc of locales) {
            const parts = loc.label.split(" ");
            const flag = parts[0];
            const isAI = loc.label.includes("(translated by AI)");
            const name = parts.slice(1).join(" ").replace(/\s*\(translated by AI\)\s*$/g, "").trim();
            if (isAI) hasAI = true;

            if (FEATURED.has(loc.key)) {
                const card = document.createElement("button");
                card.type = "button";
                card.className = "sim-lang-card";
                if (loc.key === current) card.classList.add("active");

                const flagEl = document.createElement("span");
                flagEl.className = "sim-lang-card-flag";
                flagEl.textContent = flag;

                const nameEl = document.createElement("span");
                nameEl.className = "sim-lang-card-name";
                nameEl.textContent = name;

                card.appendChild(flagEl);
                card.appendChild(nameEl);
                card.addEventListener("click", makeClickHandler(loc));
                featured.appendChild(card);
            } else {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "sim-langlist-item";
                if (loc.key === current) btn.classList.add("active");

                const flagEl = document.createElement("span");
                flagEl.className = "sim-langlist-item-flag";
                flagEl.textContent = flag;

                const nameEl = document.createElement("span");
                nameEl.className = "sim-langlist-item-name";
                nameEl.textContent = isAI ? `${name} *` : name;

                btn.appendChild(flagEl);
                btn.appendChild(nameEl);
                btn.addEventListener("click", makeClickHandler(loc));
                list.appendChild(btn);
            }
        }

        dlg.appendChild(featured);
        dlg.appendChild(sep);
        dlg.appendChild(list);

        search.addEventListener("input", () => {
            const q = search.value.toLowerCase();
            for (const el of /** @type {HTMLCollectionOf<HTMLElement>} */ (featured.children)) {
                const nameEl = el.querySelector(".sim-lang-card-name");
                el.style.display = !q || nameEl?.textContent?.toLowerCase().includes(q) ? "" : "none";
            }
            for (const el of /** @type {HTMLCollectionOf<HTMLElement>} */ (list.children)) {
                const nameEl = el.querySelector(".sim-langlist-item-name");
                el.style.display = !q || nameEl?.textContent?.toLowerCase().includes(q) ? "" : "none";
            }
        });

        if (hasAI) {
            const note = document.createElement("p");
            note.className = "sim-langdialog-note";
            note.textContent = "* translated by AI";
            dlg.appendChild(note);
        }

        backdrop.appendChild(dlg);
        document.body.appendChild(backdrop);
        this._langPanel = backdrop;
        search.focus();

        /** @param {KeyboardEvent} ev */
        const onKey = (ev) => {
            if (ev.key === "Escape") this._closeLanguageDialog();
        };

        backdrop.addEventListener("click", (ev) => {
            if (ev.target === backdrop) this._closeLanguageDialog();
        });

        this._langCleanup = () => {
            window.removeEventListener("keydown", onKey);
        };
        window.addEventListener("keydown", onKey);
    }

    _closeLanguageDialog() {
        if (this._langCleanup) this._langCleanup();
        this._langCleanup = null;

        if (this._langPanel) this._langPanel.remove();
        this._langPanel = null;
    }

    openLanguageDialog() {
        this._openLanguageDialog();
    }

    // ── Viewport: pan & zoom ──────────────────────────────────────────────────

    /**
     * Clamp _panX/_panY so that the content bounding box never fully leaves
     * the visible area. At least MARGIN pixels of content must remain on-screen.
     */
    _clampPan() {
        const layer = this.nodesLayer;
        if (!layer) return;

        const layerW = layer.clientWidth  || 0;
        const layerH = layer.clientHeight || 0;
        if (layerW < 2 || layerH < 2) return;

        const zoom   = this._zoom;
        const MARGIN = 80; // minimum visible content strip in px

        // Content bounding box in canvas coordinates
        const nodeObjs = this.simobjects.filter(
            o => !(o instanceof Link) && o instanceof SimulatedObject,
        );

        let minX = 0, minY = 0;
        let maxX = layerW / zoom;   // default: virtual canvas = viewport
        let maxY = layerH / zoom;

        if (nodeObjs.length > 0) {
            ({ minX, minY, maxX, maxY } = this._calcBoundingBox(nodeObjs));
        }

        // Content edges in screen space:
        //   right  = panX + maxX * zoom  ≥ MARGIN
        //   left   = panX + minX * zoom  ≤ layerW − MARGIN
        //   bottom = panY + maxY * zoom  ≥ MARGIN
        //   top    = panY + minY * zoom  ≤ layerH − MARGIN
        const minPanX = MARGIN - maxX * zoom;
        const maxPanX = layerW - MARGIN - minX * zoom;
        const minPanY = MARGIN - maxY * zoom;
        const maxPanY = layerH - MARGIN - minY * zoom;

        if (minPanX <= maxPanX) {
            this._panX = Math.max(minPanX, Math.min(maxPanX, this._panX));
        } else {
            // Content is narrower than 2×MARGIN: centre it horizontally
            this._panX = (layerW - (maxX - minX) * zoom) / 2 - minX * zoom;
        }

        if (minPanY <= maxPanY) {
            this._panY = Math.max(minPanY, Math.min(maxPanY, this._panY));
        } else {
            // Content is shorter than 2×MARGIN: centre it vertically
            this._panY = (layerH - (maxY - minY) * zoom) / 2 - minY * zoom;
        }
    }

    /** Apply the current pan+zoom state to the sim-canvas CSS transform. */
    _applyCanvasTransform() {
        if (!this._simCanvas) return;
        this._clampPan();
        this._simCanvas.style.transform =
            `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`;

        // Keep the dot grid on nodesLayer aligned with the canvas content
        const layer = this.nodesLayer;
        if (layer) {
            layer.style.setProperty("--sim-dot-size", `${24 * this._zoom}px`);
            layer.style.setProperty("--sim-dot-x",    `${this._panX}px`);
            layer.style.setProperty("--sim-dot-y",    `${this._panY}px`);
        }
    }

    /**
     * Zoom by `factor`, keeping the point (pivotX, pivotY) in nodesLayer-local
     * screen coordinates stationary.
     * @param {number} factor
     * @param {number} pivotX  pixels from nodesLayer left edge
     * @param {number} pivotY  pixels from nodesLayer top edge
     */
    _zoomAt(factor, pivotX, pivotY) {
        const newZoom = Math.max(0.15, Math.min(4, this._zoom * factor));
        const realFactor = newZoom / this._zoom;
        this._panX = pivotX - (pivotX - this._panX) * realFactor;
        this._panY = pivotY - (pivotY - this._panY) * realFactor;
        this._zoom = newZoom;
        this._applyCanvasTransform();
        this._requestRedrawLinks();
    }

    /**
     * Returns the axis-aligned bounding box of an array of node objects.
     * @param {SimulatedObject[]} nodeObjs
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
     */
    _calcBoundingBox(nodeObjs) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const obj of nodeObjs) {
            const o = /** @type {any} */ (obj);
            const w = o.iconEl?.offsetWidth  || 110;
            const h = o.iconEl?.offsetHeight || 70;
            minX = Math.min(minX, o.x);
            minY = Math.min(minY, o.y);
            maxX = Math.max(maxX, o.x + w);
            maxY = Math.max(maxY, o.y + h);
        }
        return { minX, minY, maxX, maxY };
    }

    /** Fit all placed nodes into the visible area.
     * @param {number} [maxZoom] upper zoom limit (default 4); pass 1 to only zoom out, never in */
    _fitToContent(maxZoom = 4) {
        const layer = this.nodesLayer;
        if (!layer) return;

        const nodeObjs = this.simobjects.filter(
            (o) => !(o instanceof Link) && o instanceof SimulatedObject && o.iconEl,
        );
        if (nodeObjs.length === 0) return;

        const { minX, minY, maxX, maxY } = this._calcBoundingBox(nodeObjs);

        const PAD = 48;
        const contentW = maxX - minX + PAD * 2;
        const contentH = maxY - minY + PAD * 2;
        const layerW = layer.clientWidth  || 800;
        const layerH = layer.clientHeight || 600;

        const zoom = Math.max(0.15, Math.min(maxZoom, Math.min(layerW / contentW, layerH / contentH)));
        this._zoom = zoom;
        this._panX = (layerW - contentW * zoom) / 2 - (minX - PAD) * zoom;
        this._panY = (layerH - contentH * zoom) / 2 - (minY - PAD) * zoom;
        this._applyCanvasTransform();
        this._requestRedrawLinks();
    }

    // ── Pointer & interaction ─────────────────────────────────────────────────

    /** @param {PointerEvent} ev */
    _startDragPan(ev) {
        const nodes = this.nodesLayer;
        if (!nodes) return;
        ev.preventDefault();
        this._isPanning = true;
        this._isDragPanning = true;
        this._panPointerId = ev.pointerId;
        this._panStartClientX = ev.clientX;
        this._panStartClientY = ev.clientY;
        this._panStartX = this._panX;
        this._panStartY = this._panY;
        nodes.setPointerCapture(ev.pointerId);
        nodes.style.cursor = "grabbing";
    }

    /** @param {PointerEvent} ev */
    async _onPointerDown(ev) {
        // Middle mouse and space-drag are handled by the pan listener — ignore here
        if (ev.button === 1 || (ev.button === 0 && this._spaceDown)) return;

        // Run/trace mode: left-click on empty canvas → drag to pan
        if (this.mode !== "edit") {
            if (ev.button === 0 && !this._getObjFromEvent(ev) && !this._isPanelTarget(ev)) {
                this._startDragPan(ev);
            }
            return;
        }

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
                // Show ghost immediately at click point, frozen while picker is open
                this._linkStart = obj;
                this._ensureGhostLink();
                const p = this._getLocalPoint(ev);
                this._updateGhost(p.x, p.y);
                this._linkPaused = true;

                const pickA = await this._pickPortForObjectAt(obj, ev.clientX + 8, ev.clientY + 8);
                this._linkPaused = false;

                if (!pickA) {
                    this._cancelLinking();
                    this._showToast(t("sim.link.error.noFreePort"));
                    return;
                }

                this._linkStartKey = pickA.key;
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

            // Second click: pick B port — snap ghost to Node B and freeze while picker is open
            this._linkPaused = true;
            this._updateGhost(obj.getX(), obj.getY());
            const pickB = await this._pickPortForObjectAt(obj, ev.clientX + 8, ev.clientY + 8);
            this._linkPaused = false;
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
                const msg = e instanceof Error ? e.message : "";
                if (msg.includes("Port in use") || msg.includes("Port not found")) {
                    this._showToast(t("sim.link.error.portInUse"));
                } else {
                    this._showToast(t("sim.link.error"));
                }
            } finally {
                this._cancelLinking();
            }

            return;
        }

        // PLACE tools: click empty canvas places
        if (this.tool.startsWith("place-")) {
            // On touch there is no mousemove, so the ghost is never created via hover.
            // Create and position the ghost at the tap point so placement can proceed.
            if ((!this._ghostNodeEl || !this._ghostReady) && ev.pointerType !== "mouse") {
                this._ensureGhostNode(/** @type {any} */ (this.tool));
                const tp = this._getLocalPoint(ev);
                this._moveGhostNode(tp.x, tp.y);
            }
            // Only place if ghost exists and has size
            if (!this._ghostNodeEl || !this._ghostReady) return;

            ev.preventDefault();
            ev.stopPropagation();

            const p = this._getLocalPoint(ev);

            const Ctor = PLACE_TOOL_CTOR[this.tool];
            /** @type {SimulatedObject|null} */
            const newObj = Ctor
                ? (PLACE_TOOL_NAME_KEY[this.tool]
                    ? new Ctor(this._nextName(t(PLACE_TOOL_NAME_KEY[this.tool])))
                    : new Ctor())
                : null;
            if (!newObj) return;

            const w = this._ghostNodeEl.offsetWidth || 0;
            const h = this._ghostNodeEl.offsetHeight || 0;

            newObj.x = p.x - w / 2;
            newObj.y = p.y - h / 2;

            this.addObject(newObj);
            this._requestRedrawLinks();

            // Ghost entfernen, aber im Place-Modus bleiben (neuer Ghost folgt beim nächsten Move)
            this._removeGhostNode();
            this._justPlaced = true;
            setTimeout(() => { this._justPlaced = false; }, 0);
            return;
        }

        // SELECT tool: focus node, or drag-pan on empty canvas
        if (this.tool === "select") {
            if (obj) {
                this.setFocus(obj);
            } else if (ev.button === 0 && !link && !this._isPanelTarget(ev)) {
                this._startDragPan(ev);
            }
            return;
        }
    }

    /** @param {PointerEvent} ev */
    _onPointerMove(ev) {
        if (this.mode !== "edit") return;

        const p = this._getLocalPoint(ev);

        if (this.tool.startsWith("place-")) {
            this._ensureGhostNode(/** @type {any} */ (this.tool));
            this._moveGhostNode(p.x, p.y);
        } else {
            this._removeGhostNode();
        }

        if (this.tool === "link" && this._linkStart && !this._linkPaused) {
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
    _getLocalPoint(ev) {
        const layer = this.nodesLayer;
        if (!layer) return { x: ev.clientX, y: ev.clientY };

        const r = layer.getBoundingClientRect();

        // Convert screen position to canvas-space coordinates (accounting for zoom and pan).
        return {
            x: (ev.clientX - r.left - this._panX) / this._zoom,
            y: (ev.clientY - r.top  - this._panY) / this._zoom,
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

    /** @param {PointerEvent} ev */
    _isPanelTarget(ev) {
        return ev.target instanceof Element && ev.target.closest(".sim-panel") !== null;
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

    // ── Edit tools ────────────────────────────────────────────────────────────

    /** @param {"place-computer"|"place-tablet"|"place-switch"|"place-router"|"place-homerouter"|"place-ap"|"place-firewall"|"place-text"|"place-rect"} type */
    _ensureGhostNode(type) {
        if (!this.nodesLayer) return;

        if (!this._ghostNodeEl || this._ghostNodeType !== type) {
            this._removeGhostNode();

            const GhostCtor = PLACE_TOOL_CTOR[type];
            /** @type {SimulatedObject|null} */
            const tmp = GhostCtor ? new GhostCtor() : null;
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

            (this._simCanvas ?? this.nodesLayer).appendChild(el);

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

        (this._simCanvas ?? this.nodesLayer).appendChild(g);
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

    _cancelLinking() {
        this._linkStart = null;
        this._linkStartKey = null;
        this._linkPaused = false;
        if (this._ghostLink) this._ghostLink.remove();
        this._ghostLink = null;
    }

    /** @param {import("./sim/Link.js").Link} link */
    _clearLinkPackets(link) {
        for (const p of link._packets) p.el?.remove?.();
        link._packets = [];
    }

    // ── Port & link helpers ───────────────────────────────────────────────────

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

            /** @param {*} [result] */
            const cleanup = (result) => {
                if (done) return;
                done = true;
                document.removeEventListener("pointerdown", onOutside, { capture: true });
                window.removeEventListener("keydown", onKeyDown);
                panel.remove();
                resolve(result ?? null);
            };

            /** @param {PointerEvent} ev */
            const onOutside = (ev) => {
                // click outside closes
                if (!panel.contains(/** @type {Node} */(ev.target))) cleanup(null);
            };

            /** @param {KeyboardEvent} ev */
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

    /** find the clickable root element for node/link under cursor @param {PointerEvent} ev */
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

    // ── Utilities ─────────────────────────────────────────────────────────────

    /** @param {string} prefix */
    _nextName(prefix) {
        const used = new Set(
            this.simobjects
                .map(o => o.name)
                .filter(n => n.startsWith(prefix + " "))
                .map(n => parseInt(n.slice(prefix.length + 1)))
                .filter(n => Number.isFinite(n) && n > 0)
        );
        let i = 1;
        while (used.has(i)) i++;
        return `${prefix} ${i}`;
    }

    /** @param {string} msg */
    _showToast(msg) {
        const toast = document.createElement("div");
        toast.className = "sim-toast";
        toast.textContent = msg;
        this.nodesLayer?.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
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
