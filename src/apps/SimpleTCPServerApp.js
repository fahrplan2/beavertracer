//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";
import { hexPreview, nowStamp } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js";

/**
 * Split "host:port" where host may be an IPv6 address (no brackets needed).
 * Uses last-colon heuristic: last colon separates port from the rest.
 * @param {string} s
 * @returns {{ host: string, port: number, ok: boolean }}
 */
function splitHostPort(s) {
  const str = String(s ?? "").trim();
  // bracketed IPv6: [..]:port
  const bm = /^\[([^\]]+)\]:(\d+)$/.exec(str);
  if (bm) return { host: bm[1], port: Number(bm[2]) | 0, ok: true };

  const lastColon = str.lastIndexOf(":");
  if (lastColon > 0 && lastColon < str.length - 1) {
    const port = Number(str.slice(lastColon + 1));
    if (Number.isInteger(port) && port >= 0 && port <= 65535) {
      return { host: str.slice(0, lastColon), port: port | 0, ok: true };
    }
  }
  return { host: str, port: 0, ok: false };
}

/**
 * Parse a TCP connection key produced by TcpEngine._tcpKey().
 * Supports both legacy uint32 format and current IP-string format.
 * @param {string} key
 * @returns {{ remoteIP: string, remotePort: number, ok: boolean }}
 */
function parseTCPKey(key) {
  const parts = String(key ?? "").split(">");
  if (parts.length !== 2) return { remoteIP: "", remotePort: 0, ok: false };

  const remote = splitHostPort(parts[1]);
  if (!remote.ok) return { remoteIP: "", remotePort: 0, ok: false };

  // Legacy uint32 fallback
  let remoteIP = remote.host;
  if (/^\d+$/.test(remoteIP)) {
    const n = Number(remoteIP) >>> 0;
    remoteIP = `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
  }

  return { remoteIP, remotePort: remote.port, ok: true };
}

export class SimpleTCPServerApp extends GenericProcess {

  get title() {
    return t("app.simpletcpserver.title");
  }

  /** @type {Disposer} */
  disposer = new Disposer();

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

  badge = "TCP";

  run() {
    this.root.classList.add("app", "app-simple-tcp-server");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const portInput = UI.input({ placeholder: t("app.simpletcpserver.placeholder.port"), value: String(this.port) });
    this.portEl = portInput;

    /** @type {HTMLButtonElement} */
    const start = UI.button(t("app.simpletcpserver.button.start"), () => this._startFromUI(), { primary: true });
    /** @type {HTMLButtonElement} */
    const stop = UI.button(t("app.simpletcpserver.button.stop"), () => this._stop(), {});
    /** @type {HTMLButtonElement} */
    const clear = UI.button(t("app.simpletcpserver.button.clearLog"), () => { this.log = []; this._renderLog(); }, {});

    this.startBtn = start;
    this.stopBtn = stop;

    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const status = UI.el("div", { className: "msg" });

    const serverPane = UI.el("div", { children: [
      UI.row(t("app.simpletcpserver.label.listenPort"), portInput),
      status,
    ]});

    const logPane = UI.el("div", { children: [
      UI.buttonRow([clear]),
      logBox,
    ]});

    const { bar: tabBar, setActive: setTab } = UI.tabGroup([
      { id: "server", label: t("app.simpletcpserver.label.server") },
      { id: "log",    label: t("app.simpletcpserver.label.log") },
    ], (id) => {
      serverPane.style.display = id === "server" ? "" : "none";
      logPane.style.display    = id === "log"    ? "" : "none";
    });
    setTab("server");
    serverPane.style.display = "";
    logPane.style.display    = "none";

    const panel = UI.panel([
      UI.buttonRow([start, stop]),
      tabBar,
      serverPane,
      logPane,
    ]);

    this.root.replaceChildren(panel);

    this._syncButtons();
    this._renderLog();

    this.disposer.interval(() => {
      status.textContent =
        t("app.simpletcpserver.status.running", { running: this.running }) + "\n" +
        t("app.simpletcpserver.status.port", { port: (this.listenPort ?? "-") }) + "\n" +
        t("app.simpletcpserver.status.connections", { n: this.conns.size }) + "\n"
    }, 300);
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

  _renderLog() {
    if (!this.logEl) return;
    const maxLines = 200;
    const lines = this.log.length > maxLines ? this.log.slice(-maxLines) : this.log;
    this.logEl.textContent = lines.join("\n");
    this.logEl.scrollTop = this.logEl.scrollHeight;
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
      this._appendLog(t("app.simpletcpserver.log.invalidPort", { time: nowStamp(), portStr: s }));
      return;
    }
    this.port = p;
    this._start();
  }

  _start() {
    if (this.running) return;

    try {
      const port = this.os.net.openTCPServerSocket(IPAddress.fromString("::"), this.port);
      this.listenPort = port;
      this.running = true;

      this._appendLog(t("app.simpletcpserver.log.listening", { time: nowStamp(), port }));
      this._syncButtons();

      // background accept loop
      this._acceptLoop();
    } catch (e) {
      this.listenPort = null;
      this.running = false;
      this._syncButtons();
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(t("app.simpletcpserver.log.startFailed", { time: nowStamp(), reason }));
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
        this._appendLog(t("app.simpletcpserver.log.stopped", { time: nowStamp(), port }));
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.simpletcpserver.log.stopError", { time: nowStamp(), reason }));
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
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.simpletcpserver.log.acceptError", { time: nowStamp(), reason }));
        continue;
      }

      if (!this.running || this.listenPort == null) break;
      if (key == null) break; // server socket closed

      this.conns.add(key);

      const info = parseTCPKey(key);
      const who = info.ok ? `${info.remoteIP}:${info.remotePort}` : key;

      this._appendLog(t("app.simpletcpserver.log.connect", { time: nowStamp(), who }));

      // handle each connection concurrently
      this._connEchoLoop(key).catch((e) => {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.simpletcpserver.log.connLoopError", { time: nowStamp(), reason }));
      });
    }

    this._syncButtons();
  }

  /**
   * @param {string} key
   */
  async _connEchoLoop(key) {
    const info = parseTCPKey(key);
    const who = info.ok ? `${info.remoteIP}:${info.remotePort}` : key;

    try {
      while (this.running) {
        /** @type {Uint8Array|null} */
        let data = null;
        try {
          data = await this.os.net.recvTCPConn(key);
        } catch (e) {
          const reason = (e instanceof Error ? e.message : String(e));
          this._appendLog(t("app.simpletcpserver.log.recvError", { time: nowStamp(), who, reason }));
          break;
        }

        if (!this.running) break;
        if (data == null) break; // peer closed or connection gone

        this._appendLog(t("app.simpletcpserver.log.rx", {
          time: nowStamp(),
          who,
          len: data.length,
          hex: hexPreview(data),
        }));

        try {
          this.os.net.sendTCPConn(key, data);
          this._appendLog(t("app.simpletcpserver.log.txEcho", { time: nowStamp(), who, len: data.length }));
        } catch (e) {
          const reason = (e instanceof Error ? e.message : String(e));
          this._appendLog(t("app.simpletcpserver.log.sendError", { time: nowStamp(), who, reason }));
          break;
        }
      }
    } finally {
      this.conns.delete(key);

      // make sure we FIN if still around
      try { this.os.net.closeTCPConn(key); } catch { /* ignore */ }

      this._appendLog(t("app.simpletcpserver.log.disconnect", { time: nowStamp(), who }));
      this._syncButtons();
    }
  }
}
