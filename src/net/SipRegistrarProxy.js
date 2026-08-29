//@ts-check

import { SIPMessage } from "./pdu/SIPMessage.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";

/**
 * SIP registrar + stateless forwarding proxy (RFC 3261 §10 and §16 subset) —
 * the server half of the softphone demo.
 *
 * Registrar: REGISTER creates / refreshes / removes an AOR → Contact binding,
 * answered with 200 OK. Bindings expire on the simulation clock.
 *
 * Proxy: any other request is retargeted to the registered Contact for its
 * Request-URI, gets a proxy Via pushed on top (and optionally a Record-Route),
 * has Max-Forwards decremented, and is forwarded. Responses have the proxy's
 * own Via popped and are sent to the next Via's sent-by. It is stateless: it
 * keeps no transaction state, so retransmissions just flow through — which is
 * exactly what makes retransmit behaviour visible in a capture.
 *
 * Transport-agnostic: give it `transport.send(bytes, dstIp, dstPort)` and feed
 * inbound datagrams to `receive(bytes, srcIp, srcPort)`.
 */

const DEFAULT_EXPIRES = 3600;
const MAX_EXPIRES = 7200;

/** @param {string} s @returns {number} */
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * @typedef {Object} SipBinding
 * @property {string} aor
 * @property {string} contact        full contact URI
 * @property {string} contactIp
 * @property {number} contactPort
 * @property {number} expiresAt       sim-time ms
 * @property {string} callId
 * @property {number} timerId
 */

export class SipRegistrarProxy {

  /**
   * @param {object} deps
   * @param {{ send: (bytes: Uint8Array, dstIp: string, dstPort: number) => void }} deps.transport
   * @param {{ ip: string, port: number }} deps.selfAddr   proxy's own address (Via / Record-Route)
   * @param {string} [deps.domain]                          served domain (defaults to selfAddr.ip)
   * @param {boolean} [deps.recordRoute]                    add Record-Route to forwarded requests
   * @param {{ schedule: (cb: () => void, ms: number) => number, cancel: (id: number) => void }} [deps.timer]
   * @param {() => number} [deps.now]                       sim-time ms (default: shared tick clock)
   */
  constructor(deps) {
    this._transport = deps.transport;
    this._self = deps.selfAddr;
    this._domain = deps.domain || deps.selfAddr.ip;
    this._recordRoute = !!deps.recordRoute;
    this._timer = deps.timer ?? simTimer;
    this._now = deps.now ?? (() => simTimer.currentTick * SimTimer.SIM_MS_PER_TICK);

    /** @type {Map<string, SipBinding>} AOR → binding */
    this._bindings = new Map();
    /** @type {Map<string, Array<(...a:any[]) => void>>} */
    this._listeners = new Map();
  }

  /** @param {string} event  "register" | "unregister" | "forward" | "respond" | "drop" | "signaling" @param {(...a:any[]) => void} cb */
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
      try { cb(...args); } catch { /* listener errors must not break routing */ }
    }
  }

  /** @returns {SipBinding[]} current bindings, freshest expiry first */
  get bindings() {
    return [...this._bindings.values()].sort((a, b) => a.expiresAt - b.expiresAt);
  }

  /** @param {string} aor @returns {SipBinding | undefined} */
  lookup(aor) {
    const b = this._bindings.get(this._normAor(aor));
    if (b && b.expiresAt <= this._now()) { this._removeBinding(b.aor); return undefined; }
    return b;
  }

  dispose() {
    for (const b of this._bindings.values()) this._timer.cancel(b.timerId);
    this._bindings.clear();
  }

  // ── inbound ────────────────────────────────────────────────────────

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

    if (msg.kind === "response") { this._forwardResponse(msg); return; }
    if (msg.method === "REGISTER") { this._handleRegister(msg, srcIp, srcPort); return; }
    if (msg.method === "OPTIONS" && this._isForUs(msg.requestUri)) {
      this._respond(msg, 200, "OK", srcIp, srcPort, [["Allow", "INVITE, ACK, CANCEL, BYE, OPTIONS"]]);
      return;
    }
    this._forwardRequest(msg, srcIp, srcPort);
  }

  // ── registrar ─────────────────────────────────────────────────────

  /** @param {SIPMessage} req @param {string} srcIp @param {number} srcPort */
  _handleRegister(req, srcIp, srcPort) {
    const aor = this._normAor(SIPMessage.uriOf(req.getHeader("To") ?? "") ?? "");
    const contactRaw = req.getHeader("Contact");
    const callId = req.getHeader("Call-ID") ?? "";

    let expires = DEFAULT_EXPIRES;
    const expHdr = req.getHeader("Expires");
    if (expHdr != null && /^\d+$/.test(expHdr.trim())) expires = Number(expHdr.trim());
    const cExp = contactRaw && contactRaw.match(/;expires=(\d+)/i);
    if (cExp) expires = Number(cExp[1]);
    expires = Math.min(expires, MAX_EXPIRES);

    if (!aor) { this._respond(req, 400, "Bad Request", srcIp, srcPort); return; }

    if (!contactRaw || expires === 0) {
      const had = this._bindings.has(aor);
      this._removeBinding(aor);
      if (had) this._emit("unregister", { aor, reason: "explicit" });
      this._respond(req, 200, "OK", srcIp, srcPort, [["Expires", "0"]]);
      return;
    }

    const contact = SIPMessage.uriOf(contactRaw) ?? "";
    const { ip: contactIp, port: contactPort } = this._parseUriHost(contact, srcIp, srcPort);

    this._removeBinding(aor);
    const timerId = this._timer.schedule(() => {
      const b = this._bindings.get(aor);
      if (b) { this._bindings.delete(aor); this._emit("unregister", { aor, reason: "expired" }); }
    }, expires * 1000);

    /** @type {SipBinding} */
    const binding = {
      aor, contact, contactIp, contactPort,
      expiresAt: this._now() + expires * 1000, callId, timerId,
    };
    this._bindings.set(aor, binding);
    this._emit("register", { aor, contact, contactIp, contactPort, expires });

    this._respond(req, 200, "OK", srcIp, srcPort, [
      ["Contact", `<${contact}>;expires=${expires}`],
      ["Expires", String(expires)],
    ]);
  }

  /** @param {string} aor */
  _removeBinding(aor) {
    const b = this._bindings.get(aor);
    if (b) { this._timer.cancel(b.timerId); this._bindings.delete(aor); }
  }

  // ── proxy: requests ───────────────────────────────────────────────

  /** @param {SIPMessage} req @param {string} srcIp @param {number} srcPort */
  _forwardRequest(req, srcIp, srcPort) {
    // Max-Forwards
    let mf = 70;
    const mfRaw = req.getHeader("Max-Forwards");
    if (mfRaw != null && /^\d+$/.test(mfRaw.trim())) mf = Number(mfRaw.trim());
    if (mf <= 0) {
      if (req.method !== "ACK") this._respond(req, 483, "Too Many Hops", srcIp, srcPort);
      else this._emit("drop", { reason: "max-forwards", method: req.method });
      return;
    }

    const aor = this._normAor(req.requestUri);
    const binding = this.lookup(aor);
    if (!binding) {
      if (req.method === "ACK") { this._emit("drop", { reason: "no-binding", method: "ACK", aor }); return; }
      this._respond(req, 404, "Not Found", srcIp, srcPort);
      return;
    }

    const fwd = SIPMessage.parse(req.pack()); // clone
    fwd.requestUri = binding.contact;
    fwd.setHeader("Max-Forwards", String(mf - 1));

    // deterministic proxy branch (RFC 3261 §16.11): same input → same branch
    const branch = "z9hG4bK" + hash32(
      (req.topViaBranch ?? "") + "|" + req.requestUri + "|" + (req.getHeader("CSeq") ?? "")
    ).toString(36);
    fwd.prependHeader("Via", `SIP/2.0/UDP ${this._self.ip}:${this._self.port};branch=${branch}`);

    if (this._recordRoute && (req.method === "INVITE")) {
      fwd.prependHeader("Record-Route", `<sip:${this._self.ip}:${this._self.port};lr>`);
    }

    this._emit("forward", {
      method: req.method, aor,
      from: SIPMessage.uriOf(req.getHeader("From") ?? ""),
      dstIp: binding.contactIp, dstPort: binding.contactPort,
    });
    this._send(fwd, binding.contactIp, binding.contactPort);
  }

  // ── proxy: responses ──────────────────────────────────────────────

  /** @param {SIPMessage} resp */
  _forwardResponse(resp) {
    const vias = resp.getHeaders("Via");
    if (vias.length < 2) { this._emit("drop", { reason: "response-not-via-us" }); return; }

    // top Via must be ours
    const top = this._parseVia(vias[0]);
    if (!(top.host === this._self.ip && top.port === this._self.port)) {
      this._emit("drop", { reason: "response-top-via-mismatch" });
      return;
    }

    // rebuild without the top Via
    const rebuilt = SIPMessage.parse(resp.pack());
    rebuilt.removeHeader("Via");
    for (let i = 1; i < vias.length; i++) rebuilt.addHeader("Via", vias[i]);

    const next = this._parseVia(vias[1]);
    const dstIp = next.received || next.host;
    const dstPort = (next.rport && next.rport > 0) ? next.rport : (next.port || 5060);

    this._emit("respond", { code: resp.statusCode, reason: resp.reasonPhrase, dstIp, dstPort });
    this._send(rebuilt, dstIp, dstPort);
  }

  // ── helpers ───────────────────────────────────────────────────────

  /**
   * @param {SIPMessage} req
   * @param {number} code @param {string} reason
   * @param {string} dstIp @param {number} dstPort
   * @param {Array<[string,string]>} [extra]
   */
  _respond(req, code, reason, dstIp, dstPort, extra = []) {
    const resp = SIPMessage.response(code, reason);
    for (const v of req.getHeaders("Via")) resp.addHeader("Via", v);
    resp.setHeader("From", req.getHeader("From") ?? "");
    const to = req.getHeader("To") ?? "";
    resp.setHeader("To", (code >= 200 && !SIPMessage.tagOf(to)) ? `${to};tag=${this._tag(req)}` : to);
    resp.setHeader("Call-ID", req.getHeader("Call-ID") ?? "");
    resp.setHeader("CSeq", req.getHeader("CSeq") ?? "");
    for (const [n, v] of extra) resp.setHeader(n, v);
    this._emit("respond", { code, reason, dstIp, dstPort, local: true, method: req.method });
    this._send(resp, dstIp, dstPort);
  }

  /** @param {SIPMessage} msg @param {string} dstIp @param {number} dstPort */
  _send(msg, dstIp, dstPort) {
    this._emit("signaling", { dir: "tx", message: msg, peerIp: dstIp, peerPort: dstPort });
    this._transport.send(msg.pack(), dstIp, dstPort);
  }

  /** @param {SIPMessage} req */
  _tag(req) {
    return "srv" + hash32((req.getHeader("Call-ID") ?? "") + (req.getHeader("CSeq") ?? "")).toString(36);
  }

  /** @param {string} uri @returns {string} normalized "sip:user@domain" (no params, no port) */
  _normAor(uri) {
    let s = (uri || "").trim().replace(/^<|>$/g, "");
    s = s.split(";")[0].split("?")[0];
    const m = s.match(/^(sips?):([^@]+)@([^:;]+)/i);
    if (m) return `${m[1].toLowerCase()}:${m[2]}@${m[3].toLowerCase()}`;
    return s.toLowerCase();
  }

  /** @param {string} requestUri */
  _isForUs(requestUri) {
    const { ip } = this._parseUriHost(requestUri, "", 0);
    return ip === this._self.ip || ip === this._domain;
  }

  /**
   * @param {string} uri
   * @param {string} fallbackIp
   * @param {number} fallbackPort
   * @returns {{ ip: string, port: number }}
   */
  _parseUriHost(uri, fallbackIp, fallbackPort) {
    const s = (uri || "").replace(/^<|>$/g, "").split(";")[0];
    const m = s.match(/@([^:;/]+)(?::(\d+))?/) || s.match(/^sips?:([^:;/]+)(?::(\d+))?/i);
    if (m) return { ip: m[1], port: m[2] ? Number(m[2]) : (fallbackPort || 5060) };
    return { ip: fallbackIp, port: fallbackPort || 5060 };
  }

  /**
   * @param {string} via
   * @returns {{ host: string, port: number, branch: string|null, received: string|null, rport: number }}
   */
  _parseVia(via) {
    const sentBy = via.match(/SIP\/2\.0\/\w+\s+([^;\s]+)/i);
    let host = "", port = 5060;
    if (sentBy) {
      const hp = sentBy[1].split(":");
      host = hp[0];
      if (hp[1]) port = Number(hp[1]);
    }
    const branch = (via.match(/;branch=([^;\s]+)/i) ?? [])[1] ?? null;
    const received = (via.match(/;received=([^;\s]+)/i) ?? [])[1] ?? null;
    const rportM = via.match(/;rport(?:=(\d+))?/i);
    const rport = rportM ? (rportM[1] ? Number(rportM[1]) : 0) : -1;
    return { host, port, branch, received, rport: rport < 0 ? 0 : rport };
  }
}
