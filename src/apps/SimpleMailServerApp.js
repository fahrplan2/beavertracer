//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { Disposer } from "../lib/Disposer.js";
import { UILib as UI } from "./lib/UILib.js";
import { IPAddress } from "../net/models/IPAddress.js";
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

function normalizeCRLF(s) {
  return String(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
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
    const tmr = setTimeout(() => reject(new Error(`timeout ${label} (${ms}ms)`)), Math.max(1, ms | 0));
    p.then(
      (v) => { clearTimeout(tmr); resolve(v); },
      (e) => { clearTimeout(tmr); reject(e); }
    );
  });
}

/**
 * Ensure directory exists (best-effort).
 * @param {any} fs
 * @param {string} dir
 */
function ensureDir(fs, dir) {
  try { if (typeof fs.mkdir === "function") fs.mkdir(dir, { recursive: true }); } catch { /* ignore */ }
}

/**
 * Read text file or null.
 * @param {any} fs
 * @param {string} path
 */
function readTextFile(fs, path) {
  try {
    if (typeof fs.exists === "function" && !fs.exists(path)) return null;
    if (typeof fs.readFile === "function") return String(fs.readFile(path));
  } catch { /* ignore */ }
  return null;
}

/**
 * Write text file (overwrites).
 * @param {any} fs
 * @param {string} path
 * @param {string} content
 */
function writeTextFile(fs, path, content) {
  if (typeof fs.writeFile !== "function") throw new Error("fs.writeFile not available");
  fs.writeFile(path, String(content));
}

/**
 * Append text (read+write fallback; VFS has no appendFile).
 * @param {any} fs
 * @param {string} path
 * @param {string} content
 */
function appendTextFile(fs, path, content) {
  const prev = (fs.exists(path) ? String(fs.readFile(path)) : "");
  fs.writeFile(path, prev + String(content));
}

/**
 * @param {string} s
 */
function parseEmailAddressLoose(s) {
  const m1 = /<([^>]+)>/.exec(s);
  const core = (m1 ? m1[1] : s).trim();
  const m2 = /([A-Za-z0-9._%+\-]+)@([A-Za-z0-9.\-]+\.[A-Za-z]{2,}|[A-Za-z0-9.\-]+)/.exec(core);
  if (!m2) return null;
  return { local: m2[1], domain: m2[2].toLowerCase(), addr: `${m2[1]}@${m2[2].toLowerCase()}` };
}

/**
 * Very small base64 decoder (ASCII) for AUTH demos.
 * @param {string} s
 */
function b64decodeToString(s) {
  try {
    // @ts-ignore
    if (typeof atob === "function") return atob(s);
  } catch { /* ignore */ }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let buffer = 0, bits = 0;
  for (const ch of String(s).replace(/[^A-Za-z0-9+/=]/g, "")) {
    if (ch === "=") break;
    const val = chars.indexOf(ch);
    if (val < 0) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * @param {string} s
 */
function b64encodeFromString(s) {
  try {
    // @ts-ignore
    if (typeof btoa === "function") return btoa(s);
  } catch { /* ignore */ }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let buffer = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    buffer = (buffer << 8) | (s.charCodeAt(i) & 0xff);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += chars[(buffer >> bits) & 0x3f];
    }
  }
  if (bits > 0) out += chars[(buffer << (6 - bits)) & 0x3f];
  while (out.length % 4) out += "=";
  return out;
}

/**
 * Read a CRLF line from a TCP connection with a rolling buffer.
 * Returns null on EOF.
 * @param {any} net
 * @param {string} connKey
 * @param {number} timeoutMs
 * @param {{buf: Uint8Array}} state
 */
async function readLineCRLF(net, connKey, timeoutMs, state) {
  const CR = 13, LF = 10;
  while (true) {
    const b = state.buf;
    for (let i = 0; i + 1 < b.length; i++) {
      if (b[i] === CR && b[i + 1] === LF) {
        const line = decodeUTF8(b.slice(0, i));
        state.buf = b.slice(i + 2);
        return line;
      }
    }

    const part = await withTimeout(net.recvTCPConn(connKey), timeoutMs, "recv");
    if (part == null) return null;

    const out = new Uint8Array(state.buf.length + part.length);
    out.set(state.buf, 0);
    out.set(part, state.buf.length);
    state.buf = out;

    if (state.buf.length > 512 * 1024) {
      state.buf = new Uint8Array(0);
      return "";
    }
  }
}

/**
 * Write a CRLF line.
 * @param {any} net
 * @param {string} connKey
 * @param {string} line
 */
function writeLine(net, connKey, line) {
  net.sendTCPConn(connKey, encodeUTF8(normalizeCRLF(line) + "\r\n"));
}

/**
 * Read SMTP response (consumes multiline 250- style).
 * @param {any} net
 * @param {string} connKey
 * @param {number} timeout
 * @param {{buf: Uint8Array}} st
 * @returns {Promise<{code:number, lines:string[]}>}
 */
async function readSmtpResponse(net, connKey, timeout, st) {
  const first = await readLineCRLF(net, connKey, timeout, st);
  if (first == null) throw new Error("smtp: remote closed");
  const lines = [first];
  const code = Number(first.slice(0, 3)) | 0;

  if (first.length >= 4 && first[3] === "-") {
    const endPrefix = String(code).padStart(3, "0") + " ";
    while (true) {
      const l2 = await readLineCRLF(net, connKey, timeout, st);
      if (l2 == null) throw new Error("smtp: remote closed");
      lines.push(l2);
      if (l2.startsWith(endPrefix)) break;
    }
  }
  return { code, lines };
}

/**
 * Dot-stuff message for SMTP DATA.
 * @param {string} msg
 */
function dotStuff(msg) {
  const crlf = normalizeCRLF(msg);
  const lines = crlf.split("\r\n").map((l) => (l.startsWith(".") ? "." + l : l));
  return lines.join("\r\n");
}

/**
 * Split mbox into messages by "From " separator lines.
 * Returns array of raw RFC822 text (without "From " line).
 * @param {string} mbox
 */
function parseMbox(mbox) {
  const text = String(mbox || "");
  if (!text.trim()) return [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  /** @type {string[]} */
  const msgs = [];
  /** @type {string[]} */
  let cur = [];

  const flush = () => {
    const m = cur.join("\n").trimEnd();
    if (m) msgs.push(m.replace(/\n/g, "\r\n"));
    cur = [];
  };

  for (const line of lines) {
    if (line.startsWith("From ")) {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  return msgs;
}

/**
 * @typedef {{user:string,password:string}} UserRow
 * @typedef {{mailDomain:string, ports:{smtp:number,pop3:number,imap:number}, users:UserRow[]}} MailConfig
 */

export class SimpleMailServerApp extends GenericProcess {
  get title() {
    return t("app.simplemailserver.title") || "Simple Mail Server";
  }

  /** @type {Disposer} */
  disposer = new Disposer();

  // persisted config
  mailDomain = "example.local";
  portSMTP = 25;
  portPOP3 = 110;
  portIMAP = 143;

  /** @type {Array<{user:string,password:string}>} */
  users = []; // start empty until one is added

  // paths
  configPath = "/etc/mail.conf";
  mailRoot = "/var/mail";
  queueRoot = "/var/mail/queue";

  // runtime
  running = false;
  /** @type {{smtp:number|null, pop3:number|null, imap:number|null}} */
  serverRef = { smtp: null, pop3: null, imap: null };
  runSeq = 0;

  // ui
  /** @type {HTMLElement|null} */ logEl = null;
  /** @type {HTMLElement|null} */ usersEl = null;

  /** @type {HTMLInputElement|null} */ domainEl = null;
  /** @type {HTMLInputElement|null} */ smtpEl = null;
  /** @type {HTMLInputElement|null} */ pop3El = null;
  /** @type {HTMLInputElement|null} */ imapEl = null;

  /** @type {HTMLInputElement|null} */ userEl = null;
  /** @type {HTMLInputElement|null} */ passEl = null;

  /** @type {HTMLButtonElement|null} */ startBtn = null;
  /** @type {HTMLButtonElement|null} */ stopBtn = null;

  /** @type {string[]} */
  log = [];

  run() {
    this.root.classList.add("app", "app-simple-mail-server");
  }

  _timeoutMs() {
    return 999999999;
  }

  _append(line) {
    this.log.push(line);
    if (this.log.length > 4000) this.log.splice(0, this.log.length - 4000);
    if (this.mounted) this._renderLog();
  }

  _renderLog() {
    if (!this.logEl) return;
    const maxLines = 400;
    const lines = this.log.length > maxLines ? this.log.slice(-maxLines) : this.log;
    this.logEl.textContent = lines.join("\n");
  }

  /** Create a nicer per-user UI list with action buttons */
  _renderUsers() {
    if (!this.usersEl) return;

    const wrap = UI.el("div", { className: "user-list" });

    const sorted = this.users.slice().sort((a, b) => a.user.localeCompare(b.user));
    if (sorted.length === 0) {
      wrap.appendChild(UI.el("div", { className: "msg", text: t("app.simplemailserver.users.none") || "(none)" }));
      this.usersEl.replaceChildren(wrap);
      return;
    }

    for (const u of sorted) {
      const mailCount = this._readMailbox(u.user).length;

      const title = UI.el("div", {
        className: "user-row-title",
        text: `${u.user}  (${mailCount})`,
      });

      const pw = UI.el("div", {
        className: "user-row-sub",
        text: t("app.simplemailserver.users.passwordHint") || "password set",
      });

      const seedBtn = UI.button(
        t("app.simplemailserver.users.seed") || "Seed test mail",
        () => this._seedUser(u.user),
        { primary: true }
      );

      const delBtn = UI.button(
        t("app.simplemailserver.users.delete") || "Delete",
        () => this._deleteUserByName(u.user),
        {}
      );

      const row = UI.el("div", {
        className: "user-row",
        children: [
          UI.el("div", { className: "user-row-left", children: [title, pw] }),
          UI.el("div", { className: "user-row-right", children: [seedBtn, delBtn] }),
        ],
      });

      wrap.appendChild(row);
    }

    this.usersEl.replaceChildren(wrap);
  }

  _syncUI() {
    const r = this.running;
    const dis = (el) => { if (el) el.disabled = r; };
    dis(this.domainEl);
    dis(this.smtpEl);
    dis(this.pop3El);
    dis(this.imapEl);

    if (this.startBtn) this.startBtn.disabled = r;
    if (this.stopBtn) this.stopBtn.disabled = !r;
  }

  _ensureDirs() {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;
    ensureDir(fs, "/etc");
    ensureDir(fs, "/var");
    ensureDir(fs, this.mailRoot);
    ensureDir(fs, this.queueRoot);
  }

  /** Load /etc/mail.conf (or create it). */
  _loadConfig() {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;

    this._ensureDirs();

    const raw = readTextFile(fs, this.configPath);
    if (!raw) {
      // write defaults (users empty)
      const cfg = /** @type {MailConfig} */ ({
        mailDomain: this.mailDomain,
        ports: { smtp: this.portSMTP, pop3: this.portPOP3, imap: this.portIMAP },
        users: this.users.slice(),
      });
      try {
        writeTextFile(fs, this.configPath, JSON.stringify(cfg, null, 2));
        this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.wroteDefaultConfig") || "wrote default config"}: ${this.configPath}`);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.cannotWriteConfig") || "cannot write config"}: ${reason}`);
      }
      return;
    }

    try {
      const cfg = /** @type {MailConfig} */ (JSON.parse(raw));
      if (cfg && typeof cfg === "object") {
        if (typeof cfg.mailDomain === "string" && cfg.mailDomain.trim()) {
          this.mailDomain = cfg.mailDomain.trim().toLowerCase();
        }
        if (cfg.ports && typeof cfg.ports === "object") {
          if (Number.isInteger(cfg.ports.smtp)) this.portSMTP = cfg.ports.smtp;
          if (Number.isInteger(cfg.ports.pop3)) this.portPOP3 = cfg.ports.pop3;
          if (Number.isInteger(cfg.ports.imap)) this.portIMAP = cfg.ports.imap;
        }
        if (Array.isArray(cfg.users)) {
          this.users = cfg.users
            .filter((u) => u && typeof u.user === "string" && typeof u.password === "string")
            .map((u) => ({ user: u.user, password: u.password }));
        } else {
          this.users = [];
        }
      }
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.loadedConfig") || "loaded config"}: ${this.configPath}`);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.invalidConfig") || "invalid config"}: ${reason}`);
    }
  }

  _saveConfig() {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;

    this._ensureDirs();

    const cfg = /** @type {MailConfig} */ ({
      mailDomain: this.mailDomain,
      ports: { smtp: this.portSMTP, pop3: this.portPOP3, imap: this.portIMAP },
      users: this.users.slice(),
    });
    try {
      writeTextFile(fs, this.configPath, JSON.stringify(cfg, null, 2));
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.savedConfig") || "saved config"}: ${this.configPath}`);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.saveFailed") || "save config failed"}: ${reason}`);
    }
  }

  /**
   * @param {string} user
   */
  _findUser(user) {
    const u = user.trim().toLowerCase();
    return this.users.find((x) => x.user.toLowerCase() === u) || null;
  }

  /**
   * @param {string} user
   * @param {string} pass
   */
  _auth(user, pass) {
    const u = this._findUser(user);
    if (!u) return false;
    return u.password === pass;
  }

  /**
   * Append a message to /var/mail/<user>.mbox
   * @param {string} user
   * @param {string} rawRfc822
   */
  _storeLocal(user, rawRfc822) {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;

    this._ensureDirs();

    const path = `${this.mailRoot}/${user}.mbox`;
    const stamp = new Date().toUTCString();
    const entry =
      `From relay@${this.mailDomain} ${stamp}\r\n` +
      normalizeCRLF(rawRfc822) +
      (String(rawRfc822).endsWith("\n") || String(rawRfc822).endsWith("\r\n") ? "" : "\r\n") +
      "\r\n";
    try {
      appendTextFile(fs, path, entry);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(`[${nowStamp()}] store mail failed (${path}): ${reason}`);
    }
  }

  /**
   * Read mailbox messages as RFC822 blocks.
   * @param {string} user
   * @returns {string[]}
   */
  _readMailbox(user) {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return [];
    const path = `${this.mailRoot}/${user}.mbox`;
    if (!fs.exists(path)) return [];
    try {
      const text = String(fs.readFile(path));
      return parseMbox(text);
    } catch {
      return [];
    }
  }

  /**
   * Rewrite mailbox from message blocks.
   * @param {string} user
   * @param {string[]} msgs
   */
  _writeMailbox(user, msgs) {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;
    const path = `${this.mailRoot}/${user}.mbox`;

    const stamp = new Date().toUTCString();
    let out = "";
    for (const m of msgs) {
      out += `From relay@${this.mailDomain} ${stamp}\r\n`;
      out += normalizeCRLF(m);
      out += (String(m).endsWith("\n") || String(m).endsWith("\r\n") ? "" : "\r\n");
      out += "\r\n";
    }
    try {
      fs.writeFile(path, out);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(`[${nowStamp()}] write mailbox failed (${path}): ${reason}`);
    }
  }

  /**
   * Queue outgoing relay as /var/mail/queue/<timestamp>_<safe>.eml
   * @param {string} rcptAddr
   * @param {string} rawRfc822
   * @param {string} reason
   */
  _queueOutgoing(rcptAddr, rawRfc822, reason) {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;
    this._ensureDirs();

    const ts = Date.now();
    const safe = rcptAddr.replace(/[^a-zA-Z0-9._@+-]+/g, "_");
    const path = `${this.queueRoot}/${ts}_${safe}.eml`;
    const blob =
      `X-Sim-Queue-Recipient: ${rcptAddr}\r\n` +
      `X-Sim-Queue-Reason: ${reason}\r\n` +
      normalizeCRLF(rawRfc822);

    try {
      fs.writeFile(path, blob);
    } catch (e) {
      const r = (e instanceof Error ? e.message : String(e));
      this._append(`[${nowStamp()}] queue write failed: ${r}`);
    }
  }

  /**
   * Resolve MX -> list of hostnames (ordered).
   * @param {string} domain
   * @returns {Promise<string[]>}
   */
  async _mxHosts(domain) {
    try {
      const mx = await this.os.dns.resolveMX(domain);
      const hosts = (mx || []).map((x) => String(x.exchange || "").trim()).filter(Boolean);
      if (hosts.length === 0) return [domain];
      return hosts;
    } catch {
      return [domain];
    }
  }

  /**
   * Resolve hostname to IPv4 address list using resolveA.
   * @param {string} host
   * @returns {Promise<IPAddress[]>}
   */
  async _resolveHostA(host) {
    const h = String(host).trim();
    const ipLiteral = IPAddress.fromString(h);
    if (ipLiteral.isV4() && ipLiteral.getNumber() !== 0) return [ipLiteral];

    try {
      const nums = await this.os.dns.resolveA(h);
      return (nums || []).map((n) => new IPAddress(4, (n >>> 0)));
    } catch {
      return [];
    }
  }

  /**
   * Relay one message to remote rcpt via MX/A + SMTP client.
   * @param {string} rcptAddr
   * @param {string} rawRfc822
   */
  async _relaySmtp(rcptAddr, rawRfc822) {
    const p = parseEmailAddressLoose(rcptAddr);
    if (!p) throw new Error("invalid rcpt");

    const mxHosts = await this._mxHosts(p.domain);

    let lastErr = null;

    for (const mxh of mxHosts) {
      const ips = await this._resolveHostA(mxh);
      if (ips.length === 0) {
        lastErr = new Error(`cannot resolve A for ${mxh}`);
        continue;
      }

      for (const ip of ips) {
        try {
          const connKey = await this.os.net.connectTCPConn(ip, 25);
          try {
            await this._smtpClientDeliver(connKey, rcptAddr, rawRfc822);
          } finally {
            try { this.os.net.closeTCPConn(connKey); } catch { /* ignore */ }
          }
          return;
        } catch (e) {
          lastErr = e;
        }
      }
    }

    throw (lastErr instanceof Error ? lastErr : new Error(String(lastErr)));
  }

  /**
   * Minimal SMTP client dialog: banner, EHLO, MAIL FROM, RCPT TO, DATA, QUIT.
   * @param {any} connKey
   * @param {string} rcptAddr
   * @param {string} rawRfc822
   */
  async _smtpClientDeliver(connKey, rcptAddr, rawRfc822) {
    const net = this.os.net;
    const timeout = this._timeoutMs();
    const st = { buf: new Uint8Array(0) };

    const expect = async (okCodes) => {
      const r = await readSmtpResponse(net, connKey, timeout, st);
      if (!okCodes.includes(r.code)) {
        throw new Error(`smtp remote error: ${r.lines.join(" | ")}`);
      }
      return r;
    };

    await expect([220]);

    writeLine(net, connKey, `EHLO ${this.mailDomain}`);
    await expect([250]);

    writeLine(net, connKey, `MAIL FROM:<postmaster@${this.mailDomain}>`);
    await expect([250]);

    writeLine(net, connKey, `RCPT TO:<${rcptAddr}>`);
    await expect([250, 251]);

    writeLine(net, connKey, `DATA`);
    await expect([354]);

    const stuffed = dotStuff(rawRfc822);
    net.sendTCPConn(connKey, encodeUTF8(normalizeCRLF(stuffed) + "\r\n.\r\n"));

    await expect([250]);

    writeLine(net, connKey, `QUIT`);
  }

  /**
   * Deliver local recipients and relay remote.
   * @param {string[]} rcptList
   * @param {string} rawRfc822
   */
  async _deliverOrRelay(rcptList, rawRfc822) {
    const localDomain = this.mailDomain.toLowerCase();

    /** @type {string[]} */
    const locals = [];
    /** @type {string[]} */
    const remotes = [];

    for (const r of rcptList) {
      const p = parseEmailAddressLoose(r);
      if (!p) continue;
      if (p.domain === localDomain) locals.push(p.local);
      else remotes.push(p.addr);
    }

    for (const user of locals) {
      if (!this._findUser(user)) {
        this._append(`[${nowStamp()}] local delivery failed: unknown user ${user}@${localDomain}`);
        continue;
      }
      this._storeLocal(user, rawRfc822);
      this._append(`[${nowStamp()}] local delivered: ${user}@${localDomain}`);
    }

    for (const addr of remotes) {
      try {
        await this._relaySmtp(addr, rawRfc822);
        this._append(`[${nowStamp()}] relayed: ${addr}`);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._append(`[${nowStamp()}] relay failed: ${addr} (${reason})`);
        this._queueOutgoing(addr, rawRfc822, reason);
      }
    }
  }

  // ---------------- UI ----------------

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    // load persisted config
    this._loadConfig();

    const domainInput = UI.input({ placeholder: t("app.simplemailserver.placeholder.domain") || "maildomain", value: this.mailDomain });
    const smtpInput = UI.input({ placeholder: "25", value: String(this.portSMTP) });
    const pop3Input = UI.input({ placeholder: "110", value: String(this.portPOP3) });
    const imapInput = UI.input({ placeholder: "143", value: String(this.portIMAP) });

    this.domainEl = domainInput;
    this.smtpEl = smtpInput;
    this.pop3El = pop3Input;
    this.imapEl = imapInput;

    const start = UI.button(t("app.simplemailserver.button.start") || "Start", () => this._startFromUI(), { primary: true });
    const stop = UI.button(t("app.simplemailserver.button.stop") || "Stop", () => this._stop(), {});
    this.startBtn = start;
    this.stopBtn = stop;

    const userInput = UI.input({ placeholder: t("app.simplemailserver.placeholder.user") || "user", value: "" });
    const passInput = UI.input({ placeholder: t("app.simplemailserver.placeholder.password") || "password", value: "" });
    this.userEl = userInput;
    this.passEl = passInput;

    const addBtn = UI.button(t("app.simplemailserver.button.addOrUpdate") || "Add/Update", () => this._addOrUpdateUser(), {});
    const delBtn = UI.button(t("app.simplemailserver.button.delete") || "Delete", () => this._deleteUser(), {});
    const clearQueueBtn = UI.button(t("app.simplemailserver.button.clearQueue") || "Clear queue", () => this._clearQueue(), {});
    const seedBtn = UI.button(t("app.simplemailserver.button.seedDefault") || "Seed test mail", () => this._seed(), {});

    const usersBox = UI.el("div", { className: "user-list-container" });
    this.usersEl = usersBox;

    const status = UI.el("div", { className: "msg" });

    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const panel = UI.panel([
      UI.row(t("app.simplemailserver.label.domain") || "Maildomain", domainInput),
      UI.row(t("app.simplemailserver.label.smtpPort") || "SMTP port", smtpInput),
      UI.row(t("app.simplemailserver.label.pop3Port") || "POP3 port", pop3Input),
      UI.row(t("app.simplemailserver.label.imapPort") || "IMAP port", imapInput),

      UI.buttonRow([
        start,
        stop,
        UI.button(t("app.simplemailserver.button.saveConfig") || "Save config", () => this._saveConfig(), {}),
      ]),

      UI.el("div", { text: t("app.simplemailserver.label.users") || "Mailboxes" }),
      UI.row(t("app.simplemailserver.label.user") || "User", userInput),
      UI.row(t("app.simplemailserver.label.password") || "Password", passInput),
      UI.buttonRow([addBtn, delBtn, seedBtn, clearQueueBtn]),
      usersBox,

      UI.el("div", { text: t("app.simplemailserver.label.status") || "Status" }),
      status,

      UI.el("div", { text: t("app.simplemailserver.label.log") || "Log" }),
      logBox,
    ]);

    this.root.replaceChildren(panel);
    this._renderUsers();
    this._syncUI();
    this._renderLog();

    this.disposer.interval(() => {
      status.textContent =
        `${t("app.simplemailserver.status.running") || "running"}: ${this.running}\n` +
        `${t("app.simplemailserver.status.domain") || "maildomain"}: ${this.mailDomain}\n` +
        `${t("app.simplemailserver.status.ports") || "ports"}: smtp=${this.portSMTP} pop3=${this.portPOP3} imap=${this.portIMAP}\n` +
        `${t("app.simplemailserver.status.users") || "users"}: ${this.users.length}\n`;
    }, 300);
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl = null;
    this.usersEl = null;

    this.domainEl = null;
    this.smtpEl = null;
    this.pop3El = null;
    this.imapEl = null;

    this.userEl = null;
    this.passEl = null;

    this.startBtn = null;
    this.stopBtn = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    super.destroy();
  }

  _addOrUpdateUser() {
    const user = (this.userEl?.value ?? "").trim();
    const pass = (this.passEl?.value ?? "").trim();
    if (!user) { this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.userMissing") || "user missing"}`); return; }
    if (!pass) { this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.passwordMissing") || "password missing"}`); return; }

    const existing = this._findUser(user);
    if (existing) {
      existing.password = pass;
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.userUpdated") || "updated user"} ${user}`);
    } else {
      this.users.push({ user, password: pass });
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.userAdded") || "added user"} ${user}`);
    }
    this._renderUsers();
    this._saveConfig();
  }

  _deleteUser() {
    const user = (this.userEl?.value ?? "").trim();
    if (!user) { this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.userMissing") || "user missing"}`); return; }
    this._deleteUserByName(user);
  }

  /** @param {string} user */
  _deleteUserByName(user) {
    const before = this.users.length;
    this.users = this.users.filter((u) => u.user.toLowerCase() !== user.toLowerCase());
    if (this.users.length !== before) {
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.userDeleted") || "deleted user"} ${user}`);
      this._renderUsers();
      this._saveConfig();
    } else {
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.userNotFound") || "user not found"} ${user}`);
    }
  }

  _clearQueue() {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;
    this._ensureDirs();
    try {
      const items = fs.exists(this.queueRoot) ? fs.readdir(this.queueRoot) : [];
      for (const name of items) {
        const p = `${this.queueRoot}/${name}`;
        try { fs.unlink(p); } catch { /* ignore */ }
      }
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.queueCleared") || "cleared queue"} (${items.length} files)`);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.clearQueueFailed") || "clear queue failed"}: ${reason}`);
    }
  }

  /** Old “seed” button: seed selected user if present, else do nothing helpful. */
  _seed() {
    const user = (this.userEl?.value ?? "").trim();
    if (user) {
      this._seedUser(user);
      return;
    }
    this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.seedNeedUser") || "seed: enter a user or use the per-user Seed button"}`);
  }

  /** Seed a test mail for a specific user */
  _seedUser(user) {
    const u = this._findUser(user);
    if (!u) { this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.seedNoSuchUser") || "seed: no such user"} ${user}`); return; }

    const msg =
      `From: test@${this.mailDomain}\r\n` +
      `To: ${u.user}@${this.mailDomain}\r\n` +
      `Subject: Test mail for ${u.user}\r\n` +
      `Date: ${new Date().toUTCString()}\r\n` +
      `\r\n` +
      `Hello ${u.user},\r\n` +
      `\r\n` +
      `this is a seeded test message.\r\n`;

    this._storeLocal(u.user, msg);
    this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.seeded") || "seeded test mail"} -> ${u.user}`);
    this._renderUsers();
  }

  _startFromUI() {
    const domain = (this.domainEl?.value ?? "").trim().toLowerCase();
    const smtp = Number((this.smtpEl?.value ?? "").trim());
    const pop3 = Number((this.pop3El?.value ?? "").trim());
    const imap = Number((this.imapEl?.value ?? "").trim());

    const okPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

    if (!domain) { this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.invalidDomain") || "invalid maildomain"}`); return; }
    if (!okPort(smtp) || !okPort(pop3) || !okPort(imap)) {
      this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.invalidPorts") || "invalid ports"} (smtp=${smtp} pop3=${pop3} imap=${imap})`);
      return;
    }

    this.mailDomain = domain;
    this.portSMTP = smtp;
    this.portPOP3 = pop3;
    this.portIMAP = imap;
    this._saveConfig();

    this._start();
  }

  _stop() {
    if (!this.running) return;
    this.running = false;
    this.runSeq++;

    const { smtp, pop3, imap } = this.serverRef;
    this.serverRef = { smtp: null, pop3: null, imap: null };

    const close = (ref, name) => {
      if (ref == null) return;
      try { this.os.net.closeTCPServerSocket(ref); }
      catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._append(`[${nowStamp()}] stop ${name} error: ${reason}`);
      }
    };
    close(smtp, "smtp");
    close(pop3, "pop3");
    close(imap, "imap");

    this._append(`[${nowStamp()}] ${t("app.simplemailserver.log.stopped") || "stopped"}`);
    this._syncUI();
  }

  _start() {
    if (this.running) return;

    this._ensureDirs();

    let smtpRef = null, pop3Ref = null, imapRef = null;
    try {
      smtpRef = this.os.net.openTCPServerSocket(new IPAddress(4, 0), this.portSMTP);
      pop3Ref = this.os.net.openTCPServerSocket(new IPAddress(4, 0), this.portPOP3);
      imapRef = this.os.net.openTCPServerSocket(new IPAddress(4, 0), this.portIMAP);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(`[${nowStamp()}] open socket error: ${reason}`);
      try { if (smtpRef != null) this.os.net.closeTCPServerSocket(smtpRef); } catch {}
      try { if (pop3Ref != null) this.os.net.closeTCPServerSocket(pop3Ref); } catch {}
      try { if (imapRef != null) this.os.net.closeTCPServerSocket(imapRef); } catch {}
      return;
    }

    this.serverRef = { smtp: smtpRef, pop3: pop3Ref, imap: imapRef };
    this.running = true;
    const seq = ++this.runSeq;
    this._syncUI();

    this._append(
      `[${nowStamp()}] ${t("app.simplemailserver.log.listening") || "listening"}: ` +
      `smtp=${this.portSMTP} pop3=${this.portPOP3} imap=${this.portIMAP} domain=${this.mailDomain}`
    );

    this._acceptLoop(seq, smtpRef, "smtp");
    this._acceptLoop(seq, pop3Ref, "pop3");
    this._acceptLoop(seq, imapRef, "imap");
  }

  /**
   * @param {number} seq
   * @param {number} ref
   * @param {"smtp"|"pop3"|"imap"} proto
   */
  async _acceptLoop(seq, ref, proto) {
    while (this.running && this.runSeq === seq) {
      /** @type {string|null} */
      let connKey = null;
      try {
        connKey = await this.os.net.acceptTCPConn(ref);
      } catch (e) {
        if (this.running && this.runSeq === seq) {
          const reason = (e instanceof Error ? e.message : String(e));
          this._append(`[${nowStamp()}] accept ${proto} error: ${reason}`);
        }
        continue;
      }

      if (!this.running || this.runSeq !== seq) break;
      if (connKey == null) break;

      const h =
        proto === "smtp" ? this._handleSMTP.bind(this) :
        proto === "pop3" ? this._handlePOP3.bind(this) :
        this._handleIMAP.bind(this);

      h(seq, connKey).catch((e) => {
        const reason = (e instanceof Error ? e.message : String(e));
        this._append(`[${nowStamp()}] conn ${proto} error: ${reason}`);
        try { this.os.net.closeTCPConn(connKey); } catch { /* ignore */ }
      });
    }
  }

  // ---------------- SMTP (Server) ----------------

  /**
   * SMTP server handler, minimal subset:
   * EHLO/HELO, NOOP, RSET, QUIT,
   * MAIL FROM, RCPT TO, DATA
   * Also accepts AUTH PLAIN/LOGIN as optional educational extension
   * but does not require it.
   * @param {number} seq
   * @param {string} connKey
   */
  async _handleSMTP(seq, connKey) {
    const net = this.os.net;
    const timeout = this._timeoutMs();
    const st = { buf: new Uint8Array(0) };

    const send = (line) => writeLine(net, connKey, line);

    send(`220 ${this.mailDomain} SimpleMailServer ready`);

    /** @type {string|null} */
    let heloName = null;

    /** @type {string|null} */
    let mailFrom = null;

    /** @type {string[]} */
    let rcptTo = [];

    /** @type {string|null} */
    let authedUser = null;

    const resetTx = () => { mailFrom = null; rcptTo = []; };

    while (this.running && this.runSeq === seq) {
      const line = await readLineCRLF(net, connKey, timeout, st);
      if (line == null) break;

      const raw = line;
      const cmd = raw.trim();

      if (!cmd) { send("500 empty"); continue; }

      const upper = cmd.toUpperCase();

      if (upper.startsWith("EHLO ")) {
        heloName = cmd.slice(5).trim();
        send(`250-${this.mailDomain}`);
        send("250-SIZE 1048576");
        send("250-8BITMIME");
        send("250-PIPELINING");
        send("250-AUTH PLAIN LOGIN");
        send("250 OK");
        continue;
      }

      if (upper.startsWith("HELO ")) {
        heloName = cmd.slice(5).trim();
        send(`250 ${this.mailDomain} Hello ${heloName}`);
        continue;
      }

      if (upper === "NOOP") { send("250 OK"); continue; }
      if (upper === "RSET") { resetTx(); send("250 OK"); continue; }
      if (upper === "QUIT") { send("221 Bye"); break; }

      if (upper.startsWith("AUTH PLAIN")) {
        const parts = cmd.split(/\s+/);
        const b64 = parts[2] || "";
        const decoded = b64decodeToString(b64);
        const seg = decoded.split("\u0000");
        const user = seg.length >= 2 ? seg[seg.length - 2] : "";
        const pass = seg.length >= 1 ? seg[seg.length - 1] : "";
        if (user && this._auth(user, pass)) {
          authedUser = user;
          send("235 2.7.0 Authentication successful");
        } else {
          send("535 5.7.8 Authentication failed");
        }
        continue;
      }

      if (upper === "AUTH LOGIN") {
        send("334 " + b64encodeFromString("Username:"));
        const u1 = await readLineCRLF(net, connKey, timeout, st);
        if (u1 == null) break;
        const user = b64decodeToString(u1.trim());
        send("334 " + b64encodeFromString("Password:"));
        const p1 = await readLineCRLF(net, connKey, timeout, st);
        if (p1 == null) break;
        const pass = b64decodeToString(p1.trim());
        if (user && this._auth(user, pass)) {
          authedUser = user;
          send("235 2.7.0 Authentication successful");
        } else {
          send("535 5.7.8 Authentication failed");
        }
        continue;
      }

      if (upper.startsWith("MAIL FROM:")) {
        mailFrom = cmd.slice(10).trim();
        rcptTo = [];
        send("250 OK");
        continue;
      }

      if (upper.startsWith("RCPT TO:")) {
        const r = cmd.slice(8).trim();
        rcptTo.push(r);
        send("250 OK");
        continue;
      }

      if (upper === "DATA") {
        if (!mailFrom || rcptTo.length === 0) {
          send("503 5.5.1 Need MAIL FROM and RCPT TO first");
          continue;
        }
        send("354 End data with <CR><LF>.<CR><LF>");

        /** @type {string[]} */
        const dataLines = [];
        while (true) {
          const l = await readLineCRLF(net, connKey, timeout, st);
          if (l == null) { break; }
          if (l === ".") break;
          dataLines.push(l.startsWith("..") ? l.slice(1) : l);
        }

        let msg = dataLines.join("\r\n");
        if (!/^\s*Date:/im.test(msg)) msg = `Date: ${new Date().toUTCString()}\r\n` + msg;
        if (!/^\s*From:/im.test(msg)) msg = `From: ${mailFrom}\r\n` + msg;
        if (!/^\s*To:/im.test(msg)) msg = `To: ${rcptTo.join(", ")}\r\n` + msg;

        try {
          await this._deliverOrRelay(rcptTo, msg);
          send("250 2.0.0 OK queued");
          this._append(`[${nowStamp()}] SMTP accepted: from=${mailFrom} rcpt=${rcptTo.length} helo=${heloName ?? "-"} auth=${authedUser ?? "-"}`);
        } catch (e) {
          const reason = (e instanceof Error ? e.message : String(e));
          send("451 4.3.0 Local error in processing");
          this._append(`[${nowStamp()}] SMTP processing error: ${reason}`);
        }

        resetTx();
        continue;
      }

      send("500 5.5.2 Command unrecognized");
    }

    try { net.closeTCPConn(connKey); } catch { /* ignore */ }
  }

  // ---------------- POP3 (Server) ----------------

  /**
   * POP3 subset: USER PASS STAT LIST RETR DELE NOOP RSET QUIT
   * Protocol strings are in English (not t()).
   * @param {number} seq
   * @param {string} connKey
   */
  async _handlePOP3(seq, connKey) {
    const net = this.os.net;
    const timeout = this._timeoutMs();
    const st = { buf: new Uint8Array(0) };

    const send = (line) => writeLine(net, connKey, line);

    // More verbose greeting
    send(`+OK ${this.mailDomain} POP3 ready - authenticate with USER/PASS`);

    let state = "AUTH"; // AUTH | TRANSACTION
    let user = "";
    let authed = false;

    /** @type {string[]} */
    let msgs = [];
    /** @type {Set<number>} */
    let del = new Set(); // indices marked deleted (0-based)

    const loadMailbox = () => {
      msgs = this._readMailbox(user);
      del = new Set();
    };

    const liveMsgs = () => msgs.filter((_, i) => !del.has(i));

    while (this.running && this.runSeq === seq) {
      const line = await readLineCRLF(net, connKey, timeout, st);
      if (line == null) break;

      const cmd = line.trim();
      const parts = cmd.split(/\s+/);
      const op = (parts[0] || "").toUpperCase();
      const arg = parts.slice(1).join(" ");

      if (op === "QUIT") {
        if (authed && del.size > 0) {
          const kept = msgs.filter((_, i) => !del.has(i));
          this._writeMailbox(user, kept);
        }
        send("+OK Goodbye");
        break;
      }

      if (state === "AUTH") {
        if (op === "USER") {
          user = arg.trim();
          if (!user) { send("-ERR Missing username. Usage: USER <name>"); continue; }
          if (!this._findUser(user)) { send("-ERR No such mailbox. Create it in the server UI first."); continue; }
          send("+OK User accepted. Enter your password with PASS.");
          continue;
        }
        if (op === "PASS") {
          const pass = arg;
          if (!user) { send("-ERR Send USER first, then PASS."); continue; }
          if (!pass) { send("-ERR Missing password. Usage: PASS <password>"); continue; }
          if (!this._auth(user, pass)) { send("-ERR Authentication failed. Check username/password."); continue; }
          authed = true;
          state = "TRANSACTION";
          loadMailbox();
          send("+OK Authentication successful. Mailbox locked and ready.");
          continue;
        }
        send("-ERR Not authenticated. Use USER/PASS first.");
        continue;
      }

      // TRANSACTION commands
      if (op === "STAT") {
        const live = liveMsgs();
        const octets = live.reduce((a, m) => a + encodeUTF8(m).length, 0);
        send(`+OK ${live.length} ${octets} (messages octets)`);
        continue;
      }

      if (op === "LIST") {
        if (!arg) {
          const live = liveMsgs();
          send(`+OK ${live.length} messages`);
          for (let i = 0; i < msgs.length; i++) {
            if (del.has(i)) continue;
            send(`${i + 1} ${encodeUTF8(msgs[i]).length}`);
          }
          send(".");
        } else {
          const n = Number(arg) | 0;
          if (n < 1 || n > msgs.length || del.has(n - 1)) { send("-ERR No such message."); continue; }
          send(`+OK ${n} ${encodeUTF8(msgs[n - 1]).length}`);
        }
        continue;
      }

      if (op === "RETR") {
        const n = Number(arg) | 0;
        if (n < 1 || n > msgs.length || del.has(n - 1)) { send("-ERR No such message. Usage: RETR <n>"); continue; }
        const msg = normalizeCRLF(msgs[n - 1]);
        send(`+OK Message follows (${encodeUTF8(msg).length} octets)`);
        const stuffed = msg.split("\r\n").map(l => (l.startsWith(".") ? "." + l : l)).join("\r\n");
        net.sendTCPConn(connKey, encodeUTF8(stuffed + "\r\n.\r\n"));
        continue;
      }

      if (op === "DELE") {
        const n = Number(arg) | 0;
        if (n < 1 || n > msgs.length || del.has(n - 1)) { send("-ERR No such message. Usage: DELE <n>"); continue; }
        del.add(n - 1);
        send("+OK Message marked for deletion (will be removed on QUIT).");
        continue;
      }

      if (op === "RSET") {
        del = new Set();
        send("+OK Deletion marks cleared.");
        continue;
      }

      if (op === "NOOP") { send("+OK"); continue; }

      send(`-ERR Unknown command "${op}". Try STAT, LIST, RETR, DELE, RSET, NOOP, QUIT.`);
    }

    try { net.closeTCPConn(connKey); } catch { /* ignore */ }
  }

  // ---------------- IMAP (Server) ----------------

  /**
   * Very minimal IMAP4-ish:
   * - LOGIN user pass
   * - SELECT INBOX
   * - SEARCH ALL
   * - FETCH <seq> BODY[]
   * - STORE <seq> +FLAGS (\Seen)
   * - LOGOUT
   * @param {number} seq
   * @param {string} connKey
   */
  async _handleIMAP(seq, connKey) {
    const net = this.os.net;
    const timeout = this._timeoutMs();
    const st = { buf: new Uint8Array(0) };
    const send = (line) => writeLine(net, connKey, line);

    send(`* OK ${this.mailDomain} IMAP ready`);

    let authed = false;
    let user = "";
    /** @type {string[]} */
    let msgs = [];
    /** @type {Set<number>} */
    let seen = new Set(); // message indices 0-based

    const loadMailbox = () => {
      msgs = this._readMailbox(user);
      seen = new Set();
    };

    while (this.running && this.runSeq === seq) {
      const line = await readLineCRLF(net, connKey, timeout, st);
      if (line == null) break;
      const raw = line.trimEnd();
      if (!raw) continue;

      const parts = raw.split(/\s+/);
      const tag = parts[0] || "A";
      const cmd = (parts[1] || "").toUpperCase();
      const rest = parts.slice(2);

      if (cmd === "LOGOUT") {
        send("* BYE logging out");
        send(`${tag} OK LOGOUT completed`);
        break;
      }

      if (cmd === "NOOP") {
        send(`${tag} OK NOOP completed`);
        continue;
      }

      if (!authed) {
        if (cmd === "LOGIN") {
          const u = rest[0] || "";
          const p = rest[1] || "";
          if (!u || !p) { send(`${tag} NO LOGIN failed`); continue; }
          if (!this._auth(u, p)) { send(`${tag} NO LOGIN failed`); continue; }
          authed = true;
          user = u;
          loadMailbox();
          send(`${tag} OK LOGIN completed`);
          continue;
        }
        send(`${tag} NO authenticate first`);
        continue;
      }

      if (cmd === "SELECT") {
        const mbox = (rest[0] || "").toUpperCase();
        if (mbox !== "INBOX") { send(`${tag} NO only INBOX supported`); continue; }

        const exists = msgs.length;
        send(`* ${exists} EXISTS`);
        send(`* ${exists} RECENT`);
        send(`* OK [UIDVALIDITY 1]`);
        send(`${tag} OK [READ-WRITE] SELECT completed`);
        continue;
      }

      if (cmd === "SEARCH") {
        const what = (rest[0] || "").toUpperCase();
        if (what !== "ALL") { send(`${tag} NO only SEARCH ALL supported`); continue; }
        const seqs = [];
        for (let i = 0; i < msgs.length; i++) seqs.push(String(i + 1));
        send(`* SEARCH ${seqs.join(" ")}`);
        send(`${tag} OK SEARCH completed`);
        continue;
      }

      if (cmd === "FETCH") {
        const n = Number(rest[0] || "0") | 0;
        if (n < 1 || n > msgs.length) { send(`${tag} NO no such message`); continue; }
        const what = rest.slice(1).join(" ").toUpperCase();
        if (!what.includes("BODY[]") && !what.includes("RFC822")) {
          send(`${tag} NO only BODY[] supported`);
          continue;
        }
        const msg = normalizeCRLF(msgs[n - 1]);
        const bytes = encodeUTF8(msg).length;
        send(`* ${n} FETCH (BODY[] {${bytes}})`);
        net.sendTCPConn(connKey, encodeUTF8(msg + "\r\n"));
        send(`)`);
        send(`${tag} OK FETCH completed`);
        continue;
      }

      if (cmd === "STORE") {
        const n = Number(rest[0] || "0") | 0;
        if (n < 1 || n > msgs.length) { send(`${tag} NO no such message`); continue; }
        const flags = rest.slice(1).join(" ");
        if (flags.includes("\\Seen")) {
          seen.add(n - 1);
          send(`* ${n} FETCH (FLAGS (\\Seen))`);
          send(`${tag} OK STORE completed`);
        } else {
          send(`${tag} OK STORE completed`);
        }
        continue;
      }

      send(`${tag} NO unsupported command`);
    }

    try { net.closeTCPConn(connKey); } catch { /* ignore */ }
  }
}
