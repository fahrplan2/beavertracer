//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";
import { IPAddress } from "../net/models/IPAddress.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowStamp() { return new Date().toLocaleTimeString(); }

/** @param {string} s */
function enc(s) { return new TextEncoder().encode(s); }

/** @param {Uint8Array} b */
function dec(b) { return new TextDecoder().decode(b); }

/** @param {string} s */
function crlf(s) {
  return String(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
}

/**
 * @template T
 * @param {Promise<T>} p
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), Math.max(1, ms | 0));
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/**
 * Read one CRLF-terminated line. Returns null on EOF.
 * @param {any} net
 * @param {string} key
 * @param {number} ms
 * @param {{buf:Uint8Array}} st
 * @returns {Promise<string|null>}
 */
async function recvLine(net, key, ms, st) {
  while (true) {
    const b = st.buf;
    for (let i = 0; i + 1 < b.length; i++) {
      if (b[i] === 13 && b[i + 1] === 10) {
        const line = dec(b.slice(0, i));
        st.buf = b.slice(i + 2);
        return line;
      }
    }
    const part = await withTimeout(net.recvTCPConn(key), ms, "recv");
    if (part == null) return null;
    const m = new Uint8Array(st.buf.length + part.length);
    m.set(st.buf, 0); m.set(part, st.buf.length);
    st.buf = m;
    if (st.buf.length > 1024 * 1024) throw new Error("Zeilenpuffer-Überlauf");
  }
}

/**
 * Read exactly n bytes from stream.
 * @param {any} net
 * @param {string} key
 * @param {number} ms
 * @param {{buf:Uint8Array}} st
 * @param {number} n
 * @returns {Promise<string>}
 */
async function recvExact(net, key, ms, st, n) {
  while (st.buf.length < n) {
    const part = await withTimeout(net.recvTCPConn(key), ms, "recv");
    if (part == null) throw new Error("EOF beim Lesen");
    const m = new Uint8Array(st.buf.length + part.length);
    m.set(st.buf, 0); m.set(part, st.buf.length);
    st.buf = m;
    if (st.buf.length > 8 * 1024 * 1024) throw new Error("Puffer-Überlauf");
  }
  const out = st.buf.slice(0, n);
  st.buf = st.buf.slice(n);
  return dec(out);
}

/** @param {any} net @param {string} key @param {string} line */
function sendLine(net, key, line) { net.sendTCPConn(key, enc(line + "\r\n")); }

/**
 * Read SMTP multi-line response (250-... style).
 * @param {any} net @param {string} key @param {number} ms @param {{buf:Uint8Array}} st
 * @returns {Promise<{code:number, lines:string[]}>}
 */
async function recvSmtp(net, key, ms, st) {
  const first = await recvLine(net, key, ms, st);
  if (first == null) throw new Error("SMTP: Verbindung getrennt");
  const lines = [first];
  const code = Number(first.slice(0, 3)) | 0;
  if (first.length >= 4 && first[3] === "-") {
    const prefix = String(code).padStart(3, "0") + " ";
    while (true) {
      const l = await recvLine(net, key, ms, st);
      if (l == null) throw new Error("SMTP: Verbindung getrennt");
      lines.push(l);
      if (l.startsWith(prefix)) break;
    }
  }
  return { code, lines };
}

/** @param {string} s */
function b64(s) {
  try { return btoa(s); } catch { /* ignore */ }
  const C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let o = "", buf = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    buf = (buf << 8) | (s.charCodeAt(i) & 0xff); bits += 8;
    while (bits >= 6) { bits -= 6; o += C[(buf >> bits) & 0x3f]; }
  }
  if (bits > 0) o += C[(buf << (6 - bits)) & 0x3f];
  while (o.length % 4) o += "=";
  return o;
}

/**
 * Parse RFC822 headers → lowercased key/value map.
 * @param {string} raw
 * @returns {Record<string,string>}
 */
function parseHeaders(raw) {
  const end = raw.search(/\r\n\r\n|\n\n/);
  const head = end >= 0 ? raw.slice(0, end) : raw;
  const lines = head.replace(/\r\n/g, "\n").split("\n");
  /** @type {Record<string,string>} */
  const h = {};
  let cur = "";
  for (const ln of lines) {
    if (/^\s/.test(ln) && cur) { h[cur] = (h[cur] ?? "") + " " + ln.trim(); continue; }
    const k = ln.indexOf(":");
    if (k > 0) { cur = ln.slice(0, k).trim().toLowerCase(); h[cur] = ln.slice(k + 1).trim(); }
  }
  return h;
}

/** @param {string} raw @returns {string} */
function msgBody(raw) {
  const m = raw.match(/\r\n\r\n|\n\n/);
  return m && m.index != null ? raw.slice(m.index + m[0].length) : "";
}

/**
 * @param {string} host
 * @param {(n:string)=>Promise<any>} dns
 * @returns {Promise<IPAddress>}
 */
async function resolveHost(host, dns) {
  const s = host.trim();
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m4) {
    const [a, b, c, d] = m4.slice(1).map(Number);
    if ([a, b, c, d].every(x => x >= 0 && x <= 255))
      return new IPAddress(4, (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0);
  }
  if (/^\d+$/.test(s)) { const n = Number(s); if (n <= 0xffffffff) return new IPAddress(4, n >>> 0); }
  if (s.includes(":")) { try { return IPAddress.fromString(s); } catch { /* ignore */ } throw new Error(`Ungültige IPv6: ${s}`); }
  const r = await dns(s);
  if (r instanceof IPAddress) return r;
  if (typeof r === "number") return new IPAddress(4, r >>> 0);
  throw new Error(`Hostname nicht auflösbar: ${s}`);
}

/**
 * Create a button with a FontAwesome icon.
 * @param {string} faClass  e.g. "fa-paper-plane"
 * @param {string} label    text after the icon (empty = icon only)
 * @param {()=>void} onClick
 * @param {{primary?:boolean, className?:string}} [opts]
 * @returns {HTMLButtonElement}
 */
function iconBtn(faClass, label, onClick, opts = {}) {
  const b = UI.button("", onClick, opts);
  b.innerHTML = `<i class="fa-solid ${faClass}" aria-hidden="true"></i>${label ? ` ${label}` : ""}`;
  return b;
}

/** @param {string[]} addrs @returns {string[]} */
function splitAddrs(addrs) {
  return addrs
    .flatMap(a => a.split(","))
    .map(s => s.trim())
    .filter(Boolean);
}

// ── VFS helpers ──────────────────────────────────────────────────────────────

/** @param {any} fs @param {string} dir */
function ensureDir(fs, dir) {
  try { if (typeof fs.mkdir === "function") fs.mkdir(dir, { recursive: true }); } catch { /* ignore */ }
}

/** @param {any} fs @param {string} path @returns {string|null} */
function readFile(fs, path) {
  try {
    if (typeof fs.exists === "function" && !fs.exists(path)) return null;
    if (typeof fs.readFile === "function") return String(fs.readFile(path));
  } catch { /* ignore */ }
  return null;
}

/** @param {any} fs @param {string} path @param {string} content */
function writeFile(fs, path, content) {
  if (typeof fs.writeFile !== "function") throw new Error("fs.writeFile nicht verfügbar");
  fs.writeFile(path, String(content));
}

// ── App ───────────────────────────────────────────────────────────────────────

/**
 * @typedef {{raw:string, headers:Record<string,string>}} MailEntry
 */

export class MailClientApp extends GenericProcess {
  get title() { return t("app.mailclient.title") || "Mail"; }
  icon = "fa-envelope-open";

  /** @type {Disposer} */
  disposer = new Disposer();

  configPath = "/etc/mailclient.conf";

  // ── Config (persisted to VFS) ─────────────────────────────────
  cfg = {
    protocol: "pop3",
    host: "",
    port: "110",
    user: "",
    pass: "",
    smtpHost: "",
    smtpPort: "25",
  };

  // ── Runtime state ─────────────────────────────────────────────
  busy = false;
  /** @type {MailEntry[]} */ inbox = [];
  /** @type {MailEntry[]} */ sent = [];
  inboxSel = -1;
  sentSel  = -1;
  /** @type {"inbox"|"sent"|"compose"|"config"|"log"} */ tab = "inbox";
  /** @type {string[]} */ log = [];

  // ── UI refs ───────────────────────────────────────────────────
  /** @type {HTMLButtonElement|null} */ fetchBtn = null;
  /** @type {HTMLElement|null} */       statusEl = null;

  /** @type {HTMLElement|null} */ inboxPanel = null;
  /** @type {HTMLElement|null} */ inboxListEl = null;
  /** @type {HTMLTextAreaElement|null} */ inboxPreviewEl = null;

  /** @type {HTMLElement|null} */ sentPanel = null;
  /** @type {HTMLElement|null} */ sentListEl = null;
  /** @type {HTMLTextAreaElement|null} */ sentPreviewEl = null;

  /** @type {HTMLElement|null} */ composePanel = null;
  /** @type {HTMLInputElement|null} */ toEl = null;
  /** @type {HTMLInputElement|null} */ ccEl = null;
  /** @type {HTMLInputElement|null} */ bccEl = null;
  /** @type {HTMLInputElement|null} */ subjectEl = null;
  /** @type {HTMLTextAreaElement|null} */ composeBodyEl = null;

  /** @type {HTMLElement|null} */ logPanel = null;
  /** @type {HTMLElement|null} */ logEl = null;

  /** @type {HTMLElement|null} */ configPanel = null;
  /** @type {HTMLSelectElement|null} */ cfgProtoSel = null;
  /** @type {HTMLInputElement|null} */ cfgHostIn = null;
  /** @type {HTMLInputElement|null} */ cfgPortIn = null;
  /** @type {HTMLInputElement|null} */ cfgUserIn = null;
  /** @type {HTMLInputElement|null} */ cfgPassIn = null;
  /** @type {HTMLInputElement|null} */ cfgSmtpHostIn = null;
  /** @type {HTMLInputElement|null} */ cfgSmtpPortIn = null;

  /** @type {Record<string,HTMLButtonElement>} */ tabBtns = {};

  // ── Lifecycle ─────────────────────────────────────────────────

  run() {
    this.root.classList.add("app", "app-mail-client");
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();
    this._loadConfig();   // populate this.cfg before building UI
    this._build();
    this._switchTab(this.tab);
    this._renderList("inbox");
    this._renderList("sent");
    this._renderLog();
    this._setStatus(t("app.mailclient.status.ready") || "Bereit");
  }

  onUnmount() {
    this.disposer.dispose();
    this.fetchBtn = null; this.statusEl = null;
    this.inboxPanel = null; this.inboxListEl = null; this.inboxPreviewEl = null;
    this.sentPanel = null;  this.sentListEl = null;  this.sentPreviewEl = null;
    this.composePanel = null; this.toEl = null; this.ccEl = null;
    this.bccEl = null; this.subjectEl = null; this.composeBodyEl = null;
    this.logPanel = null; this.logEl = null;
    this.configPanel = null;
    this.cfgProtoSel = null; this.cfgHostIn = null; this.cfgPortIn = null;
    this.cfgUserIn = null; this.cfgPassIn = null;
    this.cfgSmtpHostIn = null; this.cfgSmtpPortIn = null;
    this.tabBtns = {};
    super.onUnmount();
  }

  // ── Config persistence ────────────────────────────────────────

  _loadConfig() {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;
    ensureDir(fs, "/etc");
    const raw = readFile(fs, this.configPath);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const str = (key, fallback) => typeof parsed[key] === "string" ? parsed[key] : fallback;
        this.cfg = {
          protocol: ["pop3", "imap"].includes(parsed.protocol) ? parsed.protocol : this.cfg.protocol,
          host:     str("host",     this.cfg.host),
          port:     str("port",     this.cfg.port),
          user:     str("user",     this.cfg.user),
          pass:     str("pass",     this.cfg.pass),
          smtpHost: str("smtpHost", this.cfg.smtpHost),
          smtpPort: str("smtpPort", this.cfg.smtpPort),
        };
      }
    } catch { /* corrupt config — keep defaults */ }
  }

  _saveConfig() {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;
    ensureDir(fs, "/etc");
    try {
      writeFile(fs, this.configPath, JSON.stringify(this.cfg, null, 2));
    } catch (e) {
      this._log(`Konfiguration speichern fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ── UI construction ───────────────────────────────────────────

  _build() {
    // ── Toolbar ──────────────────────────────────────────────
    const composeBtn = iconBtn("fa-pen-to-square", t("app.mailclient.button.compose") || "Verfassen",
      () => { this._clearCompose(); this._switchTab("compose"); }, {});

    const fetchBtn = iconBtn("fa-rotate", t("app.mailclient.button.fetch") || "Abrufen",
      () => this._fetchMail(), { primary: true });
    this.fetchBtn = fetchBtn;

    const configBtn = iconBtn("fa-gear", t("app.mailclient.button.config") || "Konfiguration",
      () => this._switchTab("config"), {});

    const toolbar = UI.el("div", { className: "mailclient-toolbar", children: [composeBtn, fetchBtn, configBtn] });

    // ── Tabs ─────────────────────────────────────────────────
    const mkTab = (id, icon, label) => {
      const b = iconBtn(icon, label, () => this._switchTab(id), {});
      this.tabBtns[id] = b;
      return b;
    };

    const tabBar = UI.el("div", { className: "mailclient-tabbar", children: [
      mkTab("inbox",   "fa-inbox",          t("app.mailclient.tab.inbox")   || "Posteingang"),
      mkTab("sent",    "fa-paper-plane",    t("app.mailclient.tab.sent")    || "Gesendet"),
      mkTab("compose", "fa-pen-to-square",  t("app.mailclient.tab.compose") || "Verfassen"),
      mkTab("config",  "fa-gear",           t("app.mailclient.tab.config")  || "Konfiguration"),
      mkTab("log",     "fa-list",           t("app.mailclient.tab.log")     || "Protokoll"),
    ] });

    // ── Inbox panel ──────────────────────────────────────────
    const inboxListEl = UI.el("div", { className: "mailclient-list" });
    const inboxPreview = /** @type {HTMLTextAreaElement} */ (UI.el("textarea", {}));
    inboxPreview.className = "mailclient-preview input";
    inboxPreview.readOnly = true;
    const inboxPanel = UI.el("div", { className: "mailclient-folder-panel", children: [inboxListEl, inboxPreview] });

    this.inboxListEl = inboxListEl;
    this.inboxPreviewEl = inboxPreview;
    this.inboxPanel = inboxPanel;

    // ── Sent panel ───────────────────────────────────────────
    const sentListEl = UI.el("div", { className: "mailclient-list" });
    const sentPreview = /** @type {HTMLTextAreaElement} */ (UI.el("textarea", {}));
    sentPreview.className = "mailclient-preview input";
    sentPreview.readOnly = true;
    const sentPanel = UI.el("div", { className: "mailclient-folder-panel", children: [sentListEl, sentPreview] });

    this.sentListEl = sentListEl;
    this.sentPreviewEl = sentPreview;
    this.sentPanel = sentPanel;

    // ── Compose panel ────────────────────────────────────────
    const toIn  = UI.input({ placeholder: "alice@example.local" });
    const ccIn  = UI.input({ placeholder: "" });
    const bccIn = UI.input({ placeholder: "" });
    const subIn = UI.input({ placeholder: t("app.mailclient.placeholder.subject") || "Betreff" });
    const bodyTA = /** @type {HTMLTextAreaElement} */ (UI.el("textarea", {}));
    bodyTA.className = "input mailclient-compose-body";
    bodyTA.placeholder = t("app.mailclient.placeholder.body") || "Nachrichtentext…";

    this.toEl = toIn; this.ccEl = ccIn; this.bccEl = bccIn;
    this.subjectEl = subIn; this.composeBodyEl = bodyTA;

    const sendBtn    = iconBtn("fa-paper-plane", t("app.mailclient.button.send") || "Senden",      () => this._sendMail(), { primary: true });
    const discardBtn = iconBtn("fa-xmark",        t("app.mailclient.button.discard") || "Verwerfen", () => { this._clearCompose(); this._switchTab("inbox"); }, {});

    const composePanel = UI.el("div", { className: "mailclient-compose-panel panel", children: [
      UI.el("h4", { text: t("app.mailclient.compose.title") || "Neue Nachricht" }),
      UI.row(t("app.mailclient.label.to")      || "An",      toIn),
      UI.row("CC",                                            ccIn),
      UI.row("BCC",                                           bccIn),
      UI.row(t("app.mailclient.label.subject") || "Betreff", subIn),
      bodyTA,
      UI.buttonRow([sendBtn, discardBtn]),
    ] });
    this.composePanel = composePanel;

    // ── Config panel (inline tab) ────────────────────────────
    const cfgProtoSel  = UI.select(
      [{ value: "pop3", label: "POP3" }, { value: "imap", label: "IMAP" }],
      { value: this.cfg.protocol }
    );
    const cfgHostIn    = UI.input({ value: this.cfg.host,     placeholder: "z.B. 192.168.1.10" });
    const cfgPortIn    = UI.input({ value: this.cfg.port,     placeholder: "110" });
    const cfgUserIn    = UI.input({ value: this.cfg.user,     placeholder: "alice" });
    const cfgPassIn    = UI.input({ value: this.cfg.pass,     placeholder: "••••••" });
    cfgPassIn.type     = "password";
    const cfgSmtpHostIn = UI.input({ value: this.cfg.smtpHost, placeholder: "z.B. 192.168.1.10" });
    const cfgSmtpPortIn = UI.input({ value: this.cfg.smtpPort, placeholder: "25" });

    cfgPortIn.style.width = "90px";
    cfgSmtpPortIn.style.width = "90px";

    cfgProtoSel.addEventListener("change", () => {
      if (cfgProtoSel.value === "pop3" && cfgPortIn.value === "143") cfgPortIn.value = "110";
      if (cfgProtoSel.value === "imap" && cfgPortIn.value === "110") cfgPortIn.value = "143";
    });

    const cfgSaveBtn = iconBtn("fa-floppy-disk", t("app.mailclient.button.save") || "Speichern", () => {
      this.cfg = {
        protocol: cfgProtoSel.value,
        host:     cfgHostIn.value.trim(),
        port:     cfgPortIn.value.trim()     || "110",
        user:     cfgUserIn.value.trim(),
        pass:     cfgPassIn.value,
        smtpHost: cfgSmtpHostIn.value.trim(),
        smtpPort: cfgSmtpPortIn.value.trim() || "25",
      };
      this._saveConfig();
      this._setStatus(t("app.mailclient.status.configSaved") || "Konfiguration gespeichert");
      this._switchTab("inbox");
    }, { primary: true });

    this.cfgProtoSel   = cfgProtoSel;
    this.cfgHostIn     = cfgHostIn;
    this.cfgPortIn     = cfgPortIn;
    this.cfgUserIn     = cfgUserIn;
    this.cfgPassIn     = cfgPassIn;
    this.cfgSmtpHostIn = cfgSmtpHostIn;
    this.cfgSmtpPortIn = cfgSmtpPortIn;

    const configPanel = UI.el("div", { className: "mailclient-config-panel panel", children: [
      UI.el("h4", { text: t("app.mailclient.config.title") || "Konfiguration" }),

      UI.el("h5", { text: t("app.mailclient.config.incoming") || "Eingehend" }),
      UI.row(t("app.mailclient.config.protocol") || "Protokoll",        cfgProtoSel),
      UI.row(t("app.mailclient.config.host")     || "Server (Adresse)", cfgHostIn),
      UI.row(t("app.mailclient.config.port")     || "Port",             cfgPortIn),
      UI.row(t("app.mailclient.config.user")     || "Benutzername",     cfgUserIn),
      UI.row(t("app.mailclient.config.pass")     || "Passwort",         cfgPassIn),

      UI.el("h5", { text: t("app.mailclient.config.outgoing") || "Ausgehend (SMTP)" }),
      UI.row(t("app.mailclient.config.smtpHost") || "Server (Adresse)", cfgSmtpHostIn),
      UI.row(t("app.mailclient.config.smtpPort") || "Port",             cfgSmtpPortIn),

      UI.buttonRow([cfgSaveBtn]),
    ] });
    this.configPanel = configPanel;

    // ── Log panel ────────────────────────────────────────────
    const logEl  = UI.el("div", { className: "mailclient-log msg" });
    const logPanel = UI.el("div", { className: "mailclient-log-panel", children: [logEl] });
    this.logEl   = logEl;
    this.logPanel = logPanel;

    // ── Status bar ───────────────────────────────────────────
    const statusEl = UI.el("div", { className: "mailclient-status msg" });
    this.statusEl = statusEl;

    // ── Assemble ─────────────────────────────────────────────
    const root = UI.panel([toolbar, tabBar, inboxPanel, sentPanel, composePanel, configPanel, logPanel, statusEl]);
    this.root.replaceChildren(root);
  }

  // ── Tab switching ─────────────────────────────────────────────

  /** @param {"inbox"|"sent"|"compose"|"config"|"log"} tab */
  _switchTab(tab) {
    this.tab = tab;
    if (this.inboxPanel)   this.inboxPanel.style.display   = tab === "inbox"   ? "" : "none";
    if (this.sentPanel)    this.sentPanel.style.display    = tab === "sent"    ? "" : "none";
    if (this.composePanel) this.composePanel.style.display = tab === "compose" ? "" : "none";
    if (this.configPanel)  this.configPanel.style.display  = tab === "config"  ? "" : "none";
    if (this.logPanel)     this.logPanel.style.display     = tab === "log"     ? "" : "none";

    for (const [id, btn] of Object.entries(this.tabBtns)) {
      btn.classList.toggle("active", id === tab);
    }
  }

  // ── Mail list rendering ───────────────────────────────────────

  /** @param {"inbox"|"sent"} folder */
  _renderList(folder) {
    const msgs  = folder === "inbox" ? this.inbox : this.sent;
    const listEl = folder === "inbox" ? this.inboxListEl : this.sentListEl;
    if (!listEl) return;

    listEl.replaceChildren();

    // Column header row
    const hdr = UI.el("div", { className: "mailclient-list-header" });
    hdr.appendChild(UI.el("span", { className: "ml-col-from",    text: folder === "inbox" ? "Von" : "An" }));
    hdr.appendChild(UI.el("span", { className: "ml-col-subject", text: "Betreff" }));
    hdr.appendChild(UI.el("span", { className: "ml-col-date",    text: "Datum" }));
    listEl.appendChild(hdr);

    if (msgs.length === 0) {
      listEl.appendChild(UI.el("div", {
        className: "mailclient-list-empty",
        text: folder === "inbox"
          ? (t("app.mailclient.inbox.empty") || "(leer — Abrufen drücken)")
          : (t("app.mailclient.sent.empty")  || "(keine gesendeten Nachrichten)"),
      }));
      return;
    }

    for (let i = 0; i < msgs.length; i++) {
      const h = msgs[i].headers;
      const primary = folder === "inbox" ? (h["from"] || "(unbekannt)") : (h["to"] || "(unbekannt)");
      const subject = h["subject"] || "(kein Betreff)";
      const date    = h["date"] || "";
      const sel     = folder === "inbox" ? this.inboxSel : this.sentSel;

      const row = UI.el("div", { className: "mailclient-list-row" + (i === sel ? " selected" : "") });
      row.appendChild(UI.el("span", { className: "ml-col-from",    text: primary  }));
      row.appendChild(UI.el("span", { className: "ml-col-subject", text: subject  }));
      row.appendChild(UI.el("span", { className: "ml-col-date",    text: date     }));

      const idx = i, f = folder;
      row.addEventListener("click", () => this._selectMsg(idx, f));
      listEl.appendChild(row);
    }
  }

  /**
   * @param {number} idx
   * @param {"inbox"|"sent"} folder
   */
  _selectMsg(idx, folder) {
    if (folder === "inbox") this.inboxSel = idx;
    else                    this.sentSel  = idx;
    this._renderList(folder);

    const msgs    = folder === "inbox" ? this.inbox : this.sent;
    const preview = folder === "inbox" ? this.inboxPreviewEl : this.sentPreviewEl;
    const entry   = msgs[idx];
    if (!entry || !preview) return;

    const h = entry.headers;
    preview.value =
      `Von:     ${h["from"]    || ""}\n` +
      `An:      ${h["to"]      || ""}\n` +
      (h["cc"]  ? `CC:      ${h["cc"]}\n`  : "") +
      `Betreff: ${h["subject"] || ""}\n` +
      `Datum:   ${h["date"]    || ""}\n` +
      "─".repeat(48) + "\n" +
      msgBody(entry.raw);
  }

  // ── Compose helpers ───────────────────────────────────────────

  _clearCompose() {
    if (this.toEl)          this.toEl.value          = "";
    if (this.ccEl)          this.ccEl.value          = "";
    if (this.bccEl)         this.bccEl.value         = "";
    if (this.subjectEl)     this.subjectEl.value     = "";
    if (this.composeBodyEl) this.composeBodyEl.value = "";
  }

  // ── Status / log ──────────────────────────────────────────────

  /** @param {string} text */
  _setStatus(text) { if (this.statusEl) this.statusEl.textContent = String(text ?? ""); }

  _setBusy(busy) {
    this.busy = busy;
    if (this.fetchBtn) this.fetchBtn.disabled = busy;
  }

  /** @param {string} line */
  _log(line) {
    this.log.push(`[${nowStamp()}] ${line}`);
    if (this.log.length > 2000) this.log.splice(0, this.log.length - 2000);
    if (this.mounted) this._renderLog();
  }

  _renderLog() {
    if (this.logEl) this.logEl.textContent = this.log.slice(-400).join("\n");
  }

  // ── Fetch mail (POP3 / IMAP) ──────────────────────────────────

  async _fetchMail() {
    if (this.busy) return;

    const { protocol, host, port: portStr, user, pass } = this.cfg;
    if (!host) { this._setStatus(t("app.mailclient.err.noHost")    || "Kein Server konfiguriert"); return; }
    if (!user) { this._setStatus(t("app.mailclient.err.noUser")    || "Kein Benutzername konfiguriert"); return; }

    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this._setStatus(t("app.mailclient.err.invalidPort") || "Ungültiger Port"); return;
    }

    this._setBusy(true);
    this._setStatus(`Verbinde ${host}:${port} (${protocol.toUpperCase()})…`);
    this._log(`Verbinde ${host}:${port} (${protocol.toUpperCase()}) als ${user}`);

    let ip;
    try {
      ip = await withTimeout(resolveHost(host, n => this.os.dns.resolve(n)), 10000, "DNS");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._log(`DNS-Fehler: ${msg}`);
      this._setStatus(`DNS-Fehler: ${msg}`);
      this._setBusy(false);
      return;
    }

    let connKey;
    try {
      const conn = await withTimeout(this.os.net.connectTCPConn(ip, port), 10000, "TCP connect");
      connKey = conn?.key;
      if (typeof connKey !== "string" || !connKey) throw new Error("Kein Verbindungsschlüssel");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._log(`Verbindungsfehler: ${msg}`);
      this._setStatus(`Verbindungsfehler: ${msg}`);
      this._setBusy(false);
      return;
    }

    try {
      if (protocol === "imap") await this._fetchIMAP(connKey, user, pass);
      else                      await this._fetchPOP3(connKey, user, pass);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._log(`Fehler: ${msg}`);
      this._setStatus(`Fehler: ${msg}`);
    } finally {
      try { this.os.net.closeTCPConn(connKey); } catch { /* ignore */ }
      this._setBusy(false);
    }
  }

  // ── POP3 client ───────────────────────────────────────────────

  /**
   * @param {string} connKey
   * @param {string} user
   * @param {string} pass
   */
  async _fetchPOP3(connKey, user, pass) {
    const net = this.os.net, TO = 15000;
    const st  = { buf: new Uint8Array(0) };

    const send = (l) => { this._log(`> ${l}`); sendLine(net, connKey, l); };
    const recv = async () => {
      const l = await recvLine(net, connKey, TO, st);
      if (l !== null) this._log(`< ${l}`);
      return l;
    };
    const ok = async (cmd) => {
      const l = await recv();
      if (l == null) throw new Error("POP3: Verbindung getrennt");
      if (!l.startsWith("+OK")) throw new Error(`POP3 ${cmd}: ${l}`);
      return l;
    };

    await ok("greeting");

    send(`USER ${user}`); await ok("USER");
    send(`PASS ${pass}`); await ok("PASS");

    send("STAT");
    const stat = await ok("STAT");
    const count = Number(/\+OK (\d+)/.exec(stat)?.[1] ?? 0);
    this._log(`Posteingang: ${count} Nachricht(en)`);

    /** @type {MailEntry[]} */
    const fetched = [];

    for (let i = 1; i <= count; i++) {
      send(`RETR ${i}`);
      const retrOk = await recv();
      if (retrOk == null || !retrOk.startsWith("+OK")) { this._log(`RETR ${i} fehlgeschlagen`); continue; }

      const lines = [];
      while (true) {
        const l = await recvLine(net, connKey, TO, st);
        if (l == null) throw new Error("POP3: EOF während RETR");
        if (l === ".") break;
        lines.push(l.startsWith("..") ? l.slice(1) : l);
      }
      const raw = lines.join("\r\n");
      fetched.push({ raw, headers: parseHeaders(raw) });
    }

    send("QUIT");
    await recv();

    this.inbox = fetched;
    this.inboxSel = -1;
    if (this.inboxPreviewEl) this.inboxPreviewEl.value = "";
    this._renderList("inbox");
    this._setStatus(`${fetched.length} Nachricht(en) abgerufen`);
    this._log(`Fertig: ${fetched.length} Nachricht(en) geladen`);
  }

  // ── IMAP client ───────────────────────────────────────────────

  /**
   * @param {string} connKey
   * @param {string} user
   * @param {string} pass
   */
  async _fetchIMAP(connKey, user, pass) {
    const net = this.os.net, TO = 15000;
    const st  = { buf: new Uint8Array(0) };

    let seq = 1;
    const tag  = () => `A${String(seq++).padStart(3, "0")}`;
    const send = (l) => { this._log(`> ${l}`); sendLine(net, connKey, l); };

    // Read lines until we see our tag response
    const readTagged = async (expectedTag) => {
      while (true) {
        const l = await recvLine(net, connKey, TO, st);
        if (l == null) throw new Error("IMAP: Verbindung getrennt");
        this._log(`< ${l}`);
        if (l.startsWith(`${expectedTag} OK`))  return l;
        if (l.startsWith(`${expectedTag} NO`)  || l.startsWith(`${expectedTag} BAD`))
          throw new Error(`IMAP: ${l}`);
      }
    };

    // Greeting
    const g = await recvLine(net, connKey, TO, st);
    if (g == null) throw new Error("IMAP: keine Begrüßung");
    this._log(`< ${g}`);

    // LOGIN
    const lt = tag(); send(`${lt} LOGIN ${user} ${pass}`);
    await readTagged(lt);

    // SELECT INBOX
    const st2 = tag(); send(`${st2} SELECT INBOX`);
    while (true) {
      const l = await recvLine(net, connKey, TO, st);
      if (l == null) throw new Error("IMAP: EOF bei SELECT");
      this._log(`< ${l}`);
      if (l.startsWith(`${st2} `)) break;
    }

    // SEARCH ALL
    const se = tag(); send(`${se} SEARCH ALL`);
    /** @type {number[]} */
    let seqNums = [];
    while (true) {
      const l = await recvLine(net, connKey, TO, st);
      if (l == null) throw new Error("IMAP: EOF bei SEARCH");
      this._log(`< ${l}`);
      if (l.startsWith("* SEARCH"))
        seqNums = l.slice(8).trim().split(/\s+/).filter(Boolean).map(Number).filter(n => n > 0);
      if (l.startsWith(`${se} `)) break;
    }

    /** @type {MailEntry[]} */
    const fetched = [];

    for (const n of seqNums) {
      const ft = tag(); send(`${ft} FETCH ${n} BODY[]`);

      let raw = null;
      outer: while (true) {
        const l = await recvLine(net, connKey, TO, st);
        if (l == null) throw new Error("IMAP: EOF bei FETCH");
        this._log(`< ${l.slice(0, 80)}`);

        const litM = /\{(\d+)\}$/.exec(l);
        if (litM) {
          raw = await recvExact(net, connKey, TO, st, Number(litM[1]));
          // drain until tagged OK
          while (true) {
            const tl = await recvLine(net, connKey, TO, st);
            if (tl == null) throw new Error("IMAP: EOF nach Literal");
            this._log(`< ${tl}`);
            if (tl.startsWith(`${ft} `)) break outer;
          }
        }
        if (l.startsWith(`${ft} `)) break;
      }

      if (raw != null) fetched.push({ raw, headers: parseHeaders(raw) });
    }

    // LOGOUT
    const lo = tag(); send(`${lo} LOGOUT`);
    await recvLine(net, connKey, TO, st);

    this.inbox = fetched;
    this.inboxSel = -1;
    if (this.inboxPreviewEl) this.inboxPreviewEl.value = "";
    this._renderList("inbox");
    this._setStatus(`${fetched.length} Nachricht(en) abgerufen`);
    this._log(`Fertig: ${fetched.length} Nachricht(en) geladen`);
  }

  // ── Send mail (SMTP) ──────────────────────────────────────────

  async _sendMail() {
    if (this.busy) return;

    const { smtpHost, smtpPort: smtpPortStr, user, pass } = this.cfg;
    const to      = (this.toEl?.value          ?? "").trim();
    const ccRaw   = (this.ccEl?.value          ?? "").trim();
    const bccRaw  = (this.bccEl?.value         ?? "").trim();
    const subject = (this.subjectEl?.value     ?? "").trim();
    const body    = (this.composeBodyEl?.value ?? "");

    if (!smtpHost) { this._setStatus(t("app.mailclient.err.noSmtpHost") || "Kein SMTP-Server konfiguriert"); return; }
    if (!to)       { this._setStatus(t("app.mailclient.err.noRecipient") || "Kein Empfänger"); return; }

    const smtpPort = Number(smtpPortStr);
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      this._setStatus(t("app.mailclient.err.invalidPort") || "Ungültiger SMTP-Port"); return;
    }

    const from    = user.includes("@") ? user : `${user}@${smtpHost}`;
    const ccAddrs  = splitAddrs([ccRaw]);
    const bccAddrs = splitAddrs([bccRaw]);
    const allRcpt  = [...splitAddrs([to]), ...ccAddrs, ...bccAddrs];

    this._setBusy(true);
    this._setStatus(`Sende → ${to}…`);
    this._log(`SMTP ${smtpHost}:${smtpPort} Von=${from} An=${to}`);
    this._switchTab("log");

    let ip;
    try {
      ip = await withTimeout(resolveHost(smtpHost, n => this.os.dns.resolve(n)), 10000, "DNS");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._log(`DNS-Fehler: ${msg}`); this._setStatus(`DNS-Fehler: ${msg}`);
      this._setBusy(false); return;
    }

    let connKey;
    try {
      const conn = await withTimeout(this.os.net.connectTCPConn(ip, smtpPort), 10000, "TCP");
      connKey = conn?.key;
      if (typeof connKey !== "string" || !connKey) throw new Error("Kein Verbindungsschlüssel");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._log(`Verbindungsfehler: ${msg}`); this._setStatus(`Verbindungsfehler: ${msg}`);
      this._setBusy(false); return;
    }

    try {
      await this._doSmtp(connKey, from, to, ccAddrs, bccAddrs, allRcpt, subject, body, user, pass);

      // Track in sent folder
      const date = new Date().toUTCString();
      const ccHdr = ccAddrs.length ? `CC: ${ccAddrs.join(", ")}\r\n` : "";
      const raw =
        `From: ${from}\r\nTo: ${to}\r\n${ccHdr}Subject: ${subject || "(kein Betreff)"}\r\nDate: ${date}\r\n\r\n` +
        crlf(body);
      this.sent.push({ raw, headers: parseHeaders(raw) });
      this._renderList("sent");

      this._setStatus(t("app.mailclient.status.sent") || "Nachricht gesendet");
      this._clearCompose();
      this._switchTab("sent");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._log(`Sendefehler: ${msg}`); this._setStatus(`Sendefehler: ${msg}`);
    } finally {
      try { this.os.net.closeTCPConn(connKey); } catch { /* ignore */ }
      this._setBusy(false);
    }
  }

  /**
   * @param {string} connKey
   * @param {string} from
   * @param {string} to
   * @param {string[]} cc
   * @param {string[]} bcc
   * @param {string[]} allRcpt
   * @param {string} subject
   * @param {string} body
   * @param {string} user
   * @param {string} pass
   */
  async _doSmtp(connKey, from, to, cc, bcc, allRcpt, subject, body, user, pass) {
    const net = this.os.net, TO = 15000;
    const st  = { buf: new Uint8Array(0) };

    const send = (l) => { this._log(`> ${l}`); sendLine(net, connKey, l); };
    const expect = async (codes, label) => {
      const r = await recvSmtp(net, connKey, TO, st);
      for (const l of r.lines) this._log(`< ${l}`);
      if (!codes.includes(r.code)) throw new Error(`SMTP ${label}: ${r.lines.join(" | ")}`);
      return r;
    };

    await expect([220], "greeting");

    const localDomain = from.includes("@") ? from.split("@")[1] : "mail.local";
    send(`EHLO ${localDomain}`);
    const ehlo = await recvSmtp(net, connKey, TO, st);
    for (const l of ehlo.lines) this._log(`< ${l}`);
    if (![250].includes(ehlo.code)) throw new Error(`EHLO: ${ehlo.lines[0]}`);

    // AUTH PLAIN if supported
    const supportsAuth = ehlo.lines.some(l => l.toUpperCase().includes("AUTH") && l.toUpperCase().includes("PLAIN"));
    if (supportsAuth && user && pass) {
      send(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`);
      const ar = await recvSmtp(net, connKey, TO, st);
      for (const l of ar.lines) this._log(`< ${l}`);
      if (ar.code !== 235) this._log("Warnung: AUTH PLAIN fehlgeschlagen, fahre fort…");
    }

    send(`MAIL FROM:<${from}>`);         await expect([250], "MAIL FROM");
    for (const r of allRcpt) {
      send(`RCPT TO:<${r}>`);            await expect([250, 251], "RCPT TO");
    }
    send("DATA");                        await expect([354], "DATA");

    // Build message with headers
    const date  = new Date().toUTCString();
    const ccHdr = cc.length ? `CC: ${cc.join(", ")}\r\n` : "";
    const msgParts = [
      `From: ${from}`,
      `To: ${to}`,
      ...(cc.length ? [`CC: ${cc.join(", ")}`] : []),
      `Subject: ${subject || "(kein Betreff)"}`,
      `Date: ${date}`,
      ``,
      ...crlf(body).split("\r\n"),
    ];
    const stuffed = msgParts.map(l => l.startsWith(".") ? "." + l : l).join("\r\n");
    net.sendTCPConn(connKey, enc(stuffed + "\r\n.\r\n"));
    this._log("> [Nachrichteninhalt]");
    this._log("> .");

    await expect([250], "accepted");
    send("QUIT");
    await recvLine(net, connKey, TO, st);
    this._log("SMTP: Nachricht erfolgreich übergeben");
  }
}
