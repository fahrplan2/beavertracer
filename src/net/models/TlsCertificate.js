//@ts-check

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * @param {number} tag
 * @param {Uint8Array} content
 */
function derTag(tag, content) {
  const lenBytes = derLength(content.length);
  const out = new Uint8Array(1 + lenBytes.length + content.length);
  out[0] = tag;
  out.set(lenBytes, 1);
  out.set(content, 1 + lenBytes.length);
  return out;
}

/** @param {number} len */
function derLength(len) {
  if (len < 0x80) return new Uint8Array([len]);
  if (len < 0x100) return new Uint8Array([0x81, len]);
  return new Uint8Array([0x82, (len >>> 8) & 0xff, len & 0xff]);
}

/** @param {string} s */
function derUtf8String(s) {
  const enc = new TextEncoder();
  return derTag(0x0C, enc.encode(s));
}

/** @param {Uint8Array[]} parts */
function concatBytes(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** @param {Uint8Array} bytes */
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** @param {string} hex */
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ── TlsCertificate ─────────────────────────────────────────────────────────

export class TlsCertificate {
  /** @type {string} e.g. "CN=server.local" */
  subject = "";

  /** @type {string} same as subject for self-signed */
  issuer = "";

  /** @type {string} symbolic 32-char hex string derived from public key */
  publicKeyId = "";

  /** @type {number} */
  serialNumber = 1;

  /** @type {number} Unix timestamp ms */
  notBefore = 0;

  /** @type {number} Unix timestamp ms */
  notAfter = 0;

  /** @type {boolean} */
  selfSigned = true;

  /** @type {boolean} – may act as a CA (sign other certificates) */
  isCA = false;

  /** @type {boolean} – private key is present (false for imported/re-signed certs) */
  hasPrivateKey = false;

  /** @type {TlsCertificate[]} – signing chain (CA cert + its ancestors), leaf-exclusive */
  chain = [];

  // ── crypto material (not persisted in toJSON, only in toSaveData) ──────────

  /** @type {CryptoKey|null} ECDSA-P256 private key, present only when hasPrivateKey=true */
  privateKey = null;

  /** @type {CryptoKey|null} ECDSA-P256 public key */
  publicKey = null;

  /** @type {Uint8Array|null} 65-byte uncompressed EC point (0x04 || x || y) */
  publicKeyRaw = null;

  /**
   * CA signature over the TBSCertificate bytes (P1363 format, 64 bytes for P-256).
   * Null for certs without a real signature (e.g. imported from external sources).
   * @type {Uint8Array|null}
   */
  certSignature = null;

  // ── internal TBS builder ──────────────────────────────────────────────────

  /**
   * Build the DER-encoded TBSCertificate bytes — the data that gets signed.
   * Called by generate()/sign() to compute certSignature, and by toDer().
   * @returns {Uint8Array}
   */
  _buildTbsBytes() {
    const serial = derTag(0x02, new Uint8Array([this.serialNumber & 0x7f]));
    const algId  = derTag(0x30, concatBytes(
      derTag(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])),
      derTag(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07])),
    ));
    const issuerDn = derTag(0x30, derTag(0x31, derTag(0x30, concatBytes(
      derTag(0x06, new Uint8Array([0x55, 0x04, 0x03])),
      derUtf8String(this.issuer.replace(/^CN=/, "")),
    ))));
    const subjectDn = derTag(0x30, derTag(0x31, derTag(0x30, concatBytes(
      derTag(0x06, new Uint8Array([0x55, 0x04, 0x03])),
      derUtf8String(this.subject.replace(/^CN=/, "")),
    ))));
    const pubKeyBytes = this.publicKeyRaw ?? (() => {
      const p = new Uint8Array(65); p[0] = 0x04; return p;
    })();
    const subjectPKI = derTag(0x30, concatBytes(
      algId,
      derTag(0x03, concatBytes(new Uint8Array([0x00]), pubKeyBytes)),
    ));
    return derTag(0x30, concatBytes(serial, algId, issuerDn, subjectDn, subjectPKI));
  }

  // ── static constructors ───────────────────────────────────────────────────

  /**
   * Generate a self-signed (or CA-signed) certificate with a fresh ECDSA-P256 key pair.
   * @param {string} cn
   * @param {TlsCertificate|null} [ca]
   * @param {{ isCA?: boolean, validityDays?: number }} [opts]
   * @returns {Promise<TlsCertificate>}
   */
  static async generate(cn, ca = null, opts = {}) {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
    );
    const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));

    const cert = new TlsCertificate();
    cert.subject       = `CN=${cn}`;
    cert.issuer        = ca ? ca.subject : `CN=${cn}`;
    cert.publicKeyId   = bytesToHex(pubRaw.slice(1, 17));
    cert.serialNumber  = Math.floor(Math.random() * 0x7fffffff);
    cert.notBefore     = Date.now();
    cert.notAfter      = cert.notBefore + (opts.validityDays ?? 365) * 24 * 3600 * 1000;
    cert.selfSigned    = !ca;
    cert.isCA          = opts.isCA ?? false;
    cert.hasPrivateKey = true;
    cert.chain         = ca ? [ca, ...ca.chain] : [];
    cert.privateKey    = keyPair.privateKey;
    cert.publicKey     = keyPair.publicKey;
    cert.publicKeyRaw  = pubRaw;

    // Sign TBS with own key (self-signed) or with CA key
    const signingKey = ca?.privateKey ?? keyPair.privateKey;
    const sigBuf = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, signingKey, /** @type {Uint8Array<ArrayBuffer>} */ (cert._buildTbsBytes()),
    );
    cert.certSignature = new Uint8Array(sigBuf);

    return cert;
  }

  /**
   * Re-sign an existing certificate under a new CA.
   * Subject and key pair are preserved; issuer, chain and certSignature are replaced.
   * @param {TlsCertificate} cert
   * @param {TlsCertificate} ca
   * @param {{ validityDays?: number }} [opts]
   * @returns {Promise<TlsCertificate>}
   */
  static async sign(cert, ca, opts = {}) {
    const signed = new TlsCertificate();
    signed.subject       = cert.subject;
    signed.issuer        = ca.subject;
    signed.publicKeyId   = cert.publicKeyId;
    signed.serialNumber  = Math.floor(Math.random() * 0x7fffffff);
    signed.notBefore     = Date.now();
    signed.notAfter      = signed.notBefore + (opts.validityDays ?? 365) * 24 * 3600 * 1000;
    signed.selfSigned    = false;
    signed.isCA          = cert.isCA;
    signed.hasPrivateKey = cert.hasPrivateKey;
    signed.chain         = [ca, ...ca.chain];
    signed.privateKey    = cert.privateKey;
    signed.publicKey     = cert.publicKey;
    signed.publicKeyRaw  = cert.publicKeyRaw;

    // Sign TBS with CA's private key (if available)
    if (ca.privateKey) {
      const sigBuf = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" }, ca.privateKey, /** @type {Uint8Array<ArrayBuffer>} */ (signed._buildTbsBytes()),
      );
      signed.certSignature = new Uint8Array(sigBuf);
    }

    return signed;
  }

  // ── serialization ─────────────────────────────────────────────────────────

  /**
   * Build the DER-encoded Certificate.
   * Uses the stored certSignature if available; falls back to a zero placeholder.
   * @returns {Uint8Array}
   */
  toDer() {
    const tbs = this._buildTbsBytes();
    const sigAlg = derTag(0x30, concatBytes(
      derTag(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])),
    ));
    // P1363 ECDSA sig (64 bytes) wrapped in BIT STRING with leading 0x00 (unused bits)
    const sigContent = this.certSignature
      ? concatBytes(new Uint8Array([0x00]), this.certSignature)
      : new Uint8Array(72); // zero placeholder for certs without a real signature
    const sig = derTag(0x03, sigContent);
    return derTag(0x30, concatBytes(tbs, sigAlg, sig));
  }

  /**
   * Sync serialization — includes publicKeyRaw as hex but NO private key.
   * Used for chain embedding, display, and trust store writes.
   * Use toSaveData() for full file persistence.
   * @returns {object}
   */
  toJSON() {
    return {
      subject:           this.subject,
      issuer:            this.issuer,
      publicKeyId:       this.publicKeyId,
      publicKeyRaw:      this.publicKeyRaw      ? bytesToHex(this.publicKeyRaw)      : null,
      certSignatureHex:  this.certSignature     ? bytesToHex(this.certSignature)     : null,
      serialNumber:      this.serialNumber,
      notBefore:         this.notBefore,
      notAfter:          this.notAfter,
      selfSigned:        this.selfSigned,
      isCA:              this.isCA,
      hasPrivateKey:     this.hasPrivateKey,
      chain:             this.chain.map(c => c.toJSON()),
    };
  }

  /**
   * Full async serialization for file persistence — includes JWK key material.
   * @returns {Promise<object>}
   */
  async toSaveData() {
    const obj = /** @type {any} */ (this.toJSON());
    if (this.privateKey) {
      obj.privateKeyJwk = await crypto.subtle.exportKey("jwk", this.privateKey);
    }
    if (this.publicKey) {
      obj.publicKeyJwk = await crypto.subtle.exportKey("jwk", this.publicKey);
    }
    return obj;
  }

  /**
   * @param {any} obj
   * @returns {Promise<TlsCertificate>}
   */
  static async fromJSON(obj) {
    const cert = new TlsCertificate();
    cert.subject      = String(obj.subject      ?? "");
    cert.issuer       = String(obj.issuer       ?? "");
    cert.publicKeyId  = String(obj.publicKeyId  ?? "");
    cert.serialNumber = Number(obj.serialNumber ?? 1);
    cert.notBefore    = Number(obj.notBefore    ?? 0);
    cert.notAfter     = Number(obj.notAfter     ?? 0);
    cert.selfSigned   = Boolean(obj.selfSigned  ?? true);
    cert.isCA         = Boolean(obj.isCA        ?? false);
    cert.chain        = Array.isArray(obj.chain)
      ? await Promise.all(obj.chain.map((/** @type {any} */ c) => TlsCertificate.fromJSON(c)))
      : [];

    // Restore certSignature
    if (obj.certSignatureHex) {
      try { cert.certSignature = hexToBytes(String(obj.certSignatureHex)); } catch { /* skip */ }
    }

    // Restore public key from raw bytes or JWK
    if (obj.publicKeyRaw) {
      try {
        cert.publicKeyRaw = hexToBytes(String(obj.publicKeyRaw));
        cert.publicKey = await crypto.subtle.importKey(
          "raw", /** @type {Uint8Array<ArrayBuffer>} */ (cert.publicKeyRaw),
          { name: "ECDSA", namedCurve: "P-256" },
          true, ["verify"],
        );
      } catch { /* skip if invalid */ }
    } else if (obj.publicKeyJwk) {
      try {
        cert.publicKey = await crypto.subtle.importKey(
          "jwk", obj.publicKeyJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          true, ["verify"],
        );
        cert.publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", cert.publicKey));
      } catch { /* skip if invalid */ }
    }

    // Restore private key from JWK (only present in files saved with toSaveData)
    if (obj.privateKeyJwk) {
      try {
        cert.privateKey = await crypto.subtle.importKey(
          "jwk", obj.privateKeyJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          true, ["sign"],
        );
        cert.hasPrivateKey = true;
      } catch { /* skip if invalid */ }
    } else {
      cert.hasPrivateKey = Boolean(obj.hasPrivateKey ?? false);
    }

    return cert;
  }

  /**
   * Short hex fingerprint derived from publicKeyId.
   * @returns {string}
   */
  fingerprint() {
    return this.publicKeyId.slice(0, 20).toUpperCase()
      .match(/.{2}/g)?.join(":") ?? this.publicKeyId;
  }
}

// ── TlsTrustStore ──────────────────────────────────────────────────────────

export class TlsTrustStore {
  /** @type {TlsCertificate[]} */
  trustedCAs = [];

  /**
   * Chain-walking trust check.
   * Trusted if cert itself is in the store, or if its issuer is trusted (recursively).
   * @param {TlsCertificate} cert
   * @param {TlsCertificate[]} [extraChain]
   * @returns {boolean}
   */
  isTrusted(cert, extraChain = []) {
    if (this.trustedCAs.some(ca => ca.subject === cert.subject)) return true;
    if (cert.selfSigned) return false;
    const pool = [...cert.chain, ...extraChain];
    const issuer = pool.find(c => c.subject === cert.issuer && c.subject !== cert.subject);
    if (!issuer) return false;
    return this.isTrusted(issuer, pool);
  }

  /** @param {TlsCertificate} cert */
  add(cert) {
    if (!this.trustedCAs.some(c => c.subject === cert.subject)) {
      this.trustedCAs.push(cert);
    }
  }

  /** @param {string} subject */
  remove(subject) {
    this.trustedCAs = this.trustedCAs.filter(c => c.subject !== subject);
  }
}
