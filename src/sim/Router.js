//@ts-check

import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { IPStack, adminDistanceOf } from "../net/IPStack.js";
import { VLANSubInterface } from "../net/NetworkInterface.js";
import { RIPDaemon } from "../net/RIPDaemon.js";
import { BGPDaemon } from "../net/BGPDaemon.js";
import { OSPFDaemon } from "../net/OSPFDaemon.js";
import { VRRPDaemon } from "../net/VRRPDaemon.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { PollTimer } from "../lib/PollTimer.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";
import { netmaskStrToPrefix, prefixToNetmaskStr, normalizeMaskInput } from "../lib/helpers.js";

import { UILib } from "../lib/UILib.js";
import { t } from "../i18n/index.js";
import { IPAddress } from "../net/models/IPAddress.js"; // <- ggf. Pfad anpassen
import { LLDPDaemon } from "../net/LLDPDaemon.js";
import { SimDialog } from "../lib/SimDialog.js";
import { DHCPv6Packet } from "../net/pdu/DHCPv6Packet.js";
import { IPv6Packet } from "../net/pdu/IPv6Packet.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";

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


/** @param {"connected"|"static"|"ospf"|"rip"|"bgp-ext"|"bgp-int"|string} source */
function routeSourceLabel(source) {
    if (source === "connected") return t("router.routingtable.source.connected");
    if (source === "static") return t("router.routingtable.source.static");
    if (source === "bgp-ext") return t("router.routingtable.source.bgpext");
    if (source === "bgp-int") return t("router.routingtable.source.bgpint");
    return source.toUpperCase();
}

/**
 * Sort routes by administrative distance (lowest = most preferred first),
 * then by prefix length (more specific first), preserving each route's
 * original index into this.net.routingTable for save/delete handlers.
 * @param {any[]} routes
 * @returns {Array<{r: any, idx: number}>}
 */
function sortRoutesByAdminDistance(routes) {
    return routes
        .map((r, idx) => ({ r, idx }))
        .sort((a, b) => {
            const adA = adminDistanceOf(a.r.source ?? "static");
            const adB = adminDistanceOf(b.r.source ?? "static");
            if (adA !== adB) return adA - adB;
            return (b.r.prefixLength ?? 0) - (a.r.prefixLength ?? 0);
        });
}

/** deterministic via EthernetPort.linkref @param {*} iface */
function getInterfaceLinkStatus(iface) {
    // Subinterfaces use the parent's physical port for link state
    const port = (iface instanceof VLANSubInterface ? iface._parentIface?.port : iface?.port);
    if (!port) return { text: t("router.unknown"), state: "unknown" };
    return port.linkref ? { text: t("router.stateup"), state: "up" } : { text: t("router.statedown"), state: "down" };
}

// ── DHCPv6-PD helpers ────────────────────────────────────────────────────────

/** @param {Uint8Array} a @param {Uint8Array} b */
function _pd6ArrEq(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** @param {Uint8Array} bytes @param {number} prefixLen @returns {Uint8Array} */
function _pd6MaskPrefix(bytes, prefixLen) {
    const r = new Uint8Array(bytes);
    for (let i = 0; i < 16; i++) {
        const b = i * 8;
        if (b >= prefixLen) r[i] = 0;
        else if (b + 8 > prefixLen) r[i] &= 0xff << (8 - (prefixLen - b));
    }
    return r;
}

/** @param {Uint8Array} pool @param {number} poolLen @param {number} delegLen @param {number} index @returns {Uint8Array} */
function _pd6BuildDelegatedPrefix(pool, poolLen, delegLen, index) {
    const r = new Uint8Array(pool);
    const bits = delegLen - poolLen;
    for (let i = 0; i < bits; i++) {
        const pos = poolLen + i;
        const byte = pos >> 3, shift = 7 - (pos & 7);
        if ((index >> (bits - 1 - i)) & 1) r[byte] |=  (1 << shift);
        else                                r[byte] &= ~(1 << shift);
    }
    return r;
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
  /** @type {string} */ _lastRoutesFingerprint = "";

  /** @type {RIPDaemon} */
  rip;
  /** @type {RIPDaemon} */
  ripng;
  /** @type {HTMLTextAreaElement|null} */ _ripCombinedLogEl = null;

  /** @type {BGPDaemon} */
  bgp;
  /** @type {HTMLElement|null} */ _bgpPeersHost = null;
  /** @type {HTMLElement|null} */ _bgpRoutesHost = null;
  /** @type {HTMLTextAreaElement|null} */ _bgpLogEl = null;

  /** @type {OSPFDaemon} */
  ospf;
  /** @type {HTMLTextAreaElement|null} */ _ospfLogEl = null;
  _ospfPollTimer = new PollTimer();

  /** @type {VRRPDaemon} */
  vrrp;
  /** @type {HTMLTextAreaElement|null} */ _vrrpLogEl = null;
  /** @type {HTMLElement|null} */ _vrrpGroupsHost = null;
  /** @type {HTMLElement|null} */ _vrrpStatusHost = null;
  _vrrpPollTimer = new PollTimer();

  // ── DHCPv6-PD server ──────────────────────────────────────────────────────
  _pd6Enabled = false;
  /** @type {IPAddress|null} */ _pd6Pool = null;
  _pd6PoolLength = 48;
  _pd6DelegatedLength = 56;
  _pd6LeaseTime = 3600;
  /**
   * @type {Map<string,{prefix16bytes:Uint8Array,prefixLen:number,index:number,expiresAt:number,ifIndex:number,clientLL:IPAddress|null}>}
   */
  _pd6Leases = new Map();
  /** @type {Set<number>} */ _pd6Allocated = new Set();
  _pd6NextIndex = 0;
  /** @type {number|null} */ _pd6Socket = null;
  _pd6Running = false;
  /** @type {Uint8Array|null} */ _pd6DUID = null;

  // ── LLDP ──────────────────────────────────────────────────────────────────
  _lldpEnabled = false;
  /**
   * ifaceName → { chassisId, portId, systemName, expiresAtTick }
   * @type {Map<string, {chassisId:string, portId:string, systemName:string, expiresAtTick:number}>}
   */
  _lldpNeighbors = new Map();
  /** @type {number|null} */ _lldpTimer = null;
  /** @type {HTMLInputElement|null} */ _lldpEnabledCb = null;
  /** @type {HTMLDivElement|null} */ _lldpTableHost = null;

  // ── DHCPv6-PD client (Requesting Router) ──────────────────────────────────
  _pd6ClientEnabled = false;
  _pd6ClientIfIndex = 0;
  /** @type {{prefix16bytes:Uint8Array,prefixLen:number}|null} */ _pd6ClientDelegated = null;
  /** @type {((pkt:DHCPv6Packet)=>void)|null} */ _pd6ClientCallback = null;
  _pd6ClientTxId = new Uint8Array(3);
  /** @type {number|null} */ _pd6ClientSocket = null;
  _pd6ClientRunning = false;

    constructor(name = t("router.title")) {
        super((name = t("router.title")));
        this.net = new IPStack(2, name);
        this.net.forwarding = true;
        this.fs = new VirtualFileSystem();
        this.rip   = new RIPDaemon(this.net, 4);
        this.ripng = new RIPDaemon(this.net, 6);
        this.bgp   = new BGPDaemon(this.net);
        this.ospf  = new OSPFDaemon(this.net);
        this.vrrp  = new VRRPDaemon(this.net);

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
            net:   this.net.toJSON(),
            rip:   this.rip.toJSON(),
            ripng: this.ripng.toJSON(),
            bgp:   this.bgp.toJSON(),
            ospf:  this.ospf.toJSON(),
            vrrp:  this.vrrp.toJSON(),
            pd6: {
                enabled:         this._pd6Enabled,
                pool:            this._pd6Pool?.toString() ?? "2001:db8:100::",
                poolLength:      this._pd6PoolLength,
                delegatedLength: this._pd6DelegatedLength,
                leaseTime:       this._pd6LeaseTime,
                clientEnabled:   this._pd6ClientEnabled,
                clientIfIndex:   this._pd6ClientIfIndex,
            },
            lldpEnabled: !!this._lldpEnabled,
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Router(n.name ?? "Router");
        obj._applyBaseJSON(n);
        if (n.net) obj.net = IPStack.fromJSON(n.net);
        obj.rip   = new RIPDaemon(obj.net, 4);
        if (n.rip)   obj.rip.applyJSON(n.rip);
        obj.ripng = new RIPDaemon(obj.net, 6);
        if (n.ripng) obj.ripng.applyJSON(n.ripng);
        obj.bgp   = new BGPDaemon(obj.net);
        if (n.bgp)   obj.bgp.applyJSON(n.bgp);
        obj.ospf  = new OSPFDaemon(obj.net);
        if (n.ospf)  obj.ospf.applyJSON(n.ospf);
        obj.vrrp  = new VRRPDaemon(obj.net);
        if (n.vrrp)  obj.vrrp.applyJSON(n.vrrp);
        if (n.pd6) {
            obj._pd6Enabled         = !!n.pd6.enabled;
            if (typeof n.pd6.pool === "string") {
                try { obj._pd6Pool = IPAddress.fromString(n.pd6.pool); } catch {}
            }
            if (!obj._pd6Pool) try { obj._pd6Pool = IPAddress.fromString("2001:db8:100::"); } catch {}
            if (Number.isInteger(n.pd6.poolLength))      obj._pd6PoolLength      = n.pd6.poolLength;
            if (Number.isInteger(n.pd6.delegatedLength)) obj._pd6DelegatedLength = n.pd6.delegatedLength;
            if (Number.isFinite(n.pd6.leaseTime))        obj._pd6LeaseTime       = Math.floor(n.pd6.leaseTime);
            if (obj._pd6Enabled) void obj._pd6Start();
            obj._pd6ClientEnabled = !!n.pd6.clientEnabled;
            if (Number.isInteger(n.pd6.clientIfIndex)) obj._pd6ClientIfIndex = n.pd6.clientIfIndex;
            if (obj._pd6ClientEnabled) void obj._pd6ClientStart();
        }
        if (n.lldpEnabled) obj._lldpEnabled = true;
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

        const host = UILib.div("router-ui");
        panelBody.appendChild(host);

        /* ============================ Outer tabs ============================ */
        const card = UILib.div("router-card");
        host.appendChild(card);

        const { bar: outerTabBar, setActive: setOuterActive } = UILib.tabGroup([
            { id: "interfaces", label: t("router.interfaces")        },
            { id: "routes-v4",  label: t("router.routingtable.ipv4") },
            { id: "routes-v6",  label: t("router.routingtable.ipv6") },
            { id: "rip",        label: "RIP"                           },
            { id: "ospf",       label: t("router.ospf.tab")           },
            { id: "bgp",        label: t("router.bgp.tab")            },
            { id: "vpn",        label: t("router.vpn.tab")            },
            { id: "pd6",        label: t("router.pd6.tab")            },
            { id: "vrrp",       label: "VRRP"                          },
            { id: "lldp",       label: t("router.lldp.tab")           },
        ], (id) => {
            ifSection.classList.toggle("hidden",    id !== "interfaces");
            routeSection.classList.toggle("hidden", id !== "routes-v4" && id !== "routes-v6");
            ripSection.classList.toggle("hidden",   id !== "rip");
            bgpSection.classList.toggle("hidden",   id !== "bgp");
            ospfSection.classList.toggle("hidden",  id !== "ospf");
            vpnSection.classList.toggle("hidden",   id !== "vpn");
            pd6Section.classList.toggle("hidden",   id !== "pd6");
            vrrpSection.classList.toggle("hidden",  id !== "vrrp");
            lldpSection.classList.toggle("hidden",  id !== "lldp");
            if (id === "routes-v4") { routeTitle.textContent = t("router.routingtable.ipv4"); this._selectedRouteFamily = 4; this._renderRoutes(); }
            if (id === "routes-v6") { routeTitle.textContent = t("router.routingtable.ipv6"); this._selectedRouteFamily = 6; this._renderRoutes(); }
        });
        card.appendChild(outerTabBar);

        const outerContent = UILib.div("sim-panel-content panel");
        card.appendChild(outerContent);

        /* ============================ Interfaces ============================ */
        const ifSection = UILib.div("");

        const tabsBar = UILib.div("ui-tabbar");
        this._tabsBar = tabsBar;

        const ifacePanel = UILib.div("router-if-panel");
        this._ifacePanel = ifacePanel;

        // --- IPv4 Section ---
        const v4Cb = UILib.input({ type: "checkbox" });
        const v4Header = UILib.div("router-if-section-header", [
            v4Cb,
            UILib.el("span", { text: "IPv4", className: "router-if-section-label" }),
        ]);
        const ipIn   = UILib.input({ placeholder: "192.168.1.1" });
        const maskIn = UILib.input({ placeholder: "255.255.255.0" });
        const cidrIn = UILib.input({ placeholder: "24" });
        const ifField = (/** @type {string} */ cls, /** @type {string} */ label, /** @type {HTMLElement} */ inp) => UILib.div("cfg-field " + cls, [
            UILib.el("span", { text: label, className: "router-if-field-label" }),
            inp,
        ]);
        const v4Fields = UILib.div("cfg-fields router-if-fields", [
            ifField("router-if-ip",   t("router.if.address"), ipIn),
            ifField("router-if-mask", t("router.if.netmask"), maskIn),
            ifField("router-if-cidr", t("router.if.prefix"),  cidrIn),
        ]);
        const v4Section = UILib.div("router-if-section", [v4Header, v4Fields]);

        // --- IPv6 Section ---
        const v6Cb = UILib.input({ type: "checkbox" });
        const v6Header = UILib.div("router-if-section-header", [
            v6Cb,
            UILib.el("span", { text: "IPv6", className: "router-if-section-label" }),
        ]);
        const ip6In     = UILib.input({ placeholder: "2001:db8::1" });
        const prefix6In = UILib.input({ placeholder: "64" });
        const raCb    = UILib.input({ type: "checkbox" });
        const raLabel = UILib.el("label", { className: "router-if-ra-label" });
        raLabel.append(raCb, " " + t("router.ra.enabled"));
        const v6Fields = UILib.div("cfg-fields router-if-fields", [
            ifField("router-if-ip6",     t("router.if.address"), ip6In),
            ifField("router-if-prefix6", t("router.if.prefix"),  prefix6In),
        ]);
        const v6Body = UILib.div("router-if-v6-body", [
            v6Fields,
            UILib.div("cfg-fields router-if-fields", [raLabel]),
        ]);
        const v6Section = UILib.div("router-if-section", [v6Header, v6Body]);

        const saveBtn = UILib.button(t("router.save"), null, { className: "router-if-save" });

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

        const actionsHost = UILib.div("router-if-actions");
        this._ifaceActionsHost = actionsHost;
        ifacePanel.appendChild(actionsHost);

        const macVal = UILib.el("span", { className: "router-if-mac-value" });
        this._macDisplay = macVal;
        ifacePanel.appendChild(UILib.div("router-if-mac-row", [
            UILib.el("span", { text: "MAC", className: "router-if-field-label" }),
            macVal,
        ]));

        ifSection.append(tabsBar, ifacePanel);

        /* =========================== Routingtabelle ========================== */
        const routeSection = UILib.div("hidden");

        const routeTitle = UILib.el("div", { className: "hr-section-title" });
        routeSection.appendChild(routeTitle);

        const routesHost = UILib.div("router-routes");
        this._routesHost = routesHost;
        routeSection.appendChild(routesHost);

        /* ============================== RIP / RIPng ============================ */
        const ripSection = UILib.div("hidden");
        this._buildRIPSection(ripSection);

        /* ================================ BGP ================================= */
        const bgpSection = UILib.div("hidden");
        this._buildBGPSection(bgpSection);

        /* ================================ OSPF ================================ */
        const ospfSection = UILib.div("hidden");
        this._buildOSPFSection(ospfSection);

        /* ================================ VPN ================================= */
        const vpnSection = UILib.div("hidden");
        this._buildVPNSection(vpnSection);

        /* ============================= DHCPv6-PD ============================= */
        const pd6Section = UILib.div("hidden");
        this._buildDHCPv6PDSection(pd6Section);

        /* ================================ VRRP ================================ */
        const vrrpSection = UILib.div("hidden");
        this._buildVRRPSection(vrrpSection);

        /* ================================ LLDP ================================ */
        const lldpSection = UILib.div("hidden");
        this._buildLLDPSection(lldpSection);

        outerContent.append(ifSection, routeSection, ripSection, bgpSection, ospfSection, vpnSection, pd6Section, vrrpSection, lldpSection);
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

        UILib.clear(tabsBar);
        this._tabRefs.clear();

        for (const iface of this.net.interfaces) {
            const btn = UILib.button("", null, { className: "ui-tab" });
            btn.dataset.name = iface.name;

            const label = UILib.el("span", { className: "router-tab-label", text: iface.name });
            const badge = UILib.el("span", { className: "ui-tab-badge status-unknown", text: t("router.unknown") });

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

        const plusBtn = UILib.button("+", null, { className: "ui-tab router-tab-plus", title: t("router.addinterface") });
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

        UILib.clear(actionsHost);

        const iface = this._getSelectedIface();
        const isSub = iface instanceof VLANSubInterface;

        if (!isSub) {
            const subBtn = UILib.button("+ VLAN", null, { className: "router-if-addsub" });
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
                    SimDialog.alert(e instanceof Error ? e.message : String(e));
                }
            });
            actionsHost.appendChild(subBtn);
        }

        const delBtn = UILib.button(t("router.deleteinterface"), null, { className: "router-if-del" });
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
        this._pollTimer.start(() => {
            this._updateAllTabStatuses();
            this._pollRefreshRoutes();
            if (this._lldpTableHost && this._lldpEnabled) this._renderLLDPSection();
        }, 1000);
    }

    _pollRefreshRoutes() {
        if (!this._routesHost || this._routesHost.closest("[style*='display: none']")) return;
        const fp = (this.net.routingTable ?? [])
            .map(r => `${r.source}|${r.dst}|${r.prefixLength}|${r.nexthop}|${r.interf}`)
            .join(";");
        if (fp === this._lastRoutesFingerprint) return;
        if (this._routesHost.querySelector(".router-route-dirty")) return;
        this._lastRoutesFingerprint = fp;
        this._renderRoutes();
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
            if (this._macDisplay) this._macDisplay.textContent = "";
            UILib.markInvalid(this._ipInput, false);
            UILib.markInvalid(this._maskInput, false);
            UILib.markInvalid(this._ip6Input, false);
            UILib.markInvalid(this._prefix6Input, false);
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

        UILib.markInvalid(this._ipInput, false);
        UILib.markInvalid(this._maskInput, false);
        UILib.markInvalid(this._ip6Input, false);
        UILib.markInvalid(this._prefix6Input, false);

        if (this._macDisplay) {
            this._macDisplay.textContent = iface.mac
                ? Array.from(iface.mac).map(b => b.toString(16).padStart(2, '0')).join(':')
                : "";
        }
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
        if (v4Fields) v4Fields.classList.toggle("hidden", !v4Active);

        // Show/hide IPv6 fields (including RA checkbox)
        const v6Body = ip6In ? /** @type {HTMLElement|null} */ (ip6In.closest('.router-if-v6-body')) : null;
        if (v6Body) v6Body.classList.toggle("hidden", !v6Active);

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
            UILib.markInvalid(ipIn, !ipOk);
            UILib.markInvalid(maskIn, !pOk);
            v4Ok = ipOk && pOk;
        } else {
            UILib.markInvalid(ipIn, false);
            UILib.markInvalid(maskIn, false);
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
            UILib.markInvalid(ip6In, !ipOk);
            UILib.markInvalid(prefix6In, !pOk);
            v6Ok = ipOk && pOk;
        } else if (ip6In && prefix6In) {
            UILib.markInvalid(ip6In, false);
            UILib.markInvalid(prefix6In, false);
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
                const ip = ipFromStr(/** @type {HTMLInputElement} */ (this._ipInput).value);
                if (!ip.isV4()) throw new Error("IPv4-Adresse erwartet.");
                const cidrTxt = /** @type {HTMLInputElement} */ (this._cidrInput).value.trim();
                let prefix = 0;
                if (cidrTxt) {
                    prefix = assertPrefix(Number(cidrTxt));
                } else {
                    const p = netmaskStrToPrefix(/** @type {HTMLInputElement} */ (this._maskInput).value);
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

            this.ospf?.onInterfaceChange();
        } catch (e) {
            SimDialog.alert(e instanceof Error ? e.message : String(e));
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
            "<th>" + t("router.routingtable.source") + "</th>" +
            "<th>" + t("router.routingtable.actions") + "</th>" +
            "</tr>";
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const routes = this.net.routingTable ?? [];
        const rows = sortRoutesByAdminDistance(routes).filter(({ r }) => !r.dst?.isV6?.());

        rows.forEach(({ r, idx }) => {
            const source = r.source ?? "static";
            const editable = source === "static";

            const tr = document.createElement("tr");
            tr.className = "router-route-row";
            tr.dataset.source = source;
            if (source === "connected") tr.classList.add("router-route-auto");
            else if (!editable) tr.classList.add("router-route-dynamic");
            else tr.classList.add("router-route-manual");

            const dst = document.createElement("input");
            dst.value = ipToStr(r.dst);
            dst.disabled = !editable;

            const mask = document.createElement("input");
            mask.value = prefixToNetmaskStr(Number(r.prefixLength ?? 0));
            mask.disabled = !editable;

            const nh = document.createElement("input");
            nh.value = ipToStr(r.nexthop);
            nh.disabled = !editable;

            const autoTd = document.createElement("td");
            autoTd.textContent = routeSourceLabel(source);

            const save = document.createElement("button");
            save.innerHTML = '<i class="fa-solid fa-check"></i>';
            save.title = t("router.routingtable.save");
            save.className = "router-route-action-btn";
            save.disabled = true;

            const del = document.createElement("button");
            del.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            del.title = t("router.routingtable.delete");
            del.className = "router-route-action-btn";
            del.disabled = !editable;

            // interface cell
            let ifCellEl;
            /** @type {HTMLSelectElement|null} */
            let ifSel = null;

            if (r.tunnel) {
                const span = document.createElement("span");
                span.textContent = "tun:" + r.tunnel.name;
                span.className = "router-hint-span";
                ifCellEl = span;
                save.disabled = true;
            } else if (r.interf === -1) {
                const span = document.createElement("span");
                span.textContent = "lo";
                span.className = "router-hint-span";
                ifCellEl = span;
            } else {
                ifSel = document.createElement("select");
                ifSel.disabled = !editable;

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
                if (!editable) return false;
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

                UILib.markInvalid(dst, !okDst);
                UILib.markInvalid(mask, !okMask);
                UILib.markInvalid(nh, !okNh);

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
            mask.addEventListener("blur", () => {
                const norm = normalizeMaskInput(mask.value);
                if (norm !== mask.value) { mask.value = norm; updateRowState(); }
            });
            nh.addEventListener("input", updateRowState);
            if (ifSel) ifSel.addEventListener("change", updateRowState);

            save.addEventListener("click", () => {
                if (save.disabled) return;

                const old = this.net.routingTable[idx];
                if ((old.source ?? "static") !== "static") return;

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
                    SimDialog.alert(e instanceof Error ? e.message : String(e));
                }
            });

            del.addEventListener("click", () => {
                const old = this.net.routingTable[idx];
                if ((old.source ?? "static") !== "static") return;

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
            if (editable) {
                actions.appendChild(save);
                actions.appendChild(del);
            }
            tr.appendChild(actions);

            tbody.appendChild(tr);
            updateRowState();
        });

        table.appendChild(tbody);
        const scrollWrap = UILib.div("sim-table-scroll");
        scrollWrap.appendChild(table);
        this._routesHost.appendChild(UILib.wrapWithScrollHints(scrollWrap));

        // ---- Footer: "+ Route hinzufügen" button ----
        const hasIfaces = this.net.interfaces.length > 0;
        const footerBtn = UILib.button("+ " + t("router.routingtable.add"), null, { className: "router-route-footer-btn" });
        footerBtn.disabled = !hasIfaces;
        this._routesHost.appendChild(footerBtn);

        footerBtn.addEventListener("click", () => {
            footerBtn.classList.add("hidden");

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
            addAuto.textContent = t("router.routingtable.source.static");

            const saveBtn = document.createElement("button");
            saveBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
            saveBtn.title = t("router.routingtable.save");
            saveBtn.className = "router-route-action-btn";
            saveBtn.disabled = true;

            const cancelBtn = document.createElement("button");
            cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            cancelBtn.title = t("ui.cancel");
            cancelBtn.className = "router-route-action-btn";

            const updateAddState = () => {
                let okDst = false, okMask = false, okNh = false;
                try { const ip = ipFromStr(addDst.value || "0.0.0.0"); okDst = ip.isV4(); } catch { okDst = false; }
                try { const p = netmaskStrToPrefix(addMask.value || "0.0.0.0"); okMask = (p != null); } catch { okMask = false; }
                try { const ip = ipFromStr(addNh.value || "0.0.0.0"); okNh = ip.isV4(); } catch { okNh = false; }
                UILib.markInvalid(addDst, !okDst);
                UILib.markInvalid(addMask, !okMask);
                UILib.markInvalid(addNh, !okNh);
                saveBtn.disabled = !(okDst && okMask && okNh);
            };

            addDst.addEventListener("input", updateAddState);
            addMask.addEventListener("input", updateAddState);
            addMask.addEventListener("blur", () => {
                const norm = normalizeMaskInput(addMask.value);
                if (norm !== addMask.value) { addMask.value = norm; updateAddState(); }
            });
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
                    SimDialog.alert(e instanceof Error ? e.message : String(e));
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
            "<th>" + t("router.routingtable.source") + "</th>" +
            "<th>" + t("router.routingtable.actions") + "</th>" +
            "</tr>";
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const routes = this.net.routingTable ?? [];
        const rows = sortRoutesByAdminDistance(routes).filter(({ r }) => !!r.dst?.isV6?.());

        rows.forEach(({ r, idx }) => {
            const source = r.source ?? "static";
            const editable = source === "static";

            const dst = document.createElement("input");
            dst.value = ipToStr(r.dst);
            dst.disabled = !editable;

            const prefix = document.createElement("input");
            prefix.value = String(r.prefixLength ?? 0);
            prefix.disabled = !editable;
            prefix.className = "router-input-prefix";

            const nh = document.createElement("input");
            nh.value = ipToStr(r.nexthop);
            nh.disabled = !editable;

            const autoTd = document.createElement("td");
            autoTd.textContent = routeSourceLabel(source);

            const save = document.createElement("button");
            save.innerHTML = '<i class="fa-solid fa-check"></i>';
            save.title = t("router.routingtable.save");
            save.className = "router-route-action-btn";
            save.disabled = true;

            const del = document.createElement("button");
            del.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            del.title = t("router.routingtable.delete");
            del.className = "router-route-action-btn";
            del.disabled = !editable;

            let ifCellEl;
            /** @type {HTMLSelectElement|null} */
            let ifSel = null;

            if (r.interf === -1) {
                const span = document.createElement("span");
                span.textContent = "lo";
                span.className = "router-hint-span";
                ifCellEl = span;
            } else {
                ifSel = document.createElement("select");
                ifSel.disabled = !editable;
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
                if (!editable) return false;
                let okDst = false, okPfx = false, okNh = false;
                try { const ip = ipFromStr(dst.value); okDst = ip.isV6(); } catch { okDst = false; }
                try { const n = Number(prefix.value); okPfx = Number.isInteger(n) && n >= 0 && n <= 128; } catch { okPfx = false; }
                try { const ip = ipFromStr(nh.value); okNh = ip.isV6(); } catch { okNh = false; }
                UILib.markInvalid(dst, !okDst);
                UILib.markInvalid(prefix, !okPfx);
                UILib.markInvalid(nh, !okNh);
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
                if ((old.source ?? "static") !== "static") return;
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
                    SimDialog.alert(e instanceof Error ? e.message : String(e));
                }
            });

            del.addEventListener("click", () => {
                const old = this.net.routingTable[idx];
                if ((old.source ?? "static") !== "static") return;
                this.net.delRoute(old.dst, old.prefixLength, old.interf, old.nexthop);
                this._renderRoutes();
            });

            /** @param {HTMLElement} el */
            const td = (el) => { const tdd = document.createElement("td"); tdd.appendChild(el); return tdd; };
            const tr = document.createElement("tr");
            let sourceClass = "router-route-manual";
            if (source === "connected") sourceClass = "router-route-auto";
            else if (!editable) sourceClass = "router-route-dynamic";
            tr.className = "router-route-row " + sourceClass;
            tr.appendChild(td(dst));
            tr.appendChild(td(prefix));
            tr.appendChild(td(nh));
            tr.appendChild(td(ifCellEl));
            tr.appendChild(autoTd);
            const actions = document.createElement("td");
            actions.className = "router-route-actions";
            if (editable) {
                actions.appendChild(save);
                actions.appendChild(del);
            }
            tr.appendChild(actions);
            tbody.appendChild(tr);
            updateRowState();
        });

        table.appendChild(tbody);
        const scrollWrapV6 = UILib.div("sim-table-scroll");
        scrollWrapV6.appendChild(table);
        this._routesHost.appendChild(UILib.wrapWithScrollHints(scrollWrapV6));

        // ---- Footer: "+ Route hinzufügen" button (IPv6) ----
        const hasIfaces = this.net.interfaces.length > 0;
        const footerBtn = UILib.button("+ " + t("router.routingtable.add"), null, { className: "router-route-footer-btn" });
        footerBtn.disabled = !hasIfaces;
        this._routesHost.appendChild(footerBtn);

        footerBtn.addEventListener("click", () => {
            footerBtn.classList.add("hidden");

            const addTr = document.createElement("tr");
            addTr.className = "router-route-add-row";

            const addDst = document.createElement("input");
            addDst.placeholder = "::";

            const addPrefix = document.createElement("input");
            addPrefix.placeholder = "64";
            addPrefix.className = "router-input-prefix";

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
            addAuto.textContent = t("router.routingtable.source.static");

            const saveBtn = document.createElement("button");
            saveBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
            saveBtn.title = t("router.routingtable.save");
            saveBtn.className = "router-route-action-btn";
            saveBtn.disabled = true;

            const cancelBtn = document.createElement("button");
            cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            cancelBtn.title = t("ui.cancel");
            cancelBtn.className = "router-route-action-btn";

            const updateAddState = () => {
                let okDst = false, okPfx = false, okNh = false;
                try { const ip = ipFromStr(addDst.value || "::"); okDst = ip.isV6(); } catch { okDst = false; }
                try { const n = Number(addPrefix.value || "0"); okPfx = Number.isInteger(n) && n >= 0 && n <= 128; } catch { okPfx = false; }
                try { const ip = ipFromStr(addNh.value || "::"); okNh = ip.isV6(); } catch { okNh = false; }
                UILib.markInvalid(addDst, !okDst);
                UILib.markInvalid(addPrefix, !okPfx);
                UILib.markInvalid(addNh, !okNh);
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
                    SimDialog.alert(e instanceof Error ? e.message : String(e));
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
    /** @param {HTMLElement} host */
    _buildRIPSection(host) {
        const { bar: innerBar, setActive: setInnerActive } = UILib.tabGroup([
            { id: "config", label: t("router.rip.tab.config") },
            { id: "log",    label: t("router.rip.tab.log")    },
        ], (id) => {
            configSection.classList.toggle("hidden", id !== "config");
            logSection.classList.toggle("hidden",    id !== "log");
            if (id === "log") this._renderRIPCombinedLog();
        });
        host.appendChild(innerBar);

        // ── Konfiguration ─────────────────────────────────────────────────
        const configSection = UILib.div("");

        const ripCb = UILib.input({ type: "checkbox" });
        ripCb.checked = this.rip.enabled;
        ripCb.addEventListener("change", () => { this.rip.setEnabled(ripCb.checked); this._renderRIPCombinedLog(); });

        const ripngCb = UILib.input({ type: "checkbox" });
        ripngCb.checked = this.ripng.enabled;
        ripngCb.addEventListener("change", () => { this.ripng.setEnabled(ripngCb.checked); this._renderRIPCombinedLog(); });

        configSection.appendChild(UILib.div("cfg-fields", [
            UILib.div("hr-checkbox-row", [ripCb,   UILib.el("span", { text: t("router.rip.enabled")   })]),
            UILib.div("hr-checkbox-row", [ripngCb, UILib.el("span", { text: t("router.ripng.enabled") })]),
        ]));

        const hintEl = UILib.el("p", { text: t("router.rip.passive.hint"), className: "router-hint" });
        configSection.appendChild(hintEl);

        const ifTable = document.createElement("table");
        ifTable.className = "router-routes";
        ifTable.style.marginTop = "4px";
        const thead = document.createElement("thead");
        const htr   = document.createElement("tr");
        const thIf  = document.createElement("th"); thIf.textContent = t("router.rip.col.interface");
        const thR   = document.createElement("th"); thR.textContent  = "RIP";
        const thRng = document.createElement("th"); thRng.textContent = "RIPng";
        htr.append(thIf, thR, thRng);
        thead.appendChild(htr);
        const tbody = document.createElement("tbody");

        for (const iface of this.net.interfaces) {
            const ifName = iface.name;
            const tr   = document.createElement("tr");
            const tdN  = document.createElement("td"); tdN.textContent = ifName;
            const tdR  = document.createElement("td");
            const tdRng = document.createElement("td");
            const cbR  = UILib.input({ type: "checkbox" });
            cbR.checked = this.rip.passiveInterfaces.has(ifName);
            cbR.addEventListener("change", () => this.rip.setPassive(ifName, cbR.checked));
            const cbRng = UILib.input({ type: "checkbox" });
            cbRng.checked = this.ripng.passiveInterfaces.has(ifName);
            cbRng.addEventListener("change", () => this.ripng.setPassive(ifName, cbRng.checked));
            tdR.appendChild(cbR);
            tdRng.appendChild(cbRng);
            tr.append(tdN, tdR, tdRng);
            tbody.appendChild(tr);
        }
        ifTable.append(thead, tbody);
        const ripIfScroll = UILib.div("sim-table-scroll");
        ripIfScroll.appendChild(ifTable);
        configSection.appendChild(UILib.wrapWithScrollHints(ripIfScroll));

        // ── Protokoll ─────────────────────────────────────────────────────
        const logSection = UILib.div("hidden");
        const logEl = /** @type {HTMLTextAreaElement} */ (UILib.el("textarea", {
            className: "log router-log-md",
            attrs: { readonly: "true", spellcheck: "false" },
        }));
        logSection.appendChild(logEl);
        this._ripCombinedLogEl = logEl;
        this._renderRIPCombinedLog();

        host.append(configSection, logSection);
        setInnerActive("config");

        this.rip.onLogUpdate   = () => this._renderRIPCombinedLog();
        this.ripng.onLogUpdate = () => this._renderRIPCombinedLog();
    }

    _renderRIPCombinedLog() {
        if (!this._ripCombinedLogEl) return;
        const combined = [...this.rip.log, ...this.ripng.log].sort().slice(-200);
        this._ripCombinedLogEl.value = combined.join("\n");
        this._ripCombinedLogEl.scrollTop = this._ripCombinedLogEl.scrollHeight;
    }

    /* ----------------------------- BGP tab ----------------------------- */

    /** @param {HTMLElement} host */
    _buildBGPSection(host) {
        const { bar: innerBar, setActive: setInnerActive } = UILib.tabGroup([
            { id: "config", label: t("router.bgp.tab.config") },
            { id: "peers",  label: t("router.bgp.tab.peers")  },
            { id: "routes", label: t("router.bgp.tab.routes") },
            { id: "log",    label: t("router.bgp.tab.log")    },
        ], (id) => {
            configSection.classList.toggle("hidden", id !== "config");
            peersSection.classList.toggle("hidden",  id !== "peers");
            routesSection.classList.toggle("hidden", id !== "routes");
            logSection.classList.toggle("hidden",    id !== "log");
            if (id === "peers")  this._renderBGPPeers();
            if (id === "routes") this._renderBGPRoutes();
            if (id === "log")    this._renderBGPLog();
        });
        host.appendChild(innerBar);

        // ── Konfiguration ────────────────────────────────────────────────
        const configSection = UILib.div("");

        const enableCb = UILib.input({ type: "checkbox" });
        enableCb.checked = this.bgp.enabled;
        enableCb.addEventListener("change", () => {
            this.bgp.setEnabled(enableCb.checked);
            this._renderBGPLog();
        });
        configSection.appendChild(UILib.div("hr-checkbox-row", [enableCb, UILib.el("span", { text: t("router.bgp.enabled") })]));

        const asIn  = UILib.input({ placeholder: "65001" });
        asIn.value  = this.bgp.localAS ? String(this.bgp.localAS) : "";
        const ridIn = UILib.input({ placeholder: "1.2.3.4" });
        ridIn.value = this.bgp.routerId;
        const cfgSaveBtn = UILib.button(t("router.save"));
        cfgSaveBtn.addEventListener("click", () => {
            const as = Number(asIn.value.trim());
            if (!Number.isInteger(as) || as < 1 || as > 65535) {
                SimDialog.alert("AS-Nummer muss 1..65535 sein");
                return;
            }
            this.bgp.localAS  = as;
            this.bgp.routerId = ridIn.value.trim();
        });

        configSection.appendChild(UILib.el("div", { className: "hr-section", children: [
            UILib.div("cfg-fields", [
                UILib.el("div", { className: "cfg-field hr-field-sm", children: [
                    UILib.el("span", { text: t("router.bgp.localas"), className: "router-if-field-label" }),
                    asIn,
                ]}),
                UILib.el("div", { className: "cfg-field", children: [
                    UILib.el("span", { text: t("router.bgp.routerid"), className: "router-if-field-label" }),
                    ridIn,
                ]}),
            ]),
            UILib.div("hr-btn-row", [cfgSaveBtn]),
        ]}));

        // ── Peers ────────────────────────────────────────────────────────
        const peersSection = UILib.div("hidden");
        const peersHost = UILib.div("");
        this._bgpPeersHost = peersHost;
        peersSection.appendChild(peersHost);

        // ── Routen ───────────────────────────────────────────────────────
        const routesSection = UILib.div("hidden");
        const routesHost = UILib.div("");
        this._bgpRoutesHost = routesHost;
        routesSection.appendChild(routesHost);

        // ── Protokoll ────────────────────────────────────────────────────
        const logSection = UILib.div("hidden");
        const logEl = /** @type {HTMLTextAreaElement} */ (UILib.el("textarea", {
            className: "log router-log-md",
            attrs: { readonly: "true", spellcheck: "false" },
        }));
        logSection.appendChild(logEl);
        this._bgpLogEl = logEl;
        this._renderBGPLog();

        host.append(configSection, peersSection, routesSection, logSection);
        setInnerActive("config");

        this.bgp.onUpdate = () => {
            this._renderBGPPeers();
            this._renderBGPLog();
            this._renderBGPRoutes();
        };
    }

    _renderBGPPeers() {
        const host = this._bgpPeersHost;
        if (!host) return;
        UILib.clear(host);

        if (this.bgp.peers.length > 0) {
            const table = document.createElement("table");
            table.className = "router-routes-table";
            const thead = document.createElement("thead");
            thead.innerHTML =
                "<tr>" +
                "<th>" + t("router.bgp.peers.col.ip")       + "</th>" +
                "<th>" + t("router.bgp.peers.col.remoteas")  + "</th>" +
                "<th>" + t("router.bgp.peers.col.desc")      + "</th>" +
                "<th>" + t("router.bgp.peers.col.passive")   + "</th>" +
                "<th>" + t("router.bgp.peers.col.state")     + "</th>" +
                "<th>" + t("router.bgp.peers.col.prefixes")  + "</th>" +
                "<th></th>" +
                "</tr>";
            const tbody = document.createElement("tbody");

            for (const peer of this.bgp.peers) {
                const session = this.bgp.getSession(peer.ip);
                const tr = document.createElement("tr");
                const mkTd = (/** @type {string} */ txt) => {
                    const td = document.createElement("td");
                    td.textContent = txt;
                    return td;
                };
                const delBtn = document.createElement("button");
                delBtn.textContent = t("router.bgp.peers.delete");
                delBtn.addEventListener("click", () => this.bgp.removePeer(peer.ip));
                const actTd = document.createElement("td");
                actTd.appendChild(delBtn);

                tr.append(
                    mkTd(peer.ip),
                    mkTd(String(peer.remoteAS)),
                    mkTd(peer.description),
                    mkTd(peer.passive ? "✓" : ""),
                    mkTd(session?.state ?? "—"),
                    mkTd(session ? String(session.prefixesReceived) : "—"),
                    actTd,
                );
                tbody.appendChild(tr);
            }
            table.append(thead, tbody);
            const peersScroll = UILib.div("sim-table-scroll");
            peersScroll.appendChild(table);
            host.appendChild(UILib.wrapWithScrollHints(peersScroll));
        }

        // Inline add-peer form
        const ipIn  = UILib.input({ placeholder: "10.0.0.1" });
        const asIn  = UILib.input({ placeholder: "65002", className: "router-input-as" });
        const descIn    = UILib.input({ placeholder: t("router.bgp.peers.col.desc") });
        const passiveCb = UILib.input({ type: "checkbox" });
        const addBtn = UILib.button("+ " + t("router.bgp.peers.add"));

        addBtn.addEventListener("click", () => {
            const ip = ipIn.value.trim();
            const as = Number(asIn.value.trim());
            if (!ip) { SimDialog.alert("IP-Adresse fehlt"); return; }
            try { IPAddress.fromString(ip); } catch { SimDialog.alert("Ungültige IP-Adresse"); return; }
            if (!Number.isInteger(as) || as < 1 || as > 65535) { SimDialog.alert("AS-Nummer muss 1..65535 sein"); return; }
            this.bgp.addPeer({ ip, remoteAS: as, description: descIn.value.trim(), passive: passiveCb.checked });
            ipIn.value = asIn.value = descIn.value = "";
            passiveCb.checked = false;
        });

        host.appendChild(UILib.el("div", { className: "hr-section", children: [
            UILib.div("cfg-fields", [
                UILib.el("div", { className: "cfg-field", children: [
                    UILib.el("span", { text: t("router.bgp.peers.col.ip"), className: "router-if-field-label" }),
                    ipIn,
                ]}),
                UILib.el("div", { className: "cfg-field hr-field-sm", children: [
                    UILib.el("span", { text: "AS", className: "router-if-field-label" }),
                    asIn,
                ]}),
                UILib.el("div", { className: "cfg-field", children: [
                    UILib.el("span", { text: t("router.bgp.peers.col.desc"), className: "router-if-field-label" }),
                    descIn,
                ]}),
            ]),
            UILib.div("hr-checkbox-row", [passiveCb, UILib.el("span", { text: t("router.bgp.peers.col.passive") })]),
            UILib.div("hr-btn-row", [addBtn]),
        ]}));
    }

    _renderBGPRoutes() {
        const host = this._bgpRoutesHost;
        if (!host) return;
        UILib.clear(host);

        const learned = [...this.bgp._learned.values()];
        if (learned.length === 0) {
            host.appendChild(UILib.el("p", { text: t("router.bgp.routes.empty"), className: "router-vpn-empty" }));
            return;
        }

        const table = document.createElement("table");
        table.className = "router-routes-table";
        const thead = document.createElement("thead");
        thead.innerHTML =
            "<tr>" +
            "<th>" + t("router.bgp.routes.col.prefix")  + "</th>" +
            "<th>" + t("router.bgp.routes.col.nexthop") + "</th>" +
            "<th>" + t("router.bgp.routes.col.aspath")  + "</th>" +
            "<th>" + t("router.bgp.routes.col.lp")      + "</th>" +
            "<th>" + t("router.bgp.routes.col.med")     + "</th>" +
            "<th>" + t("router.bgp.routes.col.peer")    + "</th>" +
            "</tr>";
        const tbody = document.createElement("tbody");

        for (const e of learned) {
            const tr = document.createElement("tr");
            const mkTd = (/** @type {string} */ txt) => {
                const td = document.createElement("td"); td.textContent = txt; return td;
            };
            tr.append(
                mkTd(`${e.dst}/${e.prefLen}`),
                mkTd(e.nexthop.toString()),
                mkTd(e.asPath.join(" ")),
                mkTd(String(e.localPref)),
                mkTd(String(e.med)),
                mkTd(e.fromPeer),
            );
            tbody.appendChild(tr);
        }

        table.append(thead, tbody);
        const bgpRoutesScroll = UILib.div("sim-table-scroll");
        bgpRoutesScroll.appendChild(table);
        host.appendChild(UILib.wrapWithScrollHints(bgpRoutesScroll));
    }

    _renderBGPLog() {
        if (!this._bgpLogEl) return;
        const lines = this.bgp.log;
        const max   = 200;
        this._bgpLogEl.value = (lines.length > max ? lines.slice(-max) : lines).join("\n");
        this._bgpLogEl.scrollTop = this._bgpLogEl.scrollHeight;
    }

    /* ----------------------------- OSPF tab ----------------------------- */

    /** @param {HTMLElement} host */
    _buildOSPFSection(host) {
        UILib.clear(host);

        const { bar: innerBar, setActive: setInnerActive } = UILib.tabGroup([
            { id: "config", label: t("router.ospf.tab.config") },
            { id: "status", label: t("router.ospf.tab.status") },
            { id: "lsdb",   label: t("router.ospf.tab.lsdb")   },
            { id: "log",    label: t("router.ospf.tab.log")     },
        ], (id) => {
            configSection.classList.toggle("hidden", id !== "config");
            statusSection.classList.toggle("hidden", id !== "status");
            lsdbSection.classList.toggle("hidden",   id !== "lsdb");
            logSection.classList.toggle("hidden",    id !== "log");
            if (id === "status" || id === "lsdb") renderAll();
        });
        host.appendChild(innerBar);

        // ── Config ───────────────────────────────────────────────────────
        const configSection = UILib.div("");

        const enableCb = UILib.input({ type: "checkbox" });
        enableCb.checked = this.ospf.enabled;
        enableCb.addEventListener("change", () => {
            this.ospf.setEnabled(enableCb.checked);
            this._renderOSPFLog();
        });
        configSection.appendChild(UILib.div("hr-checkbox-row", [enableCb, UILib.el("span", { text: t("router.ospf.enabled") })]));

        const ridInput = UILib.input({ placeholder: t("router.ospf.routerid.auto"), className: "router-input-rid" });
        if (this.ospf._routerIdOverride !== null) {
            ridInput.value = new (/** @type {any} */ (IPAddress))(4, this.ospf._routerIdOverride).toString();
        }
        ridInput.addEventListener("change", () => {
            const v = ridInput.value.trim();
            if (!v) {
                this.ospf._routerIdOverride = null;
            } else {
                try {
                    const ip = IPAddress.fromString(v);
                    if (ip.isV4()) this.ospf._routerIdOverride = /** @type {number} */ (ip.getNumber()) >>> 0;
                } catch { /* ignore */ }
            }
        });
        configSection.appendChild(UILib.div("cfg-fields", [
            UILib.el("div", { className: "cfg-field", children: [
                UILib.el("span", { text: t("router.ospf.routerid"), className: "router-if-field-label" }),
                ridInput,
            ]}),
        ]));

        const ifTable = document.createElement("table");
        ifTable.className = "router-routes";
        ifTable.style.marginTop = "8px";
        const ifThead = document.createElement("thead");
        const ifHtr   = document.createElement("tr");
        const ifThIf  = document.createElement("th"); ifThIf.textContent  = t("router.ospf.col.interface");
        const ifThPas = document.createElement("th"); ifThPas.textContent = t("router.ospf.col.passive");
        const ifThAr  = document.createElement("th"); ifThAr.textContent  = t("router.ospf.area");
        ifHtr.append(ifThIf, ifThPas, ifThAr);
        ifThead.appendChild(ifHtr);
        const ifTbody = document.createElement("tbody");
        for (const iface of this.net.interfaces) {
            const ifName = iface.name;
            const tr  = document.createElement("tr");
            const tdN = document.createElement("td"); tdN.textContent = ifName;
            const tdP = document.createElement("td");
            const cb  = UILib.input({ type: "checkbox" });
            cb.checked = this.ospf.passiveInterfaces.has(ifName);
            cb.addEventListener("change", () => this.ospf.setPassive(ifName, cb.checked));
            tdP.appendChild(cb);
            const tdA  = document.createElement("td");
            const aIn  = UILib.input({ type: "number", min: "0", className: "router-input-area" });
            aIn.value  = String(this.ospf._ifaceAreaMap.get(ifName) ?? 0);
            aIn.addEventListener("change", () => {
                const v = parseInt(aIn.value, 10);
                this.ospf.setIfaceArea(ifName, isNaN(v) ? 0 : v);
            });
            tdA.appendChild(aIn);
            tr.append(tdN, tdP, tdA);
            ifTbody.appendChild(tr);
        }
        ifTable.append(ifThead, ifTbody);
        const ospfIfScroll = UILib.div("sim-table-scroll");
        ospfIfScroll.appendChild(ifTable);
        configSection.appendChild(UILib.wrapWithScrollHints(ospfIfScroll));

        // ── Status ───────────────────────────────────────────────────────
        const statusSection = UILib.div("hidden");

        statusSection.appendChild(UILib.el("span", { text: t("router.ospf.ifstatus"), className: "hr-section-title" }));
        const ifStatusTable = document.createElement("table");
        ifStatusTable.className = "router-routes";
        const ifStatusThead = document.createElement("thead");
        const ifStatusHtr   = document.createElement("tr");
        for (const col of [
            t("router.ospf.col.interface"),
            t("router.ospf.col.ifstate"),
            t("router.ospf.col.dr"),
            t("router.ospf.col.bdr"),
        ]) { const th = document.createElement("th"); th.textContent = col; ifStatusHtr.appendChild(th); }
        ifStatusThead.appendChild(ifStatusHtr);
        const ifStatusTbody = document.createElement("tbody");
        ifStatusTable.append(ifStatusThead, ifStatusTbody);
        const ospfIfStatusScroll = UILib.div("sim-table-scroll");
        ospfIfStatusScroll.appendChild(ifStatusTable);
        statusSection.appendChild(UILib.wrapWithScrollHints(ospfIfStatusScroll));

        statusSection.appendChild(UILib.el("span", { text: t("router.ospf.neighbors"), className: "hr-section-title" }));
        const nbTable = document.createElement("table");
        nbTable.className = "router-routes";
        const nbThead = document.createElement("thead");
        const nbHtr   = document.createElement("tr");
        for (const col of [
            t("router.ospf.col.interface"),
            t("router.ospf.col.neighbor"),
            t("router.ospf.col.state"),
            t("router.ospf.col.priority"),
            t("router.ospf.col.dead"),
        ]) { const th = document.createElement("th"); th.textContent = col; nbHtr.appendChild(th); }
        nbThead.appendChild(nbHtr);
        const nbTbody = document.createElement("tbody");
        nbTable.append(nbThead, nbTbody);
        const ospfNbScroll = UILib.div("sim-table-scroll");
        ospfNbScroll.appendChild(nbTable);
        statusSection.appendChild(UILib.wrapWithScrollHints(ospfNbScroll));

        // ── LSDB ─────────────────────────────────────────────────────────
        const lsdbSection = UILib.div("hidden");
        const lsdbTable = document.createElement("table");
        lsdbTable.className = "router-routes";
        const lsdbThead = document.createElement("thead");
        const lsdbHtr   = document.createElement("tr");
        for (const col of [
            t("router.ospf.col.lstype"),
            t("router.ospf.col.lsid"),
            t("router.ospf.col.advrtr"),
            t("router.ospf.col.age"),
            t("router.ospf.col.seqnum"),
        ]) { const th = document.createElement("th"); th.textContent = col; lsdbHtr.appendChild(th); }
        lsdbThead.appendChild(lsdbHtr);
        const lsdbTbody = document.createElement("tbody");
        lsdbTable.append(lsdbThead, lsdbTbody);
        const lsdbScroll = UILib.div("sim-table-scroll");
        lsdbScroll.appendChild(lsdbTable);
        lsdbSection.appendChild(UILib.wrapWithScrollHints(lsdbScroll));

        // ── Log ───────────────────────────────────────────────────────────
        const logSection = UILib.div("hidden");
        const ospfLogEl = /** @type {HTMLTextAreaElement} */ (UILib.el("textarea", {
            className: "log router-log-md",
            attrs: { readonly: "true", spellcheck: "false" },
        }));
        logSection.appendChild(ospfLogEl);
        this._ospfLogEl = ospfLogEl;
        this._renderOSPFLog();

        // ── shared render helpers ─────────────────────────────────────────
        const n2s = (/** @type {number} */ n) => n ? new IPAddress(4, n >>> 0).toString() : "—";
        const mkTd = (/** @type {string} */ v) => {
            const td = document.createElement("td"); td.textContent = v; return td;
        };
        const emptyRow = (/** @type {HTMLElement} */ tbody, /** @type {number} */ cols) => {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = cols; td.textContent = "—";
            td.className = "router-lsdb-empty-td";
            tr.appendChild(td); tbody.appendChild(tr);
        };

        const renderAll = () => {
            // interface status
            ifStatusTbody.innerHTML = "";
            for (const [ifIndex, oif] of this.ospf._ifaces) {
                const ifName = this.net.interfaces[ifIndex]?.name ?? `eth${ifIndex}`;
                const tr = document.createElement("tr");
                tr.append(mkTd(ifName), mkTd(oif.state), mkTd(n2s(oif.dr)), mkTd(n2s(oif.bdr)));
                ifStatusTbody.appendChild(tr);
            }
            if (ifStatusTbody.childElementCount === 0) emptyRow(ifStatusTbody, 4);

            // neighbors
            nbTbody.innerHTML = "";
            for (const [ifIndex, oif] of this.ospf._ifaces) {
                const ifName = this.net.interfaces[ifIndex]?.name ?? `eth${ifIndex}`;
                for (const [, nb] of oif.neighbors) {
                    const tr = document.createElement("tr");
                    const elapsedMs = (simTimer.currentTick - nb.lastHelloTick) * SimTimer.SIM_MS_PER_TICK;
                    const remaining = Math.max(0, SimTimer.OSPF_DEAD_MS - elapsedMs);
                    const pct       = Math.round(remaining / SimTimer.OSPF_DEAD_MS * 100);
                    const barColor  = pct > 50 ? "#4caf50" : pct > 25 ? "#ff9800" : "#f44336";
                    const deadTd    = document.createElement("td");
                    deadTd.innerHTML =
                        `<div style="display:flex;align-items:center;gap:4px">` +
                        `<div style="width:36px;height:5px;background:#e0e0e0;border-radius:3px;flex-shrink:0">` +
                        `<div style="width:${pct}%;height:100%;background:${barColor};border-radius:3px"></div></div>` +
                        `<span style="font-size:0.85em">${(remaining / 1000).toFixed(1)}s</span></div>`;
                    tr.append(mkTd(ifName), mkTd(nb.ip.toString()), mkTd(nb.state),
                              mkTd(String(nb.priority)), deadTd);
                    nbTbody.appendChild(tr);
                }
            }
            if (nbTbody.childElementCount === 0) emptyRow(nbTbody, 5);

            // LSDB
            lsdbTbody.innerHTML = "";
            const myRid = this.ospf._myRouterId;
            const lsaTypeLabel = (/** @type {number} */ t) => t === 1 ? "Router" : t === 2 ? "Network" : String(t);
            const seqHex = (/** @type {number} */ s) => "0x" + (s >>> 0).toString(16).padStart(8, "0").toUpperCase();
            for (const [, areaLsdb] of this.ospf._lsdbByArea) for (const [, entry] of areaLsdb) {
                const h   = entry.header;
                const tr  = document.createElement("tr");
                const own = h.advertisingRouter === myRid;
                if (own) tr.classList.add("router-own-row");
                tr.append(
                    mkTd(lsaTypeLabel(h.type)),
                    mkTd(n2s(h.lsId)),
                    mkTd(n2s(h.advertisingRouter) + (own ? " ★" : "")),
                    mkTd(String(h.age)),
                    mkTd(seqHex(h.seqNum)),
                );
                lsdbTbody.appendChild(tr);
            }
            if (lsdbTbody.childElementCount === 0) emptyRow(lsdbTbody, 5);
        };

        renderAll();
        this._ospfPollTimer.stop();
        this._ospfPollTimer.start(renderAll, 1000);

        host.append(configSection, statusSection, lsdbSection, logSection);
        setInnerActive("config");

        this.ospf.onLogUpdate = () => this._renderOSPFLog();
    }

    _renderOSPFLog() {
        if (!this._ospfLogEl) return;
        const lines = this.ospf.log;
        const max   = 200;
        this._ospfLogEl.value = (lines.length > max ? lines.slice(-max) : lines).join("\n");
        this._ospfLogEl.scrollTop = this._ospfLogEl.scrollHeight;
    }

    /* ----------------------------- VPN tab ----------------------------- */

    /** @param {HTMLElement} host */
    _buildVPNSection(host) {
        UILib.clear(host);

        const listEl = UILib.div("router-vpn-list");

        const renderList = () => {
            UILib.clear(listEl);
            if (this.net.tunnels.length === 0) {
                listEl.appendChild(UILib.el("p", { text: t("router.vpn.empty"), className: "router-vpn-empty" }));
                return;
            }
            for (const tun of this.net.tunnels) {
                const routes = this.net.routingTable.filter(r => r.tunnel === tun);
                const netStr = routes.map(r => `${r.dst}/${r.prefixLength}`).join(", ") || "—";

                const delBtn = UILib.button(t("router.vpn.delete"), null, { className: "router-vpn-del" });
                delBtn.addEventListener("click", () => {
                    this.net.removeTunnel(tun.name);
                    renderList();
                    this._renderRoutes();
                });

                const row = UILib.div("router-vpn-row", [
                    UILib.el("span", { text: tun.name,                      className: "router-vpn-name"   }),
                    UILib.el("span", { text: tun.remoteEndpoint.toString(),  className: "router-vpn-remote" }),
                    UILib.el("span", { text: netStr,                         className: "router-vpn-net"    }),
                    delBtn,
                ]);
                listEl.appendChild(row);
            }
        };

        renderList();
        host.appendChild(listEl);

        // ── Add-tunnel form ──
        const nameIn   = UILib.input({ placeholder: "vpn0" });
        const remoteIn = UILib.input({ placeholder: "203.0.113.1" });
        const netIn    = UILib.input({ placeholder: "10.0.0.0/24" });
        const errEl    = UILib.el("p", { className: "router-vpn-err" });
        const addBtn = UILib.button(t("router.vpn.add"));

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
                errEl.textContent = e instanceof Error ? e.message : String(e);
            }
        });

        host.appendChild(UILib.el("div", { className: "hr-section", children: [
            UILib.div("cfg-fields", [
                UILib.el("div", { className: "cfg-field hr-field-sm", children: [
                    UILib.el("span", { text: t("router.vpn.name"), className: "router-if-field-label" }),
                    nameIn,
                ]}),
                UILib.el("div", { className: "cfg-field", children: [
                    UILib.el("span", { text: t("router.vpn.remote"), className: "router-if-field-label" }),
                    remoteIn,
                ]}),
                UILib.el("div", { className: "cfg-field", children: [
                    UILib.el("span", { text: t("router.vpn.network"), className: "router-if-field-label" }),
                    netIn,
                ]}),
            ]),
            UILib.div("hr-btn-row", [addBtn]),
            errEl,
        ]}));
    }

    // ── DHCPv6-PD UI ─────────────────────────────────────────────────────────

    /** @param {HTMLElement} host */
    /** @param {HTMLElement} host */
    _buildDHCPv6PDSection(host) {
        const serverPane = UILib.div("");
        const clientPane = UILib.div("hidden");

        const { bar: innerTabBar } = UILib.tabGroup([
            { id: "server", label: t("router.pd6.server.tab") },
            { id: "client", label: t("router.pd6.client.tab") },
        ], (id) => {
            serverPane.classList.toggle("hidden", id !== "server");
            clientPane.classList.toggle("hidden", id !== "client");
        });

        host.appendChild(innerTabBar);
        host.appendChild(serverPane);
        host.appendChild(clientPane);

        this._buildPD6ServerTab(serverPane);
        this._buildPD6ClientTab(clientPane);
    }

    /** @param {HTMLElement} host */
    _buildPD6ServerTab(host) {
        const field = (/** @type {string} */ label, /** @type {HTMLElement} */ inp) => UILib.el("div", {
            className: "cfg-field",
            children: [UILib.el("span", { text: label, className: "router-if-field-label" }), inp],
        });

        const enabledCb  = UILib.input({ type: "checkbox" });
        enabledCb.checked = this._pd6Enabled;
        const poolIn     = UILib.input({ placeholder: "2001:db8:100::", value: this._pd6Pool?.toString() ?? "" });
        const poolLenIn  = UILib.input({ placeholder: "48",   value: String(this._pd6PoolLength) });
        const delegLenIn = UILib.input({ placeholder: "56",   value: String(this._pd6DelegatedLength) });
        const leaseIn    = UILib.input({ placeholder: "3600", value: String(this._pd6LeaseTime) });
        const errEl      = UILib.el("p", { className: "router-vpn-err" });

        const tbody = UILib.el("tbody");
        const renderLeases = () => {
            this._pd6CleanupExpired();
            tbody.innerHTML = "";
            const now = Date.now();
            if (this._pd6Leases.size === 0) {
                const td = UILib.el("td", { text: t("router.pd6.leases.empty"), className: "router-muted-cell" });
                td.setAttribute("colspan", "3");
                tbody.appendChild(UILib.el("tr", { children: [td] }));
            } else {
                for (const [duid, lease] of this._pd6Leases) {
                    const pfx = (IPAddress.fromUInt8(lease.prefix16bytes)?.toString() ?? "?") + "/" + lease.prefixLen;
                    const sec = Math.max(0, Math.round((lease.expiresAt - now) / 1000));
                    const exp = sec > 60 ? `${Math.floor(sec/60)}m ${sec%60}s` : `${sec}s`;
                    tbody.appendChild(UILib.el("tr", { children: [
                        UILib.el("td", { text: "…" + duid.slice(-12), attrs: { title: duid } }),
                        UILib.el("td", { text: pfx }),
                        UILib.el("td", { text: exp }),
                    ]}));
                }
            }
        };

        const applyBtn = UILib.button(t("router.apply"));
        applyBtn.addEventListener("click", () => {
            errEl.textContent = "";
            try {
                let pool;
                try { pool = IPAddress.fromString(poolIn.value.trim()); } catch { throw new Error(t("router.pd6.err.pool")); }
                if (!pool.isV6()) throw new Error(t("router.pd6.err.pool"));
                const pl = Number(poolLenIn.value.trim());
                if (!Number.isInteger(pl) || pl < 1 || pl > 64) throw new Error(t("router.pd6.err.poolLen"));
                const dl = Number(delegLenIn.value.trim());
                if (!Number.isInteger(dl) || dl <= pl || dl > 128) throw new Error(t("router.pd6.err.delegLen"));
                const lt = Number(leaseIn.value.trim());
                if (!Number.isFinite(lt) || lt <= 0) throw new Error(t("router.pd6.err.leaseTime"));

                this._pd6Pool            = pool;
                this._pd6PoolLength      = pl;
                this._pd6DelegatedLength = dl;
                this._pd6LeaseTime       = Math.floor(lt);

                const wasEnabled = this._pd6Enabled;
                this._pd6Enabled = enabledCb.checked;
                if (this._pd6Enabled && !wasEnabled) void this._pd6Start();
                else if (!this._pd6Enabled && wasEnabled) this._pd6Stop();
                renderLeases();
            } catch (e) {
                errEl.textContent = String(/** @type {any} */ (e)?.message ?? e);
            }
        });

        host.appendChild(UILib.el("div", { className: "hr-section", children: [
            UILib.div("hr-checkbox-row", [enabledCb, UILib.el("span", { text: t("router.pd6.enabled") })]),
            UILib.div("cfg-fields", [
                field(t("router.pd6.pool"),            poolIn),
                field(t("router.pd6.poolLength"),      poolLenIn),
                field(t("router.pd6.delegatedLength"), delegLenIn),
                field(t("router.pd6.leaseTime"),       leaseIn),
            ]),
            UILib.div("hr-btn-row", [applyBtn]),
            errEl,
        ]}));

        const table = UILib.el("table", { className: "router-routes-table" });
        const thead = UILib.el("thead");
        thead.innerHTML = `<tr><th>DUID</th><th>${t("router.pd6.col.prefix")}</th><th>${t("router.pd6.col.expires")}</th></tr>`;
        table.appendChild(thead);
        table.appendChild(tbody);
        renderLeases();

        host.appendChild(UILib.el("div", { className: "hr-section", children: [
            UILib.el("span", { text: t("router.pd6.leases"), className: "hr-section-title" }),
            table,
        ]}));

        const tid = window.setInterval(() => {
            if (!this._panelBody?.contains(host)) { window.clearInterval(tid); return; }
            renderLeases();
        }, 2000);
    }

    /** @param {HTMLElement} host */
    _buildPD6ClientTab(host) {
        const field = (/** @type {string} */ label, /** @type {HTMLElement} */ inp) => UILib.el("div", {
            className: "cfg-field",
            children: [UILib.el("span", { text: label, className: "router-if-field-label" }), inp],
        });

        const enabledCb = UILib.input({ type: "checkbox" });
        enabledCb.checked = this._pd6ClientEnabled;

        // Interface-Selektor
        const ifSel = /** @type {HTMLSelectElement} */ (UILib.el("select"));
        const rebuildIfSel = () => {
            ifSel.innerHTML = "";
            this.net.interfaces.forEach((iface, i) => {
                const o = UILib.el("option", { text: iface.name, attrs: { value: String(i) } });
                ifSel.appendChild(o);
            });
            ifSel.value = String(this._pd6ClientIfIndex);
        };
        rebuildIfSel();

        const errEl = UILib.el("p", { className: "router-vpn-err" });

        // Status-Anzeige
        const statusEl = UILib.el("div", { className: "hr-info-row" });
        const renderStatus = () => {
            statusEl.innerHTML = "";
            const pd = this._pd6ClientDelegated;
            const text = pd
                ? `${IPAddress.fromUInt8(pd.prefix16bytes)?.toString() ?? "?"}/${pd.prefixLen}`
                : t("router.pd6.client.none");
            statusEl.appendChild(UILib.el("span", { text: t("router.pd6.client.delegated"), className: "hr-info-label" }));
            statusEl.appendChild(UILib.el("span", { text, className: "hr-info-value" }));
        };
        renderStatus();

        const applyBtn = UILib.button(t("router.apply"));
        applyBtn.addEventListener("click", () => {
            errEl.textContent = "";
            const ifIdx = parseInt(ifSel.value) | 0;
            const wasEnabled = this._pd6ClientEnabled;
            this._pd6ClientEnabled = enabledCb.checked;
            this._pd6ClientIfIndex = ifIdx;

            if (this._pd6ClientEnabled) {
                void this._pd6ClientStart();
            } else if (wasEnabled) {
                this._pd6ClientStop();
            }
            renderStatus();
        });

        host.appendChild(UILib.el("div", { className: "hr-section", children: [
            UILib.div("hr-checkbox-row", [enabledCb, UILib.el("span", { text: t("router.pd6.client.enabled") })]),
            UILib.div("cfg-fields", [field(t("router.pd6.client.interface"), ifSel)]),
            statusEl,
            UILib.div("hr-btn-row", [applyBtn]),
            errEl,
        ]}));

        const tid = window.setInterval(() => {
            if (!this._panelBody?.contains(host)) { window.clearInterval(tid); return; }
            renderStatus();
        }, 2000);
    }

    // ── DHCPv6-PD Logik ──────────────────────────────────────────────────────

    /** @returns {Uint8Array} */
    _pd6BuildDUID() {
        const m = this.net.interfaces[0]?.mac;
        if (m instanceof Uint8Array && m.length === 6) return DHCPv6Packet.buildDUID_LL(m);
        return new Uint8Array([0, 2, 0, 0, 0, 9, 0, 0, 0, 0]);
    }

    async _pd6Start() {
        if (this._pd6Running) return;
        try {
            const anyV6 = IPAddress.fromString("::");
            if (!anyV6) return;
            this._pd6Socket = this.net.openUDPSocket(anyV6, 547);
            this._pd6DUID   = this._pd6BuildDUID();
            this._pd6Running = true;
            void this._pd6RecvLoop();
        } catch {}
    }

    _pd6Stop() {
        if (!this._pd6Running && this._pd6Socket == null) return;
        this._pd6Running = false;
        const sock = this._pd6Socket;
        this._pd6Socket = null;
        if (sock != null) try { this.net.closeUDPSocket(sock); } catch {}
        // Alle Routen entfernen
        for (const lease of this._pd6Leases.values()) this._pd6RemoveRoute(lease);
        this._pd6Leases.clear();
        this._pd6Allocated.clear();
        this._pd6NextIndex = 0;
    }

    async _pd6RecvLoop() {
        while (this._pd6Running && this._pd6Socket != null) {
            const sock = this._pd6Socket;
            /** @type {any} */ let pkt;
            try { pkt = await this.net.recvUDPSocket(sock); } catch { continue; }
            if (!this._pd6Running || this._pd6Socket == null) break;
            if (pkt == null) break;
            const srcIP = (pkt.src instanceof IPAddress) ? pkt.src : null;
            if (!srcIP) continue;
            const data = pkt.payload instanceof Uint8Array ? pkt.payload : new Uint8Array();
            let dhcp6;
            try { dhcp6 = DHCPv6Packet.fromBytes(data); } catch { continue; }
            await this._pd6HandleMessage(sock, dhcp6, srcIP, typeof pkt.srcPort === "number" ? pkt.srcPort : 546, typeof pkt.recvIfIndex === "number" ? pkt.recvIfIndex : -1);
        }
    }

    /**
     * @param {number} sock
     * @param {DHCPv6Packet} req
     * @param {IPAddress} srcIP
     * @param {number} srcPort
     * @param {number} recvIfIndex
     */
    async _pd6HandleMessage(sock, req, srcIP, srcPort, recvIfIndex) {
        if (!this._pd6Enabled || !this._pd6Pool) return;
        const clientDUID = req.getOption(DHCPv6Packet.OPT_CLIENTID);
        if (!clientDUID) return;
        if (!req.getOption(DHCPv6Packet.OPT_IA_PD)) return;

        this._pd6CleanupExpired();
        const duidKey = DHCPv6Packet.duidToHex(clientDUID);

        if (req.msgType === DHCPv6Packet.MT_SOLICIT) {
            const lease = this._pd6AllocOrReuse(duidKey);
            if (!lease) return;
            const reply = this._pd6BuildReply(DHCPv6Packet.MT_ADVERTISE, req, clientDUID, lease);
            try { this.net.sendUDPSocket(sock, srcIP, srcPort, reply.pack()); } catch {}

        } else if (req.msgType === DHCPv6Packet.MT_REQUEST || req.msgType === DHCPv6Packet.MT_RENEW) {
            if (req.msgType === DHCPv6Packet.MT_REQUEST) {
                const sid = req.getOption(DHCPv6Packet.OPT_SERVERID);
                if (!sid || !this._pd6DUID || !_pd6ArrEq(sid, this._pd6DUID)) return;
            }
            const lease = this._pd6CommitLease(duidKey, recvIfIndex, srcIP);
            if (!lease) return;
            const reply = this._pd6BuildReply(DHCPv6Packet.MT_REPLY, req, clientDUID, lease);
            try { this.net.sendUDPSocket(sock, srcIP, srcPort, reply.pack()); } catch {}

        } else if (req.msgType === DHCPv6Packet.MT_RELEASE) {
            const lease = this._pd6Leases.get(duidKey);
            if (lease) {
                this._pd6RemoveRoute(lease);
                this._pd6Allocated.delete(lease.index);
                this._pd6Leases.delete(duidKey);
            }
            const reply = new DHCPv6Packet({ msgType: DHCPv6Packet.MT_REPLY, transactionId: req.transactionId });
            if (this._pd6DUID) reply.setOption(DHCPv6Packet.OPT_SERVERID, this._pd6DUID);
            reply.setOption(DHCPv6Packet.OPT_CLIENTID, clientDUID);
            reply.setOption(DHCPv6Packet.OPT_STATUS_CODE, new Uint8Array([0, DHCPv6Packet.STATUS_SUCCESS]));
            try { this.net.sendUDPSocket(sock, srcIP, srcPort, reply.pack()); } catch {}
        }
    }

    /** @param {string} duidKey */
    _pd6AllocOrReuse(duidKey) {
        const ex = this._pd6Leases.get(duidKey);
        if (ex && ex.expiresAt > Date.now()) return ex;
        if (!this._pd6Pool) return null;
        const poolBytes = _pd6MaskPrefix(this._pd6Pool.toUInt8(), this._pd6PoolLength);
        const subnetBits = this._pd6DelegatedLength - this._pd6PoolLength;
        if (subnetBits <= 0 || subnetBits > 24) return null;
        const maxSlots = 1 << subnetBits;
        for (let tries = 0; tries < maxSlots; tries++) {
            const index = this._pd6NextIndex % maxSlots;
            this._pd6NextIndex = (this._pd6NextIndex + 1) % maxSlots;
            if (this._pd6Allocated.has(index)) continue;
            const prefix16bytes = _pd6BuildDelegatedPrefix(poolBytes, this._pd6PoolLength, this._pd6DelegatedLength, index);
            this._pd6Allocated.add(index);
            const lease = { prefix16bytes, prefixLen: this._pd6DelegatedLength, index, expiresAt: Date.now() + 60_000, ifIndex: -1, clientLL: /** @type {IPAddress|null} */ (null) };
            this._pd6Leases.set(duidKey, lease);
            return lease;
        }
        return null;
    }

    /**
     * @param {string} duidKey
     * @param {number} ifIndex
     * @param {IPAddress} clientLL
     */
    _pd6CommitLease(duidKey, ifIndex, clientLL) {
        const prev = this._pd6Leases.get(duidKey);
        if (prev) {
            const oldIfIndex = prev.ifIndex, oldLL = prev.clientLL;
            prev.expiresAt = Date.now() + this._pd6LeaseTime * 1000;
            prev.ifIndex   = ifIndex;
            prev.clientLL  = clientLL;
            // Alte Route entfernen, neue installieren
            if (oldIfIndex >= 0 && oldLL) {
                const pfx = IPAddress.fromUInt8(prev.prefix16bytes);
                if (pfx) try { this.net.delRoute(pfx, prev.prefixLen, oldIfIndex, oldLL); } catch {}
            }
            this._pd6InstallRoute(prev);
            return prev;
        }
        const lease = this._pd6AllocOrReuse(duidKey);
        if (!lease) return null;
        lease.expiresAt = Date.now() + this._pd6LeaseTime * 1000;
        lease.ifIndex   = ifIndex;
        lease.clientLL  = clientLL;
        this._pd6InstallRoute(lease);
        return lease;
    }

    /** @param {{prefix16bytes:Uint8Array,prefixLen:number,ifIndex:number,clientLL:IPAddress|null}} lease */
    _pd6InstallRoute(lease) {
        if (lease.ifIndex < 0 || !lease.clientLL) return;
        const pfx = IPAddress.fromUInt8(lease.prefix16bytes);
        if (!pfx) return;
        this.net.addRoute(pfx, lease.prefixLen, lease.ifIndex, lease.clientLL, "dhcp6pd");
    }

    /** @param {{prefix16bytes:Uint8Array,prefixLen:number,ifIndex:number,clientLL:IPAddress|null}} lease */
    _pd6RemoveRoute(lease) {
        if (lease.ifIndex < 0 || !lease.clientLL) return;
        const pfx = IPAddress.fromUInt8(lease.prefix16bytes);
        if (!pfx) return;
        try { this.net.delRoute(pfx, lease.prefixLen, lease.ifIndex, lease.clientLL); } catch {}
    }

    _pd6CleanupExpired() {
        const now = Date.now();
        for (const [duid, lease] of this._pd6Leases) {
            if (lease.expiresAt <= now) {
                this._pd6RemoveRoute(lease);
                this._pd6Allocated.delete(lease.index);
                this._pd6Leases.delete(duid);
            }
        }
    }

    /**
     * @param {number} msgType
     * @param {DHCPv6Packet} req
     * @param {Uint8Array} clientDUID
     * @param {{prefix16bytes:Uint8Array,prefixLen:number}} lease
     * @returns {DHCPv6Packet}
     */
    _pd6BuildReply(msgType, req, clientDUID, lease) {
        const reply = new DHCPv6Packet({ msgType, transactionId: req.transactionId });
        if (this._pd6DUID) reply.setOption(DHCPv6Packet.OPT_SERVERID, this._pd6DUID);
        reply.setOption(DHCPv6Packet.OPT_CLIENTID, clientDUID);

        const preferred = (this._pd6LeaseTime * 0.5) >>> 0;
        const valid     = this._pd6LeaseTime >>> 0;
        const t1        = preferred;
        const t2        = (this._pd6LeaseTime * 0.8) >>> 0;

        const reqIaPD = req.getOption(DHCPv6Packet.OPT_IA_PD);
        const iaid = (reqIaPD && reqIaPD.length >= 4)
            ? (((reqIaPD[0]<<24)|(reqIaPD[1]<<16)|(reqIaPD[2]<<8)|reqIaPD[3])>>>0) : 1;

        const iaPrefixData   = DHCPv6Packet.buildIAPrefix(preferred, valid, lease.prefixLen, lease.prefix16bytes);
        const iaPrefixOption = DHCPv6Packet.encodeOption(DHCPv6Packet.OPT_IAPREFIX, iaPrefixData);
        reply.setOption(DHCPv6Packet.OPT_IA_PD, DHCPv6Packet.buildIA_PD(iaid, t1, t2, iaPrefixOption));
        return reply;
    }

    // ── DHCPv6-PD Client-Logik ───────────────────────────────────────────────

    async _pd6ClientStart() {
        this._pd6ClientStop();
        try {
            const anyV6 = IPAddress.fromString("::");
            if (!anyV6) return;
            this._pd6ClientSocket  = this.net.openUDPSocket(anyV6, 546);
            this._pd6ClientRunning = true;
            void this._pd6ClientRecvLoop();
            void this._pd6ClientRun();
        } catch {}
    }

    _pd6ClientStop() {
        this._pd6ClientRunning  = false;
        this._pd6ClientCallback = null;
        this._pd6ClientDelegated = null;
        const sock = this._pd6ClientSocket;
        this._pd6ClientSocket = null;
        if (sock != null) try { this.net.closeUDPSocket(sock); } catch {}
    }

    async _pd6ClientRecvLoop() {
        while (this._pd6ClientRunning && this._pd6ClientSocket != null) {
            const sock = this._pd6ClientSocket;
            /** @type {any} */ let pkt;
            try { pkt = await this.net.recvUDPSocket(sock); } catch { continue; }
            if (!this._pd6ClientRunning || this._pd6ClientSocket == null) break;
            if (pkt == null) break;
            const data = pkt.payload instanceof Uint8Array ? pkt.payload : new Uint8Array();
            let dhcp6;
            try { dhcp6 = DHCPv6Packet.fromBytes(data); } catch { continue; }
            const tx = this._pd6ClientTxId;
            if (dhcp6.transactionId[0] !== tx[0] ||
                dhcp6.transactionId[1] !== tx[1] ||
                dhcp6.transactionId[2] !== tx[2]) continue;
            if (this._pd6ClientCallback) {
                this._pd6ClientCallback(dhcp6);
                this._pd6ClientCallback = null;
            }
        }
    }

    /** Run SOLICIT → ADVERTISE → REQUEST → REPLY, then schedule renewal. */
    async _pd6ClientRun() {
        if (!this._pd6ClientRunning) return;
        this._pd6ClientDelegated = null;

        crypto.getRandomValues(this._pd6ClientTxId);
        const txId = this._pd6ClientTxId;
        const iaid = 1;
        const clientDUID = this._pd6BuildDUID();

        // SOLICIT
        const solicit = new DHCPv6Packet({ msgType: DHCPv6Packet.MT_SOLICIT, transactionId: txId });
        solicit.setOption(DHCPv6Packet.OPT_CLIENTID, clientDUID);
        solicit.setOption(DHCPv6Packet.OPT_IA_PD, DHCPv6Packet.buildIA_PD(iaid, 0, 0, new Uint8Array(0)));
        this._pd6ClientSend(solicit);

        // Wait for ADVERTISE
        let advertise = /** @type {DHCPv6Packet|null} */ (null);
        try {
            advertise = await new Promise((resolve, reject) => {
                const tid = simTimer.schedule(() => reject(new Error("timeout")), SimTimer.DHCP_OFFER_WAIT_MS);
                this._pd6ClientCallback = (pkt) => { simTimer.cancel(tid); resolve(pkt); };
            });
        } catch { return; }
        if (!advertise || advertise.msgType !== DHCPv6Packet.MT_ADVERTISE) return;

        // Parse IAPREFIX from ADVERTISE
        const iaPDAdv = advertise.getOption(DHCPv6Packet.OPT_IA_PD);
        if (!iaPDAdv || iaPDAdv.length < 12) return;
        const parsedIaPD = DHCPv6Packet.parseIA_PD(iaPDAdv);

        let iaPrefixData = /** @type {Uint8Array|null} */ (null);
        let off = 0;
        while (off + 4 <= parsedIaPD.iaOptions.length) {
            const code = (parsedIaPD.iaOptions[off] << 8) | parsedIaPD.iaOptions[off + 1];
            const len  = (parsedIaPD.iaOptions[off + 2] << 8) | parsedIaPD.iaOptions[off + 3];
            off += 4;
            if (code === DHCPv6Packet.OPT_IAPREFIX && len >= 25) { iaPrefixData = parsedIaPD.iaOptions.slice(off, off + len); break; }
            off += len;
        }
        if (!iaPrefixData) return;
        const prefixInfo = DHCPv6Packet.parseIAPrefix(iaPrefixData);
        const serverDUID = advertise.getOption(DHCPv6Packet.OPT_SERVERID);

        // REQUEST
        const preferred = prefixInfo.preferred || 1800;
        const valid     = prefixInfo.valid     || 3600;
        const request   = new DHCPv6Packet({ msgType: DHCPv6Packet.MT_REQUEST, transactionId: txId });
        request.setOption(DHCPv6Packet.OPT_CLIENTID, clientDUID);
        if (serverDUID) request.setOption(DHCPv6Packet.OPT_SERVERID, serverDUID);
        const iaPrefixOpt = DHCPv6Packet.buildIAPrefix(preferred, valid, prefixInfo.prefixLength, prefixInfo.prefix16bytes);
        const iaPrefixEnc = DHCPv6Packet.encodeOption(DHCPv6Packet.OPT_IAPREFIX, iaPrefixOpt);
        request.setOption(DHCPv6Packet.OPT_IA_PD, DHCPv6Packet.buildIA_PD(iaid, (preferred / 2) >>> 0, (valid * 0.8) >>> 0, iaPrefixEnc));
        this._pd6ClientSend(request);

        // Wait for REPLY
        let reply = /** @type {DHCPv6Packet|null} */ (null);
        try {
            reply = await new Promise((resolve, reject) => {
                const tid = simTimer.schedule(() => reject(new Error("timeout")), SimTimer.DHCP_ACK_WAIT_MS);
                this._pd6ClientCallback = (pkt) => { simTimer.cancel(tid); resolve(pkt); };
            });
        } catch { return; }
        if (!reply || reply.msgType !== DHCPv6Packet.MT_REPLY) return;

        this._pd6ClientDelegated = { prefix16bytes: prefixInfo.prefix16bytes, prefixLen: prefixInfo.prefixLength };

        // T1 aus REPLY lesen, Renewal planen
        const iaPDReply = reply.getOption(DHCPv6Packet.OPT_IA_PD);
        const t1Sec = (iaPDReply && iaPDReply.length >= 8)
            ? (((iaPDReply[4] << 24) | (iaPDReply[5] << 16) | (iaPDReply[6] << 8) | iaPDReply[7]) >>> 0)
            : (preferred >>> 1) || 1800;
        const t1SimMs = Math.max(SimTimer.DHCP_OFFER_WAIT_MS * 2, t1Sec * 1000);
        simTimer.schedule(() => {
            if (this._pd6ClientRunning && this._pd6ClientEnabled) void this._pd6ClientRun();
        }, t1SimMs);
    }

    /**
     * Sendet ein DHCPv6-Paket als SOLICIT/REQUEST (ff02::1:2, Port 547)
     * direkt über das konfigurierte Interface.
     * @param {DHCPv6Packet} pkt
     */
    _pd6ClientSend(pkt) {
        const iface = this.net.interfaces[this._pd6ClientIfIndex];
        if (!iface?.ip6LL || !iface.port) return;

        const allDhcp = IPAddress.fromString("ff02::1:2");
        if (!allDhcp) return;
        const dstMac = new Uint8Array([0x33, 0x33, 0x00, 0x01, 0x00, 0x02]);

        const payload = pkt.pack();
        const udpLen  = 8 + payload.length;
        const udpBytes = new Uint8Array(udpLen);
        udpBytes[0] = 0x02; udpBytes[1] = 0x22; // srcPort 546
        udpBytes[2] = 0x02; udpBytes[3] = 0x23; // dstPort 547
        udpBytes[4] = (udpLen >> 8) & 0xff; udpBytes[5] = udpLen & 0xff;
        udpBytes.set(payload, 8);

        const ipv6  = new IPv6Packet({ src: iface.ip6LL, dst: allDhcp, nextHeader: 17, hopLimit: 1, payload: udpBytes });
        const frame = new EthernetFrame({ dstMac, srcMac: iface.mac, etherType: 0x86DD, payload: ipv6.pack() });
        iface.port.send(frame);
    }

    /* ------------------------------ VRRP tab ------------------------------ */

    /** @param {HTMLElement} host */
    _buildVRRPSection(host) {
        const { bar: innerBar, setActive: setInnerActive } = UILib.tabGroup([
            { id: "config", label: t("router.vrrp.tab.config") },
            { id: "status", label: t("router.vrrp.tab.status") },
            { id: "log",    label: t("router.vrrp.tab.log")    },
        ], (id) => {
            configSection.classList.toggle("hidden", id !== "config");
            statusSection.classList.toggle("hidden", id !== "status");
            logSection.classList.toggle("hidden",    id !== "log");
            if (id === "status") this._renderVRRPStatus();
            if (id === "log")    this._renderVRRPLog();
        });
        host.appendChild(innerBar);

        // ── Config ────────────────────────────────────────────────────────────
        const configSection = UILib.div("");

        const groupsHost = UILib.div("router-routes");
        this._vrrpGroupsHost = groupsHost;

        const addBtn = UILib.button(`+ ${t("router.vrrp.add")}`, null, { className: "router-if-save" });
        const formHost = UILib.div("hidden");

        // Inline form
        const ifaceItems = this.net.interfaces.map((iface, idx) => ({ value: String(idx), label: iface.name }));
        const ifSel     = UILib.select(ifaceItems);
        const ipVerSel  = UILib.select([{ value: "4", label: "IPv4" }, { value: "6", label: "IPv6" }]);
        const vridIn    = UILib.input({ value: "1", placeholder: "1-255" });
        const vipIn     = UILib.input({ placeholder: "192.168.1.254" });
        const prioIn    = UILib.input({ value: "100", placeholder: "1-254" });
        const intIn     = UILib.input({ value: "1000", placeholder: "ms" });
        const preemptCb = UILib.input({ type: "checkbox" });
        preemptCb.checked = true;
        ipVerSel.addEventListener("change", () => {
            vipIn.placeholder = ipVerSel.value === "6" ? "fe80::1" : "192.168.1.254";
        });

        const cancelBtn = UILib.button(t("router.vrrp.cancel"), () => {
            formHost.classList.add("hidden");
            addBtn.classList.remove("hidden");
        });
        const okBtn = UILib.button(t("router.vrrp.ok"), () => {
            try {
                const ifIndex   = Number(ifSel.value);
                const ipVersion = Number(ipVerSel.value);
                const vrid      = Math.max(1, Math.min(255, parseInt(vridIn.value, 10)));
                const vip       = vipIn.value.trim();
                const prio      = Math.max(1, Math.min(254, parseInt(prioIn.value, 10)));
                const intMs     = Math.max(100, parseInt(intIn.value, 10));
                if (!vip || isNaN(vrid) || isNaN(prio) || isNaN(intMs)) return;
                this.vrrp.addGroup({ ifIndex, vrid, virtualIP: vip, priority: prio, advIntervalMs: intMs, preempt: preemptCb.checked, ipVersion });
                this.vrrp.start();
                this._renderVRRPGroups();
                formHost.classList.add("hidden");
                addBtn.classList.remove("hidden");
            } catch (e) { console.error("VRRP addGroup:", e); }
        });

        const mkRow = (/** @type {string} */ lbl, /** @type {HTMLElement} */ inp) =>
            UILib.div("cfg-field router-if-ip", [
                UILib.el("span", { text: lbl, className: "router-if-field-label" }),
                inp,
            ]);

        const preemptRow = UILib.div("hr-checkbox-row", [
            preemptCb,
            UILib.el("span", { text: t("router.vrrp.preempt") }),
        ]);

        formHost.append(
            UILib.div("panel", [
                UILib.div("cfg-fields router-if-fields", [
                    mkRow(t("router.vrrp.col.iface"),    ifSel),
                    mkRow(t("router.vrrp.col.ipversion"), ipVerSel),
                    mkRow(t("router.vrrp.col.vrid"),     vridIn),
                    mkRow(t("router.vrrp.col.virtualip"),vipIn),
                    mkRow(t("router.vrrp.col.priority"), prioIn),
                    mkRow(t("router.vrrp.col.interval"), intIn),
                ]),
                preemptRow,
                UILib.div("btn-row", [cancelBtn, okBtn]),
            ])
        );

        addBtn.addEventListener("click", () => {
            formHost.classList.remove("hidden");
            addBtn.classList.add("hidden");
        });

        configSection.append(addBtn, groupsHost, formHost);
        this._renderVRRPGroups();

        // ── Status ────────────────────────────────────────────────────────────
        const statusSection = UILib.div("hidden");
        const statusHost = UILib.div("router-routes");
        this._vrrpStatusHost = statusHost;
        statusSection.appendChild(statusHost);

        // ── Log ───────────────────────────────────────────────────────────────
        const logSection = UILib.div("hidden");
        const logEl = /** @type {HTMLTextAreaElement} */ (UILib.el("textarea", {
            className: "log router-log-md",
            attrs: { readonly: "true", spellcheck: "false" },
        }));
        logSection.appendChild(logEl);
        this._vrrpLogEl = logEl;

        host.append(configSection, statusSection, logSection);
        setInnerActive("config");

        this.vrrp.onLogUpdate = () => this._renderVRRPLog();
    }

    _renderVRRPGroups() {
        const host = this._vrrpGroupsHost;
        if (!host) return;
        UILib.clear(host);
        if (this.vrrp.groups.length === 0) {
            host.appendChild(UILib.el("p", { text: t("router.vrrp.empty"), className: "router-hint" }));
            return;
        }
        const table = document.createElement("table");
        table.className = "router-routes-table";
        const thead = document.createElement("thead");
        const htr = document.createElement("tr");
        for (const col of [
            t("router.vrrp.col.iface"), t("router.vrrp.col.vrid"),
            t("router.vrrp.col.virtualip"), t("router.vrrp.col.priority"),
            t("router.vrrp.col.interval"), "",
        ]) {
            const th = document.createElement("th");
            th.textContent = col;
            htr.appendChild(th);
        }
        thead.appendChild(htr);
        const tbody = document.createElement("tbody");
        for (const g of this.vrrp.groups) {
            const tr = document.createElement("tr");
            const ifName = this.net.interfaces[g.ifIndex]?.name ?? `if${g.ifIndex}`;
            for (const val of [ifName, String(g.vrid), g.virtualIP.toString(), String(g.priority), `${g.advIntervalMs} ms`]) {
                const td = document.createElement("td");
                td.textContent = val;
                tr.appendChild(td);
            }
            const delBtn = UILib.button("✕", () => {
                this.vrrp.removeGroup(g.ifIndex, g.vrid);
                if (this.vrrp.groups.length === 0) this.vrrp.stop();
                this._renderVRRPGroups();
            }, { className: "sim-btn-danger" });
            const tdDel = document.createElement("td");
            tdDel.appendChild(delBtn);
            tr.appendChild(tdDel);
            tbody.appendChild(tr);
        }
        table.append(thead, tbody);
        const scroll = UILib.div("sim-table-scroll");
        scroll.appendChild(table);
        host.appendChild(UILib.wrapWithScrollHints(scroll));
    }

    _renderVRRPStatus() {
        const host = this._vrrpStatusHost;
        if (!host) return;
        UILib.clear(host);
        if (this.vrrp.groups.length === 0) {
            host.appendChild(UILib.el("p", { text: t("router.vrrp.empty"), className: "router-hint" }));
            this._vrrpPollTimer.stop();
            return;
        }
        const table = document.createElement("table");
        table.className = "router-routes-table";
        const thead = document.createElement("thead");
        const htr = document.createElement("tr");
        for (const col of [
            t("router.vrrp.col.iface"), t("router.vrrp.col.vrid"),
            t("router.vrrp.col.virtualip"), t("router.vrrp.col.priority"),
            t("router.vrrp.col.state"), t("router.vrrp.col.vmac"),
        ]) {
            const th = document.createElement("th");
            th.textContent = col;
            htr.appendChild(th);
        }
        thead.appendChild(htr);
        const tbody = document.createElement("tbody");
        for (const g of this.vrrp.groups) {
            const tr = document.createElement("tr");
            const ifName = this.net.interfaces[g.ifIndex]?.name ?? `if${g.ifIndex}`;
            const stateLabel = g.state === 'master'
                ? t("router.vrrp.state.master")
                : g.state === 'backup'
                    ? t("router.vrrp.state.backup")
                    : t("router.vrrp.state.init");
            const vmacStr = Array.from(g.virtualMAC).map(b => b.toString(16).padStart(2, '0')).join(':');
            for (const val of [ifName, String(g.vrid), g.virtualIP.toString(), String(g.priority), stateLabel, vmacStr]) {
                const td = document.createElement("td");
                td.textContent = val;
                if (val === stateLabel) {
                    td.style.fontWeight = g.state === 'master' ? 'bold' : 'normal';
                    td.style.color = g.state === 'master' ? 'var(--color-ok, #2a9)' : '';
                }
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.append(thead, tbody);
        const scroll = UILib.div("sim-table-scroll");
        scroll.appendChild(table);
        host.appendChild(UILib.wrapWithScrollHints(scroll));
        this._vrrpPollTimer.stop();
        this._vrrpPollTimer.start(() => this._renderVRRPStatus(), 500);
    }

    _renderVRRPLog() {
        if (!this._vrrpLogEl) return;
        this._vrrpLogEl.value = this.vrrp.log.join("\n");
        this._vrrpLogEl.scrollTop = this._vrrpLogEl.scrollHeight;
    }

    destroy() {
        this._pd6Stop();
        this._pd6ClientStop();
        this.vrrp.stop();
        this._vrrpPollTimer.stop();
        this._lldpStop();
        super.destroy();
    }

    /* ============================== LLDP ================================= */

    /** @param {HTMLElement} host */
    _buildLLDPSection(host) {
        this._lldpEnabledCb = null;
        this._lldpTableHost = null;

        const cb = /** @type {HTMLInputElement} */ (UILib.input({ type: "checkbox" }));
        cb.checked = !!this._lldpEnabled;
        this._lldpEnabledCb = cb;
        host.appendChild(UILib.div("hr-checkbox-row", [cb, UILib.el("span", { text: t("router.lldp.enable") })]));

        const tableHost = UILib.div("");
        this._lldpTableHost = tableHost;
        host.appendChild(tableHost);

        cb.addEventListener("change", () => {
            if (cb.checked) {
                this._lldpEnabled = true;
                this._lldpStart();
            } else {
                this._lldpStop();
            }
            this._renderLLDPSection();
        });

        if (this._lldpEnabled) this._lldpStart();
        this._renderLLDPSection();
    }

    _lldpStart() {
        this._lldpEnabled = true;
        this._lldpWireInterfaces();
        this._lldpEmit();
        this._lldpScheduleTx();
    }

    _lldpStop() {
        this._lldpEnabled = false;
        for (const iface of this.net.interfaces) iface._lldpHandler = null;
        if (this._lldpTimer != null) { simTimer.cancel(this._lldpTimer); this._lldpTimer = null; }
        this._lldpNeighbors.clear();
    }

    _lldpWireInterfaces() {
        for (const iface of this.net.interfaces) {
            const ifName = iface.name;
            iface._lldpHandler = (frame) => {
                const info = LLDPDaemon.decode(frame.payload);
                if (!info) return;
                const ttlTicks = Math.round((info.ttl * 1000) / SimTimer.SIM_MS_PER_TICK);
                this._lldpNeighbors.set(ifName, {
                    chassisId:     info.chassisId,
                    portId:        info.portId,
                    systemName:    info.systemName,
                    expiresAtTick: simTimer.currentTick + ttlTicks,
                });
            };
        }
    }

    _lldpScheduleTx() {
        if (this._lldpTimer != null) simTimer.cancel(this._lldpTimer);
        this._lldpTimer = simTimer.schedule(() => {
            this._lldpTimer = null;
            if (!this._lldpEnabled) return;
            this._lldpEmit();
            this._lldpScheduleTx();
        }, SimTimer.LLDP_TX_MS);
    }

    _lldpEmit() {
        for (const iface of this.net.interfaces) {
            if (!iface.port?.isLinked?.()) continue;
            if (!iface.mac) continue;
            const payload = LLDPDaemon.encode(iface.mac, iface.name, this.name);
            iface.sendFrame(LLDPDaemon.DEST_MAC, LLDPDaemon.ETHERTYPE, payload);
        }
    }

    _renderLLDPSection() {
        const host = this._lldpTableHost;
        if (!host) return;
        UILib.clear(host);

        if (!this._lldpEnabled) return;

        const ifaces = this.net.interfaces;
        const now = simTimer.currentTick;

        if (!ifaces.length) {
            host.appendChild(UILib.el("p", { text: t("router.lldp.empty"), className: "router-empty-p" }));
            return;
        }

        const table = document.createElement("table");
        table.className = "router-routes-table";

        const thead = document.createElement("thead");
        const htr = document.createElement("tr");
        for (const key of ["router.lldp.col.iface", "router.lldp.col.system", "router.lldp.col.chassis", "router.lldp.col.portid"]) {
            const th = document.createElement("th");
            th.textContent = t(key);
            htr.appendChild(th);
        }
        thead.appendChild(htr);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        for (const iface of ifaces) {
            const neighbor = this._lldpNeighbors.get(iface.name);
            const valid = neighbor && neighbor.expiresAtTick > now;
            const tr = document.createElement("tr");

            const ifTd  = document.createElement("td"); ifTd.textContent  = iface.name;
            const sysTd = document.createElement("td"); sysTd.textContent = valid ? neighbor.systemName : "–";
            const chTd  = document.createElement("td"); chTd.textContent  = valid ? neighbor.chassisId  : "–";
            const pidTd = document.createElement("td"); pidTd.textContent = valid ? neighbor.portId     : "–";

            if (!valid) {
                for (const td of [sysTd, chTd, pidTd]) td.style.opacity = "0.4";
            }

            tr.append(ifTd, sysTd, chTd, pidTd);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        const scroll = UILib.div("sim-table-scroll");
        scroll.appendChild(table);
        host.appendChild(UILib.wrapWithScrollHints(scroll));
    }
}
