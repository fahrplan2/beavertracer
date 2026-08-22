//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { Disposer } from "../lib/Disposer.js";
import { UILib as UI } from "./lib/UILib.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { t } from "../i18n/index.js";
import { nowStamp, encodeUTF8, decodeUTF8 } from "../lib/helpers.js";
import { simTimer } from "../lib/SimTimer.js";
import { TlsSession } from "../net/TlsSession.js";
import { TlsCertificate } from "../net/models/TlsCertificate.js";

/** @param {string} s */
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
/**
 * @param {MailTransport} tr
 * @param {number} timeoutMs
 * @param {{buf:Uint8Array}} state
 * @returns {Promise<string|null>}
 */
async function readLineCRLF(tr, timeoutMs, state) {
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

    const part = await withTimeout(tr.recv(), timeoutMs, "recv");
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
 * @param {MailTransport} tr
 * @param {string} line
 */
function writeLine(tr, line) {
  Promise.resolve(tr.send(encodeUTF8(normalizeCRLF(line) + "\r\n"))).catch(() => {});
}

/**
 * @param {MailTransport} tr
 * @param {number} timeout
 * @param {{buf:Uint8Array}} st
 * @returns {Promise<{code:number, lines:string[]}>}
 */
async function readSmtpResponse(tr, timeout, st) {
  const first = await readLineCRLF(tr, timeout, st);
  if (first == null) throw new Error("smtp: remote closed");
  const lines = [first];
  const code = Number(first.slice(0, 3)) | 0;

  if (first.length >= 4 && first[3] === "-") {
    const endPrefix = String(code).padStart(3, "0") + " ";
    while (true) {
      const l2 = await readLineCRLF(tr, timeout, st);
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
 * @typedef {{mailDomain:string, ports:{smtp:number,pop3:number,imap:number}, tls?:{enabled:boolean,smtps:number,pop3s:number,imaps:number,certPath:string}, users:UserRow[]}} MailConfig
 * @typedef {{send:(d:Uint8Array)=>void, recv:()=>Promise<Uint8Array|null>, close:()=>void}} MailTransport
 */

export class SimpleMailServerApp extends LoggedProcess {
  get title() {
    return t("app.simplemailserver.title") || "Simple Mail Server";
  }
  icon = "fa-server";
  badge = "MAIL";

  /** @type {Disposer} */
  disposer = new Disposer();

  // persisted config
  mailDomain = "example.local";
  portSMTP = 25;
  portPOP3 = 110;
  portIMAP = 143;
  tlsEnabled = false;
  portSMTPS = 465;
  portPOP3S = 995;
  portIMAPS = 993;
  certPath = "";

  /** @type {Array<{user:string,password:string}>} */
  users = []; // start empty until one is added

  // paths
  configPath = "/etc/mail.conf";
  mailRoot = "/var/mail";
  queueRoot = "/var/mail/queue";
  certDir = "/etc/certs";

  // runtime
  running = false;
  /** @type {{smtp:number|null, pop3:number|null, imap:number|null, smtps:number|null, pop3s:number|null, imaps:number|null}} */
  serverRef = { smtp: null, pop3: null, imap: null, smtps: null, pop3s: null, imaps: null };
  runSeq = 0;
  /** @type {TlsCertificate|null} */ _cert = null;

  // ui
  /** @type {HTMLElement|null} */ usersEl = null;

  /** @type {HTMLInputElement|null} */ domainEl = null;
  /** @type {HTMLInputElement|null} */ smtpEl = null;
  /** @type {HTMLInputElement|null} */ pop3El = null;
  /** @type {HTMLInputElement|null} */ imapEl = null;

  /** @type {HTMLInputElement|null} */ tlsEnabledEl = null;
  /** @type {HTMLInputElement|null} */ smtpsEl = null;
  /** @type {HTMLInputElement|null} */ pop3sEl = null;
  /** @type {HTMLInputElement|null} */ imapsEl = null;
  /** @type {HTMLSelectElement|null} */ certSelectEl = null;
  /** @type {HTMLElement|null} */      certInfoEl = null;

  /** @type {HTMLInputElement|null} */ userEl = null;
  /** @type {HTMLInputElement|null} */ passEl = null;

  /** @type {HTMLButtonElement|null} */ startBtn = null;
  /** @type {HTMLButtonElement|null} */ stopBtn = null;

  run() {
    this.root.classList.add("app", "app-simple-mail-server");
    this._loadConfig();
    setTimeout(() => this._tryAutostart(), 0);
  }

  _tryAutostart() {
    try {
      const fs = /** @type {any} */ (this.os.fs);
      if (!fs) return;
      const raw = readTextFile(fs, this.configPath);
      if (!raw?.trim()) return;
      const json = JSON.parse(raw);
      if (json.autostart !== true) return;
      this._start();
    } catch { }
  }

  /** @param {*} val */
  _writeAutostart(val) {
    try {
      const fs = /** @type {any} */ (this.os.fs);
      if (!fs) return;
      const raw = readTextFile(fs, this.configPath);
      if (!raw?.trim()) return;
      const o = JSON.parse(raw);
      o.autostart = val;
      writeTextFile(fs, this.configPath, JSON.stringify(o, null, 2) + "\n");
    } catch { }
  }

  _timeoutMs() {
    return 999999999;
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
    /** @param {HTMLInputElement|null} el */
    const dis = (el) => { if (el) el.disabled = r; };
    dis(this.domainEl);
    dis(this.smtpEl);
    dis(this.pop3El);
    dis(this.imapEl);
    dis(this.tlsEnabledEl);
    dis(this.smtpsEl);
    dis(this.pop3sEl);
    dis(this.imapsEl);
    if (this.certSelectEl) this.certSelectEl.disabled = r;

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
        this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.wroteDefaultConfig") || "wrote default config"}: ${this.configPath}`);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.cannotWriteConfig") || "cannot write config"}: ${reason}`);
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
        if (cfg.tls && typeof cfg.tls === "object") {
          this.tlsEnabled = !!cfg.tls.enabled;
          if (Number.isInteger(cfg.tls.smtps)) this.portSMTPS = cfg.tls.smtps;
          if (Number.isInteger(cfg.tls.pop3s)) this.portPOP3S = cfg.tls.pop3s;
          if (Number.isInteger(cfg.tls.imaps)) this.portIMAPS = cfg.tls.imaps;
          if (typeof cfg.tls.certPath === "string") this.certPath = cfg.tls.certPath;
        }
        if (Array.isArray(cfg.users)) {
          this.users = cfg.users
            .filter((u) => u && typeof u.user === "string" && typeof u.password === "string")
            .map((u) => ({ user: u.user, password: u.password }));
        } else {
          this.users = [];
        }
      }
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.loadedConfig") || "loaded config"}: ${this.configPath}`);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.invalidConfig") || "invalid config"}: ${reason}`);
    }
  }

  _saveConfig() {
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;

    this._ensureDirs();

    const cfg = /** @type {MailConfig} */ ({
      mailDomain: this.mailDomain,
      ports: { smtp: this.portSMTP, pop3: this.portPOP3, imap: this.portIMAP },
      tls: { enabled: this.tlsEnabled, smtps: this.portSMTPS, pop3s: this.portPOP3S, imaps: this.portIMAPS, certPath: this.certPath },
      users: this.users.slice(),
    });
    try {
      writeTextFile(fs, this.configPath, JSON.stringify(cfg, null, 2));
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.savedConfig") || "saved config"}: ${this.configPath}`);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.saveFailed") || "save config failed"}: ${reason}`);
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
      this._appendLog(`[${nowStamp()}] store mail failed (${path}): ${reason}`);
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
      this._appendLog(`[${nowStamp()}] write mailbox failed (${path}): ${reason}`);
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
      this._appendLog(`[${nowStamp()}] queue write failed: ${r}`);
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
    /** @type {MailTransport} */
    const tr = { send: (d) => net.sendTCPConn(connKey, d), recv: () => net.recvTCPConn(connKey), close: () => { try { net.closeTCPConn(connKey); } catch {} } };

    /** @param {number[]} okCodes */
    const expect = async (okCodes) => {
      const r = await readSmtpResponse(tr, timeout, st);
      if (!okCodes.includes(r.code)) {
        throw new Error(`smtp remote error: ${r.lines.join(" | ")}`);
      }
      return r;
    };

    await expect([220]);

    writeLine(tr, `EHLO ${this.mailDomain}`);
    await expect([250]);

    writeLine(tr, `MAIL FROM:<postmaster@${this.mailDomain}>`);
    await expect([250]);

    writeLine(tr, `RCPT TO:<${rcptAddr}>`);
    await expect([250, 251]);

    writeLine(tr, `DATA`);
    await expect([354]);

    const stuffed = dotStuff(rawRfc822);
    tr.send(encodeUTF8(normalizeCRLF(stuffed) + "\r\n.\r\n"));

    await expect([250]);

    writeLine(tr, `QUIT`);
  }

  /**
   * Wrap a raw TCP connection in a MailTransport (plain or TLS).
   * Returns null if TLS setup fails (connection already closed).
   * @param {string} connKey
   * @param {boolean} isTls
   * @returns {Promise<MailTransport|null>}
   */
  async _wrapConn(connKey, isTls) {
    const net = this.os.net;
    /** @type {MailTransport} */
    const plain = {
      send:  (d) => net.sendTCPConn(connKey, d),
      recv:  ()  => net.recvTCPConn(connKey),
      close: ()  => { try { net.closeTCPConn(connKey); } catch {} },
    };
    if (!isTls) return plain;

    if (!this._cert) {
      this._appendLog(`[${nowStamp()}] TLS: no certificate configured`);
      plain.close();
      return null;
    }
    const tls = new TlsSession({
      send:       (d) => net.sendTCPConn(connKey, d),
      recv:       ()  => net.recvTCPConn(connKey),
      isServer:   true,
      cert:       this._cert,
      trustStore: this.os.tls?.certStore ?? null,
      timeoutMs:  this._timeoutMs(),
      sleepFn:    (ms) => simTimer.sleep(ms),
      now:        () => this.os.clock.nowMs(),
    });
    try {
      await tls.handshake();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this._appendLog(`[${nowStamp()}] TLS handshake failed: ${reason}`);
      tls.close();
      plain.close();
      return null;
    }
    return {
      send:  (d) => tls.send(/** @type {Uint8Array<ArrayBuffer>} */ (d)),
      recv:  ()  => tls.recv(),
      close: ()  => { tls.close(); plain.close(); },
    };
  }

  /**
   * Upgrade an existing plain transport to server-side TLS (used for STARTTLS).
   * @param {MailTransport} tr
   * @returns {Promise<MailTransport>}
   */
  async _startTls(tr) {
    if (!this._cert) throw new Error("no certificate");
    const tls = new TlsSession({
      send:       (d) => tr.send(d),
      recv:       ()  => tr.recv(),
      isServer:   true,
      cert:       this._cert,
      trustStore: this.os.tls?.certStore ?? null,
      timeoutMs:  this._timeoutMs(),
      sleepFn:    (ms) => simTimer.sleep(ms),
      now:        () => this.os.clock.nowMs(),
    });
    await tls.handshake();
    return {
      send:  (d) => tls.send(/** @type {Uint8Array<ArrayBuffer>} */ (d)),
      recv:  ()  => tls.recv(),
      close: ()  => { tls.close(); tr.close(); },
    };
  }

  /**
   * Deliver local recipients and relay remote.
   * @param {string[]} rcptList
   * @param {string} rawRfc822
   * @param {string} [mailFrom]
   */
  async _deliverOrRelay(rcptList, rawRfc822, mailFrom = "") {
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

    /** @type {{addr:string, reason:string}[]} */
    const failures = [];

    for (const user of locals) {
      const acct = this._findUser(user);
      if (!acct) {
        const addr = `${user}@${localDomain}`;
        this._appendLog(`[${nowStamp()}] local delivery failed: unknown user ${addr}`);
        failures.push({ addr, reason: "unknown user" });
        continue;
      }
      // Store under the account's canonical-case name so delivery and
      // retrieval (POP3/IMAP) always agree on the mailbox file, regardless
      // of the case used in the envelope recipient address.
      this._storeLocal(acct.user, rawRfc822);
      this._appendLog(`[${nowStamp()}] local delivered: ${acct.user}@${localDomain}`);
    }

    for (const addr of remotes) {
      try {
        await this._relaySmtp(addr, rawRfc822);
        this._appendLog(`[${nowStamp()}] relayed: ${addr}`);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] relay failed: ${addr} (${reason})`);
        this._queueOutgoing(addr, rawRfc822, reason);
        failures.push({ addr, reason });
      }
    }

    if (failures.length > 0) {
      this._sendBounce(mailFrom, failures, rawRfc822);
    }
  }

  /**
   * Send a MAILER-DAEMON bounce to the original sender.
   * @param {string} mailFrom  envelope sender
   * @param {{addr:string, reason:string}[]} failures
   * @param {string} rawRfc822  original message
   */
  _sendBounce(mailFrom, failures, rawRfc822) {
    const from = mailFrom.replace(/^<|>$/g, "").trim();
    if (!from || from === "<>" || /^mailer-daemon@/i.test(from)) return;

    const p = parseEmailAddressLoose(from);
    if (!p) return;

    const daemon   = `MAILER-DAEMON@${this.mailDomain}`;
    const date     = new Date().toUTCString();
    const failList = failures.map(f => `  ${f.addr}: ${f.reason}`).join("\r\n");
    const origHead = rawRfc822.split(/\r\n\r\n|\n\n/)[0] ?? "";

    const bounce =
      `From: ${daemon}\r\n` +
      `To: ${from}\r\n` +
      `Subject: ${t("app.simplemailserver.bounce.subject") || "Undelivered Mail Returned to Sender"}\r\n` +
      `Date: ${date}\r\n` +
      `\r\n` +
      `${(t("app.simplemailserver.bounce.intro") || "This is the mail system at {domain}.").replace("{domain}", this.mailDomain)}\r\n` +
      `\r\n` +
      `${t("app.simplemailserver.bounce.failedRecipients") || "Your message could not be delivered to the following recipient(s):"}\r\n` +
      `\r\n` +
      `${failList}\r\n` +
      `\r\n` +
      `${t("app.simplemailserver.bounce.origHeaders") || "--- Original message headers ---"}\r\n` +
      `${origHead}\r\n`;

    if (p.domain === this.mailDomain.toLowerCase()) {
      const acct = this._findUser(p.local);
      if (acct) {
        this._storeLocal(acct.user, bounce);
        this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.bounceDelivered") || "bounce delivered to"} ${from}`);
      }
    } else {
      this._relaySmtp(from, bounce).catch((e) => {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.bounceRelayFailed") || "bounce relay failed for"} ${from}: ${reason}`);
      });
    }
  }

  // ---------------- UI ----------------

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const domainInput = UI.input({ placeholder: t("app.simplemailserver.placeholder.domain") || "maildomain", value: this.mailDomain });
    const smtpInput = UI.input({ placeholder: "25", value: String(this.portSMTP) });
    const pop3Input = UI.input({ placeholder: "110", value: String(this.portPOP3) });
    const imapInput = UI.input({ placeholder: "143", value: String(this.portIMAP) });

    this.domainEl = domainInput;
    this.smtpEl = smtpInput;
    this.pop3El = pop3Input;
    this.imapEl = imapInput;

    const start = UI.button(t("app.simplemailserver.button.start") || "Start", () => this._startFromUI(), { primary: true, icon: "fa-play" });
    const stop = UI.button(t("app.simplemailserver.button.stop") || "Stop", () => this._stop(), { icon: "fa-stop" });
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

    // TLS section
    const tlsEnabledInput = /** @type {HTMLInputElement} */ (UI.el("input", {
      attrs: { type: "checkbox" }, init: (el) => { el.checked = this.tlsEnabled; },
    }));
    this.tlsEnabledEl = tlsEnabledInput;

    const smtpsInput = UI.input({ placeholder: "465", value: String(this.portSMTPS) });
    const pop3sInput = UI.input({ placeholder: "995", value: String(this.portPOP3S) });
    const imapsInput = UI.input({ placeholder: "993", value: String(this.portIMAPS) });
    this.smtpsEl = smtpsInput; this.pop3sEl = pop3sInput; this.imapsEl = imapsInput;

    const certSelect = UI.select([], {});
    this.certSelectEl = certSelect;
    const certInfo = UI.el("div", { className: "msg" });
    this.certInfoEl = certInfo;

    const certApplyBtn = UI.button(
      t("app.simplemailserver.tls.applyCert") || "Use",
      () => this._applyCert(), { primary: true, icon: "fa-check" }
    );

    const serverPane = UI.el("div", { children: [
      UI.row(t("app.simplemailserver.label.domain") || "Maildomain", domainInput),
      UI.row(t("app.simplemailserver.label.smtpPort") || "SMTP port", smtpInput),
      UI.row(t("app.simplemailserver.label.pop3Port") || "POP3 port", pop3Input),
      UI.row(t("app.simplemailserver.label.imapPort") || "IMAP port", imapInput),
      UI.buttonRow([UI.button(t("app.simplemailserver.button.saveConfig") || "Save config", () => this._saveConfig(), {})]),
    ]});

    const mailboxPane = UI.el("div", { children: [
      UI.row(t("app.simplemailserver.label.user") || "User", userInput),
      UI.row(t("app.simplemailserver.label.password") || "Password", passInput),
      UI.buttonRow([addBtn, delBtn, seedBtn, clearQueueBtn]),
      usersBox,
    ]});

    const tlsPane = UI.el("div", { children: [
      UI.row(t("app.simplemailserver.tls.enabled") || "TLS enabled", tlsEnabledInput),
      UI.row(t("app.simplemailserver.tls.smtpsPort") || "SMTPS port", smtpsInput),
      UI.row(t("app.simplemailserver.tls.pop3sPort") || "POP3S port", pop3sInput),
      UI.row(t("app.simplemailserver.tls.imapsPort") || "IMAPS port", imapsInput),
      UI.row(t("app.simplemailserver.tls.cert") || "Certificate", certSelect),
      UI.buttonRow([certApplyBtn]),
      certInfo,
    ]});

    const logPane = UI.el("div", { className: "log-pane", children: [
      status,
      logBox,
    ]});

    const { bar: tabBar } = UI.tabbedPane([
      { id: "server",   label: t("app.simplemailserver.label.server") || "Server",      pane: serverPane },
      { id: "mailboxes",label: t("app.simplemailserver.label.users")  || "Mailboxes",   pane: mailboxPane },
      { id: "tls",      label: t("app.simplemailserver.tls.title")    || "TLS/SSL",     pane: tlsPane },
      { id: "log",      label: t("app.simplemailserver.label.log")    || "Protokoll",   pane: logPane },
    ]);

    const panel = UI.panel([
      UI.el("div", { className: "app-toolbar", children: [UI.buttonRow([start, stop])] }),
      tabBar,
      serverPane,
      mailboxPane,
      tlsPane,
      logPane,
    ]);

    this.root.replaceChildren(panel);
    this._renderUsers();
    this._syncUI();
    this._renderLog();
    this._refreshCertList();

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
    this.tlsEnabledEl = null;
    this.smtpsEl = null;
    this.pop3sEl = null;
    this.imapsEl = null;
    this.certSelectEl = null;
    this.certInfoEl = null;

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
    if (!user) { this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.userMissing") || "user missing"}`); return; }
    if (!pass) { this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.passwordMissing") || "password missing"}`); return; }

    const existing = this._findUser(user);
    if (existing) {
      existing.password = pass;
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.userUpdated") || "updated user"} ${user}`);
    } else {
      this.users.push({ user, password: pass });
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.userAdded") || "added user"} ${user}`);
    }
    this._renderUsers();
    this._saveConfig();
  }

  _deleteUser() {
    const user = (this.userEl?.value ?? "").trim();
    if (!user) { this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.userMissing") || "user missing"}`); return; }
    this._deleteUserByName(user);
  }

  /** @param {string} user */
  _deleteUserByName(user) {
    const before = this.users.length;
    this.users = this.users.filter((u) => u.user.toLowerCase() !== user.toLowerCase());
    if (this.users.length !== before) {
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.userDeleted") || "deleted user"} ${user}`);
      this._renderUsers();
      this._saveConfig();
    } else {
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.userNotFound") || "user not found"} ${user}`);
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
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.queueCleared") || "cleared queue"} (${items.length} files)`);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.clearQueueFailed") || "clear queue failed"}: ${reason}`);
    }
  }

  /** Old “seed” button: seed selected user if present, else do nothing helpful. */
  _seed() {
    const user = (this.userEl?.value ?? "").trim();
    if (user) {
      this._seedUser(user);
      return;
    }
    this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.seedNeedUser") || "seed: enter a user or use the per-user Seed button"}`);
  }

  /** Seed a test mail for a specific user @param {string} user */
  _seedUser(user) {
    const u = this._findUser(user);
    if (!u) { this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.seedNoSuchUser") || "seed: no such user"} ${user}`); return; }

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
    this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.seeded") || "seeded test mail"} -> ${u.user}`);
    this._renderUsers();
  }

  async _refreshCertList() {
    const sel = this.certSelectEl;
    if (!sel) return;
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;

    /** @type {Array<{cert:TlsCertificate, path:string, name:string}>} */
    const entries = [];
    try {
      const names = /** @type {string[]} */ (fs.readdir ? fs.readdir(this.certDir) : []);
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const cert = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(`${this.certDir}/${name}`)));
          if (cert.hasPrivateKey) entries.push({ cert, path: `${this.certDir}/${name}`, name });
        } catch { /* skip invalid */ }
      }
    } catch { /* dir missing */ }

    sel.replaceChildren();
    if (entries.length === 0) {
      sel.appendChild(UI.el("option", { attrs: { value: "" }, text: t("app.simplemailserver.tls.noCerts") || "(no certificates)" }));
    } else {
      for (const e of entries) {
        const cn = (/** @type {string} */ s) => s.replace(/.*CN=([^,]+).*/i, "$1");
        sel.appendChild(UI.el("option", { attrs: { value: e.path }, text: cn(e.cert.subject) }));
      }
      if (this.certPath) sel.value = this.certPath;
    }
    this._updateCertInfo();
  }

  _updateCertInfo() {
    if (!this.certInfoEl) return;
    if (!this._cert) {
      this.certInfoEl.textContent = t("app.simplemailserver.tls.noCertLoaded") || "No certificate loaded";
      return;
    }
    const expiry = new Date(this._cert.notAfter).toLocaleDateString();
    const status = this._cert.validityStatus(this.os.clock ? this.os.clock.nowMs() : Date.now());
    const statusSuffix = status === "expired" ? " (expired)" : status === "notYetValid" ? " (not yet valid)" : "";
    this.certInfoEl.textContent = [
      `Subject: ${this._cert.subject}`,
      `Fingerprint: ${this._cert.fingerprint()}`,
      `Expires: ${expiry}${statusSuffix}`,
    ].join(" | ");
  }

  async _applyCert() {
    const path = this.certSelectEl?.value;
    if (!path) return;
    const fs = /** @type {any} */ (this.os.fs);
    if (!fs) return;
    try {
      this._cert = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(path)));
      this.certPath = path;
      this._appendLog(`[${nowStamp()}] TLS cert loaded: ${this._cert.subject}`);
    } catch (e) {
      this._appendLog(`[${nowStamp()}] TLS cert load failed: ${e instanceof Error ? e.message : e}`);
      this._cert = null;
    }
    this._updateCertInfo();
  }

  _startFromUI() {
    const domain = (this.domainEl?.value ?? "").trim().toLowerCase();
    const smtp = Number((this.smtpEl?.value ?? "").trim());
    const pop3 = Number((this.pop3El?.value ?? "").trim());
    const imap = Number((this.imapEl?.value ?? "").trim());
    const tlsOn = this.tlsEnabledEl?.checked ?? false;
    const smtps = Number((this.smtpsEl?.value ?? "").trim());
    const pop3s = Number((this.pop3sEl?.value ?? "").trim());
    const imaps = Number((this.imapsEl?.value ?? "").trim());

    /** @param {number} p */
    const okPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

    if (!domain) { this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.invalidDomain") || "invalid maildomain"}`); return; }
    if (!okPort(smtp) || !okPort(pop3) || !okPort(imap)) {
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.invalidPorts") || "invalid ports"} (smtp=${smtp} pop3=${pop3} imap=${imap})`);
      return;
    }
    if (tlsOn && (!okPort(smtps) || !okPort(pop3s) || !okPort(imaps))) {
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.invalidPorts") || "invalid ports"} (smtps=${smtps} pop3s=${pop3s} imaps=${imaps})`);
      return;
    }
    if (tlsOn && !this._cert) {
      this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.tlsNoCert") || "TLS is enabled but no certificate is loaded — select and apply a certificate first"}`);
      return;
    }

    this.mailDomain = domain;
    this.portSMTP = smtp;
    this.portPOP3 = pop3;
    this.portIMAP = imap;
    this.tlsEnabled = tlsOn;
    this.portSMTPS = okPort(smtps) ? smtps : this.portSMTPS;
    this.portPOP3S = okPort(pop3s) ? pop3s : this.portPOP3S;
    this.portIMAPS = okPort(imaps) ? imaps : this.portIMAPS;
    this._saveConfig();

    this._start();
  }

  _stop() {
    if (!this.running) return;
    this._writeAutostart(false);
    this.running = false;
    this.runSeq++;

    const { smtp, pop3, imap, smtps, pop3s, imaps } = this.serverRef;
    this.serverRef = { smtp: null, pop3: null, imap: null, smtps: null, pop3s: null, imaps: null };

    /** @param {*} ref @param {string} name */
    const close = (ref, name) => {
      if (ref == null) return;
      try { this.os.net.closeTCPServerSocket(ref); }
      catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] stop ${name} error: ${reason}`);
      }
    };
    close(smtp, "smtp");
    close(pop3, "pop3");
    close(imap, "imap");
    close(smtps, "smtps");
    close(pop3s, "pop3s");
    close(imaps, "imaps");

    this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.stopped") || "stopped"}`);
    this._syncUI();
  }

  _start() {
    if (this.running) return;

    this._ensureDirs();

    let smtpRef = null, pop3Ref = null, imapRef = null;
    let smtpsRef = null, pop3sRef = null, imapsRef = null;
    try {
      smtpRef = this.os.net.openTCPServerSocket(new IPAddress(4, 0), this.portSMTP);
      pop3Ref = this.os.net.openTCPServerSocket(new IPAddress(4, 0), this.portPOP3);
      imapRef = this.os.net.openTCPServerSocket(new IPAddress(4, 0), this.portIMAP);
      if (this.tlsEnabled && this._cert) {
        smtpsRef = this.os.net.openTCPServerSocket(new IPAddress(4, 0), this.portSMTPS);
        pop3sRef = this.os.net.openTCPServerSocket(new IPAddress(4, 0), this.portPOP3S);
        imapsRef = this.os.net.openTCPServerSocket(new IPAddress(4, 0), this.portIMAPS);
      }
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] open socket error: ${reason}`);
      for (const r of [smtpRef, pop3Ref, imapRef, smtpsRef, pop3sRef, imapsRef]) {
        try { if (r != null) this.os.net.closeTCPServerSocket(r); } catch {}
      }
      return;
    }

    this.serverRef = { smtp: smtpRef, pop3: pop3Ref, imap: imapRef, smtps: smtpsRef, pop3s: pop3sRef, imaps: imapsRef };
    this.running = true;
    this._writeAutostart(true);
    const seq = ++this.runSeq;
    this._syncUI();

    let listenMsg = `smtp=${this.portSMTP} pop3=${this.portPOP3} imap=${this.portIMAP}`;
    if (this.tlsEnabled && this._cert) listenMsg += ` smtps=${this.portSMTPS} pop3s=${this.portPOP3S} imaps=${this.portIMAPS}`;
    this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.listening") || "listening"}: ${listenMsg} domain=${this.mailDomain}`);

    this._acceptLoop(seq, smtpRef, "smtp", false);
    this._acceptLoop(seq, pop3Ref, "pop3", false);
    this._acceptLoop(seq, imapRef, "imap", false);
    if (smtpsRef) this._acceptLoop(seq, smtpsRef, "smtp", true);
    if (pop3sRef) this._acceptLoop(seq, pop3sRef, "pop3", true);
    if (imapsRef) this._acceptLoop(seq, imapsRef, "imap", true);
  }

  /**
   * @param {number} seq
   * @param {number} ref
   * @param {"smtp"|"pop3"|"imap"} proto
   * @param {boolean} isTls
   */
  async _acceptLoop(seq, ref, proto, isTls) {
    while (this.running && this.runSeq === seq) {
      /** @type {string|null} */
      let connKey = null;
      try {
        connKey = await this.os.net.acceptTCPConn(ref);
      } catch (e) {
        if (this.running && this.runSeq === seq) {
          const reason = (e instanceof Error ? e.message : String(e));
          this._appendLog(`[${nowStamp()}] accept ${proto} error: ${reason}`);
        }
        continue;
      }

      if (!this.running || this.runSeq !== seq) break;
      if (connKey == null) break;

      const h =
        proto === "smtp" ? this._handleSMTP.bind(this) :
        proto === "pop3" ? this._handlePOP3.bind(this) :
        this._handleIMAP.bind(this);

      this._wrapConn(connKey, isTls).then((tr) => {
        if (!tr) return;
        h(seq, tr, isTls).catch((/** @type {unknown} */ e) => {
          const reason = (e instanceof Error ? e.message : String(e));
          this._appendLog(`[${nowStamp()}] conn ${proto}${isTls ? "s" : ""} error: ${reason}`);
          try { tr.close(); } catch { /* ignore */ }
        });
      }).catch((/** @type {unknown} */ e) => {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] TLS setup ${proto} error: ${reason}`);
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
  /**
   * @param {number} seq
   * @param {MailTransport} tr
   */
  /**
   * @param {number} seq
   * @param {MailTransport} tr
   * @param {boolean} [isTls]
   */
  async _handleSMTP(seq, tr, isTls = false) {
    const timeout = this._timeoutMs();
    const st = { buf: new Uint8Array(0) };

    /** @param {string} line */
    const send = (line) => writeLine(tr, line);

    send(`220 ${this.mailDomain} SimpleMailServer ready`);

    /** @type {string|null} */
    let heloName = null;

    /** @type {string|null} */
    let mailFrom = null;

    /** @type {string[]} */
    let rcptTo = [];

    /** @type {string|null} */
    let authedUser = null;

    let tlsActive = isTls;

    const resetTx = () => { mailFrom = null; rcptTo = []; };

    while (this.running && this.runSeq === seq) {
      const line = await readLineCRLF(tr, timeout, st);
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
        if (!tlsActive && this.tlsEnabled && this._cert) send("250-STARTTLS");
        send("250-AUTH PLAIN LOGIN");
        send("250 OK");
        continue;
      }

      if (upper === "STARTTLS") {
        if (tlsActive || !this.tlsEnabled || !this._cert) {
          send("454 4.7.0 TLS not available");
          continue;
        }
        writeLine(tr, "220 2.0.0 Ready to start TLS");
        try {
          tr = await this._startTls(tr);
          tlsActive = true;
          heloName = null; authedUser = null; resetTx();
          st.buf = new Uint8Array(0);
          this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.starttlsOk") || "STARTTLS upgraded"}`);
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          this._appendLog(`[${nowStamp()}] ${t("app.simplemailserver.log.starttlsFailed") || "STARTTLS failed"}: ${reason}`);
          break;
        }
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
        const u1 = await readLineCRLF(tr, timeout, st);
        if (u1 == null) break;
        const user = b64decodeToString(u1.trim());
        send("334 " + b64encodeFromString("Password:"));
        const p1 = await readLineCRLF(tr, timeout, st);
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
          const l = await readLineCRLF(tr, timeout, st);
          if (l == null) { break; }
          if (l === ".") break;
          dataLines.push(l.startsWith("..") ? l.slice(1) : l);
        }

        let msg = dataLines.join("\r\n");
        if (!/^\s*Date:/im.test(msg)) msg = `Date: ${new Date().toUTCString()}\r\n` + msg;
        if (!/^\s*From:/im.test(msg)) msg = `From: ${mailFrom}\r\n` + msg;
        if (!/^\s*To:/im.test(msg)) msg = `To: ${rcptTo.join(", ")}\r\n` + msg;

        try {
          await this._deliverOrRelay(rcptTo, msg, mailFrom ?? "");
          send("250 2.0.0 OK queued");
          this._appendLog(`[${nowStamp()}] SMTP accepted: from=${mailFrom} rcpt=${rcptTo.length} helo=${heloName ?? "-"} auth=${authedUser ?? "-"}`);
        } catch (e) {
          const reason = (e instanceof Error ? e.message : String(e));
          send("451 4.3.0 Local error in processing");
          this._appendLog(`[${nowStamp()}] SMTP processing error: ${reason}`);
        }

        resetTx();
        continue;
      }

      send("500 5.5.2 Command unrecognized");
    }

    tr.close();
  }

  // ---------------- POP3 (Server) ----------------

  /**
   * POP3 subset: USER PASS STAT LIST RETR DELE NOOP RSET QUIT
   * Protocol strings are in English (not t()).
   * @param {number} seq
   * @param {string} connKey
   */
  /**
   * @param {number} seq
   * @param {MailTransport} tr
   */
  async _handlePOP3(seq, tr) {
    const timeout = this._timeoutMs();
    const st = { buf: new Uint8Array(0) };

    /** @param {string} line */
    const send = (line) => writeLine(tr, line);

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
      const line = await readLineCRLF(tr, timeout, st);
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
          const typed = arg.trim();
          if (!typed) { send("-ERR Missing username. Usage: USER <name>"); continue; }
          const acct = this._findUser(typed);
          if (!acct) { send("-ERR No such mailbox. Create it in the server UI first."); continue; }
          // Normalize to the account's canonical-case name so the mailbox
          // file we read later matches the one delivery wrote to.
          user = acct.user;
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
        tr.send(encodeUTF8(stuffed + "\r\n.\r\n"));
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

    tr.close();
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
  /**
   * @param {number} seq
   * @param {MailTransport} tr
   */
  async _handleIMAP(seq, tr) {
    const timeout = this._timeoutMs();
    const st = { buf: new Uint8Array(0) };
    /** @param {string} line */
    const send = (line) => writeLine(tr, line);

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
      const line = await readLineCRLF(tr, timeout, st);
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
          // Normalize to the account's canonical-case name so the mailbox
          // file we read later matches the one delivery wrote to.
          user = this._findUser(u)?.user ?? u;
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

        loadMailbox();
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
        send(`* ${n} FETCH (BODY[] {${bytes}}`);
        tr.send(encodeUTF8(msg + "\r\n"));
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

    tr.close();
  }
}
