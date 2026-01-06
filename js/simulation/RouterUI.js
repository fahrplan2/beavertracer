//@ts-check

import { DOMBuilder } from "../lib/DomBuilder.js";

/**
 * This class renders the static part of the routing interface
 * and provides elements for the Router Class to use
 */
export class RouterUI {
    /**
     * @param {{ onRename: (name: string) => void }} handlers
     */
    constructor(handlers) {
        this.handlers = handlers;

        /** @type {HTMLDivElement|null} */
        this.host = null;

        /** @type {HTMLInputElement|null} */
        this.nameInput = null;

        /** @type {HTMLDivElement|null} */
        this.tabsBar = null;

        /** @type {HTMLDivElement|null} */
        this.selectedIfaceLabel = null;

        /** @type {HTMLDivElement|null} */
        this.ifacePanel = null;

        /** @type {HTMLDivElement|null} */
        this.ifaceActions = null;

        /** @type {HTMLInputElement|null} */
        this.ipInput = null;

        /** @type {HTMLInputElement|null} */
        this.maskInput = null;

        /** @type {HTMLInputElement|null} */
        this.cidrInput = null;

        /** @type {HTMLButtonElement|null} */
        this.saveIfBtn = null;

        /** @type {HTMLButtonElement|null} */
        this.delIfBtn = null; // wird vom Router ggf. befüllt

        /** @type {HTMLDivElement|null} */
        this.routesHost = null;
    }

    /** @param {HTMLElement} panelBody */
    ensureHost(panelBody) {
        if (!this.host) {
            this.host = DOMBuilder.div("router-ui");
            this.host.style.display = "flex";
            this.host.style.flexDirection = "column";
            this.host.style.gap = "12px";
            panelBody.appendChild(this.host);
        } else if (this.host.parentElement !== panelBody) {
            panelBody.appendChild(this.host);
        }
        return this.host;
    }

    /**
     * Rendert die UI-Shell neu (ohne Tabs/Routes-Daten). Router füllt danach dynamische Teile.
     * @param {HTMLElement} panelBody
     * @param {{ routerName: string }} model
     */
    renderShell(panelBody, model) {
        const host = this.ensureHost(panelBody);
        DOMBuilder.clear(host);

        host.appendChild(DOMBuilder.h4("Allgemeine Einstellungen"));

        // Name row
        const nameRow = DOMBuilder.div("router-name-row");

        const nameLabel = DOMBuilder.label("Router-Name:");
        const nameInput = DOMBuilder.input({ value: model.routerName });
        this.nameInput = nameInput;

        const nameBtn = DOMBuilder.button("Übernehmen");

        nameBtn.addEventListener("click", () => {
            const newName = nameInput.value.trim();
            if (!newName) return;
            this.handlers.onRename(newName);
        });

        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") nameBtn.click();
        });

        nameRow.append(nameLabel, nameInput, nameBtn);
        host.appendChild(nameRow);

        // Interfaces
        host.appendChild(DOMBuilder.h4("Interfaces"));

        const ifCard = DOMBuilder.div("router-card");

        const tabsBar = DOMBuilder.div("router-tabs");
        this.tabsBar = tabsBar;

        const selLabel = DOMBuilder.div("router-selected-iface");
        this.selectedIfaceLabel = selLabel;

        const ifacePanel = DOMBuilder.div("router-if-panel");
        this.ifacePanel = ifacePanel;

        const grid = DOMBuilder.div("router-if-grid");

        const ipIn = DOMBuilder.input({ className: "router-if-ip", placeholder: "IP" });
        const maskIn = DOMBuilder.input({ className: "router-if-mask", placeholder: "Netmask" });
        const cidrIn = DOMBuilder.input({ className: "router-if-cidr", placeholder: "/CIDR" });
        const saveBtn = DOMBuilder.button("Speichern", { className: "router-if-save" });

        this.ipInput = ipIn;
        this.maskInput = maskIn;
        this.cidrInput = cidrIn;
        this.saveIfBtn = saveBtn;

        grid.append(ipIn, maskIn, cidrIn, saveBtn);
        ifacePanel.appendChild(grid);

        const actions = DOMBuilder.div("router-if-actions");
        this.ifaceActions = actions;
        ifacePanel.appendChild(actions);

        ifCard.append(tabsBar, selLabel, ifacePanel);
        host.appendChild(ifCard);

        // Routing table
        host.appendChild(DOMBuilder.h4("Routingtabelle"));
        const routesHost = DOMBuilder.div("router-routes");
        this.routesHost = routesHost;
        host.appendChild(routesHost);
    }
}
