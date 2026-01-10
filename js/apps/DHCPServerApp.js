//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "./lib/Disposer.js";
import { t } from "../i18n/index.js";

import {
  nowStamp,
  ipToString,
  hexPreview,
  IPOctetsToNumber,
  IPNumberToUint8,
  IPUInt8ToNumber,
  MACToNumber,
  assertLenU8,
} from "../helpers.js";

import { DHCPPacket } from "../pdu/DHCPPacket.js"; // <-- adjust if needed

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
   * @type {Map<string, { ipNum:number, ipBytes:Uint8Array, expiresAt:number }>}
   */
  leases = new Map();

  /** @type {Set<number>} */
  allocated = new Set();

  /** @type {{rangeStart:number, rangeEnd:number, dns:number[], gateway:number, leaseTime:number, subnetMask:number, serverId:number}} */
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
    if (this.saveBtn) this.saveBtn.disabled = dis; // config changes only when stopped
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
    const gw = DHCPServerApp.parseIP("192.168.1.1");
    return {
      rangeStart: DHCPServerApp.parseIP("192.168.1.100"),
      rangeEnd: DHCPServerApp.parseIP("192.168.1.200"),
      dns: [DHCPServerApp.parseIP("1.1.1.1"), DHCPServerApp.parseIP("8.8.8.8")],
      gateway: gw,
      leaseTime: 3600,
      subnetMask: DHCPServerApp.parseIP("255.255.255.0"),
      serverId: gw,
    };
  }

  async _loadConfigFromDisk() {
    try {
      const txt = await this.os.fs.readFile(this.confPath); // string
      if (!txt.trim()) {
        // create default file
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
      // keep current cfg
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
    if (this.rangeStartEl) this.rangeStartEl.value = ipToString(this.cfg.rangeStart);
    if (this.rangeEndEl) this.rangeEndEl.value = ipToString(this.cfg.rangeEnd);
    if (this.gatewayEl) this.gatewayEl.value = ipToString(this.cfg.gateway);
    if (this.dnsEl) this.dnsEl.value = this.cfg.dns.map(ipToString).join(",");
    if (this.leaseTimeEl) this.leaseTimeEl.value = String(this.cfg.leaseTime);
  }

  /** @returns {{rangeStart:number, rangeEnd:number, dns:number[], gateway:number, leaseTime:number, subnetMask:number, serverId:number}} */
  _readUIConfigOrThrow() {
    const rsS = (this.rangeStartEl?.value ?? "").trim();
    const reS = (this.rangeEndEl?.value ?? "").trim();
    const dnsS = (this.dnsEl?.value ?? "").trim();
    const gwS = (this.gatewayEl?.value ?? "").trim();
    const ltS = (this.leaseTimeEl?.value ?? "").trim();

    const rs = DHCPServerApp.parseIP(rsS);
    const re = DHCPServerApp.parseIP(reS);
    const gw = DHCPServerApp.parseIP(gwS);

    const dnsParts = dnsS.split(",").map(s => s.trim()).filter(Boolean);
    if (!dnsParts.length) throw new Error("dns must not be empty");
    const dns = dnsParts.map(DHCPServerApp.parseIP);

    const lt = Number(ltS || "3600");
    if (!Number.isFinite(lt) || lt <= 0) throw new Error("leaseTime must be > 0");

    const rangeStart = Math.min(rs, re) >>> 0;
    const rangeEnd = Math.max(rs, re) >>> 0;

    return {
      rangeStart,
      rangeEnd,
      dns,
      gateway: gw,
      leaseTime: Math.floor(lt),
      subnetMask: DHCPServerApp.parseIP("255.255.255.0"),
      serverId: gw,
    };
  }

  /**
   * Parse dotted IP string using existing helper IPOctetsToNumber.
   * @param {string} s
   */
  static parseIP(s) {
    const parts = s.trim().split(".");
    if (parts.length !== 4) throw new Error(`invalid IPv4: ${s}`);
    const oct = parts.map(p => Number(p));
    for (const n of oct) {
      if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`invalid IPv4: ${s}`);
    }
    return IPOctetsToNumber(oct[0], oct[1], oct[2], oct[3]) >>> 0;
  }

  /**
   * @param {{rangeStart:number, rangeEnd:number, dns:number[], gateway:number, leaseTime:number, subnetMask:number, serverId:number}} cfg
   */
  static cfgToJSON(cfg) {
    const o = {
      rangeStart: ipToString(cfg.rangeStart),
      rangeEnd: ipToString(cfg.rangeEnd),
      dns: cfg.dns.map(ipToString),
      gateway: ipToString(cfg.gateway),
      leaseTime: cfg.leaseTime,
      subnetMask: ipToString(cfg.subnetMask),
      serverId: ipToString(cfg.serverId),
    };
    return JSON.stringify(o, null, 2) + "\n";
  }

  /**
   * Parse JSON and merge into defaults.
   * @param {string} txt
   * @param {{rangeStart:number, rangeEnd:number, dns:number[], gateway:number, leaseTime:number, subnetMask:number, serverId:number}} fallback
   */
  static cfgFromJSON(txt, fallback) {
    /** @type {any} */
    let o = null;
    try {
      o = JSON.parse(txt);
    } catch (e) {
      throw new Error("Config JSON parse failed");
    }

    const out = { ...fallback };

    if (typeof o?.rangeStart === "string") out.rangeStart = DHCPServerApp.parseIP(o.rangeStart);
    if (typeof o?.rangeEnd === "string") out.rangeEnd = DHCPServerApp.parseIP(o.rangeEnd);
    if (typeof o?.gateway === "string") out.gateway = DHCPServerApp.parseIP(o.gateway);

    if (Array.isArray(o?.dns)) {
      const nums = o.dns.filter(x => typeof x === "string").map(DHCPServerApp.parseIP);
      if (nums.length) out.dns = nums;
    } else if (typeof o?.dns === "string") {
      // allow dns as comma-separated string too
      const parts = o.dns.split(",").map(s => s.trim()).filter(Boolean);
      const nums = parts.map(DHCPServerApp.parseIP);
      if (nums.length) out.dns = nums;
    }

    if (Number.isFinite(o?.leaseTime) && o.leaseTime > 0) out.leaseTime = Math.floor(o.leaseTime);

    if (typeof o?.subnetMask === "string") {
      try { out.subnetMask = DHCPServerApp.parseIP(o.subnetMask); } catch {}
    }
    if (typeof o?.serverId === "string") {
      try { out.serverId = DHCPServerApp.parseIP(o.serverId); } catch { out.serverId = out.gateway; }
    } else {
      out.serverId = out.gateway;
    }

    // normalize range
    if (out.rangeEnd < out.rangeStart) {
      const tmp = out.rangeStart;
      out.rangeStart = out.rangeEnd;
      out.rangeEnd = tmp;
    }

    // if subnetMask missing/zero, default /24
    if (!out.subnetMask) out.subnetMask = DHCPServerApp.parseIP("255.255.255.0");

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
      const port = this.os.net.openUDPSocket(0, this.listenPort);
      this.socketPort = port;
      this.running = true;

      this._appendLog(`[${nowStamp()}] ${t("app.dhcpserver.log.listening")} udp/${this.listenPort} sock=${port}`);
      this._syncButtons();

      this._recvLoop();
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

      const srcIpNum = typeof pkt.src === "number" ? pkt.src : 0;
      const srcPort = typeof pkt.srcPort === "number" ? pkt.srcPort : 0;

      /** @type {Uint8Array} */
      const data =
        pkt.payload instanceof Uint8Array
          ? pkt.payload
          : (pkt.data instanceof Uint8Array ? pkt.data : new Uint8Array());

      this._appendLog(`[${nowStamp()}] RX ${ipToString(srcIpNum)}:${srcPort} len=${data.length} ${hexPreview(data)}`);

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
    // ensure 6 bytes (DHCPPacket.getClientMAC returns chaddr[0..hlen], but we want 6)
    const mac6 = assertLenU8(mac, 6, "client mac");
    const macKey = String(MACToNumber(mac6)); // BigInt -> string key

    this._cleanupExpiredLeases();

    if (mt === DHCPPacket.MT_DISCOVER) {
      const offerLease = this._allocateOrReuse(macKey);
      if (!offerLease) {
        this._appendLog(`[${nowStamp()}] DHCP: DISCOVER mac=${macKey} -> no free ip`);
        return;
      }

      const offer = this._makeReplyBase(req, offerLease.ipBytes);
      offer.setMessageType(DHCPPacket.MT_OFFER);
      this._fillStandardOptions(offer);

      try {
        // Broadcast is safest in sim
        this.os.net.sendUDPSocket(sockPort, 0xffffffff >>> 0, 68, offer.pack());
        this._appendLog(`[${nowStamp()}] DHCP: OFFER mac=${macKey} yiaddr=${ipToString(offerLease.ipNum)}`);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] DHCP: OFFER send failed: ${reason}`);
      }
      return;
    }

    if (mt === DHCPPacket.MT_REQUEST) {
      // requested ip option(50) or ciaddr
      const opt50 = req.getOption(DHCPPacket.OPT_REQUESTED_IP);
      let requestedNum = 0;

      if (opt50 && opt50.length === 4) {
        requestedNum = IPUInt8ToNumber(opt50) >>> 0;
      } else {
        requestedNum = IPUInt8ToNumber(req.ciaddr) >>> 0;
      }

      const existing = this.leases.get(macKey);
      const chosen = (existing ? existing.ipNum : requestedNum) >>> 0;

      const inRange = chosen >= this.cfg.rangeStart && chosen <= this.cfg.rangeEnd;
      const freeOrMine = this._isIpFreeOrOwnedByMac(chosen, macKey);

      if (!inRange || !freeOrMine) {
        const nak = this._makeReplyBase(req, IPNumberToUint8(0));
        nak.setMessageType(DHCPPacket.MT_NAK);
        nak.setOption(DHCPPacket.OPT_SERVER_ID, IPNumberToUint8(this.cfg.serverId));

        try {
          this.os.net.sendUDPSocket(sockPort, 0xffffffff >>> 0, 68, nak.pack());
          this._appendLog(`[${nowStamp()}] DHCP: NAK mac=${macKey} requested=${ipToString(chosen)} (inRange=${inRange}, freeOrMine=${freeOrMine})`);
        } catch (e) {
          const reason = (e instanceof Error ? e.message : String(e));
          this._appendLog(`[${nowStamp()}] DHCP: NAK send failed: ${reason}`);
        }
        return;
      }

      const lease = this._commitLease(macKey, chosen);

      const ack = this._makeReplyBase(req, lease.ipBytes);
      ack.setMessageType(DHCPPacket.MT_ACK);
      this._fillStandardOptions(ack);

      try {
        this.os.net.sendUDPSocket(sockPort, 0xffffffff >>> 0, 68, ack.pack());
        this._appendLog(`[${nowStamp()}] DHCP: ACK mac=${macKey} yiaddr=${ipToString(lease.ipNum)} lease=${this.cfg.leaseTime}s`);
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
        this._appendLog(`[${nowStamp()}] DHCP: RELEASE mac=${macKey} ip=${ipToString(l.ipNum)}`);
      } else {
        this._appendLog(`[${nowStamp()}] DHCP: RELEASE mac=${macKey} (no lease)`);
      }
      return;
    }

    this._appendLog(`[${nowStamp()}] DHCP: ignore mt=${mt} mac=${macKey}`);
  }

  /** @param {DHCPPacket} req @param {Uint8Array} yiaddr */
  _makeReplyBase(req, yiaddr) {
    const rep = new DHCPPacket({
      op: 2,
      htype: req.htype,
      hlen: req.hlen,
      hops: 0,
      xid: req.xid,
      secs: 0,
      flags: req.flags,
      ciaddr: IPNumberToUint8(0),
      yiaddr: yiaddr,
      siaddr: IPNumberToUint8(this.cfg.serverId),
      giaddr: IPNumberToUint8(0),
      chaddr: req.chaddr.slice(0, 16),
      sname: new Uint8Array(64),
      file: new Uint8Array(128),
      options: [],
    });

    rep.setOption(DHCPPacket.OPT_SERVER_ID, IPNumberToUint8(this.cfg.serverId));
    return rep;
  }

  /** @param {DHCPPacket} p */
  _fillStandardOptions(p) {
    p.setOption(DHCPPacket.OPT_SUBNET_MASK, IPNumberToUint8(this.cfg.subnetMask));
    p.setOption(DHCPPacket.OPT_ROUTER, IPNumberToUint8(this.cfg.gateway));

    // DNS list
    const dnsBytes = new Uint8Array(this.cfg.dns.length * 4);
    this.cfg.dns.forEach((n, i) => dnsBytes.set(IPNumberToUint8(n), i * 4));
    p.setOption(DHCPPacket.OPT_DNS, dnsBytes);

    // lease time + T1/T2
    p.setOption(DHCPPacket.OPT_LEASE_TIME, DHCPServerApp.u32be(this.cfg.leaseTime));
    const t1 = Math.floor(this.cfg.leaseTime * 0.5);
    const t2 = Math.floor(this.cfg.leaseTime * 0.875);
    p.setOption(DHCPPacket.OPT_RENEWAL_T1, DHCPServerApp.u32be(t1));
    p.setOption(DHCPPacket.OPT_REBINDING_T2, DHCPServerApp.u32be(t2));
  }

  /** @param {string} macKey */
  _allocateOrReuse(macKey) {
    const existing = this.leases.get(macKey);
    if (existing && existing.expiresAt > Date.now()) return existing;

    for (let ip = this.cfg.rangeStart; ip <= this.cfg.rangeEnd; ip = (ip + 1) >>> 0) {
      if (!this.allocated.has(ip)) {
        const tmp = { ipNum: ip >>> 0, ipBytes: IPNumberToUint8(ip), expiresAt: Date.now() + 60_000 };
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
    const lease = { ipNum: ipNum >>> 0, ipBytes: IPNumberToUint8(ipNum), expiresAt: Date.now() + this.cfg.leaseTime * 1000 };
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
    return new Uint8Array([
      (v >>> 24) & 0xff,
      (v >>> 16) & 0xff,
      (v >>> 8) & 0xff,
      v & 0xff,
    ]);
  }
}
