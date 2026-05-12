//@ts-check

import { TlsRecord, TLS_CT, TLS_HT } from "./pdu/TlsRecord.js";
import { TlsCertificate, TlsTrustStore } from "./models/TlsCertificate.js";
import { encodeUTF8 } from "../lib/helpers.js";

// ── error types ────────────────────────────────────────────────────────────

export class TlsHandshakeError extends Error {
  /** @param {string} msg */
  constructor(msg) { super(msg); this.name = "TlsHandshakeError"; }
}

export class TlsCertUntrustedError extends TlsHandshakeError {
  /** @param {string} subject */
  constructor(subject) {
    super(`Certificate not trusted: ${subject}`);
    this.name = "TlsCertUntrustedError";
    this.subject = subject;
  }
}

export class TlsCertExpiredError extends TlsHandshakeError {
  /** @param {string} subject */
  constructor(subject) {
    super(`Certificate expired: ${subject}`);
    this.name = "TlsCertExpiredError";
    this.subject = subject;
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

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
 * XOR two Uint8Arrays of equal length into a new array.
 * @param {Uint8Array} a @param {Uint8Array} b
 */
function xorBytes(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/**
 * Derive a per-record nonce: IV XOR (seq as 12-byte big-endian).
 * @param {Uint8Array} baseIV - 12 bytes
 * @param {number} seq
 */
function gcmNonce(baseIV, seq) {
  const seqBytes = new Uint8Array(12);
  // Write seq as big-endian into last 8 bytes
  let s = seq >>> 0;
  for (let i = 11; i >= 4; i--) { seqBytes[i] = s & 0xff; s = (s / 256) | 0; }
  return xorBytes(baseIV, seqBytes);
}

/**
 * Derive an AES-GCM CryptoKey from an HKDF base key.
 * @param {CryptoKey} hkdfKey
 * @param {Uint8Array<ArrayBuffer>} salt
 * @param {string} label
 * @param {"encrypt"|"decrypt"} usage
 */
async function deriveAesKey(hkdfKey, salt, label, usage) {
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encodeUTF8(label) },
    hkdfKey,
    { name: "AES-GCM", length: 128 },
    false,
    [usage],
  );
}

/**
 * Derive 12 raw IV bytes from an HKDF base key.
 * @param {CryptoKey} hkdfKey
 * @param {Uint8Array<ArrayBuffer>} salt
 * @param {string} label
 */
async function deriveIV(hkdfKey, salt, label) {
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: encodeUTF8(label) },
    hkdfKey,
    96, // 12 bytes
  );
  return new Uint8Array(bits);
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
   * }} opts
   */
  constructor({ send, recv, isServer, cert, trustStore, timeoutMs = 400, sleepFn }) {
    this._sendRaw = send;
    this._recvRaw = recv;
    this._isServer = isServer;
    this._cert = cert ?? null;
    this._trustStore = trustStore ?? null;
    this._timeoutMs = timeoutMs;
    this._sleep = sleepFn ?? ((ms) => new Promise(r => setTimeout(r, ms)));

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
    /** @type {Uint8Array|null} */ this._encryptIV = null;
    /** @type {Uint8Array|null} */ this._decryptIV = null;
    this._sendSeq = 0;
    this._recvSeq = 0;
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
      this._state = "ESTABLISHED";
    } catch (e) {
      this._state = "CLOSED";
      // Send close_notify alert if it's a cert error (best-effort)
      if (e instanceof TlsHandshakeError) {
        try { this._sendRaw(TlsRecord.buildAlert(2, 42)); } catch { /* ignore */ }
      }
      throw e;
    }
  }

  /**
   * Encrypt and send plaintext as a TLS ApplicationData record.
   * @param {Uint8Array<ArrayBuffer>} plaintext
   */
  async send(plaintext) {
    if (this._state !== "ESTABLISHED") throw new Error("TLS session not established");
    const nonce = gcmNonce(/** @type {Uint8Array} */ (this._encryptIV), this._sendSeq++);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      /** @type {CryptoKey} */ (this._encryptKey),
      plaintext,
    );
    this._sendRaw(TlsRecord.buildApplicationData(new Uint8Array(cipher)));
  }

  /**
   * Receive and decrypt the next TLS ApplicationData record.
   * Returns null when the peer closes the connection.
   * @returns {Promise<Uint8Array|null>}
   */
  async recv() {
    if (this._state === "CLOSED") return null;
    while (true) {
      const record = await this._readRecord();
      if (record === null) { this._state = "CLOSED"; return null; }

      if (record.contentType === TLS_CT.APP_DATA) {
        const nonce = gcmNonce(/** @type {Uint8Array} */ (this._decryptIV), this._recvSeq++);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce },
          /** @type {CryptoKey} */ (this._decryptKey),
          record.payload,
        );
        return new Uint8Array(plain);
      }

      if (record.contentType === TLS_CT.ALERT) {
        // close_notify (level=1, desc=0) or fatal
        this._state = "CLOSED";
        return null;
      }
      // Skip unexpected records silently (e.g. renegotiation requests)
    }
  }

  /** Send a close_notify alert and mark session as closed. */
  close() {
    if (this._state === "CLOSED") return;
    this._state = "CLOSED";
    try { this._sendRaw(TlsRecord.buildAlert(1, 0)); } catch { /* ignore */ }
  }

  // ── handshake – client side ───────────────────────────────────────────────

  async _clientHandshake() {
    // 1. Generate client random + ECDH keypair
    this._clientRandom = crypto.getRandomValues(new Uint8Array(32));
    this._ecdhKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
    );

    // 2. Send ClientHello
    this._sendRaw(TlsRecord.buildClientHello(this._clientRandom));

    // 3. Read ServerHello, Certificate, ServerKeyExchange, ServerHelloDone
    let peerEcdhRaw = null;
    let peerCert = null;

    while (true) {
      const record = await this._readRecordTimeout();
      if (record === null) throw new TlsHandshakeError("Connection closed during handshake");
      if (record.contentType !== TLS_CT.HANDSHAKE) continue;

      const msgs = this._parseHandshakeMessages(record.payload);
      for (const msg of msgs) {
        if (msg.type === TLS_HT.SERVER_HELLO) {
          this._serverRandom = msg.body.slice(2, 34); // skip 2-byte version
        } else if (msg.type === TLS_HT.CERTIFICATE) {
          peerCert = await this._parseCertFromMessage(msg.body);
          this.peerCert = peerCert;
          if (peerCert && this._trustStore) {
            if (peerCert.notAfter < Date.now()) {
              throw new TlsCertExpiredError(peerCert.subject);
            }
            if (!this._trustStore.isTrusted(peerCert, peerCert.chain)) {
              throw new TlsCertUntrustedError(peerCert.subject);
            }
          }
        } else if (msg.type === TLS_HT.SERVER_KEY_EXCHANGE) {
          // [named_curve:1][curve_id:2][key_len:1][key_bytes]
          const keyLen = msg.body[3];
          peerEcdhRaw = msg.body.slice(4, 4 + keyLen);
        } else if (msg.type === TLS_HT.SERVER_HELLO_DONE) {
          break;
        }
      }

      // Exit loop once we saw ServerHelloDone
      if (msgs.some(m => m.type === TLS_HT.SERVER_HELLO_DONE)) break;
    }

    if (!peerEcdhRaw) throw new TlsHandshakeError("No ServerKeyExchange received");

    // 4. Send ClientKeyExchange + ChangeCipherSpec + Finished
    this._peerEcdhPubKey = await importEcdhPubKey(peerEcdhRaw);
    const ownPubKeyRaw = new Uint8Array(await crypto.subtle.exportKey(
      "raw", /** @type {CryptoKeyPair} */ (this._ecdhKeyPair).publicKey,
    ));

    this._sendRaw(TlsRecord.buildClientKeyExchange(ownPubKeyRaw));
    await this._deriveKeys();
    this._sendRaw(TlsRecord.buildChangeCipherSpec());
    this._sendRaw(TlsRecord.buildFinished(await this._makeVerifyData("client")));

    // 5. Read server ChangeCipherSpec + Finished
    await this._readExpectedRecord(TLS_CT.CHANGE_CIPHER_SPEC);
    await this._readExpectedHandshake(TLS_HT.FINISHED);
  }

  // ── handshake – server side ───────────────────────────────────────────────

  async _serverHandshake() {
    if (!this._cert) throw new TlsHandshakeError("Server cert required");

    // 1. Read ClientHello
    const chRecord = await this._readRecordTimeout();
    if (chRecord === null || chRecord.contentType !== TLS_CT.HANDSHAKE) {
      throw new TlsHandshakeError("Expected ClientHello");
    }
    const chMsgs = this._parseHandshakeMessages(chRecord.payload);
    const ch = chMsgs.find(m => m.type === TLS_HT.CLIENT_HELLO);
    if (!ch) throw new TlsHandshakeError("Expected ClientHello");
    this._clientRandom = ch.body.slice(2, 34); // skip 2-byte version

    // 2. Generate server random + ECDH keypair
    this._serverRandom = crypto.getRandomValues(new Uint8Array(32));
    this._ecdhKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
    );
    const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey(
      "raw", /** @type {CryptoKeyPair} */ (this._ecdhKeyPair).publicKey,
    ));

    // 3. Send ServerHello + Certificate + ServerKeyExchange + ServerHelloDone
    const sessionId = crypto.getRandomValues(new Uint8Array(4));
    this._sendRaw(TlsRecord.buildServerHello(this._serverRandom, sessionId));
    const chainDers = this._cert.chain.map(c => c.toDer());
    this._sendRaw(TlsRecord.buildCertificate([this._cert.toDer(), ...chainDers]));
    this._sendRaw(TlsRecord.buildServerKeyExchange(serverPubRaw));
    this._sendRaw(TlsRecord.buildServerHelloDone());

    // 4. Read ClientKeyExchange
    const ckeRecord = await this._readRecordTimeout();
    if (ckeRecord === null || ckeRecord.contentType !== TLS_CT.HANDSHAKE) {
      throw new TlsHandshakeError("Expected ClientKeyExchange");
    }
    const ckeMsgs = this._parseHandshakeMessages(ckeRecord.payload);
    const cke = ckeMsgs.find(m => m.type === TLS_HT.CLIENT_KEY_EXCHANGE);
    if (!cke) throw new TlsHandshakeError("Expected ClientKeyExchange");

    const peerKeyLen = cke.body[0];
    const peerEcdhRaw = cke.body.slice(1, 1 + peerKeyLen);
    this._peerEcdhPubKey = await importEcdhPubKey(peerEcdhRaw);

    // 5. Derive keys
    await this._deriveKeys();

    // 6. Read client ChangeCipherSpec + Finished
    await this._readExpectedRecord(TLS_CT.CHANGE_CIPHER_SPEC);
    await this._readExpectedHandshake(TLS_HT.FINISHED);

    // 7. Send ChangeCipherSpec + Finished
    this._sendRaw(TlsRecord.buildChangeCipherSpec());
    this._sendRaw(TlsRecord.buildFinished(await this._makeVerifyData("server")));
  }

  // ── key derivation ────────────────────────────────────────────────────────

  async _deriveKeys() {
    const sharedBits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: /** @type {CryptoKey} */ (this._peerEcdhPubKey) },
      /** @type {CryptoKeyPair} */ (this._ecdhKeyPair).privateKey,
      256,
    );

    const hkdfKey = await crypto.subtle.importKey(
      "raw", sharedBits, "HKDF", false, ["deriveKey", "deriveBits"],
    );

    const seed = concat(
      /** @type {Uint8Array} */ (this._clientRandom),
      /** @type {Uint8Array} */ (this._serverRandom),
    );

    const clientWriteKey = await deriveAesKey(hkdfKey, seed, "client write key", this._isServer ? "decrypt" : "encrypt");
    const serverWriteKey = await deriveAesKey(hkdfKey, seed, "server write key", this._isServer ? "encrypt" : "decrypt");
    const clientIV = await deriveIV(hkdfKey, seed, "client write iv");
    const serverIV = await deriveIV(hkdfKey, seed, "server write iv");

    if (this._isServer) {
      this._encryptKey = serverWriteKey;
      this._decryptKey = clientWriteKey;
      this._encryptIV  = serverIV;
      this._decryptIV  = clientIV;
    } else {
      this._encryptKey = clientWriteKey;
      this._decryptKey = serverWriteKey;
      this._encryptIV  = clientIV;
      this._decryptIV  = serverIV;
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
   * Read exactly one TLS record from the TCP stream. Returns null on EOF.
   * @returns {Promise<TlsRecord|null>}
   */
  async _readRecord() {
    // Need at least 5 bytes for the record header
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

  /**
   * Extract a TlsCertificate stub from a raw Certificate handshake body.
   * Scans the DER for OID 2.5.4.3 (commonName = 55 04 03) followed by a
   * UTF8String tag (0x0C) to recover subject/issuer CNs — this works because
   * TlsCertificate.toDer() always encodes them in that exact order
   * (issuerDn before subjectDn).
   * @param {Uint8Array<ArrayBuffer>} body
   * @returns {Promise<TlsCertificate|null>}
   */
  async _parseCertFromMessage(body) {
    // body: [list_len:3]([cert_len:3][cert_der])…
    if (body.length < 6) return null;
    const listLen = (body[0] << 16) | (body[1] << 8) | body[2];
    const certs = [];
    let off = 3;
    while (off + 3 <= 3 + listLen && off + 3 <= body.length) {
      const certLen = (body[off] << 16) | (body[off + 1] << 8) | body[off + 2];
      off += 3;
      if (certLen === 0 || off + certLen > body.length) break;
      const cert = await this._parseSingleCertDer(body.slice(off, off + certLen));
      if (cert) certs.push(cert);
      off += certLen;
    }
    if (certs.length === 0) return null;
    const leaf = certs[0];
    leaf.chain = certs.slice(1);
    return leaf;
  }

  /** @param {Uint8Array<ArrayBuffer>} der */
  async _parseSingleCertDer(der) {
    // Scan for OID 2.5.4.3 (55 04 03) → extract following UTF8String (CN)
    const cns = [];
    for (let i = 0; i + 5 < der.length; i++) {
      if (der[i] === 0x55 && der[i + 1] === 0x04 && der[i + 2] === 0x03) {
        const tagOff = i + 3;
        if (der[tagOff] === 0x0C && tagOff + 2 < der.length) {
          const strLen = der[tagOff + 1];
          if (tagOff + 2 + strLen <= der.length) {
            cns.push(new TextDecoder().decode(der.slice(tagOff + 2, tagOff + 2 + strLen)));
          }
        }
      }
    }
    // toDer() writes issuerDn first, subjectDn second
    const issuerCN  = cns[0] ?? "";
    const subjectCN = cns[1] ?? cns[0] ?? "";
    const hashBuf = await crypto.subtle.digest("SHA-256", der);
    const publicKeyId = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    const stub = new TlsCertificate();
    stub.subject     = subjectCN ? `CN=${subjectCN}` : "";
    stub.issuer      = issuerCN  ? `CN=${issuerCN}`  : stub.subject;
    stub.selfSigned  = stub.subject === stub.issuer;
    stub.publicKeyId = publicKeyId;
    stub.notBefore   = 0;
    stub.notAfter    = Date.now() + 365 * 24 * 3600 * 1000;
    return stub;
  }

  /**
   * Compute a 12-byte verify_data via HMAC-SHA256 (simplified — not RFC 5246 PRF).
   * @param {"client"|"server"} role
   */
  async _makeVerifyData(role) {
    const key = await crypto.subtle.importKey(
      "raw",
      concat(
        /** @type {Uint8Array} */ (this._clientRandom),
        /** @type {Uint8Array} */ (this._serverRandom),
      ),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encodeUTF8(`tls12 finished ${role}`));
    return new Uint8Array(sig).slice(0, 12);
  }
}
