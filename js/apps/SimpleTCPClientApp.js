//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "./lib/Disposer.js";
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
 * Parses your conn key format: `${localIP}:${localPort}>${remoteIP}:${remotePort}`
 * @param {string} key
 */
function parseTCPKey(key) {
  const m = /^(\d+):(\d+)>(\d+):(\d+)$/.exec(key);
  if (!m) {
    return { localIP: 0, localPort: 0, remoteIP: 0, remotePort: 0, ok: false };
  }
  return {
    localIP: Number(m[1]) >>> 0,
    localPort: Number(m[2]) | 0,
    remoteIP: Number(m[3]) >>> 0,
    remotePort: Number(m[4]) | 0,
    ok: true,
  };
}

/**
 * Quick & safe-ish host parsing.
 * Accepts:
 *  - dotted IPv4 "1.2.3.4"
 *  - raw uint32 in decimal "3232235521"
 *  - anything else -> DNS resolve (stub)
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

  // hostname -> dns
  return await dnsResolve(s);
}

/**
 * Encode as UTF-8 bytes (with fallback).
 * @param {string} s
 */
function encodeUTF8(s) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  // very small fallback (ASCII only)
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Decode UTF-8 bytes (with fallback).
 * @param {Uint8Array} b
 */
function decodeUTF8(b) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
  // small fallback (ASCII only)
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

export class SimpleTCPClientApp extends GenericProcess {


  get title() {
    return t("app.simpletcpclient.title");
  }

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {string} */
  host = "127.0.0.1";

  /** @type {number} */
  port = 7;

  /** @type {string|null} */
  connKey = null;

  /** @type {boolean} */
  connected = false;

  /** @type {Array<string>} */
  log = [];

  /** @type {HTMLElement|null} */
  logEl = null;

  /** @type {HTMLInputElement|null} */
  hostEl = null;

  /** @type {HTMLInputElement|null} */
  portEl = null;

  /** @type {HTMLButtonElement|null} */
  connectBtn = null;

  /** @type {HTMLButtonElement|null} */
  disconnectBtn = null;

  /** @type {HTMLInputElement|null} */
  msgEl = null;

  /** @type {HTMLButtonElement|null} */
  sendBtn = null;

  run() {
    this.root.classList.add("app", "app-simple-tcp-client");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const hostInput = UI.input({ placeholder: t("app.simpletcpclient.placeholder.host"), value: String(this.host) });
    const portInput = UI.input({ placeholder: t("app.simpletcpclient.placeholder.port"), value: String(this.port) });
    this.hostEl = hostInput;
    this.portEl = portInput;

    /** @type {HTMLButtonElement} */
    const connect = UI.button(t("app.simpletcpclient.button.connect"), () => this._connectFromUI(), { primary: true });
    /** @type {HTMLButtonElement} */
    const disconnect = UI.button(t("app.simpletcpclient.button.disconnect"), () => this._disconnect(), {});
    this.connectBtn = connect;
    this.disconnectBtn = disconnect;

    const chatLog = UI.el("div", { className: "msg" });
    this.logEl = chatLog;

    const msgInput = UI.input({ placeholder: t("app.simpletcpclient.placeholder.message"), value: "" });
    this.msgEl = /** @type {HTMLInputElement} */ (msgInput);

    /** @type {HTMLButtonElement} */
    const send = UI.button(t("app.simpletcpclient.button.send"), () => this._sendFromUI(), { primary: true });
    this.sendBtn = send;

    // allow Enter to send
    this.disposer.on(msgInput, "keydown", (ev) => {
      if (ev instanceof KeyboardEvent && ev.key === "Enter") {
        ev.preventDefault();
        this._sendFromUI();
      }
    });

    const status = UI.el("div", { className: "msg" });

    const panel = UI.panel([
      UI.row(t("app.simpletcpclient.label.host"), hostInput),
      UI.row(t("app.simpletcpclient.label.port"), portInput),
      UI.buttonRow([connect, disconnect]),
      status,
      UI.el("div", { text: t("app.simpletcpclient.label.chat") }),
      chatLog,
      UI.row(t("app.simpletcpclient.label.message"), msgInput),
      UI.buttonRow([
        send,
        UI.button(t("app.simpletcpclient.button.clearChat"), () => { this.log = []; this._renderLog(); }, {})
      ]),
    ]);

    this.root.replaceChildren(panel);

    this._syncUI();
    this._renderLog();

    this.disposer.interval(() => {
      const peer =
        this.connKey ? (() => {
          const info = parseTCPKey(this.connKey);
          return info.ok ? `${ipToString(info.remoteIP)}:${info.remotePort}` : this.connKey;
        })() : "-";

      status.textContent =
        t("app.simpletcpclient.status.pid", { pid: this.pid }) + "\n" +
        t("app.simpletcpclient.status.connected", { connected: this.connected }) + "\n" +
        t("app.simpletcpclient.status.peer", { peer }) + "\n" +
        t("app.simpletcpclient.status.chatEntries", { n: this.log.length });
    }, 300);
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl = null;
    this.hostEl = null;
    this.portEl = null;
    this.connectBtn = null;
    this.disconnectBtn = null;
    this.msgEl = null;
    this.sendBtn = null;
    super.onUnmount();
  }

  destroy() {
    this._disconnect();
    super.destroy();
  }

  _syncUI() {
    const isConn = this.connected;

    if (this.connectBtn) this.connectBtn.disabled = isConn;
    if (this.disconnectBtn) this.disconnectBtn.disabled = !isConn;

    if (this.hostEl) this.hostEl.disabled = isConn;
    if (this.portEl) this.portEl.disabled = isConn;

    if (this.msgEl) this.msgEl.disabled = !isConn;
    if (this.sendBtn) this.sendBtn.disabled = !isConn;
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

  async _connectFromUI() {
    const host = (this.hostEl?.value ?? "").trim();
    const portStr = (this.portEl?.value ?? "").trim();
    const port = Number(portStr);

    if (!host) {
      this._append(t("app.simpletcpclient.log.hostEmpty", { time: nowStamp() }));
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this._append(t("app.simpletcpclient.log.invalidPort", { time: nowStamp(), portStr }));
      return;
    }

    this.host = host;
    this.port = port;

    await this._connect();
  }

  async _connect() {
    if (this.connected) return;

    // dns.resolve stub: will use this.dns.resolve when available
    /** @type {(name:string)=>Promise<number>} */
    const dnsResolve = async (name) => {
      // If you later add this.dns.resolve, this will automatically use it.
      const anyThis = /** @type {any} */ (this);
      if (anyThis.dns && typeof anyThis.dns.resolve === "function") {
        return await anyThis.dns.resolve(name);
      }
      throw new Error(t("app.simpletcpclient.err.dnsNotAvailable", { name }));
    };

    let dstIP = 0;
    try {
      dstIP = await resolveHostToIP(this.host, dnsResolve);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(t("app.simpletcpclient.log.resolveError", { time: nowStamp(), host: this.host, reason }));
      return;
    }

    try {
      const conn = await this.os.net.connectTCPConn(dstIP, this.port);

      // connectTCPConn returns a TCPSocket; but we only need its key
      const key = conn?.key;
      if (typeof key !== "string" || !key) throw new Error(t("app.simpletcpclient.err.noConnKey"));

      this.connKey = key;
      this.connected = true;
      this._syncUI();

      const info = parseTCPKey(key);
      const who = info.ok ? `${ipToString(info.remoteIP)}:${info.remotePort}` : key;
      this._append(t("app.simpletcpclient.log.connected", { time: nowStamp(), who }));

      // start background receive loop
      this._recvLoop(key);
    } catch (e) {
      this.connKey = null;
      this.connected = false;
      this._syncUI();
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(t("app.simpletcpclient.log.connectFailed", { time: nowStamp(), reason }));
    }
  }

  _disconnect() {
    if (!this.connected && !this.connKey) return;

    const key = this.connKey;
    this.connected = false;
    this.connKey = null;
    this._syncUI();

    if (key) {
      try {
        this.os.net.closeTCPConn(key);
        this._append(t("app.simpletcpclient.log.disconnectRequested", { time: nowStamp() }));
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._append(t("app.simpletcpclient.log.disconnectError", { time: nowStamp(), reason }));
      }
    }
  }

  _sendFromUI() {
    if (!this.connected || !this.connKey) return;

    const msg = (this.msgEl?.value ?? "");
    if (!msg.trim()) return;

    // simple chat framing: send UTF-8 bytes (no newline required)
    const data = encodeUTF8(msg);

    const info = parseTCPKey(this.connKey);
    const who = info.ok ? `${ipToString(info.remoteIP)}:${info.remotePort}` : this.connKey;

    try {
      this.os.net.sendTCPConn(this.connKey, data);
      this._append(t("app.simpletcpclient.log.sent", {
        time: nowStamp(),
        who,
        msg,
        len: data.length,
        hex: hexPreview(data),
      }));
      if (this.msgEl) this.msgEl.value = "";
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(t("app.simpletcpclient.log.sendError", { time: nowStamp(), reason }));
    }
  }

  /**
   * @param {string} key
   */
  async _recvLoop(key) {
    const info = parseTCPKey(key);
    const who = info.ok ? `${ipToString(info.remoteIP)}:${info.remotePort}` : key;

    while (this.connected && this.connKey === key) {
      /** @type {Uint8Array|null} */
      let data = null;
      try {
        data = await this.os.net.recvTCPConn(key);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._append(t("app.simpletcpclient.log.recvError", { time: nowStamp(), reason }));
        break;
      }

      if (!this.connected || this.connKey !== key) break;
      if (data == null) {
        this._append(t("app.simpletcpclient.log.remoteClosed", { time: nowStamp(), who }));
        break;
      }

      const text = decodeUTF8(data);
      this._append(t("app.simpletcpclient.log.received", {
        time: nowStamp(),
        who,
        text,
        len: data.length,
        hex: hexPreview(data),
      }));
    }

    // if loop exits while still marked connected, force local disconnect state
    if (this.connected && this.connKey === key) {
      this.connected = false;
      this.connKey = null;
      this._syncUI();
      this._append(t("app.simpletcpclient.log.disconnected", { time: nowStamp() }));
    }
  }
}
