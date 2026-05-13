//@ts-check

import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { IPStack } from "../net/IPStack.js";
import { VLANSubInterface } from "../net/NetworkInterface.js";
import { RIPDaemon } from "../net/RIPDaemon.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { PollTimer } from "../lib/PollTimer.js";
import { netmaskStrToPrefix, prefixToNetmaskStr } from "../lib/helpers.js";

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


/** deterministic via EthernetPort.linkref @param {*} iface */
function getInterfaceLinkStatus(iface) {
    // Subinterfaces use the parent's physical port for link state
    const port = (iface instanceof VLANSubInterface ? iface._parentIface?.port : iface?.port);
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

    _pollTimer = new PollTimer();

    /** @type {string|null} */
    _selectedIfaceName = null;

  // UI refs
  /** @type {HTMLDivElement|null} */ _tabsBar = null;

    /** @type {Map<string, {btn: HTMLButtonElement, badge: HTMLSpanElement}>} */
    _tabRefs = new Map();

  /** @type {HTMLDivElement|null} */ _ifacePanel = null;
  /** @type {HTMLDivElement|null} */ _ifaceActionsHost = null;

  /** @type {HTMLInputElement|null} */ _ipInput = null;
  /** @type {HTMLInputElement|null} */ _maskInput = null;
  /** @type {HTMLInputElement|null} */ _cidrInput = null;
  /** @type {HTMLInputElement|null} */ _ip6Input = null;
  /** @type {HTMLInputElement|null} */ _prefix6Input = null;
  /** @type {HTMLInputElement|null} */ _ipv4EnableCb = null;
  /** @type {HTMLInputElement|null} */ _ipv6EnableCb = null;
  /** @type {HTMLInputElement|null} */ _raEnabledCb = null;
  /** @type {HTMLButtonElement|null} */ _saveIfBtn = null;
  /** @type {HTMLButtonElement|null} */ _delIfBtn = null;

  /** @type {HTMLDivElement|null} */ _routesHost = null;
  /** @type {number} */ _selectedRouteFamily = 4;

  /** @type {RIPDaemon} */
  rip;
  /** @type {HTMLTextAreaElement|null} */ _ripLogEl = null;

    constructor(name = t("router.title")) {
        super((name = t("router.title")));
        this.net = new IPStack(2, name);
        this.net.forwarding = true;
        this.fs = new VirtualFileSystem();
        this.rip = new RIPDaemon(this.net);

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
            rip: this.rip.toJSON(),
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Router(n.name ?? "Router");
        obj._applyBaseJSON(n);
        if (n.net) obj.net = IPStack.fromJSON(n.net);
        obj.rip = new RIPDaemon(obj.net);
        if (n.rip) obj.rip.applyJSON(n.rip);
        return obj;
    }

    /** @returns {PortDescriptor[]} */
    listPorts()           { return SimulatedObject.listEthPorts(this.net?.interfaces); }
    /** @param {string} key */
    getPortByKey(key)     { return SimulatedObject.getEthPortByKey(this.net?.interfaces, key); }

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

        const { bar: outerTabBar, setActive: setOuterActive } = DOMBuilder.tabGroup([
            { id: "interfaces", label: t("router.interfaces")        },
            { id: "routes-v4",  label: t("router.routingtable.ipv4") },
            { id: "routes-v6",  label: t("router.routingtable.ipv6") },
            { id: "rip",        label: t("router.rip.tab")            },
            { id: "vpn",        label: t("router.vpn.tab")            },
        ], (id) => {
            ifSection.style.display    = id === "interfaces" ? "" : "none";
            routeSection.style.display = (id === "routes-v4" || id === "routes-v6") ? "" : "none";
            ripSection.style.display   = id === "rip" ? "" : "none";
            vpnSection.style.display   = id === "vpn"  ? "" : "none";
            if (id === "routes-v4") { routeTitle.textContent = t("router.routingtable.ipv4"); this._selectedRouteFamily = 4; this._renderRoutes(); }
            if (id === "routes-v6") { routeTitle.textContent = t("router.routingtable.ipv6"); this._selectedRouteFamily = 6; this._renderRoutes(); }
        });
        card.appendChild(outerTabBar);

        const outerContent = DOMBuilder.div("");
        outerContent.style.padding = "8px";
        card.appendChild(outerContent);

        /* ============================ Interfaces ============================ */
        const ifSection = DOMBuilder.div("");
        ifSection.appendChild(DOMBuilder.h4(t("router.interfaces")));

        const tabsBar = DOMBuilder.div("ui-tabbar");
        this._tabsBar = tabsBar;

        const ifacePanel = DOMBuilder.div("router-if-panel");
        this._ifacePanel = ifacePanel;

        // --- IPv4 Section ---
        const v4Cb = DOMBuilder.input({ type: "checkbox" });
        const v4Header = DOMBuilder.div("router-if-section-header", [
            v4Cb,
            DOMBuilder.el("span", { text: "IPv4", className: "router-if-section-label" }),
        ]);
        const ipIn   = DOMBuilder.input({ placeholder: "192.168.1.1" });
        const maskIn = DOMBuilder.input({ placeholder: "255.255.255.0" });
        const cidrIn = DOMBuilder.input({ placeholder: "24" });
        const ifField = (/** @type {string} */ cls, /** @type {string} */ label, /** @type {HTMLElement} */ inp) => DOMBuilder.div("router-if-field " + cls, [
            DOMBuilder.el("span", { text: label, className: "router-if-field-label" }),
            inp,
        ]);
        const v4Fields = DOMBuilder.div("router-if-fields", [
            ifField("router-if-ip",   t("router.if.address"), ipIn),
            ifField("router-if-mask", t("router.if.netmask"), maskIn),
            ifField("router-if-cidr", t("router.if.prefix"),  cidrIn),
        ]);
        const v4Section = DOMBuilder.div("router-if-section", [v4Header, v4Fields]);

        // --- IPv6 Section ---
        const v6Cb = DOMBuilder.input({ type: "checkbox" });
        const v6Header = DOMBuilder.div("router-if-section-header", [
            v6Cb,
            DOMBuilder.el("span", { text: "IPv6", className: "router-if-section-label" }),
        ]);
        const ip6In     = DOMBuilder.input({ placeholder: "2001:db8::1" });
        const prefix6In = DOMBuilder.input({ placeholder: "64" });
        const raCb    = DOMBuilder.input({ type: "checkbox" });
        const raLabel = DOMBuilder.el("label", { className: "router-if-ra-label" });
        raLabel.append(raCb, " " + t("router.ra.enabled"));
        const v6Fields = DOMBuilder.div("router-if-fields", [
            ifField("router-if-ip6",     t("router.if.address"), ip6In),
            ifField("router-if-prefix6", t("router.if.prefix"),  prefix6In),
        ]);
        const v6Body = DOMBuilder.div("router-if-v6-body", [
            v6Fields,
            DOMBuilder.div("router-if-fields", [raLabel]),
        ]);
        const v6Section = DOMBuilder.div("router-if-section", [v6Header, v6Body]);

        const saveBtn = DOMBuilder.button(t("router.save"), { className: "router-if-save" });

        this._ipInput      = ipIn;
        this._maskInput    = maskIn;
        this._cidrInput    = cidrIn;
        this._ip6Input     = ip6In;
        this._prefix6Input = prefix6In;
        this._raEnabledCb  = raCb;
        this._ipv4EnableCb = v4Cb;
        this._ipv6EnableCb = v6Cb;
        this._saveIfBtn    = saveBtn;

        ifacePanel.append(v4Section, v6Section, saveBtn);

        const actionsHost = DOMBuilder.div("router-if-actions");
        this._ifaceActionsHost = actionsHost;
        ifacePanel.appendChild(actionsHost);

        ifSection.append(tabsBar, ifacePanel);

        /* =========================== Routingtabelle ========================== */
        const routeSection = DOMBuilder.div("");

        const routeTitle = DOMBuilder.h4("");
        routeSection.appendChild(routeTitle);

        const routesHost = DOMBuilder.div("router-routes");
        this._routesHost = routesHost;
        routeSection.appendChild(routesHost);

        /* ================================ RIP ================================= */
        const ripSection = DOMBuilder.div("");
        this._buildRIPSection(ripSection);

        /* ================================ VPN ================================= */
        const vpnSection = DOMBuilder.div("");
        this._buildVPNSection(vpnSection);

        outerContent.append(ifSection, routeSection, ripSection, vpnSection);

        /* ============================ Tab switching ============================ */
        ifSection.style.display = "";
        routeSection.style.display = "none";
        ripSection.style.display = "none";
        vpnSection.style.display = "none";
        setOuterActive("interfaces");

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
            const btn = DOMBuilder.button("", { className: "ui-tab" });
            btn.dataset.name = iface.name;

            const label = DOMBuilder.el("span", { className: "router-tab-label", text: iface.name });
            const badge = DOMBuilder.el("span", { className: "ui-tab-badge status-unknown", text: t("router.unknown") });

            btn.appendChild(label);
            btn.appendChild(badge);

            btn.addEventListener("click", () => {
                this._selectedIfaceName = iface.name;
                this._applyTabSelection();
                this._renderInterfaceActions();
                this._loadSelectedInterfaceIntoForm();
                this._updateInterfaceFormState();
            });

            tabsBar.appendChild(btn);
            this._tabRefs.set(iface.name, { btn, badge });
        }

        const plusBtn = DOMBuilder.button("+", { className: "ui-tab router-tab-plus", title: t("router.addinterface") });
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

        const iface = this._getSelectedIface();
        const isSub = iface instanceof VLANSubInterface;

        if (!isSub) {
            const subBtn = DOMBuilder.button("+ VLAN", { className: "router-if-addsub" });
            subBtn.title = "Add VLAN subinterface";
            subBtn.addEventListener("click", async () => {
                const name = this._selectedIfaceName;
                if (!name) return;
                const raw = await SimDialog.prompt("VLAN ID (1–4094):", "10");
                if (raw == null || raw.trim() === "") return;
                const vid = Number(raw.trim());
                try {
                    this.net.addSubInterface(name, vid);
                    this._selectedIfaceName = `${name}.${vid}`;
                    if (this._panelBody) this.mount(this._panelBody);
                } catch (e) {
                    SimDialog.alert(String(e?.message ?? e));
                }
            });
            actionsHost.appendChild(subBtn);
        }

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
        if (this._raEnabledCb) this._raEnabledCb.addEventListener("change", onInput);

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
        if (this._raEnabledCb) this._raEnabledCb.disabled = !has;
        if (this._ipv4EnableCb) this._ipv4EnableCb.disabled = !has;
        if (this._ipv6EnableCb) this._ipv6EnableCb.disabled = !has;
        if (this._saveIfBtn) this._saveIfBtn.disabled = !has;
        if (this._delIfBtn) this._delIfBtn.disabled = !has;

    }

    _startLinkPolling() {
        this._updateAllTabStatuses();
        this._pollTimer.start(() => this._updateAllTabStatuses(), 1000);
    }

    _stopLinkPolling() {
        this._pollTimer.stop();
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
            DOMBuilder.markInvalid(this._ipInput, false);
            DOMBuilder.markInvalid(this._maskInput, false);
            DOMBuilder.markInvalid(this._ip6Input, false);
            DOMBuilder.markInvalid(this._prefix6Input, false);
            return;
        }

        // IPv4
        const v4Active = iface.ip.isV4() && iface.ip.toString() !== "0.0.0.0";
        if (this._ipv4EnableCb) this._ipv4EnableCb.checked = v4Active;
        if (this._ipInput)  this._ipInput.value  = v4Active ? ipToStr(iface.ip) : "";
        const p = Number(iface.prefixLength ?? 0) | 0;
        if (this._cidrInput) this._cidrInput.value = v4Active ? String(p) : "";
        if (this._maskInput) this._maskInput.value = v4Active ? prefixToNetmaskStr(p) : "";

        // IPv6 — use tentativeIp6 while DAD is still running so the form doesn't flicker
        const effectiveIp6 = iface.ip6 ?? iface._tentativeIp6;
        const v6Active = effectiveIp6 != null;
        if (this._ipv6EnableCb)  this._ipv6EnableCb.checked  = v6Active;
        if (this._ip6Input)      this._ip6Input.value         = v6Active ? ipToStr(effectiveIp6) : "";
        const p6 = Number(iface.prefixLength6 ?? 64) | 0;
        if (this._prefix6Input)  this._prefix6Input.value     = v6Active ? String(p6) : "";
        if (this._raEnabledCb)   this._raEnabledCb.checked    = !!iface.raEnabled;

        DOMBuilder.markInvalid(this._ipInput, false);
        DOMBuilder.markInvalid(this._maskInput, false);
        DOMBuilder.markInvalid(this._ip6Input, false);
        DOMBuilder.markInvalid(this._prefix6Input, false);
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

        // Show/hide IPv6 fields (including RA checkbox)
        const v6Body = ip6In ? /** @type {HTMLElement|null} */ (ip6In.closest('.router-if-v6-body')) : null;
        if (v6Body) v6Body.style.display = v6Active ? '' : 'none';

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
            DOMBuilder.markInvalid(ipIn, !ipOk);
            DOMBuilder.markInvalid(maskIn, !pOk);
            v4Ok = ipOk && pOk;
        } else {
            DOMBuilder.markInvalid(ipIn, false);
            DOMBuilder.markInvalid(maskIn, false);
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
            DOMBuilder.markInvalid(ip6In, !ipOk);
            DOMBuilder.markInvalid(prefix6In, !pOk);
            v6Ok = ipOk && pOk;
        } else if (ip6In && prefix6In) {
            DOMBuilder.markInvalid(ip6In, false);
            DOMBuilder.markInvalid(prefix6In, false);
        }

        if (!v4Ok || !v6Ok) { save.disabled = true; return; }

        // Dirty check
        const wasV4Active = iface.ip.isV4() && iface.ip.toString() !== "0.0.0.0";
        const wasV6Active = (iface.ip6 ?? iface._tentativeIp6) != null;
        const v4Changed = v4Active !== wasV4Active
            || (v4Active && v4Ip && (v4Ip.toString() !== iface.ip.toString() || v4Prefix !== (iface.prefixLength | 0)));
        const raChanged = (this._raEnabledCb?.checked ?? false) !== !!iface.raEnabled;
        const currentIp6 = iface.ip6 ?? iface._tentativeIp6;
        const v6Changed = v6Active !== wasV6Active
            || (v6Active && v6Ip && wasV6Active && currentIp6 && (v6Ip.toString() !== currentIp6.toString() || v6Prefix !== (iface.prefixLength6 | 0)))
            || (v6Active && v6Ip && !wasV6Active)
            || raChanged;

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

            this.net.configureInterface(idx, { raEnabled: this._raEnabledCb?.checked ?? false });

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

            if (r.tunnel) {
                const span = document.createElement("span");
                span.textContent = "tun:" + r.tunnel.name;
                span.style.opacity = "0.8";
                ifCellEl = span;
                save.disabled = true;
            } else if (r.interf === -1) {
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

                DOMBuilder.markInvalid(dst, !okDst);
                DOMBuilder.markInvalid(mask, !okMask);
                DOMBuilder.markInvalid(nh, !okNh);

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

                if (old.tunnel) {
                    this.net.delTunnelRoute(old.dst, old.prefixLength, old.tunnel.name);
                } else {
                    this.net.delRoute(old.dst, old.prefixLength, old.interf, old.nexthop);
                }
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

        table.appendChild(tbody);
        this._routesHost.appendChild(table);

        // ---- Footer: "+ Route hinzufügen" button ----
        const hasIfaces = this.net.interfaces.length > 0;
        const footerBtn = DOMBuilder.button("+ " + t("router.routingtable.add"), { className: "router-route-footer-btn" });
        footerBtn.disabled = !hasIfaces;
        this._routesHost.appendChild(footerBtn);

        footerBtn.addEventListener("click", () => {
            footerBtn.style.display = "none";

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
            addIf.disabled = !hasIfaces;

            const addAuto = document.createElement("td");
            addAuto.textContent = t("router.routingtable.no");

            const saveBtn = document.createElement("button");
            saveBtn.textContent = t("router.routingtable.save");
            saveBtn.disabled = true;

            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = t("ui.cancel");

            const updateAddState = () => {
                let okDst = false, okMask = false, okNh = false;
                try { const ip = ipFromStr(addDst.value || "0.0.0.0"); okDst = ip.isV4(); } catch { okDst = false; }
                try { const p = netmaskStrToPrefix(addMask.value || "0.0.0.0"); okMask = (p != null); } catch { okMask = false; }
                try { const ip = ipFromStr(addNh.value || "0.0.0.0"); okNh = ip.isV4(); } catch { okNh = false; }
                DOMBuilder.markInvalid(addDst, !okDst);
                DOMBuilder.markInvalid(addMask, !okMask);
                DOMBuilder.markInvalid(addNh, !okNh);
                saveBtn.disabled = !(okDst && okMask && okNh);
            };

            addDst.addEventListener("input", updateAddState);
            addMask.addEventListener("input", updateAddState);
            addNh.addEventListener("input", updateAddState);
            addIf.addEventListener("change", updateAddState);

            saveBtn.addEventListener("click", () => {
                if (saveBtn.disabled) return;
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

            cancelBtn.addEventListener("click", () => this._renderRoutes());

            /** @param {HTMLElement} el */
            const td2 = (el) => { const tdd = document.createElement("td"); tdd.appendChild(el); return tdd; };
            addTr.appendChild(td2(addDst));
            addTr.appendChild(td2(addMask));
            addTr.appendChild(td2(addNh));
            addTr.appendChild(td2(addIf));
            addTr.appendChild(addAuto);
            const addActions = document.createElement("td");
            addActions.className = "router-route-actions";
            addActions.appendChild(saveBtn);
            addActions.appendChild(cancelBtn);
            addTr.appendChild(addActions);
            tbody.appendChild(addTr);
            addDst.focus();
        });
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
                DOMBuilder.markInvalid(dst, !okDst);
                DOMBuilder.markInvalid(prefix, !okPfx);
                DOMBuilder.markInvalid(nh, !okNh);
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

        table.appendChild(tbody);
        this._routesHost.appendChild(table);

        // ---- Footer: "+ Route hinzufügen" button (IPv6) ----
        const hasIfaces = this.net.interfaces.length > 0;
        const footerBtn = DOMBuilder.button("+ " + t("router.routingtable.add"), { className: "router-route-footer-btn" });
        footerBtn.disabled = !hasIfaces;
        this._routesHost.appendChild(footerBtn);

        footerBtn.addEventListener("click", () => {
            footerBtn.style.display = "none";

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
            addIf.disabled = !hasIfaces;

            const addAuto = document.createElement("td");
            addAuto.textContent = t("router.routingtable.no");

            const saveBtn = document.createElement("button");
            saveBtn.textContent = t("router.routingtable.save");
            saveBtn.disabled = true;

            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = t("ui.cancel");

            const updateAddState = () => {
                let okDst = false, okPfx = false, okNh = false;
                try { const ip = ipFromStr(addDst.value || "::"); okDst = ip.isV6(); } catch { okDst = false; }
                try { const n = Number(addPrefix.value || "0"); okPfx = Number.isInteger(n) && n >= 0 && n <= 128; } catch { okPfx = false; }
                try { const ip = ipFromStr(addNh.value || "::"); okNh = ip.isV6(); } catch { okNh = false; }
                DOMBuilder.markInvalid(addDst, !okDst);
                DOMBuilder.markInvalid(addPrefix, !okPfx);
                DOMBuilder.markInvalid(addNh, !okNh);
                saveBtn.disabled = !(okDst && okPfx && okNh);
            };

            addDst.addEventListener("input", updateAddState);
            addPrefix.addEventListener("input", updateAddState);
            addNh.addEventListener("input", updateAddState);
            addIf.addEventListener("change", updateAddState);

            saveBtn.addEventListener("click", () => {
                if (saveBtn.disabled) return;
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

            cancelBtn.addEventListener("click", () => this._renderRoutes());

            /** @param {HTMLElement} el */
            const td2 = (el) => { const tdd = document.createElement("td"); tdd.appendChild(el); return tdd; };
            addTr.appendChild(td2(addDst));
            addTr.appendChild(td2(addPrefix));
            addTr.appendChild(td2(addNh));
            addTr.appendChild(td2(addIf));
            addTr.appendChild(addAuto);
            const addActions = document.createElement("td");
            addActions.className = "router-route-actions";
            addActions.appendChild(saveBtn);
            addActions.appendChild(cancelBtn);
            addTr.appendChild(addActions);
            tbody.appendChild(addTr);
            addDst.focus();
        });
    }

    /** @param {HTMLElement} host */
    _buildRIPSection(host) {
        host.appendChild(DOMBuilder.h4(t("router.rip.tab")));

        // ── global enable ──────────────────────────────────────────────────
        const enableCb = DOMBuilder.input({ type: "checkbox" });
        enableCb.checked = this.rip.enabled;
        enableCb.addEventListener("change", () => {
            this.rip.setEnabled(enableCb.checked);
            this._renderRIPLog();
        });
        const enableRow = DOMBuilder.div("router-name-row");
        enableRow.style.gap = "6px";
        enableRow.appendChild(enableCb);
        enableRow.appendChild(DOMBuilder.label(t("router.rip.enabled")));
        host.appendChild(enableRow);

        // ── per-interface passive toggles ──────────────────────────────────
        const ifTable = document.createElement("table");
        ifTable.className = "router-routes";
        ifTable.style.marginTop = "8px";
        const thead = document.createElement("thead");
        const htr   = document.createElement("tr");
        const thIf  = document.createElement("th"); thIf.textContent  = t("router.rip.col.interface");
        const thPas = document.createElement("th"); thPas.textContent = t("router.rip.col.passive");
        htr.append(thIf, thPas);
        thead.appendChild(htr);
        const tbody = document.createElement("tbody");

        for (const iface of this.net.interfaces) {
            const ifName = iface.name;
            const tr  = document.createElement("tr");
            const tdN = document.createElement("td"); tdN.textContent = ifName;
            const tdP = document.createElement("td");
            const cb  = DOMBuilder.input({ type: "checkbox" });
            cb.checked = this.rip.passiveInterfaces.has(ifName);
            cb.addEventListener("change", () => this.rip.setPassive(ifName, cb.checked));
            tdP.appendChild(cb);
            tr.append(tdN, tdP);
            tbody.appendChild(tr);
        }
        ifTable.append(thead, tbody);
        host.appendChild(ifTable);

        // ── log ───────────────────────────────────────────────────────────
        host.appendChild(DOMBuilder.h4(t("router.rip.log")));
        const logEl = /** @type {HTMLTextAreaElement} */ (DOMBuilder.el("textarea", {
            className: "log",
            attrs: { readonly: "true", spellcheck: "false" },
        }));
        logEl.style.width  = "100%";
        logEl.style.height = "140px";
        host.appendChild(logEl);
        this._ripLogEl = logEl;
        this._renderRIPLog();

        this.rip.onLogUpdate = () => this._renderRIPLog();
    }

    _renderRIPLog() {
        if (!this._ripLogEl) return;
        const lines = this.rip.log;
        const max   = 200;
        this._ripLogEl.value = (lines.length > max ? lines.slice(-max) : lines).join("\n");
        this._ripLogEl.scrollTop = this._ripLogEl.scrollHeight;
    }

    /* ----------------------------- VPN tab ----------------------------- */

    /** @param {HTMLElement} host */
    _buildVPNSection(host) {
        DOMBuilder.clear(host);
        host.appendChild(DOMBuilder.h4(t("router.vpn.tab")));

        const listEl = DOMBuilder.div("router-vpn-list");

        const renderList = () => {
            DOMBuilder.clear(listEl);
            if (this.net.tunnels.length === 0) {
                listEl.appendChild(DOMBuilder.el("p", { text: t("router.vpn.empty"), className: "router-vpn-empty" }));
                return;
            }
            for (const tun of this.net.tunnels) {
                const routes = this.net.routingTable.filter(r => r.tunnel === tun);
                const netStr = routes.map(r => `${r.dst}/${r.prefixLength}`).join(", ") || "—";

                const delBtn = DOMBuilder.button(t("router.vpn.delete"), { className: "router-vpn-del" });
                delBtn.addEventListener("click", () => {
                    this.net.removeTunnel(tun.name);
                    renderList();
                    this._renderRoutes();
                });

                const row = DOMBuilder.div("router-vpn-row", [
                    DOMBuilder.el("span", { text: tun.name,                      className: "router-vpn-name"   }),
                    DOMBuilder.el("span", { text: tun.remoteEndpoint.toString(),  className: "router-vpn-remote" }),
                    DOMBuilder.el("span", { text: netStr,                         className: "router-vpn-net"    }),
                    delBtn,
                ]);
                listEl.appendChild(row);
            }
        };

        renderList();
        host.appendChild(listEl);

        // ── Add-tunnel form ──
        const nameIn   = DOMBuilder.input({ placeholder: "vpn0" });
        const remoteIn = DOMBuilder.input({ placeholder: "203.0.113.1" });
        const netIn    = DOMBuilder.input({ placeholder: "10.0.0.0/24" });
        const errEl    = DOMBuilder.el("p", { className: "router-vpn-err" });
        const addBtn   = DOMBuilder.button(t("router.vpn.add"), { className: "router-vpn-add" });

        const mkRow = (/** @type {string} */ label, /** @type {HTMLElement} */ inp) =>
            DOMBuilder.div("router-vpn-form-row", [
                DOMBuilder.el("span", { text: label, className: "router-vpn-form-label" }),
                inp,
            ]);

        addBtn.addEventListener("click", () => {
            errEl.textContent = "";
            try {
                const name = nameIn.value.trim();
                if (!name) throw new Error(t("router.vpn.err.name"));

                let remote;
                try { remote = IPAddress.fromString(remoteIn.value.trim()); }
                catch { throw new Error(t("router.vpn.err.remote")); }
                if (!remote.isV4()) throw new Error(t("router.vpn.err.remote"));

                const cidr = netIn.value.trim();
                const slash = cidr.indexOf("/");
                if (slash < 0) throw new Error(t("router.vpn.err.network"));
                let dstIp;
                try { dstIp = IPAddress.fromString(cidr.slice(0, slash)); }
                catch { throw new Error(t("router.vpn.err.network")); }
                const prefix = Number(cidr.slice(slash + 1));
                if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32)
                    throw new Error(t("router.vpn.err.network"));

                this.net.addTunnel(name, remote);
                this.net.addTunnelRoute(dstIp, prefix, name);

                nameIn.value = remoteIn.value = netIn.value = "";
                renderList();
                this._renderRoutes();
            } catch (e) {
                errEl.textContent = String(e?.message ?? e);
            }
        });

        host.appendChild(DOMBuilder.div("router-vpn-form", [
            mkRow(t("router.vpn.name"),    nameIn),
            mkRow(t("router.vpn.remote"),  remoteIn),
            mkRow(t("router.vpn.network"), netIn),
            addBtn,
            errEl,
        ]));
    }
}
