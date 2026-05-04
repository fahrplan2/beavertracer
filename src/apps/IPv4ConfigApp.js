//@ts-check

import { t } from "../i18n/index.js";
import { GenericProcess } from "./GenericProcess.js";
import { Disposer } from "../lib/Disposer.js";
import { UILib } from "./lib/UILib.js";

import { assertLenU8 } from "../lib/helpers.js";
import { simTimer, SimTimer } from "../sim/SimTimer.js";
import { DHCPPacket } from "../net/pdu/DHCPPacket.js";
import { IPAddress } from "../net/models/IPAddress.js"; // <- ggf. Pfad bei dir: "./models/IPAddress.js" o.ä.

/**
 * IPv4 Config App (static / DHCP) adapted to:
 * - NetworkInterface.ip: IPAddress
 * - NetworkInterface.prefixLength: number
 * - IPStack routes: {dst: IPAddress, prefixLength: number, interf: number, nexthop: IPAddress}
 */
export class IPv4ConfigApp extends GenericProcess {
  get title() {
    return t("app.ipv4config.title");
  }

  icon="fa-gears";

  /** @type {string} */
  configPath = "/etc/ip.config";

  /** @type {{ modeByIface: Record<string, "static"|"dhcp"> }} */
  persisted = { modeByIface: {} };

  /** @type {HTMLSelectElement|null} */ ifSel = null;
  /** @type {HTMLSelectElement|null} */ modeSel = null;

  /** @type {HTMLInputElement|null} */ ipEl = null;
  /** @type {HTMLInputElement|null} */ prefixEl = null;
  /** @type {HTMLInputElement|null} */ gwEl = null;
  /** @type {HTMLInputElement|null} */ dnsEl = null;

  /** @type {HTMLElement|null} */ msgEl = null;

  /** @type {HTMLButtonElement|null} */ releaseBtn = null;
  lastDhcpServerByIface = new Map();

  // IPv6 tab fields
  /** @type {HTMLElement|null} */ _ipv4Section = null;
  /** @type {HTMLElement|null} */ _ipv6Section = null;
  /** @type {HTMLElement|null} */ _wifiSection = null;
  /** @type {((id: string) => void)|null} */ _setFamilyActive = null;
  /** @type {number} */ _selectedFamily = 4;
  /** @type {HTMLInputElement|null} */ _ssidInput = null;
  /** @type {HTMLElement|null} */ _ip6LLEl = null;
  /** @type {HTMLSelectElement|null} */ _ip6ModeSel = null;
  /** @type {HTMLInputElement|null} */ _ip6El = null;
  /** @type {HTMLInputElement|null} */ _prefix6El = null;
  /** @type {HTMLElement|null} */ _ip6StaticFields = null;
  /** @type {HTMLElement|null} */ _gw6El = null;
  /** @type {HTMLElement|null} */ _ip6SlaacStatusEl = null;

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {{ update: () => void }|null} */
  _netObserver = null;

  /** @type {boolean} */
  applying = false;

  /** @type {Map<number, { serverId:number, ip:number }>} */
  dhcpStateByIface = new Map();

  run() {
    this.root.classList.add("app", "app-ipv4");
    void this._autoDhcpStart();
  }

  async _autoDhcpStart() {
    try {
      await this._loadPersistedConfig();
    } catch {
      return;
    }

    const net = this.os.net;
    const ifs = net?.interfaces ?? [];
    for (let i = 0; i < ifs.length; i++) {
      const mode = this.persisted.modeByIface[String(i)] ?? "static";
      if (mode !== "dhcp") continue;

      void (async () => {
        const ok = await this._dhcpAcquireAndConfigure(i);
        if (!ok) this._applyApipa(i);

        if (this.mounted) {
          this._load();
          this._setMsg(ok
            ? t("app.ipv4config.msg.dhcpLeaseApplied", { i })
            : t("app.ipv4config.msg.dhcpFailedApipa", { i })
          );
        }
      })();
    }
  }

  /**
   * @param {HTMLElement} root
   */
  async onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const net = this.os.net;
    const ifs = net?.interfaces ?? [];

    const msg = UILib.el("div", { className: "msg" });
    this.msgEl = msg;

    // --- IPv4 content ---
    const modeSel = UILib.select(
      [
        { value: "static", label: t("app.ipv4config.mode.static") },
        { value: "dhcp", label: t("app.ipv4config.mode.dhcp") },
      ],
      {}
    );
    const ipEl = UILib.input({ placeholder: "192.168.0.10" });
    const prefixEl = UILib.input({ placeholder: "24" });
    const gwEl = UILib.input({ placeholder: "192.168.0.1" });
    const dnsEl = UILib.input({ placeholder: "8.8.8.8" });
    const applyBtn = UILib.button(t("app.ipv4config.button.apply"), () => this._apply(), { primary: true });
    const releaseBtn = UILib.button(t("app.ipv4config.button.release"), () => this._releaseDhcp(), {});
    this.modeSel = modeSel;
    this.ipEl = ipEl;
    this.prefixEl = prefixEl;
    this.gwEl = gwEl;
    this.dnsEl = dnsEl;
    this.releaseBtn = releaseBtn;

    const ipv4Section = UILib.el("div", { children: [
      UILib.el("h4", { text: t("app.ipv4config.title") }),
      UILib.row(t("app.ipv4config.label.mode"), modeSel),
      UILib.row(t("app.ipv4config.label.ip"), ipEl),
      UILib.row(t("app.ipv4config.label.prefixLength"), prefixEl),
      UILib.row(t("app.ipv4config.label.gateway"), gwEl),
      UILib.row(t("app.ipv4config.label.dnsServer"), dnsEl),
      UILib.buttonRow([applyBtn, releaseBtn]),
    ]});
    this._ipv4Section = ipv4Section;

    // --- IPv6 content ---
    const ip6LLEl = UILib.el("span", {});
    const ip6ModeSel = /** @type {HTMLSelectElement} */ (UILib.select(
      [
        { value: "disabled", label: t("app.ipv4config.ipv6.mode.disabled") },
        { value: "static",   label: t("app.ipv4config.ipv6.mode.static")   },
        { value: "slaac",    label: t("app.ipv4config.ipv6.mode.slaac")    },
      ],
      {}
    ));
    const ip6El = UILib.input({ placeholder: "2001:db8::1" });
    const prefix6El = UILib.input({ placeholder: "64" });
    const gw6El = UILib.input({ placeholder: "fe80::1" });
    const ip6SlaacStatusEl = UILib.el("span", { className: "ipv6-slaac-status" });
    const applyBtn6 = UILib.button(t("app.ipv4config.ipv6.apply"), () => this._applyIPv6(), { primary: true });
    this._ip6LLEl = ip6LLEl;
    this._ip6ModeSel = ip6ModeSel;
    this._ip6El = ip6El;
    this._prefix6El = prefix6El;
    this._gw6El = /** @type {HTMLInputElement} */ (gw6El);
    this._ip6SlaacStatusEl = ip6SlaacStatusEl;

    const staticFields = UILib.el("div", { children: [
      UILib.row(t("app.ipv4config.ipv6.address"), ip6El),
      UILib.row(t("app.ipv4config.ipv6.prefix"), prefix6El),
      UILib.row(t("app.ipv4config.ipv6.gateway"), gw6El),
    ]});
    this._ip6StaticFields = staticFields;

    const ipv6Section = UILib.el("div", { children: [
      UILib.el("h4", { text: t("app.ipv4config.ipv6.sectionTitle") }),
      UILib.row(t("app.ipv4config.ipv6.linklocal"), ip6LLEl),
      UILib.row(t("app.ipv4config.ipv6.mode"), ip6ModeSel),
      staticFields,
      UILib.row(t("app.ipv4config.ipv6.status"), ip6SlaacStatusEl),
      UILib.buttonRow([applyBtn6]),
    ]});
    this._ipv6Section = ipv6Section;

    // --- WiFi section (only for devices with a wireless port) ---
    const device = /** @type {any} */ (this.os.obj);
    let wifiSection = null;
    if (device?._wPort) {
      const ssidInput = UILib.input({ placeholder: "SSID", value: device._ssid ?? "" });
      this._ssidInput = ssidInput;
      const applyWifiBtn = UILib.button(t("wifi.apply"), () => {
        if (device._ssid !== undefined) {
          device._ssid = ssidInput.value.trim();
          this._setMsg(t("wifi.ssid.applied"));
        }
      }, { primary: true });
      wifiSection = UILib.el("div", { children: [
        UILib.el("h4", { text: "WiFi" }),
        UILib.row(t("wifi.ssid"), ssidInput),
        UILib.buttonRow([applyWifiBtn]),
      ]});
      this._wifiSection = wifiSection;
    }

    // --- Family tab bar ---
    const familyTabs = [
      { id: "ipv4", label: t("app.ipv4config.tab.ipv4") },
      { id: "ipv6", label: t("app.ipv4config.tab.ipv6") },
    ];
    if (wifiSection) familyTabs.push({ id: "wifi", label: "WiFi" });
    const { bar: tabBar, setActive: setFamilyActive } = UILib.tabGroup(familyTabs,
      (id) => this._selectFamily(id === "ipv4" ? 4 : id === "ipv6" ? 6 : 0)
    );
    this._setFamilyActive = setFamilyActive;

    // --- Build panel ---
    const panelChildren = [
      tabBar,
      ipv4Section,
      ipv6Section,
    ];
    if (wifiSection) panelChildren.push(wifiSection);
    panelChildren.push(msg);
    const panel = UILib.panel(panelChildren);

    this.root.replaceChildren(panel);

    // Wire events
    this.disposer.on(modeSel, "change", async () => {
      const prev = (this.persisted.modeByIface[String(this._idx())] ?? "static");
      await this._persistModeForCurrentIface();
      const now = this._mode();
      if (prev === "static" && now === "dhcp") {
        this._dropInterfaceForDhcp(this._idx());
      }
      this._syncModeUI();
    });

    this.disposer.on(ip6ModeSel, "change", () => this._syncIPv6UI());

    if (ifs.length === 0) {
      this._setMsg(t("app.ipv4config.msg.noInterfaces"));
      applyBtn.disabled = true;
      this._selectFamily(4);
      return;
    }

    await this._loadPersistedConfig();
    this._load();
    await this._loadModeForIfaceAndShow();
    this._syncModeUI();
    this._loadIPv6();
    this._syncIPv6UI();

    if (net) {
      const observer = { update: () => { if (this._selectedFamily === 6) this._loadIPv6(); } };
      this._netObserver = observer;
      net.subscribe(/** @type {any} */ (observer));
    }

    this._selectFamily(4);
  }

  onUnmount() {
    if (this._netObserver && this.os.net) {
      this.os.net.unsubscribe(/** @type {any} */ (this._netObserver));
    }
    this._netObserver = null;
    this.disposer.dispose();
    this.modeSel = this.ipEl = this.prefixEl = this.gwEl = this.dnsEl = null;
    this.msgEl = null;
    this._ipv4Section = this._ipv6Section = this._wifiSection = null;
    this._setFamilyActive = null;
    this._ssidInput = null;
    this._ip6LLEl = this._ip6ModeSel = this._ip6El = this._prefix6El = this._gw6El = null;
    this._ip6StaticFields = this._ip6SlaacStatusEl = null;
    super.onUnmount();
  }

  /** @param {string} s */
  _setMsg(s) {
    if (this.msgEl) this.msgEl.textContent = s;
  }

  _idx() {
    const v = this.ifSel?.value ?? "0";
    const i = Number(v);
    return Number.isInteger(i) ? i : 0;
  }

  _mode() {
    const v = (this.modeSel?.value ?? "static");
    return (v === "dhcp") ? "dhcp" : "static";
  }

  _syncModeUI() {
    const dhcp = this._mode() === "dhcp";
    const dis = dhcp || this.applying;

    if (this.ipEl) this.ipEl.disabled = dis;
    if (this.prefixEl) this.prefixEl.disabled = dis;
    if (this.gwEl) this.gwEl.disabled = dis;
    if (this.dnsEl) this.dnsEl.disabled = dis;

    if (this.releaseBtn) this.releaseBtn.disabled = (this._mode() !== "dhcp") || this.applying;

    if (dhcp && !this.applying) {
      this._setMsg(t("app.ipv4config.msg.dhcpModeHint"));
    }
  }

  /** @param {0|4|6} f */
  _selectFamily(f) {
    this._selectedFamily = f;
    if (this._ipv4Section) this._ipv4Section.style.display = (f === 4) ? "" : "none";
    if (this._ipv6Section) this._ipv6Section.style.display = (f === 6) ? "" : "none";
    if (this._wifiSection) this._wifiSection.style.display = (f === 0) ? "" : "none";
    this._setFamilyActive?.(f === 4 ? "ipv4" : f === 6 ? "ipv6" : "wifi");
    if (f === 6) this._loadIPv6();
  }

  _loadIPv6() {
    const net = this.os.net;
    if (!net?.interfaces) return;
    const i = this._idx();
    const itf = net.interfaces[i];
    if (!itf) return;

    if (this._ip6LLEl) {
      this._ip6LLEl.textContent = (itf.ip6LL instanceof IPAddress) ? itf.ip6LL.toString() : "–";
    }

    const effectiveIp6 = (itf.ip6 instanceof IPAddress && !itf.ip6.toUInt8().every(b => b === 0))
      ? itf.ip6
      : (itf._tentativeIp6 instanceof IPAddress ? itf._tentativeIp6 : null);

    let mode = "disabled";
    if (itf.slaac) {
      mode = "slaac";
    } else if (effectiveIp6) {
      mode = "static";
    }

    if (this._ip6ModeSel) this._ip6ModeSel.value = mode;

    if (mode === "static") {
      if (this._ip6El) this._ip6El.value = effectiveIp6 ? effectiveIp6.toString() : "";
      if (this._prefix6El) this._prefix6El.value = String(itf.prefixLength6 ?? 64);
      const gw6 = getDefaultGatewayIPv6ForIface(net, i);
      if (this._gw6El) /** @type {HTMLInputElement} */ (this._gw6El).value = gw6 ? gw6.toString() : "";
    } else {
      if (this._ip6El) this._ip6El.value = "";
      if (this._prefix6El) this._prefix6El.value = "";
      if (this._gw6El) /** @type {HTMLInputElement} */ (this._gw6El).value = "";
    }

    if (mode === "slaac" && this._ip6SlaacStatusEl) {
      if (effectiveIp6) {
        const slaacAddrTxt = t("app.ipv4config.ipv6.msg.slaacAddress", {
          ip: effectiveIp6.toString(),
          prefix: String(itf.prefixLength6 ?? 64),
        });
        if (this._ip6SlaacStatusEl.textContent !== slaacAddrTxt) {
          this._ip6SlaacStatusEl.textContent = slaacAddrTxt;
          this._setMsg(slaacAddrTxt);
        }
      } else {
        this._ip6SlaacStatusEl.textContent = t("app.ipv4config.ipv6.msg.slaacPending");
      }
    } else if (this._ip6SlaacStatusEl) {
      this._ip6SlaacStatusEl.textContent = "";
    }

    this._syncIPv6UI();
  }

  _syncIPv6UI() {
    const mode = this._ip6ModeSel?.value ?? "disabled";
    const isStatic = mode === "static";
    const isSlaac  = mode === "slaac";

    if (this._ip6StaticFields) this._ip6StaticFields.style.display = isStatic ? "" : "none";

    const statusRow = this._ip6SlaacStatusEl?.parentElement;
    if (statusRow) statusRow.style.display = isSlaac ? "" : "none";

    if (this._ip6El)     this._ip6El.disabled     = !isStatic;
    if (this._prefix6El) this._prefix6El.disabled = !isStatic;
    if (this._gw6El)     /** @type {HTMLInputElement} */ (this._gw6El).disabled = !isStatic;
  }

  async _applyIPv6() {
    const net = this.os.net;
    if (!net) return this._setMsg(t("app.ipv4config.err.noNetDriver"));
    const i = this._idx();

    try {
      const mode = this._ip6ModeSel?.value ?? "disabled";

      if (mode === "disabled") {
        net.configureInterface(i, { ip6: null, prefixLength6: 0, slaac: false });
        clearDefaultGatewayIPv6ForIface(net, i);
        this._setMsg(t("app.ipv4config.ipv6.msg.disabled", { i }));
        return;
      }

      if (mode === "slaac") {
        net.configureInterface(i, { slaac: true });
        if (this._ip6SlaacStatusEl) {
          this._ip6SlaacStatusEl.textContent = t("app.ipv4config.ipv6.msg.slaacPending");
        }
        this._setMsg(t("app.ipv4config.ipv6.msg.slaacStarted"));
        return;
      }

      // static
      const ipStr     = (this._ip6El?.value    ?? "").trim();
      const prefixStr = (this._prefix6El?.value ?? "").trim();
      const gwStr     = (/** @type {HTMLInputElement} */ (this._gw6El)?.value ?? "").trim();

      /** @type {IPAddress} */
      let ip6;
      try {
        ip6 = IPAddress.fromString(ipStr);
        if (!ip6.isV6()) throw new Error("not IPv6");
      } catch {
        return this._setMsg(t("app.ipv4config.ipv6.err.invalidAddress"));
      }

      const prefix6 = Number(prefixStr);
      if (!Number.isInteger(prefix6) || prefix6 < 0 || prefix6 > 128) {
        return this._setMsg(t("app.ipv4config.ipv6.err.invalidPrefix"));
      }

      /** @type {IPAddress|null} */
      let gw6 = null;
      if (gwStr !== "") {
        try {
          gw6 = IPAddress.fromString(gwStr);
          if (!gw6.isV6()) throw new Error("not IPv6");
        } catch {
          return this._setMsg(t("app.ipv4config.ipv6.err.invalidGateway"));
        }
      }

      net.configureInterface(i, { ip6, prefixLength6: prefix6, slaac: false });
      clearDefaultGatewayIPv6ForIface(net, i);
      if (gw6 != null) net.addRoute(IPAddress.fromString("::"), 0, i, gw6);

      this._setMsg(t("app.ipv4config.ipv6.msg.applied", { i, ip: ip6.toString(), prefix: prefix6 }));
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._setMsg(t("app.ipv4config.err.applyFailed", { reason }));
    }
  }

  _load() {
    const net = this.os.net;
    if (!net?.interfaces) return;

    const i = this._idx();
    const itf = net.interfaces[i];
    if (!itf) return this._setMsg(t("app.ipv4config.msg.interfaceNotFound", { i }));

    const ip = (itf.ip instanceof IPAddress) ? itf.ip : null;
    const prefix = (typeof itf.prefixLength === "number") ? itf.prefixLength : null;

    if (this.ipEl) this.ipEl.value = (ip && ip.isV4()) ? ip.toString() : "";
    if (this.prefixEl) this.prefixEl.value = (prefix != null) ? String(prefix) : "";

    const gw = getDefaultGatewayForIface(net, i);
    if (this.gwEl) this.gwEl.value = (gw != null) ? gw.toString() : "";

    const dns = this.os.dns;
    let dnsStr = "";
    if (dns?.serverIp instanceof IPAddress) dnsStr = dns.serverIp.toString();
    else if (dns && typeof dns.serverIp === "number") dnsStr = numberToIpv4(dns.serverIp >>> 0);
    if (this.dnsEl) this.dnsEl.value = dnsStr;

    this._setMsg(t("app.ipv4config.msg.loadedInterface", { i }));
  }

  async _apply() {
    if (this.applying) return;

    const net = this.os.net;
    if (!net) return this._setMsg(t("app.ipv4config.err.noNetDriver"));

    const i = this._idx();

    this.applying = true;
    this._syncModeUI();

    try {
      if (this._mode() === "dhcp") {
        this._setMsg(t("app.ipv4config.msg.dhcpStarting", { i }));

        const ok = await this._dhcpAcquireAndConfigure(i);

        if (ok) {
          this._load();
          this._setMsg(t("app.ipv4config.msg.dhcpLeaseApplied", { i }));
          return;
        }

        this._setMsg(t("app.ipv4config.msg.dhcpFailedApipa", { i }));
        this._applyApipa(i);

        this._load();
        this._setMsg(t("app.ipv4config.msg.apipaApplied", {
          i,
          ip: this.ipEl?.value ?? "",
          prefix: this.prefixEl?.value ?? "",
        }));
        return;
      }

      // STATIC mode
      const ipStr = (this.ipEl?.value ?? "").trim();
      const prefixStr = (this.prefixEl?.value ?? "").trim();
      const gwStr = (this.gwEl?.value ?? "").trim();
      const dnsStr = (this.dnsEl?.value ?? "").trim();

      const ip = parseIPv4(ipStr);
      if (!ip) return this._setMsg(t("app.ipv4config.err.invalidIp"));

      const prefixLength = parsePrefixLength(prefixStr);
      if (prefixLength == null) return this._setMsg(t("app.ipv4config.err.invalidPrefixLength"));

      /** @type {IPAddress|null} */
      let gw = null;
      if (gwStr !== "") {
        const gwIp = parseIPv4(gwStr);
        if (!gwIp) return this._setMsg(t("app.ipv4config.err.invalidGateway"));
        if (gwIp.getNumber() === 0) return this._setMsg(t("app.ipv4config.err.gatewayZero"));
        gw = gwIp;
      }

      /** @type {IPAddress|undefined} */
      let dnsIpAddr = undefined;
      if (dnsStr !== "") {
        try { dnsIpAddr = IPAddress.fromString(dnsStr); } catch {
          return this._setMsg(t("app.ipv4config.err.invalidDnsServer"));
        }
      }

      net.configureInterface(i, { ip, prefixLength });

      clearDefaultGatewayForIface(net, i);
      if (gw != null) net.addRoute(IPAddress.fromString("0.0.0.0"), 0, i, gw);

      if (dnsIpAddr !== undefined) {
        const dns = this.os?.dns;
        if (dns?.setServer) dns.setServer(dnsIpAddr, 53);
      }

      if (dnsIpAddr !== undefined) {
        const dnsTxt = dnsIpAddr.toString();
        this._setMsg(
          gw != null
            ? t("app.ipv4config.msg.appliedWithGwDns", { i, ip: ip.toString(), netmask: `/${prefixLength}`, gw: gw.toString(), dns: dnsTxt })
            : t("app.ipv4config.msg.appliedGwClearedDns", { i, ip: ip.toString(), netmask: `/${prefixLength}`, dns: dnsTxt })
        );
      } else {
        this._setMsg(
          gw != null
            ? t("app.ipv4config.msg.appliedWithGw", { i, ip: ip.toString(), netmask: `/${prefixLength}`, gw: gw.toString() })
            : t("app.ipv4config.msg.appliedGwCleared", { i, ip: ip.toString(), netmask: `/${prefixLength}` })
        );
      }
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._setMsg(t("app.ipv4config.err.applyFailed", { reason }));
    } finally {
      this.applying = false;
      this._syncModeUI();
    }
  }

  // ------------------ persistence (/etc/ip.config) ------------------

  async _loadPersistedConfig() {
    try {
      const txt = await this.os.fs.readFile(this.configPath);
      if (!txt.trim()) {
        await this.os.fs.writeFile(this.configPath, JSON.stringify(this.persisted, null, 2) + "\n");
        return;
      }

      /** @type {any} */
      const o = JSON.parse(txt);
      const m = o?.modeByIface;
      if (m && typeof m === "object") {
        /** @type {Record<string, "static"|"dhcp">} */
        const cleaned = {};
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v === "static" || v === "dhcp") cleaned[k] = v;
        }
        this.persisted.modeByIface = cleaned;
      }
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._setMsg(t("app.ipv4config.err.persistLoadFailed", { reason }));
    }
  }

  async _savePersistedConfig() {
    try {
      await this.os.fs.writeFile(this.configPath, JSON.stringify(this.persisted, null, 2) + "\n");
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._setMsg(t("app.ipv4config.err.persistSaveFailed", { reason }));
    }
  }

  async _loadModeForIfaceAndShow() {
    const i = this._idx();
    const key = String(i);
    const v = this.persisted.modeByIface[key] ?? "static";
    if (this.modeSel) this.modeSel.value = v;
  }

  async _persistModeForCurrentIface() {
    const i = this._idx();
    const key = String(i);
    const v = this._mode();
    this.persisted.modeByIface[key] = v;
    await this._savePersistedConfig();
  }

  // ------------------ DHCP ------------------

  /** @param {number} msSim */
  async _simSleep(msSim) {
    await simTimer.sleep(msSim);
  }

  /**
   * DHCP acquire sequence. Returns true on success.
   * @param {number} ifaceIdx
   * @returns {Promise<boolean>}
   */
  async _dhcpAcquireAndConfigure(ifaceIdx) {
    const net = this.os.net;
    if (!net?.interfaces?.[ifaceIdx]) return false;

    const itf = net.interfaces[ifaceIdx];
    const mac = this._getIfaceMac(itf, ifaceIdx);
    const xid = (Math.random() * 0xffffffff) >>> 0;

    const OFFER_WAIT_SIM = SimTimer.DHCP_OFFER_WAIT_MS;
    const ACK_WAIT_SIM = SimTimer.DHCP_ACK_WAIT_MS;
    const BETWEEN_TRIES_SIM = SimTimer.DHCP_BETWEEN_TRIES_MS;

    for (let attempt = 1; attempt <= 3; attempt++) {
      this._setMsg(t("app.ipv4config.msg.dhcpAttempt", { attempt }));

      let sock = null;
      try {
        sock = this.os.net.openUDPSocket(new IPAddress(4,0), 68);
      } catch {
        return false;
      }

      try {
        // DISCOVER
        const discover = new DHCPPacket({ op: 1, xid, flags: 0x8000 });
        discover.setClientMAC(mac);
        discover.setMessageType(DHCPPacket.MT_DISCOVER);

        discover.setOption(DHCPPacket.OPT_PARAMETER_REQUEST_LIST, new Uint8Array([
          DHCPPacket.OPT_SUBNET_MASK,
          DHCPPacket.OPT_ROUTER,
          DHCPPacket.OPT_DNS,
          DHCPPacket.OPT_LEASE_TIME,
        ]));

        this.os.net.sendUDPSocket(sock,IPAddress.fromString("255.255.255.255"), 67, discover.pack());

        const offerPkt = await this._waitDhcp(sock, xid, DHCPPacket.MT_OFFER, OFFER_WAIT_SIM);
        if (!offerPkt) {
          try { this.os.net.closeUDPSocket(sock); } catch { }
          await this._simSleep(BETWEEN_TRIES_SIM);
          continue;
        }

        const offeredIpNum = ipv4BytesToNumber(offerPkt.yiaddr);

        const sidOpt = offerPkt.getOption(DHCPPacket.OPT_SERVER_ID);
        const serverId = (sidOpt && sidOpt.length === 4) ? ipv4BytesToNumber(sidOpt) : 0;

        if (serverId !== 0) this.lastDhcpServerByIface.set(ifaceIdx, serverId);

        // REQUEST
        const req = new DHCPPacket({ op: 1, xid, flags: 0x8000 });
        req.setClientMAC(mac);
        req.setMessageType(DHCPPacket.MT_REQUEST);
        req.setOption(DHCPPacket.OPT_REQUESTED_IP, numberToIPv4Bytes(offeredIpNum));
        if (serverId !== 0) req.setOption(DHCPPacket.OPT_SERVER_ID, numberToIPv4Bytes(serverId));

        this.os.net.sendUDPSocket(sock, IPAddress.fromString("255.255.255.255"), 67, req.pack());

        const ackPkt = await this._waitDhcp(sock, xid, DHCPPacket.MT_ACK, ACK_WAIT_SIM);
        try { this.os.net.closeUDPSocket(sock); } catch { }

        if (!ackPkt) {
          await this._simSleep(BETWEEN_TRIES_SIM);
          continue;
        }

        // apply config
        const ipNum = ipv4BytesToNumber(ackPkt.yiaddr);

        // subnet mask -> prefixLength
        const maskOpt = ackPkt.getOption(DHCPPacket.OPT_SUBNET_MASK);
        const maskNum = (maskOpt && maskOpt.length === 4) ? ipv4BytesToNumber(maskOpt) : (0xffffff00 >>> 0);
        const prefixLength = netmask32ToPrefix(maskNum);

        let gwNum = null;
        const gwOpt = ackPkt.getOption(DHCPPacket.OPT_ROUTER);
        if (gwOpt && gwOpt.length >= 4) gwNum = ipv4BytesToNumber(gwOpt.slice(0, 4));

        let dnsNum = null;
        const dnsOpt = ackPkt.getOption(DHCPPacket.OPT_DNS);
        if (dnsOpt && dnsOpt.length >= 4) dnsNum = ipv4BytesToNumber(dnsOpt.slice(0, 4));

        net.configureInterface(ifaceIdx, {
          ip: new IPAddress(4, ipNum),
          prefixLength
        });

        clearDefaultGatewayForIface(net, ifaceIdx);
        if (gwNum != null && gwNum !== 0) {
          net.addRoute(IPAddress.fromString("0.0.0.0"), 0, ifaceIdx, new IPAddress(4, gwNum));
        }

        if (dnsNum != null) {
          const dns = this.os?.dns;
          if (dns?.setServer) dns.setServer(dnsNum, 53);
        }

        this.dhcpStateByIface.set(ifaceIdx, { serverId, ip: ipNum });

        this._setMsg(t("app.ipv4config.msg.dhcpSuccess", {
          i: ifaceIdx,
          ip: numberToIpv4(ipNum),
          netmask: `/${prefixLength}`,
          gw: gwNum != null ? numberToIpv4(gwNum) : "",
          dns: dnsNum != null ? numberToIpv4(dnsNum) : "",
        }));

        return true;
      } catch {
        try { if (sock != null) this.os.net.closeUDPSocket(sock); } catch { }
        await this._simSleep(BETWEEN_TRIES_SIM);
        continue;
      }
    }

    return false;
  }

  /**
   * @param {number} sock
   * @param {number} xid
   * @param {number} wantType
   * @param {number} timeoutSimMs
   * @returns {Promise<DHCPPacket|null>}
   */
  async _waitDhcp(sock, xid, wantType, timeoutSimMs) {
    let timedOut = false;

    const killer = (async () => {
      await this._simSleep(timeoutSimMs);
      timedOut = true;
      try { this.os.net.closeUDPSocket(sock); } catch { }
    })();

    try {
      while (true) {
        /** @type {any} */
        const pkt = await this.os.net.recvUDPSocket(sock);
        if (pkt == null) return null;

        const bytes =
          pkt.payload instanceof Uint8Array ? pkt.payload :
            (pkt.data instanceof Uint8Array ? pkt.data : null);

        if (!bytes) continue;

        let dh = null;
        try { dh = DHCPPacket.fromBytes(bytes); } catch { continue; }

        if ((dh.xid >>> 0) !== (xid >>> 0)) continue;

        const mt = dh.getMessageType();
        if (mt !== wantType) continue;

        return dh;
      }
    } finally {
      void killer;
      void timedOut;
    }
  }

  /** @param {number} ifaceIdx */
  _applyApipa(ifaceIdx) {
    const net = this.os.net;
    if (!net) return;

    const x = 1 + (Math.random() * 254) | 0;
    const y = 1 + (Math.random() * 254) | 0;
    const ipNum = (((169 << 24) >>> 0) + (254 << 16) + (x << 8) + y) >>> 0;

    net.configureInterface(ifaceIdx, {
      ip: new IPAddress(4, ipNum),
      prefixLength: 16
    });

    clearDefaultGatewayForIface(net, ifaceIdx);

    const dns = this.os?.dns;
    if (dns?.setServer) dns.setServer(0, 53);
  }

  /**
   * @param {any} itf
   * @param {number} ifaceIdx
   */
  _getIfaceMac(itf, ifaceIdx) {
    const m = itf?.mac;
    if (m instanceof Uint8Array && m.length === 6) return assertLenU8(m, 6, "mac");
    return new Uint8Array([0x02, 0x00, 0x00, 0x00, 0x00, (ifaceIdx & 0xff)]);
  }

  /** @param {number} ifaceIdx */
  _dropInterfaceForDhcp(ifaceIdx) {
    const net = this.os.net;
    if (!net) return;

    try {
      net.configureInterface(ifaceIdx, { ip: IPAddress.fromString("0.0.0.0"), prefixLength: 0 });
    } catch { /* ignore */ }

    try { clearDefaultGatewayForIface(net, ifaceIdx); } catch { /* ignore */ }

    const dns = this.os?.dns;
    if (dns?.setServer) {
      try { dns.setServer(0, 53); } catch { }
    }

    if (this.mounted && this.ifSel && Number(this.ifSel.value) === ifaceIdx) {
      this._load();
    }
  }

  async _releaseDhcp() {
    const net = this.os.net;
    if (!net) return this._setMsg(t("app.ipv4config.err.noNetDriver"));

    const ifaceIdx = this._idx();
    const itf = net.interfaces?.[ifaceIdx];
    if (!itf) return;

    const curIp = (itf.ip instanceof IPAddress && itf.ip.isV4()) ? (/** @type {number} */ (itf.ip.getNumber()) >>> 0) : 0;
    if (curIp === 0) {
      this._setMsg(t("app.ipv4config.msg.releaseNothingToDo", { i: ifaceIdx }));
      return;
    }

    const st = this.dhcpStateByIface.get(ifaceIdx);
    const serverId = st?.serverId ?? 0;

    /** @type {number|null} */
    let sock = null;

    try {
      sock = this._openDhcpClientSocket();
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._setMsg(t("app.ipv4config.err.releaseSocketFailed", { reason }));
      return;
    }

    try {
      const xid = (Math.random() * 0xffffffff) >>> 0;
      const mac = this._getIfaceMac(itf, ifaceIdx);

      const rel = new DHCPPacket({ op: 1, xid, flags: 0 });
      rel.setClientMAC(mac);
      rel.setMessageType(DHCPPacket.MT_RELEASE);

      // ciaddr = current client address
      rel.ciaddr = numberToIPv4Bytes(curIp);

      if (serverId !== 0) rel.setOption(DHCPPacket.OPT_SERVER_ID, numberToIPv4Bytes(serverId));

      const dstIp = new IPAddress(4, (serverId !== 0) ? serverId : (0xffffffff >>> 0));

      this.os.net.sendUDPSocket(sock, dstIp, 67, rel.pack());

      this._setMsg(t("app.ipv4config.msg.released", {
        i: ifaceIdx,
        ip: numberToIpv4(curIp),
        server: serverId ? numberToIpv4(serverId) : "broadcast",
      }));
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._setMsg(t("app.ipv4config.err.releaseFailed", { reason }));
    } finally {
      try { if (sock != null) this.os.net.closeUDPSocket(sock); } catch { }
    }

    this.dhcpStateByIface.delete(ifaceIdx);
    this._dropInterfaceForDhcp(ifaceIdx);
  }

  /**
   * @returns {number}
   */
  _openDhcpClientSocket() {
    try {
      return this.os.net.openUDPSocket(new IPAddress(4,0), 68);
    } catch {
      for (let k = 0; k < 20; k++) {
        const p = (49152 + ((Math.random() * (65535 - 49152)) | 0)) >>> 0;
        try {
          return this.os.net.openUDPSocket(new IPAddress(4,0), p);
        } catch { }
      }
      throw new Error("No free UDP port for DHCP client");
    }
  }
}

// -------------------- helpers --------------------

/**
 * Parse IPv4 string to IPAddress(v4).
 * @param {string} s
 * @returns {IPAddress|null}
 */
function parseIPv4(s) {
  const n = ipv4ToNumber(s);
  if (n == null) return null;
  return new IPAddress(4, n >>> 0);
}

/**
 * @param {string} s
 * @returns {number|null}
 */
function parsePrefixLength(s) {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 32) return null;
  return n | 0;
}

/**
 * @param {Uint8Array} b
 * @returns {number}
 */
function ipv4BytesToNumber(b) {
  if (!(b instanceof Uint8Array) || b.length < 4) return 0;
  return (((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3]) >>> 0;
}

/**
 * @param {number} n
 * @returns {Uint8Array}
 */
function numberToIPv4Bytes(n) {
  const x = n >>> 0;
  return new Uint8Array([(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);
}

/**
 * @param {string} s
 * @returns {number|null}
 */
function ipv4ToNumber(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  const a = [m[1], m[2], m[3], m[4]].map(Number);
  if (a.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((a[0] << 24) >>> 0) + (a[1] << 16) + (a[2] << 8) + a[3]) >>> 0;
}

/**
 * @param {number} n
 * @returns {string}
 */
function numberToIpv4(n) {
  const x = n >>> 0;
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
}

/**
 * Convert a *contiguous* netmask (uint32) to prefix length.
 * @param {number} mask32
 * @returns {number}
 */
function netmask32ToPrefix(mask32) {
  const m = mask32 >>> 0;
  // count leading 1s
  let bits = 0;
  let x = m;
  while (bits < 32 && (x & 0x80000000) !== 0) {
    bits++;
    x = (x << 1) >>> 0;
  }
  return bits;
}

/**
 * @param {any} net
 * @returns {any[]}
 */
function getRoutes(net) {
  return Array.isArray(net?.routingTable) ? net.routingTable : [];
}

/**
 * Default IPv6 gateway route is ::/0 on ifaceIdx.
 * @param {any} net
 * @param {number} ifaceIdx
 * @returns {IPAddress|null}
 */
function getDefaultGatewayIPv6ForIface(net, ifaceIdx) {
  const routes = getRoutes(net);
  for (const r of routes) {
    const dst = r?.dst;
    if (!(dst instanceof IPAddress) || !dst.isV6()) continue;
    if (dst.toUInt8().some(b => b !== 0)) continue;
    if ((r?.prefixLength | 0) !== 0) continue;
    if (r?.interf !== ifaceIdx) continue;
    const nh = r?.nexthop;
    if (nh instanceof IPAddress) return nh;
    return null;
  }
  return null;
}

/**
 * Clear all default IPv6 routes ::/0 for ifaceIdx.
 * @param {any} net
 * @param {number} ifaceIdx
 */
function clearDefaultGatewayIPv6ForIface(net, ifaceIdx) {
  const matching = getRoutes(net).filter(r => {
    const dst = r?.dst;
    if (!(dst instanceof IPAddress) || !dst.isV6()) return false;
    if (dst.toUInt8().some(b => b !== 0)) return false;
    if ((r?.prefixLength | 0) !== 0) return false;
    return r?.interf === ifaceIdx;
  });

  const zero6 = IPAddress.fromString("::");
  for (const r of matching) {
    const nh = (r?.nexthop instanceof IPAddress) ? r.nexthop : IPAddress.fromString("::");
    try {
      net.delRoute(zero6, 0, ifaceIdx, nh);
    } catch {
      try { net.delRoute(zero6, 0, ifaceIdx); } catch { }
    }
  }
}

/**
 * Default gateway route is 0.0.0.0/0 on ifaceIdx.
 * @param {any} net
 * @param {number} ifaceIdx
 * @returns {IPAddress|null}
 */
function getDefaultGatewayForIface(net, ifaceIdx) {
  const routes = getRoutes(net);
  for (const r of routes) {
    const dst = r?.dst;
    const pref = r?.prefixLength;
    const interf = r?.interf;
    if (interf !== ifaceIdx) continue;
    if (!(dst instanceof IPAddress) || !dst.isV4()) continue;
    if ((/** @type {number} */ (dst.getNumber()) >>> 0) !== 0) continue;
    if ((pref | 0) !== 0) continue;

    const nh = r?.nexthop;
    if (nh instanceof IPAddress) return nh;
    return null;
  }
  return null;
}

/**
 * Clear all default routes 0.0.0.0/0 for ifaceIdx.
 * @param {any} net
 * @param {number} ifaceIdx
 */
function clearDefaultGatewayForIface(net, ifaceIdx) {
  const routes = getRoutes(net).filter(r => {
    const dst = r?.dst;
    const pref = r?.prefixLength;
    const interf = r?.interf;
    if (interf !== ifaceIdx) return false;
    if (!(dst instanceof IPAddress) || !dst.isV4()) return false;
    if ((/** @type {number} */ (dst.getNumber()) >>> 0) !== 0) return false;
    if ((pref | 0) !== 0) return false;
    return true;
  });

  const zero = IPAddress.fromString("0.0.0.0");

  if (routes.length === 0) {
    // nothing to clear
    return;
  }

  for (const r of routes) {
    const nh = (r?.nexthop instanceof IPAddress) ? r.nexthop : IPAddress.fromString("0.0.0.0");
    try {
      net.delRoute(zero, 0, ifaceIdx, nh);
    } catch {
      // If your delRoute signature differs, adjust here.
      try { net.delRoute(zero, 0, ifaceIdx); } catch { }
    }
  }
}
