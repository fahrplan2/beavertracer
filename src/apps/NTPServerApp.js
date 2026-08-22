//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";

import { nowStamp, hexPreview } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { NTPPacket } from "../net/pdu/NTPPacket.js";

/**
 * Minimal simulated NTPv4 server (RFC 5905), stratum 1 with a fictional
 * local reference clock ("LOCL") — a stand-in for a GPS/PPS appliance so
 * lessons don't need an upstream sync chain.
 *
 * This host's own virtual clock (`os.clock`, see SystemClock.js) is never
 * deliberately skewed, so it plays the role of "ground truth" that clients
 * running `ntpdate` correct themselves against.
 */
export class NTPServerApp extends LoggedProcess {
  get title() {
    return t("app.ntpserver.title");
  }

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {number} */
  port = 123;

  /** @type {number|null} */
  socketPort = null;

  /** @type {boolean} */
  running = false;

  /** @type {number} virtual time (ms) this server considers itself synced since */
  syncedSinceMs = 0;

  /** @type {HTMLInputElement|null} */
  portEl = null;

  /** @type {HTMLButtonElement|null} */
  startBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;

  icon = "fa-clock";
  badge = "NTP";

  run() {
    this.root.classList.add("app", "app-ntp-server");
    this._loadConfig();
    setTimeout(() => this._tryAutostart(), 0);
  }

  _tryAutostart() {
    try {
      const fs = this.os.fs;
      if (!fs) return;
      const json = JSON.parse(fs.readFile("/etc/ntpd.conf"));
      if (json.autostart !== true) return;
      this._start();
    } catch { }
  }

  /** @param {*} val */
  _writeAutostart(val) {
    try {
      const fs = this.os.fs;
      if (!fs) return;
      const txt = fs.readFile("/etc/ntpd.conf");
      if (!txt?.trim()) return;
      const o = JSON.parse(txt);
      o.autostart = val;
      fs.writeFile("/etc/ntpd.conf", JSON.stringify(o, null, 2) + "\n");
    } catch { }
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const portInput = UI.input({
      placeholder: t("app.ntpserver.placeholder.port"),
      value: String(this.port),
    });
    this.portEl = portInput;

    const start = UI.button(t("app.ntpserver.button.start"), () => this._startFromUI(), { primary: true, icon: "fa-play" });
    const stop = UI.button(t("app.ntpserver.button.stop"), () => this._stop(), { icon: "fa-stop" });
    const clear = UI.button(t("app.ntpserver.button.clearLog"), () => { this.log = []; this._renderLog(); }, {});

    this.startBtn = start;
    this.stopBtn = stop;

    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const serverPane = UI.el("div", { children: [
      UI.row(t("app.ntpserver.label.listenPort"), portInput),
    ]});
    const logPane = UI.el("div", { className: "log-pane", children: [
      UI.buttonRow([clear]),
      logBox,
    ]});

    const { bar: tabBar } = UI.tabbedPane([
      { id: "server", label: t("app.ntpserver.label.server"), pane: serverPane },
      { id: "log",    label: t("app.ntpserver.label.log"),    pane: logPane },
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
      this._appendLog(t("app.ntpserver.log.invalidPort", { time: nowStamp(), portStr: s }));
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
      const json = JSON.parse(fs.readFile("/etc/ntpd.conf"));
      if (Number.isInteger(json.port) && json.port >= 1 && json.port <= 65535) this.port = json.port;
    } catch { /* use defaults */ }
  }

  _saveConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      fs.writeFile("/etc/ntpd.conf", JSON.stringify({ port: this.port }, null, 2));
    } catch { /* ignore */ }
  }

  /** Current virtual time in ms — real wall time unless something deliberately skewed this host's clock. */
  _nowMs() {
    return this.os.clock ? this.os.clock.nowMs() : Date.now();
  }

  _start() {
    if (this.running) return;

    try {
      const port = this.os.net.openUDPSocket(new IPAddress(4, 0), this.port);
      this.socketPort = port;
      this.running = true;
      this.syncedSinceMs = this._nowMs();
      this._writeAutostart(true);

      this._appendLog(t("app.ntpserver.log.listening", { time: nowStamp(), port }));
      this._syncButtons();

      void this._recvLoop();
    } catch (e) {
      this.socketPort = null;
      this.running = false;
      this._syncButtons();
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(t("app.ntpserver.log.startFailed", { time: nowStamp(), reason }));
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
        this._appendLog(t("app.ntpserver.log.stopped", { time: nowStamp(), port }));
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.ntpserver.log.stopError", { time: nowStamp(), reason }));
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
        this._appendLog(t("app.ntpserver.log.recvError", { time: nowStamp(), reason }));
        continue;
      }

      // T2 — stamp the receive time as early as possible, before any parsing/logging work.
      const t2 = this._nowMs();

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

      this._appendLog(t("app.ntpserver.log.rx", {
        time: nowStamp(),
        ip: this._ipToString(srcIp),
        srcPort,
        len: data.length,
        hex: hexPreview(data),
      }));

      if (!srcIp) continue;

      /** @type {NTPPacket|null} */
      let req = null;
      try {
        req = NTPPacket.fromBytes(data);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.ntpserver.log.badRequest", { time: nowStamp(), reason }));
        continue;
      }

      if (req.mode !== NTPPacket.MODE_CLIENT) continue;

      const reply = new NTPPacket({
        li: 0,
        vn: 4,
        mode: NTPPacket.MODE_SERVER,
        stratum: 1,
        poll: req.poll,
        precision: -20, // ~1 microsecond, cosmetic
        rootDelay: 0,
        rootDispersion: 0,
        referenceId: "LOCL",
        referenceTimestampMs: this.syncedSinceMs,
        originTimestampMs: req.transmitTimestampMs, // T1, echoed back
        receiveTimestampMs: t2,
        transmitTimestampMs: this._nowMs(), // T3, stamped right before sending
      });

      try {
        this.os.net.sendUDPSocket(sock, srcIp, srcPort, reply.pack());
        this._appendLog(t("app.ntpserver.log.tx", {
          time: nowStamp(),
          ip: this._ipToString(srcIp),
          srcPort,
        }));
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.ntpserver.log.sendError", { time: nowStamp(), reason }));
      }
    }

    this._syncButtons();
  }
}
