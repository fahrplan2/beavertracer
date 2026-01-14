//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { SimControl } from "../SimControl.js";

//@ts-ignore Import ist raw für vite
import startPage from "./assets/about-start.html?raw";
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
 * Accepts:
 *  - dotted IPv4 "1.2.3.4"
 *  - raw uint32 in decimal "3232235521"
 *  - anything else -> DNS resolve
 * @param {string} host
 * @param {(name:string)=>Promise<number>} dnsResolve
 */
async function resolveHostToIP(host, dnsResolve) {
  const s = host.trim();

  // raw uint32
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) return n >>> 0;
  }

  // dotted IPv4
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m) {
    const a = Number(m[1]),
      b = Number(m[2]),
      c = Number(m[3]),
      d = Number(m[4]);
    if ([a, b, c, d].every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) {
      return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
    }
  }

  return await dnsResolve(s);
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
 * Minimal URL parser for http:// only.
 * Supports:
 *  - http://host
 *  - http://host/
 *  - http://host:port/path?query
 * @param {string} url
 */
function parseHttpUrl(url) {
  const s = url.trim();
  if (!s.toLowerCase().startsWith("http://")) {
    return { ok: false, error: t("app.sparktail.err.onlyHttp") };
  }

  const rest = s.slice("http://".length);
  const slash = rest.indexOf("/");
  const authority = slash >= 0 ? rest.slice(0, slash) : rest;
  const path = slash >= 0 ? rest.slice(slash) : "/";

  if (!authority) return { ok: false, error: t("app.sparktail.err.missingHostInUrl") };

  // host:port?
  let host = authority;
  let port = 80;

  const colon = authority.lastIndexOf(":");
  if (colon > 0 && colon < authority.length - 1) {
    const maybePort = authority.slice(colon + 1);
    if (/^\d+$/.test(maybePort)) {
      const p = Number(maybePort);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) {
        host = authority.slice(0, colon);
        port = p;
      }
    }
  }

  host = host.trim();
  if (!host) return { ok: false, error: t("app.sparktail.err.hostEmpty") };

  return { ok: true, host, port, path };
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
 * Small helper to search for a byte pattern in a Uint8Array.
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
 * Parse HTTP headers into a map-like object (lowercased keys).
 * @param {string} headerText
 */
function parseHeaders(headerText) {
  /** @type {Record<string,string>} */
  const headers = {};
  const lines = headerText.split("\r\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const k = line.indexOf(":");
    if (k <= 0) continue;
    const key = line.slice(0, k).trim().toLowerCase();
    const val = line.slice(k + 1).trim();
    if (!key) continue;
    if (headers[key]) headers[key] = headers[key] + ", " + val;
    else headers[key] = val;
  }
  return headers;
}

/**
 * Promise wrapper with timeout in ms.
 * @template T
 * @param {Promise<T>} p
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const tmr = setTimeout(
      () => reject(new Error(t("app.sparktail.err.timeout", { label, ms }))),
      Math.max(0, ms | 0)
    );
    p.then(
      (v) => {
        clearTimeout(tmr);
        resolve(v);
      },
      (e) => {
        clearTimeout(tmr);
        reject(e);
      }
    );
  });
}

/**
 * @param {Record<string,string>} headers
 */
function isHtml(headers) {
  const ct = (headers["content-type"] || "").toLowerCase();
  return ct.includes("text/html") || ct.includes("application/xhtml+xml");
}

/**
 * Create a simple internal HTML error page.
 * @param {string} title
 * @param {string} bodyText
 */
function internalErrorPage(title, bodyText) {
  /** @param {string} s */
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="font-family: system-ui, sans-serif; padding: 16px;">
  <h1>${esc(title)}</h1>
  <pre style="white-space: pre-wrap; background: #111; color: #eee; padding: 12px; border-radius: 8px;">${esc(
    bodyText
  )}</pre>
</body></html>`;
}

/**
 * Normalize user input:
 * - allow about:* untouched
 * - allow http:// untouched
 * - otherwise prefix http://
 * @param {string} input
 */
function normalizeUrlInput(input) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (low.startsWith("about:")) return s;
  if (low.startsWith("http://")) return s;
  return "http://" + s;
}

// Helper: buffered TCP reader on top of recvTCPConn (stream semantics)
class TcpBufferedReader {
  /**
   * @param {{
   *   recv: () => Promise<Uint8Array|null>,
   *   isCancelled: () => boolean,
   *   timeoutMs: number
   * }} opt
   */
  constructor(opt) {
    this._recv = opt.recv;
    this._isCancelled = opt.isCancelled;
    this._timeoutMs = opt.timeoutMs;

    /** @type {Uint8Array} */
    this.buf = new Uint8Array(0);

    /** @type {boolean} */
    this.closed = false;
  }

  /** @param {Uint8Array} chunk */
  _append(chunk) {
    if (chunk.length === 0) return;
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
  }

  /** @returns {Promise<void>} */
  async _fill() {
    if (this.closed) return;
    if (this._isCancelled()) throw new Error(t("app.sparktail.err.cancelled"));

    const chunk = await withTimeout(this._recv(), this._timeoutMs, t("app.sparktail.label.recv"));
    if (chunk == null) {
      this.closed = true;
      return;
    }
    this._append(chunk);
  }

  /**
   * Read until delimiter occurs (delimiter included).
   * @param {Uint8Array} needle
   * @param {number} maxBytes
   * @returns {Promise<Uint8Array>}
   */
  async readUntil(needle, maxBytes = 2 * 1024 * 1024) {
    while (true) {
      const idx = indexOfBytes(this.buf, needle);
      if (idx >= 0) {
        const end = idx + needle.length;
        const out = this.buf.subarray(0, end);
        this.buf = this.buf.subarray(end);
        return out;
      }
      if (this.buf.length > maxBytes) throw new Error(t("app.sparktail.err.readUntilExceeded", { maxBytes }));
      await this._fill();
      if (this.closed) throw new Error(t("app.sparktail.err.eof"));
    }
  }

  /**
   * Read exactly n bytes (throws on EOF).
   * @param {number} n
   * @returns {Promise<Uint8Array>}
   */
  async readExactly(n) {
    while (this.buf.length < n) {
      await this._fill();
      if (this.closed) throw new Error(t("app.sparktail.err.eof"));
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  /**
   * Read a CRLF-terminated line, returning bytes excluding CRLF.
   * @param {number} maxLineBytes
   * @returns {Promise<Uint8Array>}
   */
  async readLine(maxLineBytes = 64 * 1024) {
    const CRLF = encodeUTF8("\r\n");
    const block = await this.readUntil(CRLF, maxLineBytes + 2);
    return block.subarray(0, block.length - 2);
  }

  /**
   * Read until remote closes (fallback).
   * @param {number} limit
   * @returns {Promise<Uint8Array>}
   */
  async readToClose(limit = 2 * 1024 * 1024) {
    while (!this.closed) {
      if (this.buf.length > limit) throw new Error(t("app.sparktail.err.bodyTooLarge"));
      await this._fill();
    }
    const out = this.buf;
    this.buf = new Uint8Array(0);
    return out;
  }
}

export class SparktailHTTPClientApp extends GenericProcess {
  get title() {
    return t("app.sparktail.title");
  }

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {string} */
  url = "about:start";

  /** @type {boolean} */
  loading = false;

  /** @type {string|null} */
  connKey = null;

  /** @type {Array<string>} */
  log = [];

  /** @type {HTMLElement|null} */
  logEl = null;

  /** @type {HTMLInputElement|null} */
  urlEl = null;

  /** @type {HTMLButtonElement|null} */
  goBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;

  /** @type {HTMLButtonElement|null} */
  backBtn = null;

  /** @type {HTMLButtonElement|null} */
  fwdBtn = null;

  /** @type {HTMLButtonElement|null} */
  reloadBtn = null;

  /** @type {HTMLElement|null} */
  throbberEl = null;

  /** @type {HTMLElement|null} */
  statusEl = null;

  /** @type {HTMLIFrameElement|null} */
  previewFrame = null;

  /** @type {HTMLTextAreaElement|null} */
  sourceEl = null;

  /** @type {HTMLTextAreaElement|null} */
  headersEl = null;

  /** @type {"preview"|"source"|"headers"|"log"} */
  tab = "preview";

  /** @type {number} */
  requestSeq = 0;

  /** @type {string[]} */
  history = [];

  /** @type {number} */
  historyIndex = -1;

  run() {
    this.root.classList.add("app", "app-sparktail-http");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const urlInput = UI.input({
      placeholder: t("app.sparktail.placeholder.url"),
      value: String(this.url),
    });
    this.urlEl = urlInput;

    urlInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") this._goFromUI();
    });

    /** @type {HTMLButtonElement} */
    const back = UI.button(t("app.sparktail.button.back"), () => this._navTo(this.historyIndex - 1), {});
    /** @type {HTMLButtonElement} */
    const fwd = UI.button(t("app.sparktail.button.forward"), () => this._navTo(this.historyIndex + 1), {});
    /** @type {HTMLButtonElement} */
    const reload = UI.button(
      t("app.sparktail.button.reload"),
      () => {
        const u = (this.urlEl?.value ?? this.url).trim();
        if (u) this._navigate(normalizeUrlInput(u), false /* already in history */);
      },
      {}
    );
    this.backBtn = back;
    this.fwdBtn = fwd;
    this.reloadBtn = reload;

    /** @type {HTMLButtonElement} */
    const go = UI.button(t("app.sparktail.button.go"), () => this._goFromUI(), { primary: true });
    /** @type {HTMLButtonElement} */
    const stop = UI.button(t("app.sparktail.button.stop"), () => this._stop(), {});
    this.goBtn = go;
    this.stopBtn = stop;

    const throbber = UI.el("div", { className: "sparktail-throbber" });
    this.throbberEl = throbber;

    const status = UI.el("div", { className: "msg sparktail-status" });
    this.statusEl = status;

    // Tabs (devtools-ish)
    const tabRow = UI.buttonRow([
      UI.button(t("app.sparktail.tab.preview"), () => { this.tab = "preview"; this._renderTab(); }, {}),
      UI.button(t("app.sparktail.tab.source"), () => { this.tab = "source"; this._renderTab(); }, {}),
      UI.button(t("app.sparktail.tab.headers"), () => { this.tab = "headers"; this._renderTab(); }, {}),
      UI.button(t("app.sparktail.tab.log"), () => { this.tab = "log"; this._renderTab(); }, {}),
      UI.button(t("app.sparktail.button.clearLog"), () => { this.log = []; this._renderLog(); }, {}),
    ]);

    // Content areas
    const iframe = /** @type {HTMLIFrameElement} */ (UI.el("iframe", {
      className: "sparktail-preview",
      //@ts-ignore
      sandbox: "allow-forms allow-pointer-lock allow-popups-to-escape-sandbox", // external default: no scripts
    }));
    iframe.style.width = "100%";
    iframe.style.height = "420px";
    iframe.style.border = "1px solid #444";
    iframe.style.borderRadius = "12px";
    this.previewFrame = iframe;

    const source = /** @type {HTMLTextAreaElement} */ (UI.el("textarea", { className: "sparktail-source" }));
    source.readOnly = true;
    source.style.width = "100%";
    source.style.height = "420px";
    this.sourceEl = source;

    const headersTA = /** @type {HTMLTextAreaElement} */ (UI.el("textarea", { className: "sparktail-headers" }));
    headersTA.readOnly = true;
    headersTA.style.width = "100%";
    headersTA.style.height = "420px";
    this.headersEl = headersTA;

    const logBox = UI.el("div", { className: "msg sparktail-log" });
    this.logEl = logBox;

    const content = UI.el("div", {});
    content.appendChild(iframe);
    content.appendChild(source);
    content.appendChild(headersTA);
    content.appendChild(logBox);

    // Browser-ish chrome bar
    const chromeBar = UI.el("div", { className: "sparktail-chrome" });
    chromeBar.appendChild(back);
    chromeBar.appendChild(fwd);
    chromeBar.appendChild(reload);
    chromeBar.appendChild(urlInput);
    chromeBar.appendChild(go);
    chromeBar.appendChild(stop);
    chromeBar.appendChild(throbber);

    const panel = UI.panel([chromeBar, content, tabRow, status]);
    this.root.replaceChildren(panel);

    // Listen for internal page navigation (about:start links)
    const onMsg = (ev) => {
      const d = ev?.data;
      if (!d || d.__sparktail !== true) return;
      if (d.type === "navigate" && typeof d.url === "string") {
        const u = normalizeUrlInput(d.url);
        if (!u) return;
        if (this.urlEl) this.urlEl.value = u;
        this._navigate(u, true);
      }
    };
    window.addEventListener("message", onMsg);
    this.disposer.add(() => window.removeEventListener("message", onMsg));

    // initialize history with initial url
    this._pushHistory(this.url);

    this._syncUI();
    this._renderTab();
    this._renderLog();
    this._setStatus(t("app.sparktail.status.ready"));

    // show start page immediately
    this._fetchUrl(this.url);

    // throbber tick
    this.disposer.interval(() => {
      if (!this.throbberEl) return;
      this.throbberEl.textContent = this.loading ? t("app.sparktail.throbber.loading") : "";
    }, 120);
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl = null;
    this.urlEl = null;
    this.goBtn = null;
    this.stopBtn = null;
    this.backBtn = null;
    this.fwdBtn = null;
    this.reloadBtn = null;
    this.throbberEl = null;
    this.statusEl = null;
    this.previewFrame = null;
    this.sourceEl = null;
    this.headersEl = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    super.destroy();
  }

  _setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = String(text ?? "");
  }

  _syncNavButtons() {
    if (this.backBtn) this.backBtn.disabled = this.loading || this.historyIndex <= 0;
    if (this.fwdBtn) this.fwdBtn.disabled = this.loading || this.historyIndex >= this.history.length - 1;
    if (this.reloadBtn) this.reloadBtn.disabled = this.loading || this.historyIndex < 0;
  }

  _syncUI() {
    const busy = this.loading;
    if (this.goBtn) this.goBtn.disabled = busy;
    if (this.stopBtn) this.stopBtn.disabled = !busy;
    if (this.urlEl) this.urlEl.disabled = busy;
    this._syncNavButtons();
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

  _renderTab() {
    if (this.previewFrame) this.previewFrame.style.display = this.tab === "preview" ? "" : "none";
    if (this.sourceEl) this.sourceEl.style.display = this.tab === "source" ? "" : "none";
    if (this.headersEl) this.headersEl.style.display = this.tab === "headers" ? "" : "none";
    if (this.logEl) this.logEl.style.display = this.tab === "log" ? "" : "none";
  }

  _pushHistory(url) {
    // If we are mid-history, truncate forward entries
    if (this.historyIndex < this.history.length - 1) {
      this.history.splice(this.historyIndex + 1);
    }
    this.history.push(url);
    this.historyIndex = this.history.length - 1;
    this._syncNavButtons();
  }

  _navTo(index) {
    if (index < 0 || index >= this.history.length) return;
    const url = this.history[index];
    this.historyIndex = index;
    if (this.urlEl) this.urlEl.value = url;
    this.url = url;
    this._syncNavButtons();
    this._fetchUrl(url);
  }

  _goFromUI() {
    const raw = (this.urlEl?.value ?? "").trim();
    if (!raw) {
      this._append(t("app.sparktail.log.urlEmpty", { time: nowStamp() }));
      this._setStatus(t("app.sparktail.status.errorUrlEmpty"));
      return;
    }

    const u = normalizeUrlInput(raw);
    this.url = u;
    if (this.urlEl) this.urlEl.value = u;

    // Only add to history if it differs from current entry
    const cur = this.historyIndex >= 0 ? this.history[this.historyIndex] : null;
    if (cur !== u) this._pushHistory(u);

    this._fetchUrl(u);
  }

  /**
   * Navigate programmatically (used by about:start links).
   * @param {string} url
   * @param {boolean} pushHistory
   */
  _navigate(url, pushHistory) {
    const u = normalizeUrlInput(url);
    if (!u) return;
    this.url = u;

    if (pushHistory) {
      const cur = this.historyIndex >= 0 ? this.history[this.historyIndex] : null;
      if (cur !== u) this._pushHistory(u);
    }

    this._fetchUrl(u);
  }

  _stop() {
    // cancels current request by bumping seq and closing conn
    this.requestSeq++;
    this.loading = false;
    this._syncUI();

    const key = this.connKey;
    this.connKey = null;
    if (key) {
      try {
        this.os.net.closeTCPConn(key);
      } catch {
        /* ignore */
      }
    }
    this._append(t("app.sparktail.log.stop", { time: nowStamp() }));
    this._setStatus(t("app.sparktail.status.stopped"));
  }

  /**
   * @returns {number} timeout in ms
   */
  _timeoutMs() {
    const tick = SimControl?.tick ?? 10;
    return Math.max(1, 60 * (tick | 0));
  }

  /**
   * External pages: no scripts
   * Internal pages (about:*): allow scripts so start page can postMessage
   * @param {boolean} allowScripts
   */
  _setIframePolicy(allowScripts) {
    if (!this.previewFrame) return;
    if (allowScripts) {
      // for about:* pages only
      this.previewFrame.setAttribute(
        "sandbox",
        "allow-scripts allow-forms allow-pointer-lock allow-popups-to-escape-sandbox"
      );
    } else {
      // for external content
      this.previewFrame.setAttribute("sandbox", "allow-forms allow-pointer-lock allow-popups-to-escape-sandbox");
    }
  }

  /**
   * @param {string} url
   */
  async _fetchUrl(url) {
    if (this.loading) return;

    const seq = ++this.requestSeq;
    this.loading = true;
    this._syncUI();

    // reset views
    if (this.sourceEl) this.sourceEl.value = "";
    if (this.headersEl) this.headersEl.value = "";
    this.tab = "preview";
    this._renderTab();
    this._setStatus(t("app.sparktail.status.loading", { url }));

    // about:* pages are internal
    const utrim = url.trim();
    if (utrim.toLowerCase() === "about:start") {
      this._showStartPage();
      this._append(t("app.sparktail.log.aboutStart", { time: nowStamp() }));
      this._setStatus(t("app.sparktail.status.startPage"));
      this.loading = false;
      this._syncUI();
      return;
    }

    // external policy
    this._setIframePolicy(false);

    const parsed = parseHttpUrl(url);
    if (!parsed.ok) {
      this._showInternalPage(t("app.sparktail.page.invalidUrl.title"), parsed.error);
      this.loading = false;
      this._syncUI();
      this._setStatus(t("app.sparktail.status.invalidUrl", { error: parsed.error }));
      return;
    }

    const { host, port, path } = parsed;
    const timeout = this._timeoutMs();
    const bodyLimit = 1_048_576;

    /** @type {(name:string)=>Promise<number>} */
    const dnsResolve = async (name) => {
      return await this.os.dns.resolve(name);
    };

    let dstIP = 0;
    try {
      dstIP = await withTimeout(resolveHostToIP(host, dnsResolve), timeout*SimControl.tick, t("app.sparktail.label.dns"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._append(t("app.sparktail.log.dnsError", { time: nowStamp(), host, msg }));
      this._showInternalPage(
        t("app.sparktail.page.dnsError.title"),
        t("app.sparktail.page.dnsError.body", { host, msg })
      );
      this.loading = false;
      this._syncUI();
      this._setStatus(t("app.sparktail.status.dnsError", { host }));
      return;
    }

    /** @type {string|null} */
    let key = null;

    try {
      const conn = await withTimeout(this.os.net.connectTCPConn(dstIP, port), timeout, t("app.sparktail.label.connect"));
      key = conn?.key;
      if (typeof key !== "string" || !key) throw new Error(t("app.sparktail.err.noConnKey"));
      this.connKey = key;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._append(t("app.sparktail.log.connectError", { time: nowStamp(), ip: ipToString(dstIP), port, msg }));
      this._showInternalPage(
        t("app.sparktail.page.socketError.title"),
        t("app.sparktail.page.socketError.body", { host, port, msg })
      );
      this.loading = false;
      this.connKey = null;
      this._syncUI();
      this._setStatus(t("app.sparktail.status.socketError", { host, port }));
      return;
    }

    const request =
      `GET ${path} HTTP/1.1\r\n` +
      `Host: ${host}${port !== 80 ? `:${port}` : ""}\r\n` +
      `User-Agent: Sparktail/1.0\r\n` +
      `Accept: text/html, text/plain, */*\r\n` +
      `Connection: close\r\n` +
      `\r\n`;

    const reqBytes = encodeUTF8(request);
    try {
      this.os.net.sendTCPConn(key, reqBytes);
      this._append(t("app.sparktail.log.request", {
        time: nowStamp(),
        host,
        port,
        path,
        len: reqBytes.length,
        hex: hexPreview(reqBytes),
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._append(t("app.sparktail.log.sendError", { time: nowStamp(), msg }));
      this._showInternalPage(t("app.sparktail.page.sendError.title"), msg);
      this._stop();
      return;
    }

    /** @type {string} */
    let headerText = "";
    /** @type {Record<string,string>} */
    let headers = {};
    /** @type {Uint8Array} */
    let bodyBytes = new Uint8Array(0);
    /** @type {number} */
    let statusCode = 0;
    /** @type {string} */
    let reason = "";

    try {
      const r = new TcpBufferedReader({
        recv: () => this.os.net.recvTCPConn(key),
        isCancelled: () => !this.loading || this.requestSeq !== seq || this.connKey !== key,
        timeoutMs: timeout,
      });

      // 1) Read headers
      const headerSep = encodeUTF8("\r\n\r\n");
      const headerBlock = await r.readUntil(headerSep, 2 * 1024 * 1024);
      const headerBytes = headerBlock.subarray(0, headerBlock.length - 4);

      headerText = decodeUTF8(headerBytes);
      const firstLineEnd = headerText.indexOf("\r\n");
      const statusLine = firstLineEnd >= 0 ? headerText.slice(0, firstLineEnd) : headerText;

      const m = /^HTTP\/\d+\.\d+\s+(\d{3})\s*(.*)$/.exec(statusLine);
      statusCode = m ? Number(m[1]) : 0;
      reason = m ? (m[2] || "").trim() : "";

      headers = parseHeaders(headerText);
      if (this.headersEl) this.headersEl.value = headerText;

      // 2) Read body depending on headers
      const te = (headers["transfer-encoding"] || "").toLowerCase();
      const cl = headers["content-length"];

      if (te.includes("chunked")) {
        /** @type {Uint8Array[]} */
        const out = [];
        let total = 0;

        while (true) {
          const lineBytes = await r.readLine(64 * 1024);
          const line = decodeUTF8(lineBytes).trim();
          const semi = line.indexOf(";");
          const hex = (semi >= 0 ? line.slice(0, semi) : line).trim();

          if (!/^[0-9a-fA-F]+$/.test(hex)) {
            throw new Error(t("app.sparktail.err.chunkedInvalidChunkSize", { line }));
          }
          const size = parseInt(hex, 16);
          if (!Number.isFinite(size) || size < 0) {
            throw new Error(t("app.sparktail.err.chunkedInvalidSize", { hex }));
          }

          if (size === 0) {
            // Trailer headers until empty line
            while (true) {
              const tline = await r.readLine(64 * 1024);
              if (tline.length === 0) break;
            }
            break;
          }

          const chunk = await r.readExactly(size);
          out.push(chunk);
          total += chunk.length;
          if (total > bodyLimit) throw new Error(t("app.sparktail.err.bodyLimitExceeded", { bodyLimit }));

          const crlf = await r.readExactly(2);
          if (crlf[0] !== 13 || crlf[1] !== 10) throw new Error(t("app.sparktail.err.chunkedMissingCrlf"));
        }

        bodyBytes = concatChunks(out);
      } else if (cl && /^\d+$/.test(cl.trim())) {
        const want = Number(cl.trim());
        if (!Number.isFinite(want) || want < 0) throw new Error(t("app.sparktail.err.invalidContentLength"));
        if (want > bodyLimit) throw new Error(t("app.sparktail.err.bodyLimitExceeded", { bodyLimit }));

        bodyBytes = await r.readExactly(want);
      } else {
        // Fallback: no length known. Read until close.
        bodyBytes = await r.readToClose(bodyLimit + 256 * 1024);
        if (bodyBytes.length > bodyLimit) throw new Error(t("app.sparktail.err.bodyLimitExceeded", { bodyLimit }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._append(t("app.sparktail.log.recvError", { time: nowStamp(), msg }));
      this._showInternalPage(t("app.sparktail.page.recvError.title"), msg);
      this._stop();
      return;
    } finally {
      // Close conn (best effort)
      if (key) {
        try {
          this.os.net.closeTCPConn(key);
        } catch {
          /* ignore */
        }
      }
      if (this.connKey === key) this.connKey = null;
    }

    // If cancelled, stop quietly
    if (!this.loading || this.requestSeq !== seq) return;

    // Render / display
    if (bodyBytes.length > bodyLimit) {
      this._showInternalPage(
        t("app.sparktail.page.bodyTooLarge.title"),
        t("app.sparktail.page.bodyTooLarge.body", { bytes: bodyBytes.length, bodyLimit })
      );
      this.loading = false;
      this._syncUI();
      this._setStatus(t("app.sparktail.status.bodyTooLarge", { statusCode }));
      return;
    }

    const bodyText = decodeUTF8(bodyBytes);

    if (statusCode !== 200 && statusCode !== 404) {
      this._append(t("app.sparktail.log.httpNotRendered", { time: nowStamp(), statusCode, reason }));
      this._showInternalPage(
        t("app.sparktail.page.notSupported.title"),
        t("app.sparktail.page.notSupported.body", { statusCode, reason })
      );
      if (this.sourceEl) this.sourceEl.value = bodyText;

      const ct = headers["content-type"] || t("app.sparktail.value.unknown");
      this._setStatus(t("app.sparktail.status.httpSummary", { statusCode, reason, bytes: bodyBytes.length, ct }));

      this.loading = false;
      this._syncUI();
      return;
    }

    if (this.sourceEl) this.sourceEl.value = bodyText;

    if (this.previewFrame) {
      if (isHtml(headers)) {
        this.previewFrame.srcdoc = bodyText;
      } else {
        this.previewFrame.srcdoc = internalErrorPage(
          t("app.sparktail.page.nonHtml.title", { statusCode }),
          t("app.sparktail.page.nonHtml.body", {
            ct: headers["content-type"] || t("app.sparktail.value.unknown"),
          })
        );
      }
    }

    const ct = headers["content-type"] || t("app.sparktail.value.unknown");
    this._append(t("app.sparktail.log.httpOk", { time: nowStamp(), statusCode, reason, bytes: bodyBytes.length }));
    this._setStatus(t("app.sparktail.status.httpSummary", { statusCode, reason, bytes: bodyBytes.length, ct }));

    this.loading = false;
    this._syncUI();
  }

  /**
   * @param {string} title
   * @param {string} text
   */
  _showInternalPage(title, text) {
    // internal pages may use scripts? not needed here, keep it strict
    this._setIframePolicy(false);
    if (this.previewFrame) this.previewFrame.srcdoc = internalErrorPage(title, text);
    if (this.sourceEl) this.sourceEl.value = "";
    if (this.headersEl) this.headersEl.value = "";
    this.tab = "preview";
    this._renderTab();
  }

  _showStartPage() {
    this._setIframePolicy(true); // allow scripts for about:start so links can postMessage
    const html = startPage;
    if (this.previewFrame) this.previewFrame.srcdoc = html;
    if (this.sourceEl) this.sourceEl.value = html;
    if (this.headersEl) this.headersEl.value = t("app.sparktail.headers.aboutStart");
    this.tab = "preview";
    this._renderTab();
  }
}
