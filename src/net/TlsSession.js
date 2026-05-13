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

export class TlsSignatureError extends TlsHandshakeError {
  constructor() {
    super("ServerKeyExchange signature invalid — possible MITM attack");
    this.name = "TlsSignatureError";
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
        this._state = "CLOSED";
        return null;
      }
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
    let skeBody = null;
    let peerCert = null;

    while (true) {
      const record = await this._readRecordTimeout();
      if (record === null) throw new TlsHandshakeError("Connection closed during handshake");
      if (record.contentType !== TLS_CT.HANDSHAKE) continue;

      const msgs = this._parseHandshakeMessages(record.payload);
      for (const msg of msgs) {
        if (msg.type === TLS_HT.SERVER_HELLO) {
          this._serverRandom = msg.body.slice(2, 34);
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
          skeBody = msg.body;
        } else if (msg.type === TLS_HT.SERVER_HELLO_DONE) {
          break;
        }
      }

      if (msgs.some(m => m.type === TLS_HT.SERVER_HELLO_DONE)) break;
    }

    if (!skeBody) throw new TlsHandshakeError("No ServerKeyExchange received");

    // 4. Parse ServerKeyExchange and verify signature
    const { ecdhPubKeyBytes, ecParams, signature } = TlsRecord.parseServerKeyExchange(skeBody);

    if (signature && peerCert?.publicKey) {
      // toSign = clientRandom || serverRandom || ecParams (curve+keylen+keybytes)
      const toSign = concat(
        /** @type {Uint8Array} */ (this._clientRandom),
        /** @type {Uint8Array} */ (this._serverRandom),
        ecParams,
      );
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        peerCert.publicKey,
        /** @type {Uint8Array<ArrayBuffer>} */ (signature),
        toSign,
      );
      if (!valid) throw new TlsSignatureError();
    }

    // 5. Send ClientKeyExchange + ChangeCipherSpec + Finished
    this._peerEcdhPubKey = await importEcdhPubKey(/** @type {Uint8Array<ArrayBuffer>} */ (ecdhPubKeyBytes));
    const ownPubKeyRaw = new Uint8Array(await crypto.subtle.exportKey(
      "raw", /** @type {CryptoKeyPair} */ (this._ecdhKeyPair).publicKey,
    ));

    this._sendRaw(TlsRecord.buildClientKeyExchange(ownPubKeyRaw));
    await this._deriveKeys();
    this._sendRaw(TlsRecord.buildChangeCipherSpec());
    this._sendRaw(TlsRecord.buildFinished(await this._makeVerifyData("client")));

    // 6. Read server ChangeCipherSpec + Finished
    await this._readExpectedRecord(TLS_CT.CHANGE_CIPHER_SPEC);
    await this._readExpectedHandshake(TLS_HT.FINISHED);
  }

  // ── handshake – server side ───────────────────────────────────────────────

  async _serverHandshake() {
    if (!this._cert) throw new TlsHandshakeError("Server cert required");
    if (!this._cert.privateKey) throw new TlsHandshakeError("Server cert has no private key");

    // 1. Read ClientHello
    const chRecord = await this._readRecordTimeout();
    if (chRecord === null || chRecord.contentType !== TLS_CT.HANDSHAKE) {
      throw new TlsHandshakeError("Expected ClientHello");
    }
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
    // ecParams layout matches parseServerKeyExchange: [named_curve:3][key_len:1][key_bytes:65]
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

    // 4. Send ServerHello + Certificate + ServerKeyExchange + ServerHelloDone
    const sessionId = crypto.getRandomValues(new Uint8Array(4));
    this._sendRaw(TlsRecord.buildServerHello(this._serverRandom, sessionId));
    const chainDers = this._cert.chain.map(c => c.toDer());
    this._sendRaw(TlsRecord.buildCertificate([this._cert.toDer(), ...chainDers]));
    this._sendRaw(TlsRecord.buildServerKeyExchange(serverPubRaw, signature));
    this._sendRaw(TlsRecord.buildServerHelloDone());

    // 5. Read ClientKeyExchange
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

    // 6. Derive keys
    await this._deriveKeys();

    // 7. Read client ChangeCipherSpec + Finished
    await this._readExpectedRecord(TLS_CT.CHANGE_CIPHER_SPEC);
    await this._readExpectedHandshake(TLS_HT.FINISHED);

    // 8. Send ChangeCipherSpec + Finished
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

    const stub = new TlsCertificate();
    stub.subject    = subjectCN ? `CN=${subjectCN}` : "";
    stub.issuer     = issuerCN  ? `CN=${issuerCN}`  : stub.subject;
    stub.selfSigned = stub.subject === stub.issuer;
    stub.notBefore  = 0;
    stub.notAfter   = Date.now() + 365 * 24 * 3600 * 1000;

    // Extract the real ECDSA-P256 public key from SubjectPublicKeyInfo.
    // toDer() encodes it as BIT STRING (0x03) with content [0x00, 0x04, ...64 bytes].
    // A P-256 uncompressed key is always 65 bytes → BIT STRING content = 66 bytes (0x42).
    for (let i = 0; i + 67 <= der.length; i++) {
      if (der[i] === 0x03 && der[i + 1] === 0x42 && der[i + 2] === 0x00 && der[i + 3] === 0x04) {
        const rawPubKey = der.slice(i + 2, i + 2 + 65); // 0x04 || x || y
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
        break;
      }
    }

    // Fallback publicKeyId from SHA-256 of DER (for certs with placeholder keys)
    if (!stub.publicKeyId) {
      const hashBuf = await crypto.subtle.digest("SHA-256", der);
      stub.publicKeyId = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, "0")).join("");
    }

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
