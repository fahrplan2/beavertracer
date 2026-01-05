//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "./lib/Disposer.js";
import { SimControl } from "../SimControl.js";


//@ts-ignore   Import ist raw für vite
import startPage from "./assets/about-start.html?raw"
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
        const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
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
        return { ok: false, error: "Nur http:// ist erlaubt (kein https://)." };
    }

    const rest = s.slice("http://".length);
    const slash = rest.indexOf("/");
    const authority = slash >= 0 ? rest.slice(0, slash) : rest;
    const path = slash >= 0 ? rest.slice(slash) : "/";

    if (!authority) return { ok: false, error: "Host fehlt in der URL." };

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
    if (!host) return { ok: false, error: "Host ist leer." };

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
 * Decode chunked transfer encoding. Returns {ok, body, error}
 * @param {Uint8Array} data
 */
function decodeChunkedBody(data) {
    // data = chunk-stream bytes (may include trailer headers; we ignore trailers)
    let i = 0;
    /** @type {Uint8Array[]} */
    const out = [];

    const CR = 13, LF = 10;

    function readLine() {
        // returns bytes until CRLF (excluding)
        const start = i;
        while (i + 1 < data.length) {
            if (data[i] === CR && data[i + 1] === LF) {
                const line = data.slice(start, i);
                i += 2;
                return line;
            }
            i++;
        }
        return null;
    }

    while (true) {
        const lineBytes = readLine();
        if (lineBytes == null) return { ok: false, body: new Uint8Array(0), error: "Chunked parse: unvollständige Chunk-Size Zeile." };

        const line = decodeUTF8(lineBytes).trim();
        const semi = line.indexOf(";");
        const hex = (semi >= 0 ? line.slice(0, semi) : line).trim();
        if (!/^[0-9a-fA-F]+$/.test(hex)) {
            return { ok: false, body: new Uint8Array(0), error: `Chunked parse: ungültige Chunk-Size "${line}".` };
        }
        const size = parseInt(hex, 16);
        if (!Number.isFinite(size) || size < 0) {
            return { ok: false, body: new Uint8Array(0), error: `Chunked parse: ungültige Größe (${hex}).` };
        }
        if (size === 0) {
            // Trailer headers until CRLF CRLF — we can ignore; but consume if present
            // We'll stop here.
            break;
        }
        if (i + size > data.length) {
            return { ok: false, body: new Uint8Array(0), error: "Chunked parse: Chunk-Daten unvollständig." };
        }
        out.push(data.slice(i, i + size));
        i += size;

        // expect CRLF after chunk data
        if (i + 1 >= data.length || data[i] !== CR || data[i + 1] !== LF) {
            return { ok: false, body: new Uint8Array(0), error: "Chunked parse: CRLF nach Chunk fehlt." };
        }
        i += 2;
    }

    return { ok: true, body: concatChunks(out), error: "" };
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
        const t = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), Math.max(0, ms | 0));
        p.then(
            (v) => { clearTimeout(t); resolve(v); },
            (e) => { clearTimeout(t); reject(e); }
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
    const esc = (s) => String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="font-family: system-ui, sans-serif; padding: 16px;">
  <h1>${esc(title)}</h1>
  <pre style="white-space: pre-wrap; background: #111; color: #eee; padding: 12px; border-radius: 8px;">${esc(bodyText)}</pre>
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

export class SparktailHTTPClientApp extends GenericProcess {

    title = t("app.sparktail.title");

    /** @type {Disposer} */
    bag = new Disposer();

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
        this.bag.dispose();

        const urlInput = UI.input({ placeholder: "about:start oder http://host[:port]/path", value: String(this.url) });
        this.urlEl = urlInput;

        urlInput.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") this._goFromUI();
        });

        /** @type {HTMLButtonElement} */
        const back = UI.button("←", () => this._navTo(this.historyIndex - 1), {});
        /** @type {HTMLButtonElement} */
        const fwd = UI.button("→", () => this._navTo(this.historyIndex + 1), {});
        /** @type {HTMLButtonElement} */
        const reload = UI.button("⟳", () => {
            const u = (this.urlEl?.value ?? this.url).trim();
            if (u) this._navigate(normalizeUrlInput(u), false /* already in history */);
        }, {});
        this.backBtn = back;
        this.fwdBtn = fwd;
        this.reloadBtn = reload;

        /** @type {HTMLButtonElement} */
        const go = UI.button("Go", () => this._goFromUI(), { primary: true });
        /** @type {HTMLButtonElement} */
        const stop = UI.button("Stop", () => this._stop(), {});
        this.goBtn = go;
        this.stopBtn = stop;

        const throbber = UI.el("div", { className: "sparktail-throbber" });
        this.throbberEl = throbber;

        const status = UI.el("div", { className: "msg sparktail-status" });
        this.statusEl = status;

        // Tabs (devtools-ish)
        const tabRow = UI.buttonRow([
            UI.button("Preview", () => { this.tab = "preview"; this._renderTab(); }, {}),
            UI.button("Source", () => { this.tab = "source"; this._renderTab(); }, {}),
            UI.button("Headers", () => { this.tab = "headers"; this._renderTab(); }, {}),
            UI.button("Log", () => { this.tab = "log"; this._renderTab(); }, {}),
            UI.button("Clear Log", () => { this.log = []; this._renderLog(); }, {}),
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

        const panel = UI.panel([
            chromeBar,
            content,
            tabRow,
            status,
        ]);

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
        this.bag.add(() => window.removeEventListener("message", onMsg));

        // initialize history with initial url
        this._pushHistory(this.url);

        this._syncUI();
        this._renderTab();
        this._renderLog();
        this._setStatus("Bereit.");

        // show start page immediately
        this._fetchUrl(this.url);

        // throbber tick
        this.bag.interval(() => {
            if (!this.throbberEl) return;
            this.throbberEl.textContent = this.loading ? "⏳" : "";
        }, 120);
    }

    onUnmount() {
        this.bag.dispose();
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
            this._append(`[${nowStamp()}] ERROR URL ist leer`);
            this._setStatus("Fehler: URL ist leer.");
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
            try { this.os.net.closeTCPConn(key); } catch { /* ignore */ }
        }
        this._append(`[${nowStamp()}] STOP`);
        this._setStatus("Stopp.");
    }

    /**
     * @returns {number} timeout in ms
     */
    _timeoutMs() {
        const tick = (SimControl?.tick ?? 10);
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
            this.previewFrame.setAttribute("sandbox", "allow-scripts allow-forms allow-pointer-lock allow-popups-to-escape-sandbox");
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
        this._setStatus(`Lade: ${url}`);

        // about:* pages are internal
        const utrim = url.trim();
        if (utrim.toLowerCase() === "about:start") {
            this._showStartPage();
            this._append(`[${nowStamp()}] about:start`);
            this._setStatus("Startseite.");
            this.loading = false;
            this._syncUI();
            return;
        }

        // external policy
        this._setIframePolicy(false);

        const parsed = parseHttpUrl(url);
        if (!parsed.ok) {
            this._showInternalPage("Ungültige URL", parsed.error);
            this.loading = false;
            this._syncUI();
            this._setStatus(`Ungültige URL: ${parsed.error}`);
            return;
        }

        const { host, port, path } = parsed;
        const timeout = this._timeoutMs();
        const bodyLimit = 1_048_576;

        /** @type {(name:string)=>Promise<number>} */
        const dnsResolve = async (name) => {
            const anyThis = /** @type {any} */ (this);
            if (anyThis.dns && typeof anyThis.dns.resolve === "function") {
                return await anyThis.dns.resolve(name);
            }
            throw new Error(`DNS nicht verfügbar (kann "${name}" nicht auflösen)`);
        };

        let dstIP = 0;
        try {
            dstIP = await withTimeout(resolveHostToIP(host, dnsResolve), timeout, "DNS");
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this._append(`[${nowStamp()}] ERROR DNS "${host}": ${msg}`);
            this._showInternalPage("DNS Fehler", `Host "${host}" konnte nicht aufgelöst werden.\n\n${msg}`);
            this.loading = false;
            this._syncUI();
            this._setStatus(`DNS Fehler: ${host}`);
            return;
        }

        /** @type {string|null} */
        let key = null;

        try {
            const conn = await withTimeout(this.os.net.connectTCPConn(dstIP, port), timeout, "Connect");
            key = conn?.key;
            if (typeof key !== "string" || !key) throw new Error("connectTCPConn lieferte keinen connection key");
            this.connKey = key;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this._append(`[${nowStamp()}] ERROR connect ${ipToString(dstIP)}:${port}: ${msg}`);
            this._showInternalPage("Socket Fehler", `Verbindung zu ${host}:${port} fehlgeschlagen.\n\n${msg}`);
            this.loading = false;
            this.connKey = null;
            this._syncUI();
            this._setStatus(`Socket Fehler: ${host}:${port}`);
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
            this._append(`[${nowStamp()}] -> ${host}:${port} GET ${path} (len=${reqBytes.length} hex=${hexPreview(reqBytes)})`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this._append(`[${nowStamp()}] ERROR send: ${msg}`);
            this._showInternalPage("Send Fehler", msg);
            this._stop();
            return;
        }

        /** @type {Uint8Array[]} */
        const chunks = [];
        let total = 0;

        try {
            while (this.loading && this.requestSeq === seq && this.connKey === key) {
                const data = await withTimeout(this.os.net.recvTCPConn(key), timeout, "Recv");
                if (data == null) break; // remote closed

                chunks.push(data);
                total += data.length;

                if (total > bodyLimit + 256 * 1024) {
                    throw new Error(`Body-Limit überschritten (> ${bodyLimit} bytes).`);
                }
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this._append(`[${nowStamp()}] ERROR recv: ${msg}`);
            this._showInternalPage("Timeout/Recv Fehler", msg);
            this._stop();
            return;
        }

        // Close conn
        try { this.os.net.closeTCPConn(key); } catch { /* ignore */ }
        if (this.connKey === key) this.connKey = null;

        // If cancelled, stop quietly
        if (!this.loading || this.requestSeq !== seq) return;

        const raw = concatChunks(chunks);
        const headerSep = encodeUTF8("\r\n\r\n");
        const idx = indexOfBytes(raw, headerSep);
        if (idx < 0) {
            this._showInternalPage("HTTP Fehler", "Antwort enthält keinen Header-Ende-Marker (\\r\\n\\r\\n).");
            this.loading = false;
            this._syncUI();
            this._setStatus("HTTP Fehler: Header unvollständig.");
            return;
        }

        const headerBytes = raw.slice(0, idx);
        const bodyBytesAll = raw.slice(idx + 4);

        const headerText = decodeUTF8(headerBytes);
        const firstLineEnd = headerText.indexOf("\r\n");
        const statusLine = firstLineEnd >= 0 ? headerText.slice(0, firstLineEnd) : headerText;

        const m = /^HTTP\/\d+\.\d+\s+(\d{3})\s*(.*)$/.exec(statusLine);
        const statusCode = m ? Number(m[1]) : 0;
        const reason = m ? (m[2] || "").trim() : "";

        const headers = parseHeaders(headerText);
        if (this.headersEl) this.headersEl.value = headerText;

        /** @type {Uint8Array} */
        let bodyBytes = bodyBytesAll;

        const te = (headers["transfer-encoding"] || "").toLowerCase();
        const cl = headers["content-length"];

        if (te.includes("chunked")) {
            const dec = decodeChunkedBody(bodyBytesAll);
            if (!dec.ok) {
                this._showInternalPage("HTTP Chunked Fehler", dec.error);
                this.loading = false;
                this._syncUI();
                this._setStatus("HTTP Chunked Fehler.");
                return;
            }
            bodyBytes = dec.body;
        } else if (cl && /^\d+$/.test(cl.trim())) {
            const want = Number(cl.trim());
            if (Number.isFinite(want) && want >= 0) bodyBytes = bodyBytesAll.slice(0, want);
        }

        if (bodyBytes.length > bodyLimit) {
            this._showInternalPage("Body zu groß", `Body hat ${bodyBytes.length} bytes, Limit ist ${bodyLimit} bytes.`);
            this.loading = false;
            this._syncUI();
            this._setStatus(`HTTP ${statusCode}: Body zu groß.`);
            return;
        }

        const bodyText = decodeUTF8(bodyBytes);

        if (statusCode !== 200 && statusCode !== 404) {
            this._append(`[${nowStamp()}] HTTP ${statusCode} ${reason} (nicht gerendert)`);
            this._showInternalPage(
                "Nicht unterstützt",
                `Sparktail rendert derzeit nur 200 und 404.\n\nErhalten: HTTP ${statusCode} ${reason}\n\nTipp: Schau in den Headers/Source Tab.`
            );
            if (this.sourceEl) this.sourceEl.value = bodyText;

            const ct = headers["content-type"] || "(unknown)";
            this._setStatus(`HTTP ${statusCode} ${reason} • ${bodyBytes.length} bytes • ${ct}`);

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
                    `HTTP ${statusCode}`,
                    `Content-Type: ${headers["content-type"] || "(unknown)"}\n\nPreview ist für Nicht-HTML deaktiviert.\n\nSource enthält die Rohdaten als Text.`
                );
            }
        }

        const ct = headers["content-type"] || "(unknown)";
        this._append(`[${nowStamp()}] HTTP ${statusCode} ${reason} (body=${bodyBytes.length} bytes)`);
        this._setStatus(`HTTP ${statusCode} ${reason} • ${bodyBytes.length} bytes • ${ct}`);

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
        if (this.headersEl) this.headersEl.value = "about:start (internal)\r\n";
        this.tab = "preview";
        this._renderTab();
    }
}
