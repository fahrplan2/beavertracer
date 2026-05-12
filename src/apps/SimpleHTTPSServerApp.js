//@ts-check

import { SimpleHTTPServerApp } from "./SimpleHTTPServerApp.js";
import { TlsSession } from "../net/TlsSession.js";
import { TlsCertificate } from "../net/models/TlsCertificate.js";
import { UILib as UI } from "./lib/UILib.js";
import { OsFilePicker } from "./lib/OsFilePicker.js";
import { t } from "../i18n/index.js";
import { nowStamp } from "../lib/helpers.js";
import { simTimer } from "../lib/SimTimer.js";

export class SimpleHTTPSServerApp extends SimpleHTTPServerApp {

  get title() {
    return t("app.simplehttpsserver.title");
  }

  port  = 443;
  badge = "HTTPS";
  icon  = "fa-lock";

  /** @type {TlsCertificate|null} */
  _cert = null;

  /** @type {HTMLInputElement|null} */
  _cnEl = null;

  /** @type {HTMLElement|null} */
  _certInfoEl = null;

  // ── I/O hook ───────────────────────────────────────────────────────────────

  /**
   * @override
   * @param {string} connKey
   */
  async _ioForConn(connKey) {
    if (!this._cert) {
      this._appendLog(t("app.simplehttpsserver.log.noCert", { time: nowStamp() }));
      try { this.os.net.closeTCPConn(connKey); } catch { /* ignore */ }
      return null;
    }

    const net = this.os.net;
    const tls = new TlsSession({
      send: (d) => net.sendTCPConn(connKey, d),
      recv: ()  => net.recvTCPConn(connKey),
      isServer:   true,
      cert:       this._cert,
      trustStore: this.os.tls?.certStore ?? null,
      timeoutMs:  this._timeoutMs(),
      sleepFn:    (ms) => simTimer.sleep(ms),
    });

    try {
      await tls.handshake();
      const info = net.getTCPConnInfo(connKey);
      const peer = info ? `${info.peerIP}:${info.peerPort}` : "?";
      this._appendLog(t("app.simplehttpsserver.log.tlsOk", { time: nowStamp(), peer }));
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(t("app.simplehttpsserver.log.tlsFailed", { time: nowStamp(), reason }));
      try { tls.close(); } catch { /* ignore */ }
      try { net.closeTCPConn(connKey); } catch { /* ignore */ }
      return null;
    }

    return {
      send:  /** @type {(d:Uint8Array<ArrayBuffer>)=>Promise<void>} */ ((d) => tls.send(d)),
      recv:  ()  => tls.recv(),
      close: ()  => { tls.close(); try { net.closeTCPConn(connKey); } catch { /* ignore */ } },
    };
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);

    // The parent built the panel with 2 tabs (config + log).
    // We add a third tab by rebuilding the tabbed section.
    // Find existing panes — they are already in root as children of the panel.
    const panel = this.root.querySelector(".panel");
    if (!panel) return;

    // Certificate pane
    const cnInput = UI.input({
      placeholder: t("app.simplehttpsserver.label.cn"),
      value: `${this.os?.name ?? "server"}.local`,
    });
    this._cnEl = cnInput;

    const certInfo = UI.el("div", { className: "msg" });
    this._certInfoEl = certInfo;

    const certPane = UI.el("div", { children: [
      UI.row(t("app.simplehttpsserver.label.cn"), cnInput),
      UI.buttonRow([
        UI.button(t("app.simplehttpsserver.button.generateCert"), () => this._generateCert(), { primary: true, icon: "fa-certificate" }),
        UI.button(t("app.simplehttpsserver.button.exportCert"), () => this._exportCert(), { icon: "fa-file-export" }),
        UI.button(t("app.simplehttpsserver.button.importCert"), () => this._importCert(), { icon: "fa-file-import" }),
      ]),
      certInfo,
    ]});

    // Locate the existing tab bar and panes
    const existingTabBar = panel.querySelector(".tab-bar");
    const configPane = panel.querySelector(".panel > div:nth-child(3)");
    const logPane    = panel.querySelector(".panel > div:nth-child(4)");

    if (!existingTabBar || !configPane || !logPane) {
      // Fallback: just append certPane to panel
      panel.appendChild(certPane);
      this._renderCertInfo();
      return;
    }

    // Rebuild tabbedPane with three tabs
    const { bar: newTabBar } = UI.tabbedPane([
      { id: "config", label: t("app.simplehttpserver.label.server"), pane: /** @type {HTMLElement} */ (configPane) },
      { id: "log",    label: t("app.simplehttpserver.label.log"),    pane: /** @type {HTMLElement} */ (logPane) },
      { id: "cert",   label: t("app.simplehttpsserver.label.cert"),  pane: certPane },
    ]);

    existingTabBar.replaceWith(newTabBar);
    panel.appendChild(certPane);
    this._renderCertInfo();
  }

  onUnmount() {
    this._cnEl = null;
    this._certInfoEl = null;
    super.onUnmount();
  }

  // ── cert helpers ───────────────────────────────────────────────────────────

  _generateCert() {
    const cn = this._cnEl?.value.trim() || this.os?.name || "server";
    this._cert = TlsCertificate.generate(cn);
    this._appendLog(t("app.simplehttpsserver.log.certGenerated",
      { time: nowStamp(), subject: this._cert.subject }));
    this._renderCertInfo();
  }

  async _exportCert() {
    if (!this._cert) return;
    const fs = this.os.fs;
    if (!fs) return;
    const cn = this._cert.subject.replace(/^CN=/, "");
    const abs = await OsFilePicker.open({
      fs,
      container: this.root,
      mode: "save",
      cwd: "/home",
      filename: `${cn}.cert.json`,
      title: t("app.simplehttpsserver.picker.exportTitle"),
    });
    if (!abs) return;
    try {
      fs.writeFile(abs, JSON.stringify(this._cert.toJSON(), null, 2));
      this._appendLog(t("app.simplehttpsserver.log.certExported", { time: nowStamp(), path: abs }));
    } catch (e) {
      this._appendLog(t("app.simplehttpsserver.log.certExportFailed", { time: nowStamp() }));
    }
  }

  async _importCert() {
    const fs = this.os.fs;
    if (!fs) return;
    const abs = await OsFilePicker.open({
      fs,
      container: this.root,
      mode: "open",
      cwd: "/home",
      title: t("app.simplehttpsserver.picker.importTitle"),
    });
    if (!abs) return;
    try {
      const raw = fs.readFile(abs);
      this._cert = TlsCertificate.fromJSON(JSON.parse(raw));
      this._appendLog(t("app.simplehttpsserver.log.certImported",
        { time: nowStamp(), subject: this._cert.subject }));
      this._renderCertInfo();
    } catch {
      this._appendLog(t("app.simplehttpsserver.log.certImportFailed", { time: nowStamp() }));
    }
  }

  _renderCertInfo() {
    if (!this._certInfoEl) return;
    if (!this._cert) {
      this._certInfoEl.textContent = t("app.simplehttpsserver.cert.none");
      return;
    }
    const expiry = new Date(this._cert.notAfter).toLocaleDateString();
    this._certInfoEl.textContent = [
      t("app.simplehttpsserver.cert.subject",     { subject: this._cert.subject }),
      t("app.simplehttpsserver.cert.fingerprint", { fp: this._cert.fingerprint() }),
      t("app.simplehttpsserver.cert.expiry",      { date: expiry }),
    ].join("\n");
  }
}
