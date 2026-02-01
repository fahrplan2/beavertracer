//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";
import { hexPreview, nowStamp, encodeUTF8, decodeUTF8 } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js"; // ggf. Pfad anpassen

/**
 * Parse "host:port" where host can be:
 *  - IPv4 dotted: "1.2.3.4"
 *  - IPv6 (optionally in brackets): "[2001:db8::1]" or "2001:db8::1"
 *  - legacy uint32 decimal: "3232235521"
 *
 * @param {string} s
 * @returns {{ host:string, port:number, ok:boolean }}
 */
function parseHostPort(s) {
  const str = String(s ?? "").trim();
  if (!str) return { host: "", port: 0, ok: false };

  // bracketed IPv6: [..]:port
  let m = /^\[([^\]]+)\]:(\d+)$/.exec(str);
  if (m) return { host: m[1], port: (Number(m[2]) | 0), ok: true };

  // try last-colon split for ipv4/uint32/hostname:port
  // (ipv6 without brackets is ambiguous -> we handle later)
  const lastColon = str.lastIndexOf(":");
  if (lastColon > 0 && lastColon < str.length - 1) {
    const host = str.slice(0, lastColon);
    const port = Number(str.slice(lastColon + 1));
    if (Number.isInteger(port) && port >= 0 && port <= 65535) {
      // If host contains multiple ':' it's very likely raw IPv6 without brackets.
      // We accept it; it will be parsed by IPAddress.fromString later.
      return { host, port: port | 0, ok: true };
    }
  }

  return { host: str, port: 0, ok: false };
}

/**
 * Convert legacy uint32 IPv4 to dotted string.
 * @param {number} n
 */
function v4u32ToString(n) {
  const x = (n >>> 0);
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
}

/**
 * Try to turn various input forms into IPAddress.
 * Accepts: IPAddress | number(v4 u32) | dotted v4 | v6 text | uint32 decimal string
 * @param {any} v
 * @returns {IPAddress|null}
 */
function toIPAddress(v) {
  try {
    if (v instanceof IPAddress) return v;

    if (typeof v === "number" && Number.isFinite(v)) {
      return IPAddress.fromString(v4u32ToString(v >>> 0));
    }

    const s = String(v ?? "").trim();
    if (!s) return null;

    // raw uint32 decimal
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) {
        return IPAddress.fromString(v4u32ToString(n >>> 0));
      }
    }

    // dotted v4 or v6 text
    return IPAddress.fromString(s);
  } catch {
    return null;
  }
}

/**
 * Parses your conn key format, but IPv6-ready.
 * Supported formats:
 *  - legacy: `${localU32}:${localPort}>${remoteU32}:${remotePort}`
 *  - v4 dotted: `1.2.3.4:123>5.6.7.8:80`
 *  - v6 bracketed: `[2001:db8::1]:123>[2001:db8::2]:80`
 *  - mixed without brackets (best effort): `2001:db8::1:123>2001:db8::2:80`  (ambiguous but we try last-colon split)
 *
 * @param {string} key
 * @returns {{ localIP: IPAddress|null, localPort:number, remoteIP: IPAddress|null, remotePort:number, ok:boolean }}
 */
function parseTCPKey(key) {
  const s = String(key ?? "");

  const parts = s.split(">");
  if (parts.length !== 2) return { localIP: null, localPort: 0, remoteIP: null, remotePort: 0, ok: false };

  const a = parseHostPort(parts[0]);
  const b = parseHostPort(parts[1]);

  const lip = toIPAddress(a.host);
  const rip = toIPAddress(b.host);

  const ok =
    a.ok && b.ok &&
    Number.isInteger(a.port) && a.port >= 0 && a.port <= 65535 &&
    Number.isInteger(b.port) && b.port >= 0 && b.port <= 65535 &&
    lip != null && rip != null;

  return {
    localIP: lip,
    localPort: a.ok ? a.port : 0,
    remoteIP: rip,
    remotePort: b.ok ? b.port : 0,
    ok,
  };
}

/**
 * Resolve host -> IPAddress.
 * Accepts:
 *  - dotted v4 / v6 -> parse directly
 *  - raw uint32 decimal -> parse to v4 dotted -> IPAddress
 *  - otherwise -> DNS (string or number) -> IPAddress
 *
 * @param {string} host
 * @param {(name:string)=>Promise<any>} dnsResolve
 * @returns {Promise<IPAddress>}
 */
async function resolveHostToIP(host, dnsResolve) {
  const direct = toIPAddress(host);
  if (direct) return direct;

  const r = await dnsResolve(host.trim());

  const ip = toIPAddress(r);
  if (!ip) throw new Error("DNS returned an unparseable address");
  return ip;
}

/**
 * Convert IPAddress to legacy IPv4 uint32 if possible (for old APIs).
 * @param {IPAddress} ip
 * @returns {number|null}
 */
function ipToLegacyV4Number(ip) {
  if (!ip.isV4()) return null;
  const n = ip.getNumber();
  return (typeof n === "number") ? (n >>> 0) : null;
}

export class SimpleTCPClientApp extends GenericProcess {
  get title() {
    return t("app.simpletcpclient.title");
  }

  icon="fa-message";

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
          return info.ok
            ? `${info.remoteIP.toString()}:${info.remotePort}`
            : this.connKey;
        })() : "-";

      status.textContent =
        t("app.simpletcpclient.status.connected", { connected: this.connected }) + "\n" +
        t("app.simpletcpclient.status.peer", { peer }) + "\n";
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

  /** @param {string} line */
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

    /** @type {(name:string)=>Promise<any>} */
    const dnsResolve = async (name) => {
      return await this.os.dns.resolve(name);
    };

    /** @type {IPAddress} */
    let dstIP;

    try {
      dstIP = await resolveHostToIP(this.host, dnsResolve);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(t("app.simpletcpclient.log.resolveError", { time: nowStamp(), host: this.host, reason }));
      return;
    }

    try {
      const conn = await this.os.net.connectTCPConn(dstIP, this.port);

      const key = conn?.key;
      if (typeof key !== "string" || !key) throw new Error(t("app.simpletcpclient.err.noConnKey"));

      this.connKey = key;
      this.connected = true;
      this._syncUI();

      const info = parseTCPKey(key);
      const who = info.ok ? `${info.remoteIP.toString()}:${info.remotePort}` : key;

      this._append(t("app.simpletcpclient.log.connected", { time: nowStamp(), who }));
      void this._recvLoop(key);
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

    let msg = (this.msgEl?.value ?? "");
    if (!msg.trim()) return;

    if (!msg.endsWith("\r\n")) msg += "\r\n";
    const data = encodeUTF8(msg);

    const info = parseTCPKey(this.connKey);
    const who = info.ok
      ? `${info.remoteIP.toString()}:${info.remotePort}`
      : this.connKey;

    try {
      this.os.net.sendTCPConn(this.connKey, data);
      this._append(t("app.simpletcpclient.log.sent", {
        time: nowStamp(),
        who,
        msg,
        len: data.length,
      }));
      if (this.msgEl) this.msgEl.value = "";
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._append(t("app.simpletcpclient.log.sendError", { time: nowStamp(), reason }));
    }
  }

  /** @param {string} key */
  async _recvLoop(key) {
    const info = parseTCPKey(key);
    const who = info.ok
      ? `${info.remoteIP.toString()}:${info.remotePort}`
      : key;

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

    if (this.connected && this.connKey === key) {
      this.connected = false;
      this.connKey = null;
      this._syncUI();
      this._append(t("app.simpletcpclient.log.disconnected", { time: nowStamp() }));
    }
  }
}
