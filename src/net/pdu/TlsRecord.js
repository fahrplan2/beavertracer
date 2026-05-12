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
  CERTIFICATE:        0x0B,
  SERVER_KEY_EXCHANGE:0x0C,
  SERVER_HELLO_DONE:  0x0E,
  CLIENT_KEY_EXCHANGE:0x10,
  FINISHED:           0x14,
};

// Outer record version: TLS 1.2 (0x0303)
const VER_MAJOR = 0x03;
const VER_MINOR = 0x03;

// ClientHello legacy_version: TLS 1.0 compat (0x0301) for max interop
const HELLO_VER_MAJOR = 0x03;
const HELLO_VER_MINOR = 0x03;

// TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
const CIPHER_HI = 0xC0;
const CIPHER_LO = 0x2B;

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
   * @returns {Uint8Array}
   */
  static buildClientHello(clientRandom) {
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

    const extensions = concat(supportedGroups, ecPointFormats, sigAlgs);
    const extLenBuf = new Uint8Array(2);
    write16BE(extLenBuf, 0, extensions.length);

    const body = concat(
      new Uint8Array([HELLO_VER_MAJOR, HELLO_VER_MINOR]), // client_version
      clientRandom,                                         // random (32 bytes)
      new Uint8Array([0x00]),                               // session_id length = 0
      new Uint8Array([0x00, 0x02, CIPHER_HI, CIPHER_LO]),  // cipher_suites
      new Uint8Array([0x01, 0x00]),                         // compression_methods: [null]
      extLenBuf,
      extensions,
    );

    return handshakeRecord(handshakeMsg(TLS_HT.CLIENT_HELLO, body));
  }

  /**
   * @param {Uint8Array} serverRandom - 32 bytes
   * @param {Uint8Array} sessionId
   * @returns {Uint8Array}
   */
  static buildServerHello(serverRandom, sessionId) {
    const sid = sessionId.length > 0 ? sessionId : new Uint8Array(0);
    const body = concat(
      new Uint8Array([HELLO_VER_MAJOR, HELLO_VER_MINOR]),
      serverRandom,
      new Uint8Array([sid.length]),
      sid,
      new Uint8Array([CIPHER_HI, CIPHER_LO]),  // chosen cipher
      new Uint8Array([0x00]),                   // compression: null
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
   * ECDH ServerKeyExchange: curve=secp256r1, public key (65 bytes uncompressed).
   * @param {Uint8Array} ecdhPubKeyBytes - 65 bytes (0x04 || x || y)
   * @returns {Uint8Array}
   */
  static buildServerKeyExchange(ecdhPubKeyBytes) {
    // ECParameters: named_curve (3), secp256r1 (0x0017)
    // ECPoint: length-prefixed
    const body = new Uint8Array(4 + ecdhPubKeyBytes.length);
    body[0] = 0x03;             // named_curve
    body[1] = 0x00; body[2] = 0x17; // secp256r1
    body[3] = ecdhPubKeyBytes.length;
    body.set(ecdhPubKeyBytes, 4);
    return handshakeRecord(handshakeMsg(TLS_HT.SERVER_KEY_EXCHANGE, body));
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
