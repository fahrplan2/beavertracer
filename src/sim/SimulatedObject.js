//@ts-check

import { VirtualFileSystem } from '../apps/lib/VirtualFileSystem.js';
import { t } from '../i18n/index.js';
import { makeDraggable } from '../lib/dragabble.js';
import { SimDialog } from '../lib/SimDialog.js';
import { makeWindow, bringToFront } from '../lib/windowmanager.js';
import { SimControl } from '../SimControl.js';


/**
 * @typedef {{
 *  kind: string,
 *  id: number,
 * }} BaseJSON
 *
 * @typedef {BaseJSON & {
 *  name: string,
 *  x: number, y: number,
 *  px: number, py: number,
 *  panelOpen: boolean
 * }} NodeJSON
 *
 * @typedef {BaseJSON & {
 *  a: number,
 *  b: number
 * }} LinkJSON
 *
 * @typedef {NodeJSON | LinkJSON} SceneObjectJSON
 */


export class SimulatedObject {

    name;
    kind = "SimulatedObject"; //needed for generating save id
    icon = "fa-heart";
    id;
    static idnumber = 0;

    /** @type {SimControl} */
    simcontrol = /** @type {any} */ (undefined);

    /** @type {HTMLElement} */
    root;

    /**
     * Container for the floating panel element. Set by SimControl to nodesLayer
     * so panels are not inside the zoomed sim-canvas.
     * Falls back to this.root when null (e.g. before first render).
     * @type {HTMLElement|null}
     */
    panelRoot = null;

    /** @type {HTMLElement|null} */
    iconEl = null;

    /** @type {HTMLElement|null} */
    panelEl = null;

    /** @type {HTMLElement|null} */
    panelHeaderEl = null;

    /** @type {import('../lib/dragabble.js').DraggableController|null} */
    _iconDraggable = null;

    /** @type {import('../lib/dragabble.js').DraggableController|null} */
    _panelDraggable = null;

    /** @type {number} icon position */
    x = 50;
    /** @type {number} icon position */
    y = 50;

    /** @type {number} panel position */
    px = 220;
    /** @type {number} panel osition */
    py = 120;

    panelOpen = false;

    /**
     * callback when the panal was created
     * must be used e.g. for os->mount()
     * @type {((body: HTMLElement) => void) | undefined}
     */
    onPanelCreated;

    /**
     * callback fired each time the panel becomes visible
     * @type {(() => void) | undefined}
     */
    onPanelOpen;

    /**
     * @param {String} name
     */
    constructor(name) {
        this.name = name;
        this.id = SimulatedObject.idnumber++;
        this.root = document.createElement("div");
        this.root.classList.add("sim-object");
    }

    /**
     * builds the SimulatedObject
     * with a visible panel
     * @returns {HTMLElement}
     */
    render() {
        //Panel
        if (!this.panelEl) {
            this.panelEl = this.buildPanel();
            (this.panelRoot ?? this.root).appendChild(this.panelEl);
            this.wirePanelInteractions();
        }

        //Icon
        if (!this.iconEl) {
            this.iconEl = this.buildIcon();
            this.root.appendChild(this.iconEl);
            this.wireIconInteractions();
        }

        this._applyPositions();
        this._applyPanelVisibility();

        return this.root;
    }

    buildIcon() {
        const icon = document.createElement("div");
        icon.className = "sim-node";
        icon.dataset.objid = String(this.id);

        // 1) icon
        const iconEl = document.createElement("i");
        iconEl.classList.add("fas");
        if (icon) iconEl.classList.add(this.icon);

        // 2) text
        const title = document.createElement("span");
        title.className = "title";
        title.textContent = this.name;

        icon.appendChild(iconEl);
        icon.appendChild(title);

        return icon;
    }

    buildPanel() {
        const panel = document.createElement("div");
        panel.className = "sim-panel";

        const header = document.createElement("div");
        header.className = "sim-panel-header";

        const title = document.createElement("div");
        title.className = "sim-panel-title";
        title.textContent = this.name;

        const rename = document.createElement("button");
        rename.className = "sim-panel-rename";
        rename.type = "button";
        rename.title = t("panel.rename");
        rename.innerHTML = '<i class="fas fa-pen"></i>';
        rename.addEventListener("click", async (e) => {
            e.stopPropagation();
            const next = await SimDialog.prompt(t("panel.rename.prompt"), this.name);
            if (next !== null && next.trim() && next.trim() !== this.name) {
                this.setName(next.trim());
            }
        });

        const close = document.createElement("button");
        close.className = "sim-panel-close";
        close.type = "button";
        close.textContent = "×";
        close.title = t("panel.close");

        const titleGroup = document.createElement("div");
        titleGroup.className = "sim-panel-title-group";
        titleGroup.appendChild(title);
        titleGroup.appendChild(rename);

        const panelIcon = document.createElement("i");
        panelIcon.classList.add("fas", this.icon, "sim-panel-icon");
        header.appendChild(panelIcon);
        header.appendChild(titleGroup);
        header.appendChild(close);

        const body = document.createElement("div");
        body.className = "sim-panel-body";

        panel.appendChild(header);
        panel.appendChild(body);

        this.panelHeaderEl = header;

        close.addEventListener("click", (e) => {
            e.stopPropagation();
            this.setPanelOpen(false);
        });

        this.onPanelCreated?.(body);

        return panel;
    }

    wireIconInteractions() {
        if (!this.iconEl) return;

        this.iconEl.addEventListener("mouseenter", () => this.simcontrol?._onNodeHover(this, true));
        this.iconEl.addEventListener("mouseleave", () => this.simcontrol?._onNodeHover(this, false));

        //make icon draggable and toggle the panel
        this._iconDraggable = makeDraggable(this.iconEl, {
            handle: this.iconEl,
            canDrag: () => {
                return (this.simcontrol?.mode === "edit");
            },
            onClick: () => {
                this.setPanelOpen(!this.panelOpen);
            },
            boundary: () => this.simcontrol.movementBoundary,
            getScale: () => this.simcontrol?._zoom ?? 1,
            onMove: ({ dragging, x, y }) => {
                this.x = x;
                this.y = y;

                if (dragging) {
                    this.simcontrol?._requestRedrawLinks?.();
                }
            },
            onDragEnd: ({ x, y }) => {
                this.x = x;
                this.y = y;
                this.simcontrol?.redrawLinks?.();
                this.simcontrol?.markDirty?.();
            }
        });
    }

    wirePanelInteractions() {
        if (!this.panelEl) return;

        if (this._isMobile()) return;

        //make panel draggable
        const handle = this.panelEl.querySelector('.sim-panel-header');
        if (handle instanceof HTMLElement) {
            this._panelDraggable = makeDraggable(this.panelEl, {
                handle: handle,
                boundary: () => this.simcontrol.movementBoundary,
                onDragEnd: ({ x, y }) => {
                    this.px = x;
                    this.py = y;
                }
            });
        }
        makeWindow(this.panelEl, {
            resizable: false,
            minWidth: 220,
            minHeight: 140,
            onResize: (w, h) => {
                this.pw = w;
                this.ph = h;
            }
        });
    }

    _isMobile() {
        return window.matchMedia("(max-width: 600px), (max-height: 500px)").matches;
    }

    /**
     *
     * @param {boolean} open
     */
    setPanelOpen(open) {
        if (open && this.simcontrol?.tool === "link") return;
        if (open && this.simcontrol?.mode === "edit") {
            this.simcontrol._resetEditTools();
            return;
        }

        this.panelOpen = open;

        if (this._isMobile() && this.panelEl) {
            const simRoot = this.simcontrol?.root;
            const home = this.panelRoot ?? this.root;
            if (open && simRoot) {
                simRoot.appendChild(this.panelEl);
            } else if (!open && this.panelEl.parentElement !== home) {
                home.appendChild(this.panelEl);
            }
        }

        this._applyPositions();
        this._applyPanelVisibility();
    }

    _applyPanelVisibility() {
        if (!this.panelEl) return;
        this.panelEl.style.display = this.panelOpen ? "block" : "none";
        if (this.panelOpen) {
            this._clampPanelToViewport();
            bringToFront(this.panelEl);
            // Suppress ghost clicks (touch → synthetic click lands on newly visible panel content)
            this.panelEl.style.pointerEvents = "none";
            setTimeout(() => { if (this.panelEl) this.panelEl.style.pointerEvents = ""; }, 350);
            this.onPanelOpen?.();
        }
    }

    _clampPanelToViewport() {
        if (this._isMobile()) return;
        if (!this.panelEl) return;
        const boundary = this.simcontrol?.movementBoundary;
        if (!(boundary instanceof HTMLElement)) return;

        const b = boundary.getBoundingClientRect();
        const p = this.panelEl.getBoundingClientRect();

        let dx = 0, dy = 0;

        if (p.right  > b.right)  dx = b.right  - p.right;
        if (p.bottom > b.bottom) dy = b.bottom - p.bottom;
        if (p.left + dx < b.left) dx = b.left - p.left;
        if (p.top  + dy < b.top)  dy = b.top  - p.top;

        if (dx !== 0 || dy !== 0) {
            this.px += dx;
            this.py += dy;
            this.panelEl.style.transform = `translate(${this.px}px, ${this.py}px)`;
        }
    }

    _applyPositions() {

        if (this.iconEl) {
            this.iconEl.style.transform = `translate(${this.x}px, ${this.y}px)`;
        }
        if (this.panelEl && !this._isMobile()) {
            this.panelEl.style.transform = `translate(${this.px}px, ${this.py}px)`;
            if (this.pw) this.panelEl.style.width = `${this.pw}px`;
            if (this.ph) this.panelEl.style.height = `${this.ph}px`;
        }
    }

    getX() {
        if (!this.iconEl) return 0;

        const rect = this.iconEl.getBoundingClientRect();
        const boundary = this.simcontrol?.movementBoundary;
        const zoom = this.simcontrol?._zoom ?? 1;
        const panX = this.simcontrol?._panX ?? 0;

        if (boundary instanceof HTMLElement) {
            const b = boundary.getBoundingClientRect();
            // screenOffset is the icon's left edge in nodesLayer-local screen space.
            // With sim-canvas scaled by zoom: screenOffset = panX + canvas_x * zoom.
            // Dividing back gives canvas_x; rect.width is the rendered (zoomed) width.
            const screenOffset = (rect.left - b.left) + boundary.scrollLeft - boundary.clientLeft;
            return (screenOffset - panX) / zoom + rect.width / (2 * zoom);
        }

        return rect.left + rect.width / 2;
    }

    getY() {
        if (!this.iconEl) return 0;

        const rect = this.iconEl.getBoundingClientRect();
        const boundary = this.simcontrol?.movementBoundary;
        const zoom = this.simcontrol?._zoom ?? 1;
        const panY = this.simcontrol?._panY ?? 0;

        if (boundary instanceof HTMLElement) {
            const b = boundary.getBoundingClientRect();
            const screenOffset = (rect.top - b.top) + boundary.scrollTop - boundary.clientTop;
            return (screenOffset - panY) / zoom + rect.height / (2 * zoom);
        }

        return rect.top + rect.height / 2;
    }

    destroy() {
        this._iconDraggable?.destroy();
        this._iconDraggable = null;
        this._panelDraggable?.destroy();
        this._panelDraggable = null;
        // Panel lives outside this.root (in panelRoot / simRoot on mobile)
        this.panelEl?.remove();
        this.panelEl = null;
        this.root.remove();
    }

    /**
     * sets the name of the object and replaces the name in the visible positions
     * @param {string} name
     */

    setName(name) {
        this.name = name;

        // Icon-Titel aktualisieren
        if (this.iconEl) {
            const title = this.iconEl.querySelector('.title');
            if (title) {
                title.textContent = name;
            } else {
                // Fallback: Icon neu bauen
                this.iconEl.remove();
                this.iconEl = this.buildIcon();
                this.root.appendChild(this.iconEl);
                this.wireIconInteractions();
            }
        }

        // Panel-Titel aktualisieren
        if (this.panelEl) {
            const title = this.panelEl.querySelector('.sim-panel-title');
            if (title) {
                title.textContent = name;
            }
        }
    }

    /**
     * destroys UI objects. Only when changing languages or doing something extreme
     */
    invalidateUI() {
        // Panel lives outside this.root — remove it directly
        this.panelEl?.remove();
        this.root.replaceChildren();
        this.panelEl = null;
        this.iconEl = null;
    }



    /**
     * @returns {SceneObjectJSON}
     */

    toJSON() {
        return {
            kind: this.kind,
            id: this.id,
            name: this.name,
            x: this.x, y: this.y,
            px: this.px, py: this.py,
            panelOpen: !!this.panelOpen,
        };
    }

    /** @param {any} n */
    _applyBaseJSON(n) {
        this.id = Number(n.id);
        this.name = String(n.name ?? this.name);
        this.x = Number(n.x ?? this.x);
        this.y = Number(n.y ?? this.y);
        this.px = Number(n.px ?? this.px);
        this.py = Number(n.py ?? this.py);
        this.panelOpen = !!n.panelOpen;
    }

    /**
     * Port API (optional capability):
     * Geräte mit Ports (PC/Router/Switch) überschreiben das.
     *
     * @returns {Array<{ key: string, label: string, port: any }>}
     */
    listPorts() { return []; }

    /**
     * @param {string} key
     * @returns {any|null}
     */
    getPortByKey(key) { return null; }

    // ── Static helpers for IPStack-based port lists ──────────────────────

    /**
     * Standard listPorts() implementation for devices whose ports come from
     * an IPStack's `interfaces` array (Router, PC, …).
     * @param {any[]|undefined} interfaces
     * @returns {Array<{ key: string, label: string, port: any }>}
     */
    static listEthPorts(interfaces) {
        const ifs = interfaces ?? [];
        // exclude VLAN subinterfaces (vid != null) — virtual ports can't be cabled
        return ifs
            .filter(nic => nic.vid == null)
            .map(nic => ({ key: nic.name, label: nic.name, port: nic.port }));
    }

    /**
     * Standard getPortByKey() implementation for eth-indexed ports.
     * @param {any[]|undefined} interfaces
     * @param {string} key
     * @returns {any|null}
     */
    static getEthPortByKey(interfaces, key) {
        const ifs = interfaces ?? [];
        // Primary: look up by interface name (works for eth0, eth1, eth0.10, …)
        const byName = ifs.find(nic => nic.name === key && nic.vid == null);
        if (byName) return byName.port;
        // Fallback: legacy saves store keys as eth${arrayIndex}
        const m = /^eth(\d+)$/.exec(key);
        if (!m) return null;
        return ifs[Number(m[1])]?.port ?? null;
    }
}