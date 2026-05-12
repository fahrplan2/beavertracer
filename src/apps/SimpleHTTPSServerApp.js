//@ts-check

import { SimpleHTTPServerApp } from "./SimpleHTTPServerApp.js";
import { TlsSession } from "../net/TlsSession.js";
import { TlsCertificate } from "../net/models/TlsCertificate.js";
import { UILib as UI } from "./lib/UILib.js";
import { t } from "../i18n/index.js";
import { nowStamp } from "../lib/helpers.js";
import { simTimer } from "../lib/SimTimer.js";

const CERT_DIR = "/etc/certs";

export class SimpleHTTPSServerApp extends SimpleHTTPServerApp {

  get title() {
    return t("app.simplehttpsserver.title");
  }

  port  = 443;
  badge = "HTTPS";
  icon  = "fa-lock";

  /** @type {TlsCertificate|null} */
  _cert = null;

  /** @type {HTMLSelectElement|null} */
  _certSelectEl = null;

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

    const panel = this.root.querySelector(".panel");
    if (!panel) return;

    const select = UI.select([], {});
    this._certSelectEl = select;

    const certInfo = UI.el("div", { className: "msg" });
    this._certInfoEl = certInfo;

    const certPane = UI.el("div", { children: [
      UI.row(t("app.simplehttpsserver.label.cert"), select),
      UI.buttonRow([
        UI.button(t("app.simplehttpsserver.button.use"), () => this._applyCert(),
          { primary: true, icon: "fa-check" }),
      ]),
      certInfo,
    ]});

    const existingTabBar = panel.querySelector(".tab-bar");
    const configPane = panel.querySelector(".panel > div:nth-child(3)");
    const logPane    = panel.querySelector(".panel > div:nth-child(4)");

    if (!existingTabBar || !configPane || !logPane) {
      panel.appendChild(certPane);
      this._refreshCertList();
      this._renderCertInfo();
      return;
    }

    const { bar: newTabBar } = UI.tabbedPane([
      { id: "config", label: t("app.simplehttpserver.label.server"), pane: /** @type {HTMLElement} */ (configPane) },
      { id: "log",    label: t("app.simplehttpserver.label.log"),    pane: /** @type {HTMLElement} */ (logPane) },
      { id: "cert",   label: t("app.simplehttpsserver.label.cert"),  pane: certPane,
        onShow: () => this._refreshCertList() },
    ]);

    existingTabBar.replaceWith(newTabBar);
    panel.appendChild(certPane);
    this._refreshCertList();
    this._renderCertInfo();
  }

  onUnmount() {
    this._certSelectEl = null;
    this._certInfoEl = null;
    super.onUnmount();
  }

  // ── start guard ────────────────────────────────────────────────────────────

  /** @override */
  _startFromUI() {
    if (!this._cert) {
      this._appendLog(t("app.simplehttpsserver.log.noCert", { time: nowStamp() }));
      return;
    }
    super._startFromUI();
  }

  // ── cert helpers ───────────────────────────────────────────────────────────

  _refreshCertList() {
    const sel = this._certSelectEl;
    if (!sel) return;
    const fs = this.os.fs;
    if (!fs) return;

    /** @type {Array<{cert: TlsCertificate, path: string, name: string}>} */
    const entries = [];
    try {
      const names = fs.readdir(CERT_DIR);
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const cert = TlsCertificate.fromJSON(JSON.parse(fs.readFile(`${CERT_DIR}/${name}`)));
          entries.push({ cert, path: `${CERT_DIR}/${name}`, name });
        } catch { /* skip invalid */ }
      }
    } catch { /* dir missing */ }

    if (entries.length === 0) {
      sel.replaceChildren(
        UI.el("option", { attrs: { value: "" }, text: t("app.simplehttpsserver.cert.noEntries") }),
      );
    } else {
      const cn = (/** @type {string} */ s) => s.replace(/^CN=/, "");
      sel.replaceChildren(
        ...entries.map(e => UI.el("option", {
          attrs: { value: e.path },
          text: cn(e.cert.subject),
        })),
      );
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

  _applyCert() {
    const path = this._certSelectEl?.value;
    const fs = this.os.fs;
    if (!path || !fs) return;
    try {
      this._cert = TlsCertificate.fromJSON(JSON.parse(fs.readFile(path)));
      this._appendLog(t("app.simplehttpsserver.log.certApplied",
        { time: nowStamp(), subject: this._cert.subject }));
      this._renderCertInfo();
    } catch {
      this._appendLog(t("app.simplehttpsserver.log.noCert", { time: nowStamp() }));
    }
  }
}
