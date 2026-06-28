//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";

import { nowStamp, hexPreview } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js"; // ggf. Pfad anpassen

export class UDPEchoServerApp extends LoggedProcess {
  get title() {
    return t("app.udpechoserver.title");
  }

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {number} */
  port = 7;

  /** @type {number|null} */
  socketPort = null;

  /** @type {boolean} */
  running = false;

  /** @type {HTMLInputElement|null} */
  portEl = null;

  /** @type {HTMLButtonElement|null} */
  startBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;
  icon = "fa-server";
  badge = "UDP";

  run() {
    this.root.classList.add("app", "app-udp-echo");
    this._loadConfig();
    setTimeout(() => this._tryAutostart(), 0);
  }

  _tryAutostart() {
    try {
      const fs = this.os.fs;
      if (!fs) return;
      const json = JSON.parse(fs.readFile("/etc/udpechod.conf"));
      if (json.autostart !== true) return;
      this._start();
    } catch { }
  }

  /** @param {*} val */
  _writeAutostart(val) {
    try {
      const fs = this.os.fs;
      if (!fs) return;
      const txt = fs.readFile("/etc/udpechod.conf");
      if (!txt?.trim()) return;
      const o = JSON.parse(txt);
      o.autostart = val;
      fs.writeFile("/etc/udpechod.conf", JSON.stringify(o, null, 2) + "\n");
    } catch { }
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const portInput = UI.input({
      placeholder: t("app.udpechoserver.placeholder.port"),
      value: String(this.port),
    });
    this.portEl = portInput;

    /** @type {HTMLButtonElement} */
    const start = UI.button(t("app.udpechoserver.button.start"), () => this._startFromUI(), { primary: true, icon: "fa-play" });
    /** @type {HTMLButtonElement} */
    const stop = UI.button(t("app.udpechoserver.button.stop"), () => this._stop(), { icon: "fa-stop" });
    /** @type {HTMLButtonElement} */
    const clear = UI.button(t("app.udpechoserver.button.clearLog"), () => { this.log = []; this._renderLog(); }, {});

    this.startBtn = start;
    this.stopBtn = stop;

    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const serverPane = UI.el("div", { children: [
      UI.row(t("app.udpechoserver.label.listenPort"), portInput),
    ]});
    const logPane = UI.el("div", { className: "log-pane", children: [
      UI.buttonRow([clear]),
      logBox,
    ]});

    const { bar: tabBar } = UI.tabbedPane([
      { id: "server", label: t("app.udpechoserver.label.server"), pane: serverPane },
      { id: "log",    label: t("app.udpechoserver.label.log"),    pane: logPane },
    ]);

    const panel = UI.panel([UI.el("div", { className: "app-toolbar", children: [UI.buttonRow([start, stop])] }), tabBar, serverPane, logPane]);

    this.root.replaceChildren(panel);

    this._syncButtons();
    this._renderLog();
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl = null;
    this.portEl = null;
    this.startBtn = null;
    this.stopBtn = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    super.destroy();
  }

  _syncButtons() {
    if (this.startBtn) this.startBtn.disabled = this.running;
    if (this.stopBtn) this.stopBtn.disabled = !this.running;
    if (this.portEl) this.portEl.disabled = this.running;
  }

  _startFromUI() {
    const s = (this.portEl?.value ?? "").trim();
    const p = Number(s);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      this._appendLog(t("app.udpechoserver.log.invalidPort", { time: nowStamp(), portStr: s }));
      return;
    }
    this.port = p;
    this._saveConfig();
    this._start();
  }

  _loadConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      const json = JSON.parse(fs.readFile("/etc/udpechod.conf"));
      if (Number.isInteger(json.port) && json.port >= 1 && json.port <= 65535) this.port = json.port;
    } catch { /* use defaults */ }
  }

  _saveConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      fs.writeFile("/etc/udpechod.conf", JSON.stringify({ port: this.port }, null, 2));
    } catch { /* ignore */ }
  }

  _start() {
    if (this.running) return;

    try {
      const port = this.os.net.openUDPSocket(new IPAddress(4,0), this.port);
      this.socketPort = port;
      this.running = true;
      this._writeAutostart(true);

      this._appendLog(t("app.udpechoserver.log.listening", { time: nowStamp(), port }));
      this._syncButtons();

      void this._recvLoop();
    } catch (e) {
      this.socketPort = null;
      this.running = false;
      this._syncButtons();
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(t("app.udpechoserver.log.startFailed", { time: nowStamp(), reason }));
    }
  }

  _stop() {
    if (!this.running && this.socketPort == null) return;

    this._writeAutostart(false);
    const port = this.socketPort;
    this.running = false;
    this.socketPort = null;

    if (port != null) {
      try {
        this.os.net.closeUDPSocket(port);
        this._appendLog(t("app.udpechoserver.log.stopped", { time: nowStamp(), port }));
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.udpechoserver.log.stopError", { time: nowStamp(), reason }));
      }
    }

    this._syncButtons();
  }

  /** @param {IPAddress|null} ip */
  _ipToString(ip) {
    return ip ? ip.toString() : "*";
  }

  // ---------------- main loop ----------------

  async _recvLoop() {
    while (this.running && this.socketPort != null) {
      const sock = this.socketPort;

      /** @type {any} */
      let pkt = null;

      try {
        pkt = await this.os.net.recvUDPSocket(sock);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.udpechoserver.log.recvError", { time: nowStamp(), reason }));
        continue;
      }

      if (!this.running || this.socketPort == null) break;
      if (pkt == null) break;

      /** @type {IPAddress|null} */
      const srcIp = pkt.src instanceof IPAddress ? pkt.src : null;
      const srcPort = typeof pkt.srcPort === "number"
        ? (pkt.srcPort | 0)
        : (typeof pkt.remotePort === "number" ? (pkt.remotePort | 0) : 0);

      /** @type {Uint8Array} */
      const data =
        pkt.payload instanceof Uint8Array ? pkt.payload :
        (pkt.data instanceof Uint8Array ? pkt.data : new Uint8Array());

      this._appendLog(t("app.udpechoserver.log.rx", {
        time: nowStamp(),
        ip: this._ipToString(srcIp),
        srcPort,
        len: data.length,
        hex: hexPreview(data),
      }));

      // echo back
      try {
        if (!srcIp) continue;

        this.os.net.sendUDPSocket(sock, srcIp, srcPort, data);

        this._appendLog(t("app.udpechoserver.log.txEcho", {
          time: nowStamp(),
          ip: this._ipToString(srcIp),
          srcPort,
          len: data.length,
        }));
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.udpechoserver.log.sendError", { time: nowStamp(), reason }));
      }
    }

    this._syncButtons();
  }
}
