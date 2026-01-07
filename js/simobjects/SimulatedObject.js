//@ts-check

import { VirtualFileSystem } from '../apps/lib/VirtualFileSystem.js';
import { t } from '../i18n/index.js';
import { makeDraggable } from '../lib/dragabble.js';
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
    id;
    static idnumber = 0;

    /** @type {SimControl} */
    simcontrol;

    /** @type {HTMLElement} */
    root;

    /** @type {HTMLElement|null} */
    iconEl = null;

    /** @type {HTMLElement|null} */
    panelEl = null;

    /** @type {HTMLElement|null} */
    panelHeaderEl = null;

    /** @type {number} icon position */
    x = 50;
    /** @type {number} icon position */
    y = 50;

    /** @type {number} panel position */
    px = 220;

    /** @type {number} panel osition */
    py = 120;

    panelOpen = false;


    /** @type {Set<SimulatedObject>} */
    static instances = new Set();


    /**
     * callback when the panal was created
     * must be used e.g. for os->mount()
     * @type {((body: HTMLElement) => void) | undefined}
     */
    onPanelCreated;

    /**
     * @param {String} name
     */
    constructor(name) {
        this.name = name;
        this.id = SimulatedObject.idnumber++;
        this.root = document.createElement("div");
        this.root.classList.add("sim-object");
        SimulatedObject.instances.add(this);
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
            this.root.appendChild(this.panelEl);
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

        const title = document.createElement("div");
        title.className = "title";
        title.textContent = this.name;
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

        const close = document.createElement("button");
        close.className = "sim-panel-close";
        close.type = "button";
        close.textContent = "×";
        close.title = t("panel.close");

        header.appendChild(title);
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

        //make icon traggable and toggle the panel
        makeDraggable(this.iconEl, {
            handle: this.iconEl,
            onClick: () => {
                this.setPanelOpen(!this.panelOpen);
            },
            boundary: () => SimControl.movementBoundary,
            onDragEnd: ({ x, y }) => {
                this.x = x;
                this.y = y;
                this.simcontrol?.redrawLinks?.();
            }
        });
    }

    wirePanelInteractions() {
        if (!this.panelEl) return;

        //make panel draggable
        const handle = this.panelEl.querySelector('.sim-panel-header');
        if (handle instanceof HTMLElement) {
            makeDraggable(this.panelEl, {
                handle: handle,
                boundary: () => SimControl.movementBoundary,
                onDragEnd: ({ x, y }) => {
                    this.px = x;
                    this.py = y;
                }
            });
        }
        makeWindow(this.panelEl);
    }

    /**
     * 
     * @param {boolean} open 
     */
    setPanelOpen(open) {
        //do not open when allready open or in Edit Mode
        if (open && SimControl.isEditMode) return;

        this.panelOpen = open;
        this._applyPositions();
        this._applyPanelVisibility();
    }

    _applyPanelVisibility() {
        if (!this.panelEl) return;
        this.panelEl.style.display = this.panelOpen ? "block" : "none";
        if (this.panelOpen) {
            bringToFront(this.panelEl);
        }
    }

    _applyPositions() {

        if (this.iconEl) {
            this.iconEl.style.transform = `translate(${this.x}px, ${this.y}px)`;
        }
        if (this.panelEl) {
            this.panelEl.style.transform = `translate(${this.px}px, ${this.py}px)`;
        }
    }

    getX() {
        if (!this.iconEl) return 0;

        const rect = this.iconEl.getBoundingClientRect();
        const boundary = SimControl.movementBoundary;

        if (boundary instanceof HTMLElement) {
            const b = boundary.getBoundingClientRect();

            // local to boundary content box:
            return (rect.left - b.left) + boundary.scrollLeft - boundary.clientLeft + rect.width / 2;
        }

        return rect.left + rect.width / 2;
    }

    getY() {
        if (!this.iconEl) return 0;

        const rect = this.iconEl.getBoundingClientRect();
        const boundary = SimControl.movementBoundary;

        if (boundary instanceof HTMLElement) {
            const b = boundary.getBoundingClientRect();

            // local to boundary content box:
            return (rect.top - b.top) + boundary.scrollTop - boundary.clientTop + rect.height / 2;
        }

        return rect.top + rect.height / 2;
    }

    destroy() {
        SimulatedObject.instances.delete(this);
        this.root.remove();
    }

    static closeAllPanels() {
        for (const obj of SimulatedObject.instances) {
            obj.setPanelOpen(false);
        }
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
     * @returns {SceneObjectJSON}
     */

    toJSON() {
        return {
            kind: this.constructor?.name ?? "SimulatedObject",
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
}