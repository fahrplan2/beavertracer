//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { CleanupBag } from "./lib/CleanupBag.js";
import { UILib as UI } from "./lib/UILib.js";
import { SimControl } from "../SimControl.js"; // ggf. Pfad anpassen
import { t } from "../i18n/index.js";

/**
 * @param {number} n
 */
function nowStamp(n = Date.now()) {
  return new Date(n).toLocaleTimeString();
}

/**
 * @param {string} s
 */
function encodeUTF8(s) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * @param {Uint8Array} b
 */
function decodeUTF8(b) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

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
 * Small content-type mapping (text-first).
 * @param {string} path
 */
function contentTypeOf(path) {
  const p = path.toLowerCase();
  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".txt") || p.endsWith(".log")) return "text/plain; charset=utf-8";
  return "text/plain; charset=utf-8";
}

/**
 * Normalize URL path into a safe filesystem relative path.
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
 * Join docroot and normalized path.
 * @param {string} docRoot
 * @param {string} normPath
 */
function joinDocroot(docRoot, normPath) {
  let root = docRoot.trim() || "/var/www/";
  if (!root.endsWith("/")) root += "/";
  return root + normPath.slice(1);
}

/**
 * Build an HTTP/1.1 response
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
  const esc = (s) => String(s)
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
 * Promise wrapper with timeout in ms.
 * @template T
 * @param {Promise<T>} p
 * @param {number} ms
 * @param {string} label
 */
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), Math.max(1, ms | 0));
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export class SimpleHTTPServerApp extends GenericProcess {
  
  title = t("app.simplehttpserver.title");

  /** @type {CleanupBag} */
  bag = new CleanupBag();

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

  /** @type {Array<string>} */
  log = [];

  /** @type {HTMLElement|null} */
  logEl = null;

  /** @type {HTMLInputElement|null} */
  portEl = null;

  /** @type {HTMLInputElement|null} */
  rootEl = null;

  /** @type {HTMLButtonElement|null} */
  startBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;

  run() {
    this.title = "Simple HTTP Server";
    this.root.classList.add("app", "app-simple-http-server");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.bag.dispose();

    const portInput = UI.input({ placeholder: "Port (1..65535)", value: String(this.port) });
    const rootInput = UI.input({ placeholder: "Document Root", value: String(this.docRoot) });
    this.portEl = portInput;
    this.rootEl = rootInput;

    const start = UI.button("Start", () => this._startFromUI(), { primary: true });
    const stop = UI.button("Stop", () => this._stop(), {});
    this.startBtn = start;
    this.stopBtn = stop;

    const status = UI.el("div", { className: "msg" });
    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const panel = UI.panel([
      UI.row("Port", portInput),
      UI.row("Document Root", rootInput),
      UI.buttonRow([start, stop, UI.button("Clear Log", () => { this.log = []; this._renderLog(); }, {})]),
      status,
      UI.el("div", { text: "Log:" }),
      logBox,
    ]);

    this.root.replaceChildren(panel);
    this._syncUI();
    this._renderLog();

    this.bag.interval(() => {
      status.textContent =
        `PID: ${this.pid}\n` +
        `Running: ${this.running}\n` +
        `Port: ${this.port}\n` +
        `DocRoot: ${this.docRoot}\n` +
        `ServerRef: ${this.serverRef ?? "-"}\n` +
        `Log entries: ${this.log.length}`;
    }, 300);
  }

  onUnmount() {
    this.bag.dispose();
    this.logEl = null;
    this.portEl = null;
    this.rootEl = null;
    this.startBtn = null;
    this.stopBtn = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    super.destroy();
  }

  _syncUI() {
    const r = this.running;
    if (this.startBtn) this.startBtn.disabled = r;
    if (this.stopBtn) this.stopBtn.disabled = !r;
    if (this.portEl) this.portEl.disabled = r;
    if (this.rootEl) this.rootEl.disabled = r;
  }

  _renderLog() {
    if (!this.logEl) return;
    const maxLines = 400;
    const lines = this.log.length > maxLines ? this.log.slice(-maxLines) : this.log;
    this.logEl.textContent = lines.join("\n");
  }

  /**
   * @param {string} line
   */
  _append(line) {
    this.log.push(line);
    if (this.log.length > 4000) this.log.splice(0, this.log.length - 4000);
    if (this.mounted) this._renderLog();
  }

  _timeoutMs() {
    const tick = (SimControl?.tick ?? 10);
    return Math.max(1, 20 * (tick | 0));
  }

  _startFromUI() {
    const portStr = (this.portEl?.value ?? "").trim();
    const rootStr = (this.rootEl?.value ?? "").trim();

    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this._append(`[${nowStamp()}] ERROR invalid port: "${portStr}"`);
      return;
    }

    this.port = port;
    this.docRoot = rootStr || "/var/www/";
    this._start();
  }

  _stop() {
    if (!this.running) return;

    this.running = false;
    this._syncUI();
    this.runSeq++;

    const ref = this.serverRef;
    this.serverRef = null;

    if (ref != null) {
      try {
        this.os.net.closeTCPServerSocket(ref);
      } catch (e) {
        this._append(`[${nowStamp()}] ERROR stop: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    this._append(`[${nowStamp()}] STOPPED`);
  }

  _ensureDocroot() {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;
    try {
      if (typeof fs.mkdir === "function") fs.mkdir(this.docRoot, { recursive: true });
    } catch { /* ignore */ }
  }

  _readFileText(path) {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return null;
    try {
      if (typeof fs.exists === "function" && !fs.exists(path)) return null;
      if (typeof fs.stat === "function") {
        const st = fs.stat(path);
        if (st?.type !== "file") return null;
      }
      if (typeof fs.readFile === "function") {
        const s = fs.readFile(path);
        return (typeof s === "string") ? s : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  _start() {
    if (this.running) return;

    this._ensureDocroot();

    let ref = null;
    try {
      ref = this.os.net.openTCPServerSocket(0, this.port); // bind 0.0.0.0
    } catch (e) {
      this._append(`[${nowStamp()}] ERROR openTCPServerSocket: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    this.serverRef = ref;
    this.running = true;
    this._syncUI();

    const seq = ++this.runSeq;
    this._append(`[${nowStamp()}] LISTEN :${this.port} (docRoot=${this.docRoot})`);

    this._acceptLoop(seq, ref);
  }

  /**
   * @param {number} seq
   * @param {number} ref
   */
  async _acceptLoop(seq, ref) {
    const timeout = this._timeoutMs();

    while (this.running && this.runSeq === seq && this.serverRef === ref) {
      /** @type {string|null} */
      let connKey = null;

      try {
        connKey = await this.os.net.acceptTCPConn(ref);
      } catch (e) {
        if (this.running && this.runSeq === seq) {
          this._append(`[${nowStamp()}] ERROR accept: ${e instanceof Error ? e.message : String(e)}`);
        }
        continue;
      }

      if (!this.running || this.runSeq !== seq || this.serverRef !== ref) break;
      if (connKey == null) {
        // listener closed
        break;
      }

      // handle connection concurrently
      this._handleConn(seq, connKey).catch((e) => {
        this._append(`[${nowStamp()}] ERROR conn: ${e instanceof Error ? e.message : String(e)}`);
        try { this.os.net.closeTCPConn(connKey); } catch { /* ignore */ }
      });
    }
  }

  /**
   * One request per connection, then close.
   * @param {number} seq
   * @param {string} connKey
   */
  async _handleConn(seq, connKey) {
    const ipf = this.os.net;
    const timeout = this._timeoutMs();

    // Read until header end
    const headerNeedle = encodeUTF8("\r\n\r\n");
    /** @type {Uint8Array[]} */
    const chunks = [];
    let total = 0;
    const limit = 64 * 1024;

    while (this.running && this.runSeq === seq) {
      const part = await withTimeout(ipf.recvTCPConn(connKey), timeout, "recv");
      if (part == null) break;

      chunks.push(part);
      total += part.length;

      if (total > limit) break;

      const buf = concatChunks(chunks);
      if (indexOfBytes(buf, headerNeedle) >= 0) break;
    }

    const buf = concatChunks(chunks);
    const idx = indexOfBytes(buf, headerNeedle);

    if (idx < 0) {
      const body = internalHtml("400 Bad Request", "Header Ende nicht gefunden oder Header > 64KiB.");
      const resp = buildResponse(400, "Bad Request", {
        "Date": new Date().toUTCString(),
        "Server": "SimpleHTTPServer/1.0",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(body.length),
        "Connection": "close",
      }, body);

      ipf.sendTCPConn(connKey, resp);
      ipf.closeTCPConn(connKey);
      return;
    }

    const headerText = decodeUTF8(buf.slice(0, idx));
    const lines = headerText.split("\r\n");
    const reqLine = lines[0] || "";

    const m = /^([A-Z]+)\s+(\S+)\s+HTTP\/1\.[01]$/.exec(reqLine);
    if (!m) {
      const body = internalHtml("400 Bad Request", `Ungültige Request-Line:\n${reqLine}`);
      const resp = buildResponse(400, "Bad Request", {
        "Date": new Date().toUTCString(),
        "Server": "SimpleHTTPServer/1.0",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(body.length),
        "Connection": "close",
      }, body);

      ipf.sendTCPConn(connKey, resp);
      ipf.closeTCPConn(connKey);
      return;
    }

    const method = m[1];
    const target = m[2];

    if (method !== "GET" && method !== "HEAD") {
      const body = internalHtml("405 Method Not Allowed", `Nur GET/HEAD sind unterstützt.\nDu hast gesendet: ${method}`);
      const resp = buildResponse(405, "Method Not Allowed", {
        "Date": new Date().toUTCString(),
        "Server": "SimpleHTTPServer/1.0",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(body.length),
        "Connection": "close",
      }, body);

      ipf.sendTCPConn(connKey, resp);
      ipf.closeTCPConn(connKey);
      this._append(`[${nowStamp()}] 405 ${method} ${target}`);
      return;
    }

    // map URL -> file
    let norm = normalizeUrlPath(target);
    if (norm.endsWith("/")) norm += "index.html";

    const fsPath = joinDocroot(this.docRoot, norm);
    const text = this._readFileText(fsPath);

    if (text == null) {
      const body = internalHtml("404 Not Found", `Datei nicht gefunden:\n${norm}\n\nFS-Pfad:\n${fsPath}`);
      const resp = buildResponse(404, "Not Found", {
        "Date": new Date().toUTCString(),
        "Server": "SimpleHTTPServer/1.0",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(body.length),
        "Connection": "close",
      }, body);

      ipf.sendTCPConn(connKey, resp);
      ipf.closeTCPConn(connKey);
      this._append(`[${nowStamp()}] 404 ${method} ${norm}`);
      return;
    }

    const data = encodeUTF8(text);
    const ct = contentTypeOf(fsPath);
    const body = (method === "HEAD") ? new Uint8Array(0) : data;

    const resp = buildResponse(200, "OK", {
      "Date": new Date().toUTCString(),
      "Server": "SimpleHTTPServer/1.0",
      "Content-Type": ct,
      "Content-Length": String(data.length),
      "Connection": "close",
    }, body);

    ipf.sendTCPConn(connKey, resp);
    ipf.closeTCPConn(connKey);
    this._append(`[${nowStamp()}] 200 ${method} ${norm} (${data.length} bytes)`);
  }
}
