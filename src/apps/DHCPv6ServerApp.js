//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";
import { nowStamp, hexPreview } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { DHCPv6Packet } from "../net/pdu/DHCPv6Packet.js";

// ---- helpers ----

/**
 * @param {string} s
 * @returns {IPAddress}
 */
function parseIPv6(s) {
  const ip = IPAddress.fromString(String(s ?? "").trim());
  if (!ip || !ip.isV6()) throw new Error(`invalid IPv6: ${s}`);
  return ip;
}

/**
 * @param {string} s
 * @returns {IPAddress[]}
 */
function parseIPv6List(s) {
  const parts = String(s ?? "").split(",").map(x => x.trim()).filter(Boolean);
  if (!parts.length) throw new Error("DNS list must not be empty");
  return parts.map(parseIPv6);
}

/**
 * Zero out host bits of a 16-byte IPv6 address for the given prefix length.
 * @param {Uint8Array} bytes
 * @param {number} prefixLen
 * @returns {Uint8Array}
 */
function maskPrefix(bytes, prefixLen) {
  const result = new Uint8Array(bytes);
  for (let i = 0; i < 16; i++) {
    const bitStart = i * 8;
    if (bitStart >= prefixLen) {
      result[i] = 0;
    } else if (bitStart + 8 > prefixLen) {
      const keep = prefixLen - bitStart;
      result[i] = result[i] & (0xff << (8 - keep));
    }
  }
  return result;
}

/**
 * Build IPv6 address: copy prefix bytes, then write 32-bit index into bytes [12..15].
 * Works correctly for prefixLength ≤ 96.
 * @param {Uint8Array} prefixBytes  masked 16-byte prefix
 * @param {number} index  positive integer (1-based host counter)
 * @returns {Uint8Array}
 */
function buildAddress(prefixBytes, index) {
  const addr = new Uint8Array(prefixBytes);
  const v = index >>> 0;
  addr[12] = (v >>> 24) & 0xff;
  addr[13] = (v >>> 16) & 0xff;
  addr[14] = (v >>> 8) & 0xff;
  addr[15] = v & 0xff;
  return addr;
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
function arrayEquals(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---- App ----

/**
 * /etc/dhcp6d.conf JSON format:
 * {
 *   "prefix":      "2001:db8::",
 *   "prefixLength": 64,
 *   "dns":         ["2001:4860:4860::8888"],
 *   "leaseTime":   3600,
 *   "autostart":   false
 * }
 */
export class DHCPv6ServerApp extends LoggedProcess {
  get title() {
    return t("app.dhcpv6server.title");
  }

  badge = "DHCPv6";
  icon = "fa-server";

  /** @type {Disposer} */
  disposer = new Disposer();

  confPath   = "/etc/dhcp6d.conf";
  listenPort = 547;

  /** @type {number|null} */
  socketPort = null;

  running = false;

  /** @type {HTMLTextAreaElement|null} */
  logEl = null;

  /** @type {HTMLInputElement|null} */
  prefixEl = null;

  /** @type {HTMLInputElement|null} */
  prefixLenEl = null;

  /** @type {HTMLInputElement|null} */
  dnsEl = null;

  /** @type {HTMLInputElement|null} */
  leaseTimeEl = null;

  /** @type {HTMLButtonElement|null} */
  startBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;

  /** @type {HTMLButtonElement|null} */
  saveBtn = null;

  /** @type {HTMLButtonElement|null} */
  loadBtn = null;

  /** @type {HTMLElement|null} */
  leasesPane = null;

  /** @type {HTMLTableSectionElement|null} */
  leasesBody = null;

  // ---- PD Server UI fields ----

  /** @type {HTMLElement|null} */
  pdPane = null;

  /** @type {HTMLInputElement|null} */
  pdEnabledEl = null;

  /** @type {HTMLInputElement|null} */
  pdPoolEl = null;

  /** @type {HTMLInputElement|null} */
  pdPoolLenEl = null;

  /** @type {HTMLInputElement|null} */
  pdDelegLenEl = null;

  /** @type {HTMLInputElement|null} */
  pdLeaseTimeEl = null;

  /** @type {HTMLTableSectionElement|null} */
  pdLeasesBody = null;

  /** @type {{ prefix: IPAddress, prefixLength: number, dns: IPAddress[], leaseTime: number }} */
  cfg = DHCPv6ServerApp.defaultCfg();

  // ---- PD Server state ----

  _pdEnabled = false;
  /** @type {IPAddress|null} */ _pdPool = null;
  _pdPoolLength = 48;
  _pdDelegatedLength = 56;
  _pdLeaseTime = 3600;

  /**
   * PD lease table keyed by DUID hex string.
   * @type {Map<string, { prefix16bytes: Uint8Array, prefixLen: number, index: number, expiresAt: number }>}
   */
  _pdLeases = new Map();
  /** @type {Set<number>} */ _pdAllocated = new Set();
  _pdNextIndex = 0;

  /**
   * Lease table keyed by DUID hex string.
   * @type {Map<string, { ip6bytes: Uint8Array, index: number, expiresAt: number }>}
   */
  _leases = new Map();

  /** @type {Set<number>} allocated host indices */
  _allocated = new Set();

  _nextIndex = 1;

  /** @type {Uint8Array|null} */
  _serverDUID = null;

  run() {
    this.root.classList.add("app", "app-dhcpv6-server");
    setTimeout(() => this._tryAutostart(), 0);
  }

  _tryAutostart() {
    try {
      const txt = this.os.fs.readFile(this.confPath);
      if (!txt?.trim()) return;
      const json = JSON.parse(txt);
      if (json.autostart !== true) return;
      this.cfg = DHCPv6ServerApp.cfgFromJSON(txt, this.cfg);
      this._applyPdFromJSON(json);
      this._start();
    } catch { }
  }

  /** @param {HTMLElement} root */
  async onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const prefixEl    = UI.input({ placeholder: "2001:db8::" });
    const prefixLenEl = UI.input({ placeholder: "64 (64–96)" });
    const dnsEl       = UI.input({ placeholder: "2001:4860:4860::8888" });
    const leaseTimeEl = UI.input({ placeholder: "3600" });

    this.prefixEl    = prefixEl;
    this.prefixLenEl = prefixLenEl;
    this.dnsEl       = dnsEl;
    this.leaseTimeEl = leaseTimeEl;

    /** @type {HTMLButtonElement} */
    const loadBtn = UI.button(t("app.dhcpv6server.button.load"), () => this._loadConfigFromDisk(), {});
    /** @type {HTMLButtonElement} */
    const saveBtn = UI.button(t("app.dhcpv6server.button.save"), () => this._saveConfigToDiskFromUI(), { primary: true });
    this.loadBtn = loadBtn;
    this.saveBtn = saveBtn;

    /** @type {HTMLButtonElement} */
    const start = UI.button(t("app.dhcpv6server.button.start"), () => this._startFromUI(), { primary: true });
    /** @type {HTMLButtonElement} */
    const stop  = UI.button(t("app.dhcpv6server.button.stop"), () => this._stop(), {});
    /** @type {HTMLButtonElement} */
    const clear = UI.button(t("app.dhcpv6server.button.clearLog"), () => { this.log = []; this._renderLog(); }, {});
    this.startBtn = start;
    this.stopBtn  = stop;

    const logBox = UI.textarea({ className: "log", readonly: "true", spellcheck: "false" });
    this.logEl = logBox;

    const configPane = UI.el("div", { children: [
      UI.row(t("app.dhcpv6server.label.prefix"),       prefixEl),
      UI.row(t("app.dhcpv6server.label.prefixLength"),  prefixLenEl),
      UI.row(t("app.dhcpv6server.label.dns"),           dnsEl),
      UI.row(t("app.dhcpv6server.label.leaseTime"),     leaseTimeEl),
      UI.buttonRow([loadBtn, saveBtn]),
    ]});

    const logPane = UI.el("div", { children: [
      UI.buttonRow([clear]),
      logBox,
    ]});

    const leasesTable = /** @type {HTMLTableElement} */ (UI.el("table", { className: "dhcp6-leases-table" }));
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    [
      t("app.dhcpv6server.leases.col.duid"),
      t("app.dhcpv6server.leases.col.address"),
      t("app.dhcpv6server.leases.col.expires"),
    ].forEach(label => {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    leasesTable.appendChild(thead);
    const tbody = document.createElement("tbody");
    leasesTable.appendChild(tbody);
    this.leasesBody = tbody;

    const leasesPane = UI.el("div", { children: [leasesTable] });
    this.leasesPane = leasesPane;

    // ---- PD Server tab ----
    const pdEnabledEl  = /** @type {HTMLInputElement} */ (UI.el("input", { attrs: { type: "checkbox" } }));
    const pdPoolEl     = UI.input({ placeholder: "2001:db8:100::" });
    const pdPoolLenEl  = UI.input({ placeholder: "48" });
    const pdDelegLenEl = UI.input({ placeholder: "56" });
    const pdLeaseTimeEl = UI.input({ placeholder: "3600" });
    this.pdEnabledEl  = pdEnabledEl;
    this.pdPoolEl     = pdPoolEl;
    this.pdPoolLenEl  = pdPoolLenEl;
    this.pdDelegLenEl = pdDelegLenEl;
    this.pdLeaseTimeEl = pdLeaseTimeEl;

    const pdSaveBtn = UI.button(t("app.dhcpv6server.pd.save"), () => this._savePdConfig(), { primary: true });

    const pdLeasesTable = /** @type {HTMLTableElement} */ (UI.el("table", { className: "dhcp6-leases-table" }));
    const pdThead = document.createElement("thead");
    const pdHeaderRow = document.createElement("tr");
    [
      t("app.dhcpv6server.pd.leases.col.duid"),
      t("app.dhcpv6server.pd.leases.col.prefix"),
      t("app.dhcpv6server.pd.leases.col.expires"),
    ].forEach(label => {
      const th = document.createElement("th");
      th.textContent = label;
      pdHeaderRow.appendChild(th);
    });
    pdThead.appendChild(pdHeaderRow);
    pdLeasesTable.appendChild(pdThead);
    const pdTbody = document.createElement("tbody");
    pdLeasesTable.appendChild(pdTbody);
    this.pdLeasesBody = pdTbody;

    const pdPane = UI.el("div", { children: [
      UI.row(t("app.dhcpv6server.pd.enabled"),         pdEnabledEl),
      UI.row(t("app.dhcpv6server.pd.pool"),             pdPoolEl),
      UI.row(t("app.dhcpv6server.pd.poolLength"),       pdPoolLenEl),
      UI.row(t("app.dhcpv6server.pd.delegatedLength"),  pdDelegLenEl),
      UI.row(t("app.dhcpv6server.pd.leaseTime"),        pdLeaseTimeEl),
      UI.buttonRow([pdSaveBtn]),
      pdLeasesTable,
    ]});
    this.pdPane = pdPane;

    this._writePdStateToUI();

    const { bar: tabBar, setActive: setTab } = UI.tabGroup([
      { id: "config", label: t("app.dhcpv6server.label.config") },
      { id: "log",    label: t("app.dhcpv6server.label.log") },
      { id: "leases", label: t("app.dhcpv6server.label.leases") },
      { id: "pd",     label: t("app.dhcpv6server.label.pd") },
    ], (id) => {
      configPane.style.display = id === "config" ? "" : "none";
      logPane.style.display    = id === "log"    ? "" : "none";
      leasesPane.style.display = id === "leases" ? "" : "none";
      pdPane.style.display     = id === "pd"     ? "" : "none";
      if (id === "leases") this._renderLeases();
      if (id === "pd")     this._renderPdLeases();
    });
    setTab("config");
    configPane.style.display = "";
    logPane.style.display    = "none";
    leasesPane.style.display = "none";
    pdPane.style.display     = "none";

    this.disposer.interval(() => {
      if (this.leasesPane && this.leasesPane.style.display !== "none") this._renderLeases();
      if (this.pdPane     && this.pdPane.style.display     !== "none") this._renderPdLeases();
    }, 3000);

    const panel = UI.panel([
      UI.buttonRow([start, stop]),
      tabBar,
      configPane,
      logPane,
      leasesPane,
      pdPane,
    ]);

    this.root.replaceChildren(panel);

    await this._loadConfigFromDisk();
    this._syncButtons();
    this._renderLog();
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl       = null;
    this.prefixEl    = null;
    this.prefixLenEl = null;
    this.dnsEl       = null;
    this.leaseTimeEl = null;
    this.startBtn    = null;
    this.stopBtn     = null;
    this.saveBtn     = null;
    this.loadBtn     = null;
    this.leasesPane  = null;
    this.leasesBody  = null;
    this.pdPane      = null;
    this.pdEnabledEl = null;
    this.pdPoolEl    = null;
    this.pdPoolLenEl = null;
    this.pdDelegLenEl = null;
    this.pdLeaseTimeEl = null;
    this.pdLeasesBody = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    super.destroy();
  }

  // ---- config ----

  static defaultCfg() {
    return {
      prefix:       parseIPv6("2001:db8::"),
      prefixLength: 64,
      dns:          [parseIPv6("2001:4860:4860::8888")],
      leaseTime:    3600,
    };
  }

  async _loadConfigFromDisk() {
    try {
      const txt = await this.os.fs.readFile(this.confPath);
      if (!txt.trim()) {
        this.cfg = DHCPv6ServerApp.defaultCfg();
        const def = this.cfgToJSON(this.cfg);
        await this.os.fs.writeFile(this.confPath, def);
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.createdDefaultConfig")} ${this.confPath}`);
      } else {
        let parsed; try { parsed = JSON.parse(txt); } catch {}
        this.cfg = DHCPv6ServerApp.cfgFromJSON(txt, this.cfg);
        this._applyPdFromJSON(parsed);
        this._writePdStateToUI();
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.configLoaded")} ${this.confPath}`);
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.configLoadFailed")} ${reason}`);
    }
    this._writeStateToUI();
  }

  async _saveConfigToDiskFromUI() {
    try {
      this.cfg = this._readUIConfigOrThrow();
      const txt = this.cfgToJSON(this.cfg);
      await this.os.fs.writeFile(this.confPath, txt);
      this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.configSaved")} ${this.confPath}`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.configSaveFailed")} ${reason}`);
    }
  }

  _writeStateToUI() {
    if (this.prefixEl)    this.prefixEl.value    = this.cfg.prefix.toString();
    if (this.prefixLenEl) this.prefixLenEl.value = String(this.cfg.prefixLength);
    if (this.dnsEl)       this.dnsEl.value       = this.cfg.dns.map(d => d.toString()).join(",");
    if (this.leaseTimeEl) this.leaseTimeEl.value  = String(this.cfg.leaseTime);
  }

  _readUIConfigOrThrow() {
    const prefixS    = (this.prefixEl?.value    ?? "").trim();
    const prefixLenS = (this.prefixLenEl?.value ?? "").trim();
    const dnsS       = (this.dnsEl?.value       ?? "").trim();
    const ltS        = (this.leaseTimeEl?.value  ?? "").trim();

    const prefix       = parseIPv6(prefixS);
    const prefixLength = Number(prefixLenS || "64");
    if (!Number.isInteger(prefixLength) || prefixLength < 64 || prefixLength > 96) {
      throw new Error("prefix length must be 64..96");
    }
    const dns       = parseIPv6List(dnsS);
    const leaseTime = Number(ltS || "3600");
    if (!Number.isFinite(leaseTime) || leaseTime <= 0) throw new Error("leaseTime must be > 0");

    return { prefix, prefixLength, dns, leaseTime: Math.floor(leaseTime) };
  }

  /**
   * @param {{ prefix: IPAddress, prefixLength: number, dns: IPAddress[], leaseTime: number }} cfg
   * @param {boolean} [autostart]
   */
  cfgToJSON(cfg, autostart = false) {
    return JSON.stringify({
      prefix:            cfg.prefix.toString(),
      prefixLength:      cfg.prefixLength,
      dns:               cfg.dns.map(d => d.toString()),
      leaseTime:         cfg.leaseTime,
      autostart,
      pdEnabled:         this._pdEnabled,
      pdPool:            this._pdPool?.toString() ?? "2001:db8:100::",
      pdPoolLength:      this._pdPoolLength,
      pdDelegatedLength: this._pdDelegatedLength,
      pdLeaseTime:       this._pdLeaseTime,
    }, null, 2) + "\n";
  }

  /**
   * @param {string} txt
   * @param {{ prefix: IPAddress, prefixLength: number, dns: IPAddress[], leaseTime: number }} fallback
   */
  static cfgFromJSON(txt, fallback) {
    /** @type {any} */ let o;
    try { o = JSON.parse(txt); } catch { throw new Error("Config JSON parse failed"); }

    const out = { ...fallback };

    if (typeof o?.prefix === "string") {
      try { out.prefix = parseIPv6(o.prefix); } catch { }
    }
    if (Number.isInteger(o?.prefixLength) && o.prefixLength >= 64 && o.prefixLength <= 96) {
      out.prefixLength = o.prefixLength;
    }
    if (Array.isArray(o?.dns)) {
      const arr = /** @type {IPAddress[]} */ (
        o.dns
          .filter((/** @type {*} */ x) => typeof x === "string")
          .map((/** @type {string} */ s) => { try { return parseIPv6(s); } catch { return null; } })
          .filter((/** @type {*} */ x) => x != null)
      );
      if (arr.length) out.dns = arr;
    }
    if (Number.isFinite(o?.leaseTime) && o.leaseTime > 0) out.leaseTime = Math.floor(o.leaseTime);

    return out;
  }

  /** Read PD config from parsed JSON object into instance fields. */
  /** @param {any} o */
  _applyPdFromJSON(o) {
    this._pdEnabled = o?.pdEnabled === true;
    if (typeof o?.pdPool === "string") {
      try { this._pdPool = parseIPv6(o.pdPool); } catch {}
    }
    if (!this._pdPool) {
      try { this._pdPool = parseIPv6("2001:db8:100::"); } catch {}
    }
    const pl = Number(o?.pdPoolLength ?? 48);
    if (Number.isInteger(pl) && pl >= 1 && pl <= 64) this._pdPoolLength = pl;
    const dl = Number(o?.pdDelegatedLength ?? 56);
    if (Number.isInteger(dl) && dl > this._pdPoolLength && dl <= 128) this._pdDelegatedLength = dl;
    const lt = Number(o?.pdLeaseTime ?? 3600);
    if (Number.isFinite(lt) && lt > 0) this._pdLeaseTime = Math.floor(lt);
  }

  // ---- start / stop ----

  _startFromUI() {
    try {
      this.cfg = this._readUIConfigOrThrow();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.invalidConfig")} ${reason}`);
      return;
    }
    this._start();
  }

  _start() {
    if (this.running) return;

    this._serverDUID = this._buildServerDUID();
    this._nextIndex  = 1;

    try {
      const anyV6 = IPAddress.fromString("::");
      if (!anyV6) throw new Error("Cannot create :: address");
      const port = this.os.net.openUDPSocket(anyV6, this.listenPort);
      this.socketPort = port;
      this.running    = true;
      this._writeAutostart(true);
      this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.listening")} udp/${this.listenPort} sock=${port}`);
      this._syncButtons();
      void this._recvLoop();
    } catch (e) {
      this.socketPort = null;
      this.running    = false;
      this._syncButtons();
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.startFailed")} ${reason}`);
    }
  }

  /** @returns {Uint8Array} */
  _buildServerDUID() {
    const itf = this.os.net.interfaces?.[0];
    if (itf?.mac instanceof Uint8Array && itf.mac.length === 6) {
      return DHCPv6Packet.buildDUID_LL(itf.mac);
    }
    return new Uint8Array([0, 2, 0, 0, 0, 9, 0, 0, 0, 0]);
  }

  /** @param {boolean} val */
  _writeAutostart(val) {
    try {
      const txt = this.os.fs.readFile(this.confPath);
      if (!txt?.trim()) return;
      const o = JSON.parse(txt);
      o.autostart = val;
      this.os.fs.writeFile(this.confPath, JSON.stringify(o, null, 2) + "\n");
    } catch { }
  }

  _stop() {
    if (!this.running && this.socketPort == null) return;
    this._writeAutostart(false);
    const port      = this.socketPort;
    this.running    = false;
    this.socketPort = null;

    if (port != null) {
      try {
        this.os.net.closeUDPSocket(port);
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.stopped")} sock=${port}`);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.stopError")} ${reason}`);
      }
    }
    this._syncButtons();
  }

  async _recvLoop() {
    while (this.running && this.socketPort != null) {
      const port = this.socketPort;

      /** @type {any} */
      let pkt;
      try {
        pkt = await this.os.net.recvUDPSocket(port);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.recvError")} ${reason}`);
        continue;
      }

      if (!this.running || this.socketPort == null) break;
      if (pkt == null) break;

      const srcIP   = (pkt.src instanceof IPAddress) ? pkt.src : null;
      const srcPort = typeof pkt.srcPort === "number" ? pkt.srcPort : 546;

      /** @type {Uint8Array} */
      const data = pkt.payload instanceof Uint8Array ? pkt.payload
        : (pkt.data instanceof Uint8Array ? pkt.data : new Uint8Array());

      this._appendLog(
        `[${nowStamp()}] RX ${srcIP ? srcIP.toString() : "?"}:${srcPort} len=${data.length} ${hexPreview(data)}`
      );

      /** @type {DHCPv6Packet} */
      let dhcp6;
      try {
        dhcp6 = DHCPv6Packet.fromBytes(data);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.parseError")} ${reason}`);
        continue;
      }

      if (srcIP) {
        await this._handleMessage(port, dhcp6, srcIP, srcPort);
      }
    }
    this._syncButtons();
  }

  /**
   * @param {number} sockPort
   * @param {DHCPv6Packet} req
   * @param {IPAddress} srcIP
   * @param {number} srcPort
   */
  async _handleMessage(sockPort, req, srcIP, srcPort) {
    const clientDUID = req.getOption(DHCPv6Packet.OPT_CLIENTID);
    if (!clientDUID) {
      this._appendLog(`[${nowStamp()}] DHCPv6: missing CLIENTID — dropped`);
      return;
    }
    const duidKey = DHCPv6Packet.duidToHex(clientDUID);

    this._cleanupExpiredLeases();

    switch (req.msgType) {
      case DHCPv6Packet.MT_SOLICIT:
        await this._handleSolicit(sockPort, req, srcIP, srcPort, duidKey, clientDUID);
        break;
      case DHCPv6Packet.MT_REQUEST:
      case DHCPv6Packet.MT_RENEW:
      case DHCPv6Packet.MT_CONFIRM:
        await this._handleRequest(sockPort, req, srcIP, srcPort, duidKey, clientDUID);
        break;
      case DHCPv6Packet.MT_RELEASE:
        await this._handleRelease(sockPort, req, srcIP, srcPort, duidKey, clientDUID);
        break;
      default:
        this._appendLog(`[${nowStamp()}] DHCPv6: ignore msgType=${req.msgType}`);
    }
  }

  /**
   * @param {number} sockPort
   * @param {DHCPv6Packet} req
   * @param {IPAddress} srcIP
   * @param {number} srcPort
   * @param {string} duidKey
   * @param {Uint8Array} clientDUID
   */
  async _handleSolicit(sockPort, req, srcIP, srcPort, duidKey, clientDUID) {
    const hasIaNA = !!req.getOption(DHCPv6Packet.OPT_IA_NA);
    const hasIaPD = !!req.getOption(DHCPv6Packet.OPT_IA_PD);

    let naLease = null;
    if (hasIaNA) {
      naLease = this._allocateOrReuse(duidKey);
      if (!naLease) this._appendLog(`[${nowStamp()}] DHCPv6: SOLICIT duid=…${duidKey.slice(-8)} → no free address`);
    }

    let pdLease = null;
    if (hasIaPD && this._pdEnabled) {
      pdLease = this._pdAllocOrReuse(duidKey);
      if (!pdLease) this._appendLog(`[${nowStamp()}] DHCPv6-PD: SOLICIT duid=…${duidKey.slice(-8)} → no free prefix`);
    }

    if (!naLease && !pdLease) return;

    const parts = [`SOLICIT duid=…${duidKey.slice(-8)} →`];
    if (naLease) parts.push(`ADVERTISE ${IPAddress.fromUInt8(naLease.ip6bytes)?.toString() ?? "?"}`);
    if (pdLease) parts.push(`PD-ADVERTISE ${IPAddress.fromUInt8(pdLease.prefix16bytes)?.toString() ?? "?"}/${pdLease.prefixLen}`);
    this._appendLog(`[${nowStamp()}] DHCPv6: ${parts.join(" ")}`);

    const pdInfo = pdLease ? { prefix16bytes: pdLease.prefix16bytes, prefixLen: pdLease.prefixLen } : null;
    const reply = this._buildReply(DHCPv6Packet.MT_ADVERTISE, req, clientDUID, naLease?.ip6bytes ?? null, pdInfo);
    try {
      this.os.net.sendUDPSocket(sockPort, srcIP, srcPort, reply.pack());
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(`[${nowStamp()}] DHCPv6: ADVERTISE send failed: ${reason}`);
    }
  }

  /**
   * @param {number} sockPort
   * @param {DHCPv6Packet} req
   * @param {IPAddress} srcIP
   * @param {number} srcPort
   * @param {string} duidKey
   * @param {Uint8Array} clientDUID
   */
  async _handleRequest(sockPort, req, srcIP, srcPort, duidKey, clientDUID) {
    if (req.msgType === DHCPv6Packet.MT_REQUEST) {
      const sid = req.getOption(DHCPv6Packet.OPT_SERVERID);
      if (!sid || !this._serverDUID || !arrayEquals(sid, this._serverDUID)) {
        this._appendLog(`[${nowStamp()}] DHCPv6: REQUEST for different server — dropped`);
        return;
      }
    }

    const hasIaNA = !!req.getOption(DHCPv6Packet.OPT_IA_NA);
    const hasIaPD = !!req.getOption(DHCPv6Packet.OPT_IA_PD);

    let naIp6bytes = null;
    if (hasIaNA) {
      const naLease = this._commitLease(duidKey);
      naIp6bytes = naLease.ip6bytes;
    }

    let pdLease = null;
    if (hasIaPD && this._pdEnabled) {
      pdLease = this._pdCommitLease(duidKey);
    }

    if (!hasIaNA && !pdLease) return;

    const label = req.msgType === DHCPv6Packet.MT_RENEW ? "RENEW" : "REQUEST";
    const parts = [`${label} duid=…${duidKey.slice(-8)} →`];
    if (naIp6bytes) parts.push(`REPLY ${IPAddress.fromUInt8(naIp6bytes)?.toString() ?? "?"}`);
    if (pdLease) parts.push(`PD-REPLY ${IPAddress.fromUInt8(pdLease.prefix16bytes)?.toString() ?? "?"}/${pdLease.prefixLen}`);
    this._appendLog(`[${nowStamp()}] DHCPv6: ${parts.join(" ")}`);

    const pdInfo = pdLease ? { prefix16bytes: pdLease.prefix16bytes, prefixLen: pdLease.prefixLen } : null;
    const reply = this._buildReply(DHCPv6Packet.MT_REPLY, req, clientDUID, naIp6bytes, pdInfo);
    try {
      this.os.net.sendUDPSocket(sockPort, srcIP, srcPort, reply.pack());
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(`[${nowStamp()}] DHCPv6: REPLY send failed: ${reason}`);
    }
  }

  /**
   * @param {number} sockPort
   * @param {DHCPv6Packet} req
   * @param {IPAddress} srcIP
   * @param {number} srcPort
   * @param {string} duidKey
   * @param {Uint8Array} clientDUID
   */
  async _handleRelease(sockPort, req, srcIP, srcPort, duidKey, clientDUID) {
    const lease = this._leases.get(duidKey);
    if (lease) {
      const ip6Str = IPAddress.fromUInt8(lease.ip6bytes)?.toString() ?? "?";
      this._allocated.delete(lease.index);
      this._leases.delete(duidKey);
      this._appendLog(`[${nowStamp()}] DHCPv6: RELEASE duid=…${duidKey.slice(-8)} ip=${ip6Str}`);
    } else {
      this._appendLog(`[${nowStamp()}] DHCPv6: RELEASE duid=…${duidKey.slice(-8)} (no lease)`);
    }
    const pdLease = this._pdLeases.get(duidKey);
    if (pdLease) {
      this._pdAllocated.delete(pdLease.index);
      this._pdLeases.delete(duidKey);
      this._appendLog(`[${nowStamp()}] DHCPv6-PD: RELEASE duid=…${duidKey.slice(-8)} prefix=${IPAddress.fromUInt8(pdLease.prefix16bytes)?.toString() ?? "?"}/${pdLease.prefixLen}`);
    }

    const reply = new DHCPv6Packet({ msgType: DHCPv6Packet.MT_REPLY, transactionId: req.transactionId });
    if (this._serverDUID) reply.setOption(DHCPv6Packet.OPT_SERVERID, this._serverDUID);
    reply.setOption(DHCPv6Packet.OPT_CLIENTID, clientDUID);
    reply.setOption(DHCPv6Packet.OPT_STATUS_CODE, new Uint8Array([0, DHCPv6Packet.STATUS_SUCCESS]));

    try {
      this.os.net.sendUDPSocket(sockPort, srcIP, srcPort, reply.pack());
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(`[${nowStamp()}] DHCPv6: REPLY (release) send failed: ${reason}`);
    }
  }

  /**
   * Build ADVERTISE or REPLY with optional IA_NA + optional IA_PD + DNS options.
   * @param {number} msgType
   * @param {DHCPv6Packet} req
   * @param {Uint8Array} clientDUID
   * @param {Uint8Array|null} ip6bytes  null = skip IA_NA
   * @param {{prefix16bytes:Uint8Array,prefixLen:number}|null} [pdInfo]  null = skip IA_PD
   * @returns {DHCPv6Packet}
   */
  _buildReply(msgType, req, clientDUID, ip6bytes, pdInfo = null) {
    const reply = new DHCPv6Packet({ msgType, transactionId: req.transactionId });

    if (this._serverDUID) reply.setOption(DHCPv6Packet.OPT_SERVERID, this._serverDUID);
    reply.setOption(DHCPv6Packet.OPT_CLIENTID, clientDUID);

    if (ip6bytes) {
      const preferred = (this.cfg.leaseTime * 0.5) >>> 0;
      const valid     = this.cfg.leaseTime >>> 0;
      const t1        = preferred;
      const t2        = (this.cfg.leaseTime * 0.8) >>> 0;

      // IAID: echo the IAID from the client's IA_NA option (RFC 3315 §18.2)
      const reqIaNABytes = req.getOption(DHCPv6Packet.OPT_IA_NA);
      const iaid = (reqIaNABytes && reqIaNABytes.length >= 4)
        ? (((reqIaNABytes[0] << 24) | (reqIaNABytes[1] << 16) | (reqIaNABytes[2] << 8) | reqIaNABytes[3]) >>> 0)
        : 1;

      const iaAddrData   = DHCPv6Packet.buildIAAddr(ip6bytes, preferred, valid);
      const iaAddrOption = DHCPv6Packet.encodeOption(DHCPv6Packet.OPT_IAADDR, iaAddrData);
      const iaNAData     = DHCPv6Packet.buildIA_NA(iaid, t1, t2, iaAddrOption);
      reply.setOption(DHCPv6Packet.OPT_IA_NA, iaNAData);
    }

    if (pdInfo) {
      const preferred = (this._pdLeaseTime * 0.5) >>> 0;
      const valid     = this._pdLeaseTime >>> 0;
      const t1        = preferred;
      const t2        = (this._pdLeaseTime * 0.8) >>> 0;

      const reqIaPDBytes = req.getOption(DHCPv6Packet.OPT_IA_PD);
      const pdIaid = (reqIaPDBytes && reqIaPDBytes.length >= 4)
        ? (((reqIaPDBytes[0] << 24) | (reqIaPDBytes[1] << 16) | (reqIaPDBytes[2] << 8) | reqIaPDBytes[3]) >>> 0)
        : 1;

      const iaPrefixData   = DHCPv6Packet.buildIAPrefix(preferred, valid, pdInfo.prefixLen, pdInfo.prefix16bytes);
      const iaPrefixOption = DHCPv6Packet.encodeOption(DHCPv6Packet.OPT_IAPREFIX, iaPrefixData);
      const iaPDData       = DHCPv6Packet.buildIA_PD(pdIaid, t1, t2, iaPrefixOption);
      reply.setOption(DHCPv6Packet.OPT_IA_PD, iaPDData);
    }

    if (this.cfg.dns.length > 0) {
      const dnsBytes = new Uint8Array(this.cfg.dns.length * 16);
      this.cfg.dns.forEach((d, i) => dnsBytes.set(d.toUInt8(), i * 16));
      reply.setOption(DHCPv6Packet.OPT_DNS_SERVERS, dnsBytes);
    }

    return reply;
  }

  // ---- lease management ----

  /**
   * Return existing valid lease or allocate a new address.
   * @param {string} duidKey
   * @returns {{ ip6bytes: Uint8Array, index: number, expiresAt: number }|null}
   */
  _allocateOrReuse(duidKey) {
    const existing = this._leases.get(duidKey);
    if (existing && existing.expiresAt > Date.now()) return existing;

    const prefixBytes = maskPrefix(this.cfg.prefix.toUInt8(), this.cfg.prefixLength);

    for (let tries = 0; tries < 65535; tries++) {
      const index = this._nextIndex;
      this._nextIndex++;
      if (this._nextIndex > 0xfffe_fffe) this._nextIndex = 1;
      if (this._allocated.has(index)) continue;

      const ip6bytes = buildAddress(prefixBytes, index);
      this._allocated.add(index);
      const lease = { ip6bytes, index, expiresAt: Date.now() + 60_000 };
      this._leases.set(duidKey, lease);
      return lease;
    }
    return null;
  }

  /**
   * Confirm / extend a lease (for REQUEST, RENEW).
   * @param {string} duidKey
   */
  _commitLease(duidKey) {
    const prev = this._leases.get(duidKey);
    if (!prev) {
      const lease = this._allocateOrReuse(duidKey);
      if (lease) {
        lease.expiresAt = Date.now() + this.cfg.leaseTime * 1000;
        return lease;
      }
      return { ip6bytes: new Uint8Array(16), index: 0, expiresAt: 0 };
    }
    prev.expiresAt = Date.now() + this.cfg.leaseTime * 1000;
    return prev;
  }

  _cleanupExpiredLeases() {
    const now = Date.now();
    for (const [duid, lease] of this._leases.entries()) {
      if (lease.expiresAt <= now) {
        this._allocated.delete(lease.index);
        this._leases.delete(duid);
      }
    }
  }

  // ---- PD lease management ----

  /**
   * @param {string} duidKey
   * @returns {{ prefix16bytes: Uint8Array, prefixLen: number, index: number, expiresAt: number }|null}
   */
  _pdAllocOrReuse(duidKey) {
    const existing = this._pdLeases.get(duidKey);
    if (existing && existing.expiresAt > Date.now()) return existing;

    if (!this._pdPool) return null;
    const poolBytes = maskPrefix(this._pdPool.toUInt8(), this._pdPoolLength);
    const subnetBits = this._pdDelegatedLength - this._pdPoolLength;
    if (subnetBits <= 0 || subnetBits > 24) return null;
    const maxSlots = 1 << subnetBits;

    for (let tries = 0; tries < maxSlots; tries++) {
      const index = this._pdNextIndex % maxSlots;
      this._pdNextIndex = (this._pdNextIndex + 1) % maxSlots;
      if (this._pdAllocated.has(index)) continue;

      const prefix16bytes = this._buildDelegatedPrefix(poolBytes, this._pdPoolLength, this._pdDelegatedLength, index);
      this._pdAllocated.add(index);
      const lease = { prefix16bytes, prefixLen: this._pdDelegatedLength, index, expiresAt: Date.now() + 60_000 };
      this._pdLeases.set(duidKey, lease);
      return lease;
    }
    return null;
  }

  /** @param {string} duidKey */
  _pdCommitLease(duidKey) {
    const prev = this._pdLeases.get(duidKey);
    if (!prev) {
      const lease = this._pdAllocOrReuse(duidKey);
      if (lease) { lease.expiresAt = Date.now() + this._pdLeaseTime * 1000; return lease; }
      return null;
    }
    prev.expiresAt = Date.now() + this._pdLeaseTime * 1000;
    return prev;
  }

  /**
   * Build a delegated prefix by writing `index` into bits [poolPrefixLen..delegatedPrefixLen-1]
   * of the masked pool prefix.
   * @param {Uint8Array} poolBytes  masked 16-byte pool prefix
   * @param {number} poolPrefixLen
   * @param {number} delegatedPrefixLen
   * @param {number} index
   * @returns {Uint8Array}
   */
  _buildDelegatedPrefix(poolBytes, poolPrefixLen, delegatedPrefixLen, index) {
    const result = new Uint8Array(poolBytes);
    const subnetBits = delegatedPrefixLen - poolPrefixLen;
    for (let i = 0; i < subnetBits; i++) {
      const bitPos  = poolPrefixLen + i;
      const byteIdx = bitPos >> 3;
      const shift   = 7 - (bitPos & 7);
      const bitVal  = (index >> (subnetBits - 1 - i)) & 1;
      if (bitVal) { result[byteIdx] |=  (1 << shift); }
      else        { result[byteIdx] &= ~(1 << shift); }
    }
    return result;
  }

  _pdCleanupExpired() {
    const now = Date.now();
    for (const [duid, lease] of this._pdLeases.entries()) {
      if (lease.expiresAt <= now) {
        this._pdAllocated.delete(lease.index);
        this._pdLeases.delete(duid);
      }
    }
  }

  // ---- PD config UI ----

  _writePdStateToUI() {
    if (this.pdEnabledEl)  this.pdEnabledEl.checked  = this._pdEnabled;
    if (this.pdPoolEl)     this.pdPoolEl.value        = this._pdPool?.toString() ?? "2001:db8:100::";
    if (this.pdPoolLenEl)  this.pdPoolLenEl.value     = String(this._pdPoolLength);
    if (this.pdDelegLenEl) this.pdDelegLenEl.value    = String(this._pdDelegatedLength);
    if (this.pdLeaseTimeEl) this.pdLeaseTimeEl.value  = String(this._pdLeaseTime);
  }

  _savePdConfig() {
    try {
      const enabled = this.pdEnabledEl?.checked ?? false;
      const poolStr = (this.pdPoolEl?.value ?? "").trim();
      const pool = parseIPv6(poolStr);
      const pl = Number((this.pdPoolLenEl?.value ?? "48").trim());
      if (!Number.isInteger(pl) || pl < 1 || pl > 64) throw new Error("Pool prefix length must be 1..64");
      const dl = Number((this.pdDelegLenEl?.value ?? "56").trim());
      if (!Number.isInteger(dl) || dl <= pl || dl > 128) throw new Error("Delegated length must be > pool length and ≤ 128");
      const lt = Number((this.pdLeaseTimeEl?.value ?? "3600").trim());
      if (!Number.isFinite(lt) || lt <= 0) throw new Error("Lease time must be > 0");

      this._pdEnabled         = enabled;
      this._pdPool            = pool;
      this._pdPoolLength      = pl;
      this._pdDelegatedLength = dl;
      this._pdLeaseTime       = Math.floor(lt);

      // Persist alongside main config
      try {
        const txt = this.os.fs.readFile(this.confPath);
        if (txt?.trim()) {
          const o = JSON.parse(txt);
          o.pdEnabled = this._pdEnabled;
          o.pdPool    = this._pdPool.toString();
          o.pdPoolLength = this._pdPoolLength;
          o.pdDelegatedLength = this._pdDelegatedLength;
          o.pdLeaseTime = this._pdLeaseTime;
          this.os.fs.writeFile(this.confPath, JSON.stringify(o, null, 2) + "\n");
        }
      } catch {}

      this._appendLog(`[${nowStamp()}] DHCPv6-PD: config saved (enabled=${enabled}, pool=${pool}/${pl}, delegated=/${dl})`);
    } catch (e) {
      this._appendLog(`[${nowStamp()}] DHCPv6-PD: config error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  _renderPdLeases() {
    if (!this.pdLeasesBody) return;
    this._pdCleanupExpired();
    const now = Date.now();

    /** @type {HTMLElement[]} */
    const rows = [];
    for (const [duid, lease] of this._pdLeases.entries()) {
      const prefix = IPAddress.fromUInt8(lease.prefix16bytes)?.toString() ?? "?";
      const sec = Math.max(0, Math.round((lease.expiresAt - now) / 1000));
      const min = Math.floor(sec / 60);
      const exp = min > 0 ? `${min}m ${sec % 60}s` : `${sec}s`;

      const tr = document.createElement("tr");
      const tdDuid = document.createElement("td");
      tdDuid.textContent = "…" + duid.slice(-12);
      tdDuid.title = duid;
      const tdPrefix = document.createElement("td");
      tdPrefix.textContent = `${prefix}/${lease.prefixLen}`;
      const tdExp = document.createElement("td");
      tdExp.textContent = exp;
      tr.append(tdDuid, tdPrefix, tdExp);
      rows.push(tr);
    }

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = t("app.dhcpv6server.pd.leases.empty");
      td.style.textAlign = "center";
      td.style.color = "var(--color-text-muted, #888)";
      tr.appendChild(td);
      rows.push(tr);
    }

    this.pdLeasesBody.replaceChildren(...rows);
  }

  // ---- UI helpers ----

  _syncButtons() {
    if (this.startBtn) this.startBtn.disabled = this.running;
    if (this.stopBtn)  this.stopBtn.disabled  = !this.running;
    const dis = this.running;
    if (this.prefixEl)    this.prefixEl.disabled    = dis;
    if (this.prefixLenEl) this.prefixLenEl.disabled = dis;
    if (this.dnsEl)       this.dnsEl.disabled       = dis;
    if (this.leaseTimeEl) this.leaseTimeEl.disabled = dis;
    if (this.saveBtn)      this.saveBtn.disabled      = dis;
    if (this.loadBtn)      this.loadBtn.disabled      = dis;
    if (this.pdPoolEl)     this.pdPoolEl.disabled     = dis;
    if (this.pdPoolLenEl)  this.pdPoolLenEl.disabled  = dis;
    if (this.pdDelegLenEl) this.pdDelegLenEl.disabled = dis;
    if (this.pdLeaseTimeEl) this.pdLeaseTimeEl.disabled = dis;
  }

  /** @param {string} line */
  _appendLog(line) {
    super._appendLog(line);
    if (this.mounted) {
      if (this.leasesPane && this.leasesPane.style.display !== "none") this._renderLeases();
      if (this.pdPane     && this.pdPane.style.display     !== "none") this._renderPdLeases();
    }
  }

  _renderLeases() {
    if (!this.leasesBody) return;
    this._cleanupExpiredLeases();
    const now = Date.now();

    /** @type {HTMLElement[]} */
    const rows = [];
    for (const [duid, lease] of this._leases.entries()) {
      const ip  = IPAddress.fromUInt8(lease.ip6bytes)?.toString() ?? "?";
      const sec = Math.max(0, Math.round((lease.expiresAt - now) / 1000));
      const min = Math.floor(sec / 60);
      const rem = sec % 60;
      const exp = min > 0 ? `${min}m ${rem}s` : `${sec}s`;

      const tr = document.createElement("tr");
      const tdDuid = document.createElement("td");
      tdDuid.textContent = "…" + duid.slice(-12);
      tdDuid.title = duid;
      const tdIp  = document.createElement("td");
      tdIp.textContent  = ip;
      const tdExp = document.createElement("td");
      tdExp.textContent = exp;
      tr.append(tdDuid, tdIp, tdExp);
      rows.push(tr);
    }

    if (rows.length === 0) {
      const tr  = document.createElement("tr");
      const td  = document.createElement("td");
      td.colSpan = 3;
      td.textContent  = t("app.dhcpv6server.leases.empty");
      td.style.textAlign = "center";
      td.style.color = "var(--color-text-muted, #888)";
      tr.appendChild(td);
      rows.push(tr);
    }

    this.leasesBody.replaceChildren(...rows);
  }
}
