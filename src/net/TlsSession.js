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
    /** @type {Uint8Array|null} */ this._encryptFixedIV = null;  // 4 bytes (RFC 5288)
    /** @type {Uint8Array|null} */ this._decryptFixedIV = null;  // 4 bytes
    /** @type {Uint8Array|null} */ this._masterSecret = null;    // 48 bytes
    this._sendSeq = 0;
    this._recvSeq = 0;

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
   * Encrypt and send plaintext as a TLS 1.2 ApplicationData record (RFC 5288).
   * Record payload = explicit_nonce(8) || AES-GCM-ciphertext+tag
   * @param {Uint8Array<ArrayBuffer>} plaintext
   */
  async send(plaintext) {
    if (this._state !== "ESTABLISHED") throw new Error("TLS session not established");
    const seq = this._sendSeq++;
    // explicit nonce = seq as 8-byte big-endian (deterministic, avoids reuse)
    const explicitNonce = seqToBytes8(seq);
    const nonce = concat(/** @type {Uint8Array} */ (this._encryptFixedIV), explicitNonce);
    const aad = buildAAD(seq, TLS_CT.APP_DATA, plaintext.length);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad },
      /** @type {CryptoKey} */ (this._encryptKey),
      plaintext,
    );
    // prepend explicit nonce so the peer can reconstruct the full nonce
    this._sendRaw(TlsRecord.buildApplicationData(
      concat(explicitNonce, new Uint8Array(cipher)),
    ));
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
        // first 8 bytes are the explicit nonce
        const explicitNonce = record.payload.slice(0, 8);
        const ciphertext    = record.payload.slice(8);
        const seq = this._recvSeq++;
        const nonce = concat(/** @type {Uint8Array} */ (this._decryptFixedIV), explicitNonce);
        const plaintextLen = ciphertext.length - 16; // minus 16-byte GCM tag
        const aad = buildAAD(seq, TLS_CT.APP_DATA, plaintextLen);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce, additionalData: aad },
          /** @type {CryptoKey} */ (this._decryptKey),
          ciphertext,
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
    this._transcript = new Uint8Array(0);

    // 1. Generate client random + ECDH keypair
    this._clientRandom = crypto.getRandomValues(new Uint8Array(32));
    this._ecdhKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
    );

    // 2. Send ClientHello, append HS bytes to transcript
    const chRecord = TlsRecord.buildClientHello(this._clientRandom);
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
            if (peerCert.notAfter < Date.now()) {
              throw new TlsCertExpiredError(peerCert.subject);
            }
            if (!await this._trustStore.isTrusted(peerCert, peerCert.chain)) {
              throw new TlsCertUntrustedError(peerCert.subject);
            }
          }
        } else if (msg.type === TLS_HT.SERVER_KEY_EXCHANGE) {
          skeBody = msg.body;
        }
      }

      if (msgs.some(m => m.type === TLS_HT.SERVER_HELLO_DONE)) break;
    }

    if (!skeBody) throw new TlsHandshakeError("No ServerKeyExchange received");

    // 4. Parse ServerKeyExchange and verify signature
    const { ecdhPubKeyBytes, ecParams, signature } = TlsRecord.parseServerKeyExchange(skeBody);

    if (signature && peerCert?.publicKey) {
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
    const clientVerifyData = await this._makeVerifyData("client");
    const clientFinishedRecord = TlsRecord.buildFinished(clientVerifyData);
    this._sendRaw(TlsRecord.buildChangeCipherSpec());
    this._sendRaw(clientFinishedRecord);
    // append client Finished to transcript so server Finished can be verified
    this._appendTranscript(clientFinishedRecord.slice(5));

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
    this._sendRaw(TlsRecord.buildChangeCipherSpec());
    this._sendRaw(TlsRecord.buildFinished(serverVerifyData));
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
        throw new TlsHandshakeError("Finished verify_data mismatch — handshake integrity check failed");
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
        const rawPubKey = der.slice(i + 3, i + 3 + 65); // 0x04 || x || y (skip 0x00 unused-bits byte)
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

    stub.certSignature = extractCertSig(der);
    stub._tbsDer = extractTbsDer(der);

    return stub;
  }
}
