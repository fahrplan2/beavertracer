//@ts-check

import { StunMessage } from "./pdu/StunMessage.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";

/**
 * STUN "Binding" client (RFC 5389 subset — see StunMessage) for NAT
 * discovery: send a Binding Request from a socket that's about to be used
 * for something else (SIP signaling, RTP media), and learn the address a
 * server on the far side actually sees — which, behind a NatEngine-mapped
 * router, is the WAN-mapped IP:port a peer must be told about instead of
 * the host's own private interface address.
 *
 * Transport-agnostic like SipStack/RtpSession: give it `transport.send(bytes,
 * dstIp, dstPort)` on the socket to probe, and feed inbound datagrams from
 * that same socket to `receive()`. A caller juggling more than one protocol
 * on a socket (e.g. SoftphoneApp's SIP socket) should try `receive()` first
 * and only hand the datagram to its own protocol parser if it returns false.
 */
export class StunClient {

  /**
   * @param {object} deps
   * @param {{ send: (bytes: Uint8Array, dstIp: string, dstPort: number) => void }} deps.transport
   * @param {{ schedule: (cb: () => void, ms: number) => number, cancel: (id: number) => void }} [deps.timer]
   * @param {() => number} [deps.rng]
   */
  constructor(deps) {
    this._transport = deps.transport;
    this._timer = deps.timer ?? simTimer;
    this._rng = deps.rng ?? Math.random;

    /** @type {Map<string, { resolve: (a: {ip:string, port:number}) => void, reject: (e: Error) => void, timerId: number|null, timeoutId: number|null }>} */
    this._pending = new Map();
  }

  /**
   * Send a Binding Request and resolve with the observed {ip, port}.
   * Retransmits on a doubling backoff (like a SIP non-INVITE transaction)
   * and rejects if the server never answers within the overall timeout.
   * @param {object} opts
   * @param {string} opts.serverIp
   * @param {number} [opts.serverPort]
   * @returns {Promise<{ip: string, port: number}>}
   */
  bind({ serverIp, serverPort = StunClient.DEFAULT_PORT }) {
    return new Promise((resolve, reject) => {
      const req = StunMessage.bindingRequest({ rng: this._rng });
      const key = StunClient._key(req.transactionId);
      const bytes = req.pack();

      /** @type {{ resolve: any, reject: any, timerId: number|null, timeoutId: number|null }} */
      const entry = { resolve, reject, timerId: null, timeoutId: null };
      this._pending.set(key, entry);

      let intervalMs = SimTimer.STUN_RTO_MS;
      const retransmit = () => {
        this._transport.send(bytes, serverIp, serverPort);
        intervalMs *= 2;
        entry.timerId = this._timer.schedule(retransmit, intervalMs);
      };
      entry.timerId = this._timer.schedule(retransmit, intervalMs);
      entry.timeoutId = this._timer.schedule(() => {
        if (!this._pending.delete(key)) return;
        if (entry.timerId != null) this._timer.cancel(entry.timerId);
        reject(new Error("STUN request timed out"));
      }, SimTimer.STUN_TIMEOUT_MS);

      this._transport.send(bytes, serverIp, serverPort);
    });
  }

  /**
   * Feed an inbound datagram from the probed socket. Returns true if it was
   * a STUN message (handled here, whether or not it matched a pending
   * request) — false if it wasn't STUN at all, so the caller can fall back
   * to its own protocol parser for that socket.
   * @param {Uint8Array} bytes
   * @param {string} srcIp
   * @param {number} srcPort
   * @returns {boolean}
   */
  receive(bytes, srcIp, srcPort) {
    let msg;
    try { msg = StunMessage.fromBytes(bytes); }
    catch { return false; }

    const key = StunClient._key(msg.transactionId);
    const entry = this._pending.get(key);
    if (!entry) return true; // stale/foreign STUN reply — consumed, not ours to route further

    this._pending.delete(key);
    if (entry.timerId != null) this._timer.cancel(entry.timerId);
    if (entry.timeoutId != null) this._timer.cancel(entry.timeoutId);

    if (msg.isSuccess && msg.xorMappedAddress) entry.resolve(msg.xorMappedAddress);
    else entry.reject(new Error(msg.errorCode ? `STUN error ${msg.errorCode.code}: ${msg.errorCode.reason}` : "STUN binding failed"));
    return true;
  }

  /** Cancel every in-flight request (app teardown). */
  dispose() {
    for (const [key, entry] of this._pending) {
      if (entry.timerId != null) this._timer.cancel(entry.timerId);
      if (entry.timeoutId != null) this._timer.cancel(entry.timeoutId);
      entry.reject(new Error("StunClient disposed"));
      this._pending.delete(key);
    }
  }

  /** @param {Uint8Array} transactionId @returns {string} */
  static _key(transactionId) {
    return Array.from(transactionId).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /** Standard STUN port (RFC 5389 §7). */
  static DEFAULT_PORT = 3478;
}
