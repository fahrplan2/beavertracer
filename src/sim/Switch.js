//@ts-check

import { SwitchBackplane } from "../net/SwitchBackplane.js";
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

    kind = "Switch";
    icon = "my-icon-switch";

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

    /** @type {HTMLInputElement|null} */
    _vlanEnabledCheckbox = null;

    /** @type {HTMLDivElement|null} */
    _vlanSection = null;

    /** @type {HTMLInputElement|null} */
    _stpEnabledCheckbox = null;

    /** @type {HTMLDivElement|null} */
    _stpSection = null;

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
        const ports = this.backplane?.ports ?? [];

        return {
            ...super.toJSON(),
            kind: "Switch",

            // feature flags
            vlanEnabled: !!this.backplane.vlanEnabled,
            stpEnabled: !!this.backplane.stpEnabled,

            // per-port vlan config
            vlanPorts: ports.map(p => ({
                vlanMode: p.vlanMode,                         // "tagged"|"untagged"
                pvid: p.pvid,                                 // number
                allowedVlans: [...(p.allowedVlans ?? [])],     // number[]
            })),
        };

    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Switch(n.name ?? "Switch");
        obj._applyBaseJSON(n);

        // --- Feature flags (order matters: VLAN first, then port config, then STP) ---
        if (n.vlanEnabled) obj.backplane.enableVLANFeature();
        else obj.backplane.disableVLANFeature();

        // --- Per-port VLAN config ---
        if (Array.isArray(n.vlanPorts)) {
            const ports = obj.backplane.ports ?? [];
            for (let i = 0; i < ports.length && i < n.vlanPorts.length; i++) {
                const cfg = n.vlanPorts[i] ?? {};
                const p = ports[i];

                const pvid = Number(cfg.pvid ?? p.pvid ?? 1) || 1;
                const mode = (cfg.vlanMode === "tagged" || cfg.vlanMode === "untagged") ? cfg.vlanMode : p.vlanMode;

                if (mode === "untagged") {
                    p.setUntagged(pvid);
                } else {
                    const allowed = Array.isArray(cfg.allowedVlans)
                        ? cfg.allowedVlans
                            .map(x => Number(x))
                            .filter(v => Number.isInteger(v) && v >= 1 && v <= 4094)
                        : [...(p.allowedVlans ?? new Set([pvid]))];

                    // ensure pvid included (good UX + consistent behavior)
                    if (!allowed.includes(pvid)) allowed.unshift(pvid);

                    p.setTagged(allowed, pvid);
                }
            }
        }

        // --- STP flag last (enables HELLO emission / state recompute) ---
        if (n.stpEnabled) obj.backplane.enableSTPFeature();
        else obj.backplane.disableSTPFeature();

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

        const nameLabel = DOMBuilder.label(t("switch.name") + ": ");
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

        // ---- Features ----
        host.appendChild(DOMBuilder.h4(t("switch.features") ?? "Features"));

        const featureCard = DOMBuilder.div("switch-card");
        featureCard.style.display = "flex";
        featureCard.style.flexDirection = "column";
        featureCard.style.gap = "10px";
        host.appendChild(featureCard);

        // VLAN checkbox
        const vlanRow = DOMBuilder.div("switch-row");
        vlanRow.style.display = "flex";
        vlanRow.style.alignItems = "center";
        vlanRow.style.gap = "8px";


        const vlanCb = /** @type {HTMLInputElement} */ (DOMBuilder.input({ type: "checkbox" }));
        this._vlanEnabledCheckbox = vlanCb;
        vlanCb.checked = !!this.backplane.vlanEnabled;

        const vlanLbl = DOMBuilder.label(t("switch.vlan.enable") ?? "VLANs aktivieren");
        vlanRow.append(vlanCb, vlanLbl);
        featureCard.appendChild(vlanRow);

        // STP checkbox
        const stpRow = DOMBuilder.div("switch-row");
        stpRow.style.display = "flex";
        stpRow.style.alignItems = "center";
        stpRow.style.gap = "8px";

        const stpCb = /** @type {HTMLInputElement} */ (DOMBuilder.input({ type: "checkbox" }));
        this._stpEnabledCheckbox = stpCb;
        stpCb.checked = !!this.backplane.stpEnabled;

        const stpLbl = DOMBuilder.label(t("switch.stp.enable") ?? "STP aktivieren");
        stpRow.append(stpCb, stpLbl);
        featureCard.appendChild(stpRow);

        // VLAN section (hidden when disabled)
        const vlanSection = DOMBuilder.div("switch-vlan-section");
        this._vlanSection = vlanSection;
        featureCard.appendChild(vlanSection);

        // STP section
        const stpSection = DOMBuilder.div("switch-stp-section");
        this._stpSection = stpSection;
        featureCard.appendChild(stpSection);

        // Wire events
        vlanCb.addEventListener("change", () => {
            if (vlanCb.checked) this.backplane.enableVLANFeature();
            else this.backplane.disableVLANFeature();

            this._renderVLANSection();
            this._renderSAT(); // SAT changes format when VLAN enabled
        });

        stpCb.addEventListener("change", () => {
            if (stpCb.checked) this.backplane.enableSTPFeature();
            else this.backplane.disableSTPFeature();

            this._renderSTPSection();
        });

        // initial render
        this._renderVLANSection();
        this._renderSTPSection();

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
        thead.innerHTML = "<tr>"
            + (this.backplane.vlanEnabled ? "<th>VLAN</th>" : "")
            + "<th>" + t("switch.sat.mac") + "</th>"
            + "<th>" + t("switch.sat.port") + "</th>"
            + "</tr>";

        table.appendChild(thead);

        const tbody = document.createElement("tbody");

        /** @type {{vid: number|null, mac: bigint, portIdx: number}[]} */
        const rows = [];

        if (sat && sat.size) {
            if (!this.backplane.vlanEnabled) {
                for (const [mac, portIdx] of sat.entries()) {
                    rows.push({ vid: null, mac: /** @type {bigint} */ (mac), portIdx: Number(portIdx) });
                }
            } else {
                for (const [vid, macMap] of sat.entries()) {
                    for (const [mac, portIdx] of macMap.entries()) {
                        rows.push({ vid: Number(vid), mac: /** @type {bigint} */ (mac), portIdx: Number(portIdx) });
                    }
                }
            }
        }


        // sort: port, then mac
        rows.sort((a, b) =>
            ((a.vid ?? -1) - (b.vid ?? -1)) ||
            (a.portIdx - b.portIdx) ||
            (a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0)
        );

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

    _renderVLANSection() {
        if (!this._vlanSection || !this._vlanEnabledCheckbox) return;

        const enabled = this._vlanEnabledCheckbox.checked;
        this._vlanSection.innerHTML = "";

        if (!enabled) {
            // Hide all VLAN controls when disabled
            this._vlanSection.style.display = "none";
            return;
        }

        this._vlanSection.style.display = "block";

        const ports = this.backplane?.ports ?? [];
        const card = DOMBuilder.div("switch-card");
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.gap = "8px";

        card.appendChild(DOMBuilder.h4(t("switch.vlan.config") ?? "VLAN Konfiguration"));

        for (let i = 0; i < ports.length; i++) {
            const p = ports[i];

            const row = DOMBuilder.div("switch-vlan-port-row");
            row.style.display = "grid";
            row.style.gridTemplateColumns = "120px 140px 120px 1fr auto";
            row.style.gap = "8px";
            row.style.alignItems = "center";

            const label = DOMBuilder.div("");
            label.textContent = `port ${i + 1}`;

            // Mode select: tagged/untagged
            const mode = /** @type {HTMLSelectElement} */ (document.createElement("select"));
            mode.innerHTML = `
      <option value="untagged">untagged</option>
      <option value="tagged">tagged</option>
    `;
            mode.value = p.vlanMode;

            // PVID
            const pvid = /** @type {HTMLInputElement} */ (DOMBuilder.input({ type: "number", value: String(p.pvid) }));
            pvid.min = "1";
            pvid.max = "4094";
            pvid.step = "1";

            // Allowed VLANs (only relevant for tagged)
            const allowed = /** @type {HTMLInputElement} */ (DOMBuilder.input({ value: [...(p.allowedVlans ?? new Set([p.pvid]))].sort((a, b) => a - b).join(",") }));
            allowed.placeholder = "e.g. 1,10,20";
            allowed.style.width = "100%";

            // Apply button
            const apply = DOMBuilder.button(t("switch.apply") ?? "Apply");

            const updateEnabledFields = () => {
                const isTagged = mode.value === "tagged";
                allowed.disabled = !isTagged;
                allowed.style.opacity = isTagged ? "1" : "0.5";
            };
            updateEnabledFields();

            apply.addEventListener("click", () => {
                const newPvid = Number(pvid.value);
                if (!Number.isInteger(newPvid) || newPvid < 1 || newPvid > 4094) return;

                if (mode.value === "untagged") {
                    p.setUntagged(newPvid);
                } else {
                    // parse allowed list
                    const parsed = allowed.value
                        .split(",")
                        .map(s => Number(s.trim()))
                        .filter(n => Number.isInteger(n) && n >= 1 && n <= 4094);

                    const uniq = [...new Set(parsed)];
                    // Ensure pvid is always allowed on tagged ports (nice UX)
                    if (!uniq.includes(newPvid)) uniq.unshift(newPvid);

                    p.setTagged(uniq, newPvid);
                }

                // SAT may change over time; refresh now
                this._renderSAT();
                // Keep UI in sync (in case parsing changed)
                this._renderVLANSection();
            });

            mode.addEventListener("change", updateEnabledFields);

            row.append(label, mode, pvid, allowed, apply);
            card.appendChild(row);
        }

        this._vlanSection.appendChild(card);
    }

    _renderSTPSection() {
        if (!this._stpSection || !this._stpEnabledCheckbox) return;

        this._stpSection.innerHTML = "";

        const enabled = this._stpEnabledCheckbox.checked;

        const card = DOMBuilder.div("switch-card");
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.gap = "8px";

        card.appendChild(DOMBuilder.h4(t("switch.stp.status") ?? "STP Status"));

        if (!enabled) {
            const p = DOMBuilder.div("");
            p.textContent = t("switch.stp.disabled") ?? "STP ist deaktiviert.";
            p.style.opacity = "0.8";
            card.appendChild(p);
            this._stpSection.appendChild(card);
            return;
        }

        // Minimal status
        const root = DOMBuilder.div("");
        root.textContent = `Root ID: 0x${this.backplane.stpRootId.toString(16)}`;

        const rootCost = DOMBuilder.div("");
        rootCost.textContent = `Root Cost: ${this.backplane.stpRootCost}`;

        const rootPort = DOMBuilder.div("");
        rootPort.textContent = `Root Port: ${this.backplane.stpRootPort == null ? "-" : `port ${this.backplane.stpRootPort + 1}`}`;

        card.append(root, rootCost, rootPort);

        // Port states table
        const table = document.createElement("table");
        table.className = "switch-stp-table";
        table.innerHTML = `
    <thead>
      <tr>
        <th>Port</th>
        <th>Linked</th>
        <th>State</th>
      </tr>
    </thead>
  `;
        const tbody = document.createElement("tbody");

        const ports = this.backplane?.ports ?? [];
        for (let i = 0; i < ports.length; i++) {
            const tr = document.createElement("tr");
            const linked = ports[i].isLinked();
            const fw = !!this.backplane.stpForwarding[i];

            tr.innerHTML = `
      <td>port ${i + 1}</td>
      <td>${linked ? "yes" : "no"}</td>
      <td>${fw ? "forwarding" : "blocking"}</td>
    `;
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        card.appendChild(table);

        this._stpSection.appendChild(card);
    }
}
