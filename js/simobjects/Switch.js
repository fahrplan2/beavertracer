//@ts-check

import { SwitchBackplane } from "../devices/SwitchBackplane.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { DOMBuilder } from "../lib/DomBuilder.js";
import { t } from "../i18n/index.js";

/**
 * Kleine Helper fürs SAT-Rendering
 * @param {bigint} macBig
 */
function macBigIntToStr(macBig) {
    // macBig ist 48-bit, als hex ohne 0x
    let hex = macBig.toString(16).padStart(12, "0");
    // aa:bb:cc:dd:ee:ff
    return hex.match(/.{2}/g).join(":");
}

/**
 * @param {bigint} macBig
 */
function macBigIntToPretty(macBig) {
    // optional: uppercase
    return macBigIntToStr(macBig).toUpperCase();
}

export class Switch extends SimulatedObject {

    kind="Switch";

    /** @type {SwitchBackplane} */
    backplane;

    /** @type {HTMLElement|null} */
    _panelBody = null;

    /** @type {HTMLDivElement|null} */
    _host = null;

    /** @type {HTMLInputElement|null} */
    _nameInput = null;

    /** @type {HTMLDivElement|null} */
    _satHost = null;

    /** @type {number|null} */
    _satPollTimer = null;

    /**
     * @param {String} name
     */
    constructor(name = t("switch.title")) {
        super(name);
        this.backplane = new SwitchBackplane(16);

        /** @param {HTMLElement} body */
        this.onPanelCreated = (body) => {
            this._panelBody = body;
            this.mount(body);
        };
    }

    toJSON() {
        return { ...super.toJSON(), kind: "Switch" };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Switch(n.name ?? "Switch");
        obj._applyBaseJSON(n);
        return obj;
    }

    listPorts() {
        const ports = this.backplane?.ports ?? [];
        return ports.map((p, i) => ({
            key: `sw${i}`,
            label: `port ${i + 1}`,
            port: p,
        }));
    }

    /** @param {string} key */
    getPortByKey(key) {
        const m = /^sw(\d+)$/.exec(key);
        if (!m) return null;
        const i = Number(m[1]);
        return (this.backplane?.ports ?? [])[i] ?? null;
    }

    /* ------------------------------ UI ------------------------------ */

    mount(panelBody) {
        this._stopSatPolling();

        panelBody.innerHTML = "";

        const host = DOMBuilder.div("switch-ui");
        host.style.display = "flex";
        host.style.flexDirection = "column";
        host.style.gap = "12px";
        panelBody.appendChild(host);
        this._host = host;

        // ---- Allgemein ----
        host.appendChild(DOMBuilder.h4(t("switch.genericsettings")));

        const nameRow = DOMBuilder.div("switch-name-row");

        const nameLabel = DOMBuilder.label(t("switch.name")+": ");
        const nameInput = DOMBuilder.input({ value: this.name });
        this._nameInput = nameInput;

        const nameBtn = DOMBuilder.button(t("switch.apply"));
        nameBtn.addEventListener("click", () => {
            const newName = nameInput.value.trim();
            if (!newName || newName === this.name) return;
            this.setName(newName);
        });

        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") nameBtn.click();
        });

        nameRow.append(nameLabel, nameInput, nameBtn);
        host.appendChild(nameRow);

        // ---- SAT / "ARP"-Tabelle ----
        host.appendChild(DOMBuilder.h4(t("switch.sat")));

        const satCard = DOMBuilder.div("switch-card");
        const satHost = DOMBuilder.div("switch-sat");
        this._satHost = satHost;

        satCard.appendChild(satHost);
        host.appendChild(satCard);

        this._renderSAT();
        this._startSatPolling();
    }

    _startSatPolling() {
        // initial
        this._renderSAT();

        this._satPollTimer = window.setInterval(() => {
            this._renderSAT();
        }, 500);
    }

    _stopSatPolling() {
        if (this._satPollTimer != null) {
            clearInterval(this._satPollTimer);
            this._satPollTimer = null;
        }
    }

    _renderSAT() {
        if (!this._satHost) return;

        const sat = this.backplane?.sat;
        const ports = this.backplane?.ports ?? [];

        this._satHost.innerHTML = "";

        const table = document.createElement("table");
        table.className = "switch-sat-table";

        const thead = document.createElement("thead");
        thead.innerHTML = "<tr>"+
            "<th>"+t("switch.sat.mac")+"</th>"+
            "<th>"+t("switch.sat.port")+"</th>"+
            "</tr>";
    
        table.appendChild(thead);

        const tbody = document.createElement("tbody");

        /** @type {{mac: bigint, portIdx: number}[]} */
        const rows = [];
        if (sat && sat.size) {
            for (const [mac, portIdx] of sat.entries()) {
                rows.push({ mac: /** @type {bigint} */ (mac), portIdx: Number(portIdx) });
            }
        }

        // sort: port, then mac
        rows.sort((a, b) => (a.portIdx - b.portIdx) || (a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0));

        if (!rows.length) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 2;
            td.textContent = t("switch.sat.empty");
            td.style.opacity = "0.8";
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            for (const r of rows) {
                const tr = document.createElement("tr");

                const macTd = document.createElement("td");
                macTd.textContent = macBigIntToPretty(r.mac);

                const portTd = document.createElement("td");
                const isValid = Number.isInteger(r.portIdx) && r.portIdx >= 0 && r.portIdx < ports.length;
                portTd.textContent = isValid ? `port ${r.portIdx + 1}` : `(missing: ${r.portIdx})`;
                if (!isValid) portTd.style.opacity = "0.7";

                tr.appendChild(macTd);
                tr.appendChild(portTd);
                tbody.appendChild(tr);
            }
        }

        table.appendChild(tbody);
        this._satHost.appendChild(table);
    }
}
