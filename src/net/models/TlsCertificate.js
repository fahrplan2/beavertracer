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

/** @param {number} bytes */
function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── TlsCertificate ─────────────────────────────────────────────────────────

export class TlsCertificate {
  /** @type {string} e.g. "CN=server.local" */
  subject = "";

  /** @type {string} same as subject for self-signed */
  issuer = "";

  /** @type {string} symbolic 32-char hex string */
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

  /** @type {TlsCertificate[]} – signing chain (CA cert + its ancestors), leaf-exclusive */
  chain = [];

  /**
   * Generate a self-signed (or CA-signed) certificate.
   * @param {string} cn
   * @param {TlsCertificate|null} [ca]
   * @param {{ isCA?: boolean, validityDays?: number }} [opts]
   * @returns {TlsCertificate}
   */
  static generate(cn, ca = null, opts = {}) {
    const cert = new TlsCertificate();
    cert.subject      = `CN=${cn}`;
    cert.issuer       = ca ? ca.subject : `CN=${cn}`;
    cert.publicKeyId  = randomHex(16);
    cert.serialNumber = Math.floor(Math.random() * 0x7fffffff);
    cert.notBefore    = Date.now();
    cert.notAfter     = cert.notBefore + (opts.validityDays ?? 365) * 24 * 3600 * 1000;
    cert.selfSigned   = !ca;
    cert.isCA         = opts.isCA ?? false;
    cert.chain        = ca ? [ca, ...ca.chain] : [];
    return cert;
  }

  /**
   * Re-sign an existing certificate under a new CA.
   * The subject and publicKeyId are preserved; issuer and chain are replaced.
   * @param {TlsCertificate} cert
   * @param {TlsCertificate} ca
   * @param {{ validityDays?: number }} [opts]
   * @returns {TlsCertificate}
   */
  static sign(cert, ca, opts = {}) {
    const signed = new TlsCertificate();
    signed.subject      = cert.subject;
    signed.issuer       = ca.subject;
    signed.publicKeyId  = cert.publicKeyId;
    signed.serialNumber = Math.floor(Math.random() * 0x7fffffff);
    signed.notBefore    = Date.now();
    signed.notAfter     = signed.notBefore + (opts.validityDays ?? 365) * 24 * 3600 * 1000;
    signed.selfSigned   = false;
    signed.isCA         = cert.isCA;
    signed.chain        = [ca, ...ca.chain];
    return signed;
  }

  /**
   * Minimal DER blob — syntactically plausible ASN.1 SEQUENCE so Wireshark
   * shows "Certificate" rather than a raw byte dump.
   * Not a valid X.509 signature, but structurally correct enough for
   * educational visualization.
   * @returns {Uint8Array}
   */
  toDer() {
    // tbsCertificate fields
    const serial    = derTag(0x02, new Uint8Array([this.serialNumber & 0x7f]));
    const algId     = derTag(0x30, concatBytes(
      // ecPublicKey OID: 1.2.840.10045.2.1
      derTag(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])),
      // secp256r1 OID: 1.2.840.10045.3.1.7
      derTag(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07])),
    ));

    const subjectDn = derTag(0x30, derTag(0x31, derTag(0x30, concatBytes(
      // commonName OID: 2.5.4.3
      derTag(0x06, new Uint8Array([0x55, 0x04, 0x03])),
      derUtf8String(this.subject.replace(/^CN=/, "")),
    ))));

    const issuerDn  = derTag(0x30, derTag(0x31, derTag(0x30, concatBytes(
      derTag(0x06, new Uint8Array([0x55, 0x04, 0x03])),
      derUtf8String(this.issuer.replace(/^CN=/, "")),
    ))));

    // Symbolic 65-byte public key (uncompressed EC point placeholder)
    const pubKeyBytes = new Uint8Array(65);
    pubKeyBytes[0] = 0x04;
    const pkIdBytes = new TextEncoder().encode(this.publicKeyId);
    pubKeyBytes.set(pkIdBytes.slice(0, Math.min(pkIdBytes.length, 64)), 1);

    const subjectPKI = derTag(0x30, concatBytes(
      algId,
      derTag(0x03, concatBytes(new Uint8Array([0x00]), pubKeyBytes)),
    ));

    const tbs = derTag(0x30, concatBytes(
      serial, algId, issuerDn, subjectDn, subjectPKI,
    ));

    // signatureAlgorithm + signature (symbolic)
    const sigAlg = derTag(0x30, concatBytes(
      derTag(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])),
    ));
    const sig = derTag(0x03, new Uint8Array(72)); // 72-byte placeholder

    return derTag(0x30, concatBytes(tbs, sigAlg, sig));
  }

  /** @returns {object} */
  toJSON() {
    return {
      subject:      this.subject,
      issuer:       this.issuer,
      publicKeyId:  this.publicKeyId,
      serialNumber: this.serialNumber,
      notBefore:    this.notBefore,
      notAfter:     this.notAfter,
      selfSigned:   this.selfSigned,
      isCA:         this.isCA,
      chain:        this.chain.map(c => c.toJSON()),
    };
  }

  /**
   * @param {any} obj
   * @returns {TlsCertificate}
   */
  static fromJSON(obj) {
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
      ? obj.chain.map((/** @type {any} */ c) => TlsCertificate.fromJSON(c))
      : [];
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
   * @param {TlsCertificate[]} [extraChain] - additional chain certs received over the wire
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
