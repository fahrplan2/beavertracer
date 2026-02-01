//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";

import { nowStamp, hexPreview, MACToNumber, assertLenU8 } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js"; // ggf. Pfad anpassen
import { DHCPPacket } from "../net/pdu/DHCPPacket.js";   // ggf. Pfad anpassen

/**
 * DHCP ist hier IPv4 (DHCPv4). Wir machen den Code aber "IPv6-ready",
 * indem wir überall IPAddress verwenden (API), und nur beim DHCP-PDU
 * konsequent IPv4-bytes/u32 benutzen.
 */

// ------------------------- IPv4 helpers (for DHCP wire format) -------------------------

/** @param {number} n */
function u32(n) { return (n >>> 0); }

/** @param {number} ipU32 */
function v4u32ToU8(ipU32) {
  const x = u32(ipU32);
  return new Uint8Array([(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);
}

/** @param {Uint8Array} u8 */
function u8ToV4u32(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length !== 4) return 0;
  return u32(((u8[0] << 24) >>> 0) + (u8[1] << 16) + (u8[2] << 8) + u8[3]);
}

/** @param {IPAddress} ip */
function v4NumberOrThrow(ip) {
  if (!(ip instanceof IPAddress) || !ip.isV4()) throw new Error("expected IPv4 IPAddress");
  const n = ip.getNumber();
  if (typeof n !== "number") throw new Error("expected IPv4 number");
  return u32(n);
}

/** @param {number} ipU32 */
function v4u32ToString(ipU32) {
  const x = u32(ipU32);
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
}

/** @param {number} ipU32 */
function v4u32ToIPAddress(ipU32) {
  // safest: parse dotted (works even if internal representation changes)
  return IPAddress.fromString(v4u32ToString(ipU32));
}

/**
 * Parse IPv4 dotted string into IPAddress.
 * (DHCPv4 config only; if you ever add DHCPv6, you’ll add a separate parser)
 * @param {string} s
 */
function parseIPv4Address(s) {
  const ip = IPAddress.fromString(String(s ?? "").trim());
  if (!ip || !(ip instanceof IPAddress) || !ip.isV4()) throw new Error(`invalid IPv4: ${s}`);
  return ip;
}

/**
 * Parse comma-separated DNS list into IPAddress[]
 * @param {string} s
 */
function parseIPv4List(s) {
  const parts = String(s ?? "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  if (!parts.length) throw new Error("dns must not be empty");

  return parts.map(parseIPv4Address);
}

/** @param {IPAddress} ip */
function ipToText(ip) {
  return (ip instanceof IPAddress) ? ip.toString() : String(ip ?? "");
}

// ------------------------- App -------------------------

/**
 * /etc/dhcpd.conf JSON format (string):
 * {
 *   "rangeStart": "192.168.1.100",
 *   "rangeEnd":   "192.168.1.200",
 *   "dns":        ["1.1.1.1", "8.8.8.8"],
 *   "gateway":    "192.168.1.1",
 *   "leaseTime":  3600,
 *   "subnetMask": "255.255.255.0",   // optional, default /24
 *   "serverId":   "192.168.1.1"      // optional, default gateway
 * }
 */
export class DHCPServerApp extends GenericProcess {
  get title() {
    return t("app.dhcpserver.title");
  }

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {string} */
  confPath = "/etc/dhcpd.conf";

  /** @type {number} */
  listenPort = 67;

  /** @type {number|null} */
  socketPort = null;

  /** @type {boolean} */
  running = false;

  /** @type {Array<string>} */
  log = [];

  /** @type {HTMLTextAreaElement|null} */
  logEl = null;

  /** @type {HTMLInputElement|null} */
  rangeStartEl = null;

  /** @type {HTMLInputElement|null} */
  rangeEndEl = null;

  /** @type {HTMLInputElement|null} */
  dnsEl = null;

  /** @type {HTMLInputElement|null} */
  gatewayEl = null;

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

  /**
   * Lease table: key is MACToNumber(mac) as string (BigInt -> string).
   * Intern speichern wir u32 + Bytes (weil DHCP-PDU IPv4 ist).
   * @type {Map<string, { ipNum:number, ipBytes:Uint8Array, expiresAt:number }>}
   */
  leases = new Map();

  /** @type {Set<number>} */
  allocated = new Set();

  /**
   * DHCP config as IPAddress (IPv4-only values), but API-friendly.
   * @type {{
   *  rangeStart: IPAddress,
   *  rangeEnd: IPAddress,
   *  dns: IPAddress[],
   *  gateway: IPAddress,
   *  leaseTime: number,
   *  subnetMask: IPAddress,
   *  serverId: IPAddress
   * }}
   */
  cfg = DHCPServerApp.defaultCfg();

  run() {
    this.root.classList.add("app", "app-dhcp-server");
  }

  /**
   * @param {HTMLElement} root
   */
  async onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const rangeStart = UI.input({ placeholder: "192.168.1.100" });
    const rangeEnd = UI.input({ placeholder: "192.168.1.200" });
    const dns = UI.input({ placeholder: "1.1.1.1,8.8.8.8" });
    const gateway = UI.input({ placeholder: "192.168.1.1" });
    const leaseTime = UI.input({ placeholder: "3600" });

    this.rangeStartEl = rangeStart;
    this.rangeEndEl = rangeEnd;
    this.dnsEl = dns;
    this.gatewayEl = gateway;
    this.leaseTimeEl = leaseTime;

    /** @type {HTMLButtonElement} */
    const loadBtn = UI.button(t("app.dhcpserver.button.load"), () => this._loadConfigFromDisk(), {});
    /** @type {HTMLButtonElement} */
    const saveBtn = UI.button(t("app.dhcpserver.button.save"), () => this._saveConfigToDiskFromUI(), { primary: true });

    this.loadBtn = loadBtn;
    this.saveBtn = saveBtn;

    /** @type {HTMLButtonElement} */
    const start = UI.button(t("app.dhcpserver.button.start"), () => this._startFromUI(), { primary: true });
    /** @type {HTMLButtonElement} */
    const stop = UI.button(t("app.dhcpserver.button.stop"), () => this._stop(), {});
    /** @type {HTMLButtonElement} */
    const clear = UI.button(t("app.dhcpserver.button.clearLog"), () => { this.log = []; this._renderLog(); }, {});

    this.startBtn = start;
    this.stopBtn = stop;

    const logBox = UI.textarea({
      className: "log",
      readonly: "true",
      spellcheck: "false",
    });
    this.logEl = logBox;

    const panel = UI.panel([
      UI.el("div", { text: t("app.dhcpserver.label.config") }),
      UI.row(t("app.dhcpserver.label.rangeStart"), rangeStart),
      UI.row(t("app.dhcpserver.label.rangeEnd"), rangeEnd),
      UI.row(t("app.dhcpserver.label.dns"), dns),
      UI.row(t("app.dhcpserver.label.gateway"), gateway),
      UI.row(t("app.dhcpserver.label.leaseTime"), leaseTime),
      UI.buttonRow([loadBtn, saveBtn]),
      UI.el("hr", {}),
      UI.el("div", { text: t("app.dhcpserver.label.server") }),
      UI.buttonRow([start, stop, clear]),
      UI.el("div", { text: t("app.dhcpserver.label.log") }),
      logBox,
    ]);

    this.root.replaceChildren(panel);

    await this._loadConfigFromDisk(); // load by default
    this._syncButtons();
    this._renderLog();
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl = null;
    this.rangeStartEl = null;
    this.rangeEndEl = null;
    this.dnsEl = null;
    this.gatewayEl = null;
    this.leaseTimeEl = null;
    this.startBtn = null;
    this.stopBtn = null;
    this.saveBtn = null;
    this.loadBtn = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    super.destroy();
  }

  _syncButtons() {
    if (this.startBtn) this.startBtn.disabled = this.running;
    if (this.stopBtn) this.stopBtn.disabled = !this.running;

    const dis = this.running;
    if (this.rangeStartEl) this.rangeStartEl.disabled = dis;
    if (this.rangeEndEl) this.rangeEndEl.disabled = dis;
    if (this.dnsEl) this.dnsEl.disabled = dis;
    if (this.gatewayEl) this.gatewayEl.disabled = dis;
    if (this.leaseTimeEl) this.leaseTimeEl.disabled = dis;
    if (this.saveBtn) this.saveBtn.disabled = dis;
    if (this.loadBtn) this.loadBtn.disabled = dis;
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

  // ------------------ config (JSON) ------------------

  static defaultCfg() {
    const gw = parseIPv4Address("192.168.1.1");
    return {
      rangeStart: parseIPv4Address("192.168.1.100"),
      rangeEnd: parseIPv4Address("192.168.1.200"),
      dns: [parseIPv4Address("1.1.1.1"), parseIPv4Address("8.8.8.8")],
      gateway: gw,
      leaseTime: 3600,
      subnetMask: parseIPv4Address("255.255.255.0"),
      serverId: gw,
    };
  }

  async _loadConfigFromDisk() {
    try {
      const txt = await this.os.fs.readFile(this.confPath); // string
      if (!txt.trim()) {
        const def = DHCPServerApp.cfgToJSON(DHCPServerApp.defaultCfg());
        await this.os.fs.writeFile(this.confPath, def);
        this.cfg = DHCPServerApp.defaultCfg();
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.createdDefaultConfig")} ${this.confPath}`);
      } else {
        this.cfg = DHCPServerApp.cfgFromJSON(txt, this.cfg);
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.configLoaded")} ${this.confPath}`);
      }
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.configLoadFailed")} ${reason}`);
    }

    this._writeStateToUI();
  }

  async _saveConfigToDiskFromUI() {
    try {
      const newCfg = this._readUIConfigOrThrow();
      this.cfg = newCfg;

      const txt = DHCPServerApp.cfgToJSON(this.cfg);
      await this.os.fs.writeFile(this.confPath, txt);

      this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.configSaved")} ${this.confPath}`);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.configSaveFailed")} ${reason}`);
    }
  }

  _writeStateToUI() {
    if (this.rangeStartEl) this.rangeStartEl.value = ipToText(this.cfg.rangeStart);
    if (this.rangeEndEl) this.rangeEndEl.value = ipToText(this.cfg.rangeEnd);
    if (this.gatewayEl) this.gatewayEl.value = ipToText(this.cfg.gateway);
    if (this.dnsEl) this.dnsEl.value = this.cfg.dns.map(ipToText).join(",");
    if (this.leaseTimeEl) this.leaseTimeEl.value = String(this.cfg.leaseTime);
  }

  /**
   * @returns {{
   *  rangeStart: IPAddress,
   *  rangeEnd: IPAddress,
   *  dns: IPAddress[],
   *  gateway: IPAddress,
   *  leaseTime: number,
   *  subnetMask: IPAddress,
   *  serverId: IPAddress
   * }}
   */
  _readUIConfigOrThrow() {
    const rsS = (this.rangeStartEl?.value ?? "").trim();
    const reS = (this.rangeEndEl?.value ?? "").trim();
    const dnsS = (this.dnsEl?.value ?? "").trim();
    const gwS = (this.gatewayEl?.value ?? "").trim();
    const ltS = (this.leaseTimeEl?.value ?? "").trim();

    const rs = parseIPv4Address(rsS);
    const re = parseIPv4Address(reS);
    const gw = parseIPv4Address(gwS);

    const dns = parseIPv4List(dnsS);

    const lt = Number(ltS || "3600");
    if (!Number.isFinite(lt) || lt <= 0) throw new Error("leaseTime must be > 0");

    // normalize ranges numerically (IPv4 only)
    const rsN = v4NumberOrThrow(rs);
    const reN = v4NumberOrThrow(re);
    const rangeStartN = Math.min(rsN, reN) >>> 0;
    const rangeEndN = Math.max(rsN, reN) >>> 0;

    return {
      rangeStart: v4u32ToIPAddress(rangeStartN),
      rangeEnd: v4u32ToIPAddress(rangeEndN),
      dns,
      gateway: gw,
      leaseTime: Math.floor(lt),
      subnetMask: parseIPv4Address("255.255.255.0"),
      serverId: gw,
    };
  }

  /**
   * @param {{
   *  rangeStart: IPAddress,
   *  rangeEnd: IPAddress,
   *  dns: IPAddress[],
   *  gateway: IPAddress,
   *  leaseTime: number,
   *  subnetMask: IPAddress,
   *  serverId: IPAddress
   * }} cfg
   */
  static cfgToJSON(cfg) {
    const o = {
      rangeStart: cfg.rangeStart.toString(),
      rangeEnd: cfg.rangeEnd.toString(),
      dns: cfg.dns.map(d => d.toString()),
      gateway: cfg.gateway.toString(),
      leaseTime: cfg.leaseTime,
      subnetMask: cfg.subnetMask.toString(),
      serverId: cfg.serverId.toString(),
    };
    return JSON.stringify(o, null, 2) + "\n";
  }

  /**
   * Parse JSON and merge into defaults.
   * @param {string} txt
   * @param {{
   *  rangeStart: IPAddress,
   *  rangeEnd: IPAddress,
   *  dns: IPAddress[],
   *  gateway: IPAddress,
   *  leaseTime: number,
   *  subnetMask: IPAddress,
   *  serverId: IPAddress
   * }} fallback
   */
  static cfgFromJSON(txt, fallback) {
    /** @type {any} */
    let o = null;
    try {
      o = JSON.parse(txt);
    } catch {
      throw new Error("Config JSON parse failed");
    }

    const out = { ...fallback };

    if (typeof o?.rangeStart === "string") out.rangeStart = parseIPv4Address(o.rangeStart);
    if (typeof o?.rangeEnd === "string") out.rangeEnd = parseIPv4Address(o.rangeEnd);
    if (typeof o?.gateway === "string") out.gateway = parseIPv4Address(o.gateway);

    if (Array.isArray(o?.dns)) {
      const arr = o.dns.filter(x => typeof x === "string").map(parseIPv4Address);
      if (arr.length) out.dns = arr;
    } else if (typeof o?.dns === "string") {
      const arr = parseIPv4List(o.dns);
      if (arr.length) out.dns = arr;
    }

    if (Number.isFinite(o?.leaseTime) && o.leaseTime > 0) out.leaseTime = Math.floor(o.leaseTime);

    if (typeof o?.subnetMask === "string") {
      try { out.subnetMask = parseIPv4Address(o.subnetMask); } catch {}
    }

    if (typeof o?.serverId === "string") {
      try { out.serverId = parseIPv4Address(o.serverId); } catch { out.serverId = out.gateway; }
    } else {
      out.serverId = out.gateway;
    }

    // normalize range order (IPv4)
    try {
      const a = v4NumberOrThrow(out.rangeStart);
      const b = v4NumberOrThrow(out.rangeEnd);
      if (b < a) {
        out.rangeStart = v4u32ToIPAddress(b);
        out.rangeEnd = v4u32ToIPAddress(a);
      }
    } catch {
      // ignore; but DHCPv4 needs v4 anyway
    }

    // default /24 if missing
    if (!out.subnetMask) out.subnetMask = parseIPv4Address("255.255.255.0");

    return out;
  }

  // ------------------ server start/stop ------------------

  _startFromUI() {
    try {
      this.cfg = this._readUIConfigOrThrow();
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.invalidConfig")} ${reason}`);
      return;
    }
    this._start();
  }

  _start() {
    if (this.running) return;

    try {
      // IPv6-ready API: bind address is IPAddress.
      // For DHCPv4 we bind 0.0.0.0
      const anyV4 = new IPAddress(4, 0); // wie du es bereits gemacht hast
      const port = this.os.net.openUDPSocket(anyV4, this.listenPort);

      this.socketPort = port;
      this.running = true;

      this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.listening")} udp/${this.listenPort} sock=${port}`);
      this._syncButtons();

      void this._recvLoop();
    } catch (e) {
      this.socketPort = null;
      this.running = false;
      this._syncButtons();
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.startFailed")} ${reason}`);
    }
  }

  _stop() {
    if (!this.running && this.socketPort == null) return;

    const port = this.socketPort;
    this.running = false;
    this.socketPort = null;

    if (port != null) {
      try {
        this.os.net.closeUDPSocket(port);
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.stopped")} sock=${port}`);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.stopError")} ${reason}`);
      }
    }

    this._syncButtons();
  }

  async _recvLoop() {
    while (this.running && this.socketPort != null) {
      const port = this.socketPort;

      /** @type {any} */
      let pkt = null;
      try {
        pkt = await this.os.net.recvUDPSocket(port);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.recvError")} ${reason}`);
        continue;
      }

      if (!this.running || this.socketPort == null) break;
      if (pkt == null) break;

      // IPv6-ready: src is expected to be IPAddress
      const srcIP = (pkt.src instanceof IPAddress) ? pkt.src : null;
      const srcPort = typeof pkt.srcPort === "number" ? pkt.srcPort : 0;

      /** @type {Uint8Array} */
      const data =
        pkt.payload instanceof Uint8Array
          ? pkt.payload
          : (pkt.data instanceof Uint8Array ? pkt.data : new Uint8Array());

      this._appendLog(
        `[${nowStamp()}] RX ${(srcIP ? srcIP.toString() : "?")}:${srcPort} len=${data.length} ${hexPreview(data)}`
      );

      let dh = null;
      try {
        dh = DHCPPacket.fromBytes(data);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.parseError")} ${reason}`);
        continue;
      }

      await this._handleDhcpMessage(port, dh);
    }

    this._syncButtons();
  }

  /**
   * @param {number} sockPort
   * @param {DHCPPacket} req
   */
  async _handleDhcpMessage(sockPort, req) {
    const mt = req.getMessageType();
    if (mt == null) {
      this._appendLog(`[${nowStamp()}] DHCP: missing message type (opt 53)`);
      return;
    }

    // MAC key
    const mac = req.getClientMAC();
    const mac6 = assertLenU8(mac, 6, "client mac");
    const macKey = String(MACToNumber(mac6));

    this._cleanupExpiredLeases();

    // cached numeric config for range comparisons (IPv4)
    const rangeStartN = v4NumberOrThrow(this.cfg.rangeStart);
    const rangeEndN = v4NumberOrThrow(this.cfg.rangeEnd);
    const serverIdN = v4NumberOrThrow(this.cfg.serverId);
    const subnetMaskN = v4NumberOrThrow(this.cfg.subnetMask);
    const gatewayN = v4NumberOrThrow(this.cfg.gateway);
    const dnsNums = this.cfg.dns.map(v4NumberOrThrow);

    // broadcast addr (IPv4)
    const bcastIP = IPAddress.fromString("255.255.255.255");

    if (mt === DHCPPacket.MT_DISCOVER) {
      const offerLease = this._allocateOrReuse(macKey, rangeStartN, rangeEndN);
      if (!offerLease) {
        this._appendLog(`[${nowStamp()}] DHCP: DISCOVER mac=${macKey} -> no free ip`);
        return;
      }

      const offer = this._makeReplyBase(req, offerLease.ipBytes, serverIdN);
      offer.setMessageType(DHCPPacket.MT_OFFER);
      this._fillStandardOptions(offer, subnetMaskN, gatewayN, dnsNums);

      try {
        this.os.net.sendUDPSocket(sockPort, bcastIP, 68, offer.pack());
        this._appendLog(`[${nowStamp()}] DHCP: OFFER mac=${macKey} yiaddr=${v4u32ToString(offerLease.ipNum)}`);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] DHCP: OFFER send failed: ${reason}`);
      }
      return;
    }

    if (mt === DHCPPacket.MT_REQUEST) {
      const opt50 = req.getOption(DHCPPacket.OPT_REQUESTED_IP);
      let requestedNum = 0;

      if (opt50 && opt50.length === 4) {
        requestedNum = u8ToV4u32(opt50);
      } else {
        requestedNum = u8ToV4u32(req.ciaddr);
      }

      const existing = this.leases.get(macKey);
      const chosen = u32(existing ? existing.ipNum : requestedNum);

      const inRange = chosen >= rangeStartN && chosen <= rangeEndN;
      const freeOrMine = this._isIpFreeOrOwnedByMac(chosen, macKey);

      if (!inRange || !freeOrMine) {
        const nak = this._makeReplyBase(req, v4u32ToU8(0), serverIdN);
        nak.setMessageType(DHCPPacket.MT_NAK);
        nak.setOption(DHCPPacket.OPT_SERVER_ID, v4u32ToU8(serverIdN));

        try {
          this.os.net.sendUDPSocket(sockPort, bcastIP, 68, nak.pack());
          this._appendLog(
            `[${nowStamp()}] DHCP: NAK mac=${macKey} requested=${v4u32ToString(chosen)} (inRange=${inRange}, freeOrMine=${freeOrMine})`
          );
        } catch (e) {
          const reason = (e instanceof Error ? e.message : String(e));
          this._appendLog(`[${nowStamp()}] DHCP: NAK send failed: ${reason}`);
        }
        return;
      }

      const lease = this._commitLease(macKey, chosen);

      const ack = this._makeReplyBase(req, lease.ipBytes, serverIdN);
      ack.setMessageType(DHCPPacket.MT_ACK);
      this._fillStandardOptions(ack, subnetMaskN, gatewayN, dnsNums);

      try {
        this.os.net.sendUDPSocket(sockPort, bcastIP, 68, ack.pack());
        this._appendLog(`[${nowStamp()}] DHCP: ACK mac=${macKey} yiaddr=${v4u32ToString(lease.ipNum)} lease=${this.cfg.leaseTime}s`);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] DHCP: ACK send failed: ${reason}`);
      }
      return;
    }

    if (mt === DHCPPacket.MT_RELEASE) {
      const l = this.leases.get(macKey);
      if (l) {
        this.leases.delete(macKey);
        this.allocated.delete(l.ipNum);
        this._appendLog(`[${nowStamp()}] DHCP: RELEASE mac=${macKey} ip=${v4u32ToString(l.ipNum)}`);
      } else {
        this._appendLog(`[${nowStamp()}] DHCP: RELEASE mac=${macKey} (no lease)`);
      }
      return;
    }

    this._appendLog(`[${nowStamp()}] DHCP: ignore mt=${mt} mac=${macKey}`);
  }

  /** @param {DHCPPacket} req @param {Uint8Array} yiaddr @param {number} serverIdU32 */
  _makeReplyBase(req, yiaddr, serverIdU32) {
    const rep = new DHCPPacket({
      op: 2,
      htype: req.htype,
      hlen: req.hlen,
      hops: 0,
      xid: req.xid,
      secs: 0,
      flags: req.flags,
      ciaddr: v4u32ToU8(0),
      yiaddr: yiaddr,
      siaddr: v4u32ToU8(serverIdU32),
      giaddr: v4u32ToU8(0),
      chaddr: req.chaddr.slice(0, 16),
      sname: new Uint8Array(64),
      file: new Uint8Array(128),
      options: [],
    });

    rep.setOption(DHCPPacket.OPT_SERVER_ID, v4u32ToU8(serverIdU32));
    return rep;
  }

  /** @param {DHCPPacket} p @param {number} subnetMaskU32 @param {number} gatewayU32 @param {number[]} dnsU32 */
  _fillStandardOptions(p, subnetMaskU32, gatewayU32, dnsU32) {
    p.setOption(DHCPPacket.OPT_SUBNET_MASK, v4u32ToU8(subnetMaskU32));
    p.setOption(DHCPPacket.OPT_ROUTER, v4u32ToU8(gatewayU32));

    // DNS list
    const dnsBytes = new Uint8Array(dnsU32.length * 4);
    dnsU32.forEach((n, i) => dnsBytes.set(v4u32ToU8(n), i * 4));
    p.setOption(DHCPPacket.OPT_DNS, dnsBytes);

    // lease time + T1/T2
    p.setOption(DHCPPacket.OPT_LEASE_TIME, DHCPServerApp.u32be(this.cfg.leaseTime));
    const t1 = Math.floor(this.cfg.leaseTime * 0.5);
    const t2 = Math.floor(this.cfg.leaseTime * 0.875);
    p.setOption(DHCPPacket.OPT_RENEWAL_T1, DHCPServerApp.u32be(t1));
    p.setOption(DHCPPacket.OPT_REBINDING_T2, DHCPServerApp.u32be(t2));
  }

  /** @param {string} macKey @param {number} rangeStartN @param {number} rangeEndN */
  _allocateOrReuse(macKey, rangeStartN, rangeEndN) {
    const existing = this.leases.get(macKey);
    if (existing && existing.expiresAt > Date.now()) return existing;

    for (let ip = rangeStartN; ip <= rangeEndN; ip = (ip + 1) >>> 0) {
      if (!this.allocated.has(ip)) {
        const tmp = { ipNum: ip >>> 0, ipBytes: v4u32ToU8(ip), expiresAt: Date.now() + 60_000 };
        this.leases.set(macKey, tmp);
        this.allocated.add(ip);
        return tmp;
      }
    }
    return null;
  }

  /** @param {string} macKey @param {number} ipNum */
  _commitLease(macKey, ipNum) {
    const prev = this.leases.get(macKey);
    if (prev && prev.ipNum !== ipNum) this.allocated.delete(prev.ipNum);

    this.allocated.add(ipNum);
    const lease = { ipNum: ipNum >>> 0, ipBytes: v4u32ToU8(ipNum), expiresAt: Date.now() + this.cfg.leaseTime * 1000 };
    this.leases.set(macKey, lease);
    return lease;
  }

  /** @param {number} ipNum @param {string} macKey */
  _isIpFreeOrOwnedByMac(ipNum, macKey) {
    if (!this.allocated.has(ipNum)) return true;
    const l = this.leases.get(macKey);
    return !!l && l.ipNum === (ipNum >>> 0);
  }

  _cleanupExpiredLeases() {
    const now = Date.now();
    for (const [mac, lease] of this.leases.entries()) {
      if (lease.expiresAt <= now) {
        this.leases.delete(mac);
        this.allocated.delete(lease.ipNum);
      }
    }
  }

  /** @param {number} n */
  static u32be(n) {
    const v = (n >>> 0);
    return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
  }
}
