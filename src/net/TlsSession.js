//@ts-check

import { TlsRecord, TLS_CT, TLS_HT } from "./pdu/TlsRecord.js";
import { TlsCertificate, TlsTrustStore } from "./models/TlsCertificate.js";
import { encodeUTF8 } from "../lib/helpers.js";

// ── error types ────────────────────────────────────────────────────────────

/** TLS AlertDescription values used by this implementation (RFC 5246 §7.2). */
export const TLS_ALERT = Object.freeze({
  CLOSE_NOTIFY: 0,
  HANDSHAKE_FAILURE: 40,
  BAD_CERTIFICATE: 42,
  DECRYPT_ERROR: 51,
});

export class TlsHandshakeError extends Error {
  /**
   * @param {string} msg
   * @param {number} [alert] fatal AlertDescription sent to the peer
   */
  constructor(msg, alert = TLS_ALERT.HANDSHAKE_FAILURE) {
    super(msg);
    this.name = "TlsHandshakeError";
    this.alert = alert;
  }
}

export class TlsCertUntrustedError extends TlsHandshakeError {
  /** @param {string} subject */
  constructor(subject) {
    super(`Certificate not trusted: ${subject}`, TLS_ALERT.BAD_CERTIFICATE);
    this.name = "TlsCertUntrustedError";
    this.subject = subject;
  }
}

export class TlsCertExpiredError extends TlsHandshakeError {
  /**
   * @param {string} subject
   * @param {"expired"|"notYetValid"} [reason]
   */
  constructor(subject, reason = "expired") {
    super(reason === "notYetValid"
      ? `Certificate not yet valid: ${subject}`
      : `Certificate expired: ${subject}`, TLS_ALERT.BAD_CERTIFICATE);
    this.name = "TlsCertExpiredError";
    this.subject = subject;
    this.reason = reason;
  }
}

export class TlsSignatureError extends TlsHandshakeError {
  constructor() {
    super("ServerKeyExchange signature invalid — possible MITM attack", TLS_ALERT.DECRYPT_ERROR);
    this.name = "TlsSignatureError";
  }
}

/**
 * ECDHE_ECDSA requires an authenticated server: a Certificate message and a
 * signed ServerKeyExchange (RFC 8422 §2.1, §5.4). Missing either one is a
 * fatal handshake_failure — an unsigned ECDH key could come from anyone.
 */
export class TlsMissingAuthError extends TlsHandshakeError {
  /** @param {"certificate"|"signature"} what */
  constructor(what) {
    super(what === "certificate"
      ? "Server sent no certificate — ECDHE_ECDSA requires one"
      : "ServerKeyExchange is not signed — possible MITM attack");
    this.name = "TlsMissingAuthError";
    this.missing = what;
  }
}

export class TlsCertSignatureError extends TlsCertUntrustedError {
  /** @param {string} subject */
  constructor(subject) {
    super(subject);
    this.message = `Certificate signature invalid: ${subject}`;
    this.name = "TlsCertSignatureError";
  }
}

export class TlsCertNameMismatchError extends TlsCertUntrustedError {
  /**
   * @param {string} subject
   * @param {string} serverName
   */
  constructor(subject, serverName) {
    super(subject);
    this.message = `Certificate name mismatch: ${subject} does not match ${serverName}`;
    this.name = "TlsCertNameMismatchError";
    this.serverName = serverName;
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Does the certificate cover the name the client asked for?
 * RFC 6125 §6.4.4: if the certificate carries subjectAltName entries, only
 * those are checked; the subject CN is just the fallback for certificates
 * without any (e.g. legacy v1 certificates).
 * Case-insensitive; a "*." wildcard covers exactly one leftmost label.
 * @param {string} subject  e.g. "CN=www.example.org"
 * @param {string} serverName
 * @param {string[]} [altNames] subjectAltName dNSName/iPAddress entries
 */
export function certMatchesName(subject, serverName, altNames = []) {
  const name = serverName.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!name) return false;
  const candidates = altNames.length > 0 ? altNames : [subject.replace(/^CN=/i, "")];
  return candidates.some(c => nameMatches(c.trim().toLowerCase(), name));
}

/** @param {string} pattern @param {string} name */
function nameMatches(pattern, name) {
  if (!pattern) return false;
  if (pattern === name) return true;
  if (pattern.startsWith("*.")) {
    const dot = name.indexOf(".");
    return dot > 0 && name.slice(dot + 1) === pattern.slice(2);
  }
  return false;
}

/** @param {Uint8Array[]} parts */
function concat(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/**
 * TLS 1.2 PRF — P_SHA256 expansion (RFC 5246 §5).
 * @param {Uint8Array} secret
 * @param {Uint8Array} seed  — already label-prepended
 * @param {number} length
 * @returns {Promise<Uint8Array>}
 */
async function p_sha256(secret, seed, length) {
  const key = await crypto.subtle.importKey(
    "raw", /** @type {Uint8Array<ArrayBuffer>} */ (secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const out = new Uint8Array(length);
  // A(1) = HMAC(secret, seed); A(i) = HMAC(secret, A(i-1))
  let a = new Uint8Array(await crypto.subtle.sign("HMAC", key, /** @type {Uint8Array<ArrayBuffer>} */ (seed)));
  let offset = 0;
  while (offset < length) {
    const block = new Uint8Array(await crypto.subtle.sign("HMAC", key, /** @type {Uint8Array<ArrayBuffer>} */ (concat(a, seed))));
    const take = Math.min(block.length, length - offset);
    out.set(block.slice(0, take), offset);
    offset += take;
    a = new Uint8Array(await crypto.subtle.sign("HMAC", key, /** @type {Uint8Array<ArrayBuffer>} */ (a)));
  }
  return out;
}

/**
 * PRF(secret, label, seed, length) — RFC 5246 §5.
 * @param {Uint8Array} secret
 * @param {string} label
 * @param {Uint8Array} seed
 * @param {number} length
 */
async function prf(secret, label, seed, length) {
  return p_sha256(secret, concat(encodeUTF8(label), seed), length);
}

/**
 * Sequence number as 8-byte big-endian Uint8Array.
 * @param {number} seq
 */
function seqToBytes8(seq) {
  const buf = new Uint8Array(8);
  let s = seq >>> 0;
  for (let i = 7; i >= 4; i--) { buf[i] = s & 0xff; s = (s / 256) | 0; }
  return buf;
}

/**
 * Build the 13-byte AAD for TLS 1.2 AES-GCM (RFC 5288 §3).
 * seq_num(8) || content_type(1) || version(2) || plaintext_length(2)
 * @param {number} seq
 * @param {number} contentType
 * @param {number} plaintextLen
 */
function buildAAD(seq, contentType, plaintextLen) {
  const aad = new Uint8Array(13);
  aad.set(seqToBytes8(seq), 0);
  aad[8]  = contentType;
  aad[9]  = 0x03;
  aad[10] = 0x03;
  aad[11] = (plaintextLen >> 8) & 0xff;
  aad[12] =  plaintextLen       & 0xff;
  return aad;
}

/**
 * Parse a peer ECDH public key (65-byte uncompressed point) from raw bytes.
 * @param {Uint8Array<ArrayBuffer>} raw
 */
async function importEcdhPubKey(raw) {
  return crypto.subtle.importKey(
    "raw", raw,
    { name: "ECDH", namedCurve: "P-256" },
    false, [],
  );
}

// ── DER utilities (for cert parsing) ──────────────────────────────────────

/**
 * Parse the tag+length of one DER element starting at offset.
 * @param {Uint8Array} data
 * @param {number} offset
 * @returns {{ start: number, contentStart: number, end: number }}
 */
function derNextElement(data, offset) {
  let off = offset + 1; // skip tag byte
  let len;
  if (data[off] < 0x80)       { len = data[off];                               off += 1; }
  else if (data[off] === 0x81) { len = data[off + 1];                           off += 2; }
  else                         { len = (data[off + 1] << 8) | data[off + 2];   off += 3; }
  return { start: offset, contentStart: off, end: off + len };
}

/**
 * Extract the DER bytes of the TBSCertificate (first SEQUENCE inside Certificate).
 * @param {Uint8Array} certDer
 * @returns {Uint8Array}
 */
function extractTbsDer(certDer) {
  const outer = derNextElement(certDer, 0);         // Certificate SEQUENCE
  const tbs   = derNextElement(certDer, outer.contentStart); // TBSCertificate SEQUENCE
  return certDer.slice(tbs.start, tbs.end);
}

/**
 * Extract the raw signature bytes from the Certificate's signatureValue BIT STRING.
 * The BIT STRING content is [0x00 (unused bits), sig...]; we return just the sig bytes.
 * Returns null if not parseable or if the signature is the zero placeholder.
 * @param {Uint8Array} certDer
 * @returns {Uint8Array|null}
 */
function extractCertSig(certDer) {
  const outer  = derNextElement(certDer, 0);
  const tbs    = derNextElement(certDer, outer.contentStart);
  const sigAlg = derNextElement(certDer, tbs.end);
  const sigBit = derNextElement(certDer, sigAlg.end);
  // BIT STRING content: 0x00 (unused bits) + signature bytes
  const sigBytes = certDer.slice(sigBit.contentStart + 1, sigBit.end);
  // P1363 P-256 signatures are exactly 64 bytes; zero placeholder is 71 bytes
  if (sigBytes.length !== 64) return null;
  return sigBytes;
}

/**
 * Walk a Certificate's TBSCertificate in the layout TlsCertificate
 * produces (see TlsCertificate._buildTbsBytes()) — both the current v3
 * layout ([0] version … [3] extensions) and the legacy v1 one.
 * Validity times are decimal epoch-ms strings (simulator convention).
 * Returns null if the structure doesn't match.
 * @param {Uint8Array} certDer
 * @returns {{ version: number, issuerCN: string, subjectCN: string,
 *   notBefore: number, notAfter: number, publicKeyRaw: Uint8Array|null,
 *   isCA: boolean, altNames: string[]|null }|null}
 */
function parseTbs(certDer) {
  try {
    const dec = new TextDecoder();
    const outer = derNextElement(certDer, 0);
    const tbs   = derNextElement(certDer, outer.contentStart);
    let off = tbs.contentStart;
    let version = 1;
    if (certDer[off] === 0xA0) {                       // [0] EXPLICIT Version
      const v = derNextElement(certDer, off);
      const int = derNextElement(certDer, v.contentStart);
      version = certDer[int.end - 1] + 1;
      off = v.end;
    }
    const serial   = derNextElement(certDer, off);
    const algId    = derNextElement(certDer, serial.end);
    const issuer   = derNextElement(certDer, algId.end);
    const validity = derNextElement(certDer, issuer.end);
    const subject  = derNextElement(certDer, validity.end);
    const spki     = derNextElement(certDer, subject.end);
    if (spki.end > tbs.end) return null;

    /** Name with a single CN: SEQUENCE { SET { SEQUENCE { OID, UTF8String } } } */
    const cnOf = (/** @type {{ contentStart: number }} */ name) => {
      const set = derNextElement(certDer, name.contentStart);
      const atv = derNextElement(certDer, set.contentStart);
      const oid = derNextElement(certDer, atv.contentStart);
      const val = derNextElement(certDer, oid.end);
      return dec.decode(certDer.slice(val.contentStart, val.end));
    };
    const nb = derNextElement(certDer, validity.contentStart);
    const na = derNextElement(certDer, nb.end);
    const notBefore = Number(dec.decode(certDer.slice(nb.contentStart, nb.end)));
    const notAfter  = Number(dec.decode(certDer.slice(na.contentStart, na.end)));
    if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter)) return null;

    // SubjectPublicKeyInfo: SEQUENCE { AlgorithmIdentifier, BIT STRING }
    const spkiAlg = derNextElement(certDer, spki.contentStart);
    const keyBits = derNextElement(certDer, spkiAlg.end);
    const keyBytes = certDer.slice(keyBits.contentStart + 1, keyBits.end);
    const publicKeyRaw = keyBytes.length === 65 && keyBytes[0] === 0x04 ? keyBytes : null;

    let isCA = false;
    /** @type {string[]|null} */
    let altNames = null;
    if (version === 3 && spki.end < tbs.end && certDer[spki.end] === 0xA3) {
      const extsWrap = derNextElement(certDer, spki.end);
      const exts = derNextElement(certDer, extsWrap.contentStart);
      for (let e = exts.contentStart; e < exts.end;) {
        const ext = derNextElement(certDer, e);
        const oid = derNextElement(certDer, ext.contentStart);
        let valEl = derNextElement(certDer, oid.end);
        if (certDer[valEl.start] === 0x01) valEl = derNextElement(certDer, valEl.end); // critical flag
        const oidHex = Array.from(certDer.slice(oid.contentStart, oid.end)).join(",");
        const inner = derNextElement(certDer, valEl.contentStart);     // OCTET STRING content
        if (oidHex === "85,29,19") {                                    // basicConstraints
          if (inner.contentStart < inner.end && certDer[inner.contentStart] === 0x01) {
            const b = derNextElement(certDer, inner.contentStart);
            isCA = certDer[b.contentStart] !== 0x00;
          }
        } else if (oidHex === "85,29,17") {                             // subjectAltName
          altNames = [];
          for (let g = inner.contentStart; g < inner.end;) {
            const gn = derNextElement(certDer, g);
            const bytes = certDer.slice(gn.contentStart, gn.end);
            if (certDer[g] === 0x82) altNames.push(dec.decode(bytes));            // dNSName
            else if (certDer[g] === 0x87 && bytes.length === 4) altNames.push(Array.from(bytes).join(".")); // iPAddress
            g = gn.end;
          }
        }
        e = ext.end;
      }
    }
    return { version, issuerCN: cnOf(issuer), subjectCN: cnOf(subject),
      notBefore, notAfter, publicKeyRaw, isCA, altNames };
  } catch {
    return null;
  }
}

// ── TlsSession ─────────────────────────────────────────────────────────────

/**
 * TLS 1.2 session wrapper — works over any bidirectional byte stream.
 *
 * Usage:
 *   const tls = new TlsSession({ send, recv, isServer: false, trustStore });
 *   await tls.handshake();
 *   await tls.send(data);
 *   const plain = await tls.recv();
 *
 * The send/recv callbacks should match the TCP API:
 *   send: (Uint8Array) => void
 *   recv: () => Promise<Uint8Array|null>
 */
export class TlsSession {
  /**
   * @param {{
   *   send: (data: Uint8Array) => void,
   *   recv: () => Promise<Uint8Array|null>,
   *   isServer: boolean,
   *   cert?: TlsCertificate,
   *   trustStore?: TlsTrustStore,
   *   timeoutMs?: number,
   *   sleepFn?: (ms: number) => Promise<void>,
   *   now?: () => number,
   *   serverName?: string,
   * }} opts
   */
  constructor({ send, recv, isServer, cert, trustStore, timeoutMs = 400, sleepFn, now, serverName }) {
    this._sendRaw = send;
    this._recvRaw = recv;
    this._isServer = isServer;
    this._cert = cert ?? null;
    this._trustStore = trustStore ?? null;
    this._timeoutMs = timeoutMs;
    this._sleep = sleepFn ?? ((ms) => new Promise(r => setTimeout(r, ms)));
    // This host's virtual clock (os.clock.nowMs, see SystemClock.js), used to
    // judge peer-certificate validity — falls back to the real browser clock
    // for callers that don't pass one (e.g. plain unit tests).
    this._now = now ?? (() => Date.now());
    // Name the client wants to reach (URL host). When set together with a
    // trust store, the peer certificate's CN must match it.
    this._serverName = serverName ?? "";

    /** @type {"INIT"|"HANDSHAKE"|"ESTABLISHED"|"CLOSED"} */
    this._state = "INIT";

    /** Peer certificate, available after handshake (client side). @type {TlsCertificate|null} */
    this.peerCert = null;

    // TCP-level receive buffer for record framing
    this._recvBuf = new Uint8Array(0);

    // Handshake material (set during handshake)
    /** @type {Uint8Array|null} */ this._clientRandom = null;
    /** @type {Uint8Array|null} */ this._serverRandom = null;
    /** @type {CryptoKeyPair|null} */ this._ecdhKeyPair = null;
    /** @type {CryptoKey|null} */ this._peerEcdhPubKey = null;

    // Session keys (set after key derivation)
    /** @type {CryptoKey|null} */ this._encryptKey = null;
    /** @type {CryptoKey|null} */ this._decryptKey = null;
    /** @type {Uint8Array|null} */ this._encryptFixedIV = null;  // 4 bytes (RFC 5288)
    /** @type {Uint8Array|null} */ this._decryptFixedIV = null;  // 4 bytes
    /** @type {Uint8Array|null} */ this._masterSecret = null;    // 48 bytes
    // Record sequence numbers (RFC 5246 §6.1): reset to 0 by ChangeCipherSpec,
    // so the Finished message is record #0 of each direction and the first
    // ApplicationData record is #1.
    this._sendSeq = 0;
    this._recvSeq = 0;
    // Connection-state switch (RFC 5246 §7.1): the write side becomes
    // encrypted once we *sent* ChangeCipherSpec, the read side once we
    // *received* one.
    this._writeCipherActive = false;
    this._readCipherActive = false;
    // Encrypted writes are serialised so record order == sequence order.
    /** @type {Promise<void>} */ this._writeChain = Promise.resolve();
    this._pendingWrites = 0;
    // close() is synchronous (callers close TCP right after it), but AES-GCM
    // via WebCrypto is async — so an encrypted close_notify for the next
    // sequence number is kept ready in advance.
    /** @type {{ seq: number, bytes: Uint8Array }|null} */ this._closeNotify = null;

    // Handshake transcript (accumulated HS message bytes, without record framing)
    /** @type {Uint8Array} */ this._transcript = new Uint8Array(0);
  }

  // ── public API ────────────────────────────────────────────────────────────

  /** Run the TLS 1.2 handshake. Throws TlsHandshakeError on failure. */
  async handshake() {
    this._state = "HANDSHAKE";
    try {
      if (this._isServer) {
        await this._serverHandshake();
      } else {
        await this._clientHandshake();
      }
      await this._prepareCloseNotify();
      this._state = "ESTABLISHED";
    } catch (e) {
      this._state = "CLOSED";
      if (e instanceof TlsHandshakeError) {
        // Once our ChangeCipherSpec is out, alerts go under the new keys too.
        // RFC 5246 §7.2: fatal alert; plaintext before our ChangeCipherSpec.
        try { await this._sendRecord(TLS_CT.ALERT, new Uint8Array([2, e.alert ?? TLS_ALERT.HANDSHAKE_FAILURE])); } catch { /* ignore */ }
      }
      throw e;
    }
  }

  /**
   * Encrypt and send plaintext as a TLS 1.2 ApplicationData record (RFC 5288).
   * Record payload = explicit_nonce(8) || AES-GCM-ciphertext+tag
   * @param {Uint8Array<ArrayBuffer>} plaintext
   */
  async send(plaintext) {
    if (this._state !== "ESTABLISHED") throw new Error("TLS session not established");
    await this._sendRecord(TLS_CT.APP_DATA, plaintext, true);
  }

  /**
   * Receive and decrypt the next TLS ApplicationData record.
   * Returns null when the peer closes the connection.
   * @returns {Promise<Uint8Array|null>}
   */
  async recv() {
    if (this._state === "CLOSED") return null;
    while (true) {
      const record = await this._readRecord(); // already decrypted
      if (record === null) { this._state = "CLOSED"; return null; }

      if (record.contentType === TLS_CT.APP_DATA) return record.payload;

      if (record.contentType === TLS_CT.ALERT) {
        this._state = "CLOSED";
        return null;
      }
    }
  }

  /** Send a close_notify alert and mark session as closed. */
  close() {
    if (this._state === "CLOSED") return;
    this._state = "CLOSED";
    const alert = new Uint8Array([1, 0]);
    try {
      if (!this._writeCipherActive) {
        this._sendRaw(new TlsRecord(TLS_CT.ALERT, alert).pack());
      } else if (this._pendingWrites === 0 && this._closeNotify?.seq === this._sendSeq) {
        // fast path: pre-encrypted close_notify, sent synchronously
        this._sendSeq++;
        this._sendRaw(this._closeNotify.bytes);
      } else {
        // writes still in flight — queue behind them (best effort)
        this._sendRecord(TLS_CT.ALERT, alert).catch(() => { /* ignore */ });
      }
    } catch { /* ignore */ }
    this._closeNotify = null;
  }

  // ── record protection (RFC 5246 §6.2.3.3, RFC 5288 §3) ───────────────────

  /**
   * Encrypt one record under the current write state with sequence number seq.
   * Wire payload = explicit_nonce(8) || AES-GCM(ciphertext || tag(16)).
   * @param {number} contentType
   * @param {Uint8Array} plaintext
   * @param {number} seq
   */
  async _encryptRecord(contentType, plaintext, seq) {
    // explicit nonce = seq as 8-byte big-endian (deterministic, avoids reuse)
    const explicitNonce = seqToBytes8(seq);
    const nonce = concat(/** @type {Uint8Array} */ (this._encryptFixedIV), explicitNonce);
    const aad = buildAAD(seq, contentType, plaintext.length);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: /** @type {Uint8Array<ArrayBuffer>} */ (nonce), additionalData: aad },
      /** @type {CryptoKey} */ (this._encryptKey),
      /** @type {Uint8Array<ArrayBuffer>} */ (plaintext),
    );
    return new TlsRecord(contentType, concat(explicitNonce, new Uint8Array(cipher))).pack();
  }

  /**
   * Send one record: in the clear before our ChangeCipherSpec, AES-GCM
   * protected afterwards. Encrypted writes are queued so that sequence
   * numbers are assigned (and records hit the wire) in call order.
   * @param {number} contentType
   * @param {Uint8Array} plaintext
   * @param {boolean} [refreshCloseNotify] re-arm the pre-encrypted close_notify afterwards
   */
  _sendRecord(contentType, plaintext, refreshCloseNotify = false) {
    if (!this._writeCipherActive) {
      this._sendRaw(new TlsRecord(contentType, /** @type {Uint8Array<ArrayBuffer>} */ (plaintext)).pack());
      return Promise.resolve();
    }
    this._pendingWrites++;
    const job = this._writeChain.then(async () => {
      try {
        const bytes = await this._encryptRecord(contentType, plaintext, this._sendSeq++);
        this._sendRaw(bytes);
        if (refreshCloseNotify && this._state !== "CLOSED") await this._prepareCloseNotify();
      } finally {
        this._pendingWrites--;
      }
    });
    this._writeChain = job.catch(() => { /* keep the chain alive */ });
    return job;
  }

  /** Pre-encrypt close_notify for the next write sequence number. */
  async _prepareCloseNotify() {
    if (!this._writeCipherActive) { this._closeNotify = null; return; }
    const seq = this._sendSeq;
    const bytes = await this._encryptRecord(TLS_CT.ALERT, new Uint8Array([1, 0]), seq);
    this._closeNotify = { seq, bytes };
  }

  /** Send ChangeCipherSpec and switch the write side to the new keys (seq := 0). */
  _sendChangeCipherSpec() {
    this._sendRaw(TlsRecord.buildChangeCipherSpec());
    this._writeCipherActive = true;
    this._sendSeq = 0;
  }

  /**
   * Decrypt one protected record (read sequence number = this._recvSeq++).
   * @param {TlsRecord} record
   * @returns {Promise<TlsRecord>}
   */
  async _decryptRecord(record) {
    if (record.payload.length < 8 + 16) {
      throw new TlsHandshakeError("Protected record too short (decode_error)");
    }
    const explicitNonce = record.payload.slice(0, 8);
    const ciphertext    = record.payload.slice(8);
    const seq = this._recvSeq++;
    const nonce = concat(/** @type {Uint8Array} */ (this._decryptFixedIV), explicitNonce);
    const aad = buildAAD(seq, record.contentType, ciphertext.length - 16); // minus GCM tag
    let plain;
    try {
      plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: /** @type {Uint8Array<ArrayBuffer>} */ (nonce), additionalData: aad },
        /** @type {CryptoKey} */ (this._decryptKey),
        ciphertext,
      );
    } catch {
      throw new TlsHandshakeError("Record authentication failed (bad_record_mac)", 20);
    }
    return new TlsRecord(record.contentType, new Uint8Array(plain));
  }

  // ── handshake – client side ───────────────────────────────────────────────

  async _clientHandshake() {
    this._transcript = new Uint8Array(0);

    // 1. Generate client random + ECDH keypair
    this._clientRandom = crypto.getRandomValues(new Uint8Array(32));
    this._ecdhKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
    );

    // 2. Send ClientHello, append HS bytes to transcript
    const chRecord = TlsRecord.buildClientHello(this._clientRandom, this._serverName);
    this._sendRaw(chRecord);
    this._appendTranscript(chRecord.slice(5));

    // 3. Read ServerHello, Certificate, ServerKeyExchange, ServerHelloDone
    let skeBody = null;
    let peerCert = null;

    while (true) {
      const record = await this._readRecordTimeout();
      if (record === null) throw new TlsHandshakeError("Connection closed during handshake");
      if (record.contentType !== TLS_CT.HANDSHAKE) continue;
      // append entire HANDSHAKE record payload (= concatenated HS message bytes)
      this._appendTranscript(record.payload);

      const msgs = this._parseHandshakeMessages(record.payload);
      for (const msg of msgs) {
        if (msg.type === TLS_HT.SERVER_HELLO) {
          this._serverRandom = msg.body.slice(2, 34);
        } else if (msg.type === TLS_HT.CERTIFICATE) {
          peerCert = await this._parseCertFromMessage(msg.body);
          this.peerCert = peerCert;
          if (peerCert && this._trustStore) {
            const status = peerCert.validityStatus(this._now());
            if (status === "expired" || status === "notYetValid") {
              throw new TlsCertExpiredError(peerCert.subject, status);
            }
            if (!await this._trustStore.isTrusted(peerCert, peerCert.chain, { nowMs: this._now() })) {
              throw new TlsCertUntrustedError(peerCert.subject);
            }
            if (this._serverName
                && !certMatchesName(peerCert.subject, this._serverName, peerCert.subjectAltNames())) {
              throw new TlsCertNameMismatchError(peerCert.subject, this._serverName);
            }
          }
        } else if (msg.type === TLS_HT.SERVER_KEY_EXCHANGE) {
          skeBody = msg.body;
        }
      }

      if (msgs.some(m => m.type === TLS_HT.SERVER_HELLO_DONE)) break;
    }

    if (!skeBody) throw new TlsHandshakeError("No ServerKeyExchange received");

    // 4. Parse ServerKeyExchange and verify signature. For ECDHE_ECDSA both
    //    the server certificate and the signature are mandatory (RFC 8422
    //    §5.4) — even without a trust store (curl -k), which only skips the
    //    *certificate* checks, never the proof of key possession.
    if (!peerCert?.publicKey) throw new TlsMissingAuthError("certificate");
    const { ecdhPubKeyBytes, ecParams, signature } = TlsRecord.parseServerKeyExchange(skeBody);
    if (!signature) throw new TlsMissingAuthError("signature");

    const toSign = concat(
      /** @type {Uint8Array} */ (this._clientRandom),
      /** @type {Uint8Array} */ (this._serverRandom),
      ecParams,
    );
    const sigValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      peerCert.publicKey,
      /** @type {Uint8Array<ArrayBuffer>} */ (signature),
      toSign,
    );
    if (!sigValid) throw new TlsSignatureError();

    // 5. Send ClientKeyExchange, append HS bytes to transcript
    this._peerEcdhPubKey = await importEcdhPubKey(/** @type {Uint8Array<ArrayBuffer>} */ (ecdhPubKeyBytes));
    const ownPubKeyRaw = new Uint8Array(await crypto.subtle.exportKey(
      "raw", /** @type {CryptoKeyPair} */ (this._ecdhKeyPair).publicKey,
    ));
    const ckeRecord = TlsRecord.buildClientKeyExchange(ownPubKeyRaw);
    this._sendRaw(ckeRecord);
    this._appendTranscript(ckeRecord.slice(5));

    // 6. Derive session keys
    await this._deriveKeys();

    // 7. Compute client verify_data from transcript so far, send ChangeCipherSpec + Finished
    //    Finished is the first record under the new keys (RFC 5246 §7.4.9):
    //    Handshake content type, AES-GCM protected, write seq 0.
    const clientVerifyData = await this._makeVerifyData("client");
    const clientFinishedMsg = this._buildHsBytes(TLS_HT.FINISHED, clientVerifyData);
    this._sendChangeCipherSpec();
    await this._sendRecord(TLS_CT.HANDSHAKE, clientFinishedMsg);
    // append the *plaintext* Finished message so server Finished can be verified
    this._appendTranscript(clientFinishedMsg);

    // 8. Read server ChangeCipherSpec
    await this._readExpectedRecord(TLS_CT.CHANGE_CIPHER_SPEC);

    // 9. Read and verify server Finished
    const serverFinishedMsg = await this._readExpectedHandshake(TLS_HT.FINISHED);
    const expectedServerVerifyData = await this._makeVerifyData("server");
    this._verifyFinished(serverFinishedMsg.body, expectedServerVerifyData);
  }

  // ── handshake – server side ───────────────────────────────────────────────

  async _serverHandshake() {
    if (!this._cert) throw new TlsHandshakeError("Server cert required");
    if (!this._cert.privateKey) throw new TlsHandshakeError("Server cert has no private key");

    this._transcript = new Uint8Array(0);

    // 1. Read ClientHello, append to transcript
    const chRecord = await this._readRecordTimeout();
    if (chRecord === null || chRecord.contentType !== TLS_CT.HANDSHAKE) {
      throw new TlsHandshakeError("Expected ClientHello");
    }
    this._appendTranscript(chRecord.payload);
    const chMsgs = this._parseHandshakeMessages(chRecord.payload);
    const ch = chMsgs.find(m => m.type === TLS_HT.CLIENT_HELLO);
    if (!ch) throw new TlsHandshakeError("Expected ClientHello");
    this._clientRandom = ch.body.slice(2, 34);

    // 2. Generate server random + ECDH keypair
    this._serverRandom = crypto.getRandomValues(new Uint8Array(32));
    this._ecdhKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
    );
    const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey(
      "raw", /** @type {CryptoKeyPair} */ (this._ecdhKeyPair).publicKey,
    ));

    // 3. Sign ServerKeyExchange params with cert private key
    const ecParams = new Uint8Array(4 + serverPubRaw.length);
    ecParams[0] = 0x03; ecParams[1] = 0x00; ecParams[2] = 0x17;
    ecParams[3] = serverPubRaw.length;
    ecParams.set(serverPubRaw, 4);

    const toSign = concat(
      /** @type {Uint8Array} */ (this._clientRandom),
      /** @type {Uint8Array} */ (this._serverRandom),
      ecParams,
    );
    const sigBuf = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this._cert.privateKey,
      toSign,
    );
    const signature = new Uint8Array(sigBuf);

    // 4. Send ServerHello, Certificate, ServerKeyExchange, ServerHelloDone
    //    Append each HS message to transcript
    const sessionId = crypto.getRandomValues(new Uint8Array(4));
    const shRecord   = TlsRecord.buildServerHello(this._serverRandom, sessionId);
    const chainDers  = this._cert.chain.map(c => c.toDer());
    const certRecord = TlsRecord.buildCertificate([this._cert.toDer(), ...chainDers]);
    const skeRecord  = TlsRecord.buildServerKeyExchange(serverPubRaw, signature);
    const shdRecord  = TlsRecord.buildServerHelloDone();

    this._sendRaw(shRecord);   this._appendTranscript(shRecord.slice(5));
    this._sendRaw(certRecord); this._appendTranscript(certRecord.slice(5));
    this._sendRaw(skeRecord);  this._appendTranscript(skeRecord.slice(5));
    this._sendRaw(shdRecord);  this._appendTranscript(shdRecord.slice(5));

    // 5. Read ClientKeyExchange, append to transcript
    const ckeRecord = await this._readRecordTimeout();
    if (ckeRecord === null || ckeRecord.contentType !== TLS_CT.HANDSHAKE) {
      throw new TlsHandshakeError("Expected ClientKeyExchange");
    }
    this._appendTranscript(ckeRecord.payload);
    const ckeMsgs = this._parseHandshakeMessages(ckeRecord.payload);
    const cke = ckeMsgs.find(m => m.type === TLS_HT.CLIENT_KEY_EXCHANGE);
    if (!cke) throw new TlsHandshakeError("Expected ClientKeyExchange");

    const peerKeyLen = cke.body[0];
    const peerEcdhRaw = cke.body.slice(1, 1 + peerKeyLen);
    this._peerEcdhPubKey = await importEcdhPubKey(peerEcdhRaw);

    // 6. Derive session keys
    await this._deriveKeys();

    // 7. Read client ChangeCipherSpec
    await this._readExpectedRecord(TLS_CT.CHANGE_CIPHER_SPEC);

    // 8. Read and verify client Finished
    const clientFinishedMsg = await this._readExpectedHandshake(TLS_HT.FINISHED);
    const expectedClientVerifyData = await this._makeVerifyData("client");
    this._verifyFinished(clientFinishedMsg.body, expectedClientVerifyData);
    // append client Finished to transcript so our own Finished is computed correctly
    this._appendTranscript(this._buildHsBytes(TLS_HT.FINISHED, clientFinishedMsg.body));

    // 9. Send ChangeCipherSpec + Finished
    const serverVerifyData = await this._makeVerifyData("server");
    this._sendChangeCipherSpec();
    await this._sendRecord(TLS_CT.HANDSHAKE, this._buildHsBytes(TLS_HT.FINISHED, serverVerifyData));
  }

  // ── key derivation ────────────────────────────────────────────────────────

  async _deriveKeys() {
    // pre_master_secret = ECDH shared secret
    const sharedBits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: /** @type {CryptoKey} */ (this._peerEcdhPubKey) },
      /** @type {CryptoKeyPair} */ (this._ecdhKeyPair).privateKey,
      256,
    );
    const preMasterSecret = new Uint8Array(sharedBits);

    // master_secret = PRF(pre_master_secret, "master secret", ClientRandom || ServerRandom, 48)
    const masterSecret = await prf(
      preMasterSecret, "master secret",
      concat(
        /** @type {Uint8Array} */ (this._clientRandom),
        /** @type {Uint8Array} */ (this._serverRandom),
      ),
      48,
    );
    this._masterSecret = masterSecret;

    // key_block = PRF(master_secret, "key expansion", ServerRandom || ClientRandom, 40)
    // Layout (RFC 5246 §6.3 + RFC 5288):
    //   client_write_key[16] | server_write_key[16] | client_write_IV[4] | server_write_IV[4]
    const keyBlock = await prf(
      masterSecret, "key expansion",
      concat(
        /** @type {Uint8Array} */ (this._serverRandom),
        /** @type {Uint8Array} */ (this._clientRandom),
      ),
      40,
    );

    const clientWriteKeyBytes = keyBlock.slice(0, 16);
    const serverWriteKeyBytes = keyBlock.slice(16, 32);
    const clientFixedIV       = keyBlock.slice(32, 36);
    const serverFixedIV       = keyBlock.slice(36, 40);

    const clientWriteKey = await crypto.subtle.importKey(
      "raw", clientWriteKeyBytes, { name: "AES-GCM" }, false,
      [this._isServer ? "decrypt" : "encrypt"],
    );
    const serverWriteKey = await crypto.subtle.importKey(
      "raw", serverWriteKeyBytes, { name: "AES-GCM" }, false,
      [this._isServer ? "encrypt" : "decrypt"],
    );

    if (this._isServer) {
      this._encryptKey     = serverWriteKey;
      this._decryptKey     = clientWriteKey;
      this._encryptFixedIV = serverFixedIV;
      this._decryptFixedIV = clientFixedIV;
    } else {
      this._encryptKey     = clientWriteKey;
      this._decryptKey     = serverWriteKey;
      this._encryptFixedIV = clientFixedIV;
      this._decryptFixedIV = serverFixedIV;
    }
  }

  // ── record framing ────────────────────────────────────────────────────────

  /**
   * Fill _recvBuf until it has at least `need` bytes, then return.
   * Returns false if the stream closed before enough bytes arrived.
   * @param {number} need
   */
  async _fillBuf(need) {
    while (this._recvBuf.length < need) {
      const chunk = await this._recvRaw();
      if (chunk === null) return false;
      this._recvBuf = concat(this._recvBuf, chunk);
    }
    return true;
  }

  /**
   * Read one TLS record and, once the peer's ChangeCipherSpec has been
   * received, decrypt it (read seq 0 = peer Finished, then ApplicationData /
   * Alerts from seq 1). Returns null on EOF.
   * @returns {Promise<TlsRecord|null>}
   */
  async _readRecord() {
    const rec = await this._readRawRecord();
    if (rec === null) return null;
    if (rec.contentType === TLS_CT.CHANGE_CIPHER_SPEC) {
      if (this._decryptKey) { this._readCipherActive = true; this._recvSeq = 0; }
      return rec;
    }
    if (!this._readCipherActive) return rec;
    return this._decryptRecord(rec);
  }

  /**
   * Read exactly one raw (possibly encrypted) TLS record from the TCP stream.
   * Returns null on EOF.
   * @returns {Promise<TlsRecord|null>}
   */
  async _readRawRecord() {
    if (!await this._fillBuf(5)) return null;

    const contentType = this._recvBuf[0];
    const len = (this._recvBuf[3] << 8) | this._recvBuf[4];

    if (!await this._fillBuf(5 + len)) return null;

    const payload = this._recvBuf.slice(5, 5 + len);
    this._recvBuf = this._recvBuf.slice(5 + len);
    return new TlsRecord(contentType, payload);
  }

  /**
   * Like _readRecord but with a timeout. Throws TlsHandshakeError on timeout.
   * @returns {Promise<TlsRecord|null>}
   */
  async _readRecordTimeout() {
    return new Promise((resolve, reject) => {
      let done = false;
      this._sleep(this._timeoutMs).then(() => {
        if (!done) { done = true; reject(new TlsHandshakeError("Handshake timeout")); }
      });
      this._readRecord().then(
        r => { if (!done) { done = true; resolve(r); } },
        e => { if (!done) { done = true; reject(e); } },
      );
    });
  }

  /**
   * Read records until one matching contentType is found.
   * @param {number} contentType
   * @returns {Promise<TlsRecord>}
   */
  async _readExpectedRecord(contentType) {
    while (true) {
      const rec = await this._readRecordTimeout();
      if (rec === null) throw new TlsHandshakeError("Connection closed");
      if (rec.contentType === contentType) return rec;
    }
  }

  /**
   * Read records until a Handshake message of given type is found.
   * @param {number} hsType
   * @returns {Promise<{ type: number, body: Uint8Array<ArrayBuffer> }>}
   */
  async _readExpectedHandshake(hsType) {
    while (true) {
      const rec = await this._readExpectedRecord(TLS_CT.HANDSHAKE);
      const msgs = this._parseHandshakeMessages(rec.payload);
      const found = msgs.find(m => m.type === hsType);
      if (found) return found;
    }
  }

  // ── handshake message parsing ─────────────────────────────────────────────

  /**
   * Parse one or more handshake messages from a HANDSHAKE record payload.
   * @param {Uint8Array<ArrayBuffer>} payload
   * @returns {{ type: number, body: Uint8Array<ArrayBuffer> }[]}
   */
  _parseHandshakeMessages(payload) {
    const msgs = [];
    let off = 0;
    while (off + 4 <= payload.length) {
      const type = payload[off];
      const len = (payload[off + 1] << 16) | (payload[off + 2] << 8) | payload[off + 3];
      if (off + 4 + len > payload.length) break;
      msgs.push({ type, body: payload.slice(off + 4, off + 4 + len) });
      off += 4 + len;
    }
    return msgs;
  }

  // ── transcript helpers ────────────────────────────────────────────────────

  /** Append raw handshake message bytes to transcript. @param {Uint8Array} hsBytes */
  _appendTranscript(hsBytes) {
    this._transcript = concat(this._transcript, hsBytes);
  }

  /**
   * Reconstruct handshake message bytes [type:1][len:3][body] from parsed components.
   * Used to append received messages when only type+body are available.
   * @param {number} type
   * @param {Uint8Array} body
   */
  _buildHsBytes(type, body) {
    const msg = new Uint8Array(4 + body.length);
    msg[0] = type;
    msg[1] = (body.length >> 16) & 0xff;
    msg[2] = (body.length >> 8)  & 0xff;
    msg[3] =  body.length        & 0xff;
    msg.set(body, 4);
    return msg;
  }

  // ── verify_data ────────────────────────────────────────────────────────────

  /**
   * Compute 12-byte verify_data per RFC 5246 §7.4.9:
   * PRF(master_secret, finished_label, SHA-256(handshake_transcript), 12)
   * @param {"client"|"server"} role
   */
  async _makeVerifyData(role) {
    const transcriptHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", /** @type {Uint8Array<ArrayBuffer>} */ (this._transcript)),
    );
    const label = role === "client" ? "client finished" : "server finished";
    return prf(/** @type {Uint8Array} */ (this._masterSecret), label, transcriptHash, 12);
  }

  /**
   * Compare received verify_data against expected; throw on mismatch.
   * @param {Uint8Array} received
   * @param {Uint8Array} expected
   */
  _verifyFinished(received, expected) {
    if (received.length !== expected.length) {
      throw new TlsHandshakeError("Finished verify_data length mismatch");
    }
    for (let i = 0; i < received.length; i++) {
      if (received[i] !== expected[i]) {
        throw new TlsHandshakeError("Finished verify_data mismatch — handshake integrity check failed", TLS_ALERT.DECRYPT_ERROR);
      }
    }
  }

  // ── certificate parsing ───────────────────────────────────────────────────

  /**
   * Extract a TlsCertificate stub from a raw Certificate handshake body.
   * Recovers subject/issuer CNs from our known DER structure, imports the real
   * ECDSA public key, and verifies the certificate signature against the issuer.
   * @param {Uint8Array<ArrayBuffer>} body
   * @returns {Promise<TlsCertificate|null>}
   */
  async _parseCertFromMessage(body) {
    if (body.length < 6) return null;
    const listLen = (body[0] << 16) | (body[1] << 8) | body[2];

    /** @type {{ cert: TlsCertificate, der: Uint8Array }[]} */
    const entries = [];
    let off = 3;
    while (off + 3 <= 3 + listLen && off + 3 <= body.length) {
      const certLen = (body[off] << 16) | (body[off + 1] << 8) | body[off + 2];
      off += 3;
      if (certLen === 0 || off + certLen > body.length) break;
      const der = body.slice(off, off + certLen);
      const cert = await this._parseSingleCertDer(der);
      if (cert) entries.push({ cert, der });
      off += certLen;
    }
    if (entries.length === 0) return null;

    const leaf = entries[0].cert;
    leaf.chain = entries.slice(1).map(e => e.cert);

    // Verify certificate signatures (only for certs with real P1363 signatures)
    for (let i = 0; i < entries.length; i++) {
      const { cert, der } = entries[i];
      const sig = extractCertSig(der);
      if (!sig) continue; // zero placeholder or unparseable — skip

      const issuerPubKey = cert.selfSigned
        ? cert.publicKey                        // self-signed: verify with own key
        : entries[i + 1]?.cert.publicKey ?? null; // CA-signed: verify with next cert in chain

      if (!issuerPubKey) continue; // issuer key not available — skip silently

      const tbs = extractTbsDer(der);
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        issuerPubKey,
        /** @type {Uint8Array<ArrayBuffer>} */ (sig),
        /** @type {Uint8Array<ArrayBuffer>} */ (tbs),
      );
      if (!valid) throw new TlsCertSignatureError(cert.subject);
    }

    return leaf;
  }

  /** @param {Uint8Array<ArrayBuffer>} der */
  async _parseSingleCertDer(der) {
    const p = parseTbs(der);
    const stub = new TlsCertificate();
    stub.subject    = p?.subjectCN ? `CN=${p.subjectCN}` : "";
    stub.issuer     = p?.issuerCN  ? `CN=${p.issuerCN}`  : stub.subject;
    stub.selfSigned = stub.subject === stub.issuer;
    // Real validity period from the wire; if the DER can't be parsed, the
    // cert has no subject/key either and fails the trust/signature checks.
    stub.notBefore  = p?.notBefore ?? 0;
    stub.notAfter   = p?.notAfter  ?? 0;
    // cA is only believed when it is signed into the cert (v3 basicConstraints);
    // a legacy v1 cert never counts as CA on the wire (RFC 5280 §6.1.4(k)).
    stub.x509Version   = p?.version === 3 ? 3 : 1;
    stub.isCA          = p?.version === 3 && p.isCA;
    stub._wireAltNames = p?.altNames ?? [];

    if (p?.publicKeyRaw) {
      const rawPubKey = /** @type {Uint8Array<ArrayBuffer>} */ (p.publicKeyRaw);
      try {
        stub.publicKey = await crypto.subtle.importKey(
          "raw", rawPubKey,
          { name: "ECDSA", namedCurve: "P-256" },
          true, ["verify"],
        );
        stub.publicKeyRaw = rawPubKey;
        // Derive publicKeyId from first 16 bytes of key material
        stub.publicKeyId = Array.from(rawPubKey.slice(1, 17))
          .map(b => b.toString(16).padStart(2, "0")).join("");
      } catch { /* not a valid key, skip */ }
    }

    // Fallback publicKeyId from SHA-256 of DER (for certs with placeholder keys)
    if (!stub.publicKeyId) {
      const hashBuf = await crypto.subtle.digest("SHA-256", der);
      stub.publicKeyId = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, "0")).join("");
    }

    stub.certSignature = extractCertSig(der);
    stub._tbsDer = extractTbsDer(der);

    return stub;
  }
}
