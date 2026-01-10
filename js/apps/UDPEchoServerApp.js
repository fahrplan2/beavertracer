//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "./lib/Disposer.js";
import { t } from "../i18n/index.js";

import { nowStamp, ipToString, hexPreview } from "../helpers.js";

export class UDPEchoServerApp extends GenericProcess {

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

  /** @type {Array<string>} */
  log = [];

  /** @type {HTMLTextAreaElement|null} */
  logEl = null;

  /** @type {HTMLInputElement|null} */
  portEl = null;

  /** @type {HTMLButtonElement|null} */
  startBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;

  run() {
    this.root.classList.add("app", "app-udp-echo");
    // NICHT automatisch starten – User entscheidet (kannst du ändern)
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const portInput = UI.input({ placeholder: t("app.udpechoserver.placeholder.port"), value: String(this.port) });
    this.portEl = portInput;

    /** @type {HTMLButtonElement} */
    const start = UI.button(t("app.udpechoserver.button.start"), () => this._startFromUI(), { primary: true });
    /** @type {HTMLButtonElement} */
    const stop = UI.button(t("app.udpechoserver.button.stop"), () => this._stop(), {});
    /** @type {HTMLButtonElement} */
    const clear = UI.button(t("app.udpechoserver.button.clearLog"), () => { this.log = []; this._renderLog(); }, {});

    this.startBtn = start;
    this.stopBtn = stop;

    const logBox = UI.textarea({ 
      className: "log",
      readonly: "true",
      spellcheck: "false",
     });
    this.logEl = logBox;

    const panel = UI.panel([
      UI.row(t("app.udpechoserver.label.listenPort"), portInput),
      UI.buttonRow([start, stop, clear]),
      UI.el("div", { text: t("app.udpechoserver.label.log") }),
      logBox,
    ]);

    this.root.replaceChildren(panel);

    // UI-Status initial
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
    // ensure background loop is stopped + socket closed
    this._stop();
    super.destroy();
  }

  _syncButtons() {
    if (this.startBtn) this.startBtn.disabled = this.running;
    if (this.stopBtn) this.stopBtn.disabled = !this.running;
    if (this.portEl) this.portEl.disabled = this.running;
  }

  _renderLog() {
    if (!this.logEl) return;

    // show last N lines
    const maxLines = 200;
    const lines = this.log.length > maxLines ? this.log.slice(-maxLines) : this.log;
    this.logEl.value = lines.join("\n");
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /**
   * @param {string} line
   */
  _appendLog(line) {
    this.log.push(line);
    // keep memory bounded
    if (this.log.length > 2000) this.log.splice(0, this.log.length - 2000);

    // Only repaint UI when visible (but keep log always)
    if (this.mounted) this._renderLog();
  }

  _startFromUI() {
    const s = (this.portEl?.value ?? "").trim();
    const p = Number(s);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      this._appendLog(t("app.udpechoserver.log.invalidPort", { time: nowStamp(), portStr: s }));
      return;
    }
    this.port = p;
    this._start();
  }

  _start() {
    if (this.running) return;

    try {
      // bindaddr must be 0 (0.0.0.0)
      const port = this.os.net.openUDPSocket(0, this.port);
      this.socketPort = port;
      this.running = true;
      this._appendLog(t("app.udpechoserver.log.listening", { time: nowStamp(), port }));
      this._syncButtons();

      // background receive loop
      this._recvLoop();
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

  async _recvLoop() {
    // note: closeUDPSocket resolves waiters with null -> we exit gracefully
    while (this.running && this.socketPort != null) {
      const port = this.socketPort;

      /** @type {any} */
      let pkt = null;
      try {
        pkt = await this.os.net.recvUDPSocket(port);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.udpechoserver.log.recvError", { time: nowStamp(), reason }));
        continue;
      }

      // socket closed / stop signaled
      if (!this.running || this.socketPort == null) break;
      if (pkt == null) break;

      // We assume pkt has: src, srcPort, payload (Uint8Array)
      // If your structure differs, tell me the exact shape and I adapt.
      const srcIp = typeof pkt.src === "number" ? pkt.src : 0;
      const srcPort = typeof pkt.srcPort === "number" ? pkt.srcPort : 0;

      /** @type {Uint8Array} */
      const data =
        pkt.payload instanceof Uint8Array
          ? pkt.payload
          : (pkt.data instanceof Uint8Array ? pkt.data : new Uint8Array());

      this._appendLog(t("app.udpechoserver.log.rx", {
        time: nowStamp(),
        ip: ipToString(srcIp),
        srcPort,
        len: data.length,
        hex: hexPreview(data),
      }));

      // echo back
      try {
        this.os.net.sendUDPSocket(port, srcIp, srcPort, data);
        this._appendLog(t("app.udpechoserver.log.txEcho", {
          time: nowStamp(),
          ip: ipToString(srcIp),
          srcPort,
          len: data.length,
        }));
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.udpechoserver.log.sendError", { time: nowStamp(), reason }));
      }
    }

    // loop ends: ensure buttons reflect state
    this._syncButtons();
  }
}
