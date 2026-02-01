//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";

import { nowStamp, hexPreview } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js"; // ggf. Pfad anpassen

export class UDPEchoServerApp extends GenericProcess {
  get title() {
    return t("app.udpechoserver.title");
  }

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {number} */
  port = 7;

  /** @type {number|null} */
  socketPort = null;

  /** @type {boolean} */
  running = false;

  /** @type {Array<string>} */
  log = [];

  /** @type {HTMLTextAreaElement|null} */
  logEl = null;

  /** @type {HTMLInputElement|null} */
  portEl = null;

  /** @type {HTMLButtonElement|null} */
  startBtn = null;

  /** @type {HTMLButtonElement|null} */
  stopBtn = null;

  run() {
    this.root.classList.add("app", "app-udp-echo");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const portInput = UI.input({
      placeholder: t("app.udpechoserver.placeholder.port"),
      value: String(this.port),
    });
    this.portEl = portInput;

    /** @type {HTMLButtonElement} */
    const start = UI.button(t("app.udpechoserver.button.start"), () => this._startFromUI(), { primary: true });
    /** @type {HTMLButtonElement} */
    const stop = UI.button(t("app.udpechoserver.button.stop"), () => this._stop(), {});
    /** @type {HTMLButtonElement} */
    const clear = UI.button(t("app.udpechoserver.button.clearLog"), () => { this.log = []; this._renderLog(); }, {});

    this.startBtn = start;
    this.stopBtn = stop;

    const logBox = UI.textarea({
      className: "log",
      readonly: "true",
      spellcheck: "false",
    });
    this.logEl = logBox;

    const panel = UI.panel([
      UI.row(t("app.udpechoserver.label.listenPort"), portInput),
      UI.buttonRow([start, stop, clear]),
      UI.el("div", { text: t("app.udpechoserver.label.log") }),
      logBox,
    ]);

    this.root.replaceChildren(panel);

    this._syncButtons();
    this._renderLog();
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl = null;
    this.portEl = null;
    this.startBtn = null;
    this.stopBtn = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    super.destroy();
  }

  _syncButtons() {
    if (this.startBtn) this.startBtn.disabled = this.running;
    if (this.stopBtn) this.stopBtn.disabled = !this.running;
    if (this.portEl) this.portEl.disabled = this.running;
  }

  _renderLog() {
    if (!this.logEl) return;
    const maxLines = 200;
    const lines = this.log.length > maxLines ? this.log.slice(-maxLines) : this.log;
    this.logEl.value = lines.join("\n");
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** @param {string} line */
  _appendLog(line) {
    this.log.push(line);
    if (this.log.length > 2000) this.log.splice(0, this.log.length - 2000);
    if (this.mounted) this._renderLog();
  }

  _startFromUI() {
    const s = (this.portEl?.value ?? "").trim();
    const p = Number(s);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      this._appendLog(t("app.udpechoserver.log.invalidPort", { time: nowStamp(), portStr: s }));
      return;
    }
    this.port = p;
    this._start();
  }

  _start() {
    if (this.running) return;

    try {
      const port = this.os.net.openUDPSocket(new IPAddress(4,0), this.port);
      this.socketPort = port;
      this.running = true;

      this._appendLog(t("app.udpechoserver.log.listening", { time: nowStamp(), port }));
      this._syncButtons();

      void this._recvLoop();
    } catch (e) {
      this.socketPort = null;
      this.running = false;
      this._syncButtons();
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(t("app.udpechoserver.log.startFailed", { time: nowStamp(), reason }));
    }
  }

  _stop() {
    if (!this.running && this.socketPort == null) return;

    const port = this.socketPort;
    this.running = false;
    this.socketPort = null;

    if (port != null) {
      try {
        this.os.net.closeUDPSocket(port);
        this._appendLog(t("app.udpechoserver.log.stopped", { time: nowStamp(), port }));
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.udpechoserver.log.stopError", { time: nowStamp(), reason }));
      }
    }

    this._syncButtons();
  }

  // ---------------- IPv6-ready helpers ----------------

  /**
   * Normalize incoming "src/dst" into an IPAddress if possible.
   * Accepts: IPAddress | number(v4) | string | Uint8Array(4/16)
   *
   * @param {any} v
   * @returns {IPAddress|null}
   */
  _asIPAddress(v) {
    try {
      if (v instanceof IPAddress) return v;

      if (typeof v === "number" && Number.isFinite(v)) {
        // legacy v4 uint32 -> string -> IPAddress
        const x = (v >>> 0);
        const s = `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
        return IPAddress.fromString(s);
      }

      if (typeof v === "string" && v.trim()) {
        return IPAddress.fromString(v.trim());
      }

      if (v instanceof Uint8Array) {
        // you should have IPAddress.fromUInt8(bytes) – if not, add it.
        if (typeof IPAddress.fromUInt8 === "function") {
          return IPAddress.fromUInt8(v);
        }
        // fallback: handle v4 only
        if (v.length === 4) {
          const s = `${v[0]}.${v[1]}.${v[2]}.${v[3]}`;
          return IPAddress.fromString(s);
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Convert an IPAddress to whatever your current IPStack UDP API needs.
   * Today: number (IPv4 only) for dstip/srcip.
   * Later: you can change this to pass IPAddress through directly.
   *
   * @param {IPAddress|null} ip
   * @returns {number|null} v4 uint32 or null if not representable (e.g., IPv6)
   */
  _ipToLegacyV4Number(ip) {
    if (!ip) return null;
    if (!ip.isV4()) return null;
    const n = ip.getNumber();
    // ensure number
    return (typeof n === "number" && Number.isFinite(n)) ? (n >>> 0) : null;
  }

  /** @param {IPAddress|null} ip */
  _ipToString(ip) {
    return ip ? ip.toString() : "*";
  }

  // ---------------- main loop ----------------

  async _recvLoop() {
    while (this.running && this.socketPort != null) {
      const sock = this.socketPort;

      /** @type {any} */
      let pkt = null;

      try {
        pkt = await this.os.net.recvUDPSocket(sock);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.udpechoserver.log.recvError", { time: nowStamp(), reason }));
        continue;
      }

      if (!this.running || this.socketPort == null) break;
      if (pkt == null) break;

      // expected shape today: {src:number, srcPort:number, payload:Uint8Array}
      // but accept future shapes.
      const srcIp = this._asIPAddress(pkt.src ?? pkt.srcIp ?? pkt.remote ?? null);
      const srcPort = typeof pkt.srcPort === "number"
        ? (pkt.srcPort | 0)
        : (typeof pkt.remotePort === "number" ? (pkt.remotePort | 0) : 0);

      /** @type {Uint8Array} */
      const data =
        pkt.payload instanceof Uint8Array ? pkt.payload :
        (pkt.data instanceof Uint8Array ? pkt.data : new Uint8Array());

      this._appendLog(t("app.udpechoserver.log.rx", {
        time: nowStamp(),
        ip: this._ipToString(srcIp),
        srcPort,
        len: data.length,
        hex: hexPreview(data),
      }));

      // echo back
      try {
        // TODAY: your IPStack expects dstip as IPv4 number.
        // If src is IPv6, we cannot answer yet -> log a nice "not supported yet".
        const dstV4 = this._ipToLegacyV4Number(srcIp);
        if (dstV4 == null) {
          this._appendLog(
            t("app.udpechoserver.log.sendError", {
              time: nowStamp(),
              reason: "IPv6 peer address not supported by current stack yet",
            })
          );
          continue;
        }

        this.os.net.sendUDPSocket(sock, dstV4, srcPort, data);

        this._appendLog(t("app.udpechoserver.log.txEcho", {
          time: nowStamp(),
          ip: this._ipToString(srcIp),
          srcPort,
          len: data.length,
        }));
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(t("app.udpechoserver.log.sendError", { time: nowStamp(), reason }));
      }
    }

    this._syncButtons();
  }
}
