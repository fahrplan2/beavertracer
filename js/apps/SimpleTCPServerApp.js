//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { CleanupBag } from "./lib/CleanupBag.js";
import { t } from "../i18n/index.js";

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

/**
 * Parses your conn key format: `${localIP}:${localPort}>${remoteIP}:${remotePort}`
 * @param {string} key
 */
function parseTCPKey(key) {
  // example: "3232235530:12345>3232235521:54321"
  const m = /^(\d+):(\d+)>(\d+):(\d+)$/.exec(key);
  if (!m) {
    return {
      localIP: 0, localPort: 0,
      remoteIP: 0, remotePort: 0,
      ok: false
    };
  }
  return {
    localIP: Number(m[1]) >>> 0,
    localPort: Number(m[2]) | 0,
    remoteIP: Number(m[3]) >>> 0,
    remotePort: Number(m[4]) | 0,
    ok: true
  };
}

export class SimpleTCPServerApp extends GenericProcess {

  title = t("app.simpletcpserver.title");

  /** @type {CleanupBag} */
  bag = new CleanupBag();

  /** @type {number} */
  port = 7;

  /** @type {number|null} */
  listenPort = null;

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

  /** @type {Set<string>} */
  conns = new Set();

  run() {
    this.root.classList.add("app", "app-simple-tcp-server");
    // not auto-starting
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

    this.startBtn = start;
    this.stopBtn = stop;

    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const status = UI.el("div", { className: "msg" });

    const panel = UI.panel([
      UI.row("Listen Port", portInput),
      UI.buttonRow([start, stop, clear]),
      status,
      UI.el("div", { text: "Log:" }),
      logBox,
    ]);

    this.root.replaceChildren(panel);

    this._syncButtons();
    this._renderLog();

    this.bag.interval(() => {
      status.textContent =
        `PID: ${this.pid}\n` +
        `Running: ${this.running}\n` +
        `Port: ${this.listenPort ?? "-"}\n` +
        `Connections: ${this.conns.size}\n` +
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
    const maxLines = 200;
    const lines = this.log.length > maxLines ? this.log.slice(-maxLines) : this.log;
    this.logEl.textContent = lines.join("\n");
  }

  /**
   * @param {string} line
   */
  _appendLog(line) {
    this.log.push(line);
    if (this.log.length > 2000) this.log.splice(0, this.log.length - 2000);
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
      const port = this.os.net.openTCPServerSocket(0, this.port);
      this.listenPort = port;
      this.running = true;

      this._appendLog(`[${nowStamp()}] Listening (TCP) on 0.0.0.0:${port}`);
      this._syncButtons();

      // background accept loop
      this._acceptLoop();
    } catch (e) {
      this.listenPort = null;
      this.running = false;
      this._syncButtons();
      this._appendLog(`[${nowStamp()}] ERROR start failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  _stop() {
    if (!this.running && this.listenPort == null) return;

    const port = this.listenPort;
    this.running = false;
    this.listenPort = null;

    // best-effort close active conns (FIN)
    for (const key of Array.from(this.conns)) {
      try { this.os.net.closeTCPConn(key); } catch { /* ignore */ }
      this.conns.delete(key);
    }

    if (port != null) {
      try {
        this.os.net.closeTCPServerSocket(port);
        this._appendLog(`[${nowStamp()}] Stopped (listen port ${port} closed)`);
      } catch (e) {
        this._appendLog(`[${nowStamp()}] ERROR stop: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    this._syncButtons();
  }

  async _acceptLoop() {
    while (this.running && this.listenPort != null) {
      const port = this.listenPort;

      /** @type {string|null} */
      let key = null;
      try {
        key = await this.os.net.acceptTCPConn(port);
      } catch (e) {
        this._appendLog(`[${nowStamp()}] ERROR accept: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      if (!this.running || this.listenPort == null) break;
      if (key == null) break; // server socket closed

      this.conns.add(key);

      const info = parseTCPKey(key);
      const who = info.ok
        ? `${ipToString(info.remoteIP)}:${info.remotePort}`
        : key;

      this._appendLog(`[${nowStamp()}] CONNECT ${who}`);

      // handle each connection concurrently
      this._connEchoLoop(key).catch((e) => {
        this._appendLog(`[${nowStamp()}] ERROR conn loop: ${e instanceof Error ? e.message : String(e)}`);
      });
    }

    this._syncButtons();
  }

  /**
   * @param {string} key
   */
  async _connEchoLoop(key) {
    const info = parseTCPKey(key);
    const who = info.ok ? `${ipToString(info.remoteIP)}:${info.remotePort}` : key;

    try {
      while (this.running) {
        /** @type {Uint8Array|null} */
        let data = null;
        try {
          data = await this.os.net.recvTCPConn(key);
        } catch (e) {
          this._appendLog(`[${nowStamp()}] ERROR recv ${who}: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }

        if (!this.running) break;
        if (data == null) break; // peer closed or connection gone

        this._appendLog(
          `[${nowStamp()}] RX ${who} len=${data.length} hex=${hexPreview(data)}`
        );

        try {
          this.os.net.sendTCPConn(key, data);
          this._appendLog(`[${nowStamp()}] TX echo ${who} len=${data.length}`);
        } catch (e) {
          this._appendLog(`[${nowStamp()}] ERROR send ${who}: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
    } finally {
      this.conns.delete(key);

      // make sure we FIN if still around
      try { this.os.net.closeTCPConn(key); } catch { /* ignore */ }

      this._appendLog(`[${nowStamp()}] DISCONNECT ${who}`);
      this._syncButtons();
    }
  }
}
