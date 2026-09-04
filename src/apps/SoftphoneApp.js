//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { Disposer } from "../lib/Disposer.js";
import { UILib as UI } from "./lib/UILib.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { t } from "../i18n/index.js";
import { nowStamp } from "../lib/helpers.js";
import { simAudio } from "../lib/SimAudio.js";

import { SipStack } from "../net/SipStack.js";
import { RtpSession } from "../net/RtpSession.js";
import { SdpMessage } from "../net/pdu/SdpMessage.js";
import { StunClient } from "../net/StunClient.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";

const SIP_PORT = 5060;
const CONF_PATH = "/etc/softphone.conf";

/**
 * Built-in phrase manifest. `id` goes on the wire (VoiceFrame.phraseId), `key`
 * is the i18n label on the button, `text` feeds the optional speech synth, and
 * `durationMs` sets how many RTP frames the talkspurt occupies.
 */
const PHRASES = [
  { id: 1, key: "app.softphone.phrase.hello",     text: "Hello.",                 durationMs: 900 },
  { id: 2, key: "app.softphone.phrase.howareyou", text: "How are you?",           durationMs: 1300 },
  { id: 3, key: "app.softphone.phrase.fine",      text: "I am fine, thank you.",  durationMs: 1700 },
  { id: 4, key: "app.softphone.phrase.repeat",    text: "Could you repeat that?", durationMs: 1700 },
  { id: 5, key: "app.softphone.phrase.bye",       text: "Goodbye.",               durationMs: 1000 },
];

export class SoftphoneApp extends GenericProcess {
  get title() { return t("app.softphone.title"); }

  icon = "fa-phone";

  disposer = new Disposer();

  // ── identity / registration ──
  // A numeric default nudges toward the keypad — the AOR user-part can just as
  // well be a name ("alice"), which the user discovers by trying it.
  user = "100";
  domain = "";
  registrarHost = "";
  /** optional STUN server (host[:port]) used to learn our NAT-mapped public
   *  address for the SIP Contact and SDP — see StunClient / STUNServerApp. */
  stunServer = "";
  registered = false;
  /** re-register automatically on next start (persisted in /etc/softphone.conf) */
  _autoRegister = false;

  // ── SIP ──
  /** @type {SipStack|null} */ _sip = null;
  /** @type {number|null} */   _sipSock = null;
  /** @type {StunClient|null} */ _sipStun = null;
  /** @type {StunClient|null} */ _rtpStun = null;
  /** @type {string|null} resolved STUN server IP, cached once we've used it */ _stunServerIp = null;
  /** @type {number|null} */ _sipKeepaliveTimer = null;
  /** @type {number|null} */ _rtpKeepaliveTimer = null;

  // ── current call ──
  /** @type {string|null} */ _callId = null;
  /** @type {"idle"|"calling"|"ringing"|"ringing-in"|"in-call"|"ended"} */ _callState = "idle";
  /** @type {{ callId:string, fromUri:string|null, fromName:string|null, sdp:string|null, answer:(s:string)=>void, reject:(c?:number,r?:string)=>void }|null} */ _incoming = null;

  // ── RTP media ──
  /** @type {RtpSession|null} */ _rtp = null;
  /** @type {number|null} */     _rtpSock = null;
  /** @type {number} */          _rtpPort = 0;

  // ── audio ──
  /** @type {Map<number, Promise<AudioBuffer|null>>} */ _bufCache = new Map();
  /** @type {number|null} */ _ringTimer = null;
  /** @type {"ringback"|"incoming"|null} */ _ringMode = null;
  _audioBlockedWarned = false;
  /** true once TTS has started for the current inbound talkspurt */
  _spokeTalkspurt = false;

  /** @type {number|null} */ _statsIntervalId = null;
  /** @type {string} */ _lastEndReason = "";
  /** @type {Array<{cls:string, text:string}>} */ _logLines = [];

  // ── UI refs ──
  /** @type {HTMLInputElement|null} */ _userEl = null;
  /** @type {HTMLInputElement|null} */ _domainEl = null;
  /** @type {HTMLInputElement|null} */ _registrarEl = null;
  /** @type {HTMLInputElement|null} */ _stunEl = null;
  /** @type {HTMLButtonElement|null} */ _regBtn = null;
  /** @type {HTMLElement|null} */ _regDot = null;
  /** @type {HTMLInputElement|null} */ _dispEl = null;
  /** @type {HTMLElement|null} */ _dispSubEl = null;
  /** @type {HTMLElement|null} */ _keypadEl = null;
  /** @type {HTMLButtonElement|null} */ _callBtn = null;
  /** @type {HTMLButtonElement|null} */ _hangBtn = null;
  /** @type {HTMLButtonElement|null} */ _bkspBtn = null;
  /** @type {HTMLElement|null} */ _incomingEl = null;
  /** @type {HTMLElement|null} */ _phrasesEl = null;
  /** @type {HTMLElement|null} */ _logEl = null;

  run() {
    this.root.classList.add("app", "app-softphone");
    this._loadConfig();
    this._buildSip();
    setTimeout(() => this._tryAutoRegister(), 0);
  }

  // ── persisted settings (/etc/softphone.conf) ───────────────────────

  _loadConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      const j = JSON.parse(fs.readFile(CONF_PATH));
      if (typeof j.user === "string" && j.user.trim()) this.user = j.user.trim();
      if (typeof j.domain === "string") this.domain = j.domain.trim();
      if (typeof j.registrar === "string") this.registrarHost = j.registrar.trim();
      if (typeof j.stunServer === "string") this.stunServer = j.stunServer.trim();
      this._autoRegister = j.autoRegister === true;
    } catch { /* no config yet — keep defaults */ }
  }

  /** @param {Record<string, any>} [extra] */
  _saveConfig(extra = {}) {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      let cur = {};
      try { cur = JSON.parse(fs.readFile(CONF_PATH)); } catch { /* new file */ }
      const next = {
        ...cur,
        user: this.user,
        domain: this.domain,
        registrar: this.registrarHost,
        stunServer: this.stunServer,
        ...extra,
      };
      fs.writeFile(CONF_PATH, JSON.stringify(next, null, 2) + "\n");
    } catch { /* ignore */ }
  }

  _tryAutoRegister() {
    if (!this._autoRegister || !this.registrarHost) return;
    void this._doRegister();
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();
    this._buildUI();
    this._syncUI();
    // Sim-wide audio unlocks on the first interaction anywhere (SimAudio arms
    // its own global listeners); nudging it here too is harmless.
    const unlock = () => { void simAudio.unlock(); };
    this.disposer.on(this.root, "pointerdown", unlock);
    this.disposer.on(this.root, "keydown", unlock);
  }

  onUnmount() {
    this.disposer.dispose();
    this._userEl = this._domainEl = this._registrarEl = this._stunEl = null;
    this._regBtn = this._regDot = this._callBtn = this._hangBtn = this._bkspBtn = null;
    this._dispEl = this._dispSubEl = this._keypadEl = null;
    this._incomingEl = this._phrasesEl = this._logEl = null;
    super.onUnmount();
  }

  destroy() {
    this._stopRingtone();
    try { if (this._callId) this._sip?.hangup(this._callId); } catch { /* ignore */ }
    this._teardownRtp();
    this._stopSipKeepalive();
    try { this._sip?.dispose(); } catch { /* ignore */ }
    try { this._sipStun?.dispose(); } catch { /* ignore */ }
    this._sipStun = null;
    if (this._sipSock != null) { try { this.os.net.closeUDPSocket(this._sipSock); } catch { /* ignore */ } this._sipSock = null; }
    // the AudioContext is sim-wide (SimAudio) — do not close it here
    super.destroy();
  }

  // ── SIP wiring ──────────────────────────────────────────────────────

  /** Create the SIP stack and event wiring. Does NOT open a socket — see _ensureSocket(). */
  _buildSip() {
    if (this._sip) return;

    this._sip = new SipStack({
      transport: {
        send: (bytes, dstIp, dstPort) => {
          if (this._sipSock == null) return;
          try { this.os.net.sendUDPSocket(this._sipSock, IPAddress.fromString(dstIp), dstPort, bytes); }
          catch { /* drop */ }
        },
      },
      userAgent: "BeaverPhone/0.1",
    });

    this._sip.on("registrationState", (state, detail) => this._onRegistrationState(state, detail));
    this._sip.on("incomingCall", (call) => this._onIncomingCall(call));
    this._sip.on("progress", (_id, p) => {
      if (this._callState === "calling" || this._callState === "ringing") {
        const wasRinging = this._callState === "ringing";
        this._callState = "ringing";
        if (!wasRinging) {
          this._log("sys", t("app.softphone.log.ringing"));
          this._startRingtone("ringback");
        }
        this._syncUI();
      }
    });
    this._sip.on("answered", (_id, { sdp }) => this._onAnswered(sdp));
    this._sip.on("ended", (_id, { reason }) => this._onEnded(reason));
    this._sip.on("signaling", ({ dir, message, peerIp }) => {
      const line = message.startLine();
      this._log(dir === "tx" ? "tx" : "rx", `${dir === "tx" ? "→" : "←"} ${peerIp}  ${line}`);
    });
  }

  /**
   * Bind UDP 5060 and start the receive loop the first time the phone is
   * actually used. Opening it in run() would let an unused Softphone squat the
   * port on every host that has the app installed (e.g. blocking a SIP server).
   * @returns {boolean}
   */
  _ensureSocket() {
    if (this._sipSock != null) return true;
    try {
      this._sipSock = this.os.net.openUDPSocket(new IPAddress(4, 0), SIP_PORT);
    } catch (e) {
      this._log("err", t("app.softphone.err.sipPort", { reason: e instanceof Error ? e.message : String(e) }));
      this._sipSock = null;
      return false;
    }
    this._sipStun = new StunClient({
      transport: {
        send: (bytes, dstIp, dstPort) => {
          if (this._sipSock == null) return;
          try { this.os.net.sendUDPSocket(this._sipSock, IPAddress.fromString(dstIp), dstPort, bytes); }
          catch { /* drop */ }
        },
      },
    });
    void this._sipRecvLoop();
    return true;
  }

  async _sipRecvLoop() {
    const sock = this._sipSock;
    while (this._sipSock === sock && sock != null) {
      let m;
      try { m = await this.os.net.recvUDPSocket(sock); }
      catch { break; }
      if (m == null) break;
      const srcIp = m.src.toString();
      if (this._sipStun?.receive(m.payload, srcIp, m.srcPort)) continue; // STUN Binding reply for this socket
      try { this._sip?.receive(m.payload, srcIp, m.srcPort); }
      catch (e) { this._log("err", `SIP recv: ${e instanceof Error ? e.message : e}`); }
    }
  }

  // ── registration ───────────────────────────────────────────────────

  async _toggleRegister() {
    // Registering is a user click — unlock sim audio now so an inbound call rings.
    void simAudio.unlock();
    if (this.registered) {
      try { this._sip?.unregister(); } catch { /* ignore */ }
      return;
    }
    this.user = (this._userEl?.value ?? "").trim() || "100";
    this.registrarHost = (this._registrarEl?.value ?? "").trim();
    this.domain = (this._domainEl?.value ?? "").trim() || this.registrarHost;
    this.stunServer = (this._stunEl?.value ?? "").trim();
    if (!this.registrarHost) { this._log("err", t("app.softphone.err.noRegistrar")); return; }
    this._saveConfig();
    await this._doRegister();
  }

  /** Resolve the registrar, set our identity and send REGISTER. Uses this.* fields. */
  async _doRegister() {
    if (!this.registrarHost || !this._ensureSocket()) return;

    let registrarIp;
    try { registrarIp = await this._resolve(this.registrarHost); }
    catch { this._log("err", t("app.softphone.err.resolve", { host: this.registrarHost })); return; }

    let contactIp = this._localIp(registrarIp);
    let contactPort = SIP_PORT;
    if (this.stunServer && this._sipStun) {
      try {
        this._stunServerIp = await this._resolve(this.stunServer);
        const mapped = await this._sipStun.bind({ serverIp: this._stunServerIp });
        contactIp = mapped.ip;
        contactPort = mapped.port;
        this._log("sys", t("app.softphone.log.stunMapped", { addr: `${contactIp}:${contactPort}` }));
      } catch (e) {
        this._log("err", t("app.softphone.err.stunFailed", { reason: e instanceof Error ? e.message : String(e) }));
      }
    }

    this._sip?.setIdentity({
      uri: `sip:${this.user}@${this.domain || registrarIp}`,
      displayName: this.user,
      contactIp,
      contactPort,
    });
    this._log("sys", t("app.softphone.log.registering", { host: this.registrarHost }));
    try { this._sip?.register({ registrarIp, registrarPort: SIP_PORT, expires: 600 }); }
    catch (e) { this._log("err", String(e instanceof Error ? e.message : e)); }
  }

  /** @param {string} state @param {any} detail */
  _onRegistrationState(state, detail) {
    this.registered = state === "registered";
    if (state === "registered") {
      this._log("sys", t("app.softphone.log.registered"));
      this._autoRegister = true;
      this._saveConfig({ autoRegister: true });
      if (this._stunServerIp) this._startSipKeepalive();
    } else if (state === "unregistered") {
      this._log("sys", t("app.softphone.log.unregistered"));
      this._autoRegister = false;
      this._saveConfig({ autoRegister: false });
      this._stopSipKeepalive();
    } else {
      this._log("err", t("app.softphone.log.regFailed", { reason: detail?.reason ?? "?" }));
      this._stopSipKeepalive();
    }
    this._syncUI();
  }

  /**
   * Re-punch the SIP socket's NAT binding on the sim clock while registered —
   * independent of the (much longer) SIP re-REGISTER interval, since
   * NatEngine.UDP_IDLE_MS is short enough that the mapping would otherwise go
   * stale between registrations. No-op if we never learned a STUN mapping.
   */
  _startSipKeepalive() {
    this._stopSipKeepalive();
    const tick = () => {
      this._sipKeepaliveTimer = null;
      if (!this.registered || !this._stunServerIp || !this._sipStun) return;
      this._sipStun.bind({ serverIp: this._stunServerIp }).catch(() => { /* next tick tries again */ });
      this._sipKeepaliveTimer = simTimer.schedule(tick, SimTimer.STUN_KEEPALIVE_MS);
    };
    this._sipKeepaliveTimer = simTimer.schedule(tick, SimTimer.STUN_KEEPALIVE_MS);
  }

  _stopSipKeepalive() {
    if (this._sipKeepaliveTimer != null) { simTimer.cancel(this._sipKeepaliveTimer); this._sipKeepaliveTimer = null; }
  }

  // ── outgoing call ──────────────────────────────────────────────────

  async _placeCall() {
    if (this._callState !== "idle" && this._callState !== "ended") return;
    const raw = (this._dispEl?.value ?? "").trim();
    if (!raw) { this._log("err", t("app.softphone.err.noTarget")); return; }
    if (!this.registered || !this._sip?.identity) { this._log("err", t("app.softphone.err.notRegistered")); return; }
    if (!this._ensureSocket()) return;

    const targetUri = raw.startsWith("sip:") ? raw : `sip:${raw}@${this.domain || this.registrarHost}`;

    let registrarIp;
    try { registrarIp = await this._resolve(this.registrarHost); }
    catch { this._log("err", t("app.softphone.err.resolve", { host: this.registrarHost })); return; }

    if (!this._openRtp()) { this._log("err", t("app.softphone.err.noRtpPort")); return; }
    const { address, port } = await this._rtpPublicAddress(registrarIp);
    const offer = SdpMessage.audioOffer({ address, port }).toString();

    this._callState = "calling";
    this._log("sys", t("app.softphone.log.calling", { target: targetUri }));
    this._syncUI();
    this._callId = this._sip.call({ targetUri, peerIp: registrarIp, peerPort: SIP_PORT, sdp: offer });
  }

  /** @param {string|null} sdp */
  _onAnswered(sdp) {
    try {
      if (sdp && this._rtp) {
        const parsed = SdpMessage.parse(sdp);
        const a = parsed.audio;
        if (a && a.port > 0) this._rtp.setRemote(parsed.addressFor(a), a.port);
        else this._log("err", t("app.softphone.err.badSdp"));
      }
    } catch (e) {
      this._log("err", `SDP: ${e instanceof Error ? e.message : e}`);
    }
    this._stopRingtone();
    this._callState = "in-call";
    this._log("sys", t("app.softphone.log.inCall"));
    this._syncUI();
    this._startStatsTicker();
  }

  // ── incoming call ─────────────────────────────────────────────────

  /** @param {any} call */
  _onIncomingCall(call) {
    if (this._callState === "in-call" || this._callState === "calling" || this._callState === "ringing") {
      call.reject(486, "Busy Here");
      return;
    }
    this._incoming = call;
    this._callState = "ringing-in";
    this._log("sys", t("app.softphone.log.incoming", { from: call.fromName || call.fromUri || "?" }));
    this._startRingtone("incoming");
    this._syncUI();
  }

  async _acceptIncoming() {
    const inc = this._incoming;
    if (!inc) return;
    this._stopRingtone();
    if (!this._openRtp()) { this._log("err", t("app.softphone.err.noRtpPort")); inc.reject(500, "Server Internal Error"); this._incoming = null; this._callState = "idle"; this._syncUI(); return; }

    let remoteAddr = "0.0.0.0", remotePort = 0;
    try {
      if (inc.sdp) {
        const parsed = SdpMessage.parse(inc.sdp);
        const a = parsed.audio;
        if (a) { remoteAddr = parsed.addressFor(a); remotePort = a.port; }
      }
    } catch (e) { this._log("err", `SDP: ${e instanceof Error ? e.message : e}`); }
    this._rtp?.setRemote(remoteAddr, remotePort);

    const towardIp = remoteAddr !== "0.0.0.0" ? remoteAddr : (this.registrarHost || "0.0.0.0");
    const { address, port } = await this._rtpPublicAddress(towardIp);
    const answer = SdpMessage.audioOffer({ address, port }).toString();

    this._callId = inc.callId;
    this._incoming = null;
    this._callState = "in-call";
    inc.answer(answer);
    this._log("sys", t("app.softphone.log.inCall"));
    this._syncUI();
    this._startStatsTicker();
  }

  _rejectIncoming() {
    this._stopRingtone();
    this._incoming?.reject(486, "Busy Here");
    this._incoming = null;
    this._callState = "idle";
    this._log("sys", t("app.softphone.log.rejected"));
    this._syncUI();
  }

  // ── hang up / end ────────────────────────────────────────────────

  _hangup() {
    if (this._callId) { try { this._sip?.hangup(this._callId); } catch { /* ignore */ } }
  }

  /** @param {string} reason */
  _onEnded(reason) {
    this._stopRingtone();
    simAudio.cancelSpeech();
    if (reason === "busy" || reason === "declined") this._playBusyTone();
    this._callState = "ended";
    this._lastEndReason = reason;
    this._log("sys", t("app.softphone.log.ended", { reason }));
    this._teardownRtp();
    this._callId = null;
    this._stopStatsTicker();
    this._syncUI();
  }

  // ── RTP media ───────────────────────────────────────────────────

  /** @returns {boolean} */
  _openRtp() {
    this._teardownRtp();
    const any = new IPAddress(4, 0);
    for (let i = 0; i < 24; i++) {
      const p = 16384 + 2 * Math.floor(Math.random() * 8000); // even port, 16384..32382
      try { this._rtpSock = this.os.net.openUDPSocket(any, p); this._rtpPort = p; break; }
      catch { this._rtpSock = null; }
    }
    if (this._rtpSock == null) return false;

    this._rtp = new RtpSession({
      transport: {
        send: (bytes, dstIp, dstPort) => {
          if (this._rtpSock == null) return;
          try { this.os.net.sendUDPSocket(this._rtpSock, IPAddress.fromString(dstIp), dstPort, bytes); }
          catch { /* drop */ }
        },
      },
      // Compress the talkspurt onto the wire instead of one packet per 100 ms of
      // sim-time — the RTP timestamps stay nominal, but the audio is heard
      // without the big playback lag a slowed-down simulation would add.
      pacing: "burst",
    });
    this._rtp.on("firstPacket", () => this._log("media", t("app.softphone.log.mediaUp")));
    this._rtp.on("talkstart", ({ phraseId }) => this._onTalkstart(phraseId));
    this._rtp.on("talkspurt", (ts) => this._onTalkspurt(ts));
    this._rtpStun = new StunClient({
      transport: {
        send: (bytes, dstIp, dstPort) => {
          if (this._rtpSock == null) return;
          try { this.os.net.sendUDPSocket(this._rtpSock, IPAddress.fromString(dstIp), dstPort, bytes); }
          catch { /* drop */ }
        },
      },
    });
    void this._rtpRecvLoop();
    return true;
  }

  async _rtpRecvLoop() {
    const sock = this._rtpSock;
    while (this._rtpSock === sock && sock != null) {
      let m;
      try { m = await this.os.net.recvUDPSocket(sock); }
      catch { break; }
      if (m == null) break;
      const srcIp = m.src.toString();
      if (this._rtpStun?.receive(m.payload, srcIp, m.srcPort)) continue; // STUN Binding reply for this socket
      try { this._rtp?.receive(m.payload, srcIp, m.srcPort); }
      catch (e) { this._log("err", `RTP recv: ${e instanceof Error ? e.message : e}`); }
    }
  }

  /**
   * Public (NAT-mapped) address for the RTP socket, for SDP c=/m=. Falls back
   * to the local interface address if no STUN server is configured or the
   * Binding Request fails — the call still proceeds, just without NAT
   * traversal (fine on a LAN / when there's no NAT in the path).
   * @param {string} towardIp used only for the local-address fallback
   * @returns {Promise<{address: string, port: number}>}
   */
  async _rtpPublicAddress(towardIp) {
    if (this.stunServer && this._rtpStun) {
      try {
        this._stunServerIp ??= await this._resolve(this.stunServer);
        const mapped = await this._rtpStun.bind({ serverIp: this._stunServerIp });
        this._log("sys", t("app.softphone.log.stunMappedRtp", { addr: `${mapped.ip}:${mapped.port}` }));
        this._startRtpKeepalive(this._stunServerIp);
        return { address: mapped.ip, port: mapped.port };
      } catch (e) {
        this._log("err", t("app.softphone.err.stunFailed", { reason: e instanceof Error ? e.message : String(e) }));
      }
    }
    return { address: this._localIp(towardIp), port: this._rtpPort };
  }

  /**
   * Re-punch the RTP socket's NAT binding while a call is ringing/being set
   * up — before media flows there's no other traffic to keep the mapping
   * fresh, and a ring can easily outlast NatEngine.UDP_IDLE_MS.
   * @param {string} stunIp
   */
  _startRtpKeepalive(stunIp) {
    this._stopRtpKeepalive();
    const tick = () => {
      this._rtpKeepaliveTimer = null;
      if (!this._rtpStun) return;
      this._rtpStun.bind({ serverIp: stunIp }).catch(() => { /* next tick tries again */ });
      this._rtpKeepaliveTimer = simTimer.schedule(tick, SimTimer.STUN_KEEPALIVE_MS);
    };
    this._rtpKeepaliveTimer = simTimer.schedule(tick, SimTimer.STUN_KEEPALIVE_MS);
  }

  _stopRtpKeepalive() {
    if (this._rtpKeepaliveTimer != null) { simTimer.cancel(this._rtpKeepaliveTimer); this._rtpKeepaliveTimer = null; }
  }

  _teardownRtp() {
    this._stopRtpKeepalive();
    try { this._rtp?.close(); } catch { /* ignore */ }
    this._rtp = null;
    try { this._rtpStun?.dispose(); } catch { /* ignore */ }
    this._rtpStun = null;
    if (this._rtpSock != null) { try { this.os.net.closeUDPSocket(this._rtpSock); } catch { /* ignore */ } }
    this._rtpSock = null;
    this._rtpPort = 0;
  }

  /** @param {{phraseId:number}} phrase */
  _sendPhrase(phrase) {
    if (this._callState !== "in-call" || !this._rtp) return;
    void simAudio.unlock();
    const def = PHRASES.find(p => p.id === phrase.phraseId);
    const frameCount = this._rtp.frameCountFor(def?.durationMs ?? 1000);
    const ok = this._rtp.playPhrase({ phraseId: phrase.phraseId, frameCount });
    if (ok) this._log("media", t("app.softphone.log.said", { text: def ? t(def.key) : `#${phrase.phraseId}` }));
  }

  /**
   * First packet of an inbound talkspurt — start the spoken phrase right away
   * (no waiting for every packet). The loss report arrives later in _onTalkspurt.
   * @param {number} phraseId
   */
  _onTalkstart(phraseId) {
    if (!simAudio.canSpeak) { this._spokeTalkspurt = false; return; }
    const def = PHRASES.find(p => p.id === phraseId);
    if (!def) { this._spokeTalkspurt = false; return; }
    this._spokeTalkspurt = simAudio.speak(t(def.key), { lang: this._lang() });
  }

  /** @param {{phraseId:number, totalFrames:number, receivedFrames:number[], lostFrames:number[], lossFraction:number}} ts */
  _onTalkspurt(ts) {
    const def = PHRASES.find(p => p.id === ts.phraseId);
    const label = def ? t(def.key) : `#${ts.phraseId}`;
    if (ts.lostFrames.length === 0) {
      this._log("media", t("app.softphone.log.heard", { text: label }));
    } else {
      this._log("media", t("app.softphone.log.heardLossy", { text: label, pct: Math.round(ts.lossFraction * 100) }));
      if (this._spokeTalkspurt && ts.lossFraction > 0.12) simAudio.noise({ durationS: 0.16, level: 0.09 });
    }
    // TTS already started on talkstart; only the no-speech fallback needs the
    // full frame list here (to mute the lost 20 ms slices).
    if (!this._spokeTalkspurt) void this._playTalkspurt(ts);
  }

  // ── audio (via the sim-wide SimAudio bus) ────────────────────────

  /**
   * Loop a call-progress tone until _stopRingtone().
   *   "ringback" — what the caller hears while the far end rings (440+480 Hz)
   *   "incoming" — the phone's own ring for an inbound call (double burst)
   * @param {"ringback"|"incoming"} mode
   */
  _startRingtone(mode) {
    this._stopRingtone();
    this._ringMode = mode;
    void simAudio.unlock().then((ok) => {
      if (this._ringMode !== mode) return;                // stopped meanwhile
      if (!ok && !this._audioBlockedWarned) {
        this._audioBlockedWarned = true;
        this._log("sys", t("app.softphone.log.audioBlocked"));
      }
      const cycleMs = mode === "incoming" ? 3000 : 4000;
      this._ringPulse();
      this._ringTimer = window.setInterval(() => this._ringPulse(), cycleMs);
    });
  }

  _ringPulse() {
    if (this._ringMode == null) return;
    if (!simAudio.ready) { void simAudio.unlock(); return; }
    const t0 = (simAudio.context?.currentTime ?? 0) + 0.02;
    if (this._ringMode === "incoming") {
      // classic phone "läuten": a warbling tone, two 0.4 s rings 0.2 s apart,
      // then ~2 s silence (setInterval cycle = 3 s).
      const ring = { freqs: [480], durationS: 0.4, level: 0.24, warbleHz: 22, warbleDepth: 55 };
      simAudio.tone({ ...ring, at: t0 });
      simAudio.tone({ ...ring, at: t0 + 0.6 });
    } else {
      // ringback the caller hears: steady 440+480 Hz, 1 s on / 3 s off (cycle = 4 s).
      simAudio.tone({ freqs: [440, 480], durationS: 1.0, level: 0.2, at: t0 });
    }
  }

  _stopRingtone() {
    if (this._ringTimer != null) { window.clearInterval(this._ringTimer); this._ringTimer = null; }
    this._ringMode = null;
  }

  /** Short German-style busy tone (Besetztton): 425 Hz, ~0.4 s on / 0.4 s off, 3 cycles. */
  _playBusyTone() {
    void simAudio.unlock().then(() => {
      const base = (simAudio.context?.currentTime ?? 0) + 0.03;
      const onS = 0.4, gap = 0.4;
      for (let i = 0; i < 3; i++) {
        simAudio.tone({ freqs: [425], durationS: onS, level: 0.2, at: base + i * (onS + gap) });
      }
    });
  }

  /** Setup-tab diagnostic: unlock audio, report the context state, play a beep. */
  async _testTone() {
    const ok = await simAudio.unlock();
    this._log("sys", t("app.softphone.log.audioState", { state: simAudio.state, sr: simAudio.sampleRate }));
    if (ok) simAudio.tone({ freqs: [660], durationS: 0.5, level: 0.25 });
    else this._log("err", t("app.softphone.log.audioBlocked"));
  }

  /**
   * The phrase's audio as an AudioBuffer. Tries a bundled asset first, then
   * falls back to a short synthesized motif so loss stays audible even with
   * no assets present.
   * @param {number} phraseId
   * @returns {Promise<AudioBuffer|null>}
   */
  _phraseBuffer(phraseId) {
    if (!simAudio.context) return Promise.resolve(null);
    let p = this._bufCache.get(phraseId);
    if (!p) {
      p = this._loadAsset(phraseId).catch(() => this._synthPhrase(phraseId));
      this._bufCache.set(phraseId, p);
    }
    return p;
  }

  /** @param {number} phraseId @returns {Promise<AudioBuffer|null>} */
  async _loadAsset(phraseId) {
    const lang = (t("app.softphone.lang") || "en").slice(0, 2);
    const url = new URL(`./assets/voice/${lang}/${phraseId}.ogg`, import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error("no asset");
    return await simAudio.decode(await res.arrayBuffer());
  }

  /** Deterministic 3-note motif keyed to the phrase id. @param {number} phraseId @returns {AudioBuffer} */
  _synthPhrase(phraseId) {
    const def = PHRASES.find(p => p.id === phraseId);
    const durS = (def?.durationMs ?? 1000) / 1000;
    const sr = simAudio.sampleRate;
    const buf = /** @type {AudioBuffer} */ (simAudio.createBuffer(1, Math.ceil(durS * sr), sr));
    const ch = buf.getChannelData(0);
    const pentatonic = [220, 247, 277, 330, 370, 440, 494, 554];
    const notes = [
      pentatonic[phraseId % pentatonic.length],
      pentatonic[(phraseId + 2) % pentatonic.length],
      pentatonic[(phraseId + 4) % pentatonic.length],
    ];
    const noteLen = ch.length / notes.length;
    for (let i = 0; i < ch.length; i++) {
      const ni = Math.min(notes.length - 1, Math.floor(i / noteLen));
      const local = (i - ni * noteLen) / noteLen;      // 0..1 within the note
      const env = Math.sin(Math.PI * local) ** 2;      // soft attack/decay
      ch[i] = 0.25 * env * Math.sin(2 * Math.PI * notes[ni] * (i / sr));
    }
    return buf;
  }

  /** i18n tag for TTS ("de", "en", "pt-PT", …), falling back to "en". */
  _lang() {
    const l = t("app.softphone.lang");
    return /^[a-z]{2}(-[A-Z]{2})?$/.test(l) ? l : "en";
  }

  /**
   * No-speech fallback: a synthesized motif with the lost 20 ms slices muted,
   * so packet loss stays audible. (The TTS path plays from _onTalkstart.)
   * @param {{phraseId:number, totalFrames:number, receivedFrames:number[]}} ts
   */
  async _playTalkspurt(ts) {
    await simAudio.unlock();
    const src = await this._phraseBuffer(ts.phraseId);
    if (!src || !simAudio.ready) return;
    const frameS = src.duration / ts.totalFrames;
    const out = simAudio.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
    if (!out) return;
    const present = new Set(ts.receivedFrames);
    for (let c = 0; c < src.numberOfChannels; c++) {
      const from = src.getChannelData(c);
      const to = out.getChannelData(c);
      for (const f of present) {
        const start = Math.floor(f * frameS * src.sampleRate);
        const end = Math.min(src.length, Math.floor((f + 1) * frameS * src.sampleRate));
        for (let i = start; i < end; i++) to[i] = from[i];
      }
    }
    simAudio.playBuffer(out);
  }

  // ── call-stats ticker ────────────────────────────────────────────

  _startStatsTicker() {
    this._stopStatsTicker();
    // wall-clock UI refresh only — the media itself runs on the sim clock
    this._statsIntervalId = this.disposer.interval(() => this._renderStats(), 500);
    this._renderStats();
  }

  _stopStatsTicker() {
    if (this._statsIntervalId != null) { window.clearInterval(this._statsIntervalId); this._statsIntervalId = null; }
  }

  _renderStats() {
    if (!this._dispSubEl || !this._rtp || this._callState !== "in-call") return;
    const s = this._rtp.getStats();
    this._dispSubEl.textContent = t("app.softphone.stats", {
      tx: s.txPackets,
      rx: s.rxPackets,
      loss: (s.lossFraction * 100).toFixed(1),
      jitter: s.jitterMs.toFixed(1),
    });
  }

  // ── helpers ─────────────────────────────────────────────────────

  /** @param {string} host @returns {Promise<string>} */
  async _resolve(host) {
    try { IPAddress.fromString(host); return host; } catch { /* not an IP */ }
    const ip = await this.os.dns.resolve(host);
    return typeof ip === "string" ? ip : String(ip);
  }

  /** Our source address toward a destination, for Via / Contact / SDP. @param {string} towardIp */
  _localIp(towardIp) {
    try {
      const ip = /** @type {any} */ (this.os.net)._pickSrcIp?.(IPAddress.fromString(towardIp));
      if (ip && ip.toString() !== "0.0.0.0") return ip.toString();
    } catch { /* fall through */ }
    for (let i = 0; i < 8; i++) {
      const itf = this.os.net.getInterface(i);
      if (itf?.ip?.isV4?.() && itf.ip.toString() !== "0.0.0.0") return itf.ip.toString();
    }
    return "0.0.0.0";
  }

  // ── UI ─────────────────────────────────────────────────────────

  _buildUI() {
    // ── Phone tab: display + keypad ──
    this._dispEl = UI.input({ value: "", placeholder: t("app.softphone.ph.target"), className: "sp-disp-main" });
    this._dispEl.addEventListener("keydown", (e) => { if (e.key === "Enter") void this._placeCall(); });
    this._dispSubEl = UI.el("div", { className: "sp-disp-sub" });
    const display = UI.el("div", { className: "sp-display", children: [this._dispEl, this._dispSubEl] });

    this._incomingEl = UI.el("div", { className: "sp-incoming" });

    this._keypadEl = UI.el("div", { className: "sp-keypad" });
    for (const ch of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]) {
      this._keypadEl.appendChild(UI.el("button", {
        className: "sp-key", text: ch, attrs: { type: "button" },
        init: (el) => el.addEventListener("click", () => this._key(ch)),
      }));
    }

    this._bkspBtn = UI.button("⌫", () => this._backspace(), { className: "btn sp-bksp", title: t("app.softphone.btn.backspace") });
    this._callBtn = UI.button(t("app.softphone.btn.call"), () => void this._placeCall(), { primary: true, icon: "fa-phone" });
    this._hangBtn = UI.button(t("app.softphone.btn.hangup"), () => this._hangup(), { icon: "fa-phone-slash" });
    const callRow = UI.el("div", { className: "sp-callrow", children: [this._bkspBtn, this._callBtn, this._hangBtn] });

    this._phrasesEl = UI.el("div", { className: "sp-phrases" });
    for (const ph of PHRASES) {
      this._phrasesEl.appendChild(
        UI.button(t(ph.key), () => this._sendPhrase({ phraseId: ph.id }), { icon: "fa-comment" }),
      );
    }

    const phonePane = UI.el("div", { className: "sp-pane sp-phone", children: [
      display, this._incomingEl, this._keypadEl, callRow, this._phrasesEl,
    ]});

    // ── Setup tab ──
    this._userEl = UI.input({ value: this.user, placeholder: t("app.softphone.ph.user") });
    this._domainEl = UI.input({ value: this.domain, placeholder: t("app.softphone.ph.domain") });
    this._registrarEl = UI.input({ value: this.registrarHost, placeholder: t("app.softphone.ph.registrar") });
    this._stunEl = UI.input({ value: this.stunServer, placeholder: t("app.softphone.ph.stun") });
    this._regDot = UI.el("span", { className: "sp-dot" });
    this._regBtn = UI.button(t("app.softphone.btn.register"), () => void this._toggleRegister(), { primary: true, icon: "fa-right-to-bracket" });
    const testBtn = UI.button(t("app.softphone.btn.testTone"), () => void this._testTone(), { icon: "fa-volume-high" });
    const setupPane = UI.el("div", { className: "sp-pane sp-setup", children: [
      UI.row(t("app.softphone.label.user"), this._userEl),
      UI.row(t("app.softphone.label.domain"), this._domainEl),
      UI.row(t("app.softphone.label.registrar"), this._registrarEl),
      UI.row(t("app.softphone.label.stun"), this._stunEl),
      UI.el("div", { className: "sp-reg-row", children: [this._regDot, this._regBtn] }),
      UI.el("div", { className: "sp-reg-row", children: [testBtn] }),
    ]});

    // ── Log tab ──
    this._logEl = UI.el("div", { className: "msg sp-log" });
    const logPane = UI.el("div", { className: "log-pane sp-pane", children: [this._logEl] });

    const { bar } = UI.tabbedPane([
      { id: "phone", label: t("app.softphone.tab.phone"), pane: phonePane },
      { id: "setup", label: t("app.softphone.tab.setup"), pane: setupPane },
      { id: "log",   label: t("app.softphone.tab.log"),   pane: logPane },
    ]);

    this.root.replaceChildren(UI.panel([bar, phonePane, setupPane, logPane]));
    this._renderLog();
  }

  /** @param {string} ch */
  _key(ch) {
    // TODO: send DTMF (RFC 4733) while in a call; for now the keypad only dials
    if (this._callState !== "idle" && this._callState !== "ended") return;
    if (!this._dispEl) return;
    if (this._callState === "ended") { this._dispEl.value = ""; this._callState = "idle"; }
    this._dispEl.value += ch;
    this._dispEl.focus();
    this._syncUI();
  }

  _backspace() {
    if (!this._dispEl) return;
    this._dispEl.value = this._dispEl.value.slice(0, -1);
    this._dispEl.focus();
  }

  _syncUI() {
    const st = this._callState;
    const inCall = st === "in-call";
    const busy = st === "calling" || st === "ringing" || inCall;
    const idle = st === "idle" || st === "ended";

    if (this._regDot) this._regDot.classList.toggle("is-on", this.registered);
    if (this._regBtn) {
      this._regBtn.querySelector("span")?.replaceChildren(
        document.createTextNode(this.registered ? t("app.softphone.btn.unregister") : t("app.softphone.btn.register")),
      );
    }
    for (const el of [this._userEl, this._domainEl, this._registrarEl, this._stunEl]) if (el) el.disabled = this.registered;

    if (this._callBtn) this._callBtn.disabled = !this.registered || busy;
    if (this._hangBtn) this._hangBtn.disabled = !busy && st !== "ringing-in";
    if (this._bkspBtn) this._bkspBtn.disabled = !idle;
    if (this._dispEl) this._dispEl.disabled = !idle;
    for (const b of this._keypadEl?.querySelectorAll("button") ?? []) {
      /** @type {HTMLButtonElement} */ (b).disabled = !idle;
    }
    for (const b of this._phrasesEl?.querySelectorAll("button") ?? []) {
      /** @type {HTMLButtonElement} */ (b).disabled = !inCall;
    }

    // display sub-line
    if (this._dispSubEl && st !== "in-call") {
      const map = {
        idle: this.registered ? t("app.softphone.state.idle") : t("app.softphone.state.notRegistered"),
        calling: t("app.softphone.state.calling"),
        ringing: t("app.softphone.state.ringing"),
        "ringing-in": t("app.softphone.state.ringingIn"),
        ended: this._lastEndReason
          ? t("app.softphone.state.endedReason", { reason: this._lastEndReason })
          : t("app.softphone.state.ended"),
      };
      this._dispSubEl.textContent = map[st] ?? "";
    }

    if (this._incomingEl) {
      this._incomingEl.replaceChildren();
      if (st === "ringing-in" && this._incoming) {
        const who = this._incoming.fromName || this._incoming.fromUri || "?";
        if (this._dispEl) this._dispEl.value = who;
        this._incomingEl.appendChild(UI.el("span", { text: t("app.softphone.incoming.prompt", { from: who }) }));
        this._incomingEl.appendChild(UI.buttonRow([
          UI.button(t("app.softphone.btn.accept"), () => void this._acceptIncoming(), { primary: true, icon: "fa-phone" }),
          UI.button(t("app.softphone.btn.reject"), () => this._rejectIncoming(), { icon: "fa-phone-slash" }),
        ]));
      }
    }
  }

  /** @type {Record<string,string>} */
  static _LOG_CLS = { sys: "sp-log-sys", err: "sp-log-err", tx: "sp-log-tx", rx: "sp-log-rx", media: "sp-log-media" };

  /**
   * @param {"sys"|"err"|"tx"|"rx"|"media"} cls
   * @param {string} text
   */
  _log(cls, text) {
    const line = { cls, text: `[${nowStamp()}] ${text}` };
    this._logLines.push(line);
    if (this._logLines.length > 400) this._logLines.splice(0, this._logLines.length - 400);
    if (!this._logEl) return;
    this._logEl.appendChild(UI.el("div", {
      className: `sp-log-line ${SoftphoneApp._LOG_CLS[cls] ?? ""}`,
      text: line.text,
    }));
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }

  /** Rebuild the log view from history (called after the UI is (re)built). */
  _renderLog() {
    if (!this._logEl) return;
    this._logEl.replaceChildren(...this._logLines.map(l => UI.el("div", {
      className: `sp-log-line ${SoftphoneApp._LOG_CLS[l.cls] ?? ""}`,
      text: l.text,
    })));
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }
}
