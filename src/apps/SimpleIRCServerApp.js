//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { Disposer } from "../lib/Disposer.js";
import { UILib as UI } from "./lib/UILib.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { t } from "../i18n/index.js";
import { nowStamp, encodeUTF8, decodeUTF8 } from "../lib/helpers.js";

/**
 * Read one CRLF/LF terminated line from a TCP connection.
 * Returns null on EOF.
 * @param {any} net
 * @param {string} connKey
 * @param {{buf: Uint8Array}} state
 */
async function readLine(net, connKey, state) {
  while (true) {
    const b = state.buf;
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 10) { // LF
        const end = (i > 0 && b[i - 1] === 13) ? i - 1 : i;
        const line = decodeUTF8(b.slice(0, end));
        state.buf = b.slice(i + 1);
        return line;
      }
    }
    const part = await net.recvTCPConn(connKey);
    if (part == null) return null;
    const merged = new Uint8Array(b.length + part.length);
    merged.set(b); merged.set(part, b.length);
    state.buf = merged;
    if (state.buf.length > 256 * 1024) return null;
  }
}

/**
 * Parse one IRC message line into { prefix, command, params }.
 * @param {string} line
 * @returns {{ prefix: string, command: string, params: string[] }|null}
 */
function parseIRC(line) {
  let pos = 0, prefix = "";
  if (line[0] === ":") {
    const sp = line.indexOf(" ");
    if (sp < 0) return null;
    prefix = line.slice(1, sp); pos = sp + 1;
  }
  const rest = line.slice(pos);
  const ti = rest.indexOf(" :");
  const trailing = ti >= 0 ? rest.slice(ti + 2) : null;
  const parts = (ti >= 0 ? rest.slice(0, ti) : rest).split(" ").filter(Boolean);
  if (!parts.length) return null;
  const command = parts[0].toUpperCase();
  const params = parts.slice(1);
  if (trailing !== null) params.push(trailing);
  return { prefix, command, params };
}

/**
 * @typedef {{ nick: string, user: string, realname: string, registered: boolean, connKey: string }} IRCClient
 * @typedef {{ name: string, topic: string, members: Set<string> }} IRCChannel
 */

export class SimpleIRCServerApp extends LoggedProcess {
  get title() { return t("app.ircserver.title"); }
  icon = "fa-server";
  badge = "IRC";

  disposer = new Disposer();

  port = 6667;
  serverName = "irc.sim";
  motd = "Welcome to BeaverTracer IRC!";

  running = false;
  /** @type {number|null} */ serverRef = null;
  runSeq = 0;

  /** @type {Map<string, IRCClient>} connKey → client */
  clients = new Map();
  /** @type {Map<string, IRCChannel>} lowercase name → channel */
  channels = new Map();

  /** @type {HTMLElement|null} */ statusEl = null;
  /** @type {HTMLButtonElement|null} */ startBtn = null;
  /** @type {HTMLButtonElement|null} */ stopBtn = null;
  /** @type {HTMLInputElement|null} */ portEl = null;
  /** @type {HTMLInputElement|null} */ nameEl = null;
  /** @type {HTMLInputElement|null} */ motdEl = null;

  run() { this.root.classList.add("app", "app-irc-server"); }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const portInput = UI.input({ placeholder: "6667", value: String(this.port) });
    const nameInput = UI.input({ placeholder: "irc.sim", value: this.serverName });
    const motdInput = UI.input({ placeholder: "MOTD", value: this.motd });
    this.portEl = portInput; this.nameEl = nameInput; this.motdEl = motdInput;

    const start = UI.button(t("app.ircserver.btn.start"), () => this._startFromUI(), { primary: true });
    const stop  = UI.button(t("app.ircserver.btn.stop"),  () => this._stop(), {});
    this.startBtn = start; this.stopBtn = stop;

    const statusEl = UI.el("div", { className: "msg" });
    this.statusEl = statusEl;
    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const configPane = UI.el("div", { children: [
      UI.row(t("app.ircserver.row.port"), portInput),
      UI.row(t("app.ircserver.row.servername"), nameInput),
      UI.row(t("app.ircserver.row.motd"), motdInput),
      statusEl,
    ]});
    const logPane = UI.el("div", { children: [
      UI.buttonRow([UI.button(t("app.ircserver.btn.clearlog"), () => { this.log = []; this._renderLog(); }, {})]),
      logBox,
    ]});

    const { bar: tabBar } = UI.tabbedPane([
      { id: "config", label: t("app.ircserver.tab.config"), pane: configPane },
      { id: "log",    label: t("app.ircserver.tab.log"),    pane: logPane },
    ]);

    const panel = UI.panel([UI.buttonRow([start, stop]), tabBar, configPane, logPane]);
    this.root.replaceChildren(panel);

    this._syncButtons();
    this._renderLog();
    this._renderStatus();

    this.disposer.interval(() => this._renderStatus(), 500);
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl = null; this.statusEl = null;
    this.startBtn = null; this.stopBtn = null;
    this.portEl = null; this.nameEl = null; this.motdEl = null;
    super.onUnmount();
  }

  destroy() { this._stop(); super.destroy(); }

  _syncButtons() {
    if (this.startBtn) this.startBtn.disabled = this.running;
    if (this.stopBtn)  this.stopBtn.disabled  = !this.running;
    if (this.portEl)   this.portEl.disabled   = this.running;
    if (this.nameEl)   this.nameEl.disabled   = this.running;
    if (this.motdEl)   this.motdEl.disabled   = this.running;
  }

  _renderStatus() {
    if (!this.statusEl) return;
    const lines = [`running: ${this.running}`, `port: ${this.port}`, `clients: ${this.clients.size}`];
    for (const ch of this.channels.values()) lines.push(`  ${ch.name} (${ch.members.size} users)`);
    this.statusEl.textContent = lines.join("\n");
  }

  // ───────── lifecycle ─────────

  _startFromUI() {
    const p = Number((this.portEl?.value ?? "").trim());
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.invalidport")}`); return;
    }
    this.port = p;
    this.serverName = (this.nameEl?.value ?? "").trim() || "irc.sim";
    this.motd = (this.motdEl?.value ?? "").trim() || "Welcome!";
    this._start();
  }

  _start() {
    if (this.running) return;
    try {
      const ref = this.os.net.openTCPServerSocket(IPAddress.fromString("::"), this.port);
      this.serverRef = ref;
      this.running = true;
      const seq = ++this.runSeq;
      this._syncButtons();
      this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.listening", { port: this.port })}`);
      this._acceptLoop(seq, ref);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.startfailed", { reason })}`);
    }
  }

  _stop() {
    if (!this.running && this.serverRef == null) return;
    this.running = false;
    ++this.runSeq;
    const ref = this.serverRef; this.serverRef = null;

    for (const key of this.clients.keys()) {
      this._sendRaw(key, `:${this.serverName} ERROR :Server shutting down`);
      try { this.os.net.closeTCPConn(key); } catch { /* ignore */ }
    }
    this.clients.clear();
    this.channels.clear();

    if (ref != null) try { this.os.net.closeTCPServerSocket(ref); } catch { /* ignore */ }
    this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.stopped")}`);
    this._syncButtons();
    this._renderStatus();
  }

  // ───────── accept loop ─────────

  /** @param {number} seq @param {number} ref */
  async _acceptLoop(seq, ref) {
    while (this.running && this.runSeq === seq) {
      let connKey = null;
      try { connKey = await this.os.net.acceptTCPConn(ref); }
      catch (e) {
        if (this.running && this.runSeq === seq)
          this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.accepterror", { reason: e instanceof Error ? e.message : String(e) })}`);
        continue;
      }
      if (!this.running || this.runSeq !== seq) break;
      if (connKey == null) break;
      this._handleConn(seq, connKey).catch((e) => {
        this._removeClient(connKey);
        try { this.os.net.closeTCPConn(connKey); } catch { /* ignore */ }
      });
    }
  }

  /** @param {number} seq @param {string} connKey */
  async _handleConn(seq, connKey) {
    /** @type {IRCClient} */
    const client = { nick: "*", user: "", realname: "", registered: false, connKey };
    this.clients.set(connKey, client);
    this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.connect", { connKey })}`);

    const st = { buf: new Uint8Array(0) };
    while (this.running && this.runSeq === seq) {
      const line = await readLine(this.os.net, connKey, st);
      if (line == null) break;
      const msg = parseIRC(line.trim());
      if (msg) this._dispatch(connKey, client, msg);
    }
    this._quitClient(connKey, "Connection closed");
  }

  // ───────── dispatch ─────────

  /**
   * @param {string} ck
   * @param {IRCClient} cl
   * @param {{ prefix:string, command:string, params:string[] }} msg
   */
  _dispatch(ck, cl, msg) {
    switch (msg.command) {
      case "NICK":    this._cmdNICK(ck, cl, msg.params); break;
      case "USER":    this._cmdUSER(ck, cl, msg.params); break;
      case "JOIN":    this._cmdJOIN(ck, cl, msg.params); break;
      case "PART":    this._cmdPART(ck, cl, msg.params); break;
      case "PRIVMSG": this._cmdPRIVMSG(ck, cl, msg.params); break;
      case "NOTICE":  this._cmdNOTICE(ck, cl, msg.params); break;
      case "QUIT":    this._cmdQUIT(ck, cl, msg.params); break;
      case "PING":    this._sendRaw(ck, `:${this.serverName} PONG ${this.serverName} :${msg.params[0] ?? ""}`); break;
      case "PONG":    break;
      case "LIST":    this._cmdLIST(ck, cl); break;
      case "NAMES":   this._cmdNAMES(ck, cl, msg.params); break;
      case "TOPIC":   this._cmdTOPIC(ck, cl, msg.params); break;
      case "WHO":     this._cmdWHO(ck, cl, msg.params); break;
      case "WHOIS":   this._cmdWHOIS(ck, cl, msg.params); break;
      case "MODE":    this._cmdMODE(ck, cl, msg.params); break;
      case "CAP":     break; // ignore capability negotiation
      default: this._num(ck, cl, 421, `${msg.command} :Unknown command`);
    }
  }

  // ───────── helpers ─────────

  /** @param {string} ck @param {string} line */
  _sendRaw(ck, line) {
    try { this.os.net.sendTCPConn(ck, encodeUTF8(line + "\r\n")); } catch { /* ignore */ }
  }

  /** @param {string} ck @param {IRCClient} cl @param {number} n @param {string} text */
  _num(ck, cl, n, text) {
    this._sendRaw(ck, `:${this.serverName} ${String(n).padStart(3, "0")} ${cl.nick} ${text}`);
  }

  /** @param {IRCClient} c */ _mask(c) { return `${c.nick}!${c.user || "~u"}@sim`; }

  /**
   * @param {string} chKey lowercase channel key
   * @param {string} line
   * @param {string} [except]
   */
  _bcast(chKey, line, except = "") {
    const ch = this.channels.get(chKey);
    if (!ch) return;
    for (const k of ch.members) { if (k !== except) this._sendRaw(k, line); }
  }

  /** @param {string} ck */
  _removeClient(ck) {
    this.clients.delete(ck);
    for (const [key, ch] of this.channels) {
      ch.members.delete(ck);
      if (ch.members.size === 0) this.channels.delete(key);
    }
    this._renderStatus();
  }

  /** @param {string} ck @param {string} reason */
  _quitClient(ck, reason) {
    const cl = this.clients.get(ck);
    if (!cl) return;
    const quitLine = `:${this._mask(cl)} QUIT :${reason}`;
    const notified = new Set();
    for (const ch of this.channels.values()) {
      if (!ch.members.has(ck)) continue;
      for (const k of ch.members) { if (k !== ck && !notified.has(k)) { this._sendRaw(k, quitLine); notified.add(k); } }
    }
    this._removeClient(ck);
    this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.disconnect", { nick: cl.nick, reason })}`);
    try { this.os.net.closeTCPConn(ck); } catch { /* ignore */ }
  }

  // ───────── commands ─────────

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdNICK(ck, cl, p) {
    const n = p[0] ?? "";
    if (!n) { this._num(ck, cl, 431, ":No nickname given"); return; }
    if (!/^[A-Za-z\[\]\\`^{}|_][A-Za-z0-9\[\]\\`^{}|_\-]{0,29}$/.test(n)) {
      this._num(ck, cl, 432, `${n} :Erroneous nickname`); return;
    }
    for (const [, c] of this.clients) {
      if (c !== cl && c.nick.toLowerCase() === n.toLowerCase()) {
        this._num(ck, cl, 433, `${n} :Nickname in use`); return;
      }
    }
    const oldMask = cl.registered ? `:${this._mask(cl)}` : null;
    const oldNick = cl.nick;
    cl.nick = n;
    if (cl.registered) {
      const nickLine = `${oldMask} NICK :${n}`;
      const notified = new Set();
      for (const ch of this.channels.values()) {
        if (!ch.members.has(ck)) continue;
        for (const k of ch.members) { if (!notified.has(k)) { this._sendRaw(k, nickLine); notified.add(k); } }
      }
      if (!notified.has(ck)) this._sendRaw(ck, nickLine);
      this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.nickrename", { oldNick, newNick: n })}`);
    } else {
      this._tryRegister(ck, cl);
    }
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdUSER(ck, cl, p) {
    if (cl.registered) { this._num(ck, cl, 462, ":Already registered"); return; }
    if (p.length < 4)  { this._num(ck, cl, 461, "USER :Not enough parameters"); return; }
    cl.user = p[0]; cl.realname = p[3];
    this._tryRegister(ck, cl);
  }

  /** @param {string} ck @param {IRCClient} cl */
  _tryRegister(ck, cl) {
    if (cl.registered || cl.nick === "*" || !cl.user) return;
    cl.registered = true;
    const [sn, n] = [this.serverName, cl.nick];
    this._sendRaw(ck, `:${sn} 001 ${n} :Welcome to BeaverTracer IRC, ${this._mask(cl)}`);
    this._sendRaw(ck, `:${sn} 002 ${n} :Your host is ${sn}`);
    this._sendRaw(ck, `:${sn} 003 ${n} :This server was created just now`);
    this._sendRaw(ck, `:${sn} 004 ${n} ${sn} BeaverIRCd-1 o o`);
    this._sendRaw(ck, `:${sn} 375 ${n} :- ${sn} Message of the Day -`);
    this._sendRaw(ck, `:${sn} 372 ${n} :- ${this.motd}`);
    this._sendRaw(ck, `:${sn} 376 ${n} :End of MOTD`);
    this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.registered", { mask: this._mask(cl) })}`);
    this._renderStatus();
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdJOIN(ck, cl, p) {
    if (!cl.registered) return;
    for (const target of (p[0] ?? "").split(",")) {
      const name = target.trim();
      if (!name.startsWith("#") && !name.startsWith("&")) continue;
      if (name.length < 2 || name.length > 50) continue;
      const key = name.toLowerCase();
      let ch = this.channels.get(key);
      if (!ch) { ch = { name, topic: "", members: new Set() }; this.channels.set(key, ch); }
      if (ch.members.has(ck)) continue;
      ch.members.add(ck);
      const joinLine = `:${this._mask(cl)} JOIN :${ch.name}`;
      this._bcast(key, joinLine); this._sendRaw(ck, joinLine);
      this._num(ck, cl, ch.topic ? 332 : 331, `${ch.name} :${ch.topic || "No topic is set"}`);
      this._sendNamesTo(ck, cl, ch);
      this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.joined", { nick: cl.nick, channel: ch.name })}`);
      this._renderStatus();
    }
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdPART(ck, cl, p) {
    if (!cl.registered) return;
    const reason = p[1] ?? cl.nick;
    for (const target of (p[0] ?? "").split(",")) {
      const key = target.trim().toLowerCase();
      const ch = this.channels.get(key);
      if (!ch || !ch.members.has(ck)) { this._num(ck, cl, 442, `${target} :You're not on that channel`); continue; }
      const partLine = `:${this._mask(cl)} PART ${ch.name} :${reason}`;
      this._bcast(key, partLine); this._sendRaw(ck, partLine);
      ch.members.delete(ck);
      if (ch.members.size === 0) this.channels.delete(key);
      this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.parted", { nick: cl.nick, channel: ch.name })}`);
      this._renderStatus();
    }
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdPRIVMSG(ck, cl, p) {
    if (!cl.registered) return;
    const [target, text] = [p[0] ?? "", p[1] ?? ""];
    if (!target || !text) { this._num(ck, cl, 411, ":No recipient"); return; }
    const line = `:${this._mask(cl)} PRIVMSG ${target} :${text}`;
    if (target.startsWith("#") || target.startsWith("&")) {
      const ch = this.channels.get(target.toLowerCase());
      if (!ch) { this._num(ck, cl, 403, `${target} :No such channel`); return; }
      this._bcast(target.toLowerCase(), line, ck);
      this._appendLog(`[${nowStamp()}] ${t("app.ircserver.log.privmsg", { nick: cl.nick, target, text })}`);
    } else {
      const dest = [...this.clients.values()].find(c => c.nick.toLowerCase() === target.toLowerCase());
      if (!dest) { this._num(ck, cl, 401, `${target} :No such nick`); return; }
      this._sendRaw(dest.connKey, line);
    }
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdNOTICE(ck, cl, p) {
    if (!cl.registered) return;
    const [target, text] = [p[0] ?? "", p[1] ?? ""];
    if (!target || !text) return;
    const line = `:${this._mask(cl)} NOTICE ${target} :${text}`;
    if (target.startsWith("#") || target.startsWith("&")) {
      this._bcast(target.toLowerCase(), line, ck);
    } else {
      const dest = [...this.clients.values()].find(c => c.nick.toLowerCase() === target.toLowerCase());
      if (dest) this._sendRaw(dest.connKey, line);
    }
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdQUIT(ck, cl, p) {
    const reason = p[0] ?? "Quit";
    this._sendRaw(ck, `ERROR :Closing link: ${reason}`);
    this._quitClient(ck, reason);
  }

  /** @param {string} ck @param {IRCClient} cl */
  _cmdLIST(ck, cl) {
    this._num(ck, cl, 321, "Channel :Users  Topic");
    for (const ch of this.channels.values())
      this._num(ck, cl, 322, `${ch.name} ${ch.members.size} :${ch.topic}`);
    this._num(ck, cl, 323, ":End of LIST");
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdNAMES(ck, cl, p) {
    const target = p[0] ?? "";
    const chs = target ? [this.channels.get(target.toLowerCase())].filter(Boolean) : [...this.channels.values()];
    for (const ch of chs) if (ch) this._sendNamesTo(ck, cl, ch);
  }

  /**
   * @param {string} ck @param {IRCClient} cl
   * @param {IRCChannel} ch
   */
  _sendNamesTo(ck, cl, ch) {
    const nicks = [...ch.members].map(k => this.clients.get(k)?.nick ?? "").filter(Boolean);
    this._num(ck, cl, 353, `= ${ch.name} :${nicks.join(" ")}`);
    this._num(ck, cl, 366, `${ch.name} :End of NAMES`);
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdTOPIC(ck, cl, p) {
    const key = (p[0] ?? "").toLowerCase();
    const ch = this.channels.get(key);
    if (!ch) { this._num(ck, cl, 403, `${p[0]} :No such channel`); return; }
    if (!ch.members.has(ck)) { this._num(ck, cl, 442, `${ch.name} :You're not on that channel`); return; }
    if (p.length < 2) {
      this._num(ck, cl, ch.topic ? 332 : 331, `${ch.name} :${ch.topic || "No topic is set"}`);
    } else {
      ch.topic = p[1];
      this._bcast(key, `:${this._mask(cl)} TOPIC ${ch.name} :${ch.topic}`);
    }
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdWHO(ck, cl, p) {
    const key = (p[0] ?? "*").toLowerCase();
    const ch = this.channels.get(key);
    if (ch) for (const k of ch.members) {
      const c = this.clients.get(k); if (!c) continue;
      this._num(ck, cl, 352, `${ch.name} ${c.user || "~u"} sim ${this.serverName} ${c.nick} H :0 ${c.realname}`);
    }
    this._num(ck, cl, 315, `${p[0] ?? "*"} :End of WHO`);
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdWHOIS(ck, cl, p) {
    const target = p[0] ?? "";
    const dest = [...this.clients.values()].find(c => c.nick.toLowerCase() === target.toLowerCase());
    if (!dest) { this._num(ck, cl, 401, `${target} :No such nick`); return; }
    this._num(ck, cl, 311, `${dest.nick} ${dest.user || "~u"} sim * :${dest.realname}`);
    this._num(ck, cl, 318, `${dest.nick} :End of WHOIS`);
  }

  /** @param {string} ck @param {IRCClient} cl @param {string[]} p */
  _cmdMODE(ck, cl, p) {
    const target = p[0] ?? "";
    if (target.toLowerCase() === cl.nick.toLowerCase()) {
      this._num(ck, cl, 221, "+i");
    } else {
      const ch = this.channels.get(target.toLowerCase());
      if (ch) this._num(ck, cl, 324, `${ch.name} +`);
    }
  }
}
