//@ts-check

import { SwitchBackplane } from "../net/SwitchBackplane.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { PollTimer } from "../lib/PollTimer.js";
import { UILib } from "../lib/UILib.js";
import { t } from "../i18n/index.js";

/**
 * Kleine Helper fürs SAT-Rendering
 * @param {bigint} macBig
 */
function macBigIntToStr(macBig) {
    // macBig ist 48-bit, als hex ohne 0x
    let hex = macBig.toString(16).padStart(12, "0");
    // aa:bb:cc:dd:ee:ff
    return (hex.match(/.{2}/g) ?? []).join(":");
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

    /** @type {string} */
    _activeTab = "sat";

    /** @type {HTMLDivElement|null} */
    _satHost = null;

    _pollTimer = new PollTimer();

    /** @type {HTMLInputElement|null} */
    _vlanEnabledCheckbox = null;

    /** @type {HTMLDivElement|null} */
    _vlanSection = null;

    /** @type {HTMLSelectElement|null} */
    _stpModeSelect = null;

    /** @type {HTMLDivElement|null} */
    _stpSection = null;

    /** @type {HTMLDivElement|null} */
    _lagSection = null;

    /** @type {HTMLInputElement|null} */
    _igmpEnabledCheckbox = null;

    /** @type {HTMLDivElement|null} */
    _igmpSection = null;

    /**
     * @param {String} name
     */
    constructor(name = t("switch.title")) {
        super(name);
        this.backplane = new SwitchBackplane(8);

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
            stpMode: this.backplane.stpMode,
            stpEnabled: this.backplane.stpMode !== 'off', // backward compat
            stpBridgePriority: this.backplane._stpBridgePriority,

            // per-port vlan config
            vlanPorts: ports.map(p => ({
                vlanMode: p.vlanMode,                         // "tagged"|"untagged"
                pvid: p.pvid,                                 // number
                allowedVlans: [...(p.allowedVlans ?? [])],     // number[]
            })),

            // lag groups
            lagGroups: this.backplane.lagGroups.map(g => ({
                id: g.id, name: g.name, mode: g.mode, members: [...g.members],
            })),
            lagNextId: this.backplane._nextLagId,

            igmpSnoopingEnabled: !!this.backplane.igmpSnoopingEnabled,
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
                            .map((/** @type {*} */ x) => Number(x))
                            .filter((/** @type {number} */ v) => Number.isInteger(v) && v >= 1 && v <= 4094)
                        : [...(p.allowedVlans ?? new Set([pvid]))];

                    // ensure pvid included (good UX + consistent behavior)
                    if (!allowed.includes(pvid)) allowed.unshift(pvid);

                    p.setTagged(allowed, pvid);
                }
            }
        }

        // --- STP priority before enabling STP ---
        if (typeof n.stpBridgePriority === "number") {
            obj.backplane.setBridgePriority(n.stpBridgePriority);
        }

        // --- STP/RSTP mode last (enables HELLO emission / state recompute) ---
        const mode = n.stpMode ?? (n.stpEnabled ? 'stp' : 'off');
        if (mode === 'rstp')       obj.backplane.enableRSTPFeature();
        else if (mode === 'stp')   obj.backplane.enableSTPFeature();
        else                       obj.backplane.disableSTPFeature();

        // --- LAG groups ---
        if (Array.isArray(n.lagGroups)) {
            for (const g of n.lagGroups) {
                const group = { id: g.id, name: g.name ?? `bond${g.id}`, mode: g.mode ?? 'static', members: /** @type {number[]} */ ([]) };
                obj.backplane.lagGroups.push(group);
                if (Array.isArray(g.members)) {
                    for (const portIdx of g.members) {
                        if (portIdx >= 0 && portIdx < obj.backplane.ports.length) {
                            group.members.push(portIdx);
                            obj.backplane.portLagId[portIdx] = group.id;
                        }
                    }
                }
            }
            obj.backplane._nextLagId = typeof n.lagNextId === 'number'
                ? n.lagNextId
                : obj.backplane.lagGroups.reduce((m, g) => Math.max(m, g.id + 1), 0);
        }

        // --- IGMP Snooping ---
        if (n.igmpSnoopingEnabled) obj.backplane.enableIGMPSnooping();

        return obj;
    }


    listPorts() {
        const ports = this.backplane?.ports ?? [];
        return ports.map((p, i) => ({
            key: `sw${i}`,
            label: `${i + 1}`,
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

    /** @param {HTMLElement} panelBody */
    mount(panelBody) {
        this._stopSatPolling();
        panelBody.innerHTML = "";

        const host = UILib.div("switch-ui");
        panelBody.appendChild(host);
        this._host = host;

        const card = UILib.div("router-card");
        host.appendChild(card);

        const content = UILib.div("sim-panel-content hr-panel-content");

        const { bar: tabBar, setActive: selectTab } = UILib.tabGroup([
            { id: "sat",  label: t("switch.tab.sat")  },
            { id: "vlan", label: t("switch.tab.vlan") },
            { id: "stp",  label: t("switch.tab.stp")  },
            { id: "lag",  label: t("switch.tab.lag")  },
            { id: "igmp", label: t("switch.tab.igmp") },
        ], (id) => {
            this._activeTab = id;
            this._satHost = null;
            this._vlanEnabledCheckbox = null;
            this._vlanSection = null;
            this._stpModeSelect = null;
            this._stpSection = null;
            this._lagSection = null;
            this._igmpEnabledCheckbox = null;
            this._igmpSection = null;
            UILib.clear(content);
            if (id === "sat")  this._buildMacTab(content);
            else if (id === "vlan") this._buildVlanTab(content);
            else if (id === "stp")  this._buildStpTab(content);
            else if (id === "lag")  this._buildLagTab(content);
            else if (id === "igmp") this._buildIGMPTab(content);
        });
        card.appendChild(tabBar);
        card.appendChild(content);

        if (this._activeTab === "sat")  this._buildMacTab(content);
        else if (this._activeTab === "vlan") this._buildVlanTab(content);
        else if (this._activeTab === "stp")  this._buildStpTab(content);
        else if (this._activeTab === "lag")  this._buildLagTab(content);
        else if (this._activeTab === "igmp") this._buildIGMPTab(content);
        selectTab(this._activeTab);
        this._startSatPolling();
    }

    /** @param {HTMLElement} host */
    _buildMacTab(host) {
        const satHost = UILib.div("switch-sat sim-table-scroll");
        this._satHost = satHost;
        host.appendChild(UILib.wrapWithScrollHints(satHost));
        this._renderSAT();
    }

    /** @param {HTMLElement} host */
    _buildVlanTab(host) {
        const cb = /** @type {HTMLInputElement} */ (UILib.input({ type: "checkbox" }));
        cb.checked = !!this.backplane.vlanEnabled;
        this._vlanEnabledCheckbox = cb;
        host.appendChild(UILib.div("hr-checkbox-row", [cb, UILib.el("span", { text: t("switch.vlan.enable") })]));

        const section = UILib.div("switch-vlan-section");
        this._vlanSection = section;
        host.appendChild(section);

        cb.addEventListener("change", () => {
            if (cb.checked) this.backplane.enableVLANFeature();
            else this.backplane.disableVLANFeature();
            this._renderVLANSection();
        });

        this._renderVLANSection();
    }

    /** @param {HTMLElement} host */
    _buildStpTab(host) {
        const modeSelect = UILib.select([
            { value: "off",  label: t("switch.stp.off") ?? "Off" },
            { value: "stp",  label: "STP (802.1D)" },
            { value: "rstp", label: "RSTP (802.1w)" },
        ], {
            value: this.backplane.stpMode,
            onChange: (mode) => {
                if (mode === 'rstp')      this.backplane.enableRSTPFeature();
                else if (mode === 'stp')  this.backplane.enableSTPFeature();
                else                      this.backplane.disableSTPFeature();
                this._renderSTPSection();
            },
        });
        this._stpModeSelect = modeSelect;

        const priorityItems = [];
        for (let p = 0; p <= 61440; p += 4096) {
            priorityItems.push({ value: String(p), label: p === 32768 ? `${p} (${t("switch.stp.priority.default") ?? "default"})` : String(p) });
        }
        const prioritySelect = UILib.select(priorityItems, {
            value: String(this.backplane._stpBridgePriority ?? 32768),
            onChange: (v) => {
                this.backplane.setBridgePriority(Number(v));
                this._renderSTPSection();
            },
        });

        host.appendChild(UILib.div("hr-fields", [
            UILib.el("div", { className: "hr-field", children: [
                UILib.el("span", { text: t("switch.stp.enable") ?? "Spanning Tree", className: "hr-label" }),
                modeSelect,
            ]}),
            UILib.el("div", { className: "hr-field", children: [
                UILib.el("span", { text: t("switch.stp.priority") ?? "Bridge Priority", className: "hr-label" }),
                prioritySelect,
            ]}),
        ]));

        const section = UILib.div("switch-stp-section");
        this._stpSection = section;
        host.appendChild(section);

        this._renderSTPSection();
    }

    _startSatPolling() {
        this._pollTimer.start(() => {
            if (this._activeTab === "sat") this._renderSAT();
            else if (this._activeTab === "stp") this._renderSTPSection();
            else if (this._activeTab === "lag") this._updateLagLinkStatus();
            else if (this._activeTab === "igmp") this._renderIGMPSection();
        }, 500);
    }

    _stopSatPolling() {
        this._pollTimer.stop();
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
            this._vlanSection.classList.add("hidden");
            return;
        }

        this._vlanSection.classList.remove("hidden");

        const ports = this.backplane?.ports ?? [];
        const lagGroups = this.backplane?.lagGroups ?? [];
        const card = UILib.div("switch-card");

        const header = UILib.div("switch-vlan-port-row switch-vlan-header");
        for (const key of ["switch.vlan.col.port", "switch.vlan.col.mode", "switch.vlan.col.pvid", "switch.vlan.col.allowed", ""]) {
            const th = UILib.el("span", { text: key ? t(key) : "", className: "switch-vlan-col-label" });
            header.appendChild(th);
        }
        card.appendChild(header);

        /**
         * @param {string} labelText
         * @param {import("../net/EthernetPort.js").EthernetPort} refPort
         * @param {(modeVal: string, newPvid: number, allowedVal: string) => void} onApply
         */
        const addRow = (labelText, refPort, onApply) => {
            const row = UILib.div("switch-vlan-port-row");

            const label = UILib.div("");
            label.textContent = labelText;

            const mode = /** @type {HTMLSelectElement} */ (document.createElement("select"));
            mode.innerHTML = `
      <option value="untagged">untagged</option>
      <option value="tagged">tagged</option>
    `;
            mode.value = refPort.vlanMode;

            const pvid = /** @type {HTMLInputElement} */ (UILib.input({ type: "number", value: String(refPort.pvid) }));
            pvid.min = "1";
            pvid.max = "4094";
            pvid.step = "1";

            const allowed = /** @type {HTMLInputElement} */ (UILib.input({ value: [...(refPort.allowedVlans ?? new Set([refPort.pvid]))].sort((a, b) => a - b).join(",") }));
            allowed.placeholder = "e.g. 1,10,20";
            allowed.style.width = "100%";

            const apply = UILib.button(t("switch.apply") ?? "Apply", null);

            const updateEnabledFields = () => {
                const isTagged = mode.value === "tagged";
                allowed.disabled = !isTagged;
                allowed.style.opacity = isTagged ? "1" : "0.5";
            };
            updateEnabledFields();
            mode.addEventListener("change", updateEnabledFields);

            apply.addEventListener("click", () => {
                const newPvid = Number(pvid.value);
                if (!Number.isInteger(newPvid) || newPvid < 1 || newPvid > 4094) return;
                onApply(mode.value, newPvid, allowed.value);
                this._renderSAT();
                this._renderVLANSection();
            });

            row.append(label, mode, pvid, allowed, apply);
            card.appendChild(row);
        };

        /** @param {string} modeVal @param {number} newPvid @param {string} allowedVal @param {import("../net/EthernetPort.js").EthernetPort} p */
        const applyToPort = (modeVal, newPvid, allowedVal, p) => {
            if (modeVal === "untagged") {
                p.setUntagged(newPvid);
            } else {
                const parsed = allowedVal
                    .split(",")
                    .map(s => Number(s.trim()))
                    .filter(n => Number.isInteger(n) && n >= 1 && n <= 4094);
                const uniq = [...new Set(parsed)];
                if (!uniq.includes(newPvid)) uniq.unshift(newPvid);
                p.setTagged(uniq, newPvid);
            }
        };

        // LAG bonds appear as one logical row each; config is applied to all members
        const lagMemberPorts = new Set();
        for (const group of lagGroups) {
            if (group.members.length === 0) continue;
            for (const m of group.members) lagMemberPorts.add(m);
            const repPort = ports[group.members[0]];
            if (!repPort) continue;
            addRow(group.name, repPort, (modeVal, newPvid, allowedVal) => {
                for (const m of group.members) {
                    const mp = ports[m];
                    if (mp) applyToPort(modeVal, newPvid, allowedVal, mp);
                }
            });
        }

        // Non-LAG ports appear individually
        for (let i = 0; i < ports.length; i++) {
            if (lagMemberPorts.has(i)) continue;
            const p = ports[i];
            addRow(`port ${i + 1}`, p, (modeVal, newPvid, allowedVal) => {
                applyToPort(modeVal, newPvid, allowedVal, p);
            });
        }

        this._vlanSection.appendChild(card);
    }

    /** @param {HTMLElement} host */
    _buildLagTab(host) {
        const header = UILib.div("switch-lag-header");
        header.appendChild(UILib.el("span", { text: t("switch.lag.title"), className: "switch-lag-title" }));
        header.appendChild(UILib.button(t("switch.lag.addGroup"), () => {
            this.backplane.createLagGroup('static');
            this._renderLagSection();
        }));
        host.appendChild(header);

        const section = UILib.div("switch-lag-section");
        this._lagSection = section;
        host.appendChild(section);
        this._renderLagSection();
    }

    _renderLagSection() {
        if (!this._lagSection) return;
        UILib.clear(this._lagSection);

        const groups = this.backplane.lagGroups;
        const ports  = this.backplane.ports;

        if (!groups.length) {
            this._lagSection.appendChild(UILib.el("p", {
                text: t("switch.lag.empty"),
                className: "router-empty-p",
            }));
            return;
        }

        for (const group of groups) {
            const card = UILib.div("switch-lag-card");

            // ── card header ──────────────────────────────────────────
            const cardHeader = UILib.div("switch-lag-card-header");

            cardHeader.appendChild(UILib.el("span", { text: group.name, className: "switch-lag-name" }));

            cardHeader.appendChild(UILib.el("span", { text: t("switch.lag.mode") + ":", className: "hr-label" }));
            cardHeader.appendChild(UILib.select([
                { value: "static", label: t("switch.lag.mode.static") },
                { value: "lacp",   label: t("switch.lag.mode.lacp")   },
            ], {
                value: group.mode,
                onChange: (v) => { group.mode = /** @type {'static'|'lacp'} */ (v); },
            }));

            const delBtn = UILib.button(t("switch.lag.delete"), () => {
                this.backplane.deleteLagGroup(group.id);
                this._renderLagSection();
            }, { className: "btn" });
            cardHeader.appendChild(delBtn);
            card.appendChild(cardHeader);

            // ── port checkboxes ──────────────────────────────────────
            const portsRow = UILib.div("switch-lag-ports");

            for (let idx = 0; idx < ports.length; idx++) {
                const currentGid    = this.backplane.portLagId[idx] ?? -1;
                const isInThisGroup = currentGid === group.id;
                const isInOther     = currentGid >= 0 && currentGid !== group.id;
                const isLinked      = ports[idx].isLinked();

                const cb = /** @type {HTMLInputElement} */ (UILib.input({ type: "checkbox" }));
                cb.checked  = isInThisGroup;
                cb.disabled = isInOther;

                if (!isInOther) {
                    cb.addEventListener("change", () => {
                        if (cb.checked) this.backplane.addPortToLag(idx, group.id);
                        else            this.backplane.removePortFromLag(idx);
                        this._renderLagSection();
                    });
                }

                const statusEl = isInThisGroup
                    ? UILib.el("span", {
                        text: isLinked
                            ? ("● " + t("switch.lag.status.active"))
                            : ("○ " + t("switch.lag.status.inactive")),
                        className: isLinked ? "switch-lag-status-active" : "switch-lag-status-inactive",
                    })
                    : null;

                const entry = UILib.div(
                    "switch-lag-port-entry" + (isInOther ? " switch-lag-port-disabled" : ""),
                    [cb, UILib.el("span", { text: `port ${idx + 1}`, className: "switch-lag-port-label" }), statusEl],
                );
                entry.dataset.lagPort = String(idx);
                portsRow.appendChild(entry);
            }

            card.appendChild(portsRow);
            this._lagSection.appendChild(card);
        }
    }

    /** @param {HTMLElement} host */
    _buildIGMPTab(host) {
        const cb = /** @type {HTMLInputElement} */ (UILib.input({ type: "checkbox" }));
        cb.checked = !!this.backplane.igmpSnoopingEnabled;
        this._igmpEnabledCheckbox = cb;
        host.appendChild(UILib.div("hr-checkbox-row", [cb, UILib.el("span", { text: t("switch.igmp.enable") })]));

        cb.addEventListener("change", () => {
            if (cb.checked) this.backplane.enableIGMPSnooping();
            else this.backplane.disableIGMPSnooping();
            this._renderIGMPSection();
        });

        const section = UILib.div("switch-igmp-section");
        this._igmpSection = section;
        host.appendChild(section);
        this._renderIGMPSection();
    }

    _renderIGMPSection() {
        if (!this._igmpSection) return;
        this._igmpSection.innerHTML = "";

        if (!this.backplane.igmpSnoopingEnabled) {
            this._igmpSection.classList.add("hidden");
            return;
        }
        this._igmpSection.classList.remove("hidden");

        if (this.backplane.mcastTable.size === 0) {
            this._igmpSection.appendChild(UILib.el("p", {
                text: t("switch.igmp.empty"),
                className: "router-empty-p",
            }));
            return;
        }

        const table = document.createElement("table");
        table.className = "switch-igmp-table";

        const thead = document.createElement("thead");
        const htr = document.createElement("tr");
        for (const key of ["switch.igmp.col.proto", "switch.igmp.col.group", "switch.igmp.col.ports"]) {
            const th = document.createElement("th");
            th.textContent = t(key);
            htr.appendChild(th);
        }
        thead.appendChild(htr);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        for (const entry of this.backplane.mcastTable.values()) {
            const tr = document.createElement("tr");
            const isV6 = entry.ip.includes(":");
            const protoTd = document.createElement("td");
            protoTd.textContent = isV6 ? "MLD" : "IGMP";
            protoTd.style.opacity = "0.7";
            protoTd.style.fontSize = "0.78rem";
            const groupTd = document.createElement("td");
            groupTd.textContent = entry.ip;
            const portNames = [...entry.ports].sort((a, b) => a - b).map(p => `port ${p + 1}`).join(", ");
            const portsTd = document.createElement("td");
            portsTd.textContent = portNames;
            tr.appendChild(protoTd);
            tr.appendChild(groupTd);
            tr.appendChild(portsTd);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        const scroll = UILib.div("sim-table-scroll");
        scroll.appendChild(table);
        this._igmpSection.appendChild(UILib.wrapWithScrollHints(scroll));
    }

    _updateLagLinkStatus() {
        if (!this._lagSection) return;
        const ports = this.backplane.ports;
        this._lagSection.querySelectorAll("[data-lag-port]").forEach(entry => {
            const idx = Number(/** @type {HTMLElement} */ (entry).dataset.lagPort);
            const statusEl = entry.querySelector(".switch-lag-status-active, .switch-lag-status-inactive");
            if (!statusEl) return;
            const isLinked = ports[idx]?.isLinked();
            statusEl.textContent = isLinked
                ? ("● " + t("switch.lag.status.active"))
                : ("○ " + t("switch.lag.status.inactive"));
            statusEl.className = isLinked ? "switch-lag-status-active" : "switch-lag-status-inactive";
        });
    }

    _renderSTPSection() {
        if (!this._stpSection || !this._stpModeSelect) return;

        this._stpSection.innerHTML = "";

        const mode = this.backplane.stpMode;

        if (mode === 'off') {
            this._stpSection.appendChild(UILib.el("p", {
                text: t("switch.stp.disabled") ?? "Spanning Tree ist deaktiviert.",
                className: "router-empty-p",
            }));
            return;
        }

        const infoRow = (/** @type {string} */ label, /** @type {string} */ value) => UILib.div("hr-info-row", [
            UILib.el("span", { text: label, className: "hr-info-label" }),
            UILib.el("span", { text: value, className: "hr-info-value" }),
        ]);

        const isRoot = this.backplane.stpRootId === this.backplane.stpBridgeIdVal;
        const prio = this.backplane._stpBridgePriority ?? 32768;

        this._stpSection.appendChild(UILib.el("div", { className: "hr-section", children: [
            infoRow(t("switch.stp.status") ?? "Status", mode === 'rstp' ? "RSTP (802.1w)" : "STP (802.1D)"),
            infoRow("Bridge ID", `0x${this.backplane.stpBridgeIdVal.toString(16)} (Priority ${prio})${isRoot ? " — Root" : ""}`),
            infoRow("Root ID",   `0x${this.backplane.stpRootId.toString(16)}`),
            infoRow("Root Cost", String(this.backplane.stpRootCost)),
            infoRow("Root Port", this.backplane.stpRootPort == null ? "–" : `port ${this.backplane.stpRootPort + 1}`),
        ]}));

        const table = document.createElement("table");
        table.className = "switch-stp-table";
        table.innerHTML = `<thead><tr><th>Port</th><th>Linked</th><th>Role</th><th>State</th></tr></thead>`;
        const tbody = document.createElement("tbody");

        const ports = this.backplane?.ports ?? [];
        let hasLagInheritance = false;

        for (let i = 0; i < ports.length; i++) {
            const tr = document.createElement("tr");
            const linked = ports[i].isLinked();
            const state = this.backplane.stpPortState?.[i] ?? (this.backplane.stpForwarding[i] ? "forwarding" : "blocking");
            const role = !linked ? "—" : (this.backplane.stpPortRole?.[i] ?? "—");

            const statusClass = {
                forwarding: "status-up",
                blocking:   "status-down",
                discarding: "status-down",
                listening:  "status-warning",
                learning:   "status-warning",
            }[state] ?? "status-unknown";
            const stateTd = document.createElement("td");
            const badge = document.createElement("span");
            badge.textContent = state;
            badge.className = `ui-tab-badge ${statusClass}`;
            stateTd.appendChild(badge);

            // LAG hint in port cell
            const portTd = document.createElement("td");
            portTd.textContent = `port ${i + 1}`;
            const gid = this.backplane.portLagId[i] ?? -1;
            if (gid >= 0) {
                const group = this.backplane.lagGroups.find(g => g.id === gid);
                if (group) {
                    const isRep = this.backplane._lagRepresentative(i) === i;
                    if (!isRep) hasLagInheritance = true;
                    const lagTag = document.createElement("span");
                    lagTag.className = "ui-tab-badge switch-stp-lag-tag" + (isRep ? " status-unknown" : " switch-stp-lag-inherited");
                    lagTag.textContent = isRep ? group.name : `↑ ${group.name}`;
                    lagTag.title = isRep
                        ? t("switch.stp.lag.rep.title")
                        : t("switch.stp.lag.inherited.title");
                    portTd.appendChild(lagTag);
                }
            }

            const linkedTd = document.createElement("td"); linkedTd.textContent = linked ? "yes" : "no";
            const roleTd = document.createElement("td"); roleTd.textContent = role;

            tr.append(portTd, linkedTd, roleTd, stateTd);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        const scroll = UILib.div("sim-table-scroll");
        scroll.appendChild(table);
        this._stpSection.appendChild(UILib.wrapWithScrollHints(scroll));

        if (hasLagInheritance) {
            this._stpSection.appendChild(UILib.el("p", {
                text: t("switch.stp.lag.footnote"),
                className: "sim-hint switch-stp-lag-footnote",
            }));
        }
    }
}
