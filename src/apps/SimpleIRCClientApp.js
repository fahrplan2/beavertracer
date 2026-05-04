//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { Disposer } from "../lib/Disposer.js";
import { UILib as UI } from "./lib/UILib.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { t } from "../i18n/index.js";

function nowStamp() { return new Date().toLocaleTimeString(); }

/** @param {string} s */
function encodeUTF8(s) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

/** @param {Uint8Array} b */
function decodeUTF8(b) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
  let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s;
}

/** @param {any} net @param {string} ck @param {{buf:Uint8Array}} st */
async function readLine(net, ck, st) {
  while (true) {
    const b = st.buf;
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 10) {
        const end = (i > 0 && b[i - 1] === 13) ? i - 1 : i;
        const line = decodeUTF8(b.slice(0, end));
        st.buf = b.slice(i + 1);
        return line;
      }
    }
    const part = await net.recvTCPConn(ck);
    if (part == null) return null;
    const m = new Uint8Array(b.length + part.length);
    m.set(b); m.set(part, b.length); st.buf = m;
    if (st.buf.length > 256 * 1024) return null;
  }
}

/** @param {string} line */
function parseIRC(line) {
  let pos = 0, prefix = "";
  if (line[0] === ":") {
    const sp = line.indexOf(" "); if (sp < 0) return null;
    prefix = line.slice(1, sp); pos = sp + 1;
  }
  const rest = line.slice(pos);
  const ti = rest.indexOf(" :");
  const trailing = ti >= 0 ? rest.slice(ti + 2) : null;
  const parts = (ti >= 0 ? rest.slice(0, ti) : rest).split(" ").filter(Boolean);
  if (!parts.length) return null;
  const params = parts.slice(1);
  if (trailing !== null) params.push(trailing);
  return { prefix, command: parts[0].toUpperCase(), params };
}

/**
 * @typedef {{ lines: {text:string, cls:string}[], users: Map<string,string>, topic: string, unread: number, displayName: string }} IRCBuffer
 */

export class SimpleIRCClientApp extends GenericProcess {
  get title() { return t("app.ircclient.title"); }

  icon = "fa-comments";
  badge = "IRC";

  disposer = new Disposer();

  // connection
  connected = false;
  nick = "user";
  server = "";
  port = 6667;
  /** @type {string|null} */ connKey = null;

  // buffers: lowercase key → IRCBuffer
  /** @type {Map<string, IRCBuffer>} */
  buffers = new Map();
  activeBuffer = "status";

  // UI refs
  /** @type {HTMLInputElement|null} */ serverEl = null;
  /** @type {HTMLInputElement|null} */ portEl = null;
  /** @type {HTMLInputElement|null} */ nickEl = null;
  /** @type {HTMLButtonElement|null} */ connectBtn = null;
  /** @type {HTMLButtonElement|null} */ disconnectBtn = null;
  /** @type {HTMLElement|null} */ sidebarEl = null;
  /** @type {HTMLElement|null} */ messagesEl = null;
  /** @type {HTMLElement|null} */ topicEl = null;
  /** @type {HTMLInputElement|null} */ inputEl = null;

  run() {
    this.root.classList.add("app", "app-irc-client");
    this._ensureBuffer("status", "status");
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();
    this._buildUI();
    this._syncButtons();
    this._renderSidebar();
    this._renderTopic();
    this._renderMessages();
  }

  onUnmount() {
    this.disposer.dispose();
    this.serverEl = null; this.portEl = null; this.nickEl = null;
    this.connectBtn = null; this.disconnectBtn = null;
    this.sidebarEl = null; this.messagesEl = null;
    this.topicEl = null; this.inputEl = null;
    super.onUnmount();
  }

  destroy() { this._disconnect(); super.destroy(); }

  // ───────── UI construction ─────────

  _buildUI() {
    const serverInput = UI.input({ placeholder: t("app.ircclient.placeholder.server"), value: this.server });
    const portInput   = UI.input({ placeholder: "6667", value: String(this.port) });
    const nickInput   = UI.input({ placeholder: t("app.ircclient.placeholder.nick"), value: this.nick });
    this.serverEl = serverInput; this.portEl = portInput; this.nickEl = nickInput;

    const connectBtn    = UI.button(t("app.ircclient.btn.connect"),    () => this._connectFromUI(), { primary: true });
    const disconnectBtn = UI.button(t("app.ircclient.btn.disconnect"), () => this._disconnect(), {});
    this.connectBtn = connectBtn; this.disconnectBtn = disconnectBtn;

    const connectBar = UI.el("div", { className: "irc-connect-bar", children: [
      UI.el("span", { className: "irc-connect-label", text: t("app.ircclient.label.server") }), serverInput,
      UI.el("span", { className: "irc-connect-label", text: t("app.ircclient.label.port")   }), portInput,
      UI.el("span", { className: "irc-connect-label", text: t("app.ircclient.label.nick")   }), nickInput,
      connectBtn, disconnectBtn,
    ]});

    const sidebar = UI.el("div", { className: "irc-sidebar" });
    this.sidebarEl = sidebar;

    const topicEl = UI.el("div", { className: "irc-topic" });
    this.topicEl = topicEl;

    const messagesEl = UI.el("div", { className: "irc-messages" });
    this.messagesEl = messagesEl;

    const inputEl = /** @type {HTMLInputElement} */ (UI.el("input", {
      className: "input",
      attrs: { type: "text", placeholder: t("app.ircclient.placeholder.input") },
      init: (el) => {
        el.addEventListener("keydown", (e) => {
          if (/** @type {KeyboardEvent} */(e).key === "Enter") this._sendInput();
        });
      },
    }));
    this.inputEl = inputEl;

    const sendBtn = UI.button(t("app.ircclient.btn.send"), () => this._sendInput(), { primary: true });

    const inputBar = UI.el("div", { className: "irc-input-bar", children: [inputEl, sendBtn] });

    const main = UI.el("div", { className: "irc-main", children: [topicEl, messagesEl, inputBar] });
    const body = UI.el("div", { className: "irc-body", children: [sidebar, main] });

    this.root.replaceChildren(connectBar, body);
  }

  // ───────── buffer management ─────────

  /**
   * @param {string} key   lowercase key
   * @param {string} displayName
   * @returns {IRCBuffer}
   */
  _ensureBuffer(key, displayName = key) {
    if (this.buffers.has(key)) return /** @type {IRCBuffer} */ (this.buffers.get(key));
    /** @type {IRCBuffer} */
    const buf = { lines: [], users: new Map(), topic: "", unread: 0, displayName };
    this.buffers.set(key, buf);
    if (this.mounted) this._renderSidebar();
    return buf;
  }

  /** @param {string} key */
  _switchBuffer(key) {
    const k = key.toLowerCase();
    if (k === this.activeBuffer) return;
    this.activeBuffer = k;
    const buf = this._ensureBuffer(k, key);
    buf.unread = 0;
    if (this.mounted) {
      this._renderSidebar();
      this._renderTopic();
      this._renderMessages();
    }
  }

  /**
   * @param {string} bufKey  lowercase key
   * @param {string} text
   * @param {string} [cls]
   */
  _appendMsg(bufKey, text, cls = "") {
    const k = bufKey.toLowerCase();
    const buf = this._ensureBuffer(k, bufKey);
    buf.lines.push({ text, cls });
    if (buf.lines.length > 1000) buf.lines.shift();

    if (k === this.activeBuffer) {
      if (this.messagesEl) {
        const div = document.createElement("div");
        div.className = "irc-line" + (cls ? " " + cls : "");
        div.textContent = text;
        this.messagesEl.appendChild(div);
        while (this.messagesEl.childElementCount > 1000)
          this.messagesEl.removeChild(/** @type {Node} */(this.messagesEl.firstElementChild));
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
    } else {
      buf.unread++;
      if (this.mounted) this._renderSidebar();
    }
  }

  // ───────── rendering ─────────

  _renderSidebar() {
    if (!this.sidebarEl) return;
    this.sidebarEl.replaceChildren();

    const order = ["status", ...[...this.buffers.keys()].filter(k => k !== "status").sort()];
    for (const key of order) {
      const buf = this.buffers.get(key); if (!buf) continue;
      const btn = document.createElement("button");
      btn.className = "irc-buf-btn" + (key === this.activeBuffer ? " active" : "") +
                      (buf.unread > 0 ? " unread" : "");
      btn.textContent = buf.displayName;
      if (buf.unread > 0) {
        const dot = document.createElement("span");
        dot.className = "irc-unread-dot";
        btn.appendChild(dot);
      }
      btn.addEventListener("click", () => this._switchBuffer(key));
      this.sidebarEl.appendChild(btn);
    }
  }

  _renderTopic() {
    if (!this.topicEl) return;
    const buf = this.buffers.get(this.activeBuffer);
    const userCount = buf ? buf.users.size : 0;
    const topic = buf?.topic ?? "";
    const userStr = userCount > 0 ? ` • ${t("app.ircclient.topic.users", { count: userCount })}` : "";
    this.topicEl.textContent = topic ? `${topic}${userStr}` : (userStr.trim() || "");
  }

  _renderMessages() {
    if (!this.messagesEl) return;
    const buf = this.buffers.get(this.activeBuffer);
    if (!buf) { this.messagesEl.replaceChildren(); return; }
    const frag = document.createDocumentFragment();
    for (const l of buf.lines) {
      const div = document.createElement("div");
      div.className = "irc-line" + (l.cls ? " " + l.cls : "");
      div.textContent = l.text;
      frag.appendChild(div);
    }
    this.messagesEl.replaceChildren(frag);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  _syncButtons() {
    if (this.connectBtn)    this.connectBtn.disabled    = this.connected;
    if (this.disconnectBtn) this.disconnectBtn.disabled = !this.connected;
    if (this.serverEl)      this.serverEl.disabled      = this.connected;
    if (this.portEl)        this.portEl.disabled        = this.connected;
    if (this.nickEl)        this.nickEl.disabled        = this.connected;
  }

  // ───────── connection ─────────

  async _connectFromUI() {
    const server = (this.serverEl?.value ?? "").trim();
    const portStr = (this.portEl?.value ?? "").trim();
    const nick = (this.nickEl?.value ?? "").trim();

    const port = Number(portStr);
    if (!server) { this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.noserver")}`, "irc-error"); return; }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.invalidport")}`, "irc-error"); return;
    }
    if (!nick || !/^[A-Za-z\[\]\\`^{}|_][A-Za-z0-9\[\]\\`^{}|_\-]{0,29}$/.test(nick)) {
      this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.invalidnick")}`, "irc-error"); return;
    }

    this.server = server; this.port = port; this.nick = nick;
    this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.status.connecting", { server, port })}`, "irc-system");

    // resolve IP
    let ip;
    try {
      ip = IPAddress.fromString(server);
    } catch {
      try {
        if (typeof this.os.dns?.resolveIP === "function") {
          ip = await this.os.dns.resolveIP(server);
        } else {
          const nums = await this.os.dns.resolveA(server);
          ip = nums?.length ? new IPAddress(4, nums[0] >>> 0) : null;
        }
      } catch { ip = null; }
    }
    if (!ip) {
      this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.resolve", { server })}`, "irc-error");
      return;
    }

    let ck;
    try {
      const conn = await this.os.net.connectTCPConn(ip, this.port);
      ck = conn?.key ?? null;
    } catch (e) {
      this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.connectfailed", { reason: e instanceof Error ? e.message : String(e) })}`, "irc-error");
      return;
    }
    if (!ck) {
      this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.nokey")}`, "irc-error");
      return;
    }

    this.connKey = ck;
    this.connected = true;
    if (this.mounted) this._syncButtons();

    // send registration
    this._sendRaw(`NICK ${this.nick}`);
    this._sendRaw(`USER ${this.nick} 0 * :${this.nick}`);

    this._recvLoop(ck);
  }

  _disconnect() {
    if (!this.connected && this.connKey == null) return;
    if (this.connKey) {
      try { this._sendRaw("QUIT :Goodbye"); } catch { /* ignore */ }
      try { this.os.net.closeTCPConn(this.connKey); } catch { /* ignore */ }
    }
    this.connKey = null;
    this.connected = false;
    // clear user lists
    for (const buf of this.buffers.values()) buf.users.clear();
    if (this.mounted) { this._syncButtons(); this._renderTopic(); }
    this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.status.disconnected")}`, "irc-system");
  }

  /** @param {string} line */
  _sendRaw(line) {
    if (!this.connKey) return;
    try { this.os.net.sendTCPConn(this.connKey, encodeUTF8(line + "\r\n")); } catch { /* ignore */ }
  }

  // ───────── receive loop ─────────

  /** @param {string} ck */
  async _recvLoop(ck) {
    const st = { buf: new Uint8Array(0) };
    while (this.connected && this.connKey === ck) {
      let line;
      try { line = await readLine(this.os.net, ck, st); }
      catch (e) {
        this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.recverror", { reason: e instanceof Error ? e.message : String(e) })}`, "irc-error");
        break;
      }
      if (line == null) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      const msg = parseIRC(trimmed);
      if (msg) this._handleMsg(msg);
    }
    if (this.connKey === ck) {
      this.connKey = null;
      this.connected = false;
      for (const buf of this.buffers.values()) buf.users.clear();
      if (this.mounted) { this._syncButtons(); this._renderTopic(); }
      this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.status.connectionclosed")}`, "irc-system");
    }
  }

  // ───────── message handling ─────────

  /** @param {{ prefix:string, command:string, params:string[] }} msg */
  _handleMsg(msg) {
    const { prefix, command, params } = msg;
    const num = Number(command);

    // PING
    if (command === "PING") { this._sendRaw(`PONG :${params[0] ?? ""}`); return; }

    // Numerics
    if (num >= 1 && num <= 999) { this._handleNumeric(num, prefix, params); return; }

    switch (command) {
      case "PRIVMSG": this._onPrivmsg(prefix, params); break;
      case "NOTICE":  this._onNotice(prefix, params); break;
      case "JOIN":    this._onJoin(prefix, params); break;
      case "PART":    this._onPart(prefix, params); break;
      case "QUIT":    this._onQuit(prefix, params); break;
      case "NICK":    this._onNick(prefix, params); break;
      case "TOPIC":   this._onTopic(prefix, params); break;
      case "KICK":    this._onKick(prefix, params); break;
      case "ERROR":   this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.servererror", { msg: params[0] ?? "" })}`, "irc-error"); this._disconnect(); break;
    }
  }

  /** @param {number} num @param {string} prefix @param {string[]} params */
  _handleNumeric(num, prefix, params) {
    // 001 - Welcome, nick confirmed
    if (num === 1) {
      if (params[0]) this.nick = params[0];
      this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.status.connected", { server: prefix, nick: this.nick })}`, "irc-system");
      return;
    }
    // 332 - TOPIC on join
    if (num === 332) {
      const chan = params[1] ?? "", topic = params[2] ?? "";
      const buf = this._ensureBuffer(chan.toLowerCase(), chan);
      buf.topic = topic;
      if (this.activeBuffer === chan.toLowerCase() && this.mounted) this._renderTopic();
      return;
    }
    // 353 - NAMES list
    if (num === 353) {
      const chan = params[2] ?? "";
      const buf = this._ensureBuffer(chan.toLowerCase(), chan);
      for (const n of (params[3] ?? "").split(" ").filter(Boolean)) {
        const mode = /^[@+]/.test(n) ? n[0] : "";
        buf.users.set(n.replace(/^[@+]/, ""), mode);
      }
      return;
    }
    // 366 - end of NAMES
    if (num === 366) {
      const chan = params[1] ?? "";
      if (this.activeBuffer === chan.toLowerCase() && this.mounted) this._renderTopic();
      return;
    }
    // 372/375/376 - MOTD
    if (num === 372 || num === 375) {
      this._appendMsg("status", `[${nowStamp()}] ${params.slice(1).join(" ")}`, "irc-motd");
      return;
    }
    if (num === 376 || num === 331 || num === 366) return; // suppress

    // 433 - nick in use
    if (num === 433) {
      this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.nickinuse", { nick: params[1] ?? "" })}`, "irc-error");
      return;
    }
    // 4xx/5xx errors
    if (num >= 400 && num <= 599) {
      this._appendMsg("status", `[${nowStamp()}] (${num}) ${params.slice(1).join(" ")}`, "irc-error");
      return;
    }
    // other: show in status
    const text = params.slice(1).join(" ");
    if (text) this._appendMsg("status", `[${nowStamp()}] ${text}`, "irc-system");
  }

  /** @param {string} prefix @param {string[]} p */
  _onPrivmsg(prefix, p) {
    const [target, rawText] = [p[0] ?? "", p[1] ?? ""];
    const fromNick = prefix.split("!")[0];
    const isAction = rawText.startsWith("\x01ACTION ") && rawText.endsWith("\x01");
    const text = isAction ? rawText.slice(8, -1) : rawText;
    const isChan = target.startsWith("#") || target.startsWith("&");
    const bufKey = isChan ? target.toLowerCase() : fromNick.toLowerCase();
    const bufDisplay = isChan ? target : fromNick;
    if (isAction) {
      this._appendMsg(bufKey, `[${nowStamp()}] * ${fromNick} ${text}`, "irc-action");
    } else {
      const cls = fromNick === this.nick ? "irc-mine" : "";
      this._appendMsg(bufKey, `[${nowStamp()}] <${fromNick}> ${text}`, cls);
      if (!isChan) this._ensureBuffer(bufKey, bufDisplay);
    }
  }

  /** @param {string} prefix @param {string[]} p */
  _onNotice(prefix, p) {
    const [target, text] = [p[0] ?? "", p[1] ?? ""];
    const from = prefix.split("!")[0] || prefix;
    const bufKey = (target.startsWith("#") || target.startsWith("&")) ? target.toLowerCase() : "status";
    this._appendMsg(bufKey, `[${nowStamp()}] -${from}- ${text}`, "irc-notice");
  }

  /** @param {string} prefix @param {string[]} p */
  _onJoin(prefix, p) {
    const chan = p[0] ?? "";
    const nick = prefix.split("!")[0];
    const key = chan.toLowerCase();
    if (nick === this.nick) {
      this._ensureBuffer(key, chan);
      this._switchBuffer(key);
      this._appendMsg(key, `[${nowStamp()}] ${t("app.ircclient.event.selfjoined", { chan })}`, "irc-system");
    } else {
      const buf = this._ensureBuffer(key, chan);
      buf.users.set(nick, "");
      this._appendMsg(key, `[${nowStamp()}] ${t("app.ircclient.event.userjoin", { nick, chan })}`, "irc-system");
      if (this.activeBuffer === key && this.mounted) this._renderTopic();
    }
  }

  /** @param {string} prefix @param {string[]} p */
  _onPart(prefix, p) {
    const chan = p[0] ?? "", reason = p[1] ?? "";
    const nick = prefix.split("!")[0];
    const key = chan.toLowerCase();
    if (nick === this.nick) {
      const buf = this.buffers.get(key); if (buf) buf.users.clear();
      this._appendMsg(key, `[${nowStamp()}] ${t("app.ircclient.event.selfpart", { chan })}`, "irc-system");
      this._switchBuffer("status");
    } else {
      const buf = this.buffers.get(key); if (buf) buf.users.delete(nick);
      this._appendMsg(key, `[${nowStamp()}] ${t("app.ircclient.event.userpart", { nick, chan })}${reason ? " (" + reason + ")" : ""}`, "irc-system");
      if (this.activeBuffer === key && this.mounted) this._renderTopic();
    }
  }

  /** @param {string} prefix @param {string[]} p */
  _onQuit(prefix, p) {
    const reason = p[0] ?? "";
    const nick = prefix.split("!")[0];
    for (const [key, buf] of this.buffers) {
      if (buf.users.has(nick)) {
        buf.users.delete(nick);
        this._appendMsg(key, `[${nowStamp()}] ${t("app.ircclient.event.userquit", { nick, reason })}`, "irc-system");
      }
    }
    if (this.mounted) this._renderTopic();
  }

  /** @param {string} prefix @param {string[]} p */
  _onNick(prefix, p) {
    const oldNick = prefix.split("!")[0], newNick = p[0] ?? "";
    if (oldNick === this.nick) {
      this.nick = newNick;
      this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.event.selfnick", { nick: newNick })}`, "irc-system");
    }
    for (const [key, buf] of this.buffers) {
      if (buf.users.has(oldNick)) {
        buf.users.delete(oldNick);
        buf.users.set(newNick, "");
        this._appendMsg(key, `[${nowStamp()}] ${t("app.ircclient.event.usernick", { oldNick, newNick })}`, "irc-system");
      }
    }
    if (this.mounted) this._renderTopic();
  }

  /** @param {string} prefix @param {string[]} p */
  _onTopic(prefix, p) {
    const chan = p[0] ?? "", topic = p[1] ?? "";
    const nick = prefix.split("!")[0];
    const key = chan.toLowerCase();
    const buf = this._ensureBuffer(key, chan);
    buf.topic = topic;
    this._appendMsg(key, `[${nowStamp()}] ${t("app.ircclient.event.topic", { nick, topic })}`, "irc-system");
    if (this.activeBuffer === key && this.mounted) this._renderTopic();
  }

  /** @param {string} prefix @param {string[]} p */
  _onKick(prefix, p) {
    const [chan, kicked, reason] = [p[0] ?? "", p[1] ?? "", p[2] ?? ""];
    const by = prefix.split("!")[0];
    const key = chan.toLowerCase();
    const buf = this.buffers.get(key); if (buf) buf.users.delete(kicked);
    this._appendMsg(key, `[${nowStamp()}] ${t("app.ircclient.event.kick", { kicked, by, reason })}`, "irc-system");
    if (kicked === this.nick) {
      const b = this.buffers.get(key); if (b) b.users.clear();
      this._switchBuffer("status");
    }
    if (this.activeBuffer === key && this.mounted) this._renderTopic();
  }

  // ───────── user input ─────────

  _sendInput() {
    const val = (this.inputEl?.value ?? "").trim();
    if (!val) return;
    if (this.inputEl) this.inputEl.value = "";

    if (val.startsWith("/")) {
      const spIdx = val.indexOf(" ");
      const cmd  = (spIdx > 0 ? val.slice(1, spIdx) : val.slice(1)).toLowerCase();
      const rest = spIdx > 0 ? val.slice(spIdx + 1) : "";
      this._handleCmd(cmd, rest);
    } else {
      if (!this.connected) { this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.notconnected")}`, "irc-error"); return; }
      if (this.activeBuffer === "status") { this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.err.nochan")}`, "irc-system"); return; }
      this._sendRaw(`PRIVMSG ${this.activeBuffer} :${val}`);
      this._appendMsg(this.activeBuffer, `[${nowStamp()}] <${this.nick}> ${val}`, "irc-mine");
    }
  }

  /**
   * @param {string} cmd
   * @param {string} rest
   */
  _handleCmd(cmd, rest) {
    switch (cmd) {
      case "join": {
        const target = rest.trim().split(" ")[0];
        if (target) this._sendRaw(`JOIN ${target}`);
        else this._appendMsg("status", t("app.ircclient.cmd.join.usage"), "irc-system");
        break;
      }
      case "part": {
        const target = this.activeBuffer.startsWith("#") ? this.activeBuffer : rest.trim().split(" ")[0];
        if (target) this._sendRaw(`PART ${target} :${rest || "Leaving"}`);
        break;
      }
      case "nick": {
        if (rest.trim()) this._sendRaw(`NICK ${rest.trim()}`);
        break;
      }
      case "msg":
      case "query": {
        const sp = rest.indexOf(" ");
        if (sp > 0) {
          const target = rest.slice(0, sp), text = rest.slice(sp + 1);
          this._sendRaw(`PRIVMSG ${target} :${text}`);
          this._appendMsg(target.toLowerCase(), `[${nowStamp()}] <${this.nick}> ${text}`, "irc-mine");
        } else this._appendMsg("status", t("app.ircclient.cmd.msg.usage"), "irc-system");
        break;
      }
      case "quit": {
        this._sendRaw(`QUIT :${rest || "Goodbye"}`);
        setTimeout(() => this._disconnect(), 200);
        break;
      }
      case "list":  this._sendRaw("LIST"); break;
      case "names": this._sendRaw(`NAMES ${rest || this.activeBuffer}`); break;
      case "topic": {
        const tgt = this.activeBuffer;
        if (tgt.startsWith("#")) this._sendRaw(rest ? `TOPIC ${tgt} :${rest}` : `TOPIC ${tgt}`);
        break;
      }
      case "me": {
        const tgt = this.activeBuffer;
        if (tgt && tgt !== "status" && this.connected) {
          this._sendRaw(`PRIVMSG ${tgt} :\x01ACTION ${rest}\x01`);
          this._appendMsg(tgt, `[${nowStamp()}] * ${this.nick} ${rest}`, "irc-action");
        }
        break;
      }
      case "whois": this._sendRaw(`WHOIS ${rest.trim()}`); break;
      default:
        this._appendMsg("status", `[${nowStamp()}] ${t("app.ircclient.cmd.unknown", { cmd })}`, "irc-system");
    }
  }
}
