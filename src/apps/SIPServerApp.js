//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";
import { nowStamp } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js";

import { SipRegistrarProxy } from "../net/SipRegistrarProxy.js";

const CONF_PATH = "/etc/sipd.conf";

export class SIPServerApp extends LoggedProcess {
  get title() { return t("app.sipserver.title"); }

  icon = "fa-server";
  badge = "SIP";

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {number} */ port = 5060;
  /** @type {string} */ domain = "";
  /** @type {boolean} */ recordRoute = false;

  /** @type {boolean} */ running = false;
  /** @type {number|null} */ socketPort = null;
  /** @type {SipRegistrarProxy|null} */ _proxy = null;

  // UI refs
  /** @type {HTMLInputElement|null} */ _portEl = null;
  /** @type {HTMLInputElement|null} */ _domainEl = null;
  /** @type {HTMLInputElement|null} */ _rrEl = null;
  /** @type {HTMLButtonElement|null} */ _startBtn = null;
  /** @type {HTMLButtonElement|null} */ _stopBtn = null;
  /** @type {HTMLTableSectionElement|null} */ _regBody = null;

  run() {
    this.root.classList.add("app", "app-sip-server");
    this._loadConfig();
    setTimeout(() => this._tryAutostart(), 0);
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    this._portEl = UI.input({ value: String(this.port), placeholder: "5060" });
    this._domainEl = UI.input({ value: this.domain, placeholder: t("app.sipserver.ph.domain") });
    this._rrEl = UI.input({ type: "checkbox" });
    this._rrEl.checked = this.recordRoute;

    this._startBtn = UI.button(t("app.sipserver.btn.start"), () => this._startFromUI(), { primary: true, icon: "fa-play" });
    this._stopBtn = UI.button(t("app.sipserver.btn.stop"), () => this._stop(), { icon: "fa-stop" });
    const clear = UI.button(t("app.sipserver.btn.clearLog"), () => { this.log = []; this._renderLog(); });

    const serverPane = UI.el("div", { className: "sip-pane", children: [
      UI.row(t("app.sipserver.label.listenPort"), this._portEl),
      UI.row(t("app.sipserver.label.domain"), this._domainEl),
      UI.row(t("app.sipserver.label.recordRoute"), this._rrEl),
    ]});

    const { table: regTable, tbody: regBody } = UI.tableWithBody([
      t("app.sipserver.col.aor"),
      t("app.sipserver.col.contact"),
      t("app.sipserver.col.expires"),
    ], "sip-reg-table");
    this._regBody = regBody;
    const regPane = UI.el("div", { className: "sip-pane", children: [regTable] });

    const logBox = UI.el("div", { className: "msg sip-log" });
    this.logEl = logBox;
    const logPane = UI.el("div", { className: "log-pane sip-pane", children: [UI.buttonRow([clear]), logBox] });

    const { bar } = UI.tabbedPane([
      { id: "server", label: t("app.sipserver.label.server"), pane: serverPane },
      { id: "reg", label: t("app.sipserver.label.registrations"), pane: regPane, onShow: () => this._renderBindings() },
      { id: "log", label: t("app.sipserver.label.log"), pane: logPane },
    ]);

    this.root.replaceChildren(UI.panel([
      UI.el("div", { className: "app-toolbar", children: [UI.buttonRow([this._startBtn, this._stopBtn])] }),
      bar, serverPane, regPane, logPane,
    ]));

    this._syncButtons();
    this._renderLog();
    this._renderBindings();
    // periodic refresh of the "expires in" column while the tab is open
    this.disposer.interval(() => this._renderBindings(), 1000);
  }

  onUnmount() {
    this.disposer.dispose();
    this._portEl = this._domainEl = this._rrEl = null;
    this._startBtn = this._stopBtn = null;
    this._regBody = null;
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
      if (typeof j.domain === "string") this.domain = j.domain;
      if (typeof j.recordRoute === "boolean") this.recordRoute = j.recordRoute;
    } catch { /* defaults */ }
  }

  _saveConfig(extra = {}) {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      let cur = {};
      try { cur = JSON.parse(fs.readFile(CONF_PATH)); } catch { /* new file */ }
      const next = { ...cur, port: this.port, domain: this.domain, recordRoute: this.recordRoute, ...extra };
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
      this._appendLog(`[${nowStamp()}] ${t("app.sipserver.log.invalidPort", { portStr: s })}`);
      return;
    }
    this.port = p;
    this.domain = (this._domainEl?.value ?? "").trim();
    this.recordRoute = !!this._rrEl?.checked;
    this._saveConfig();
    this._start();
  }

  _start() {
    if (this.running) return;
    let sock;
    try {
      sock = this.os.net.openUDPSocket(new IPAddress(4, 0), this.port);
    } catch (e) {
      this._appendLog(`[${nowStamp()}] ${t("app.sipserver.log.startFailed", { reason: e instanceof Error ? e.message : String(e) })}`);
      return;
    }
    this.socketPort = sock;
    this.running = true;
    this._saveConfig({ autostart: true });

    const selfIp = this._selfIp();
    this._proxy = new SipRegistrarProxy({
      transport: {
        send: (bytes, dstIp, dstPort) => {
          if (this.socketPort == null) return;
          try { this.os.net.sendUDPSocket(this.socketPort, IPAddress.fromString(dstIp), dstPort, bytes); }
          catch { /* drop */ }
        },
      },
      selfAddr: { ip: selfIp, port: this.port },
      domain: this.domain || selfIp,
      recordRoute: this.recordRoute,
    });

    this._proxy.on("register", (d) => { this._appendLog(`[${nowStamp()}] ${t("app.sipserver.log.register", { aor: d.aor, contact: `${d.contactIp}:${d.contactPort}`, expires: d.expires })}`); this._renderBindings(); });
    this._proxy.on("unregister", (d) => { this._appendLog(`[${nowStamp()}] ${t("app.sipserver.log.unregister", { aor: d.aor, reason: d.reason })}`); this._renderBindings(); });
    this._proxy.on("forward", (d) => this._appendLog(`[${nowStamp()}] ${t("app.sipserver.log.forward", { method: d.method, aor: d.aor, dst: `${d.dstIp}:${d.dstPort}` })}`));
    this._proxy.on("respond", (d) => this._appendLog(`[${nowStamp()}] ${t("app.sipserver.log.respond", { code: d.code, dst: `${d.dstIp}:${d.dstPort}` })}`));
    this._proxy.on("drop", (d) => this._appendLog(`[${nowStamp()}] ${t("app.sipserver.log.drop", { reason: d.reason })}`));

    this._appendLog(`[${nowStamp()}] ${t("app.sipserver.log.listening", { port: this.port, ip: selfIp })}`);
    this._syncButtons();
    void this._recvLoop();
  }

  _stop() {
    if (!this.running && this.socketPort == null) return;
    this._saveConfig({ autostart: false });
    const sock = this.socketPort;
    this.running = false;
    this.socketPort = null;
    try { this._proxy?.dispose(); } catch { /* ignore */ }
    this._proxy = null;
    if (sock != null) {
      try { this.os.net.closeUDPSocket(sock); this._appendLog(`[${nowStamp()}] ${t("app.sipserver.log.stopped")}`); }
      catch { /* ignore */ }
    }
    this._syncButtons();
    this._renderBindings();
  }

  async _recvLoop() {
    const sock = this.socketPort;
    while (this.running && this.socketPort === sock && sock != null) {
      let m;
      try { m = await this.os.net.recvUDPSocket(sock); }
      catch { break; }
      if (m == null) break;
      try { this._proxy?.receive(m.payload, m.src.toString(), m.srcPort); }
      catch { /* malformed */ }
    }
  }

  // ── helpers ───────────────────────────────────────────────────────

  _selfIp() {
    for (let i = 0; i < 8; i++) {
      const itf = this.os.net.getInterface(i);
      if (itf?.ip?.isV4?.() && itf.ip.toString() !== "0.0.0.0") return itf.ip.toString();
    }
    return "0.0.0.0";
  }

  _syncButtons() {
    if (this._startBtn) this._startBtn.disabled = this.running;
    if (this._stopBtn) this._stopBtn.disabled = !this.running;
    for (const el of [this._portEl, this._domainEl, this._rrEl]) if (el) el.disabled = this.running;
  }

  _renderBindings() {
    const body = this._regBody;
    if (!body) return;
    body.replaceChildren();
    const rows = this._proxy?.bindings ?? [];
    if (rows.length === 0) {
      const tr = UI.el("tr", { children: [
        UI.el("td", { attrs: { colspan: "3" }, className: "sip-empty", text: t("app.sipserver.empty") }),
      ]});
      body.appendChild(tr);
      return;
    }
    for (const b of rows) {
      const secs = Math.max(0, Math.round((b.expiresAt - this._proxyNow()) / 1000));
      body.appendChild(UI.el("tr", { children: [
        UI.el("td", { text: b.aor }),
        UI.el("td", { text: `${b.contactIp}:${b.contactPort}` }),
        UI.el("td", { text: `${secs}s` }),
      ]}));
    }
  }

  /** proxy's notion of "now" in ms (shared sim tick clock). */
  _proxyNow() {
    // SipRegistrarProxy uses simTimer.currentTick * SIM_MS_PER_TICK by default
    return /** @type {any} */ (this._proxy)?._now?.() ?? 0;
  }
}
