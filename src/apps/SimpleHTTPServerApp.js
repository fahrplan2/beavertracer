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

const CERT_DIR = "/etc/certs";

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

  /** @type {string} */
  certPath = "";

  // ── UI refs ─────────────────────────────────────────────────────────────────

  /** @type {HTMLInputElement|null} */
  portEl = null;

  /** @type {HTMLInputElement|null} */
  rootEl = null;

  /** @type {HTMLInputElement|null} */
  httpsEnabledEl = null;

  /** @type {HTMLInputElement|null} */
  httpsPortEl = null;

  /** @type {HTMLSelectElement|null} */
  _certSelectEl = null;

  /** @type {HTMLElement|null} */
  _certInfoEl = null;

  /** @type {HTMLButtonElement|null} */
  startBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;

  icon = "fa-server";
  badge = "HTTP";

  run() {
    this.root.classList.add("app", "app-simple-http-server");
    this._loadConfig();
    setTimeout(() => this._tryAutostart(), 0);
  }

  _tryAutostart() {
    try {
      const fs = this.os.fs;
      if (!fs) return;
      const json = JSON.parse(fs.readFile("/etc/httpd.conf"));
      if (json.autostart !== true) return;
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

    const httpPane = UI.el("div", { children: [
      UI.row(t("app.simplehttpserver.label.port"), portInput),
      UI.row(t("app.simplehttpserver.label.docRoot"), rootInput),
    ]});

    // HTTPS tab
    const httpsEnabledInput = /** @type {HTMLInputElement} */ (UI.el("input", {
      attrs: { type: "checkbox" },
      init: (el) => { el.checked = this.httpsEnabled; },
    }));
    this.httpsEnabledEl = httpsEnabledInput;

    const httpsPortInput = UI.input({ placeholder: "443", value: String(this.httpsPort) });
    this.httpsPortEl = httpsPortInput;

    const certSelect = UI.select([], {});
    this._certSelectEl = certSelect;

    const certInfo = UI.el("div", { className: "msg" });
    this._certInfoEl = certInfo;

    const httpsPane = UI.el("div", { children: [
      UI.row(t("app.simplehttpserver.label.httpsEnabled"), httpsEnabledInput),
      UI.row(t("app.simplehttpserver.label.httpsPort"), httpsPortInput),
      UI.row(t("app.simplehttpsserver.label.cert"), certSelect),
      UI.buttonRow([
        UI.button(t("app.simplehttpsserver.button.use"), () => this._applyCert(), { primary: true, icon: "fa-check" }),
      ]),
      certInfo,
    ]});

    // Log tab
    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const logPane = UI.el("div", { children: [
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
      { id: "log",   label: t("app.simplehttpserver.label.log"), pane: logPane },
    ]);

    const panel = UI.panel([
      UI.el("div", { className: "app-toolbar", children: [UI.buttonRow([start, stop])] }),
      tabBar,
      httpPane,
      httpsPane,
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
    this.httpsEnabledEl = null;
    this.httpsPortEl   = null;
    this._certSelectEl = null;
    this._certInfoEl   = null;
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
    if (this.httpsEnabledEl) this.httpsEnabledEl.disabled = r;
    if (this.httpsPortEl)   this.httpsPortEl.disabled    = r;
    if (this._certSelectEl) this._certSelectEl.disabled  = r;
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

    this.port         = port;
    this.docRoot      = rootStr || "/var/www/";
    this.httpsEnabled = httpsOn;
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
    if (!fs) return;
    try {
      if (typeof fs.mkdir === "function") fs.mkdir(this.docRoot, { recursive: true });
    } catch { /* ignore */ }
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
   * @returns {Promise<{send:(d:Uint8Array)=>void, recv:()=>Promise<Uint8Array|null>, close:()=>void}|null>}
   */
  async _ioForConn(connKey, isTls) {
    const net = this.os.net;

    if (!isTls) {
      return {
        send:  (data) => net.sendTCPConn(connKey, data),
        recv:  ()     => net.recvTCPConn(connKey),
        close: ()     => net.closeTCPConn(connKey),
      };
    }

    if (!this._cert) {
      this._appendLog(t("app.simplehttpsserver.log.noCert", { time: nowStamp() }));
      try { net.closeTCPConn(connKey); } catch { /* ignore */ }
      return null;
    }

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

  /**
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

    const timeout = this._timeoutMs();

    const headerNeedle = encodeUTF8("\r\n\r\n");
    /** @type {Uint8Array[]} */
    const chunks = [];
    let total = 0;
    const limit = 64 * 1024;

    while (isActive()) {
      const part = await withTimeout(io.recv(), timeout, "recv");
      if (part == null) break;

      chunks.push(part);
      total += part.length;

      if (total > limit) break;

      const buf2 = concatChunks(chunks);
      if (indexOfBytes(buf2, headerNeedle) >= 0) break;
    }

    const buf = concatChunks(chunks);
    const idx = indexOfBytes(buf, headerNeedle);

    if (idx < 0) {
      const body = internalHtml(
        t("app.simplehttpserver.http.400.title"),
        t("app.simplehttpserver.http.400.details")
      );
      const resp = buildResponse(400, "Bad Request", {
        "Date": new Date().toUTCString(),
        "Server": "SimpleHTTPServer/1.0",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(body.length),
        "Connection": "close",
      }, body);

      await io.send(resp);
      io.close();
      return;
    }

    const headerText = decodeUTF8(buf.slice(0, idx));
    const lines = headerText.split("\r\n");
    const reqLine = lines[0] || "";

    const m = /^([A-Z]+)\s+(\S+)\s+HTTP\/1\.[01]$/.exec(reqLine);
    if (!m) {
      const body = internalHtml(
        t("app.simplehttpserver.http.400.title"),
        t("app.simplehttpserver.http.400.invalidRequestLine", { reqLine })
      );
      const resp = buildResponse(400, "Bad Request", {
        "Date": new Date().toUTCString(),
        "Server": "SimpleHTTPServer/1.0",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(body.length),
        "Connection": "close",
      }, body);

      await io.send(resp);
      io.close();
      return;
    }

    const method = m[1];
    const target = m[2];

    if (method !== "GET" && method !== "HEAD") {
      const body = internalHtml(
        t("app.simplehttpserver.http.405.title"),
        t("app.simplehttpserver.http.405.details", { method })
      );
      const resp = buildResponse(405, "Method Not Allowed", {
        "Date": new Date().toUTCString(),
        "Server": "SimpleHTTPServer/1.0",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(body.length),
        "Connection": "close",
      }, body);

      await io.send(resp);
      io.close();
      this._appendLog(t("app.simplehttpserver.log.methodNotAllowed", { time: nowStamp(), method, target }));
      return;
    }

    let norm = normalizeUrlPath(target);
    if (norm.endsWith("/")) norm += "index.html";

    const fsPath = joinDocroot(this.docRoot, norm);
    const data = this._readFileBytes(fsPath);

    if (data == null) {
      const body = internalHtml(
        t("app.simplehttpserver.http.404.title"),
        t("app.simplehttpserver.http.404.details", { norm, fsPath })
      );
      const resp = buildResponse(404, "Not Found", {
        "Date": new Date().toUTCString(),
        "Server": "SimpleHTTPServer/1.0",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(body.length),
        "Connection": "close",
      }, body);

      await io.send(resp);
      io.close();
      this._appendLog(t("app.simplehttpserver.log.notFound", { time: nowStamp(), method, norm }));
      return;
    }

    const ct   = contentTypeOf(fsPath);
    const body = (method === "HEAD") ? new Uint8Array(0) : data;

    const resp = buildResponse(200, "OK", {
      "Date": new Date().toUTCString(),
      "Server": "SimpleHTTPServer/1.0",
      "Content-Type": ct,
      "Content-Length": String(data.length),
      "Connection": "close",
    }, body);

    await io.send(resp);
    io.close();
    this._appendLog(t("app.simplehttpserver.log.ok", { time: nowStamp(), method, norm, bytes: data.length }));
  }

  // ── HTTPS cert helpers ──────────────────────────────────────────────────────

  async _refreshCertList() {
    const sel = this._certSelectEl;
    if (!sel) return;
    const fs = this.os.fs;
    if (!fs) return;

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
      if (typeof json.httpsEnabled === "boolean") this.httpsEnabled = json.httpsEnabled;
      if (Number.isInteger(json.httpsPort) && json.httpsPort >= 1 && json.httpsPort <= 65535) this.httpsPort = json.httpsPort;
      if (typeof json.certPath === "string") this.certPath = json.certPath;
    } catch { /* use defaults */ }
  }

  _saveConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      fs.writeFile("/etc/httpd.conf", JSON.stringify({
        port: this.port,
        docRoot: this.docRoot,
        httpsEnabled: this.httpsEnabled,
        httpsPort: this.httpsPort,
        certPath: this.certPath,
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
