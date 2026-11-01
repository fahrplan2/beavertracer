//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { Disposer } from "../lib/Disposer.js";
import { UILib as UI } from "./lib/UILib.js";
import { SimTimer, simTimer } from "../lib/SimTimer.js";
import { t } from "../i18n/index.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { nowStamp, encodeUTF8, decodeUTF8 } from "../lib/helpers.js";
import { TlsSession } from "../net/TlsSession.js";
import { TlsCertificate } from "../net/models/TlsCertificate.js";
import { Http2Connection, Http2Error, h2ErrorName } from "../net/Http2.js";

const CERT_DIR = "/etc/certs";

/** Requests per persistent connection — Apache's MaxKeepAliveRequests default. */
const MAX_KEEPALIVE_REQUESTS = 100;

/**
 * @param {Uint8Array[]} chunks
 */
function concatChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * @param {Uint8Array} hay
 * @param {Uint8Array} needle
 */
function indexOfBytes(hay, needle) {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * @param {string} path
 */
function contentTypeOf(path) {
  const p = path.toLowerCase();
  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
  if (p.endsWith(".css"))  return "text/css; charset=utf-8";
  if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".xml"))  return "application/xml; charset=utf-8";
  if (p.endsWith(".svg"))  return "image/svg+xml";
  if (p.endsWith(".png"))  return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".gif"))  return "image/gif";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".ico"))  return "image/x-icon";
  if (p.endsWith(".pdf"))  return "application/pdf";
  if (p.endsWith(".txt") || p.endsWith(".log")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

/**
 * @param {string} urlPath
 */
function normalizeUrlPath(urlPath) {
  const q = urlPath.indexOf("?");
  const raw = q >= 0 ? urlPath.slice(0, q) : urlPath;
  let p = raw || "/";
  try { p = decodeURIComponent(p); } catch { /* keep raw */ }

  p = p.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;

  const parts = p.split("/").filter((x) => x.length > 0);
  /** @type {string[]} */
  const out = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") { if (out.length) out.pop(); continue; }
    out.push(part);
  }
  return "/" + out.join("/");
}

/**
 * @param {string} docRoot
 * @param {string} normPath
 */
function joinDocroot(docRoot, normPath) {
  let root = docRoot.trim() || "/var/www/";
  if (!root.endsWith("/")) root += "/";
  return root + normPath.slice(1);
}

// ── virtual hosts ────────────────────────────────────────────────────────────

/**
 * @typedef {{ host: string, docRoot: string, certPath: string }} VirtualHost
 */

/**
 * Canonical form for comparing host names: lower case, no trailing dot,
 * no IPv6 brackets.
 * @param {string} name
 */
export function normalizeHostName(name) {
  return String(name ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/**
 * Host name from a Host header value (RFC 9110 §7.2: uri-host [":" port]).
 * "[2001:db8::1]:8080" -> "2001:db8::1", "a.lan:80" -> "a.lan".
 * @param {string} value
 */
export function hostFromHeader(value) {
  const v = String(value ?? "").trim();
  if (v.startsWith("[")) {
    const close = v.indexOf("]");
    return normalizeHostName(close > 0 ? v.slice(1, close) : v);
  }
  const colon = v.indexOf(":");
  // a second colon means an unbracketed IPv6 literal: no port to strip
  if (colon >= 0 && v.indexOf(":", colon + 1) < 0) return normalizeHostName(v.slice(0, colon));
  return normalizeHostName(v);
}

/** DNS name (labels of letters, digits, hyphens) or an IPv4/IPv6 literal. */
const VHOST_NAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$|^[0-9a-f:.]*:[0-9a-f:.]*$/;

/**
 * Validate and normalise a list of virtual hosts. Rows with an empty host
 * are skipped silently (blank table rows); an invalid or duplicate name is
 * reported so the caller can refuse to start.
 * @param {any} list
 * @returns {{ vhosts: VirtualHost[], invalid: string|null, duplicate: string|null }}
 */
export function sanitizeVhosts(list) {
  /** @type {VirtualHost[]} */
  const vhosts = [];
  /** @type {string|null} */ let invalid = null;
  /** @type {string|null} */ let duplicate = null;
  for (const raw of Array.isArray(list) ? list : []) {
    const host = normalizeHostName(raw?.host ?? "");
    if (!host) continue;
    if (!VHOST_NAME_RE.test(host)) { invalid ??= String(raw.host); continue; }
    if (vhosts.some(v => v.host === host)) { duplicate ??= host; continue; }
    const docRoot = typeof raw?.docRoot === "string" && raw.docRoot.trim()
      ? raw.docRoot.trim()
      : `/var/www/${host}/`;
    const certPath = typeof raw?.certPath === "string" ? raw.certPath : "";
    vhosts.push({ host, docRoot, certPath });
  }
  return { vhosts, invalid, duplicate };
}

/**
 * @param {number} status
 * @param {string} reason
 * @param {Record<string,string>} headers
 * @param {Uint8Array} body
 */
function buildResponse(status, reason, headers, body) {
  const lines = [];
  lines.push(`HTTP/1.1 ${status} ${reason}`);
  for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
  lines.push("", "");
  const head = encodeUTF8(lines.join("\r\n"));
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

/**
 * @param {string} title
 * @param {string} details
 */
function internalHtml(title, details) {
  const esc = (/** @type {*} */ s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="font-family: system-ui, sans-serif; padding: 16px;">
  <h1>${esc(title)}</h1>
  <pre style="white-space: pre-wrap; background:#111; color:#eee; padding:12px; border-radius:8px;">${esc(details)}</pre>
</body></html>`;
  return encodeUTF8(html);
}

/**
 * @template T
 * @param {Promise<T>} p
 * @param {number} ms
 * @param {string} label
 */
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    let done = false;
    const id = simTimer.schedule(() => {
      if (!done) { done = true; reject(new Error(t("app.simplehttpserver.err.timeout", { label, ms }))); }
    }, ms);
    p.then(
      (v) => { if (!done) { done = true; simTimer.cancel(id); resolve(v); } },
      (e) => { if (!done) { done = true; simTimer.cancel(id); reject(e); } },
    );
  });
}

export class SimpleHTTPServerApp extends LoggedProcess {

  get title() {
    return t("app.simplehttpserver.title");
  }

  /** @type {Disposer} */
  disposer = new Disposer();

  // ── HTTP state ──────────────────────────────────────────────────────────────

  /** @type {number} */
  port = 80;

  /** @type {string} */
  docRoot = "/var/www/";

  /** Persistent connections: several requests per TCP connection (RFC 9112 §9.3). @type {boolean} */
  keepAlive = true;

  /** @type {boolean} */
  running = false;

  /** @type {number|null} */
  serverRef = null;

  /** @type {number} */
  runSeq = 0;

  // ── HTTPS state ─────────────────────────────────────────────────────────────

  /** @type {boolean} */
  httpsEnabled = false;

  /** @type {number} */
  httpsPort = 443;

  /** @type {boolean} */
  httpsRunning = false;

  /** @type {number|null} */
  httpsServerRef = null;

  /** @type {number} */
  httpsRunSeq = 0;

  /** @type {TlsCertificate|null} */
  _cert = null;

  /** Offer TLS 1.3 next to 1.2 (off: TLS 1.2 only, as described in lesson 8.3.2). @type {boolean} */
  tls13Enabled = false;

  /** @type {string} */
  certPath = "";

  // ── HTTP/2 ──────────────────────────────────────────────────────────────────

  /** HTTP/2 over TLS, negotiated by ALPN "h2" (RFC 9113 §3.2). @type {boolean} */
  http2Enabled = false;

  /** HTTP/2 over plain TCP with prior knowledge ("h2c", RFC 9113 §3.3). @type {boolean} */
  h2cEnabled = false;

  // ── virtual hosts ───────────────────────────────────────────────────────────

  /** Name-based virtual hosting on (Host header / SNI pick the site). @type {boolean} */
  vhostsEnabled = false;

  /** @type {VirtualHost[]} */
  vhosts = [];

  /** Loaded per-vhost certificates, keyed by host. @type {Map<string, TlsCertificate>} */
  _vhostCerts = new Map();

  /** Settles once _vhostCerts reflects the current vhost list. @type {Promise<void>} */
  _vhostCertsReady = Promise.resolve();

  // ── UI refs ─────────────────────────────────────────────────────────────────

  /** @type {HTMLInputElement|null} */
  portEl = null;

  /** @type {HTMLInputElement|null} */
  rootEl = null;

  /** @type {HTMLInputElement|null} */
  keepAliveEl = null;

  /** @type {HTMLInputElement|null} */
  httpsEnabledEl = null;

  /** @type {HTMLInputElement|null} */
  httpsPortEl = null;

  /** @type {HTMLInputElement|null} */
  tls13El = null;

  /** @type {HTMLSelectElement|null} */
  _certSelectEl = null;

  /** @type {HTMLElement|null} */
  _certInfoEl = null;

  /** @type {HTMLInputElement|null} */
  vhostsEnabledEl = null;

  /** @type {HTMLInputElement|null} */
  http2EnabledEl = null;

  /** @type {HTMLInputElement|null} */
  h2cEnabledEl = null;

  /** @type {HTMLTableSectionElement|null} */
  _vhostTbody = null;

  /** @type {HTMLButtonElement|null} */
  _vhostAddBtn = null;

  /** @type {Array<{ tr: HTMLElement, hostEl: HTMLInputElement, rootEl: HTMLInputElement, certEl: HTMLSelectElement, delBtn: HTMLButtonElement }>} */
  _vhostRows = [];

  /** @type {HTMLButtonElement|null} */
  startBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;

  icon = "fa-server";
  badge = "HTTP";

  /** Resolves once the certPath restored from /etc/httpd.conf is loaded. @type {Promise<void>|null} */
  _certLoadPromise = null;

  run() {
    this.root.classList.add("app", "app-simple-http-server");
    this._loadConfig();
    if (this.certPath) this._certLoadPromise = this._loadCertFromPath(this.certPath);
    setTimeout(() => this._tryAutostart(), 0);
  }

  async _tryAutostart() {
    try {
      const fs = this.os.fs;
      if (!fs) return;
      const json = JSON.parse(fs.readFile("/etc/httpd.conf"));
      if (json.autostart !== true) return;
      // Without the certificate, _start() would silently skip the HTTPS
      // listener of a saved HTTPS server (httpsEnabled && !this._cert).
      if (this._certLoadPromise) await this._certLoadPromise;
      this._start();
    } catch { }
  }

  /** @param {*} val */
  _writeAutostart(val) {
    try {
      const fs = this.os.fs;
      if (!fs) return;
      const txt = fs.readFile("/etc/httpd.conf");
      if (!txt?.trim()) return;
      const o = JSON.parse(txt);
      o.autostart = val;
      fs.writeFile("/etc/httpd.conf", JSON.stringify(o, null, 2) + "\n");
    } catch { }
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    // HTTP tab
    const portInput = UI.input({ placeholder: t("app.simplehttpserver.placeholder.port"), value: String(this.port) });
    const rootInput = UI.input({ placeholder: t("app.simplehttpserver.placeholder.docRoot"), value: String(this.docRoot) });
    this.portEl = portInput;
    this.rootEl = rootInput;
    const keepAliveInput = /** @type {HTMLInputElement} */ (UI.el("input", {
      attrs: { type: "checkbox" },
      init: (el) => { el.checked = this.keepAlive; },
    }));
    this.keepAliveEl = keepAliveInput;

    const httpPane = UI.el("div", { children: [
      UI.row(t("app.simplehttpserver.label.port"), portInput),
      UI.row(t("app.simplehttpserver.label.docRoot"), rootInput),
      UI.row(t("app.simplehttpserver.label.keepAlive"), keepAliveInput),
    ]});

    // HTTPS tab
    const httpsEnabledInput = /** @type {HTMLInputElement} */ (UI.el("input", {
      attrs: { type: "checkbox" },
      init: (el) => { el.checked = this.httpsEnabled; },
    }));
    this.httpsEnabledEl = httpsEnabledInput;

    const httpsPortInput = UI.input({ placeholder: "443", value: String(this.httpsPort) });
    this.httpsPortEl = httpsPortInput;

    const tls13Input = /** @type {HTMLInputElement} */ (UI.el("input", {
      attrs: { type: "checkbox" },
      init: (el) => { el.checked = this.tls13Enabled; },
    }));
    this.tls13El = tls13Input;

    const certSelect = UI.select([], {});
    this._certSelectEl = certSelect;

    const certInfo = UI.el("div", { className: "msg" });
    this._certInfoEl = certInfo;

    const httpsPane = UI.el("div", { children: [
      UI.row(t("app.simplehttpserver.label.httpsEnabled"), httpsEnabledInput),
      UI.row(t("app.simplehttpserver.label.httpsPort"), httpsPortInput),
      UI.row(t("app.simplehttpserver.label.tls13"), tls13Input),
      UI.row(t("app.simplehttpsserver.label.cert"), certSelect),
      UI.buttonRow([
        UI.button(t("app.simplehttpsserver.button.use"), () => this._applyCert(), { primary: true, icon: "fa-check" }),
      ]),
      certInfo,
    ]});

    // Virtual hosts tab
    const vhostsEnabledInput = /** @type {HTMLInputElement} */ (UI.el("input", {
      attrs: { type: "checkbox" },
      init: (el) => { el.checked = this.vhostsEnabled; },
    }));
    this.vhostsEnabledEl = vhostsEnabledInput;

    const { table: vhostTable, tbody: vhostTbody } = UI.tableWithBody([
      t("app.simplehttpserver.vhost.col.host"),
      t("app.simplehttpserver.vhost.col.docRoot"),
      t("app.simplehttpserver.vhost.col.cert"),
      "",
    ], "tbl");
    this._vhostTbody = vhostTbody;
    this._vhostRows = [];
    for (const v of this.vhosts) this._addVhostRow(v);

    const addVhost = UI.button(t("app.simplehttpserver.vhost.button.add"),
      () => this._addVhostRow({ host: "", docRoot: "", certPath: "" }), { icon: "fa-plus" });
    this._vhostAddBtn = addVhost;

    const vhostPane = UI.el("div", { className: "vhost-pane", children: [
      UI.row(t("app.simplehttpserver.vhost.label.enabled"), vhostsEnabledInput),
      UI.el("div", { className: "sim-table-scroll", children: [vhostTable] }),
      UI.buttonRow([addVhost]),
      UI.el("div", { className: "hint", text: t("app.simplehttpserver.vhost.hint") }),
    ]});

    // Protocols tab
    const checkbox = (/** @type {boolean} */ checked) => /** @type {HTMLInputElement} */ (UI.el("input", {
      attrs: { type: "checkbox" },
      init: (el) => { el.checked = checked; },
    }));
    this.http2EnabledEl = checkbox(this.http2Enabled);
    this.h2cEnabledEl = checkbox(this.h2cEnabled);
    const protoPane = UI.el("div", { className: "proto-pane", children: [
      UI.row(t("app.simplehttpserver.proto.label.h2"), this.http2EnabledEl),
      UI.row(t("app.simplehttpserver.proto.label.h2c"), this.h2cEnabledEl),
      UI.el("div", { className: "hint", text: t("app.simplehttpserver.proto.hint") }),
    ]});

    // Log tab
    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const logPane = UI.el("div", { className: "log-pane", children: [
      UI.buttonRow([UI.button(t("app.simplehttpserver.button.clearLog"), () => { this.log = []; this._renderLog(); }, {})]),
      logBox,
    ]});

    const start = UI.button(t("app.simplehttpserver.button.start"), () => this._startFromUI(), { primary: true, icon: "fa-play" });
    const stop  = UI.button(t("app.simplehttpserver.button.stop"),  () => this._stop(),        { icon: "fa-stop" });
    this.startBtn = start;
    this.stopBtn  = stop;

    const { bar: tabBar } = UI.tabbedPane([
      { id: "http",  label: "HTTP",  pane: httpPane },
      { id: "https", label: "HTTPS", pane: httpsPane, onShow: () => this._refreshCertList() },
      { id: "vhosts", label: t("app.simplehttpserver.vhost.tab"), pane: vhostPane, onShow: () => this._refreshCertList() },
      { id: "proto", label: t("app.simplehttpserver.proto.tab"), pane: protoPane },
      { id: "log",   label: t("app.simplehttpserver.label.log"), pane: logPane },
    ]);

    const panel = UI.panel([
      UI.el("div", { className: "app-toolbar", children: [UI.buttonRow([start, stop])] }),
      tabBar,
      httpPane,
      httpsPane,
      vhostPane,
      protoPane,
      logPane,
    ]);

    this.root.replaceChildren(panel);
    this._syncUI();
    this._renderLog();
    this._renderCertInfo();
    if (this.certPath) this._loadCertFromPath(this.certPath);
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl         = null;
    this.portEl        = null;
    this.rootEl        = null;
    this.keepAliveEl   = null;
    this.httpsEnabledEl = null;
    this.httpsPortEl   = null;
    this.tls13El       = null;
    this._certSelectEl = null;
    this._certInfoEl   = null;
    this.vhostsEnabledEl = null;
    this.http2EnabledEl = null;
    this.h2cEnabledEl  = null;
    this._vhostTbody   = null;
    this._vhostAddBtn  = null;
    this._vhostRows    = [];
    this.startBtn      = null;
    this.stopBtn       = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    super.destroy();
  }

  _syncUI() {
    const r = this.running || this.httpsRunning;
    if (this.startBtn)      this.startBtn.disabled      = r;
    if (this.stopBtn)       this.stopBtn.disabled        = !r;
    if (this.portEl)        this.portEl.disabled         = r;
    if (this.rootEl)        this.rootEl.disabled         = r;
    if (this.keepAliveEl)   this.keepAliveEl.disabled    = r;
    if (this.httpsEnabledEl) this.httpsEnabledEl.disabled = r;
    if (this.httpsPortEl)   this.httpsPortEl.disabled    = r;
    if (this.tls13El)       this.tls13El.disabled        = r;
    if (this._certSelectEl) this._certSelectEl.disabled  = r;
    if (this.vhostsEnabledEl) this.vhostsEnabledEl.disabled = r;
    if (this.http2EnabledEl) this.http2EnabledEl.disabled = r;
    if (this.h2cEnabledEl)  this.h2cEnabledEl.disabled   = r;
    if (this._vhostAddBtn)  this._vhostAddBtn.disabled   = r;
    for (const row of this._vhostRows) {
      row.hostEl.disabled = r;
      row.rootEl.disabled = r;
      row.certEl.disabled = r;
      row.delBtn.disabled = r;
    }
  }

  /** @param {VirtualHost} v */
  _addVhostRow(v) {
    const tbody = this._vhostTbody;
    if (!tbody) return;
    const hostEl = UI.input({ placeholder: "www.example.lan", value: v.host });
    const rootEl = UI.input({ placeholder: "/var/www/<host>/", value: v.docRoot });
    const certEl = UI.select([{ value: "", label: t("app.simplehttpserver.vhost.cert.default") }], {});
    // keep the saved choice even before the certificate list was read
    if (v.certPath) {
      certEl.appendChild(UI.el("option", { attrs: { value: v.certPath }, text: v.certPath }));
      certEl.value = v.certPath;
    }
    const tr = UI.el("tr", {});
    /** @type {{ tr: HTMLElement, hostEl: HTMLInputElement, rootEl: HTMLInputElement, certEl: HTMLSelectElement, delBtn: HTMLButtonElement }} */
    const row = /** @type {any} */ ({ tr, hostEl, rootEl, certEl });
    row.delBtn = UI.button("×", () => {
      tr.remove();
      this._vhostRows = this._vhostRows.filter(x => x !== row);
    });
    for (const c of [hostEl, rootEl, certEl, row.delBtn]) tr.appendChild(UI.td(c));
    tbody.appendChild(tr);
    this._vhostRows.push(row);
  }

  /** @returns {VirtualHost[]} */
  _vhostsFromUI() {
    return this._vhostRows.map(r => ({
      host: r.hostEl.value,
      docRoot: r.rootEl.value,
      certPath: r.certEl.value,
    }));
  }

  _timeoutMs() {
    return SimTimer.HTTP_SERVER_TIMEOUT_MS;
  }

  _startFromUI() {
    const portStr     = (this.portEl?.value      ?? "").trim();
    const rootStr     = (this.rootEl?.value       ?? "").trim();
    const httpsOn     = this.httpsEnabledEl?.checked ?? false;
    const httpsPortStr = (this.httpsPortEl?.value ?? "").trim();

    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this._appendLog(t("app.simplehttpserver.log.invalidPort", { time: nowStamp(), portStr }));
      return;
    }

    if (httpsOn) {
      const httpsPort = Number(httpsPortStr);
      if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535) {
        this._appendLog(t("app.simplehttpserver.log.invalidPort", { time: nowStamp(), portStr: httpsPortStr }));
        return;
      }
      if (!this._cert) {
        this._appendLog(t("app.simplehttpsserver.log.noCert", { time: nowStamp() }));
        return;
      }
      this.httpsPort = httpsPort;
    }

    if (this.vhostsEnabledEl) {
      const { vhosts, invalid, duplicate } = sanitizeVhosts(this._vhostsFromUI());
      if (invalid != null) {
        this._appendLog(t("app.simplehttpserver.log.vhostInvalid", { time: nowStamp(), host: invalid }));
        return;
      }
      if (duplicate != null) {
        this._appendLog(t("app.simplehttpserver.log.vhostDuplicate", { time: nowStamp(), host: duplicate }));
        return;
      }
      this.vhostsEnabled = this.vhostsEnabledEl.checked;
      this.vhosts = vhosts;
    }

    this.port         = port;
    this.docRoot      = rootStr || "/var/www/";
    this.httpsEnabled = httpsOn;
    if (this.keepAliveEl) this.keepAlive = this.keepAliveEl.checked;
    if (this.tls13El) this.tls13Enabled = this.tls13El.checked;
    if (this.http2EnabledEl) this.http2Enabled = this.http2EnabledEl.checked;
    if (this.h2cEnabledEl) this.h2cEnabled = this.h2cEnabledEl.checked;
    if (this.http2Enabled && !this.httpsEnabled) {
      this._appendLog(t("app.simplehttpserver.log.h2NeedsHttps", { time: nowStamp() }));
    }
    this._saveConfig();
    this._start();
  }

  _stop() {
    if (!this.running && !this.httpsRunning) return;

    this._writeAutostart(false);
    if (this.running) {
      this.running = false;
      this.runSeq++;
      const ref = this.serverRef;
      this.serverRef = null;
      if (ref != null) {
        try { this.os.net.closeTCPServerSocket(ref); }
        catch (e) {
          const reason = (e instanceof Error ? e.message : String(e));
          this._appendLog(t("app.simplehttpserver.log.stopError", { time: nowStamp(), reason }));
        }
      }
      this._appendLog(t("app.simplehttpserver.log.stopped", { time: nowStamp() }));
    }

    if (this.httpsRunning) {
      this.httpsRunning = false;
      this.httpsRunSeq++;
      const ref = this.httpsServerRef;
      this.httpsServerRef = null;
      if (ref != null) {
        try { this.os.net.closeTCPServerSocket(ref); }
        catch (e) {
          const reason = (e instanceof Error ? e.message : String(e));
          this._appendLog(t("app.simplehttpserver.log.httpsStopError", { time: nowStamp(), reason }));
        }
      }
      this._appendLog(t("app.simplehttpserver.log.httpsStopped", { time: nowStamp() }));
    }

    this._syncUI();
  }

  _ensureDocroot() {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs || typeof fs.mkdir !== "function") return;
    const roots = [this.docRoot, ...(this.vhostsEnabled ? this.vhosts.map(v => v.docRoot) : [])];
    for (const root of roots) {
      try { fs.mkdir(root, { recursive: true }); } catch { /* ignore */ }
    }
  }

  /**
   * Virtual host for a requested name, or null for the default host (also
   * when virtual hosting is off or no name was given).
   * @param {string} name
   * @returns {VirtualHost|null}
   */
  _findVhost(name) {
    if (!this.vhostsEnabled || !name) return null;
    const n = normalizeHostName(name);
    return this.vhosts.find(v => v.host === n) ?? null;
  }

  /**
   * SNI-based certificate choice: the vhost's own certificate, else the
   * default one (the client then reports a name mismatch, as real browsers do).
   * @param {string} sni
   */
  _selectCertForSni(sni) {
    const v = this._findVhost(sni);
    return (v && this._vhostCerts.get(v.host)) || this._cert;
  }

  /** Load every vhost certificate; failures are logged and fall back to the default cert. */
  async _loadVhostCerts() {
    const fs = this.os.fs;
    /** @type {Map<string, TlsCertificate>} */
    const certs = new Map();
    for (const v of this.vhosts) {
      if (!v.certPath || !fs) continue;
      try {
        const cert = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(v.certPath)));
        if (!cert.hasPrivateKey) throw new Error("no private key");
        certs.set(v.host, cert);
      } catch {
        this._appendLog(t("app.simplehttpserver.log.vhostCertError", { time: nowStamp(), host: v.host, path: v.certPath }));
      }
    }
    this._vhostCerts = certs;
  }

  /** @param {string} path @returns {Uint8Array|null} */
  _readFileBytes(path) {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return null;
    try {
      if (typeof fs.exists === "function" && !fs.exists(path)) return null;
      if (typeof fs.stat === "function") {
        const st = fs.stat(path);
        if (st?.type !== "file") return null;
      }
      if (typeof fs.readBinaryFile === "function") return fs.readBinaryFile(path);
      if (typeof fs.readFile === "function") {
        const s = fs.readFile(path);
        return (typeof s === "string") ? encodeUTF8(s) : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  _start() {
    if (this.running) return;

    this._ensureDocroot();

    // Start HTTP listener
    let ref = null;
    try {
      ref = this.os.net.openTCPServerSocket(IPAddress.fromString("::"), this.port);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(t("app.simplehttpserver.log.openSocketError", { time: nowStamp(), reason }));
      return;
    }

    this.serverRef = ref;
    this.running   = true;
    this._writeAutostart(true);
    this._syncUI();
    const seq = ++this.runSeq;
    this._appendLog(t("app.simplehttpserver.log.listen", { time: nowStamp(), port: this.port, docRoot: this.docRoot }));
    if (this.vhostsEnabled) {
      for (const v of this.vhosts) {
        this._appendLog(t("app.simplehttpserver.log.vhost", { time: nowStamp(), host: v.host, docRoot: v.docRoot }));
      }
      this._vhostCertsReady = this._loadVhostCerts();
    }
    this._acceptLoop(seq, ref, false);

    // Start HTTPS listener if enabled
    if (this.httpsEnabled && this._cert) {
      let httpsRef = null;
      try {
        httpsRef = this.os.net.openTCPServerSocket(IPAddress.fromString("::"), this.httpsPort);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.simplehttpserver.log.httpsOpenSocketError", { time: nowStamp(), reason }));
        return;
      }

      this.httpsServerRef = httpsRef;
      this.httpsRunning   = true;
      this._syncUI();
      const httpsSeq = ++this.httpsRunSeq;
      this._appendLog(t("app.simplehttpserver.log.httpsListen", { time: nowStamp(), port: this.httpsPort }));
      this._acceptLoop(httpsSeq, httpsRef, true);
    }
  }

  /**
   * @param {number} seq
   * @param {number} ref
   * @param {boolean} isTls
   */
  async _acceptLoop(seq, ref, isTls) {
    const isActive = () => isTls
      ? (this.httpsRunning && this.httpsRunSeq === seq && this.httpsServerRef === ref)
      : (this.running      && this.runSeq      === seq && this.serverRef      === ref);

    while (isActive()) {
      /** @type {string|null} */
      let connKey = null;

      try {
        connKey = await this.os.net.acceptTCPConn(ref);
      } catch (e) {
        if (isActive()) {
          const reason = (e instanceof Error ? e.message : String(e));
          this._appendLog(t("app.simplehttpserver.log.acceptError", { time: nowStamp(), reason }));
        }
        continue;
      }

      if (!isActive()) break;
      if (connKey == null) break;

      this._handleConn(seq, connKey, isTls).catch((e) => {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.simplehttpserver.log.connError", { time: nowStamp(), reason }));
        try { this.os.net.closeTCPConn(connKey); } catch { /* ignore */ }
      });
    }
  }

  /**
   * @param {string} connKey
   * @param {boolean} isTls
   * @returns {Promise<{send:(d:Uint8Array)=>void, recv:()=>Promise<Uint8Array|null>, close:()=>void, sni:string, alpn:string}|null>}
   */
  async _ioForConn(connKey, isTls) {
    const net = this.os.net;

    if (!isTls) {
      return {
        send:  (data) => net.sendTCPConn(connKey, data),
        recv:  ()     => net.recvTCPConn(connKey),
        close: ()     => net.closeTCPConn(connKey),
        sni:   "",
        alpn:  "",
      };
    }

    if (!this._cert) {
      this._appendLog(t("app.simplehttpsserver.log.noCert", { time: nowStamp() }));
      try { net.closeTCPConn(connKey); } catch { /* ignore */ }
      return null;
    }

    if (this.vhostsEnabled) await this._vhostCertsReady;
    const tls = new TlsSession({
      send: (d) => net.sendTCPConn(connKey, d),
      recv: ()  => net.recvTCPConn(connKey),
      isServer:   true,
      cert:       this._cert,
      // with virtual hosts the certificate follows the client's SNI
      selectCert: this.vhostsEnabled ? (sni) => this._selectCertForSni(sni) : undefined,
      // ALPN: offer h2 only when enabled; http/1.1 is always available
      alpn:       this.http2Enabled ? ["h2", "http/1.1"] : ["http/1.1"],
      versions:   this.tls13Enabled ? ["1.3", "1.2"] : ["1.2"],
      trustStore: this.os.tls?.certStore ?? null,
      timeoutMs:  this._timeoutMs(),
      sleepFn:    (ms) => simTimer.sleep(ms),
      now:        () => this.os.clock.nowMs(),
    });

    try {
      await tls.handshake();
      const info = net.getTCPConnInfo(connKey);
      const peer = info ? `${info.peerIP}:${info.peerPort}` : "?";
      this._appendLog((tls.sni
        ? t("app.simplehttpsserver.log.tlsOkSni", { time: nowStamp(), peer, sni: tls.sni })
        : t("app.simplehttpsserver.log.tlsOk", { time: nowStamp(), peer })) + ` [${tls.version}]`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(t("app.simplehttpsserver.log.tlsFailed", { time: nowStamp(), reason }));
      try { tls.close(); } catch { /* ignore */ }
      try { net.closeTCPConn(connKey); } catch { /* ignore */ }
      return null;
    }

    return {
      send:  /** @type {any} */ ((/** @type {any} */ d) => tls.send(d)),
      recv:  ()  => tls.recv(),
      close: ()  => { tls.close(); try { net.closeTCPConn(connKey); } catch { /* ignore */ } },
      sni:   tls.sni,
      alpn:  tls.alpn,
    };
  }

  /**
   * Serve one TCP (or TLS) connection. With keep-alive several requests are
   * read one after another from the same connection (RFC 9112 §9.3); bytes
   * after the end of one request stay buffered as the start of the next
   * (pipelining).
   * @param {number} seq
   * @param {string} connKey
   * @param {boolean} isTls
   */
  async _handleConn(seq, connKey, isTls) {
    const io = await this._ioForConn(connKey, isTls);
    if (io === null) return;

    const isActive = () => isTls
      ? (this.httpsRunning && this.httpsRunSeq === seq)
      : (this.running      && this.runSeq      === seq);

    if (io.alpn === "h2") return this._serveHttp2(io, new Uint8Array(0), isTls, isActive);

    const headerNeedle = encodeUTF8("\r\n\r\n");
    const limit = 64 * 1024;
    /** @type {Uint8Array} */
    let buf = new Uint8Array(0);
    let served = 0;

    while (true) {
      const first = served === 0;
      // The first request gets the normal read timeout; between requests the
      // shorter keep-alive idle timeout applies.
      const timeout = first ? this._timeoutMs() : SimTimer.HTTP_KEEPALIVE_TIMEOUT_MS;
      let idx = indexOfBytes(buf, headerNeedle);
      let idle = false;

      while (idx < 0 && buf.length <= limit && isActive()) {
        /** @type {Uint8Array|null} */
        let part;
        if (first) {
          part = await withTimeout(io.recv(), timeout, "recv");
        } else {
          try {
            part = await withTimeout(io.recv(), timeout, "recv");
          } catch {
            idle = true;
            break;
          }
        }
        if (part == null) break;
        buf = concatChunks([buf, part]);
        idx = indexOfBytes(buf, headerNeedle);
      }

      if (idx < 0) {
        // A persistent connection that simply ends (or idles out) between
        // two requests is the normal end of keep-alive, not an error.
        if (!first && buf.length === 0) {
          if (idle) this._appendLog(t("app.simplehttpserver.log.keepAliveIdle", { time: nowStamp(), count: served }));
          io.close();
          return;
        }
        await this._sendError(io, 400, "Bad Request",
          t("app.simplehttpserver.http.400.title"),
          t("app.simplehttpserver.http.400.details"));
        return;
      }

      const headerText = decodeUTF8(buf.slice(0, idx));
      buf = buf.slice(idx + headerNeedle.length);

      // h2c with prior knowledge: the client starts right away with the
      // HTTP/2 preface "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n" (RFC 9113 §3.3)
      if (first && !isTls && this.h2cEnabled && headerText === "PRI * HTTP/2.0") {
        return this._serveHttp2(io, concatChunks([encodeUTF8(headerText + "\r\n\r\n"), buf]), false, isActive);
      }
      served++;

      const keep = await this._serveRequest(io, headerText, isTls, served);
      if (!keep) return;  // _serveRequest has closed the connection
      if (!isActive()) { io.close(); return; }
    }
  }

  /**
   * Serve an HTTP/2 connection. Requests arrive multiplexed as streams; each
   * one goes through the same handling as HTTP/1.1. An idle connection (no
   * open stream) is ended with GOAWAY after the keep-alive timeout.
   * @param {{ send: (d: Uint8Array) => any, recv: () => Promise<Uint8Array|null>, close: () => void, sni: string }} io
   * @param {Uint8Array} initial bytes already read (h2c preface)
   * @param {boolean} isTls
   * @param {() => boolean} isActive
   */
  async _serveHttp2(io, initial, isTls, isActive) {
    let pending = initial.length > 0 ? initial : null;
    let streams = 0;
    /** @type {number|null} */
    let idleTimer = null;
    const stopIdle = () => { if (idleTimer !== null) { simTimer.cancel(idleTimer); idleTimer = null; } };

    const conn = new Http2Connection({
      send: (d) => io.send(d),
      recv: () => {
        if (pending) { const p = pending; pending = null; return Promise.resolve(p); }
        return io.recv();
      },
      isServer: true,
      onRequest: async (req, res) => {
        streams++;
        const r = this._resolveRequest({
          method: req.method,
          target: req.path,
          reqHost: hostFromHeader(req.authority),
          sni: io.sni,
          isTls,
          label: ` (h2, stream ${req.streamId})`,
        });
        // HTTP/2 has no reason phrase and no connection headers
        const headers = /** @type {Array<[string, string]>} */ (Object.entries(r.headers));
        await res.respond(r.status, headers, r.body);
        if (!isActive()) conn.goaway();
      },
      onActive: stopIdle,
      onIdle: () => {
        stopIdle();
        idleTimer = simTimer.schedule(() => {
          idleTimer = null;
          if (conn.activeStreams > 0 || conn.closed) return;
          this._appendLog(t("app.simplehttpserver.log.h2Idle", { time: nowStamp(), count: streams }));
          conn.goaway();
          io.close();
        }, SimTimer.HTTP_KEEPALIVE_TIMEOUT_MS);
      },
    });

    this._appendLog(t("app.simplehttpserver.log.h2Start", { time: nowStamp(), mode: isTls ? "h2 (ALPN)" : "h2c" }));
    conn.start();
    conn.onIdle?.(); // no stream yet: start the idle timer
    await conn.done;
    stopIdle();
    const err = conn.closeError;
    if (err instanceof Http2Error && !err.remote) {
      this._appendLog(t("app.simplehttpserver.log.h2Error", { time: nowStamp(), reason: `${h2ErrorName(err.code)}: ${err.message}` }));
    }
    try { io.close(); } catch { /* already closed */ }
  }

  /**
   * Answer one request. Returns true when the connection stays open for the
   * next one; otherwise the connection has been closed.
   * @param {{ send: (d: Uint8Array) => any, close: () => void, sni: string }} io
   * @param {string} headerText request line + header fields (without the blank line)
   * @param {boolean} isTls
   * @param {number} served number of this request on the connection (1-based)
   * @returns {Promise<boolean>}
   */
  async _serveRequest(io, headerText, isTls, served) {
    const lines = headerText.split("\r\n");
    const reqLine = lines[0] || "";

    const m = /^([A-Z]+)\s+(\S+)\s+HTTP\/1\.([01])$/.exec(reqLine);
    if (!m) {
      await this._sendError(io, 400, "Bad Request",
        t("app.simplehttpserver.http.400.title"),
        t("app.simplehttpserver.http.400.invalidRequestLine", { reqLine }));
      return false;
    }

    const method = m[1];
    const target = m[2];
    const http11 = m[3] === "1";

    // RFC 9112 §3.2: an HTTP/1.1 request needs exactly one Host header, otherwise 400
    const hostLines = lines.slice(1).filter(l => /^host\s*:/i.test(l));
    if (http11 && hostLines.length !== 1) {
      await this._sendError(io, 400, "Bad Request",
        t("app.simplehttpserver.http.400.title"),
        t("app.simplehttpserver.http.400.host"));
      return false;
    }

    // Persistence (RFC 9112 §9.3): HTTP/1.1 stays open unless "close" is
    // sent, HTTP/1.0 only with an explicit "keep-alive". A request body is
    // never read by this server, so such a connection cannot be reused.
    const headerValues = (/** @type {string} */ name) => lines.slice(1)
      .filter(l => l.toLowerCase().startsWith(name + ":"))
      .map(l => l.slice(name.length + 1).trim().toLowerCase());
    const connTokens = headerValues("connection").flatMap(v => v.split(",").map(x => x.trim()));
    const hasBody = headerValues("transfer-encoding").length > 0
      || headerValues("content-length").some(v => v !== "0");
    const keep = this.keepAlive
      && !connTokens.includes("close")
      && (http11 || connTokens.includes("keep-alive"))
      && !hasBody
      && served < MAX_KEEPALIVE_REQUESTS;
    /** @type {Record<string,string>} */
    const connHeaders = keep
      ? {
          "Connection": "keep-alive",
          "Keep-Alive": `timeout=${Math.round(SimTimer.HTTP_KEEPALIVE_TIMEOUT_MS / 1000)}, max=${MAX_KEEPALIVE_REQUESTS - served}`,
        }
      : { "Connection": "close" };

    // Virtual host: chosen by the Host header; an HTTP/1.0 request without
    // one falls back to the TLS server name.
    const hostLine = hostLines[0];
    const reqHost = hostLine ? hostFromHeader(hostLine.slice(hostLine.indexOf(":") + 1)) : "";

    // with keep-alive, the log shows the request number on this connection
    const res = this._resolveRequest({
      method, target, reqHost, sni: io.sni, isTls,
      label: this.keepAlive && served > 1 ? ` (#${served})` : "",
    });
    const persist = keep && !res.close;
    const resp = buildResponse(res.status, res.reason, {
      ...res.headers,
      ...(persist ? connHeaders : { "Connection": "close" }),
    }, res.body);
    await io.send(resp);
    if (!persist) io.close();
    return persist;
  }

  /**
   * Protocol-independent request handling shared by HTTP/1.1 and HTTP/2:
   * virtual host, 421 check, method check, file lookup, logging.
   * @param {{ method: string, target: string, reqHost: string, sni: string,
   *           isTls: boolean, label: string }} r label: appended to the log entry
   * @returns {{ status: number, reason: string, headers: Record<string,string>,
   *             body: Uint8Array, close: boolean }} close: HTTP/1.1 must not reuse the connection
   */
  _resolveRequest(r) {
    const { method, target, reqHost, sni, isTls, label } = r;
    const head = method === "HEAD";
    const vhost = this._findVhost(reqHost || sni);

    /**
     * @param {number} status @param {string} reason @param {string} title @param {string} details
     * @param {Record<string,string>} [extra]
     */
    const errorPage = (status, reason, title, details, extra = {}) => {
      const body = internalHtml(title, details);
      return {
        status, reason, close: false,
        headers: {
          "Date": new Date().toUTCString(),
          ...extra,
          "Server": "SimpleHTTPServer/1.0",
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": String(body.length),
        },
        // HEAD: headers only (RFC 9110 §9.3.2)
        body: head ? new Uint8Array(0) : body,
      };
    };

    // RFC 9110 §15.5.20: the TLS connection was set up for the SNI name (and
    // its certificate); a request for a different site on it is misdirected.
    if (isTls && this.vhostsEnabled && sni && reqHost && this._findVhost(sni) !== vhost) {
      this._appendLog(t("app.simplehttpserver.log.misdirected", { time: nowStamp(), sni, host: reqHost }));
      return errorPage(421, "Misdirected Request",
        t("app.simplehttpserver.http.421.title"),
        t("app.simplehttpserver.http.421.details", { sni, host: reqHost }));
    }

    if (method !== "GET" && method !== "HEAD") {
      this._appendLog(t("app.simplehttpserver.log.methodNotAllowed", { time: nowStamp(), method, target }));
      // RFC 9110 §15.5.6: MUST list the supported methods. The unread body
      // makes the HTTP/1.1 connection unusable.
      return { ...errorPage(405, "Method Not Allowed",
        t("app.simplehttpserver.http.405.title"),
        t("app.simplehttpserver.http.405.details", { method }),
        { "Allow": "GET, HEAD" }), close: true };
    }

    let norm = normalizeUrlPath(target);
    if (norm.endsWith("/")) norm += "index.html";

    const fsPath = joinDocroot(vhost ? vhost.docRoot : this.docRoot, norm);
    const data = this._readFileBytes(fsPath);
    // log which site served the request once virtual hosting is on
    const shown = (this.vhostsEnabled
      ? `[${vhost ? vhost.host : t("app.simplehttpserver.vhost.defaultTag")}] ${norm}`
      : norm) + label;

    if (data == null) {
      this._appendLog(t("app.simplehttpserver.log.notFound", { time: nowStamp(), method, norm: shown }));
      return errorPage(404, "Not Found",
        t("app.simplehttpserver.http.404.title"),
        t("app.simplehttpserver.http.404.details", { norm, fsPath }));
    }

    this._appendLog(t("app.simplehttpserver.log.ok", { time: nowStamp(), method, norm: shown, bytes: data.length }));
    return {
      status: 200, reason: "OK", close: false,
      headers: {
        "Date": new Date().toUTCString(),
        "Server": "SimpleHTTPServer/1.0",
        "Content-Type": contentTypeOf(fsPath),
        "Content-Length": String(data.length),
      },
      body: head ? new Uint8Array(0) : data,
    };
  }

  /**
   * Send an HTML error page. The connection is closed unless `extraHeaders`
   * announce "Connection: keep-alive".
   * @param {{ send: (d: Uint8Array) => any, close: () => void }} io
   * @param {number} status
   * @param {string} reason
   * @param {string} title
   * @param {string} details
   * @param {Record<string,string>} [extraHeaders] may override "Connection"
   * @param {boolean} [headOnly] HEAD request: headers only (RFC 9110 §9.3.2)
   */
  async _sendError(io, status, reason, title, details, extraHeaders = {}, headOnly = false) {
    const body = internalHtml(title, details);
    const { Connection: connection = "close", ...rest } = extraHeaders;
    const resp = buildResponse(status, reason, {
      "Date": new Date().toUTCString(),
      ...(rest.Allow ? { Allow: rest.Allow } : {}),
      "Server": "SimpleHTTPServer/1.0",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(body.length),
      "Connection": connection,
      ...(rest["Keep-Alive"] ? { "Keep-Alive": rest["Keep-Alive"] } : {}),
    }, headOnly ? new Uint8Array(0) : body);
    await io.send(resp);
    if (connection !== "keep-alive") io.close();
  }

  // ── HTTPS cert helpers ──────────────────────────────────────────────────────

  async _refreshCertList() {
    const sel = this._certSelectEl;
    if (!sel) return;
    const fs = this.os.fs;
    if (!fs) return;
    const vhostSelects = this._vhostRows.map(r => r.certEl);

    /** @type {Array<{cert: TlsCertificate, path: string, name: string}>} */
    const entries = [];
    try {
      const names = fs.readdir(CERT_DIR);
      await Promise.all(names.filter(n => n.endsWith(".json")).map(async name => {
        try {
          const cert = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(`${CERT_DIR}/${name}`)));
          if (cert.hasPrivateKey) entries.push({ cert, path: `${CERT_DIR}/${name}`, name });
        } catch { /* skip invalid */ }
      }));
    } catch { /* dir missing */ }

    if (entries.length === 0) {
      sel.replaceChildren(
        UI.el("option", { attrs: { value: "" }, text: t("app.simplehttpsserver.cert.noEntries") }),
      );
    } else {
      const cn = (/** @type {string} */ s) => s.replace(/^CN=/, "");
      // Same CN in several files (e.g. a renewed certificate) — the file name tells them apart.
      entries.sort((a, b) => a.name.localeCompare(b.name));
      sel.replaceChildren(
        ...entries.map(e => UI.el("option", {
          attrs: { value: e.path },
          text: `${cn(e.cert.subject)} (${e.name})`,
        })),
      );
      if (this.certPath && entries.some(e => e.path === this.certPath)) sel.value = this.certPath;
    }

    // Virtual-host rows: "(default certificate)" plus every certificate with a
    // private key. A saved path whose file is gone stays visible as-is.
    const cn = (/** @type {string} */ s) => s.replace(/^CN=/, "");
    for (const vs of vhostSelects) {
      const current = vs.value;
      const opts = [
        UI.el("option", { attrs: { value: "" }, text: t("app.simplehttpserver.vhost.cert.default") }),
        ...entries.map(e => UI.el("option", { attrs: { value: e.path }, text: `${cn(e.cert.subject)} (${e.name})` })),
      ];
      if (current && !entries.some(e => e.path === current)) {
        opts.push(UI.el("option", { attrs: { value: current }, text: current }));
      }
      vs.replaceChildren(...opts);
      vs.value = current;
    }
  }

  _renderCertInfo() {
    if (!this._certInfoEl) return;
    if (!this._cert) {
      this._certInfoEl.textContent = t("app.simplehttpsserver.cert.none");
      return;
    }
    const expiry = new Date(this._cert.notAfter).toLocaleDateString();
    const status = this._cert.validityStatus(this.os.clock ? this.os.clock.nowMs() : Date.now());
    const statusSuffix = status === "expired"     ? ` (${t("app.simplehttpsserver.cert.statusExpired")})`
                        : status === "notYetValid" ? ` (${t("app.simplehttpsserver.cert.statusNotYetValid")})`
                        : "";
    this._certInfoEl.textContent = [
      t("app.simplehttpsserver.cert.subject",     { subject: this._cert.subject }),
      t("app.simplehttpsserver.cert.fingerprint", { fp: this._cert.fingerprint() }),
      t("app.simplehttpsserver.cert.expiry",      { date: expiry }) + statusSuffix,
    ].join("\n");
  }

  async _applyCert() {
    const path = this._certSelectEl?.value;
    const fs   = this.os.fs;
    if (!path || !fs) return;
    try {
      this._cert = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(path)));
      this.certPath = path;
      this._saveConfig();
      this._appendLog(t("app.simplehttpsserver.log.certApplied",
        { time: nowStamp(), subject: this._cert.subject }));
      this._renderCertInfo();
    } catch {
      this._appendLog(t("app.simplehttpsserver.log.noCert", { time: nowStamp() }));
    }
  }

  _loadConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      const json = JSON.parse(fs.readFile("/etc/httpd.conf"));
      if (Number.isInteger(json.port) && json.port >= 1 && json.port <= 65535) this.port = json.port;
      if (typeof json.docRoot === "string" && json.docRoot) this.docRoot = json.docRoot;
      if (typeof json.keepAlive === "boolean") this.keepAlive = json.keepAlive;
      if (typeof json.tls13Enabled === "boolean") this.tls13Enabled = json.tls13Enabled;
      if (typeof json.http2Enabled === "boolean") this.http2Enabled = json.http2Enabled;
      if (typeof json.h2cEnabled === "boolean") this.h2cEnabled = json.h2cEnabled;
      if (typeof json.httpsEnabled === "boolean") this.httpsEnabled = json.httpsEnabled;
      if (Number.isInteger(json.httpsPort) && json.httpsPort >= 1 && json.httpsPort <= 65535) this.httpsPort = json.httpsPort;
      if (typeof json.certPath === "string") this.certPath = json.certPath;
      if (typeof json.vhostsEnabled === "boolean") this.vhostsEnabled = json.vhostsEnabled;
      if (Array.isArray(json.vhosts)) this.vhosts = sanitizeVhosts(json.vhosts).vhosts;
    } catch { /* use defaults */ }
  }

  _saveConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      fs.writeFile("/etc/httpd.conf", JSON.stringify({
        port: this.port,
        docRoot: this.docRoot,
        keepAlive: this.keepAlive,
        tls13Enabled: this.tls13Enabled,
        http2Enabled: this.http2Enabled,
        h2cEnabled: this.h2cEnabled,
        httpsEnabled: this.httpsEnabled,
        httpsPort: this.httpsPort,
        certPath: this.certPath,
        vhostsEnabled: this.vhostsEnabled,
        vhosts: this.vhosts,
      }, null, 2));
    } catch { /* ignore */ }
  }

  async _loadCertFromPath(/** @type {string} */ path) {
    const fs = this.os.fs;
    if (!fs || !path) return;
    try {
      this._cert = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(path)));
      this._renderCertInfo();
    } catch { /* cert file gone -> ignore */ }
  }
}
