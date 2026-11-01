//@ts-check

import {
  TlsRecord, TLS_CT, TLS_HT, TLS_EXT, TlsDecodeError, encodeAlpn, decodeAlpn,
  TLS_CIPHER, TLS_VERSION, GROUP_SECP256R1, SIG_ECDSA_P256_SHA256, DOWNGRADE_TLS12, HRR_RANDOM,
} from "./pdu/TlsRecord.js";
import { TlsCertificate, TlsTrustStore } from "./models/TlsCertificate.js";
import { encodeUTF8 } from "../lib/helpers.js";

// ── error types ────────────────────────────────────────────────────────────

/** TLS AlertDescription values used by this implementation (RFC 5246 §7.2, RFC 6066 §3). */
export const TLS_ALERT = Object.freeze({
  CLOSE_NOTIFY: 0,
  UNEXPECTED_MESSAGE: 10,
  PROTOCOL_VERSION: 70,
  HANDSHAKE_FAILURE: 40,
  BAD_CERTIFICATE: 42,
  DECODE_ERROR: 50,
  DECRYPT_ERROR: 51,
  ILLEGAL_PARAMETER: 47,
  UNSUPPORTED_EXTENSION: 110,
  UNRECOGNIZED_NAME: 112,
  NO_APPLICATION_PROTOCOL: 120,
});

/** Readable names for AlertDescription codes (RFC 5246 §7.2, RFC 6066 §3). */
const TLS_ALERT_NAMES = Object.freeze({
  0: "close_notify", 10: "unexpected_message", 20: "bad_record_mac",
  22: "record_overflow", 40: "handshake_failure", 42: "bad_certificate",
  43: "unsupported_certificate", 44: "certificate_revoked", 45: "certificate_expired",
  46: "certificate_unknown", 47: "illegal_parameter", 48: "unknown_ca",
  49: "access_denied", 50: "decode_error", 51: "decrypt_error",
  70: "protocol_version", 71: "insufficient_security", 80: "internal_error",
  90: "user_canceled", 110: "unsupported_extension", 112: "unrecognized_name",
  120: "no_application_protocol",
});

/** @param {number} code */
export function tlsAlertName(code) {
  return /** @type {Record<number, string>} */ (TLS_ALERT_NAMES)[code] ?? `alert_${code}`;
}

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

/**
 * The peer aborted the handshake with an alert. Unlike other handshake
 * errors this one is never answered with an alert of our own (RFC 5246
 * §7.2.2: both sides just close the connection).
 */
export class TlsAlertReceivedError extends TlsHandshakeError {
  /**
   * @param {number} level 1 = warning, 2 = fatal
   * @param {number} description AlertDescription code
   */
  constructor(level, description) {
    super(description === TLS_ALERT.CLOSE_NOTIFY
      ? "Peer closed the connection during the handshake (close_notify)"
      : `Peer aborted the handshake: ${tlsAlertName(description)} (${description})`, description);
    this.name = "TlsAlertReceivedError";
    this.level = level;
    this.description = description;
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

// ── TLS 1.3 key schedule (RFC 8446 §7.1) and ECDSA encoding ─────────────────

/** @param {Uint8Array} data */
async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", /** @type {Uint8Array<ArrayBuffer>} */ (data)));
}

/** @param {Uint8Array} key @param {Uint8Array} data */
async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey("raw", /** @type {Uint8Array<ArrayBuffer>} */ (key.length ? key : new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, /** @type {Uint8Array<ArrayBuffer>} */ (data)));
}

/** HKDF-Extract (RFC 5869 §2.2). @param {Uint8Array} salt @param {Uint8Array} ikm */
export function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}

/** HKDF-Expand (RFC 5869 §2.3). @param {Uint8Array} prk @param {Uint8Array} info @param {number} length */
export async function hkdfExpand(prk, info, length) {
  const out = new Uint8Array(length);
  let t = new Uint8Array(0);
  for (let i = 1, off = 0; off < length; i++) {
    t = await hmacSha256(prk, concat(t, info, Uint8Array.of(i)));
    out.set(t.subarray(0, Math.min(t.length, length - off)), off);
    off += t.length;
  }
  return out;
}

/**
 * HKDF-Expand-Label (RFC 8446 §7.1): info = length || "tls13 " + label || context.
 * @param {Uint8Array} secret @param {string} label @param {Uint8Array} context @param {number} length
 */
export function hkdfExpandLabel(secret, label, context, length) {
  const l = new TextEncoder().encode("tls13 " + label);
  const info = concat(Uint8Array.of((length >>> 8) & 0xff, length & 0xff, l.length), l, Uint8Array.of(context.length), context);
  return hkdfExpand(secret, info, length);
}

/** Derive-Secret with an already computed transcript hash. @param {Uint8Array} secret @param {string} label @param {Uint8Array} hash */
function deriveSecret(secret, label, hash) {
  return hkdfExpandLabel(secret, label, hash, 32);
}

const EMPTY_HASH_PROMISE = sha256(new Uint8Array(0));

/** @param {Uint8Array} b */
function trimInt(b) {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const v = b.subarray(i);
  return v[0] & 0x80 ? concat(Uint8Array.of(0), v) : v;
}

/**
 * WebCrypto ECDSA signature (r || s, 64 bytes) -> DER Ecdsa-Sig-Value, as
 * TLS carries it on the wire (RFC 8446 §4.2.3, RFC 8422 §5.4).
 * @param {Uint8Array} raw
 */
export function ecdsaRawToDer(raw) {
  const r = trimInt(raw.subarray(0, 32)), s = trimInt(raw.subarray(32, 64));
  const seq = concat(Uint8Array.of(0x02, r.length), r, Uint8Array.of(0x02, s.length), s);
  return concat(Uint8Array.of(0x30, seq.length), seq);
}

/**
 * DER Ecdsa-Sig-Value -> r || s (64 bytes) for WebCrypto. A 64-byte input
 * is taken as raw already (older BeaverTracer peers sent that).
 * @param {Uint8Array} sig
 * @returns {Uint8Array|null}
 */
export function ecdsaDerToRaw(sig) {
  if (sig.length === 64 && sig[0] !== 0x30) return sig;
  if (sig.length < 8 || sig[0] !== 0x30 || sig[1] !== sig.length - 2) return sig.length === 64 ? sig : null;
  let off = 2;
  const out = new Uint8Array(64);
  for (const at of [0, 32]) {
    if (sig[off] !== 0x02) return null;
    const len = sig[off + 1];
    let v = sig.subarray(off + 2, off + 2 + len);
    off += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    if (v.length > 32) return null;
    out.set(v, at + 32 - v.length);
  }
  return off === sig.length ? out : null;
}

/** Content signed in a TLS 1.3 CertificateVerify (RFC 8446 §4.4.3). @param {"server"|"client"} who @param {Uint8Array} hash */
function certVerifyContent(who, hash) {
  return concat(new Uint8Array(64).fill(0x20), new TextEncoder().encode(`TLS 1.3, ${who} CertificateVerify`), Uint8Array.of(0), hash);
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
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
 * Validity time to epoch ms: the simulator writes decimal epoch-ms; real
 * X.509 uses UTCTime "YYMMDDHHMMSSZ" or GeneralizedTime "YYYYMMDDHHMMSSZ"
 * (RFC 5280 §4.1.2.5).
 * @param {string} s
 */
function derTimeMs(s) {
  const m = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return Number(s);
  let year = Number(m[1]);
  if (m[1].length === 2) year += year >= 50 ? 1900 : 2000;
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
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
    const notBefore = derTimeMs(dec.decode(certDer.slice(nb.contentStart, nb.end)));
    const notAfter  = derTimeMs(dec.decode(certDer.slice(na.contentStart, na.end)));
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
 * TLS session (1.2: RFC 5246/5288, 1.3: RFC 8446) — works over any
 * bidirectional byte stream. TLS 1.3 is 1-RTT with secp256r1 and
 * TLS_AES_128_GCM_SHA256; no HelloRetryRequest, PSK/resumption, 0-RTT,
 * KeyUpdate or client certificates.
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
   *   selectCert?: (sni: string) => TlsCertificate|null,
   *   alpn?: string[],
   *   versions?: Array<"1.2"|"1.3">,
   * }} opts
   */
  constructor({ send, recv, isServer, cert, trustStore, timeoutMs = 400, sleepFn, now, serverName, selectCert, alpn, versions }) {
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
    // Server side, name-based virtual hosting: picks the certificate from the
    // ClientHello's server_name ("" when the client sent none). Takes
    // precedence over `cert`; returning null aborts with unrecognized_name.
    this._selectCert = selectCert ?? null;
    /** Server side: host_name from the client's SNI extension, "" if absent. */
    this.sni = "";
    // ALPN (RFC 7301): client side the offered protocols (most preferred
    // first), server side the supported ones in the server's preference order.
    this._alpnList = alpn ?? [];
    /** Negotiated application protocol ("h2", "http/1.1"), "" without ALPN. */
    this.alpn = "";
    // Protocol versions: a client offers TLS 1.3 next to 1.2 by default (like
    // real clients); a server speaks 1.2 unless 1.3 is switched on.
    this._versions = versions ?? (isServer ? ["1.2"] : ["1.3", "1.2"]);
    /** Negotiated version, "TLS 1.2" or "TLS 1.3" ("" before the handshake). */
    this.version = "";
    // TLS 1.3 state
    this._v13 = false;
    /** Handshake bytes not yet forming a complete message (TLS 1.3 flights). */
    this._hsBuf = new Uint8Array(0);
    /** @type {Uint8Array} */ this._legacySessionId = new Uint8Array(0);
    /** @type {Uint8Array|null} */ this._hsSecretC = null;
    /** @type {Uint8Array|null} */ this._hsSecretS = null;

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

  /** IANA name of the negotiated cipher suite ("" before the handshake). */
  get cipherSuite() {
    return this.version === "TLS 1.3" ? "TLS_AES_128_GCM_SHA256"
      : this.version === "TLS 1.2" ? "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256" : "";
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
      if (e instanceof TlsHandshakeError && !(e instanceof TlsAlertReceivedError)) {
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
    if (this._v13) return this._encryptRecord13(contentType, plaintext, seq);
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
    if (this._v13) return this._decryptRecord13(record);
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

  // ── TLS 1.3 record protection (RFC 8446 §5.2, §5.3) ────────────────────────

  /** Per-record nonce: static IV XOR 64-bit sequence number. @param {Uint8Array} iv @param {number} seq */
  _nonce13(iv, seq) {
    const n = iv.slice();
    const sb = seqToBytes8(seq);
    for (let i = 0; i < 8; i++) n[4 + i] ^= sb[i];
    return n;
  }

  /**
   * TLSInnerPlaintext = content || real type; the outer record always says
   * application_data, the AAD is the record header.
   * @param {number} contentType @param {Uint8Array} plaintext @param {number} seq
   */
  async _encryptRecord13(contentType, plaintext, seq) {
    const inner = concat(plaintext, Uint8Array.of(contentType));
    const len = inner.length + 16;
    const aad = Uint8Array.of(TLS_CT.APP_DATA, 0x03, 0x03, (len >>> 8) & 0xff, len & 0xff);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: /** @type {Uint8Array<ArrayBuffer>} */ (this._nonce13(/** @type {Uint8Array} */ (this._encryptFixedIV), seq)), additionalData: aad },
      /** @type {CryptoKey} */ (this._encryptKey),
      /** @type {Uint8Array<ArrayBuffer>} */ (inner),
    );
    return new TlsRecord(TLS_CT.APP_DATA, new Uint8Array(cipher)).pack();
  }

  /** @param {TlsRecord} record */
  async _decryptRecord13(record) {
    if (record.contentType !== TLS_CT.APP_DATA) {
      throw new TlsHandshakeError("Unprotected record after key exchange", TLS_ALERT.UNEXPECTED_MESSAGE);
    }
    if (record.payload.length < 17) throw new TlsHandshakeError("Protected record too short", TLS_ALERT.DECODE_ERROR);
    const len = record.payload.length;
    const aad = Uint8Array.of(TLS_CT.APP_DATA, 0x03, 0x03, (len >>> 8) & 0xff, len & 0xff);
    const seq = this._recvSeq++;
    let plain;
    try {
      plain = new Uint8Array(await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: /** @type {Uint8Array<ArrayBuffer>} */ (this._nonce13(/** @type {Uint8Array} */ (this._decryptFixedIV), seq)), additionalData: aad },
        /** @type {CryptoKey} */ (this._decryptKey),
        /** @type {Uint8Array<ArrayBuffer>} */ (record.payload),
      ));
    } catch {
      throw new TlsHandshakeError("Record authentication failed (bad_record_mac)", 20);
    }
    // strip zero padding; the last non-zero byte is the real content type
    let end = plain.length - 1;
    while (end >= 0 && plain[end] === 0) end--;
    if (end < 0) throw new TlsHandshakeError("Inner plaintext without content type", TLS_ALERT.UNEXPECTED_MESSAGE);
    return new TlsRecord(plain[end], plain.slice(0, end));
  }

  /**
   * Install traffic keys derived from a TLS 1.3 traffic secret (§7.3); the
   * sequence number of that direction starts again at 0.
   * @param {"read"|"write"} dir @param {Uint8Array} secret
   */
  async _install13(dir, secret) {
    const keyBytes = await hkdfExpandLabel(secret, "key", new Uint8Array(0), 16);
    const iv = await hkdfExpandLabel(secret, "iv", new Uint8Array(0), 12);
    const key = await crypto.subtle.importKey("raw", /** @type {Uint8Array<ArrayBuffer>} */ (keyBytes), { name: "AES-GCM" }, false,
      [dir === "write" ? "encrypt" : "decrypt"]);
    if (dir === "write") {
      await this._writeChain;  // earlier records keep the old keys
      this._encryptKey = key; this._encryptFixedIV = iv; this._sendSeq = 0; this._writeCipherActive = true;
    } else {
      this._decryptKey = key; this._decryptFixedIV = iv; this._recvSeq = 0; this._readCipherActive = true;
    }
  }

  /**
   * Key schedule up to the handshake traffic secrets (§7.1), from the ECDHE
   * shared secret and the transcript ClientHello..ServerHello.
   * @param {Uint8Array} shared
   */
  async _deriveHandshake13(shared) {
    const zeros = new Uint8Array(32);
    const early = await hkdfExtract(zeros, zeros);
    const derived = await deriveSecret(early, "derived", await EMPTY_HASH_PROMISE);
    const hs = await hkdfExtract(derived, shared);
    const th = await sha256(this._transcript);
    this._hsSecretC = await deriveSecret(hs, "c hs traffic", th);
    this._hsSecretS = await deriveSecret(hs, "s hs traffic", th);
    const derived2 = await deriveSecret(hs, "derived", await EMPTY_HASH_PROMISE);
    this._masterSecret = await hkdfExtract(derived2, zeros);
  }

  /** Application traffic secrets from the transcript up to the server Finished. */
  async _deriveApplication13() {
    const th = await sha256(this._transcript);
    const master = /** @type {Uint8Array} */ (this._masterSecret);
    return {
      client: await deriveSecret(master, "c ap traffic", th),
      server: await deriveSecret(master, "s ap traffic", th),
    };
  }

  /** Finished verify_data (§4.4.4) over the current transcript. @param {Uint8Array} baseKey */
  async _finished13(baseKey) {
    const finishedKey = await hkdfExpandLabel(baseKey, "finished", new Uint8Array(0), 32);
    return hmacSha256(finishedKey, await sha256(this._transcript));
  }

  /**
   * Next handshake message of a TLS 1.3 flight. Messages may share a record
   * or span several; ChangeCipherSpec records (middlebox compatibility,
   * §D.4) are skipped. The message is appended to the transcript.
   * @returns {Promise<{ type: number, body: Uint8Array }>}
   */
  async _nextHs13() {
    while (true) {
      if (this._hsBuf.length >= 4) {
        const len = (this._hsBuf[1] << 16) | (this._hsBuf[2] << 8) | this._hsBuf[3];
        if (this._hsBuf.length >= 4 + len) {
          const raw = this._hsBuf.slice(0, 4 + len);
          this._hsBuf = this._hsBuf.slice(4 + len);
          this._appendTranscript(raw);
          return { type: raw[0], body: raw.slice(4) };
        }
      }
      const rec = await this._readRecordTimeout();
      if (rec === null) throw new TlsHandshakeError("Connection closed during handshake");
      if (rec.contentType === TLS_CT.CHANGE_CIPHER_SPEC) continue;
      if (rec.contentType !== TLS_CT.HANDSHAKE) {
        throw new TlsHandshakeError("Unexpected record during handshake", TLS_ALERT.UNEXPECTED_MESSAGE);
      }
      this._hsBuf = concat(this._hsBuf, rec.payload);
    }
  }

  /** @param {number} type */
  async _expectHs13(type) {
    const m = await this._nextHs13();
    if (m.type !== type) throw new TlsHandshakeError(`Unexpected handshake message ${m.type}`, TLS_ALERT.UNEXPECTED_MESSAGE);
    return m;
  }

  /**
   * Certificate checks shared by TLS 1.2 and 1.3: validity on the host's
   * clock, trust chain, name. Only with a trust store (curl -k skips them).
   * @param {TlsCertificate|null} peerCert
   */
  async _checkPeerCert(peerCert) {
    if (!peerCert || !this._trustStore) return;
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

  /** @returns {Promise<Uint8Array>} our ECDH public key as uncompressed point */
  async _ownEcdhPub() {
    return new Uint8Array(await crypto.subtle.exportKey("raw", /** @type {CryptoKeyPair} */ (this._ecdhKeyPair).publicKey));
  }

  /** @param {Uint8Array} peerPub */
  async _ecdhShared(peerPub) {
    let key;
    try {
      key = await importEcdhPubKey(/** @type {Uint8Array<ArrayBuffer>} */ (peerPub));
    } catch {
      throw new TlsHandshakeError("Invalid key share", TLS_ALERT.ILLEGAL_PARAMETER);
    }
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: "ECDH", public: key }, /** @type {CryptoKeyPair} */ (this._ecdhKeyPair).privateKey, 256));
  }

  /**
   * Client side of the TLS 1.3 handshake after the ServerHello (§2, 1-RTT):
   * read EncryptedExtensions, Certificate, CertificateVerify, Finished under
   * the server handshake key, answer with Finished, switch to traffic keys.
   * @param {{ random: Uint8Array, sessionId: Uint8Array, cipherSuite: number, extensions: Map<number, Uint8Array> }} sh
   */
  async _clientHandshake13(sh) {
    this._v13 = true;
    this.version = "TLS 1.3";
    if (bytesEqual(sh.random, HRR_RANDOM)) {
      throw new TlsHandshakeError("HelloRetryRequest is not supported", TLS_ALERT.HANDSHAKE_FAILURE);
    }
    if (sh.cipherSuite !== TLS_CIPHER.TLS_AES_128_GCM_SHA256) {
      throw new TlsHandshakeError("Server chose a cipher suite we did not offer", TLS_ALERT.ILLEGAL_PARAMETER);
    }
    if (!bytesEqual(sh.sessionId, this._legacySessionId)) {
      throw new TlsHandshakeError("legacy_session_id not echoed", TLS_ALERT.ILLEGAL_PARAMETER);
    }
    const ks = sh.extensions.get(TLS_EXT.KEY_SHARE);
    if (!ks || ks.length < 4 || ((ks[0] << 8) | ks[1]) !== GROUP_SECP256R1 || ((ks[2] << 8) | ks[3]) !== ks.length - 4) {
      throw new TlsHandshakeError("ServerHello key_share missing or not secp256r1", TLS_ALERT.ILLEGAL_PARAMETER);
    }
    await this._deriveHandshake13(await this._ecdhShared(ks.slice(4)));
    await this._install13("read", /** @type {Uint8Array} */ (this._hsSecretS));
    await this._install13("write", /** @type {Uint8Array} */ (this._hsSecretC));

    // EncryptedExtensions: everything not needed for the key exchange (§4.3.1)
    const ee = await this._expectHs13(TLS_HT.ENCRYPTED_EXTENSIONS);
    /** @type {Map<number, Uint8Array>} */
    const eeExts = new Map();
    for (let off = 2; off + 4 <= ee.body.length;) {
      const type = (ee.body[off] << 8) | ee.body[off + 1];
      const len = (ee.body[off + 2] << 8) | ee.body[off + 3];
      eeExts.set(type, ee.body.slice(off + 4, off + 4 + len));
      off += 4 + len;
    }
    this._acceptAlpnExtension(eeExts.get(TLS_EXT.ALPN));

    const certMsg = await this._nextHs13();
    if (certMsg.type !== TLS_HT.CERTIFICATE) {
      throw new TlsHandshakeError(certMsg.type === 13
        ? "Client certificates are not supported"
        : "Server sent no certificate", TLS_ALERT.HANDSHAKE_FAILURE);
    }
    let certList;
    try { certList = TlsRecord.certificate13To12(certMsg.body); } catch (e) {
      throw new TlsHandshakeError(e instanceof Error ? e.message : String(e), TLS_ALERT.DECODE_ERROR);
    }
    const peerCert = await this._parseCertFromMessage(/** @type {Uint8Array<ArrayBuffer>} */ (certList));
    this.peerCert = peerCert;
    await this._checkPeerCert(peerCert);
    if (!peerCert?.publicKey) throw new TlsMissingAuthError("certificate");
    const thCert = await sha256(this._transcript);

    // CertificateVerify: proof of possession of the certificate key
    const cv = await this._expectHs13(TLS_HT.CERTIFICATE_VERIFY);
    const scheme = (cv.body[0] << 8) | cv.body[1];
    const sigLen = (cv.body[2] << 8) | cv.body[3];
    const sig = scheme === SIG_ECDSA_P256_SHA256 ? ecdsaDerToRaw(cv.body.slice(4, 4 + sigLen)) : null;
    if (!sig) throw new TlsSignatureError();
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, peerCert.publicKey,
      /** @type {Uint8Array<ArrayBuffer>} */ (sig), /** @type {Uint8Array<ArrayBuffer>} */ (certVerifyContent("server", thCert)));
    if (!ok) throw new TlsSignatureError();

    const expected = await this._finished13(/** @type {Uint8Array} */ (this._hsSecretS));
    const fin = await this._expectHs13(TLS_HT.FINISHED);
    this._verifyFinished(/** @type {Uint8Array<ArrayBuffer>} */ (fin.body), expected);
    if (this._hsBuf.length) throw new TlsHandshakeError("Data after server Finished", TLS_ALERT.UNEXPECTED_MESSAGE);
    const app = await this._deriveApplication13();

    // our Finished, preceded by a compatibility ChangeCipherSpec (§D.4)
    this._sendRaw(TlsRecord.buildChangeCipherSpec());
    const myFin = this._buildHsBytes(TLS_HT.FINISHED, await this._finished13(/** @type {Uint8Array} */ (this._hsSecretC)));
    await this._sendRecord(TLS_CT.HANDSHAKE, myFin);
    this._appendTranscript(myFin);

    await this._install13("read", app.server);
    await this._install13("write", app.client);
  }

  /**
   * Server side of the TLS 1.3 handshake (§2, 1-RTT, no HelloRetryRequest).
   * @param {ReturnType<typeof TlsRecord.parseClientHello>} hello
   * @param {TlsCertificate} cert
   * @param {{ type: number, data: Uint8Array }[]} eeExtensions server_name ack / ALPN
   */
  async _serverHandshake13(hello, cert, eeExtensions) {
    this._v13 = true;
    this.version = "TLS 1.3";
    if (!hello.cipherSuites.includes(TLS_CIPHER.TLS_AES_128_GCM_SHA256)) {
      throw new TlsHandshakeError("No common TLS 1.3 cipher suite", TLS_ALERT.HANDSHAKE_FAILURE);
    }
    if (!hello.signatureAlgorithms.includes(SIG_ECDSA_P256_SHA256)) {
      throw new TlsHandshakeError("Client does not accept ecdsa_secp256r1_sha256", TLS_ALERT.HANDSHAKE_FAILURE);
    }
    const share = hello.keyShares.get(GROUP_SECP256R1);
    if (!share) {
      throw new TlsHandshakeError("No secp256r1 key share (HelloRetryRequest is not supported)", TLS_ALERT.HANDSHAKE_FAILURE);
    }

    this._ecdhKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const shared = await this._ecdhShared(share);
    this._serverRandom = crypto.getRandomValues(new Uint8Array(32));

    const sh = TlsRecord.buildServerHello13(this._serverRandom, hello.sessionId, await this._ownEcdhPub());
    this._sendRaw(TlsRecord.handshakeRecordOf(sh));
    this._appendTranscript(sh);
    await this._deriveHandshake13(shared);
    if (hello.sessionId.length > 0) this._sendRaw(TlsRecord.buildChangeCipherSpec()); // §D.4
    await this._install13("write", /** @type {Uint8Array} */ (this._hsSecretS));
    await this._install13("read", /** @type {Uint8Array} */ (this._hsSecretC));

    // encrypted flight: EncryptedExtensions, Certificate, CertificateVerify, Finished
    const send = async (/** @type {Uint8Array} */ msg) => {
      this._appendTranscript(msg);
      await this._sendRecord(TLS_CT.HANDSHAKE, msg);
    };
    await send(TlsRecord.buildEncryptedExtensions(eeExtensions));
    await send(TlsRecord.buildCertificate13([cert.toDer(), ...cert.chain.map(c => c.toDer())]));
    const sigRaw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, /** @type {CryptoKey} */ (cert.privateKey),
      /** @type {Uint8Array<ArrayBuffer>} */ (certVerifyContent("server", await sha256(this._transcript)))));
    await send(TlsRecord.buildCertificateVerify(ecdsaRawToDer(sigRaw)));
    await send(this._buildHsBytes(TLS_HT.FINISHED, await this._finished13(/** @type {Uint8Array} */ (this._hsSecretS))));

    const app = await this._deriveApplication13();
    const expected = await this._finished13(/** @type {Uint8Array} */ (this._hsSecretC));
    await this._install13("write", app.server);

    const fin = await this._expectHs13(TLS_HT.FINISHED);
    this._verifyFinished(/** @type {Uint8Array<ArrayBuffer>} */ (fin.body), expected);
    await this._install13("read", app.client);
  }

  // ── handshake – client side ───────────────────────────────────────────────

  async _clientHandshake() {
    this._transcript = new Uint8Array(0);

    // 1. Generate client random + ECDH keypair
    this._clientRandom = crypto.getRandomValues(new Uint8Array(32));
    this._ecdhKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
    );

    // 2. Send ClientHello, append HS bytes to transcript. Offering TLS 1.3
    //    adds our key share and a legacy_session_id (compatibility mode).
    const offer13 = this._versions.includes("1.3");
    if (offer13) this._legacySessionId = crypto.getRandomValues(new Uint8Array(32));
    const chRecord = TlsRecord.buildClientHello(this._clientRandom, this._serverName, this._alpnList,
      offer13 ? { keyShare: await this._ownEcdhPub(), sessionId: this._legacySessionId } : {});
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
          let sh;
          try { sh = TlsRecord.parseServerHello(msg.body); } catch (e) {
            throw new TlsHandshakeError(e instanceof Error ? e.message : String(e), TLS_ALERT.DECODE_ERROR);
          }
          // TLS 1.3 is selected by supported_versions, never by legacy_version (§4.2.1)
          const sv = sh.extensions.get(TLS_EXT.SUPPORTED_VERSIONS);
          if (sv) {
            if (!offer13 || sv.length !== 2 || ((sv[0] << 8) | sv[1]) !== TLS_VERSION.TLS13) {
              throw new TlsHandshakeError("Server selected an unoffered version", TLS_ALERT.ILLEGAL_PARAMETER);
            }
            return this._clientHandshake13(sh);
          }
          if (!this._versions.includes("1.2")) {
            throw new TlsHandshakeError("Server does not support TLS 1.3", TLS_ALERT.PROTOCOL_VERSION);
          }
          // downgrade protection (§4.1.3): a 1.3 server only picks 1.2 if we did not offer 1.3
          if (offer13 && bytesEqual(sh.random.slice(24), DOWNGRADE_TLS12)) {
            throw new TlsHandshakeError("Downgrade to TLS 1.2 detected", TLS_ALERT.ILLEGAL_PARAMETER);
          }
          this.version = "TLS 1.2";
          this._serverRandom = sh.random;
          this._acceptServerAlpn(msg.body);
        } else if (msg.type === TLS_HT.CERTIFICATE) {
          peerCert = await this._parseCertFromMessage(msg.body);
          this.peerCert = peerCert;
          await this._checkPeerCert(peerCert);
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
    // on the wire the signature is DER-encoded (RFC 8422 §5.4); WebCrypto wants r || s
    const rawSig = ecdsaDerToRaw(signature);
    if (!rawSig) throw new TlsSignatureError();
    const sigValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      peerCert.publicKey,
      /** @type {Uint8Array<ArrayBuffer>} */ (rawSig),
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

  /**
   * Client side: take the protocol the server selected via ALPN. It must be
   * exactly one of the protocols we offered (RFC 7301 §3.2).
   * @param {Uint8Array} shBody ServerHello body
   */
  _acceptServerAlpn(shBody) {
    let sh;
    try {
      sh = TlsRecord.parseServerHello(shBody);
    } catch (e) {
      if (e instanceof TlsDecodeError) throw new TlsHandshakeError(e.message, TLS_ALERT.DECODE_ERROR);
      throw e;
    }
    this._acceptAlpnExtension(sh.extensions.get(TLS_EXT.ALPN));
  }

  /**
   * Validate the server's ALPN answer (ServerHello in 1.2, EncryptedExtensions in 1.3).
   * @param {Uint8Array|undefined} ext
   */
  _acceptAlpnExtension(ext) {
    if (!ext) return;
    if (this._alpnList.length === 0) {
      throw new TlsHandshakeError("Server sent ALPN although none was offered", TLS_ALERT.UNSUPPORTED_EXTENSION);
    }
    let list;
    try { list = decodeAlpn(ext); } catch { throw new TlsHandshakeError("Malformed ALPN in ServerHello", TLS_ALERT.DECODE_ERROR); }
    if (list.length !== 1 || !this._alpnList.includes(list[0])) {
      throw new TlsHandshakeError(`Server selected unoffered protocol '${list.join(",")}'`, TLS_ALERT.ILLEGAL_PARAMETER);
    }
    this.alpn = list[0];
  }

  // ── handshake – server side ───────────────────────────────────────────────

  async _serverHandshake() {
    if (!this._cert && !this._selectCert) throw new TlsHandshakeError("Server cert required");

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
    let hello;
    try {
      hello = TlsRecord.parseClientHello(ch.body);
    } catch (e) {
      if (e instanceof TlsDecodeError) throw new TlsHandshakeError(e.message, TLS_ALERT.DECODE_ERROR);
      throw e;
    }
    this._clientRandom = hello.random;
    this.sni = hello.serverName;

    // Certificate selection by SNI (RFC 6066 §3) — must happen before the
    // Certificate message, which is why SNI exists: the Host header is not
    // readable yet at this point.
    /** @type {{ type: number, data: Uint8Array }[]} */
    const shExtensions = [];
    if (this._selectCert) {
      const chosen = this._selectCert(this.sni);
      if (!chosen) {
        throw new TlsHandshakeError(`No certificate for '${this.sni}'`, TLS_ALERT.UNRECOGNIZED_NAME);
      }
      this._cert = chosen;
      // The server used the name -> acknowledge with an empty server_name
      // extension. Only allowed when the client offered it (RFC 5246 §7.4.1.4).
      if (hello.extensions.has(TLS_EXT.SERVER_NAME)) {
        shExtensions.push({ type: TLS_EXT.SERVER_NAME, data: new Uint8Array(0) });
      }
    }
    const cert = /** @type {TlsCertificate} */ (this._cert);
    if (!cert.privateKey) throw new TlsHandshakeError("Server cert has no private key");

    // ALPN (RFC 7301 §3.2): the server picks by its own preference among the
    // client's offers; no overlap is fatal. A server without ALPN support
    // ignores the extension (the client then falls back to HTTP/1.1).
    if (hello.extensions.has(TLS_EXT.ALPN) && this._alpnList.length > 0) {
      const chosen = this._alpnList.find(p => hello.alpn.includes(p));
      if (!chosen) {
        throw new TlsHandshakeError(`No common application protocol (client offers ${hello.alpn.join(", ")})`,
          TLS_ALERT.NO_APPLICATION_PROTOCOL);
      }
      this.alpn = chosen;
      shExtensions.push({ type: TLS_EXT.ALPN, data: encodeAlpn([chosen]) });
    }

    // Version (RFC 8446 §4.2.1): TLS 1.3 when both sides support it; the
    // extensions chosen above then travel in EncryptedExtensions.
    const can13 = this._versions.includes("1.3");
    if (can13 && hello.versions.includes(TLS_VERSION.TLS13)) {
      return this._serverHandshake13(hello, cert, shExtensions);
    }
    if (!this._versions.includes("1.2")) {
      throw new TlsHandshakeError("Client does not support TLS 1.3", TLS_ALERT.PROTOCOL_VERSION);
    }
    this.version = "TLS 1.2";
    // Secure renegotiation (RFC 5746): we never renegotiate, but announce that
    // with an empty renegotiation_info when the client asks (extension or
    // TLS_EMPTY_RENEGOTIATION_INFO_SCSV) — OpenSSL refuses servers without it.
    if (hello.extensions.has(TLS_EXT.RENEGOTIATION_INFO) || hello.cipherSuites.includes(0x00FF)) {
      shExtensions.push({ type: TLS_EXT.RENEGOTIATION_INFO, data: Uint8Array.of(0) });
    }

    // 2. Generate server random + ECDH keypair. A TLS 1.3 capable server
    //    marks a 1.2 handshake in the random (downgrade protection, §4.1.3).
    this._serverRandom = crypto.getRandomValues(new Uint8Array(32));
    if (can13) this._serverRandom.set(DOWNGRADE_TLS12, 24);
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
      cert.privateKey,
      toSign,
    );
    const signature = ecdsaRawToDer(new Uint8Array(sigBuf)); // DER on the wire (RFC 8422 §5.4)

    // 4. Send ServerHello, Certificate, ServerKeyExchange, ServerHelloDone
    //    Append each HS message to transcript
    const sessionId = crypto.getRandomValues(new Uint8Array(4));
    const shRecord   = TlsRecord.buildServerHello(this._serverRandom, sessionId, shExtensions);
    const chainDers  = cert.chain.map(c => c.toDer());
    const certRecord = TlsRecord.buildCertificate([cert.toDer(), ...chainDers]);
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
      // TLS 1.2 switches the read keys here; in 1.3 it is a no-op (§D.4)
      if (this._decryptKey && !this._v13) { this._readCipherActive = true; this._recvSeq = 0; }
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
   * Next handshake-phase record, with a timeout. Alerts are consumed here:
   * a fatal one (or close_notify) aborts the handshake with
   * {@link TlsAlertReceivedError}, a warning is skipped.
   * Throws TlsHandshakeError on timeout.
   * @returns {Promise<TlsRecord|null>}
   */
  async _readRecordTimeout() {
    while (true) {
      const rec = await this._readOneRecordTimeout();
      if (rec === null || rec.contentType !== TLS_CT.ALERT) return rec;
      if (rec.payload.length !== 2) throw new TlsHandshakeError("Malformed alert", TLS_ALERT.DECODE_ERROR);
      const [level, description] = rec.payload;
      if (level === 2 || description === TLS_ALERT.CLOSE_NOTIFY) {
        throw new TlsAlertReceivedError(level, description);
      }
      // warning alert (e.g. unrecognized_name as warning, RFC 6066 §3): ignore
    }
  }

  /** @returns {Promise<TlsRecord|null>} */
  _readOneRecordTimeout() {
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
