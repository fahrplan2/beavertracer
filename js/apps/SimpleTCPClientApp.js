//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { CleanupBag } from "./lib/CleanupBag.js";

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
  /** @type {CleanupBag} */
  bag = new CleanupBag();

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
    this.title = "Simple TCP Client";
    this.root.classList.add("app", "app-simple-tcp-client");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.bag.dispose();

    const hostInput = UI.input({ placeholder: "Host / Address", value: String(this.host) });
    const portInput = UI.input({ placeholder: "Port (1..65535)", value: String(this.port) });
    this.hostEl = hostInput;
    this.portEl = portInput;

    /** @type {HTMLButtonElement} */
    const connect = UI.button("Connect", () => this._connectFromUI(), { primary: true });
    /** @type {HTMLButtonElement} */
    const disconnect = UI.button("Disconnect", () => this._disconnect(), {});
    this.connectBtn = connect;
    this.disconnectBtn = disconnect;

    const chatLog = UI.el("div", { className: "msg" });
    this.logEl = chatLog;

    const msgInput = UI.input({ placeholder: "Type a message…", value: "" });
    this.msgEl = /** @type {HTMLInputElement} */ (msgInput);

    /** @type {HTMLButtonElement} */
    const send = UI.button("Send", () => this._sendFromUI(), { primary: true });
    this.sendBtn = send;

    // allow Enter to send
    this.bag.on(msgInput, "keydown", (ev) => {
      if (ev instanceof KeyboardEvent && ev.key === "Enter") {
        ev.preventDefault();
        this._sendFromUI();
      }
    });

    const status = UI.el("div", { className: "msg" });

    const panel = UI.panel([
      UI.row("Host", hostInput),
      UI.row("Port", portInput),
      UI.buttonRow([connect, disconnect]),
      status,
      UI.el("div", { text: "Chat:" }),
      chatLog,
      UI.row("Message", msgInput),
      UI.buttonRow([send, UI.button("Clear Chat", () => { this.log = []; this._renderLog(); }, {})]),
    ]);

    this.root.replaceChildren(panel);

    this._syncUI();
    this._renderLog();

    this.bag.interval(() => {
      const peer =
        this.connKey ? (() => {
          const info = parseTCPKey(this.connKey);
          return info.ok ? `${ipToString(info.remoteIP)}:${info.remotePort}` : this.connKey;
        })() : "-";

      status.textContent =
        `PID: ${this.pid}\n` +
        `Connected: ${this.connected}\n` +
        `Peer: ${peer}\n` +
        `Chat entries: ${this.log.length}`;
    }, 300);
  }

  onUnmount() {
    this.bag.dispose();
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
      this._append(`[${nowStamp()}] ERROR host is empty`);
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this._append(`[${nowStamp()}] ERROR invalid port: "${portStr}"`);
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
      throw new Error(`DNS not available (cannot resolve "${name}")`);
    };

    let dstIP = 0;
    try {
      dstIP = await resolveHostToIP(this.host, dnsResolve);
    } catch (e) {
      this._append(`[${nowStamp()}] ERROR resolve host "${this.host}": ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    try {
      const conn = await this.os.ipforwarder.connectTCPConn(dstIP, this.port);

      // connectTCPConn returns a TCPSocket; but we only need its key
      const key = conn?.key;
      if (typeof key !== "string" || !key) throw new Error("connectTCPConn did not return a connection key");

      this.connKey = key;
      this.connected = true;
      this._syncUI();

      const info = parseTCPKey(key);
      const who = info.ok ? `${ipToString(info.remoteIP)}:${info.remotePort}` : key;
      this._append(`[${nowStamp()}] CONNECTED to ${who}`);

      // start background receive loop
      this._recvLoop(key);
    } catch (e) {
      this.connKey = null;
      this.connected = false;
      this._syncUI();
      this._append(`[${nowStamp()}] ERROR connect failed: ${e instanceof Error ? e.message : String(e)}`);
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
        this.os.ipforwarder.closeTCPConn(key);
        this._append(`[${nowStamp()}] DISCONNECT requested`);
      } catch (e) {
        this._append(`[${nowStamp()}] ERROR disconnect: ${e instanceof Error ? e.message : String(e)}`);
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
      this.os.ipforwarder.sendTCPConn(this.connKey, data);
      this._append(`[${nowStamp()}] ME -> ${who}: "${msg}" (len=${data.length} hex=${hexPreview(data)})`);
      if (this.msgEl) this.msgEl.value = "";
    } catch (e) {
      this._append(`[${nowStamp()}] ERROR send: ${e instanceof Error ? e.message : String(e)}`);
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
        data = await this.os.ipforwarder.recvTCPConn(key);
      } catch (e) {
        this._append(`[${nowStamp()}] ERROR recv: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }

      if (!this.connected || this.connKey !== key) break;
      if (data == null) {
        this._append(`[${nowStamp()}] REMOTE CLOSED ${who}`);
        break;
      }

      const text = decodeUTF8(data);
      this._append(`[${nowStamp()}] ${who} -> ME: "${text}" (len=${data.length} hex=${hexPreview(data)})`);
    }

    // if loop exits while still marked connected, force local disconnect state
    if (this.connected && this.connKey === key) {
      this.connected = false;
      this.connKey = null;
      this._syncUI();
      this._append(`[${nowStamp()}] DISCONNECTED`);
    }
  }
}
