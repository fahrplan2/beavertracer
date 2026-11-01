//@ts-check

import { read16BE, write16BE } from "../util/byteUtils.js";

export const TLS_CT = {
  CHANGE_CIPHER_SPEC: 0x14,
  ALERT:              0x15,
  HANDSHAKE:          0x16,
  APP_DATA:           0x17,
};

export const TLS_HT = {
  CLIENT_HELLO:       0x01,
  SERVER_HELLO:       0x02,
  NEW_SESSION_TICKET: 0x04, // TLS 1.3, post-handshake (ignored)
  ENCRYPTED_EXTENSIONS: 0x08, // TLS 1.3
  CERTIFICATE_VERIFY: 0x0F, // TLS 1.3
  KEY_UPDATE:         0x18, // TLS 1.3, post-handshake
  CERTIFICATE:        0x0B,
  SERVER_KEY_EXCHANGE:0x0C,
  SERVER_HELLO_DONE:  0x0E,
  CLIENT_KEY_EXCHANGE:0x10,
  FINISHED:           0x14,
};

/** Extension types used by this implementation (IANA TLS ExtensionType registry). */
export const TLS_EXT = Object.freeze({
  SERVER_NAME:          0x0000, // RFC 6066 §3
  SUPPORTED_GROUPS:     0x000A,
  EC_POINT_FORMATS:     0x000B,
  SIGNATURE_ALGORITHMS: 0x000D,
  ALPN:                 0x0010, // RFC 7301
  SUPPORTED_VERSIONS:   0x002B, // RFC 8446 §4.2.1
  KEY_SHARE:            0x0033, // RFC 8446 §4.2.8
  RENEGOTIATION_INFO:   0xFF01, // RFC 5746
});

/** Malformed handshake message — maps to the fatal decode_error alert. */
export class TlsDecodeError extends Error {
  /** @param {string} msg */
  constructor(msg) {
    super(msg);
    this.name = "TlsDecodeError";
  }
}

/**
 * Extract the host_name from a server_name extension body (RFC 6066 §3).
 * Returns "" when the list carries no host_name entry. The name is
 * normalised (lower case, no trailing dot) so callers can compare directly.
 * @param {Uint8Array} data
 */
function parseServerNameExtension(data) {
  if (data.length < 2) throw new TlsDecodeError("server_name extension truncated");
  const listLen = read16BE(data, 0);
  if (2 + listLen !== data.length) throw new TlsDecodeError("server_name list length mismatch");
  let off = 2;
  let hostName = "";
  while (off < data.length) {
    if (off + 3 > data.length) throw new TlsDecodeError("server_name entry truncated");
    const nameType = data[off];
    const len = read16BE(data, off + 1);
    off += 3;
    if (off + len > data.length) throw new TlsDecodeError("server_name entry truncated");
    // RFC 6066: at most one name per type; only host_name (0) is defined
    if (nameType === 0x00 && !hostName) {
      hostName = new TextDecoder().decode(data.slice(off, off + len));
    }
    off += len;
  }
  return hostName.toLowerCase().replace(/\.$/, "");
}

/**
 * Encode an ALPN extension body: ProtocolNameList (RFC 7301 §3.1).
 * @param {string[]} protocols e.g. ["h2", "http/1.1"]
 */
export function encodeAlpn(protocols) {
  const names = protocols.map(p => new TextEncoder().encode(p))
    .filter(n => n.length >= 1 && n.length <= 255);
  let total = 0;
  for (const n of names) total += 1 + n.length;
  const out = new Uint8Array(2 + total);
  write16BE(out, 0, total);
  let off = 2;
  for (const n of names) { out[off++] = n.length; out.set(n, off); off += n.length; }
  return out;
}

/**
 * Decode an ALPN extension body. Throws {@link TlsDecodeError} when malformed
 * (empty list, empty name, inconsistent lengths).
 * @param {Uint8Array} data
 * @returns {string[]}
 */
export function decodeAlpn(data) {
  if (data.length < 2) throw new TlsDecodeError("ALPN extension truncated");
  const listLen = read16BE(data, 0);
  if (listLen < 2 || 2 + listLen !== data.length) throw new TlsDecodeError("ALPN list length mismatch");
  /** @type {string[]} */
  const out = [];
  let off = 2;
  while (off < data.length) {
    const len = data[off++];
    if (len === 0 || off + len > data.length) throw new TlsDecodeError("ALPN protocol name malformed");
    out.push(new TextDecoder().decode(data.slice(off, off + len)));
    off += len;
  }
  return out;
}

// TLS 1.2 version (0x0303) used in record headers and Hello messages
const VER_MAJOR = 0x03;
const VER_MINOR = 0x03;

// TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
const CIPHER_HI = 0xC0;
const CIPHER_LO = 0x2B;

/** Cipher suites (IANA). */
export const TLS_CIPHER = Object.freeze({
  TLS_AES_128_GCM_SHA256: 0x1301,                   // TLS 1.3, mandatory (RFC 8446 §9.1)
  ECDHE_ECDSA_WITH_AES_128_GCM_SHA256: 0xC02B,      // TLS 1.2
});

/** Protocol version numbers on the wire. */
export const TLS_VERSION = Object.freeze({ TLS12: 0x0303, TLS13: 0x0304 });

/** secp256r1 (NamedGroup), the only key-exchange group used here. */
export const GROUP_SECP256R1 = 0x0017;

/** ecdsa_secp256r1_sha256 (SignatureScheme). */
export const SIG_ECDSA_P256_SHA256 = 0x0403;

/**
 * Last 8 bytes of ServerHello.random when a TLS 1.3 capable server
 * negotiates TLS 1.2 (RFC 8446 §4.1.3): "DOWNGRD" + 0x01.
 */
export const DOWNGRADE_TLS12 = Uint8Array.of(0x44, 0x4F, 0x57, 0x4E, 0x47, 0x52, 0x44, 0x01);

/**
 * ServerHello.random of a HelloRetryRequest: SHA-256("HelloRetryRequest")
 * (RFC 8446 §4.1.3).
 */
export const HRR_RANDOM = Uint8Array.from(
  "cf21ad74e59a6111be1d8c021e65b891c2a211167abb8c5e079e09e2c8a8339c".match(/../g) ?? [],
  (h) => parseInt(h, 16),
);

/** @param {number} type @param {Uint8Array} data */
function extension(type, data) {
  const e = new Uint8Array(4 + data.length);
  write16BE(e, 0, type);
  write16BE(e, 2, data.length);
  e.set(data, 4);
  return e;
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
 * TLS Handshake message wrapper: [type:1][len:3][body]
 * @param {number} type
 * @param {Uint8Array} body
 */
function handshakeMsg(type, body) {
  const buf = new Uint8Array(4 + body.length);
  buf[0] = type;
  // 3-byte big-endian length
  buf[1] = (body.length >>> 16) & 0xff;
  buf[2] = (body.length >>> 8)  & 0xff;
  buf[3] =  body.length         & 0xff;
  buf.set(body, 4);
  return buf;
}

/**
 * Wrap a handshake message payload in a TLS record.
 * @param {Uint8Array<ArrayBuffer>} hs
 */
function handshakeRecord(hs) {
  return new TlsRecord(TLS_CT.HANDSHAKE, hs).pack();
}

// ── main class ─────────────────────────────────────────────────────────────

export class TlsRecord {
  /**
   * @param {number} contentType
   * @param {Uint8Array<ArrayBuffer>} payload
   */
  constructor(contentType, payload) {
    this.contentType = contentType;
    this.payload = payload;
  }

  /** Serialize to wire bytes: [type:1][major:1][minor:1][len:2][payload] */
  pack() {
    const buf = new Uint8Array(5 + this.payload.length);
    buf[0] = this.contentType;
    buf[1] = VER_MAJOR;
    buf[2] = VER_MINOR;
    write16BE(buf, 3, this.payload.length);
    buf.set(this.payload, 5);
    return buf;
  }

  /**
   * Parse as many complete TLS records as possible from buf.
   * @param {Uint8Array<ArrayBuffer>} buf
   * @returns {{ records: TlsRecord[], consumed: number }}
   */
  static parseRecords(buf) {
    const records = [];
    let off = 0;
    while (off + 5 <= buf.length) {
      const type = buf[off];
      const len  = read16BE(buf, off + 3);
      if (off + 5 + len > buf.length) break;
      records.push(new TlsRecord(type, buf.slice(off + 5, off + 5 + len)));
      off += 5 + len;
    }
    return { records, consumed: off };
  }

  // ── static builders ──────────────────────────────────────────────────────

  /**
   * @param {Uint8Array} clientRandom - 32 bytes
   * @param {string} [serverName] DNS name for the SNI extension (omitted for IP literals)
   * @param {string[]} [alpn] offered application protocols, most preferred first (RFC 7301)
   * @param {{ keyShare?: Uint8Array, sessionId?: Uint8Array }} [tls13]
   *   offer TLS 1.3 as well: our secp256r1 key share (65-byte point) and a
   *   legacy_session_id for middlebox compatibility mode (RFC 8446 §D.4)
   * @returns {Uint8Array}
   */
  static buildClientHello(clientRandom, serverName = "", alpn = [], tls13 = {}) {
    // server_name extension (RFC 6066 §3): host_name only — IP literals are not allowed
    const host = serverName.trim().replace(/\.$/, "");
    const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
    let sni = new Uint8Array(0);
    if (host && !isIpLiteral) {
      const name = new TextEncoder().encode(host.toLowerCase());
      sni = new Uint8Array(9 + name.length);
      write16BE(sni, 0, 0x0000);              // extension type: server_name
      write16BE(sni, 2, 5 + name.length);     // extension data length
      write16BE(sni, 4, 3 + name.length);     // server_name_list length
      sni[6] = 0x00;                          // name_type: host_name
      write16BE(sni, 7, name.length);         // host_name length
      sni.set(name, 9);
    }

    // supported_groups extension: secp256r1 (0x0017)
    const supportedGroups = new Uint8Array([
      0x00, 0x0A,             // extension type: supported_groups
      0x00, 0x04,             // extension data length
      0x00, 0x02,             // list length
      0x00, 0x17,             // secp256r1
    ]);

    // ec_point_formats extension: uncompressed (0x00)
    const ecPointFormats = new Uint8Array([
      0x00, 0x0B,             // extension type: ec_point_formats
      0x00, 0x02,             // extension data length
      0x01,                   // list length
      0x00,                   // uncompressed
    ]);

    // signature_algorithms extension
    const sigAlgs = new Uint8Array([
      0x00, 0x0D,             // extension type: signature_algorithms
      0x00, 0x04,             // extension data length
      0x00, 0x02,             // list length
      0x04, 0x03,             // ecdsa_secp256r1_sha256
    ]);

    let alpnExt = new Uint8Array(0);
    if (alpn.length > 0) {
      const data = encodeAlpn(alpn);
      alpnExt = new Uint8Array(4 + data.length);
      write16BE(alpnExt, 0, TLS_EXT.ALPN);
      write16BE(alpnExt, 2, data.length);
      alpnExt.set(data, 4);
    }

    // TLS 1.3 offer (RFC 8446 §4.2.1, §4.2.8): versions in preference order
    // and our key share, so the server can answer in a single round trip
    let tls13Ext = new Uint8Array(0);
    if (tls13.keyShare) {
      const versions = extension(TLS_EXT.SUPPORTED_VERSIONS, Uint8Array.of(4, 0x03, 0x04, 0x03, 0x03));
      const entry = new Uint8Array(4 + tls13.keyShare.length);
      write16BE(entry, 0, GROUP_SECP256R1);
      write16BE(entry, 2, tls13.keyShare.length);
      entry.set(tls13.keyShare, 4);
      const shares = new Uint8Array(2 + entry.length);
      write16BE(shares, 0, entry.length);
      shares.set(entry, 2);
      tls13Ext = concat(versions, extension(TLS_EXT.KEY_SHARE, shares));
    }

    const extensions = concat(sni, supportedGroups, ecPointFormats, sigAlgs, alpnExt, tls13Ext);
    const extLenBuf = new Uint8Array(2);
    write16BE(extLenBuf, 0, extensions.length);

    const body = concat(
      new Uint8Array([VER_MAJOR, VER_MINOR]), // client_version
      clientRandom,                            // random (32 bytes)
      ...(tls13.keyShare
        ? [
            Uint8Array.of(tls13.sessionId?.length ?? 0), tls13.sessionId ?? new Uint8Array(0),
            Uint8Array.of(0x00, 0x04, 0x13, 0x01, CIPHER_HI, CIPHER_LO),  // TLS 1.3 suite first
          ]
        : [
            new Uint8Array([0x00]),                               // session_id length = 0
            new Uint8Array([0x00, 0x02, CIPHER_HI, CIPHER_LO]),  // cipher_suites
          ]),
      new Uint8Array([0x01, 0x00]),                         // compression_methods: [null]
      extLenBuf,
      extensions,
    );

    return handshakeRecord(handshakeMsg(TLS_HT.CLIENT_HELLO, body));
  }

  /**
   * Parse a ClientHello handshake body (without the 4-byte handshake header).
   * RFC 5246 §7.4.1.2; extensions are optional (absent in very old clients).
   * Throws {@link TlsDecodeError} on any length inconsistency.
   * @param {Uint8Array} body
   * @returns {{ version: number, random: Uint8Array, sessionId: Uint8Array,
   *             cipherSuites: number[], extensions: Map<number, Uint8Array>,
   *             serverName: string, alpn: string[], versions: number[],
   *             keyShares: Map<number, Uint8Array>, signatureAlgorithms: number[] }}
   */
  static parseClientHello(body) {
    let off = 0;
    /** @param {number} n */
    const need = (n) => {
      if (off + n > body.length) throw new TlsDecodeError("ClientHello truncated");
    };

    need(2 + 32);
    const version = read16BE(body, 0);
    const random = body.slice(2, 34);
    off = 34;

    need(1);
    const sidLen = body[off++];
    if (sidLen > 32) throw new TlsDecodeError("ClientHello session_id too long");
    need(sidLen);
    const sessionId = body.slice(off, off + sidLen);
    off += sidLen;

    need(2);
    const csLen = read16BE(body, off); off += 2;
    if (csLen < 2 || csLen % 2 !== 0) throw new TlsDecodeError("ClientHello cipher_suites malformed");
    need(csLen);
    const cipherSuites = [];
    for (let i = 0; i < csLen; i += 2) cipherSuites.push(read16BE(body, off + i));
    off += csLen;

    need(1);
    const compLen = body[off++];
    if (compLen < 1) throw new TlsDecodeError("ClientHello compression_methods empty");
    need(compLen);
    off += compLen;

    /** @type {Map<number, Uint8Array>} */
    const extensions = new Map();
    if (off < body.length) {
      need(2);
      const extLen = read16BE(body, off); off += 2;
      need(extLen);
      const end = off + extLen;
      if (end !== body.length) throw new TlsDecodeError("ClientHello trailing bytes");
      while (off < end) {
        if (off + 4 > end) throw new TlsDecodeError("ClientHello extension header truncated");
        const type = read16BE(body, off);
        const len  = read16BE(body, off + 2);
        off += 4;
        if (off + len > end) throw new TlsDecodeError("ClientHello extension truncated");
        // RFC 5246 §7.4.1.4: at most one extension of each type
        if (extensions.has(type)) throw new TlsDecodeError("ClientHello duplicate extension");
        extensions.set(type, body.slice(off, off + len));
        off += len;
      }
    }

    const sniExt = extensions.get(TLS_EXT.SERVER_NAME);
    const serverName = sniExt ? parseServerNameExtension(sniExt) : "";

    const alpnExt = extensions.get(TLS_EXT.ALPN);
    const alpn = alpnExt ? decodeAlpn(alpnExt) : [];

    // supported_versions: ProtocolVersion versions<2..254> (1-byte length)
    /** @type {number[]} */
    const versions = [];
    const sv = extensions.get(TLS_EXT.SUPPORTED_VERSIONS);
    if (sv) {
      if (sv.length < 3 || sv[0] !== sv.length - 1 || sv[0] % 2 !== 0) throw new TlsDecodeError("supported_versions malformed");
      for (let i = 1; i < sv.length; i += 2) versions.push(read16BE(sv, i));
    }

    // key_share: KeyShareEntry client_shares<0..2^16-1>
    /** @type {Map<number, Uint8Array>} */
    const keyShares = new Map();
    const ks = extensions.get(TLS_EXT.KEY_SHARE);
    if (ks) {
      if (ks.length < 2 || read16BE(ks, 0) !== ks.length - 2) throw new TlsDecodeError("key_share malformed");
      for (let i = 2; i < ks.length;) {
        if (i + 4 > ks.length) throw new TlsDecodeError("key_share entry truncated");
        const group = read16BE(ks, i), len = read16BE(ks, i + 2);
        if (i + 4 + len > ks.length) throw new TlsDecodeError("key_share entry truncated");
        keyShares.set(group, ks.slice(i + 4, i + 4 + len));
        i += 4 + len;
      }
    }

    /** @type {number[]} */
    const signatureAlgorithms = [];
    const sa = extensions.get(TLS_EXT.SIGNATURE_ALGORITHMS);
    if (sa && sa.length >= 2) for (let i = 2; i + 1 < sa.length; i += 2) signatureAlgorithms.push(read16BE(sa, i));

    return { version, random, sessionId, cipherSuites, extensions, serverName, alpn, versions, keyShares, signatureAlgorithms };
  }

  /**
   * Parse a ServerHello handshake body (without the 4-byte handshake header).
   * @param {Uint8Array} body
   * @returns {{ random: Uint8Array, sessionId: Uint8Array, cipherSuite: number, extensions: Map<number, Uint8Array> }}
   */
  static parseServerHello(body) {
    if (body.length < 38) throw new TlsDecodeError("ServerHello truncated");
    const random = body.slice(2, 34);
    let off = 34;
    const sidLen = body[off++];
    if (off + sidLen + 3 > body.length) throw new TlsDecodeError("ServerHello truncated");
    const sessionId = body.slice(off, off + sidLen);
    off += sidLen;
    const cipherSuite = read16BE(body, off);
    off += 3; // cipher suite + compression method
    /** @type {Map<number, Uint8Array>} */
    const extensions = new Map();
    if (off < body.length) {
      if (off + 2 > body.length) throw new TlsDecodeError("ServerHello extensions truncated");
      const end = off + 2 + read16BE(body, off);
      if (end !== body.length) throw new TlsDecodeError("ServerHello extensions length mismatch");
      off += 2;
      while (off < end) {
        if (off + 4 > end) throw new TlsDecodeError("ServerHello extension truncated");
        const type = read16BE(body, off);
        const len = read16BE(body, off + 2);
        off += 4;
        if (off + len > end) throw new TlsDecodeError("ServerHello extension truncated");
        if (extensions.has(type)) throw new TlsDecodeError("ServerHello duplicate extension");
        extensions.set(type, body.slice(off, off + len));
        off += len;
      }
    }
    return { random, sessionId, cipherSuite, extensions };
  }

  /**
   * TLS 1.3 ServerHello (RFC 8446 §4.1.3): legacy_version 1.2, the client's
   * legacy_session_id echoed, TLS_AES_128_GCM_SHA256, supported_versions
   * (0x0304) and our key share. Returns the handshake *message* (no record
   * header) — the caller wraps it, as the transcript needs the bare message.
   * @param {Uint8Array} serverRandom
   * @param {Uint8Array} sessionIdEcho
   * @param {Uint8Array} keyShare 65-byte secp256r1 point
   */
  static buildServerHello13(serverRandom, sessionIdEcho, keyShare) {
    const ks = new Uint8Array(4 + keyShare.length);
    write16BE(ks, 0, GROUP_SECP256R1);
    write16BE(ks, 2, keyShare.length);
    ks.set(keyShare, 4);
    const exts = concat(extension(TLS_EXT.SUPPORTED_VERSIONS, Uint8Array.of(0x03, 0x04)), extension(TLS_EXT.KEY_SHARE, ks));
    const extLen = new Uint8Array(2);
    write16BE(extLen, 0, exts.length);
    const body = concat(
      Uint8Array.of(VER_MAJOR, VER_MINOR),
      serverRandom,
      Uint8Array.of(sessionIdEcho.length), sessionIdEcho,
      Uint8Array.of(0x13, 0x01),
      Uint8Array.of(0x00),
      extLen, exts,
    );
    return handshakeMsg(TLS_HT.SERVER_HELLO, body);
  }

  /**
   * TLS 1.3 EncryptedExtensions (RFC 8446 §4.3.1) handshake message.
   * @param {{ type: number, data: Uint8Array }[]} exts
   */
  static buildEncryptedExtensions(exts) {
    const all = concat(...exts.map(e => extension(e.type, e.data)));
    const body = new Uint8Array(2 + all.length);
    write16BE(body, 0, all.length);
    body.set(all, 2);
    return handshakeMsg(TLS_HT.ENCRYPTED_EXTENSIONS, body);
  }

  /**
   * TLS 1.3 Certificate (RFC 8446 §4.4.2): empty request context, every
   * CertificateEntry without extensions.
   * @param {Uint8Array[]} ders leaf first
   */
  static buildCertificate13(ders) {
    const entries = ders.map(d => {
      const e = new Uint8Array(3 + d.length + 2);
      e[0] = (d.length >>> 16) & 0xff; e[1] = (d.length >>> 8) & 0xff; e[2] = d.length & 0xff;
      e.set(d, 3);
      return e; // trailing 2 zero bytes = no extensions
    });
    const list = concat(...entries);
    const body = new Uint8Array(1 + 3 + list.length);
    body[0] = 0; // certificate_request_context: empty
    body[1] = (list.length >>> 16) & 0xff; body[2] = (list.length >>> 8) & 0xff; body[3] = list.length & 0xff;
    body.set(list, 4);
    return handshakeMsg(TLS_HT.CERTIFICATE, body);
  }

  /**
   * Convert a TLS 1.3 Certificate body to the TLS 1.2 layout (a plain list
   * of certificates), dropping the request context and entry extensions.
   * @param {Uint8Array} body
   * @returns {Uint8Array}
   */
  static certificate13To12(body) {
    if (body.length < 4) throw new TlsDecodeError("Certificate truncated");
    let off = 1 + body[0];
    const listLen = (body[off] << 16) | (body[off + 1] << 8) | body[off + 2];
    off += 3;
    if (off + listLen !== body.length) throw new TlsDecodeError("Certificate list length mismatch");
    /** @type {Uint8Array[]} */
    const parts = [];
    while (off < body.length) {
      if (off + 3 > body.length) throw new TlsDecodeError("CertificateEntry truncated");
      const len = (body[off] << 16) | (body[off + 1] << 8) | body[off + 2];
      if (off + 3 + len + 2 > body.length) throw new TlsDecodeError("CertificateEntry truncated");
      parts.push(body.slice(off, off + 3 + len));
      off += 3 + len;
      const extLen = read16BE(body, off);
      off += 2 + extLen;
    }
    const list = concat(...parts);
    const out = new Uint8Array(3 + list.length);
    out[0] = (list.length >>> 16) & 0xff; out[1] = (list.length >>> 8) & 0xff; out[2] = list.length & 0xff;
    out.set(list, 3);
    return out;
  }

  /**
   * TLS 1.3 CertificateVerify (RFC 8446 §4.4.3).
   * @param {Uint8Array} derSignature DER-encoded ECDSA signature
   */
  static buildCertificateVerify(derSignature) {
    const body = new Uint8Array(4 + derSignature.length);
    write16BE(body, 0, SIG_ECDSA_P256_SHA256);
    write16BE(body, 2, derSignature.length);
    body.set(derSignature, 4);
    return handshakeMsg(TLS_HT.CERTIFICATE_VERIFY, body);
  }

  /** Wrap a bare handshake message into a plaintext record. @param {Uint8Array} msg */
  static handshakeRecordOf(msg) {
    return handshakeRecord(/** @type {Uint8Array<ArrayBuffer>} */ (msg));
  }

  /**
   * @param {Uint8Array} serverRandom - 32 bytes
   * @param {Uint8Array} sessionId
   * @param {{ type: number, data: Uint8Array }[]} [extensions] only ones the client offered (RFC 5246 §7.4.1.4)
   * @returns {Uint8Array}
   */
  static buildServerHello(serverRandom, sessionId, extensions = []) {
    const sid = sessionId.length > 0 ? sessionId : new Uint8Array(0);
    let extBlock = new Uint8Array(0);
    if (extensions.length > 0) {
      const parts = extensions.map(({ type, data }) => {
        const e = new Uint8Array(4 + data.length);
        write16BE(e, 0, type);
        write16BE(e, 2, data.length);
        e.set(data, 4);
        return e;
      });
      const all = concat(...parts);
      extBlock = new Uint8Array(2 + all.length);
      write16BE(extBlock, 0, all.length);
      extBlock.set(all, 2);
    }
    const body = concat(
      new Uint8Array([VER_MAJOR, VER_MINOR]),
      serverRandom,
      new Uint8Array([sid.length]),
      sid,
      new Uint8Array([CIPHER_HI, CIPHER_LO]),  // chosen cipher
      new Uint8Array([0x00]),                   // compression: null
      extBlock,
    );
    return handshakeRecord(handshakeMsg(TLS_HT.SERVER_HELLO, body));
  }

  /**
   * Certificate message: [list_len:3]([cert_len:3][cert_der])…
   * Accepts a single DER blob or an array for chain sending.
   * @param {Uint8Array|Uint8Array[]} certDer
   * @returns {Uint8Array}
   */
  static buildCertificate(certDer) {
    const ders = Array.isArray(certDer) ? certDer : [certDer];
    let listLen = 0;
    for (const d of ders) listLen += 3 + d.length;
    const body = new Uint8Array(3 + listLen);
    body[0] = (listLen >>> 16) & 0xff;
    body[1] = (listLen >>> 8)  & 0xff;
    body[2] =  listLen         & 0xff;
    let off = 3;
    for (const d of ders) {
      body[off]   = (d.length >>> 16) & 0xff;
      body[off+1] = (d.length >>> 8)  & 0xff;
      body[off+2] =  d.length         & 0xff;
      body.set(d, off + 3);
      off += 3 + d.length;
    }
    return handshakeRecord(handshakeMsg(TLS_HT.CERTIFICATE, body));
  }

  /**
   * ECDH ServerKeyExchange: curve=secp256r1, public key (65 bytes uncompressed),
   * followed by the ECDSA signature over clientRandom||serverRandom||ecParams.
   * For ECDHE_ECDSA the signature is mandatory (RFC 8422 §5.4) — there is
   * deliberately no unsigned variant; clients abort with handshake_failure
   * if it is missing (see TlsSession._clientHandshake()).
   * @param {Uint8Array} ecdhPubKeyBytes - 65 bytes (0x04 || x || y)
   * @param {Uint8Array} signature - ECDSA signature as produced by WebCrypto (P1363, 64 bytes)
   * @returns {Uint8Array}
   */
  static buildServerKeyExchange(ecdhPubKeyBytes, signature) {
    // [named_curve:3][key_len:1][key_bytes:65]
    const params = new Uint8Array(4 + ecdhPubKeyBytes.length);
    params[0] = 0x03;              // named_curve
    params[1] = 0x00; params[2] = 0x17; // secp256r1
    params[3] = ecdhPubKeyBytes.length;
    params.set(ecdhPubKeyBytes, 4);

    if (!signature || signature.length === 0) {
      throw new Error("ServerKeyExchange requires a signature (ECDHE_ECDSA, RFC 8422 §5.4)");
    }

    // [sig_scheme:2=ecdsa_secp256r1_sha256][sig_len:2][sig_bytes]
    const body = new Uint8Array(params.length + 2 + 2 + signature.length);
    body.set(params, 0);
    let off = params.length;
    body[off++] = 0x04; body[off++] = 0x03; // ecdsa_secp256r1_sha256
    body[off++] = (signature.length >>> 8) & 0xff;
    body[off++] = signature.length & 0xff;
    body.set(signature, off);
    return handshakeRecord(handshakeMsg(TLS_HT.SERVER_KEY_EXCHANGE, body));
  }

  /**
   * Parse a ServerKeyExchange body back into its components.
   * @param {Uint8Array} body
   * @returns {{ ecdhPubKeyBytes: Uint8Array, ecParams: Uint8Array, signature: Uint8Array|null }}
   */
  static parseServerKeyExchange(body) {
    // [named_curve:3][key_len:1][key_bytes]
    const keyLen = body[3];
    const ecdhPubKeyBytes = body.slice(4, 4 + keyLen);
    const ecParams = body.slice(0, 4 + keyLen); // named_curve + key_len + key_bytes
    let signature = null;
    const sigOff = 4 + keyLen;
    if (sigOff + 4 <= body.length) {
      const sigLen = (body[sigOff + 2] << 8) | body[sigOff + 3];
      if (sigLen > 0 && sigOff + 4 + sigLen <= body.length) {
        signature = body.slice(sigOff + 4, sigOff + 4 + sigLen);
      }
    }
    return { ecdhPubKeyBytes, ecParams, signature };
  }

  /** @returns {Uint8Array} */
  static buildServerHelloDone() {
    return handshakeRecord(handshakeMsg(TLS_HT.SERVER_HELLO_DONE, new Uint8Array(0)));
  }

  /**
   * @param {Uint8Array} ecdhPubKeyBytes - 65 bytes (0x04 || x || y)
   * @returns {Uint8Array}
   */
  static buildClientKeyExchange(ecdhPubKeyBytes) {
    const body = new Uint8Array(1 + ecdhPubKeyBytes.length);
    body[0] = ecdhPubKeyBytes.length;
    body.set(ecdhPubKeyBytes, 1);
    return handshakeRecord(handshakeMsg(TLS_HT.CLIENT_KEY_EXCHANGE, body));
  }

  /** @returns {Uint8Array} */
  static buildChangeCipherSpec() {
    return new TlsRecord(TLS_CT.CHANGE_CIPHER_SPEC, new Uint8Array([0x01])).pack();
  }

  /**
   * Plaintext Finished record — for illustration/tests only. On the wire,
   * Finished follows ChangeCipherSpec and is therefore always AES-GCM
   * protected (RFC 5246 §7.4.9); TlsSession encrypts the handshake message
   * itself instead of using this builder.
   * @param {Uint8Array} verifyData - 12 bytes
   * @returns {Uint8Array}
   */
  static buildFinished(verifyData) {
    return handshakeRecord(handshakeMsg(TLS_HT.FINISHED, verifyData));
  }

  /**
   * @param {Uint8Array<ArrayBuffer>} payload
   * @returns {Uint8Array}
   */
  static buildApplicationData(payload) {
    return new TlsRecord(TLS_CT.APP_DATA, payload).pack();
  }

  /**
   * @param {number} level - 1=warning, 2=fatal
   * @param {number} description - e.g. 0=close_notify, 42=bad_certificate
   * @returns {Uint8Array}
   */
  static buildAlert(level, description) {
    return new TlsRecord(TLS_CT.ALERT, new Uint8Array([level, description])).pack();
  }
}
