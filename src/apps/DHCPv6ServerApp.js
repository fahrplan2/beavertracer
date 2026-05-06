//@ts-check

import { GenericProcess } from "./GenericProcess.js";
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
export class DHCPv6ServerApp extends GenericProcess {
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

  /** @type {string[]} */
  log = [];

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

  /** @type {{ prefix: IPAddress, prefixLength: number, dns: IPAddress[], leaseTime: number }} */
  cfg = DHCPv6ServerApp.defaultCfg();

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
      this._start();
    } catch { }
  }

  /** @param {HTMLElement} root */
  async onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const prefixEl    = UI.input({ placeholder: "2001:db8::" });
    const prefixLenEl = UI.input({ placeholder: "64" });
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

    const { bar: tabBar, setActive: setTab } = UI.tabGroup([
      { id: "config", label: t("app.dhcpv6server.label.config") },
      { id: "log",    label: t("app.dhcpv6server.label.log") },
    ], (id) => {
      configPane.style.display = id === "config" ? "" : "none";
      logPane.style.display    = id === "log"    ? "" : "none";
    });
    setTab("config");
    configPane.style.display = "";
    logPane.style.display    = "none";

    const panel = UI.panel([
      UI.buttonRow([start, stop]),
      tabBar,
      configPane,
      logPane,
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
        const def = DHCPv6ServerApp.cfgToJSON(DHCPv6ServerApp.defaultCfg());
        await this.os.fs.writeFile(this.confPath, def);
        this.cfg = DHCPv6ServerApp.defaultCfg();
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpv6server.log.createdDefaultConfig")} ${this.confPath}`);
      } else {
        this.cfg = DHCPv6ServerApp.cfgFromJSON(txt, this.cfg);
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
      const txt = DHCPv6ServerApp.cfgToJSON(this.cfg);
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
    if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 96) {
      throw new Error("prefix length must be 0..96");
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
  static cfgToJSON(cfg, autostart = false) {
    return JSON.stringify({
      prefix:       cfg.prefix.toString(),
      prefixLength: cfg.prefixLength,
      dns:          cfg.dns.map(d => d.toString()),
      leaseTime:    cfg.leaseTime,
      autostart,
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
    if (Number.isInteger(o?.prefixLength) && o.prefixLength >= 0 && o.prefixLength <= 96) {
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
    const lease = this._allocateOrReuse(duidKey);
    if (!lease) {
      this._appendLog(`[${nowStamp()}] DHCPv6: SOLICIT duid=…${duidKey.slice(-8)} → no free address`);
      return;
    }

    const ip6Str = IPAddress.fromUInt8(lease.ip6bytes)?.toString() ?? "?";
    this._appendLog(`[${nowStamp()}] DHCPv6: SOLICIT duid=…${duidKey.slice(-8)} → ADVERTISE ${ip6Str}`);

    const reply = this._buildReply(DHCPv6Packet.MT_ADVERTISE, req, clientDUID, lease.ip6bytes);
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

    const lease  = this._commitLease(duidKey);
    const ip6Str = IPAddress.fromUInt8(lease.ip6bytes)?.toString() ?? "?";
    const label  = req.msgType === DHCPv6Packet.MT_RENEW ? "RENEW" : "REQUEST";
    this._appendLog(`[${nowStamp()}] DHCPv6: ${label} duid=…${duidKey.slice(-8)} → REPLY ${ip6Str}`);

    const reply = this._buildReply(DHCPv6Packet.MT_REPLY, req, clientDUID, lease.ip6bytes);
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
   * Build ADVERTISE or REPLY with IA_NA + IAADDR + DNS options.
   * @param {number} msgType
   * @param {DHCPv6Packet} req
   * @param {Uint8Array} clientDUID
   * @param {Uint8Array} ip6bytes
   * @returns {DHCPv6Packet}
   */
  _buildReply(msgType, req, clientDUID, ip6bytes) {
    const reply = new DHCPv6Packet({ msgType, transactionId: req.transactionId });

    if (this._serverDUID) reply.setOption(DHCPv6Packet.OPT_SERVERID, this._serverDUID);
    reply.setOption(DHCPv6Packet.OPT_CLIENTID, clientDUID);

    const preferred = (this.cfg.leaseTime * 0.5) >>> 0;
    const valid     = this.cfg.leaseTime >>> 0;
    const t1        = preferred;
    const t2        = (this.cfg.leaseTime * 0.8) >>> 0;

    // IAID: use first 4 bytes of client DUID (or 1 as fallback)
    const iaid = clientDUID.length >= 4
      ? (((clientDUID[0] << 24) | (clientDUID[1] << 16) | (clientDUID[2] << 8) | clientDUID[3]) >>> 0)
      : 1;

    const iaAddrData   = DHCPv6Packet.buildIAAddr(ip6bytes, preferred, valid);
    const iaAddrOption = DHCPv6Packet.encodeOption(DHCPv6Packet.OPT_IAADDR, iaAddrData);
    const iaNAData     = DHCPv6Packet.buildIA_NA(iaid, t1, t2, iaAddrOption);
    reply.setOption(DHCPv6Packet.OPT_IA_NA, iaNAData);

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

  // ---- UI helpers ----

  _syncButtons() {
    if (this.startBtn) this.startBtn.disabled = this.running;
    if (this.stopBtn)  this.stopBtn.disabled  = !this.running;
    const dis = this.running;
    if (this.prefixEl)    this.prefixEl.disabled    = dis;
    if (this.prefixLenEl) this.prefixLenEl.disabled = dis;
    if (this.dnsEl)       this.dnsEl.disabled       = dis;
    if (this.leaseTimeEl) this.leaseTimeEl.disabled = dis;
    if (this.saveBtn)     this.saveBtn.disabled     = dis;
    if (this.loadBtn)     this.loadBtn.disabled     = dis;
  }

  _renderLog() {
    if (!this.logEl) return;
    const maxLines = 250;
    const lines = this.log.length > maxLines ? this.log.slice(-maxLines) : this.log;
    this.logEl.value = lines.join("\n");
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** @param {string} line */
  _appendLog(line) {
    this.log.push(line);
    if (this.log.length > 4000) this.log.splice(0, this.log.length - 4000);
    if (this.mounted) this._renderLog();
  }
}
