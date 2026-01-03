//@ts-check

import { t } from '../i18n/index.js';
import { makeDraggable } from '../lib/dragabble.js';
import { makeWindow, bringToFront } from '../lib/windowmanager.js';
import { SimControl } from '../SimControl.js';

export class SimulatedObject {

    name;
    id;
    static idnumber = 0;

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
    }

    /**
     * builds the SimulatedObject
     * with a visible panel
     * @returns {HTMLElement}
     */
    render() {
        //Icon
        if (!this.iconEl) {
            this.iconEl = this.buildIcon();
            this.root.appendChild(this.iconEl);
            this.wireIconInteractions();
        }

        //Panel
        if (!this.panelEl) {
            this.panelEl = this.buildPanel();
            this.root.appendChild(this.panelEl);
            this.wirePanelInteractions();
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
            boundary: () => SimControl.movementBoundary
        });
    }

    wirePanelInteractions() {
        if (!this.panelEl) return;

        //make panel draggable
        const handle = this.panelEl.querySelector('.sim-panel-header');
        if (handle instanceof HTMLElement) {
            makeDraggable(this.panelEl, {
                handle: handle,
                boundary: () => SimControl.movementBoundary
            });
        }
        makeWindow(this.panelEl);
    }

    /**
     * 
     * @param {boolean} open 
     */
    setPanelOpen(open) {
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
            this.iconEl.style.left = this.x + "px";
            this.iconEl.style.top = this.y + "px";
        }
        if (this.panelEl) {
            this.panelEl.style.left = this.px + "px";
            this.panelEl.style.top = this.py + "px";
        }
    }

    getX() {
        if (!this.iconEl) {
            return 0;
        }
        const rect = this.iconEl.getBoundingClientRect();
        return rect.left + rect.width / 2;
    }

    getY() {
        if (!this.iconEl) {
            return 0;
        }
        const rect = this.iconEl.getBoundingClientRect();
        return rect.top + rect.height / 2;
    }
}
