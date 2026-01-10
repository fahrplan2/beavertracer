//@ts-check

import { t } from "../i18n/index.js";
import { GenericProcess } from "./GenericProcess.js";
import { Disposer } from "./lib/Disposer.js";
import { UILib } from "./lib/UILib.js";

import {
  sleep,
  prefixToNetmask,
  IPNumberToUint8,
  IPUInt8ToNumber,
  assertLenU8,
} from "../helpers.js";

import { DHCPPacket } from "../pdu/DHCPPacket.js"; // <-- adjust path if needed

export class IPv4ConfigApp extends GenericProcess {
  get title() {
    return t("app.ipv4config.title");
  }

  /** @type {string} */
  configPath = "/etc/ip.config";

  /** @type {{ modeByIface: Record<string, "static"|"dhcp"> }} */
  persisted = { modeByIface: {} };

  /** @type {HTMLSelectElement|null} */ ifSel = null;
  /** @type {HTMLSelectElement|null} */ modeSel = null;

  /** @type {HTMLInputElement|null} */ ipEl = null;
  /** @type {HTMLInputElement|null} */ maskEl = null;
  /** @type {HTMLInputElement|null} */ gwEl = null;
  /** @type {HTMLInputElement|null} */ dnsEl = null;

  /** @type {HTMLElement|null} */ msgEl = null;

  /** @type {HTMLButtonElement|null} */ releaseBtn = null;
  lastDhcpServerByIface = new Map();

  /** @type {Disposer} */
  disposer = new Disposer();

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
      // if config can't be loaded, just don't autostart
      return;
    }

    const net = this.os.net;
    const ifs = net?.interfaces ?? [];
    for (let i = 0; i < ifs.length; i++) {
      const mode = this.persisted.modeByIface[String(i)] ?? "static";
      if (mode !== "dhcp") continue;

      // Fire-and-forget per interface (parallel)
      void (async () => {
        const ok = await this._dhcpAcquireAndConfigure(i);
        if (!ok) this._applyApipa(i);

        // If the app is currently showing this interface, refresh fields
        if (this.mounted && this.ifSel && Number(this.ifSel.value) === i) {
          this._load();
        }

        // Optional message (only if visible + current iface)
        if (this.mounted && this.ifSel && Number(this.ifSel.value) === i) {
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

    const ifSel = UILib.select(
      ifs.map((itf, i) => ({ value: String(i), label: `${i} – ${itf?.name ?? `if${i}`}` })),
      {}
    );

    const modeSel = UILib.select(
      [
        { value: "static", label: t("app.ipv4config.mode.static") },
        { value: "dhcp", label: t("app.ipv4config.mode.dhcp") },
      ],
      {}
    );

    const ipEl = UILib.input({ placeholder: "" });
    const maskEl = UILib.input({ placeholder: "" });
    const gwEl = UILib.input({ placeholder: "" });
    const dnsEl = UILib.input({ placeholder: "" });

    this.ifSel = ifSel;
    this.modeSel = modeSel;
    this.ipEl = ipEl;
    this.maskEl = maskEl;
    this.gwEl = gwEl;
    this.dnsEl = dnsEl;

    const applyBtn = UILib.button(t("app.ipv4config.button.apply"), () => this._apply(), { primary: true });
    const releaseBtn = UILib.button(t("app.ipv4config.button.release"), () => this._releaseDhcp(), {});

    this.releaseBtn = releaseBtn;

    const panel = UILib.panel([
      UILib.row(t("app.ipv4config.label.interface"), ifSel),
      UILib.row(t("app.ipv4config.label.mode"), modeSel),

      UILib.row(t("app.ipv4config.label.ip"), ipEl),
      UILib.row(t("app.ipv4config.label.netmask"), maskEl),
      UILib.row(t("app.ipv4config.label.gateway"), gwEl),
      UILib.row(t("app.ipv4config.label.dnsServer"), dnsEl),

      UILib.buttonRow([applyBtn, releaseBtn]),
      msg,
    ]);

    this.root.replaceChildren(panel);

    this.disposer.on(ifSel, "change", async () => {
      this._load();
      await this._loadModeForIfaceAndShow();
      this._syncModeUI();
    });

    this.disposer.on(modeSel, "change", async () => {
      const prev = (this.persisted.modeByIface[String(this._idx())] ?? "static");
      await this._persistModeForCurrentIface();


      const now = this._mode();
      if (prev === "static" && now === "dhcp") {
        this._dropInterfaceForDhcp(this._idx());
      }


      this._syncModeUI();
    });

    if (ifs.length === 0) {
      this._setMsg(t("app.ipv4config.msg.noInterfaces"));
      applyBtn.disabled = true;
      return;
    }

    ifSel.value = "0";

    // NEW: load persisted mode config
    await this._loadPersistedConfig();

    this._load();                       // load current interface values
    await this._loadModeForIfaceAndShow(); // load mode per iface from disk and set select
    this._syncModeUI();
  }

  onUnmount() {
    this.disposer.dispose();
    this.ifSel = this.modeSel = this.ipEl = this.maskEl = this.gwEl = this.dnsEl = null;
    this.msgEl = null;
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
    if (this.maskEl) this.maskEl.disabled = dis;
    if (this.gwEl) this.gwEl.disabled = dis;
    if (this.dnsEl) this.dnsEl.disabled = dis;

    if (this.releaseBtn) this.releaseBtn.disabled = (this._mode() !== "dhcp") || this.applying;

    if (dhcp && !this.applying) {
      this._setMsg(t("app.ipv4config.msg.dhcpModeHint"));
    }
  }

  _load() {
    const net = this.os.net;
    if (!net?.interfaces) return;

    const i = this._idx();
    const itf = net.interfaces[i];
    if (!itf) return this._setMsg(t("app.ipv4config.msg.interfaceNotFound", { i }));

    const ipN = itf.ip ?? null;
    const maskN = itf.netmask ?? null;

    if (this.ipEl) this.ipEl.value = (typeof ipN === "number") ? numberToIpv4(ipN) : "";
    if (this.maskEl) this.maskEl.value = (typeof maskN === "number") ? numberToIpv4(maskN) : "";

    const gw = getDefaultGatewayForIface(net, i);
    if (this.gwEl) this.gwEl.value = (gw != null) ? numberToIpv4(gw) : "";

    const dns = this.os.dns;
    let dnsN = null;
    if (dns && typeof dns.serverIp === "number") dnsN = dns.serverIp >>> 0;
    if (this.dnsEl) this.dnsEl.value = (dnsN != null) ? numberToIpv4(dnsN) : "";

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
          // NEW: reload UI fields so user sees applied settings
          this._load();
          // NEW: explicit "lease applied" message (in addition to the success text inside DHCP)
          this._setMsg(t("app.ipv4config.msg.dhcpLeaseApplied", { i }));
          return;
        }

        // fallback APIPA
        this._setMsg(t("app.ipv4config.msg.dhcpFailedApipa", { i }));
        this._applyApipa(i);

        // refresh fields
        this._load();
        this._setMsg(t("app.ipv4config.msg.apipaApplied", { i, ip: this.ipEl?.value ?? "", netmask: this.maskEl?.value ?? "" }));
        return;
      }

      // STATIC mode (unchanged behavior)
      const ipStr = (this.ipEl?.value ?? "").trim();
      const maskStr = (this.maskEl?.value ?? "").trim();
      const gwStr = (this.gwEl?.value ?? "").trim();
      const dnsStr = (this.dnsEl?.value ?? "").trim();

      const ip = ipv4ToNumber(ipStr);
      if (ip === null) return this._setMsg(t("app.ipv4config.err.invalidIp"));

      const netmask = ipv4ToNumber(maskStr);
      if (netmask === null) return this._setMsg(t("app.ipv4config.err.invalidNetmask"));

      if (!isValidNetmask32(netmask)) {
        return this._setMsg(t("app.ipv4config.err.invalidNetmaskContiguous"));
      }

      let gw = null;
      if (gwStr !== "") {
        const gwN = ipv4ToNumber(gwStr);
        if (gwN === null) return this._setMsg(t("app.ipv4config.err.invalidGateway"));
        if ((gwN >>> 0) === 0) return this._setMsg(t("app.ipv4config.err.gatewayZero"));
        gw = gwN >>> 0;
      }

      let dnsN = undefined;
      if (dnsStr !== "") {
        const d = ipv4ToNumber(dnsStr);
        if (d === null) return this._setMsg(t("app.ipv4config.err.invalidDnsServer"));
        dnsN = d >>> 0;
      }

      net.configureInterface(i, { ip: (ip >>> 0), netmask: (netmask >>> 0) });

      clearDefaultGatewayForIface(net, i);
      if (gw != null) net.addRoute(0, 0, i, gw);

      if (dnsN !== undefined) {
        const dns = this.os?.dns;
        if (dns?.setServer) dns.setServer(dnsN, 53);
      }

      if (dnsN !== undefined) {
        const dnsTxt = numberToIpv4(dnsN);
        this._setMsg(
          gw != null
            ? t("app.ipv4config.msg.appliedWithGwDns", { i, ip: ipStr, netmask: maskStr, gw: gwStr, dns: dnsTxt })
            : t("app.ipv4config.msg.appliedGwClearedDns", { i, ip: ipStr, netmask: maskStr, dns: dnsTxt })
        );
      } else {
        this._setMsg(
          gw != null
            ? t("app.ipv4config.msg.appliedWithGw", { i, ip: ipStr, netmask: maskStr, gw: gwStr })
            : t("app.ipv4config.msg.appliedGwCleared", { i, ip: ipStr, netmask: maskStr })
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

  // ------------------ NEW: persistence (/etc/ip.config) ------------------

  async _loadPersistedConfig() {
    try {
      const txt = await this.os.fs.readFile(this.configPath);
      if (!txt.trim()) {
        // create default
        await this.os.fs.writeFile(this.configPath, JSON.stringify(this.persisted, null, 2) + "\n");
        return;
      }

      /** @type {any} */
      const o = JSON.parse(txt);
      const m = o?.modeByIface;
      if (m && typeof m === "object") {
        // accept only "static"/"dhcp"
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

  // ------------------ DHCP (tick-scaled time) ------------------

  /**
   * Real time per simulated millisecond.
   * If missing, fall back to 1.
   */
  _tick() {
    const s = /** @type {any} */ (this.os)?.simulation;
    const tick = s && typeof s.tick === "number" && s.tick > 0 ? s.tick : 1;
    return tick;
  }

  /** sleep in *simulated ms* */
  async _simSleep(msSim) {
    await sleep(Math.max(0, Math.floor(msSim * this._tick())));
  }

  /**
   * DHCP acquire sequence.
   * Returns true on success.
   * @param {number} ifaceIdx
   * @returns {Promise<boolean>}
   */
  async _dhcpAcquireAndConfigure(ifaceIdx) {
    const net = this.os.net;
    if (!net?.interfaces?.[ifaceIdx]) return false;

    const itf = net.interfaces[ifaceIdx];
    const mac = this._getIfaceMac(itf, ifaceIdx);
    const xid = (Math.random() * 0xffffffff) >>> 0;

    // Timeouts in simulated ms (scaled via tick)
    const OFFER_WAIT_SIM = 15000;
    const ACK_WAIT_SIM = 15000;
    const BETWEEN_TRIES_SIM = 1500;

    for (let attempt = 1; attempt <= 3; attempt++) {
      this._setMsg(t("app.ipv4config.msg.dhcpAttempt", { attempt }));

      let sock = null;
      try {
        sock = this.os.net.openUDPSocket(0, 68);
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

        this.os.net.sendUDPSocket(sock, 0xffffffff >>> 0, 67, discover.pack());

        const offerPkt = await this._waitDhcp(sock, xid, DHCPPacket.MT_OFFER, OFFER_WAIT_SIM);
        if (!offerPkt) {
          try { this.os.net.closeUDPSocket(sock); } catch { }
          await this._simSleep(BETWEEN_TRIES_SIM);
          continue;
        }

        const offeredIp = IPUInt8ToNumber(offerPkt.yiaddr) >>> 0;

        const sidOpt = offerPkt.getOption(DHCPPacket.OPT_SERVER_ID);
        const serverId = (sidOpt && sidOpt.length === 4) ? IPUInt8ToNumber(sidOpt) >>> 0 : 0;

        if (serverId !== 0) this.lastDhcpServerByIface.set(ifaceIdx, serverId);

        // REQUEST
        const req = new DHCPPacket({ op: 1, xid, flags: 0x8000 });
        req.setClientMAC(mac);
        req.setMessageType(DHCPPacket.MT_REQUEST);
        req.setOption(DHCPPacket.OPT_REQUESTED_IP, IPNumberToUint8(offeredIp));
        if (serverId !== 0) req.setOption(DHCPPacket.OPT_SERVER_ID, IPNumberToUint8(serverId));

        this.os.net.sendUDPSocket(sock, 0xffffffff >>> 0, 67, req.pack());

        const ackPkt = await this._waitDhcp(sock, xid, DHCPPacket.MT_ACK, ACK_WAIT_SIM);
        try { this.os.net.closeUDPSocket(sock); } catch { }

        if (!ackPkt) {
          await this._simSleep(BETWEEN_TRIES_SIM);
          continue;
        }

        // apply config
        const ipNum = IPUInt8ToNumber(ackPkt.yiaddr) >>> 0;

        const maskOpt = ackPkt.getOption(DHCPPacket.OPT_SUBNET_MASK);
        const maskNum = (maskOpt && maskOpt.length === 4) ? IPUInt8ToNumber(maskOpt) >>> 0 : prefixToNetmask(24);

        let gwNum = null;
        const gwOpt = ackPkt.getOption(DHCPPacket.OPT_ROUTER);
        if (gwOpt && gwOpt.length >= 4) {
          gwNum = IPUInt8ToNumber(gwOpt.slice(0, 4)) >>> 0;
        }

        let dnsNum = null;
        const dnsOpt = ackPkt.getOption(DHCPPacket.OPT_DNS);
        if (dnsOpt && dnsOpt.length >= 4) {
          dnsNum = IPUInt8ToNumber(dnsOpt.slice(0, 4)) >>> 0;
        }

        net.configureInterface(ifaceIdx, { ip: ipNum, netmask: maskNum });

        clearDefaultGatewayForIface(net, ifaceIdx);
        if (gwNum != null && gwNum !== 0) net.addRoute(0, 0, ifaceIdx, gwNum);

        if (dnsNum != null) {
          const dns = this.os?.dns;
          if (dns?.setServer) dns.setServer(dnsNum, 53);
        }

        const sid = ackPkt.getOption(DHCPPacket.OPT_SERVER_ID);
        this.dhcpStateByIface.set(ifaceIdx, { serverId, ip: ipNum });

        // keep the detailed success text (optional), but we now also show dhcpLeaseApplied afterwards in _apply()
        this._setMsg(t("app.ipv4config.msg.dhcpSuccess", {
          i: ifaceIdx,
          ip: numberToIpv4(ipNum),
          netmask: numberToIpv4(maskNum),
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
   * Wait for DHCP packet with matching xid and message type.
   * Timeout is in simulated ms (scaled via tick).
   *
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

  _applyApipa(ifaceIdx) {
    const net = this.os.net;
    if (!net) return;

    const x = 1 + (Math.random() * 254) | 0;
    const y = 1 + (Math.random() * 254) | 0;
    const ip = (((169 << 24) >>> 0) + (254 << 16) + (x << 8) + y) >>> 0;

    const mask = prefixToNetmask(16) >>> 0;

    net.configureInterface(ifaceIdx, { ip, netmask: mask });
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

  _dropInterfaceForDhcp(ifaceIdx) {
    const net = this.os.net;
    if (!net) return;

    try {
      net.configureInterface(ifaceIdx, { ip: 0 >>> 0, netmask: 0 >>> 0 });
    } catch { /* ignore */ }

    try {
      clearDefaultGatewayForIface(net, ifaceIdx);
    } catch { /* ignore */ }

    // optional: disable DNS while “no config”
    const dns = this.os?.dns;
    if (dns?.setServer) {
      try { dns.setServer(0, 53); } catch { /* ignore */ }
    }

    // update visible fields if currently selected
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

    // Determine current IP (must be non-zero for RELEASE)
    const curIp = (typeof itf.ip === "number") ? (itf.ip >>> 0) : 0;
    if (curIp === 0) {
      this._setMsg(t("app.ipv4config.msg.releaseNothingToDo", { i: ifaceIdx }));
      return;
    }

    // Determine server id (per iface)
    const st = this.dhcpStateByIface.get(ifaceIdx);
    const serverId = st?.serverId ?? 0;

    // Open fresh UDP socket
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

      // RFC-style: ciaddr = client address being released
      rel.ciaddr = IPNumberToUint8(curIp);

      // server identifier option 54 if known
      if (serverId !== 0) rel.setOption(DHCPPacket.OPT_SERVER_ID, IPNumberToUint8(serverId));

      // Send to server if known; else broadcast
      const dstIp = (serverId !== 0) ? serverId : (0xffffffff >>> 0);

      // IMPORTANT: send BEFORE touching interface config
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
      // Close socket first (configureInterface might close sockets globally anyway)
      try { if (sock != null) this.os.net.closeUDPSocket(sock); } catch { }
    }

    // Now forget local DHCP state (optional)
    this.dhcpStateByIface.delete(ifaceIdx);

    // After release: drop address (0.0.0.0) and clear routes
    this._dropInterfaceForDhcp(ifaceIdx);
  }

    /**
   * DHCP client should use UDP src port 68 if possible.
   * Fallback to an ephemeral high port if 68 is busy.
   * @returns {number}
   */
  _openDhcpClientSocket() {
    // Try the standard DHCP client port first
    try {
      return this.os.net.openUDPSocket(0, 68);
    } catch {
      // Fallback: pick a high ephemeral port
      for (let k = 0; k < 20; k++) {
        const p = (49152 + ((Math.random() * (65535 - 49152)) | 0)) >>> 0;
        try {
          return this.os.net.openUDPSocket(0, p);
        } catch { /* try next */ }
      }
      throw new Error("No free UDP port for DHCP client");
    }
  }

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
 * @param {number} mask
 */
function isValidNetmask32(mask) {
  const m = mask >>> 0;
  const inv = (~m) >>> 0;
  return ((inv & ((inv + 1) >>> 0)) >>> 0) === 0;
}

/**
 * @param {any} net
 * @returns {any[]}
 */
function getRoutes(net) {
  return Array.isArray(net?.routingTable) ? net.routingTable : [];
}

/**
 * @param {any} net
 * @param {number} ifaceIdx
 * @returns {number|null}
 */
function getDefaultGatewayForIface(net, ifaceIdx) {
  const routes = getRoutes(net);
  for (const r of routes) {
    if (r && (r.dst === 0) && (r.netmask === 0) && (r.interf === ifaceIdx)) {
      return r.nexthop >>> 0;
    }
  }
  return null;
}

/**
 * @param {any} net
 * @param {number} ifaceIdx
 */
function clearDefaultGatewayForIface(net, ifaceIdx) {
  const routes = getRoutes(net).filter(r =>
    r &&
    ((r.dst >>> 0) === 0) &&
    ((r.netmask >>> 0) === 0) &&
    (r.interf === ifaceIdx)
  );

  if (routes.length === 0) {
    try { net.delRoute(0, 0, ifaceIdx); return; } catch { }
    try { net.delRoute(0, 0); } catch { }
    return;
  }

  for (const r of routes) {
    const nh = (typeof r.nexthop === "number") ? (r.nexthop >>> 0) : undefined;

    try { net.delRoute(0, 0, ifaceIdx, nh); continue; } catch { }
    try { net.delRoute(0, 0, ifaceIdx); continue; } catch { }
    try { net.delRoute(0, 0); } catch { }
  }
}
