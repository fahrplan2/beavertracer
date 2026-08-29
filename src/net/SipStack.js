//@ts-check

import { SIPMessage } from "./pdu/SIPMessage.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";

/**
 * SIP endpoint stack (RFC 3261 subset) — the UAC/UAS half of a softphone.
 *
 * Scope (v1):
 *   - Methods: REGISTER, INVITE, ACK, BYE, CANCEL, OPTIONS.
 *   - Transactions with simulation-scaled retransmit timers (T1/T2, Timer B/F/H),
 *     so retransmissions are visible in a capture when packets are lost.
 *   - One dialog per call; SDP offer/answer is carried opaquely (the caller
 *     hands in / gets out the SDP text — media negotiation detail lives in the
 *     softphone app, not here).
 *   - No digest auth: a 401/407 is surfaced as a failure with reason
 *     "auth-required" (the bundled SIP server does not challenge).
 *
 * Transport-agnostic: construct with a `transport.send(bytes, dstIp, dstPort)`
 * and feed inbound datagrams to `receive(bytes, srcIp, srcPort)`. The softphone
 * app wires these to a UDP socket; tests wire them to a fake.
 *
 * Registrar / proxy behaviour is a separate module (SIP server app).
 */

// Transaction timers live on SimTimer alongside the other protocols' timeouts,
// so they scale with the simulation speed the same way.
const T1_MS = SimTimer.SIP_T1_MS;        // base round-trip estimate (sim ms)
const T2_MS = SimTimer.SIP_T2_MS;        // non-INVITE retransmit cap
const TIMER_BF_MS = SimTimer.SIP_TIMEOUT_MS;  // INVITE Timer B / non-INVITE Timer F
const TIMER_H_MS = SimTimer.SIP_TIMEOUT_MS;   // INVITE server: wait-for-ACK

const MAX_FORWARDS = 70;

/** @param {number} n @param {() => number} rng */
function token(n, rng) {
  let s = "";
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}

/**
 * @typedef {Object} SipIdentity
 * @property {string} uri          e.g. "sip:alice@example.com"
 * @property {string} [displayName]
 * @property {string} contactIp    our IP for Via / Contact
 * @property {number} contactPort  our SIP port (usually 5060)
 */

/**
 * @typedef {Object} SipCall
 * @property {string} callId
 * @property {"uac"|"uas"} role
 * @property {"calling"|"ringing"|"in-call"|"ended"} state
 * @property {string} localUri
 * @property {string} remoteUri
 * @property {string} localTag
 * @property {string|null} remoteTag
 * @property {number} localSeq
 * @property {number} remoteSeq
 * @property {string} remoteTarget      contact URI of the peer
 * @property {string} peerIp             where the initial INVITE goes / where its responses come from (proxy or peer)
 * @property {number} peerPort
 * @property {string} targetIp           where in-dialog requests (BYE, 2xx ACK) go — the peer's Contact host
 * @property {number} targetPort
 * @property {string|null} localSdp
 * @property {string|null} remoteSdp
 * @property {string} inviteBranch
 * @property {string|null} ackBranch            (UAS) branch key of a 2xx awaiting ACK
 * @property {SIPMessage|null} pendingInvite    the inbound INVITE awaiting answer/reject (UAS)
 * @property {Set<number>} timers
 */

export class SipStack {

  /**
   * @param {object} deps
   * @param {{ send: (bytes: Uint8Array, dstIp: string, dstPort: number) => void }} deps.transport
   * @param {SipIdentity} [deps.identity]
   * @param {{ schedule: (cb: () => void, ms: number) => number, cancel: (id: number) => void }} [deps.timer]
   * @param {() => number} [deps.rng]
   * @param {string} [deps.userAgent]
   */
  constructor(deps) {
    this._transport = deps.transport;
    this._timer = deps.timer ?? simTimer;
    this._rng = deps.rng ?? Math.random;
    this._userAgent = deps.userAgent ?? "BeaverPhone/0.1";

    /** @type {SipIdentity|null} */
    this._identity = deps.identity ?? null;

    /** @type {Map<string, SipCall>} callId -> call */
    this._calls = new Map();

    /**
     * Client transactions keyed by top-Via branch.
     * @type {Map<string, {
     *   method: string, callId: string|null, bytes: Uint8Array,
     *   dstIp: string, dstPort: number, intervalMs: number,
     *   isInvite: boolean, timerId: number|null, timeoutId: number|null,
     *   onFinal: ((msg: SIPMessage) => void)|null,
     *   onProvisional: ((msg: SIPMessage) => void)|null,
     *   onTimeout: (() => void)|null,
     *   gotResponse: boolean,
     * }>}
     */
    this._clientTx = new Map();

    /**
     * Server transactions keyed by top-Via branch — retransmit the last
     * response until ACK (INVITE) or until Timer H elapses.
     * @type {Map<string, {
     *   method: string, bytes: Uint8Array, dstIp: string, dstPort: number,
     *   intervalMs: number, waitAck: boolean,
     *   timerId: number|null, timeoutId: number|null,
     * }>}
     */
    this._serverTx = new Map();

    /** @type {{ registrarIp: string, registrarPort: number, expires: number, callId: string, cseq: number, timerId: number|null, active: boolean }|null} */
    this._registration = null;

    /** @type {Map<string, Array<(...a: any[]) => void>>} */
    this._listeners = new Map();
  }

  // ── identity & events ──────────────────────────────────────────────────

  /** @param {SipIdentity} identity */
  setIdentity(identity) { this._identity = identity; }

  get identity() { return this._identity; }

  /**
   * Subscribe. Events:
   *   "registrationState" (state: "registered"|"unregistered"|"failed", detail?)
   *   "incomingCall"      ({ callId, fromUri, fromName, toUri, sdp, answer, reject })
   *   "progress"          (callId, { code, reason })
   *   "answered"          (callId, { sdp })
   *   "ended"             (callId, { reason })
   *   "signaling"         ({ dir: "tx"|"rx", message: SIPMessage, peerIp, peerPort })
   * @param {string} event
   * @param {(...a: any[]) => void} cb
   * @returns {() => void} unsubscribe
   */
  on(event, cb) {
    const list = this._listeners.get(event) ?? [];
    list.push(cb);
    this._listeners.set(event, list);
    return () => {
      const l = this._listeners.get(event);
      if (l) this._listeners.set(event, l.filter(x => x !== cb));
    };
  }

  /** @param {string} event @param {...any} args */
  _emit(event, ...args) {
    for (const cb of this._listeners.get(event) ?? []) {
      try { cb(...args); } catch { /* listener errors must not break the stack */ }
    }
  }

  // ── registration ──────────────────────────────────────────────────────

  /**
   * REGISTER with the given registrar; re-REGISTER is scheduled automatically.
   * @param {object} opts
   * @param {string} opts.registrarIp
   * @param {number} [opts.registrarPort]
   * @param {number} [opts.expires] seconds, default 3600
   */
  register({ registrarIp, registrarPort = 5060, expires = 3600 }) {
    this._requireIdentity();
    const callId = this._registration?.callId ?? this._newCallId();
    const cseq = (this._registration?.cseq ?? 0) + 1;
    this._registration = {
      registrarIp, registrarPort, expires, callId, cseq,
      timerId: this._registration?.timerId ?? null, active: false,
    };
    this._sendRegister(expires);
  }

  /** REGISTER Expires: 0. */
  unregister() {
    if (!this._registration) return;
    if (this._registration.timerId != null) this._timer.cancel(this._registration.timerId);
    this._registration.cseq += 1;
    this._sendRegister(0);
    this._registration.active = false;
  }

  /** @param {number} expires */
  _sendRegister(expires) {
    const reg = this._registration;
    if (!reg) return;
    const branch = this._newBranch();
    const localTag = token(8, this._rng);

    const msg = SIPMessage.request("REGISTER", `sip:${reg.registrarIp}`, [
      ["Via", `${this._viaSentBy()};branch=${branch};rport`],
      ["Max-Forwards", String(MAX_FORWARDS)],
      ["From", `${this._nameAddr()};tag=${localTag}`],
      ["To", this._nameAddr()],
      ["Call-ID", reg.callId],
      ["CSeq", `${reg.cseq} REGISTER`],
      ["Contact", `${this._contact()};expires=${expires}`],
      ["Expires", String(expires)],
      ["User-Agent", this._userAgent],
    ]);

    this._sendNewClientTx(msg, branch, reg.registrarIp, reg.registrarPort, {
      isInvite: false,
      onFinal: (resp) => {
        if (resp.statusCode === 200) {
          if (expires === 0) {
            reg.active = false;
            this._emit("registrationState", "unregistered");
          } else {
            reg.active = true;
            this._emit("registrationState", "registered", { expires });
            const refreshMs = Math.max(SimTimer.SIP_MIN_REREGISTER_MS, (expires * 1000) / 2);
            reg.timerId = this._timer.schedule(() => {
              reg.cseq += 1;
              this._sendRegister(expires);
            }, refreshMs);
          }
        } else if (resp.statusCode === 401 || resp.statusCode === 407) {
          this._emit("registrationState", "failed", { code: resp.statusCode, reason: "auth-required" });
        } else {
          this._emit("registrationState", "failed", { code: resp.statusCode, reason: resp.reasonPhrase });
        }
      },
      onTimeout: () => this._emit("registrationState", "failed", { reason: "timeout" }),
    });
  }

  get registered() { return !!this._registration?.active; }

  // ── outgoing call ─────────────────────────────────────────────────────

  /**
   * Place a call. Returns the Call-ID.
   * @param {object} opts
   * @param {string} opts.targetUri   e.g. "sip:bob@example.com"
   * @param {string} opts.peerIp      where to send the INVITE (proxy or peer)
   * @param {number} [opts.peerPort]
   * @param {string} opts.sdp         our SDP offer (text)
   * @returns {string} callId
   */
  call({ targetUri, peerIp, peerPort = 5060, sdp }) {
    this._requireIdentity();
    const callId = this._newCallId();
    const branch = this._newBranch();
    const localTag = token(8, this._rng);

    /** @type {SipCall} */
    const c = {
      callId, role: "uac", state: "calling",
      localUri: /** @type {SipIdentity} */ (this._identity).uri, remoteUri: targetUri,
      localTag, remoteTag: null,
      localSeq: 1, remoteSeq: 0,
      remoteTarget: targetUri, peerIp, peerPort, targetIp: peerIp, targetPort: peerPort,
      localSdp: sdp, remoteSdp: null,
      inviteBranch: branch, ackBranch: null, pendingInvite: null,
      timers: new Set(),
    };
    this._calls.set(callId, c);

    const msg = SIPMessage.request("INVITE", targetUri, [
      ["Via", `${this._viaSentBy()};branch=${branch};rport`],
      ["Max-Forwards", String(MAX_FORWARDS)],
      ["From", `${this._nameAddr()};tag=${localTag}`],
      ["To", `<${targetUri}>`],
      ["Call-ID", callId],
      ["CSeq", `1 INVITE`],
      ["Contact", this._contact()],
      ["User-Agent", this._userAgent],
      ["Content-Type", "application/sdp"],
    ], sdp);

    this._sendNewClientTx(msg, branch, peerIp, peerPort, {
      isInvite: true,
      onProvisional: (resp) => {
        if (resp.statusCode === 100) return;
        c.state = "ringing";
        const toTag = SIPMessage.tagOf(resp.getHeader("To") ?? "");
        if (toTag) c.remoteTag = toTag;
        this._emit("progress", callId, { code: resp.statusCode, reason: resp.reasonPhrase });
      },
      onFinal: (resp) => this._onInviteFinal(c, resp),
      onTimeout: () => this._endCall(c, "timeout"),
    });
    return callId;
  }

  /**
   * @param {SipCall} c
   * @param {SIPMessage} resp
   */
  _onInviteFinal(c, resp) {
    if (c.state === "ended") return;
    const code = resp.statusCode;
    if (code >= 200 && code < 300) {
      const toTag = SIPMessage.tagOf(resp.getHeader("To") ?? "");
      if (toTag) c.remoteTag = toTag;
      const contact = SIPMessage.uriOf(resp.getHeader("Contact") ?? "");
      if (contact) {
        c.remoteTarget = contact;
        const hp = SipStack._hostPort(contact);
        if (hp) { c.targetIp = hp.ip; c.targetPort = hp.port; }
      }
      c.remoteSdp = resp.body.length ? resp.bodyText : null;
      c.state = "in-call";
      // ACK for a 2xx is its own transaction with a fresh branch, sent direct to the peer's Contact.
      this._sendAck(c, resp, this._newBranch());
      this._emit("answered", c.callId, { sdp: c.remoteSdp });
    } else if (code === 401 || code === 407) {
      this._sendAck(c, resp, c.inviteBranch); // ACK non-2xx uses the INVITE branch
      this._endCall(c, "auth-required");
    } else {
      this._sendAck(c, resp, c.inviteBranch);
      const reason = code === 486 ? "busy"
        : code === 487 ? "canceled"
        : code === 603 ? "declined"
        : code === 404 ? "not-found"
        : code === 408 ? "timeout"
        : `rejected-${code}`;
      this._endCall(c, reason);
    }
  }

  /**
   * Hang up / cancel a call by Call-ID.
   * @param {string} callId
   */
  hangup(callId) {
    const c = this._calls.get(callId);
    if (!c || c.state === "ended") return;

    if (c.role === "uac" && (c.state === "calling" || c.state === "ringing")) {
      this._sendCancel(c);
      // The 487 to the INVITE and its ACK finish teardown; mark intent now.
      this._endCall(c, "hangup");
      return;
    }
    if (c.role === "uas" && c.pendingInvite) {
      this._respondToInvite(c, c.pendingInvite, 486, "Busy Here");
      this._endCall(c, "hangup");
      return;
    }
    // Established dialog → BYE.
    this._sendBye(c);
    this._endCall(c, "hangup");
  }

  // ── incoming call answer/reject ──────────────────────────────────────

  /**
   * @param {SipCall} c
   * @param {SIPMessage} invite
   */
  _offerIncoming(c, invite) {
    const fromRaw = invite.getHeader("From") ?? "";
    this._emit("incomingCall", {
      callId: c.callId,
      fromUri: SIPMessage.uriOf(fromRaw),
      fromName: (fromRaw.match(/^"?([^"<]*?)"?\s*</) ?? [])[1]?.trim() || null,
      toUri: SIPMessage.uriOf(invite.getHeader("To") ?? ""),
      sdp: invite.body.length ? invite.bodyText : null,
      answer: (/** @type {string} */ sdp) => this._answerIncoming(c, sdp),
      reject: (/** @type {number} */ code = 486, /** @type {string} */ reason = "Busy Here") =>
        this._rejectIncoming(c, code, reason),
    });
  }

  /** @param {SipCall} c @param {string} sdp */
  _answerIncoming(c, sdp) {
    if (!c.pendingInvite || c.state === "ended") return;
    c.localSdp = sdp;
    c.state = "in-call";
    this._respondToInvite(c, c.pendingInvite, 200, "OK", sdp);
    this._emit("answered", c.callId, { sdp: c.remoteSdp });
  }

  /** @param {SipCall} c @param {number} code @param {string} reason */
  _rejectIncoming(c, code, reason) {
    if (!c.pendingInvite) return;
    this._respondToInvite(c, c.pendingInvite, code, reason);
    this._endCall(c, "declined");
  }

  // ── inbound datagram entry point ────────────────────────────────────

  /**
   * @param {Uint8Array} bytes
   * @param {string} srcIp
   * @param {number} srcPort
   */
  receive(bytes, srcIp, srcPort) {
    let msg;
    try { msg = SIPMessage.parse(bytes); }
    catch { return; }
    this._emit("signaling", { dir: "rx", message: msg, peerIp: srcIp, peerPort: srcPort });

    if (msg.kind === "response") this._onResponse(msg, srcIp, srcPort);
    else this._onRequest(msg, srcIp, srcPort);
  }

  /** @param {SIPMessage} resp @param {string} srcIp @param {number} srcPort */
  _onResponse(resp, srcIp, srcPort) {
    const branch = resp.topViaBranch;
    if (!branch) return;
    const tx = this._clientTx.get(branch);
    if (!tx) return;

    const code = resp.statusCode;
    if (code < 200) {
      tx.gotResponse = true;
      // stop INVITE retransmission on the first provisional (RFC 3261 §17.1.1.2)
      if (tx.isInvite && tx.timerId != null) { this._timer.cancel(tx.timerId); tx.timerId = null; }
      tx.onProvisional?.(resp);
      return;
    }

    // final response
    tx.gotResponse = true;
    if (tx.timerId != null) { this._timer.cancel(tx.timerId); tx.timerId = null; }
    if (tx.timeoutId != null) { this._timer.cancel(tx.timeoutId); tx.timeoutId = null; }
    // A non-INVITE transaction is done; an INVITE transaction is done for
    // retransmit purposes too (ACK is generated separately).
    this._clientTx.delete(branch);
    tx.onFinal?.(resp);
  }

  /** @param {SIPMessage} req @param {string} srcIp @param {number} srcPort */
  _onRequest(req, srcIp, srcPort) {
    const method = req.method;
    const callId = req.getHeader("Call-ID") ?? "";

    if (method === "ACK") {
      // ACK for a non-2xx final matches the INVITE server transaction by branch;
      // ACK for a 2xx is a fresh transaction, so clear that retransmit via the dialog.
      const branch = req.topViaBranch;
      const c = this._calls.get(callId);
      const keys = new Set([branch, c?.ackBranch].filter(Boolean));
      for (const k of keys) {
        const stx = this._serverTx.get(/** @type {string} */ (k));
        if (stx?.timerId != null) this._timer.cancel(stx.timerId);
        if (stx?.timeoutId != null) this._timer.cancel(stx.timeoutId);
        this._serverTx.delete(/** @type {string} */ (k));
      }
      if (c) { c.ackBranch = null; if (c.role === "uas" && c.state === "in-call") c.pendingInvite = null; }
      return;
    }

    if (method === "OPTIONS") {
      this._sendResponse(req, 200, "OK", srcIp, srcPort, [["Allow", "INVITE, ACK, CANCEL, BYE, OPTIONS"]]);
      return;
    }

    const existing = this._calls.get(callId);

    if (method === "INVITE") {
      if (existing && existing.state !== "ended") {
        // re-INVITE inside a confirmed dialog → accept, no media change
        this._respondToInvite(existing, req, 200, "OK", existing.localSdp ?? undefined);
        return;
      }
      this._recvInvite(req, srcIp, srcPort);
      return;
    }

    if (method === "CANCEL") {
      // 200 to the CANCEL, 487 to the INVITE it references
      this._sendResponse(req, 200, "OK", srcIp, srcPort);
      if (existing && existing.role === "uas" && existing.pendingInvite) {
        this._respondToInvite(existing, existing.pendingInvite, 487, "Request Terminated");
        this._endCall(existing, "canceled");
      }
      return;
    }

    if (method === "BYE") {
      this._sendResponse(req, existing ? 200 : 481, existing ? "OK" : "Call/Transaction Does Not Exist", srcIp, srcPort);
      if (existing) this._endCall(existing, "remote-bye");
      return;
    }

    this._sendResponse(req, 405, "Method Not Allowed", srcIp, srcPort, [["Allow", "INVITE, ACK, CANCEL, BYE, OPTIONS"]]);
  }

  /** @param {SIPMessage} invite @param {string} srcIp @param {number} srcPort */
  _recvInvite(invite, srcIp, srcPort) {
    const callId = invite.getHeader("Call-ID") ?? this._newCallId();
    const fromRaw = invite.getHeader("From") ?? "";
    const contact = SIPMessage.uriOf(invite.getHeader("Contact") ?? "") ?? SIPMessage.uriOf(fromRaw) ?? "";
    const cseq = invite.cseq?.seq ?? 1;
    const localTag = token(8, this._rng);

    /** @type {SipCall} */
    const c = {
      callId, role: "uas", state: "ringing",
      localUri: /** @type {SipIdentity} */ (this._identity)?.uri ?? "",
      remoteUri: SIPMessage.uriOf(fromRaw) ?? "",
      localTag, remoteTag: SIPMessage.tagOf(fromRaw),
      localSeq: 1, remoteSeq: cseq,
      remoteTarget: contact, peerIp: srcIp, peerPort: srcPort,
      // responses to this INVITE go back the way it came (srcIp = proxy or peer);
      // in-dialog BYE goes straight to the caller's Contact.
      targetIp: SipStack._hostPort(contact)?.ip ?? srcIp,
      targetPort: SipStack._hostPort(contact)?.port ?? srcPort,
      localSdp: null, remoteSdp: invite.body.length ? invite.bodyText : null,
      inviteBranch: invite.topViaBranch ?? this._newBranch(),
      ackBranch: null,
      pendingInvite: invite,
      timers: new Set(),
    };
    this._calls.set(callId, c);

    // 100 Trying, then 180 Ringing — provisionals are not retransmitted here.
    this._sendResponse(invite, 100, "Trying", srcIp, srcPort);
    this._respondToInvite(c, invite, 180, "Ringing");
    this._offerIncoming(c, invite);
  }

  // ── response / request builders ────────────────────────────────────

  /**
   * Build and send a response to an INVITE within a UAS dialog, arming
   * retransmission for 2xx / non-2xx finals until the ACK arrives.
   * @param {SipCall} c
   * @param {SIPMessage} invite
   * @param {number} code
   * @param {string} reason
   * @param {string} [sdp]
   */
  _respondToInvite(c, invite, code, reason, sdp) {
    const resp = this._buildResponse(invite, code, reason);
    // add our tag to To
    const toRaw = invite.getHeader("To") ?? this._nameAddr();
    resp.setHeader("To", SIPMessage.tagOf(toRaw) ? toRaw : `${toRaw};tag=${c.localTag}`);
    if (code >= 200 && code < 300) {
      resp.setHeader("Contact", this._contact());
      resp.setHeader("User-Agent", this._userAgent);
      if (sdp) { resp.setHeader("Content-Type", "application/sdp"); resp.setBody(sdp); }
    }

    const bytes = resp.pack();
    // A response follows the Via chain, not the dialog target (RFC 3261 §18.2.2):
    // send it where the INVITE's top Via says, so an intermediary proxy can
    // strip its own Via on the way back.
    const dst = this._viaDestination(invite);

    if (code >= 200) {
      // Arm retransmit-until-ACK (Timer G/H simplified) BEFORE sending: a
      // synchronous transport can bounce the ACK back before send() returns.
      const branch = invite.topViaBranch ?? c.inviteBranch;
      this._armServerRetransmit(branch, bytes, dst.ip, dst.port);
      // ACK for a 2xx carries a fresh branch, so remember this key on the dialog.
      if (code < 300) c.ackBranch = branch;
    }

    this._emit("signaling", { dir: "tx", message: resp, peerIp: dst.ip, peerPort: dst.port });
    this._transport.send(bytes, dst.ip, dst.port);
  }

  /**
   * @param {SIPMessage} req
   * @param {number} code
   * @param {string} reason
   * @param {string} dstIp
   * @param {number} dstPort
   * @param {Array<[string,string]>} [extraHeaders]
   */
  _sendResponse(req, code, reason, dstIp, dstPort, extraHeaders = []) {
    const resp = this._buildResponse(req, code, reason);
    for (const [n, v] of extraHeaders) resp.setHeader(n, v);
    const bytes = resp.pack();
    this._emit("signaling", { dir: "tx", message: resp, peerIp: dstIp, peerPort: dstPort });
    this._transport.send(bytes, dstIp, dstPort);
  }

  /**
   * Copy the mandatory response headers off a request (RFC 3261 §8.2.6.2).
   * @param {SIPMessage} req
   * @param {number} code
   * @param {string} reason
   * @returns {SIPMessage}
   */
  _buildResponse(req, code, reason) {
    const resp = SIPMessage.response(code, reason);
    for (const v of req.getHeaders("Via")) resp.addHeader("Via", v);
    for (const v of req.getHeaders("Record-Route")) resp.addHeader("Record-Route", v);
    resp.setHeader("From", req.getHeader("From") ?? "");
    resp.setHeader("To", req.getHeader("To") ?? "");
    resp.setHeader("Call-ID", req.getHeader("Call-ID") ?? "");
    resp.setHeader("CSeq", req.getHeader("CSeq") ?? "");
    return resp;
  }

  /**
   * ACK for a received INVITE response.
   * @param {SipCall} c
   * @param {SIPMessage} resp   the response being acknowledged
   * @param {string} branch
   */
  _sendAck(c, resp, branch) {
    const target = (resp.statusCode >= 200 && resp.statusCode < 300) ? c.remoteTarget : c.remoteUri;
    const ack = SIPMessage.request("ACK", target, [
      ["Via", `${this._viaSentBy()};branch=${branch}`],
      ["Max-Forwards", String(MAX_FORWARDS)],
      ["From", resp.getHeader("From") ?? `${this._nameAddr()};tag=${c.localTag}`],
      ["To", resp.getHeader("To") ?? `<${c.remoteUri}>`],
      ["Call-ID", c.callId],
      ["CSeq", `${c.localSeq} ACK`],
    ]);
    // 2xx ACK goes straight to the peer's Contact; a non-2xx ACK belongs to the
    // INVITE transaction and follows the same path the INVITE took.
    const is2xx = resp.statusCode >= 200 && resp.statusCode < 300;
    const ip = is2xx ? c.targetIp : c.peerIp;
    const port = is2xx ? c.targetPort : c.peerPort;
    this._emit("signaling", { dir: "tx", message: ack, peerIp: ip, peerPort: port });
    this._transport.send(ack.pack(), ip, port);
  }

  /** @param {SipCall} c */
  _sendCancel(c) {
    const cancel = SIPMessage.request("CANCEL", c.remoteUri, [
      ["Via", `${this._viaSentBy()};branch=${c.inviteBranch}`], // same branch as the INVITE
      ["Max-Forwards", String(MAX_FORWARDS)],
      ["From", `${this._nameAddr()};tag=${c.localTag}`],
      ["To", `<${c.remoteUri}>`],
      ["Call-ID", c.callId],
      ["CSeq", `1 CANCEL`],
    ]);
    this._emit("signaling", { dir: "tx", message: cancel, peerIp: c.peerIp, peerPort: c.peerPort });
    this._transport.send(cancel.pack(), c.peerIp, c.peerPort);
  }

  /** @param {SipCall} c */
  _sendBye(c) {
    const branch = this._newBranch();
    c.localSeq += 1;
    const toTag = c.remoteTag ?? "";
    const bye = SIPMessage.request("BYE", c.remoteTarget, [
      ["Via", `${this._viaSentBy()};branch=${branch};rport`],
      ["Max-Forwards", String(MAX_FORWARDS)],
      ["From", `${this._nameAddr()};tag=${c.localTag}`],
      ["To", `<${c.remoteUri}>${toTag ? `;tag=${toTag}` : ""}`],
      ["Call-ID", c.callId],
      ["CSeq", `${c.localSeq} BYE`],
    ]);
    // in-dialog: straight to the peer's Contact, not via any proxy
    this._sendNewClientTx(bye, branch, c.targetIp, c.targetPort, {
      isInvite: false,
      onFinal: () => { /* dialog already torn down locally */ },
      onTimeout: () => { /* best effort */ },
    });
  }

  // ── client transaction plumbing ──────────────────────────────────

  /**
   * Send a brand-new request and register its client transaction with
   * retransmission.
   * @param {SIPMessage} msg
   * @param {string} branch
   * @param {string} dstIp
   * @param {number} dstPort
   * @param {object} h
   * @param {boolean} h.isInvite
   * @param {(msg: SIPMessage) => void} [h.onProvisional]
   * @param {(msg: SIPMessage) => void} [h.onFinal]
   * @param {() => void} [h.onTimeout]
   */
  _sendNewClientTx(msg, branch, dstIp, dstPort, h) {
    if (!msg.getHeader("User-Agent")) msg.setHeader("User-Agent", this._userAgent);
    const bytes = msg.pack();

    const tx = {
      method: msg.method, callId: msg.getHeader("Call-ID"),
      bytes, dstIp, dstPort,
      intervalMs: T1_MS,
      isInvite: h.isInvite,
      timerId: /** @type {number|null} */ (null),
      timeoutId: /** @type {number|null} */ (null),
      onFinal: h.onFinal ?? null, onProvisional: h.onProvisional ?? null,
      onTimeout: h.onTimeout ?? null, gotResponse: false,
    };
    this._clientTx.set(branch, tx);
    // register before sending: a transport that delivers synchronously can
    // bounce a response back into _onResponse before send() returns.
    this._armClientRetransmit(branch);
    // absolute Timer B (INVITE) / Timer F (non-INVITE): give up after 64·T1.
    tx.timeoutId = this._timer.schedule(() => {
      if (!this._clientTx.has(branch)) return;
      this._clientTx.delete(branch);
      if (tx.timerId != null) this._timer.cancel(tx.timerId);
      tx.onTimeout?.();
    }, TIMER_BF_MS);

    this._emit("signaling", { dir: "tx", message: msg, peerIp: dstIp, peerPort: dstPort });
    this._transport.send(bytes, dstIp, dstPort);
  }

  /** @param {string} branch */
  _armClientRetransmit(branch) {
    const tx = this._clientTx.get(branch);
    if (!tx) return;
    tx.timerId = this._timer.schedule(() => {
      const t = this._clientTx.get(branch);
      if (!t) return;
      // INVITE: keep doubling; non-INVITE: double but cap at T2. Timer B/F
      // (scheduled in _sendNewClientTx) is what actually ends the transaction.
      t.intervalMs = t.isInvite ? t.intervalMs * 2 : Math.min(t.intervalMs * 2, T2_MS);
      this._transport.send(t.bytes, t.dstIp, t.dstPort);
      this._armClientRetransmit(branch);
    }, tx.intervalMs);
  }

  /**
   * Retransmit a 2xx / non-2xx final response to an INVITE until the ACK
   * arrives or Timer H (64·T1) elapses.
   * @param {string} branch
   * @param {Uint8Array} bytes
   * @param {string} dstIp
   * @param {number} dstPort
   */
  _armServerRetransmit(branch, bytes, dstIp, dstPort) {
    const prev = this._serverTx.get(branch);
    if (prev?.timerId != null) this._timer.cancel(prev.timerId);
    if (prev?.timeoutId != null) this._timer.cancel(prev.timeoutId);

    const stx = {
      method: "INVITE", bytes, dstIp, dstPort,
      intervalMs: T1_MS, waitAck: true,
      timerId: /** @type {number|null} */ (null),
      timeoutId: /** @type {number|null} */ (null),
    };
    this._serverTx.set(branch, stx);

    const tick = () => {
      const s = this._serverTx.get(branch);
      if (!s) return;
      s.intervalMs = Math.min(s.intervalMs * 2, T2_MS);
      this._transport.send(s.bytes, s.dstIp, s.dstPort);
      s.timerId = this._timer.schedule(tick, s.intervalMs);
    };
    stx.timerId = this._timer.schedule(tick, stx.intervalMs);
    stx.timeoutId = this._timer.schedule(() => {
      const s = this._serverTx.get(branch);
      if (!s) return;
      if (s.timerId != null) this._timer.cancel(s.timerId);
      this._serverTx.delete(branch);
    }, TIMER_H_MS);
  }

  // ── call teardown ─────────────────────────────────────────────────

  /**
   * @param {SipCall} c
   * @param {string} reason
   */
  _endCall(c, reason) {
    if (c.state === "ended") return;
    c.state = "ended";
    for (const id of c.timers) this._timer.cancel(id);
    c.timers.clear();
    // drop any transactions tied to this call
    for (const [branch, tx] of this._clientTx) {
      if (tx.callId === c.callId) {
        if (tx.timerId != null) this._timer.cancel(tx.timerId);
        if (tx.timeoutId != null) this._timer.cancel(tx.timeoutId);
        this._clientTx.delete(branch);
      }
    }
    if (c.ackBranch) {
      const stx = this._serverTx.get(c.ackBranch);
      if (stx?.timerId != null) this._timer.cancel(stx.timerId);
      if (stx?.timeoutId != null) this._timer.cancel(stx.timeoutId);
      this._serverTx.delete(c.ackBranch);
    }
    this._emit("ended", c.callId, { reason });
  }

  /** Tear down everything (app closing). */
  dispose() {
    for (const [, tx] of this._clientTx) {
      if (tx.timerId != null) this._timer.cancel(tx.timerId);
      if (tx.timeoutId != null) this._timer.cancel(tx.timeoutId);
    }
    for (const [, stx] of this._serverTx) {
      if (stx.timerId != null) this._timer.cancel(stx.timerId);
      if (stx.timeoutId != null) this._timer.cancel(stx.timeoutId);
    }
    if (this._registration?.timerId != null) this._timer.cancel(this._registration.timerId);
    this._clientTx.clear();
    this._serverTx.clear();
    for (const c of this._calls.values()) c.state = "ended";
  }

  // ── small helpers ────────────────────────────────────────────────

  _requireIdentity() {
    if (!this._identity) throw new Error("SipStack: setIdentity() before use");
  }
  _viaSentBy() {
    const id = /** @type {SipIdentity} */ (this._identity);
    return `SIP/2.0/UDP ${id.contactIp}:${id.contactPort}`;
  }
  _nameAddr() {
    const id = /** @type {SipIdentity} */ (this._identity);
    return id.displayName ? `"${id.displayName}" <${id.uri}>` : `<${id.uri}>`;
  }
  _contact() {
    const id = /** @type {SipIdentity} */ (this._identity);
    const user = id.uri.replace(/^sips?:/, "").split("@")[0];
    return `<sip:${user}@${id.contactIp}:${id.contactPort}>`;
  }
  _newBranch() { return "z9hG4bK" + token(12, this._rng); }
  _newCallId() {
    const id = this._identity;
    const host = id ? id.contactIp : "beaverphone";
    return `${token(16, this._rng)}@${host}`;
  }

  /**
   * host:port out of a SIP URI (name-addr or addr-spec), or null.
   * @param {string} uri
   * @returns {{ ip: string, port: number } | null}
   */
  static _hostPort(uri) {
    if (!uri) return null;
    const s = uri.replace(/^<|>$/g, "").split(";")[0].split("?")[0];
    const m = s.match(/@([^:;/>]+)(?::(\d+))?/) || s.match(/^sips?:([^:;/>]+)(?::(\d+))?/i);
    if (!m) return null;
    return { ip: m[1], port: m[2] ? Number(m[2]) : 5060 };
  }

  /**
   * Where a response to this request must be sent: the top Via's `received`
   * host (or its sent-by host) and its `rport` (or sent-by port). RFC 3261 §18.2.2.
   * @param {SIPMessage} req
   * @returns {{ ip: string, port: number }}
   */
  _viaDestination(req) {
    const via = req.getHeader("Via") ?? "";
    const sentBy = via.match(/SIP\/2\.0\/\w+\s+([^;\s]+)/i);
    let ip = "", port = 5060;
    if (sentBy) {
      const [h, p] = sentBy[1].split(":");
      ip = h;
      if (p) port = Number(p);
    }
    const received = (via.match(/;received=([^;\s]+)/i) ?? [])[1];
    if (received) ip = received;
    const rport = (via.match(/;rport=(\d+)/i) ?? [])[1];
    if (rport) port = Number(rport);
    return { ip: ip || "0.0.0.0", port };
  }

  /** @param {string} callId @returns {SipCall|undefined} */
  getCall(callId) { return this._calls.get(callId); }
  /** @returns {SipCall[]} */
  get calls() { return [...this._calls.values()]; }
}
