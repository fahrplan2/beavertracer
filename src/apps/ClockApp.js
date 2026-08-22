//@ts-check

import { t } from "../i18n/index.js";
import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";

import { simTimer, SimTimer } from "../lib/SimTimer.js";
import { NTPPacket } from "../net/pdu/NTPPacket.js";
import { IPAddress } from "../net/models/IPAddress.js";

/**
 * "Clock" app — per-host control panel for the virtual system clock
 * (`os.clock`, see SystemClock.js).
 *
 * Three things in one place that otherwise only exist as separate terminal
 * commands (`date`, `date -s`, `ntpdate`):
 *  - a live readout of this host's current virtual date/time
 *  - manually setting date/time (like `date -s`), or resetting to the
 *    browser's real wall-clock time
 *  - triggering an NTP sync against a configured server (like `ntpdate`)
 */
export class ClockApp extends GenericProcess {
  get title() {
    return t("app.clock.title");
  }

  icon = "fa-clock";

  /** @type {string} */
  configPath = "/etc/clock.conf";

  /** @type {string} */
  ntpHost = "";

  /** @type {number} */
  ntpPort = 123;

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {boolean} */
  syncing = false;

  /** @type {HTMLElement|null} */ bigTimeEl = null;
  /** @type {HTMLElement|null} */ bigDateEl = null;

  /** @type {HTMLInputElement|null} */ dateEl = null;
  /** @type {HTMLInputElement|null} */ timeEl = null;
  /** @type {HTMLElement|null} */ setMsgEl = null;

  /** @type {HTMLInputElement|null} */ ntpHostEl = null;
  /** @type {HTMLInputElement|null} */ ntpPortEl = null;
  /** @type {HTMLButtonElement|null} */ syncBtn = null;
  /** @type {HTMLElement|null} */ ntpMsgEl = null;

  run() {
    this.root.classList.add("app", "app-clock");
    this._loadConfig();
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    // --- live readout ---
    const bigTime = UI.el("div", { className: "clock-display" });
    const bigDate = UI.el("div", { className: "clock-display-date" });
    this.bigTimeEl = bigTime;
    this.bigDateEl = bigDate;

    const liveSection = UI.el("div", { className: "cfg-section clock-live", children: [bigTime, bigDate] });

    // --- "set manually" tab ---
    const dateEl = UI.input({ type: "date" });
    const timeEl = UI.input({ type: "time" });
    timeEl.step = "1";
    this.dateEl = dateEl;
    this.timeEl = timeEl;

    const setMsg = UI.el("div", { className: "msg" });
    this.setMsgEl = setMsg;

    const setBtn = UI.button(t("app.clock.button.setTime"), () => this._applySetTime(), { primary: true, icon: "fa-check" });
    const resetBtn = UI.button(t("app.clock.button.resetToSystem"), () => this._resetToSystem(), { icon: "fa-rotate-left" });

    const setPane = UI.el("div", { className: "cfg-section", children: [
      UI.div("cfg-fields", [
        UI.row(t("app.clock.label.date"), dateEl),
        UI.row(t("app.clock.label.time"), timeEl),
      ]),
      UI.div("cfg-btn-row", [setBtn, resetBtn]),
      setMsg,
    ]});

    // --- "NTP sync" tab ---
    const ntpHostEl = UI.input({ placeholder: t("app.clock.placeholder.ntpServer"), value: this.ntpHost });
    const ntpPortEl = UI.input({ placeholder: "123", value: String(this.ntpPort) });
    this.ntpHostEl = ntpHostEl;
    this.ntpPortEl = ntpPortEl;

    const ntpMsg = UI.el("div", { className: "msg" });
    this.ntpMsgEl = ntpMsg;

    const syncBtn = UI.button(t("app.clock.button.syncNow"), () => void this._syncNtp(), { primary: true, icon: "fa-rotate" });
    this.syncBtn = syncBtn;

    const ntpPane = UI.el("div", { className: "cfg-section", children: [
      UI.div("cfg-fields", [
        UI.row(t("app.clock.label.ntpServer"), ntpHostEl),
        UI.row(t("app.clock.label.ntpPort"), ntpPortEl),
      ]),
      UI.div("cfg-btn-row", [syncBtn]),
      ntpMsg,
    ]});

    const { bar: tabBar } = UI.tabbedPane([
      { id: "set", label: t("app.clock.tab.setManually"), pane: setPane },
      { id: "ntp", label: t("app.clock.tab.ntpSync"),      pane: ntpPane },
    ]);

    const panel = UI.panel([liveSection, tabBar, setPane, ntpPane]);
    this.root.replaceChildren(panel);

    this._refreshManualInputsFromClock();
    this._renderNow();
    this.disposer.interval(() => this._renderNow(), 1000);
  }

  onUnmount() {
    this.disposer.dispose();
    this.bigTimeEl = this.bigDateEl = null;
    this.dateEl = this.timeEl = null;
    this.setMsgEl = null;
    this.ntpHostEl = this.ntpPortEl = this.syncBtn = null;
    this.ntpMsgEl = null;
    super.onUnmount();
  }

  /** Current virtual `Date` of this host — real wall time unless something deliberately skewed it. */
  _now() {
    return this.os.clock ? this.os.clock.now() : new Date();
  }

  _renderNow() {
    if (!this.mounted) return;
    const d = this._now();
    if (this.bigTimeEl) this.bigTimeEl.textContent = d.toLocaleTimeString();
    if (this.bigDateEl) {
      this.bigDateEl.textContent = d.toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      });
    }
  }

  _refreshManualInputsFromClock() {
    const d = this._now();
    if (this.dateEl) this.dateEl.value = this._fmtDateInput(d);
    if (this.timeEl) this.timeEl.value = this._fmtTimeInput(d);
  }

  /** @param {Date} d */
  _fmtDateInput(d) {
    const y = String(d.getFullYear()).padStart(4, "0");
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }

  /** @param {Date} d */
  _fmtTimeInput(d) {
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${mi}:${s}`;
  }

  /** @param {string} s */
  _setSetMsg(s) {
    if (this.setMsgEl) this.setMsgEl.textContent = s;
  }

  /** @param {string} s */
  _setNtpMsg(s) {
    if (this.ntpMsgEl) this.ntpMsgEl.textContent = s;
  }

  _applySetTime() {
    const clock = this.os.clock;
    if (!clock) return this._setSetMsg(t("app.clock.err.noClock"));

    const dateStr = (this.dateEl?.value ?? "").trim();
    const timeStr = (this.timeEl?.value ?? "").trim();
    if (!dateStr || !timeStr) return this._setSetMsg(t("app.clock.msg.invalidDate"));

    const dateParts = dateStr.split("-").map(Number);
    const timeParts = timeStr.split(":").map(Number);
    const [y, mo, da] = dateParts;
    const [h, mi, s] = timeParts;

    if (![y, mo, da, h, mi].every((n) => Number.isFinite(n))) {
      return this._setSetMsg(t("app.clock.msg.invalidDate"));
    }

    const d = new Date(y, mo - 1, da, h, mi, Number.isFinite(s) ? s : 0, 0);
    if (Number.isNaN(d.getTime())) return this._setSetMsg(t("app.clock.msg.invalidDate"));

    clock.setTime(d.getTime());
    this._renderNow();
    this._setSetMsg(t("app.clock.msg.timeSet", { time: d.toLocaleString() }));
  }

  _resetToSystem() {
    const clock = this.os.clock;
    if (!clock) return this._setSetMsg(t("app.clock.err.noClock"));

    clock.setTime(Date.now());
    this._refreshManualInputsFromClock();
    this._renderNow();
    this._setSetMsg(t("app.clock.msg.resetToSystem"));
  }

  _syncButtons() {
    if (this.syncBtn) this.syncBtn.disabled = this.syncing;
    if (this.ntpHostEl) this.ntpHostEl.disabled = this.syncing;
    if (this.ntpPortEl) this.ntpPortEl.disabled = this.syncing;
  }

  async _syncNtp() {
    if (this.syncing) return;

    const hostStr = (this.ntpHostEl?.value ?? "").trim();
    if (!hostStr) return this._setNtpMsg(t("app.clock.err.invalidServer", { host: hostStr }));

    const portStr = (this.ntpPortEl?.value ?? "").trim();
    const port = portStr === "" ? 123 : Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return this._setNtpMsg(t("app.clock.err.invalidPort", { portStr }));
    }

    const net = this.os.net;
    if (!net?.openUDPSocket || !net?.sendUDPSocket || !net?.recvUDPSocket || !net?.closeUDPSocket) {
      return this._setNtpMsg(t("app.clock.err.noUdp"));
    }

    const clock = this.os.clock;
    if (!clock) return this._setNtpMsg(t("app.clock.err.noClock"));

    /** @type {IPAddress|null} */
    let serverIp = null;
    try {
      serverIp = IPAddress.fromString(hostStr);
    } catch {
      const dns = this.os.dns;
      if (dns?.resolveIP) {
        try { serverIp = await dns.resolveIP(hostStr); } catch { /* ignore */ }
      }
    }
    if (!serverIp) return this._setNtpMsg(t("app.clock.err.cannotResolve", { host: hostStr }));
    if (!serverIp.isV4()) return this._setNtpMsg(t("app.clock.err.ipv4Only"));

    this.syncing = true;
    this._syncButtons();
    this._setNtpMsg(t("app.clock.msg.syncing", { server: serverIp.toString(), port }));

    const anyV4 = new IPAddress(4, 0);
    /** @type {number|null} */
    let sock = null;

    try {
      for (let p = 49152; p <= 65535; p++) {
        try { sock = net.openUDPSocket(anyV4, p); break; } catch { /* keep trying */ }
      }
      if (sock == null) throw new Error("no free udp port");

      // T1 — this host's own (possibly wrong) virtual clock at send time.
      const t1 = clock.nowMs();

      const query = new NTPPacket({
        li: 0,
        vn: 4,
        mode: NTPPacket.MODE_CLIENT,
        transmitTimestampMs: t1,
      });
      net.sendUDPSocket(sock, serverIp, port, query.pack());

      const resp = await this._recvNtpReply(sock, serverIp, SimTimer.NTP_TIMEOUT_MS);

      // T4 — this host's clock at receive time (still running on the old offset).
      const t4 = clock.nowMs();

      if (!resp) {
        this._setNtpMsg(t("app.clock.msg.syncTimeout", { server: serverIp.toString(), port }));
        return;
      }

      const t2 = resp.receiveTimestampMs;
      const t3 = resp.transmitTimestampMs;
      const offsetMs = ((t2 - t1) + (t3 - t4)) / 2;
      const delayMs = (t4 - t1) - (t3 - t2);

      clock.adjust(offsetMs);
      this._saveConfig(hostStr, port);
      this._refreshManualInputsFromClock();
      this._renderNow();

      this._setNtpMsg(t("app.clock.msg.syncOk", {
        server: serverIp.toString(),
        stratum: resp.stratum,
        refid: resp.referenceIdText,
        offset: offsetMs.toFixed(1),
        delay: delayMs.toFixed(1),
      }));
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._setNtpMsg(t("app.clock.msg.syncFailed", { reason }));
    } finally {
      try { if (sock != null) net.closeUDPSocket(sock); } catch { /* ignore */ }
      this.syncing = false;
      this._syncButtons();
    }
  }

  /**
   * Races exactly one outstanding recv() at a time against a single timeout
   * deadline, discarding replies from any host other than `serverIp` — same
   * approach as the `ntpdate` terminal command (see net/ntpdate.js for why
   * the recv() call must not be recreated on every poll tick).
   * @param {number} sock
   * @param {IPAddress} serverIp
   * @param {number} timeoutSimMs
   * @returns {Promise<NTPPacket|null>}
   */
  async _recvNtpReply(sock, serverIp, timeoutSimMs) {
    const net = this.os.net;
    const serverV4Num = /** @type {number} */ (serverIp.getNumber()) >>> 0;

    const timedOut = Symbol("timeout");
    const deadline = simTimer.sleep(timeoutSimMs).then(() => timedOut);
    let pending = net.recvUDPSocket(sock);

    while (true) {
      /** @type {any} */
      const res = await Promise.race([pending, deadline]);

      if (res === timedOut || res == null) return null;

      const srcNum = (res.src instanceof IPAddress && res.src.isV4()) ? (/** @type {number} */ (res.src.getNumber()) >>> 0) : null;
      if (srcNum != null && srcNum !== serverV4Num) { pending = net.recvUDPSocket(sock); continue; }

      const data = res.payload instanceof Uint8Array ? res.payload : null;
      if (!data) { pending = net.recvUDPSocket(sock); continue; }

      try {
        return NTPPacket.fromBytes(data);
      } catch { pending = net.recvUDPSocket(sock); continue; }
    }
  }

  // ------------------ persistence (/etc/clock.conf) ------------------

  _loadConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      const json = JSON.parse(fs.readFile(this.configPath));
      if (typeof json.ntpHost === "string") this.ntpHost = json.ntpHost;
      if (Number.isInteger(json.ntpPort) && json.ntpPort >= 1 && json.ntpPort <= 65535) this.ntpPort = json.ntpPort;
    } catch { /* use defaults */ }
  }

  /** @param {string} host @param {number} port */
  _saveConfig(host, port) {
    this.ntpHost = host;
    this.ntpPort = port;
    const fs = this.os.fs;
    if (!fs) return;
    try {
      fs.writeFile(this.configPath, JSON.stringify({ ntpHost: host, ntpPort: port }, null, 2) + "\n");
    } catch { /* ignore */ }
  }
}
