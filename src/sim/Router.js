//@ts-check

import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { IPStack } from "../net/IPStack.js";
import { SimulatedObject } from "./SimulatedObject.js";

import { DOMBuilder } from "../lib/DomBuilder.js";
import { t } from "../i18n/index.js";
import { IPAddress } from "../net/models/IPAddress.js"; // <- ggf. Pfad anpassen
import { SimDialog } from "../lib/SimDialog.js";

/**
 * @typedef {Object} PortDescriptor
 * @property {string} key
 * @property {string} label
 * @property {import("../net/EthernetPort.js").EthernetPort} port
 */

/* ----------------------------- helpers ----------------------------- */

/** @param {IPAddress} ip */
function ipToStr(ip) {
    return ip?.toString?.() ?? "";
}

/** @param {string} s */
function ipFromStr(s) {
    return IPAddress.fromString(String(s).trim());
}

/** @param {number} p */
function assertPrefix(p) {
    const x = Number(p);
    if (!Number.isInteger(x) || x < 0 || x > 32) throw new Error("Prefix muss 0..32 sein");
    return x | 0;
}

/** @param {string} s like "255.255.255.0" -> prefix length (0..32) or null */
function netmaskStrToPrefix(s) {
    const ip = IPAddress.fromString(String(s).trim());
    if (!ip.isV4()) return null;

    // contiguous ones then zeros
    const m = /** @type {number} */ (ip.getNumber()) >>> 0;

    let seenZero = false;
    let c = 0;
    for (let i = 31; i >= 0; i--) {
        const bit = (m >>> i) & 1;
        if (bit === 1) {
            if (seenZero) return null;
            c++;
        } else {
            seenZero = true;
        }
    }
    return c;
}

/** @param {number} prefix -> "255.255.255.0" */
function prefixToNetmaskStr(prefix) {
    const p = assertPrefix(prefix);
    let m = 0 >>> 0;
    if (p === 0) m = 0 >>> 0;
    else m = (0xffffffff << (32 - p)) >>> 0;
    return new IPAddress(4, m >>> 0).toString();
}

/** @param {HTMLElement} el @param {boolean} isInvalid */
function markInvalid(el, isInvalid) {
    if (!el) return;
    el.classList.toggle("is-invalid", !!isInvalid);
}

/** deterministic via EthernetPort.linkref @param {*} iface */
function getInterfaceLinkStatus(iface) {
    const port = iface?.port;
    if (!port) return { text: t("router.unknown"), state: "unknown" };
    return port.linkref ? { text: t("router.stateup"), state: "up" } : { text: t("router.statedown"), state: "down" };
}

/* ------------------------------ Router ----------------------------- */

export class Router extends SimulatedObject {
    icon = "my-icon-router";
    kind = "Router";

    /** @type {IPStack} */
    net;

    /** @type {HTMLElement|null} */
    _panelBody = null;

    /** @type {number|null} */
    _linkPollTimer = null;

    /** @type {string|null} */
    _selectedIfaceName = null;

  // UI refs
  /** @type {HTMLDivElement|null} */ _tabsBar = null;

    /** @type {Map<string, {btn: HTMLButtonElement, badge: HTMLSpanElement}>} */
    _tabRefs = new Map();

  /** @type {HTMLDivElement|null} */ _selectedIfaceLabel = null;
  /** @type {HTMLDivElement|null} */ _ifacePanel = null;
  /** @type {HTMLDivElement|null} */ _ifaceActionsHost = null;

  /** @type {HTMLInputElement|null} */ _ipInput = null;
  /** @type {HTMLInputElement|null} */ _maskInput = null;
  /** @type {HTMLInputElement|null} */ _cidrInput = null;
  /** @type {HTMLInputElement|null} */ _ip6Input = null;
  /** @type {HTMLInputElement|null} */ _prefix6Input = null;
  /** @type {HTMLInputElement|null} */ _ipv4EnableCb = null;
  /** @type {HTMLInputElement|null} */ _ipv6EnableCb = null;
  /** @type {HTMLButtonElement|null} */ _saveIfBtn = null;
  /** @type {HTMLButtonElement|null} */ _delIfBtn = null;

  /** @type {HTMLDivElement|null} */ _routesHost = null;
  /** @type {number} */ _selectedRouteFamily = 4;

    constructor(name = t("router.title")) {
        super((name = t("router.title")));
        this.net = new IPStack(2, name);
        this.net.forwarding = true;
        this.fs = new VirtualFileSystem();

        /** @param {HTMLElement} body */
        this.onPanelCreated = (body) => {
            this._panelBody = body;
            this.mount(body);
        };
    }

    toJSON() {
        return {
            ...super.toJSON(),
            kind: "Router",
            net: this.net.toJSON(),
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Router(n.name ?? "Router");
        obj._applyBaseJSON(n);
        if (n.net) obj.net = IPStack.fromJSON(n.net);
        return obj;
    }

    /** @returns {PortDescriptor[]} */
    listPorts() {
        const ifs = this.net?.interfaces ?? [];
        return ifs.map((nic, i) => ({
            key: `eth${i}`,
            label: `eth${i}`,
            port: nic.port,
        }));
    }

    /** @param {string} key */
    getPortByKey(key) {
        const m = /^eth(\d+)$/.exec(key);
        if (!m) return null;
        const i = Number(m[1]);
        const nic = (this.net?.interfaces ?? [])[i];
        return nic?.port ?? null;
    }

    /* ------------------------------ UI ------------------------------ */

    /** @param {HTMLElement} panelBody */
    mount(panelBody) {
        this._stopLinkPolling();
        panelBody.innerHTML = "";

        const host = DOMBuilder.div("router-ui");
        host.style.display = "flex";
        host.style.flexDirection = "column";
        host.style.gap = "12px";
        panelBody.appendChild(host);

        /* ============================ Outer tabs ============================ */
        const card = DOMBuilder.div("router-card");
        host.appendChild(card);

        const outerTabIds = ["interfaces", "routes-v4", "routes-v6"];
        const outerTabBtns = [
            DOMBuilder.button(t("router.interfaces"),        { className: "router-tab" }),
            DOMBuilder.button(t("router.routingtable.ipv4"), { className: "router-tab" }),
            DOMBuilder.button(t("router.routingtable.ipv6"), { className: "router-tab" }),
        ];
        card.appendChild(DOMBuilder.div("router-tabs", outerTabBtns));

        const outerContent = DOMBuilder.div("");
        outerContent.style.padding = "8px";
        card.appendChild(outerContent);

        /* ============================ Interfaces ============================ */
        const ifSection = DOMBuilder.div("");
        ifSection.appendChild(DOMBuilder.h4(t("router.interfaces")));

        const tabsBar = DOMBuilder.div("router-tabs");
        this._tabsBar = tabsBar;

        const selLabel = DOMBuilder.div("router-selected-iface");
        this._selectedIfaceLabel = selLabel;

        const ifacePanel = DOMBuilder.div("router-if-panel");
        this._ifacePanel = ifacePanel;

        // --- IPv4 Section ---
        const v4Cb = DOMBuilder.input({ type: "checkbox" });
        const v4Header = DOMBuilder.div("router-if-section-header", [
            v4Cb,
            DOMBuilder.el("span", { text: "IPv4", className: "router-if-section-label" }),
        ]);
        const ipIn   = DOMBuilder.input({ className: "router-if-ip",   placeholder: "192.168.1.1" });
        const maskIn = DOMBuilder.input({ className: "router-if-mask", placeholder: "255.255.255.0" });
        const cidrIn = DOMBuilder.input({ className: "router-if-cidr", placeholder: "24" });
        const v4Fields = DOMBuilder.div("router-if-fields", [ipIn, maskIn, cidrIn]);
        const v4Section = DOMBuilder.div("router-if-section", [v4Header, v4Fields]);

        // --- IPv6 Section ---
        const v6Cb = DOMBuilder.input({ type: "checkbox" });
        const v6Header = DOMBuilder.div("router-if-section-header", [
            v6Cb,
            DOMBuilder.el("span", { text: "IPv6", className: "router-if-section-label" }),
        ]);
        const ip6In     = DOMBuilder.input({ className: "router-if-ip6",     placeholder: "2001:db8::1" });
        const prefix6In = DOMBuilder.input({ className: "router-if-prefix6", placeholder: "64" });
        const v6Fields = DOMBuilder.div("router-if-fields", [ip6In, prefix6In]);
        const v6Section = DOMBuilder.div("router-if-section", [v6Header, v6Fields]);

        const saveBtn = DOMBuilder.button(t("router.save"), { className: "router-if-save" });

        this._ipInput      = ipIn;
        this._maskInput    = maskIn;
        this._cidrInput    = cidrIn;
        this._ip6Input     = ip6In;
        this._prefix6Input = prefix6In;
        this._ipv4EnableCb = v4Cb;
        this._ipv6EnableCb = v6Cb;
        this._saveIfBtn    = saveBtn;

        ifacePanel.append(v4Section, v6Section, saveBtn);

        const actionsHost = DOMBuilder.div("router-if-actions");
        this._ifaceActionsHost = actionsHost;
        ifacePanel.appendChild(actionsHost);

        ifSection.append(tabsBar, selLabel, ifacePanel);

        /* =========================== Routingtabelle ========================== */
        const routeSection = DOMBuilder.div("");

        const routeTitle = DOMBuilder.h4("");
        routeSection.appendChild(routeTitle);

        const routesHost = DOMBuilder.div("router-routes");
        this._routesHost = routesHost;
        routeSection.appendChild(routesHost);

        outerContent.append(ifSection, routeSection);

        /* ============================ Tab switching ============================ */
        /** @param {string} id */
        const selectOuterTab = (id) => {
            outerTabBtns.forEach((btn, i) => btn.classList.toggle("is-active", outerTabIds[i] === id));
            ifSection.style.display    = id === "interfaces" ? "" : "none";
            routeSection.style.display = id === "interfaces" ? "none" : "";
            if (id === "routes-v4") { routeTitle.textContent = t("router.routingtable.ipv4"); this._selectedRouteFamily = 4; this._renderRoutes(); }
            if (id === "routes-v6") { routeTitle.textContent = t("router.routingtable.ipv6"); this._selectedRouteFamily = 6; this._renderRoutes(); }
        };
        outerTabBtns.forEach((btn, i) => btn.addEventListener("click", () => selectOuterTab(outerTabIds[i])));
        selectOuterTab("interfaces");

        /* ============================ Init ============================ */
        this._renderInterfaceTabs();
        this._renderInterfaceActions();
        this._wireInterfaceForm();

        if (!this._selectedIfaceName || !this.net.interfaces.some((i) => i.name === this._selectedIfaceName)) {
            this._selectedIfaceName = this.net.interfaces[0]?.name ?? null;
        }

        this._applyTabSelection();
        this._loadSelectedInterfaceIntoForm();
        this._updateInterfaceFormState();

        this._renderRoutes();
        this._startLinkPolling();
    }

    _renderInterfaceTabs() {
        const tabsBar = this._tabsBar;
        if (!tabsBar) return;

        DOMBuilder.clear(tabsBar);
        this._tabRefs.clear();

        for (const iface of this.net.interfaces) {
            const btn = DOMBuilder.button("", { className: "router-tab" });
            btn.dataset.name = iface.name;

            const label = DOMBuilder.el("span", { className: "router-tab-label", text: iface.name });
            const badge = DOMBuilder.el("span", { className: "router-tab-badge status-unknown", text: t("router.unknown") });

            btn.appendChild(label);
            btn.appendChild(badge);

            btn.addEventListener("click", () => {
                this._selectedIfaceName = iface.name;
                this._applyTabSelection();
                this._loadSelectedInterfaceIntoForm();
                this._updateInterfaceFormState();
            });

            tabsBar.appendChild(btn);
            this._tabRefs.set(iface.name, { btn, badge });
        }

        const plusBtn = DOMBuilder.button("+", { className: "router-tab router-tab-plus", title: t("router.addinterface") });
        plusBtn.addEventListener("click", () => {
            this.net.addNewInterface();
            this._selectedIfaceName = this.net.interfaces[this.net.interfaces.length - 1]?.name ?? this._selectedIfaceName;
            if (this._panelBody) this.mount(this._panelBody);
        });

        tabsBar.appendChild(plusBtn);
    }

    _renderInterfaceActions() {
        const actionsHost = this._ifaceActionsHost;
        if (!actionsHost) return;

        DOMBuilder.clear(actionsHost);

        const delBtn = DOMBuilder.button(t("router.deleteinterface"), { className: "router-if-del" });
        this._delIfBtn = delBtn;

        delBtn.addEventListener("click", async () => {
            const name = this._selectedIfaceName;
            if (!name) return;

            const ok = await SimDialog.confirm(t("router.confirminterfacedelete", { name }));
            if (!ok) return;

            this.net.deleteInterface(name);

            this._selectedIfaceName = this.net.interfaces[0]?.name ?? null;
            if (this._panelBody) this.mount(this._panelBody);
        });

        actionsHost.appendChild(delBtn);
    }

    _wireInterfaceForm() {
        const ipIn = this._ipInput;
        const maskIn = this._maskInput;
        const cidrIn = this._cidrInput;
        const ip6In = this._ip6Input;
        const prefix6In = this._prefix6Input;
        const v4Cb = this._ipv4EnableCb;
        const v6Cb = this._ipv6EnableCb;
        const saveBtn = this._saveIfBtn;

        if (!ipIn || !maskIn || !cidrIn || !saveBtn) return;

        const onInput = () => this._updateInterfaceFormState();

        if (v4Cb) v4Cb.addEventListener("change", onInput);
        if (v6Cb) v6Cb.addEventListener("change", onInput);

        ipIn.addEventListener("input", onInput);

        maskIn.addEventListener("input", () => {
            try {
                const p = netmaskStrToPrefix(maskIn.value);
                cidrIn.value = (p == null) ? "" : String(p);
            } catch { /* ignore */ }
            onInput();
        });

        cidrIn.addEventListener("input", () => {
            const v = cidrIn.value.trim();
            if (v) {
                try {
                    const p = assertPrefix(Number(v));
                    maskIn.value = prefixToNetmaskStr(p);
                } catch { /* ignore */ }
            }
            onInput();
        });

        if (ip6In) ip6In.addEventListener("input", onInput);
        if (prefix6In) prefix6In.addEventListener("input", onInput);

        saveBtn.addEventListener("click", () => this._applyInterfaceForm());
    }

    /* ------------------------ Tabs & status polling ------------------------ */

    _applyTabSelection() {
        for (const [name, ref] of this._tabRefs.entries()) {
            ref.btn.classList.toggle("is-active", name === this._selectedIfaceName);
        }

        const has = this.net.interfaces.length > 0;
        if (this._ifacePanel) this._ifacePanel.classList.toggle("is-disabled", !has);

        if (this._ipInput) this._ipInput.disabled = !has;
        if (this._maskInput) this._maskInput.disabled = !has;
        if (this._cidrInput) this._cidrInput.disabled = !has;
        if (this._ip6Input) this._ip6Input.disabled = !has;
        if (this._prefix6Input) this._prefix6Input.disabled = !has;
        if (this._ipv4EnableCb) this._ipv4EnableCb.disabled = !has;
        if (this._ipv6EnableCb) this._ipv6EnableCb.disabled = !has;
        if (this._saveIfBtn) this._saveIfBtn.disabled = !has;
        if (this._delIfBtn) this._delIfBtn.disabled = !has;

        if (this._selectedIfaceLabel) {
            this._selectedIfaceLabel.textContent = this._selectedIfaceName
                ? this._selectedIfaceName
                : t("router.nointerfaceselected");
        }
    }

    _startLinkPolling() {
        this._updateAllTabStatuses();
        this._linkPollTimer = window.setInterval(() => this._updateAllTabStatuses(), 1000);
    }

    _stopLinkPolling() {
        if (this._linkPollTimer != null) {
            clearInterval(this._linkPollTimer);
            this._linkPollTimer = null;
        }
    }

    _updateAllTabStatuses() {
        for (const iface of this.net.interfaces) {
            const ref = this._tabRefs.get(iface.name);
            if (!ref) continue;

            const s = getInterfaceLinkStatus(iface);
            ref.badge.textContent = s.text;

            ref.badge.classList.toggle("status-up", s.state === "up");
            ref.badge.classList.toggle("status-down", s.state === "down");
            ref.badge.classList.toggle("status-unknown", s.state === "unknown");
        }
    }

    /* ------------------------ Interfaces ------------------------ */

    /** @param {string} name */
    _ifaceNameToIndex(name) {
        const idx = this.net.interfaces.findIndex((i) => i.name === name);
        if (idx < 0) throw new Error("Unknown interface " + name);
        return idx;
    }

    _getSelectedIface() {
        const name = this._selectedIfaceName;
        if (!name) return null;
        return this.net.interfaces.find((i) => i.name === name) ?? null;
    }

    _loadSelectedInterfaceIntoForm() {
        const iface = this._getSelectedIface();
        if (!iface) {
            if (this._ipv4EnableCb) this._ipv4EnableCb.checked = false;
            if (this._ipInput)  this._ipInput.value = "";
            if (this._maskInput) this._maskInput.value = "";
            if (this._cidrInput) this._cidrInput.value = "";
            if (this._ipv6EnableCb) this._ipv6EnableCb.checked = false;
            if (this._ip6Input)    this._ip6Input.value = "";
            if (this._prefix6Input) this._prefix6Input.value = "";
            markInvalid(this._ipInput, false);
            markInvalid(this._maskInput, false);
            markInvalid(this._ip6Input, false);
            markInvalid(this._prefix6Input, false);
            return;
        }

        // IPv4
        const v4Active = iface.ip.isV4() && iface.ip.toString() !== "0.0.0.0";
        if (this._ipv4EnableCb) this._ipv4EnableCb.checked = v4Active;
        if (this._ipInput)  this._ipInput.value  = v4Active ? ipToStr(iface.ip) : "";
        const p = Number(iface.prefixLength ?? 0) | 0;
        if (this._cidrInput) this._cidrInput.value = v4Active ? String(p) : "";
        if (this._maskInput) this._maskInput.value = v4Active ? prefixToNetmaskStr(p) : "";

        // IPv6
        const v6Active = iface.ip6 != null;
        if (this._ipv6EnableCb)  this._ipv6EnableCb.checked  = v6Active;
        if (this._ip6Input)     this._ip6Input.value     = v6Active ? ipToStr(iface.ip6) : "";
        const p6 = Number(iface.prefixLength6 ?? 64) | 0;
        if (this._prefix6Input) this._prefix6Input.value = v6Active ? String(p6) : "";

        markInvalid(this._ipInput, false);
        markInvalid(this._maskInput, false);
        markInvalid(this._ip6Input, false);
        markInvalid(this._prefix6Input, false);
    }

    _updateInterfaceFormState() {
        const iface = this._getSelectedIface();
        const save = this._saveIfBtn;
        const ipIn = this._ipInput;
        const maskIn = this._maskInput;
        const cidrIn = this._cidrInput;
        const ip6In = this._ip6Input;
        const prefix6In = this._prefix6Input;

        if (!save || !ipIn || !maskIn || !cidrIn) return;
        if (!iface) { save.disabled = true; return; }

        const v4Active = this._ipv4EnableCb?.checked ?? false;
        const v6Active = this._ipv6EnableCb?.checked ?? false;

        // Show/hide IPv4 fields
        const v4Fields = /** @type {HTMLElement|null} */ (ipIn.closest('.router-if-fields'));
        if (v4Fields) v4Fields.style.display = v4Active ? '' : 'none';

        // Show/hide IPv6 fields
        const v6Fields = ip6In ? /** @type {HTMLElement|null} */ (ip6In.closest('.router-if-fields')) : null;
        if (v6Fields) v6Fields.style.display = v6Active ? '' : 'none';

        // --- Validate IPv4 ---
        let v4Ok = true;
        let v4Ip = null;
        let v4Prefix = 0;
        if (v4Active) {
            let ipOk = false;
            try { v4Ip = ipFromStr(ipIn.value); ipOk = v4Ip.isV4(); } catch { ipOk = false; }

            let pOk = false;
            const cidrTxt = cidrIn.value.trim();
            if (cidrTxt) {
                try { v4Prefix = assertPrefix(Number(cidrTxt)); pOk = true; } catch { /* */ }
            } else {
                const p = netmaskStrToPrefix(maskIn.value);
                if (p != null) { v4Prefix = p; pOk = true; }
            }
            markInvalid(ipIn, !ipOk);
            markInvalid(maskIn, !pOk);
            v4Ok = ipOk && pOk;
        } else {
            markInvalid(ipIn, false);
            markInvalid(maskIn, false);
        }

        // --- Validate IPv6 ---
        let v6Ok = true;
        let v6Ip = null;
        let v6Prefix = 64;
        if (v6Active && ip6In && prefix6In) {
            let ipOk = false;
            try { v6Ip = ipFromStr(ip6In.value); ipOk = v6Ip.isV6(); } catch { ipOk = false; }

            let pOk = true;
            const p6Txt = prefix6In.value.trim();
            if (p6Txt) {
                const n = Number(p6Txt);
                pOk = Number.isInteger(n) && n >= 0 && n <= 128;
                if (pOk) v6Prefix = n;
            }
            markInvalid(ip6In, !ipOk);
            markInvalid(prefix6In, !pOk);
            v6Ok = ipOk && pOk;
        } else if (ip6In && prefix6In) {
            markInvalid(ip6In, false);
            markInvalid(prefix6In, false);
        }

        if (!v4Ok || !v6Ok) { save.disabled = true; return; }

        // Dirty check
        const wasV4Active = iface.ip.isV4() && iface.ip.toString() !== "0.0.0.0";
        const wasV6Active = iface.ip6 != null;
        const v4Changed = v4Active !== wasV4Active
            || (v4Active && v4Ip && (v4Ip.toString() !== iface.ip.toString() || v4Prefix !== (iface.prefixLength | 0)));
        const v6Changed = v6Active !== wasV6Active
            || (v6Active && v6Ip && wasV6Active && iface.ip6 && (v6Ip.toString() !== iface.ip6.toString() || v6Prefix !== (iface.prefixLength6 | 0)))
            || (v6Active && v6Ip && !wasV6Active);

        save.disabled = !(v4Changed || v6Changed);
    }

    _applyInterfaceForm() {
        const iface = this._getSelectedIface();
        if (!iface) return;

        try {
            const idx = this._ifaceNameToIndex(iface.name);
            const v4Active = this._ipv4EnableCb?.checked ?? false;
            const v6Active = this._ipv6EnableCb?.checked ?? false;

            // --- Apply IPv4 ---
            if (v4Active) {
                const ip = ipFromStr(this._ipInput.value);
                if (!ip.isV4()) throw new Error("IPv4-Adresse erwartet.");
                const cidrTxt = this._cidrInput.value.trim();
                let prefix = 0;
                if (cidrTxt) {
                    prefix = assertPrefix(Number(cidrTxt));
                } else {
                    const p = netmaskStrToPrefix(this._maskInput.value);
                    if (p == null) throw new Error("Ungültige Netmask (nicht zusammenhängend?)");
                    prefix = p;
                }
                this.net.configureInterface(idx, { ip, prefixLength: prefix });
            } else {
                this.net.configureInterface(idx, { ip: IPAddress.fromString("0.0.0.0"), prefixLength: 0 });
            }

            // --- Apply IPv6 ---
            if (v6Active && this._ip6Input && this._prefix6Input) {
                const ip6 = ipFromStr(this._ip6Input.value);
                if (!ip6.isV6()) throw new Error("IPv6-Adresse erwartet.");
                const p6Txt = this._prefix6Input.value.trim();
                const prefix6 = p6Txt ? Number(p6Txt) : 64;
                if (!Number.isInteger(prefix6) || prefix6 < 0 || prefix6 > 128)
                    throw new Error("Ungültige IPv6-Prefix-Länge (0..128).");
                this.net.configureInterface(idx, { ip6, prefixLength6: prefix6 });
            } else {
                this.net.configureInterface(idx, { ip6: null });
            }

            if (this._panelBody) this.mount(this._panelBody);
            else this._renderRoutes();
        } catch (e) {
            SimDialog.alert(String(e?.message ?? e));
        }
    }

    /* ----------------------------- routes UI ---------------------------- */

    _renderRoutes() {
        if (this._selectedRouteFamily === 6) {
            this._renderRoutesV6();
        } else {
            this._renderRoutesV4();
        }
    }

    _renderRoutesV4() {
        if (!this._routesHost) return;
        this._routesHost.innerHTML = "";

        const table = document.createElement("table");
        table.className = "router-routes-table";

        const thead = document.createElement("thead");
        thead.innerHTML =
            "<tr>" +
            "<th>" + t("router.routingtable.dst") + "</th>" +
            "<th>" + t("router.routingtable.netmask") + "</th>" +
            "<th>" + t("router.routingtable.nexthop") + "</th>" +
            "<th>" + t("router.routingtable.interface") + "</th>" +
            "<th>" + t("router.routingtable.auto") + "</th>" +
            "<th>" + t("router.routingtable.actions") + "</th>" +
            "</tr>";
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const routes = this.net.routingTable ?? [];

        routes.forEach((r, idx) => {
            if (r.dst?.isV6?.()) return; // skip IPv6 routes in IPv4 tab

            const tr = document.createElement("tr");
            tr.className = "router-route-row";
            tr.dataset.auto = String(!!r.auto);
            tr.classList.add(r.auto ? "router-route-auto" : "router-route-manual");

            const auto = !!r.auto;

            const dst = document.createElement("input");
            dst.value = ipToStr(r.dst);
            dst.disabled = auto;

            const mask = document.createElement("input");
            mask.value = prefixToNetmaskStr(Number(r.prefixLength ?? 0));
            mask.disabled = auto;

            const nh = document.createElement("input");
            nh.value = ipToStr(r.nexthop);
            nh.disabled = auto;

            const autoTd = document.createElement("td");
            autoTd.textContent = auto ? t("router.routingtable.yes") : t("router.routingtable.no");

            const save = document.createElement("button");
            save.textContent = t("router.routingtable.save");
            save.disabled = true;

            const del = document.createElement("button");
            del.textContent = t("router.routingtable.delete");
            del.disabled = auto;

            // interface cell
            let ifCellEl;
            /** @type {HTMLSelectElement|null} */
            let ifSel = null;

            if (r.interf === -1) {
                const span = document.createElement("span");
                span.textContent = "lo";
                span.style.opacity = "0.8";
                ifCellEl = span;
            } else {
                ifSel = document.createElement("select");
                ifSel.disabled = auto;

                for (const iface of this.net.interfaces) {
                    const o = document.createElement("option");
                    o.value = iface.name;
                    o.textContent = iface.name;
                    ifSel.appendChild(o);
                }

                if (this.net.interfaces[r.interf]) {
                    ifSel.value = this.net.interfaces[r.interf].name;
                } else {
                    const bad = document.createElement("option");
                    bad.value = "";
                    bad.textContent = "(" + t("router.routingtable.missing") + ")";
                    ifSel.insertBefore(bad, ifSel.firstChild);
                    ifSel.value = "";
                }

                ifCellEl = ifSel;
            }

            /** @param {boolean} on */
            const setDirty = (on) => tr.classList.toggle("router-route-dirty", !!on);

            const computeCanSave = () => {
                if (auto) return false;
                if (r.interf !== -1 && ifSel && !ifSel.value) return false;

                let okDst = false, okMask = false, okNh = false;
        /** @type {IPAddress|null} */ let dstIp = null;
        /** @type {IPAddress|null} */ let nhIp = null;
                let pref = 0;

                try {
                    dstIp = ipFromStr(dst.value);
                    okDst = dstIp.isV4();
                } catch {
                    okDst = false;
                }

                try {
                    const p = netmaskStrToPrefix(mask.value);
                    if (p == null) okMask = false;
                    else {
                        pref = p;
                        okMask = true;
                    }
                } catch {
                    okMask = false;
                }

                try {
                    nhIp = ipFromStr(nh.value);
                    okNh = nhIp.isV4();
                } catch {
                    okNh = false;
                }

                markInvalid(dst, !okDst);
                markInvalid(mask, !okMask);
                markInvalid(nh, !okNh);

                if (!okDst || !okMask || !okNh || !dstIp || !nhIp) {
                    setDirty(true);
                    return false;
                }

                let interfDirty = false;
                let newInterf = r.interf;
                if (r.interf !== -1 && ifSel) {
                    newInterf = this._ifaceNameToIndex(ifSel.value);
                    interfDirty = (newInterf !== r.interf);
                }

                const dirty =
                    dstIp.toString() !== r.dst.toString() ||
                    (Number(pref) | 0) !== (Number(r.prefixLength ?? 0) | 0) ||
                    nhIp.toString() !== r.nexthop.toString() ||
                    interfDirty;

                setDirty(dirty);
                return dirty;
            };

            const updateRowState = () => {
                save.disabled = !computeCanSave();
            };

            dst.addEventListener("input", updateRowState);
            mask.addEventListener("input", updateRowState);
            nh.addEventListener("input", updateRowState);
            if (ifSel) ifSel.addEventListener("change", updateRowState);

            save.addEventListener("click", () => {
                if (save.disabled) return;

                const old = this.net.routingTable[idx];
                if (old.auto) return;

                try {
                    const newDst = ipFromStr(dst.value);
                    if (!newDst.isV4()) throw new Error("Nur IPv4 (vorerst).");

                    const p = netmaskStrToPrefix(mask.value);
                    if (p == null) throw new Error("Ungültige Netmask");

                    const newNh = ipFromStr(nh.value);
                    if (!newNh.isV4()) throw new Error("Nur IPv4 (vorerst).");

                    let newInterf = old.interf;
                    if (old.interf !== -1 && ifSel) {
                        if (!ifSel.value) throw new Error("missing interface or route points to a deleted interface");
                        newInterf = this._ifaceNameToIndex(ifSel.value);
                    }

                    this.net.delRoute(old.dst, old.prefixLength, old.interf, old.nexthop);
                    this.net.addRoute(newDst, p, newInterf, newNh);

                    this._renderRoutes();
                } catch (e) {
                    SimDialog.alert(String(e?.message ?? e));
                }
            });

            del.addEventListener("click", () => {
                const old = this.net.routingTable[idx];
                if (old.auto) return;

                this.net.delRoute(old.dst, old.prefixLength, old.interf, old.nexthop);
                this._renderRoutes();
            });

            /** @param {HTMLElement} el */
            const td = (el) => {
                const tdd = document.createElement("td");
                tdd.appendChild(el);
                return tdd;
            };

            tr.appendChild(td(dst));
            tr.appendChild(td(mask));
            tr.appendChild(td(nh));
            tr.appendChild(td(ifCellEl));
            tr.appendChild(autoTd);

            const actions = document.createElement("td");
            actions.className = "router-route-actions";
            actions.appendChild(save);
            actions.appendChild(del);
            tr.appendChild(actions);

            tbody.appendChild(tr);
            updateRowState();
        });

        // ---- Add Route row ----
        const addTr = document.createElement("tr");
        addTr.className = "router-route-add-row";

        const addDst = document.createElement("input");
        addDst.placeholder = "0.0.0.0";

        const addMask = document.createElement("input");
        addMask.placeholder = "255.255.255.0";

        const addNh = document.createElement("input");
        addNh.placeholder = "0.0.0.0";

        const addIf = document.createElement("select");
        for (const iface of this.net.interfaces) {
            const o = document.createElement("option");
            o.value = iface.name;
            o.textContent = iface.name;
            addIf.appendChild(o);
        }

        const hasIfaces = this.net.interfaces.length > 0;
        addIf.disabled = !hasIfaces;

        const addAuto = document.createElement("td");
        addAuto.textContent = t("router.routingtable.no");

        const addBtn = document.createElement("button");
        addBtn.textContent = t("router.routingtable.add");

        const markAddDirty = () => {
            const any = addDst.value.trim() !== "" || addMask.value.trim() !== "" || addNh.value.trim() !== "";
            addTr.classList.toggle("router-route-add-dirty", any);
        };

        const updateAddState = () => {
            if (!hasIfaces) {
                addBtn.disabled = true;
                return;
            }

            markAddDirty();

            let okDst = false, okMask = false, okNh = false;

            try { const ip = ipFromStr(addDst.value || "0.0.0.0"); okDst = ip.isV4(); } catch { okDst = false; }
            try { const p = netmaskStrToPrefix(addMask.value || "0.0.0.0"); okMask = (p != null); } catch { okMask = false; }
            try { const ip = ipFromStr(addNh.value || "0.0.0.0"); okNh = ip.isV4(); } catch { okNh = false; }

            markInvalid(addDst, !okDst);
            markInvalid(addMask, !okMask);
            markInvalid(addNh, !okNh);

            addBtn.disabled = !(okDst && okMask && okNh);
        };

        addDst.addEventListener("input", updateAddState);
        addMask.addEventListener("input", updateAddState);
        addNh.addEventListener("input", updateAddState);
        addIf.addEventListener("change", updateAddState);

        addBtn.addEventListener("click", () => {
            if (addBtn.disabled) return;

            try {
                const dstIp = ipFromStr(addDst.value || "0.0.0.0");
                if (!dstIp.isV4()) throw new Error("Nur IPv4 (vorerst).");

                const p = netmaskStrToPrefix(addMask.value || "0.0.0.0");
                if (p == null) throw new Error("Ungültige Netmask");

                const nhIp = ipFromStr(addNh.value || "0.0.0.0");
                if (!nhIp.isV4()) throw new Error("Nur IPv4 (vorerst).");

                const interfN = this._ifaceNameToIndex(addIf.value);
                this.net.addRoute(dstIp, p, interfN, nhIp);

                this._renderRoutes();
            } catch (e) {
                SimDialog.alert(String(e?.message ?? e));
            }
        });

        /** @param {HTMLElement} el */
        const td2 = (el) => {
            const tdd = document.createElement("td");
            tdd.appendChild(el);
            return tdd;
        };

        addTr.appendChild(td2(addDst));
        addTr.appendChild(td2(addMask));
        addTr.appendChild(td2(addNh));
        addTr.appendChild(td2(addIf));
        addTr.appendChild(addAuto);

        const addActions = document.createElement("td");
        addActions.className = "router-route-actions";
        addActions.appendChild(addBtn);
        addTr.appendChild(addActions);

        tbody.appendChild(addTr);

        table.appendChild(tbody);
        this._routesHost.appendChild(table);

        addBtn.disabled = !hasIfaces;
        updateAddState();
    }

    _renderRoutesV6() {
        if (!this._routesHost) return;
        this._routesHost.innerHTML = "";

        const table = document.createElement("table");
        table.className = "router-routes-table";

        const thead = document.createElement("thead");
        thead.innerHTML =
            "<tr>" +
            "<th>" + t("router.routingtable.dst") + "</th>" +
            "<th>" + t("router.routingtable.prefix") + "</th>" +
            "<th>" + t("router.routingtable.nexthop") + "</th>" +
            "<th>" + t("router.routingtable.interface") + "</th>" +
            "<th>" + t("router.routingtable.auto") + "</th>" +
            "<th>" + t("router.routingtable.actions") + "</th>" +
            "</tr>";
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const routes = this.net.routingTable ?? [];

        routes.forEach((r, idx) => {
            if (!r.dst?.isV6?.()) return; // only IPv6

            const auto = !!r.auto;

            const dst = document.createElement("input");
            dst.value = ipToStr(r.dst);
            dst.disabled = auto;

            const prefix = document.createElement("input");
            prefix.value = String(r.prefixLength ?? 0);
            prefix.disabled = auto;
            prefix.style.width = "4em";

            const nh = document.createElement("input");
            nh.value = ipToStr(r.nexthop);
            nh.disabled = auto;

            const autoTd = document.createElement("td");
            autoTd.textContent = auto ? t("router.routingtable.yes") : t("router.routingtable.no");

            const save = document.createElement("button");
            save.textContent = t("router.routingtable.save");
            save.disabled = true;

            const del = document.createElement("button");
            del.textContent = t("router.routingtable.delete");
            del.disabled = auto;

            let ifCellEl;
            /** @type {HTMLSelectElement|null} */
            let ifSel = null;

            if (r.interf === -1) {
                const span = document.createElement("span");
                span.textContent = "lo";
                span.style.opacity = "0.8";
                ifCellEl = span;
            } else {
                ifSel = document.createElement("select");
                ifSel.disabled = auto;
                for (const iface of this.net.interfaces) {
                    const o = document.createElement("option");
                    o.value = iface.name;
                    o.textContent = iface.name;
                    ifSel.appendChild(o);
                }
                if (this.net.interfaces[r.interf]) {
                    ifSel.value = this.net.interfaces[r.interf].name;
                } else {
                    const bad = document.createElement("option");
                    bad.value = "";
                    bad.textContent = "(" + t("router.routingtable.missing") + ")";
                    ifSel.insertBefore(bad, ifSel.firstChild);
                    ifSel.value = "";
                }
                ifCellEl = ifSel;
            }

            const computeCanSave = () => {
                if (auto) return false;
                let okDst = false, okPfx = false, okNh = false;
                try { const ip = ipFromStr(dst.value); okDst = ip.isV6(); } catch { okDst = false; }
                try { const n = Number(prefix.value); okPfx = Number.isInteger(n) && n >= 0 && n <= 128; } catch { okPfx = false; }
                try { const ip = ipFromStr(nh.value); okNh = ip.isV6(); } catch { okNh = false; }
                markInvalid(dst, !okDst);
                markInvalid(prefix, !okPfx);
                markInvalid(nh, !okNh);
                return okDst && okPfx && okNh;
            };

            const updateRowState = () => { save.disabled = !computeCanSave(); };

            dst.addEventListener("input", updateRowState);
            prefix.addEventListener("input", updateRowState);
            nh.addEventListener("input", updateRowState);
            if (ifSel) ifSel.addEventListener("change", updateRowState);

            save.addEventListener("click", () => {
                if (save.disabled) return;
                const old = this.net.routingTable[idx];
                if (old.auto) return;
                try {
                    const newDst = ipFromStr(dst.value);
                    if (!newDst.isV6()) throw new Error("IPv6-Adresse erwartet.");
                    const p = Number(prefix.value);
                    if (!Number.isInteger(p) || p < 0 || p > 128) throw new Error("Ungültige Prefix-Länge.");
                    const newNh = ipFromStr(nh.value);
                    if (!newNh.isV6()) throw new Error("IPv6-Adresse erwartet.");
                    let newInterf = old.interf;
                    if (old.interf !== -1 && ifSel) {
                        if (!ifSel.value) throw new Error("Schnittstelle fehlt.");
                        newInterf = this._ifaceNameToIndex(ifSel.value);
                    }
                    this.net.delRoute(old.dst, old.prefixLength, old.interf, old.nexthop);
                    this.net.addRoute(newDst, p, newInterf, newNh);
                    this._renderRoutes();
                } catch (e) {
                    SimDialog.alert(String(e?.message ?? e));
                }
            });

            del.addEventListener("click", () => {
                const old = this.net.routingTable[idx];
                if (old.auto) return;
                this.net.delRoute(old.dst, old.prefixLength, old.interf, old.nexthop);
                this._renderRoutes();
            });

            /** @param {HTMLElement} el */
            const td = (el) => { const tdd = document.createElement("td"); tdd.appendChild(el); return tdd; };
            const tr = document.createElement("tr");
            tr.className = "router-route-row " + (auto ? "router-route-auto" : "router-route-manual");
            tr.appendChild(td(dst));
            tr.appendChild(td(prefix));
            tr.appendChild(td(nh));
            tr.appendChild(td(ifCellEl));
            tr.appendChild(autoTd);
            const actions = document.createElement("td");
            actions.className = "router-route-actions";
            actions.appendChild(save);
            actions.appendChild(del);
            tr.appendChild(actions);
            tbody.appendChild(tr);
            updateRowState();
        });

        // ---- Add Route row (IPv6) ----
        const addTr = document.createElement("tr");
        addTr.className = "router-route-add-row";

        const addDst = document.createElement("input");
        addDst.placeholder = "::";

        const addPrefix = document.createElement("input");
        addPrefix.placeholder = "64";
        addPrefix.style.width = "4em";

        const addNh = document.createElement("input");
        addNh.placeholder = "::";

        const addIf = document.createElement("select");
        for (const iface of this.net.interfaces) {
            const o = document.createElement("option");
            o.value = iface.name;
            o.textContent = iface.name;
            addIf.appendChild(o);
        }
        const hasIfaces = this.net.interfaces.length > 0;
        addIf.disabled = !hasIfaces;

        const addAuto = document.createElement("td");
        addAuto.textContent = t("router.routingtable.no");

        const addBtn = document.createElement("button");
        addBtn.textContent = t("router.routingtable.add");

        const updateAddState = () => {
            if (!hasIfaces) { addBtn.disabled = true; return; }
            let okDst = false, okPfx = false, okNh = false;
            try { const ip = ipFromStr(addDst.value || "::"); okDst = ip.isV6(); } catch { okDst = false; }
            try { const n = Number(addPrefix.value || "0"); okPfx = Number.isInteger(n) && n >= 0 && n <= 128; } catch { okPfx = false; }
            try { const ip = ipFromStr(addNh.value || "::"); okNh = ip.isV6(); } catch { okNh = false; }
            markInvalid(addDst, !okDst);
            markInvalid(addPrefix, !okPfx);
            markInvalid(addNh, !okNh);
            addBtn.disabled = !(okDst && okPfx && okNh);
        };

        addDst.addEventListener("input", updateAddState);
        addPrefix.addEventListener("input", updateAddState);
        addNh.addEventListener("input", updateAddState);
        addIf.addEventListener("change", updateAddState);

        addBtn.addEventListener("click", () => {
            if (addBtn.disabled) return;
            try {
                const dstIp = ipFromStr(addDst.value || "::");
                if (!dstIp.isV6()) throw new Error("IPv6-Adresse erwartet.");
                const p = Number(addPrefix.value || "0");
                if (!Number.isInteger(p) || p < 0 || p > 128) throw new Error("Ungültige Prefix-Länge.");
                const nhIp = ipFromStr(addNh.value || "::");
                if (!nhIp.isV6()) throw new Error("IPv6-Adresse erwartet.");
                const interfN = this._ifaceNameToIndex(addIf.value);
                this.net.addRoute(dstIp, p, interfN, nhIp);
                this._renderRoutes();
            } catch (e) {
                SimDialog.alert(String(e?.message ?? e));
            }
        });

        /** @param {HTMLElement} el */
        const td2 = (el) => { const tdd = document.createElement("td"); tdd.appendChild(el); return tdd; };
        addTr.appendChild(td2(addDst));
        addTr.appendChild(td2(addPrefix));
        addTr.appendChild(td2(addNh));
        addTr.appendChild(td2(addIf));
        addTr.appendChild(addAuto);
        const addActions = document.createElement("td");
        addActions.className = "router-route-actions";
        addActions.appendChild(addBtn);
        addTr.appendChild(addActions);
        tbody.appendChild(addTr);

        table.appendChild(tbody);
        this._routesHost.appendChild(table);

        addBtn.disabled = !hasIfaces;
        updateAddState();
    }
}
