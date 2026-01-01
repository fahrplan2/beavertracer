//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { DisposableBag } from "./lib/DisposeableBag.js";

/**
 * @param {number} n
 */
function nowStamp(n = Date.now()) {
  const d = new Date(n);
  return d.toLocaleTimeString();
}

/**
 * @param {number} ip
 */
function ipToString(ip) {
  // ip is unsigned 32-bit number
  return `${(ip >>> 24) & 255}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}`;
}

/**
 * @param {Uint8Array} data
 */
function hexPreview(data) {
  const max = 24;
  const slice = data.slice(0, max);
  let s = "";
  for (let i = 0; i < slice.length; i++) {
    s += slice[i].toString(16).padStart(2, "0");
    if (i < slice.length - 1) s += " ";
  }
  if (data.length > max) s += " …";
  return s;
}

export class UDPEchoApp extends GenericProcess {
  /** @type {DisposableBag} */
  bag = new DisposableBag();

  /** @type {number} */
  port = 7;

  /** @type {number|null} */
  socketPort = null;

  /** @type {boolean} */
  running = false;

  /** @type {Array<string>} */
  log = [];

  /** @type {HTMLElement|null} */
  logEl = null;

  /** @type {HTMLInputElement|null} */
  portEl = null;

  /** @type {HTMLButtonElement|null} */
  startBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;

  run() {
    this.title = "UDP Echo";
    this.root.classList.add("app", "app-udp-echo");
    // NICHT automatisch starten – User entscheidet (kannst du ändern)
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.bag.dispose();

    const portInput = UI.input({ placeholder: "Port (1..65535)", value: String(this.port) });
    this.portEl = portInput;

    /** @type {HTMLButtonElement} */
    const start = UI.button("Start", () => this._startFromUI(), { primary: true });
    /** @type {HTMLButtonElement} */
    const stop = UI.button("Stop", () => this._stop(), {});
    /** @type {HTMLButtonElement} */
    const clear = UI.button("Clear Log", () => { this.log = []; this._renderLog(); }, {});
    /** @type {HTMLButtonElement} */
    const close = UI.button("Close App", () => this.terminate(), {});

    this.startBtn = start;
    this.stopBtn = stop;

    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const status = UI.el("div", { className: "msg" });

    const panel = UI.panel("UDP Echo Server", [
      UI.row("Listen Port", portInput),
      UI.buttonRow([start, stop, clear, close]),
      status,
      UI.el("div", { text: "Log:" }),
      logBox,
    ]);

    this.root.replaceChildren(panel);

    // UI-Status initial
    this._syncButtons();
    this._renderLog();

    // Update status line while mounted (small heartbeat)
    this.bag.interval(() => {
      status.textContent =
        `PID: ${this.pid}\n` +
        `Running: ${this.running}\n` +
        `Port: ${this.socketPort ?? "-"}\n` +
        `Log entries: ${this.log.length}`;
    }, 300);
  }

  onUnmount() {
    this.bag.dispose();
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
    this.logEl.textContent = lines.join("\n");
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
      this._appendLog(`[${nowStamp()}] ERROR invalid port: "${s}"`);
      return;
    }
    this.port = p;
    this._start();
  }

  _start() {
    if (this.running) return;

    try {
      // bindaddr must be 0 (0.0.0.0)
      const port = this.os.ipforwarder.openUDPSocket(0, this.port);
      this.socketPort = port;
      this.running = true;
      this._appendLog(`[${nowStamp()}] Listening on 0.0.0.0:${port}`);
      this._syncButtons();

      // background receive loop
      this._recvLoop();
    } catch (e) {
      this.socketPort = null;
      this.running = false;
      this._syncButtons();
      this._appendLog(`[${nowStamp()}] ERROR start failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  _stop() {
    if (!this.running && this.socketPort == null) return;

    const port = this.socketPort;
    this.running = false;
    this.socketPort = null;

    if (port != null) {
      try {
        this.os.ipforwarder.closeUDPSocket(port);
        this._appendLog(`[${nowStamp()}] Stopped (port ${port} closed)`);
      } catch (e) {
        this._appendLog(`[${nowStamp()}] ERROR stop: ${e instanceof Error ? e.message : String(e)}`);
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
        pkt = await this.os.ipforwarder.recvUDPSocket(port);
      } catch (e) {
        this._appendLog(`[${nowStamp()}] ERROR recv: ${e instanceof Error ? e.message : String(e)}`);
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

      this._appendLog(
        `[${nowStamp()}] RX from ${ipToString(srcIp)}:${srcPort} len=${data.length} hex=${hexPreview(data)}`
      );

      // echo back
      try {
        this.os.ipforwarder.sendUDPSocket(port, srcIp, srcPort, data);
        this._appendLog(`[${nowStamp()}] TX echo to ${ipToString(srcIp)}:${srcPort} len=${data.length}`);
      } catch (e) {
        this._appendLog(`[${nowStamp()}] ERROR send: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // loop ends: ensure buttons reflect state
    this._syncButtons();
  }
}