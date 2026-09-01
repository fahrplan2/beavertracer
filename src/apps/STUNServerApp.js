//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";
import { nowStamp } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js";

import { StunMessage } from "../net/pdu/StunMessage.js";

const CONF_PATH = "/etc/stund.conf";
const DEFAULT_PORT = 3478;

/**
 * Minimal STUN server (RFC 5389 "Binding" usage subset — see StunMessage).
 *
 * Stateless by design: every Binding Request is answered on the spot with
 * the request's own (post-NAT) source IP:port as XOR-MAPPED-ADDRESS. There
 * is nothing to register or expire, unlike SIPServerApp — this is the
 * server half of the NAT-discovery step a client (e.g. SoftphoneApp) runs
 * before it puts an address into a SIP Contact header or SDP.
 */
export class STUNServerApp extends LoggedProcess {
  get title() { return t("app.stunserver.title"); }

  icon = "fa-server";
  badge = "STUN";

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {number} */ port = DEFAULT_PORT;
  /** @type {boolean} */ running = false;
  /** @type {number|null} */ socketPort = null;

  /** @type {number} */ _requestCount = 0;

  // UI refs
  /** @type {HTMLInputElement|null} */ _portEl = null;
  /** @type {HTMLButtonElement|null} */ _startBtn = null;
  /** @type {HTMLButtonElement|null} */ _stopBtn = null;
  /** @type {HTMLElement|null} */ _statusEl = null;

  run() {
    this.root.classList.add("app", "app-stun-server");
    this._loadConfig();
    setTimeout(() => this._tryAutostart(), 0);
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    this._portEl = UI.input({ value: String(this.port), placeholder: String(DEFAULT_PORT) });
    this._startBtn = UI.button(t("app.stunserver.btn.start"), () => this._startFromUI(), { primary: true, icon: "fa-play" });
    this._stopBtn = UI.button(t("app.stunserver.btn.stop"), () => this._stop(), { icon: "fa-stop" });
    const clear = UI.button(t("app.stunserver.btn.clearLog"), () => { this.log = []; this._renderLog(); });

    this._statusEl = UI.el("div", { className: "stun-status" });

    const serverPane = UI.el("div", { className: "stun-pane", children: [
      UI.row(t("app.stunserver.label.listenPort"), this._portEl),
      this._statusEl,
    ]});

    const logBox = UI.el("div", { className: "msg stun-log" });
    this.logEl = logBox;
    const logPane = UI.el("div", { className: "log-pane stun-pane", children: [UI.buttonRow([clear]), logBox] });

    const { bar } = UI.tabbedPane([
      { id: "server", label: t("app.stunserver.label.server"), pane: serverPane },
      { id: "log", label: t("app.stunserver.label.log"), pane: logPane },
    ]);

    this.root.replaceChildren(UI.panel([
      UI.el("div", { className: "app-toolbar", children: [UI.buttonRow([this._startBtn, this._stopBtn])] }),
      bar, serverPane, logPane,
    ]));

    this._syncButtons();
    this._renderStatus();
    this._renderLog();
    this.disposer.interval(() => this._renderStatus(), 1000);
  }

  onUnmount() {
    this.disposer.dispose();
    this._portEl = null;
    this._startBtn = this._stopBtn = null;
    this._statusEl = null;
    this.logEl = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    super.destroy();
  }

  // ── config ────────────────────────────────────────────────────────

  _loadConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      const j = JSON.parse(fs.readFile(CONF_PATH));
      if (Number.isInteger(j.port) && j.port >= 1 && j.port <= 65535) this.port = j.port;
    } catch { /* defaults */ }
  }

  _saveConfig(extra = {}) {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      let cur = {};
      try { cur = JSON.parse(fs.readFile(CONF_PATH)); } catch { /* new file */ }
      const next = { ...cur, port: this.port, ...extra };
      fs.writeFile(CONF_PATH, JSON.stringify(next, null, 2) + "\n");
    } catch { /* ignore */ }
  }

  _tryAutostart() {
    try {
      const j = JSON.parse(this.os.fs.readFile(CONF_PATH));
      if (j.autostart === true) this._start();
    } catch { /* no autostart */ }
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  _startFromUI() {
    const s = (this._portEl?.value ?? "").trim();
    const p = Number(s);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      this._appendLog(`[${nowStamp()}] ${t("app.stunserver.log.invalidPort", { portStr: s })}`);
      return;
    }
    this.port = p;
    this._saveConfig();
    this._start();
  }

  _start() {
    if (this.running) return;
    let sock;
    try {
      sock = this.os.net.openUDPSocket(new IPAddress(4, 0), this.port);
    } catch (e) {
      this._appendLog(`[${nowStamp()}] ${t("app.stunserver.log.startFailed", { reason: e instanceof Error ? e.message : String(e) })}`);
      return;
    }
    this.socketPort = sock;
    this.running = true;
    this._requestCount = 0;
    this._saveConfig({ autostart: true });

    this._appendLog(`[${nowStamp()}] ${t("app.stunserver.log.listening", { port: this.port })}`);
    this._syncButtons();
    this._renderStatus();
    void this._recvLoop();
  }

  _stop() {
    if (!this.running && this.socketPort == null) return;
    this._saveConfig({ autostart: false });
    const sock = this.socketPort;
    this.running = false;
    this.socketPort = null;
    if (sock != null) {
      try { this.os.net.closeUDPSocket(sock); this._appendLog(`[${nowStamp()}] ${t("app.stunserver.log.stopped")}`); }
      catch { /* ignore */ }
    }
    this._syncButtons();
    this._renderStatus();
  }

  async _recvLoop() {
    const sock = this.socketPort;
    while (this.running && this.socketPort === sock && sock != null) {
      let m;
      try { m = await this.os.net.recvUDPSocket(sock); }
      catch { break; }
      if (m == null) break;
      this._handleDatagram(m.payload, m.src.toString(), m.srcPort);
    }
  }

  /**
   * @param {Uint8Array} bytes
   * @param {string} srcIp
   * @param {number} srcPort
   */
  _handleDatagram(bytes, srcIp, srcPort) {
    /** @type {StunMessage} */
    let req;
    try { req = StunMessage.fromBytes(bytes); }
    catch { return; } // not STUN — ignore silently, like a real server would drop it

    if (req.type !== StunMessage.TYPE_BINDING_REQUEST) {
      this._appendLog(`[${nowStamp()}] ${t("app.stunserver.log.ignored", { from: `${srcIp}:${srcPort}`, type: `0x${req.type.toString(16)}` })}`);
      return;
    }

    const resp = StunMessage.bindingSuccess(req.transactionId, srcIp, srcPort);
    this._requestCount++;
    this._renderStatus();
    try {
      this.os.net.sendUDPSocket(/** @type {number} */ (this.socketPort), IPAddress.fromString(srcIp), srcPort, resp.pack());
      this._appendLog(`[${nowStamp()}] ${t("app.stunserver.log.binding", { from: `${srcIp}:${srcPort}` })}`);
    } catch (e) {
      this._appendLog(`[${nowStamp()}] ${t("app.stunserver.log.sendFailed", { reason: e instanceof Error ? e.message : String(e) })}`);
    }
  }

  // ── UI helpers ────────────────────────────────────────────────────

  _syncButtons() {
    if (this._startBtn) this._startBtn.disabled = this.running;
    if (this._stopBtn) this._stopBtn.disabled = !this.running;
    if (this._portEl) this._portEl.disabled = this.running;
  }

  _renderStatus() {
    if (!this._statusEl) return;
    this._statusEl.textContent = this.running
      ? t("app.stunserver.status.running", { count: this._requestCount })
      : t("app.stunserver.status.stopped");
  }
}
