//@ts-check

/**
 * QUIC version 1 (RFC 9000) with TLS 1.3 (RFC 9001) over UDP datagrams.
 *
 * One QuicConnection per peer, client or server; QuicServer demultiplexes
 * incoming datagrams by connection ID. The transport is datagram based:
 * the caller supplies `sendDatagram(bytes)` and feeds received datagrams to
 * `handleDatagram(bytes)`.
 *
 * Implemented: Initial / Handshake / 1-RTT packets (coalesced), packet and
 * header protection, packet-number spaces, ACK ranges, loss detection
 * (packet threshold) and PTO retransmission (RFC 9002, simplified), CRYPTO
 * frames, bidirectional and unidirectional streams with flow control,
 * transport parameters, CONNECTION_CLOSE, HANDSHAKE_DONE, idle timeout.
 * Not implemented: Retry, version negotiation, connection migration, new
 * connection IDs, key update, 0-RTT, congestion control, ECN.
 */

import { TlsSession, hkdfExtract, hkdfExpandLabel } from "./TlsSession.js";
import { simTimer } from "../lib/SimTimer.js";

export const QUIC_VERSION_1 = 0x00000001;

/** Initial salt for QUIC v1 (RFC 9001 §5.2). */
const INITIAL_SALT_V1 = Uint8Array.from(
  "38762cf7f55934b34d179ae6a4c80cadccbb7f0a".match(/../g) ?? [], (h) => parseInt(h, 16));

/** Smallest datagram a client must send for Initial packets (RFC 9000 §14.1); used for all. */
export const QUIC_MAX_DATAGRAM = 1200;

const CID_LEN = 8;
const PN_LEN = 4;
const TAG_LEN = 16;

/** Transport error codes (RFC 9000 §20.1); TLS alerts map to 0x100 + alert. */
export const QUIC_ERROR = Object.freeze({
  NO_ERROR: 0x0, INTERNAL_ERROR: 0x1, CONNECTION_REFUSED: 0x2, FLOW_CONTROL_ERROR: 0x3,
  STREAM_LIMIT_ERROR: 0x4, STREAM_STATE_ERROR: 0x5, FINAL_SIZE_ERROR: 0x6,
  FRAME_ENCODING_ERROR: 0x7, TRANSPORT_PARAMETER_ERROR: 0x8, PROTOCOL_VIOLATION: 0xa,
  CRYPTO_ERROR: 0x100,
});

/** Frame types (RFC 9000 §19). */
export const QUIC_FRAME = Object.freeze({
  PADDING: 0x00, PING: 0x01, ACK: 0x02, ACK_ECN: 0x03, RESET_STREAM: 0x04, STOP_SENDING: 0x05,
  CRYPTO: 0x06, NEW_TOKEN: 0x07, STREAM: 0x08, MAX_DATA: 0x10, MAX_STREAM_DATA: 0x11,
  MAX_STREAMS_BIDI: 0x12, MAX_STREAMS_UNI: 0x13, DATA_BLOCKED: 0x14, STREAM_DATA_BLOCKED: 0x15,
  STREAMS_BLOCKED_BIDI: 0x16, STREAMS_BLOCKED_UNI: 0x17, NEW_CONNECTION_ID: 0x18,
  RETIRE_CONNECTION_ID: 0x19, PATH_CHALLENGE: 0x1a, PATH_RESPONSE: 0x1b,
  CONNECTION_CLOSE: 0x1c, CONNECTION_CLOSE_APP: 0x1d, HANDSHAKE_DONE: 0x1e,
});

/** Transport parameter ids (RFC 9000 §18.2). */
const TP = Object.freeze({
  ORIGINAL_DCID: 0x00, MAX_IDLE_TIMEOUT: 0x01, MAX_UDP_PAYLOAD_SIZE: 0x03, INITIAL_MAX_DATA: 0x04,
  INITIAL_MAX_STREAM_DATA_BIDI_LOCAL: 0x05, INITIAL_MAX_STREAM_DATA_BIDI_REMOTE: 0x06,
  INITIAL_MAX_STREAM_DATA_UNI: 0x07, INITIAL_MAX_STREAMS_BIDI: 0x08, INITIAL_MAX_STREAMS_UNI: 0x09,
  ACTIVE_CONNECTION_ID_LIMIT: 0x0e, INITIAL_SCID: 0x0f,
});

/** Long-header packet types (RFC 9000 §17.2). */
const LONG_TYPE = Object.freeze({ INITIAL: 0, ZERO_RTT: 1, HANDSHAKE: 2, RETRY: 3 });

/** @typedef {"initial"|"handshake"|"app"} Level */
/** @type {Level[]} */
const LEVELS = ["initial", "handshake", "app"];

export class QuicError extends Error {
  /**
   * @param {number} code transport error code (or application code with `app`)
   * @param {string} message
   * @param {{ remote?: boolean, app?: boolean }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = "QuicError";
    this.code = code;
    this.remote = opts.remote ?? false;
    this.app = opts.app ?? false;
  }
}

// ── bytes and varints (RFC 9000 §16) ─────────────────────────────────────────

/** @param {Uint8Array[]} parts */
function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** @param {number} v @returns {Uint8Array} */
export function encodeVarint(v) {
  if (v < 0x40) return Uint8Array.of(v);
  if (v < 0x4000) return Uint8Array.of(0x40 | (v >>> 8), v & 0xff);
  if (v < 0x40000000) return Uint8Array.of(0x80 | (v >>> 24), (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  const hi = Math.floor(v / 2 ** 32), lo = v >>> 0;
  return Uint8Array.of(0xc0 | (hi >>> 24), (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
}

/** 2-byte varint (for the Length field, so the header size is known in advance). @param {number} v */
function varint2(v) {
  return Uint8Array.of(0x40 | (v >>> 8), v & 0xff);
}

/** Cursor for decoding. */
export class QuicReader {
  /** @param {Uint8Array} buf @param {number} [pos] @param {number} [end] */
  constructor(buf, pos = 0, end = buf.length) { this.buf = buf; this.pos = pos; this.end = end; }
  get left() { return this.end - this.pos; }
  /** @param {number} n */
  need(n) { if (this.pos + n > this.end) throw new QuicError(QUIC_ERROR.FRAME_ENCODING_ERROR, "truncated"); }
  u8() { this.need(1); return this.buf[this.pos++]; }
  /** @param {number} n */
  bytes(n) { this.need(n); const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  u32() { const b = this.bytes(4); return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0; }
  varint() {
    this.need(1);
    const first = this.buf[this.pos];
    const len = 1 << (first >> 6);
    this.need(len);
    let v = first & 0x3f;
    for (let i = 1; i < len; i++) v = v * 256 + this.buf[this.pos + i];
    this.pos += len;
    return v;
  }
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function eq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** @param {Uint8Array} b */
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// ── packet protection (RFC 9001 §5) ──────────────────────────────────────────

/**
 * AEAD and header-protection keys of one direction at one level.
 * @typedef {{ key: CryptoKey, iv: Uint8Array, hp: CryptoKey }} PacketKeys
 */

/** @param {Uint8Array} secret @returns {Promise<PacketKeys>} */
export async function packetKeysFromSecret(secret) {
  const empty = new Uint8Array(0);
  const keyBytes = await hkdfExpandLabel(secret, "quic key", empty, 16);
  const iv = await hkdfExpandLabel(secret, "quic iv", empty, 12);
  const hpBytes = await hkdfExpandLabel(secret, "quic hp", empty, 16);
  const key = await crypto.subtle.importKey("raw", /** @type {Uint8Array<ArrayBuffer>} */ (keyBytes), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const hp = await crypto.subtle.importKey("raw", /** @type {Uint8Array<ArrayBuffer>} */ (hpBytes), { name: "AES-CBC" }, false, ["encrypt"]);
  return { key, iv, hp };
}

/**
 * Initial secrets from the client's first Destination Connection ID (§5.2).
 * @param {Uint8Array} dcid
 */
export async function initialSecrets(dcid) {
  const initial = await hkdfExtract(INITIAL_SALT_V1, dcid);
  const empty = new Uint8Array(0);
  return {
    client: await hkdfExpandLabel(initial, "client in", empty, 32),
    server: await hkdfExpandLabel(initial, "server in", empty, 32),
  };
}

/**
 * Header-protection mask: AES-ECB of the 16-byte sample (§5.4.3). WebCrypto
 * has no ECB; one CBC block with a zero IV is the same computation.
 * @param {CryptoKey} hp @param {Uint8Array} sample
 */
export async function hpMask(hp, sample) {
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, hp,
    /** @type {Uint8Array<ArrayBuffer>} */ (sample)));
  return out.subarray(0, 5);
}

/** @param {Uint8Array} iv @param {number} pn */
function nonceFor(iv, pn) {
  const n = iv.slice();
  let v = pn;
  for (let i = 11; i >= 4 && v > 0; i--) { n[i] ^= v % 256; v = Math.floor(v / 256); }
  return n;
}

/**
 * Seal a packet: `header` ends with the 4-byte packet number. Returns the
 * protected packet (AEAD over the payload, then header protection).
 * @param {PacketKeys} k @param {Uint8Array} header @param {number} pn @param {Uint8Array} payload
 * @param {boolean} long
 */
export async function protectPacket(k, header, pn, payload, long) {
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: /** @type {Uint8Array<ArrayBuffer>} */ (nonceFor(k.iv, pn)), additionalData: /** @type {Uint8Array<ArrayBuffer>} */ (header) },
    k.key, /** @type {Uint8Array<ArrayBuffer>} */ (payload)));
  const pkt = concat([header, ct]);
  const pnOffset = header.length - PN_LEN;
  const mask = await hpMask(k.hp, pkt.subarray(pnOffset + 4, pnOffset + 20));
  pkt[0] ^= mask[0] & (long ? 0x0f : 0x1f);
  for (let i = 0; i < PN_LEN; i++) pkt[pnOffset + i] ^= mask[1 + i];
  return pkt;
}

/**
 * Remove header protection and decrypt. `pnOffset` is where the packet number
 * starts, `end` where the packet ends (coalesced packets).
 * Returns null when authentication fails (the packet is then dropped).
 * @param {PacketKeys} k @param {Uint8Array} dgram @param {number} start @param {number} pnOffset @param {number} end
 * @param {boolean} long @param {number} largestPn
 */
export async function unprotectPacket(k, dgram, start, pnOffset, end, long, largestPn) {
  if (pnOffset + 4 + 16 > end) return null;
  const pkt = dgram.slice(start, end);
  const po = pnOffset - start;
  const mask = await hpMask(k.hp, pkt.subarray(po + 4, po + 20));
  pkt[0] ^= mask[0] & (long ? 0x0f : 0x1f);
  const pnLen = (pkt[0] & 0x03) + 1;
  let truncated = 0;
  for (let i = 0; i < pnLen; i++) {
    pkt[po + i] ^= mask[1 + i];
    truncated = truncated * 256 + pkt[po + i];
  }
  const pn = decodePacketNumber(largestPn, truncated, pnLen * 8);
  const header = pkt.subarray(0, po + pnLen);
  try {
    const plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: /** @type {Uint8Array<ArrayBuffer>} */ (nonceFor(k.iv, pn)), additionalData: /** @type {Uint8Array<ArrayBuffer>} */ (header) },
      k.key, /** @type {Uint8Array<ArrayBuffer>} */ (pkt.subarray(po + pnLen))));
    return { pn, payload: plain, firstByte: pkt[0] };
  } catch {
    return null;
  }
}

/**
 * Full packet number from its truncated encoding (RFC 9000 §A.3).
 * @param {number} largest largest packet number received so far (-1: none)
 * @param {number} truncated @param {number} nbits
 */
export function decodePacketNumber(largest, truncated, nbits) {
  const expected = largest + 1;
  const win = 2 ** nbits;
  const hwin = win / 2;
  let candidate = expected - (expected % win) + truncated;
  if (candidate <= expected - hwin && candidate < 2 ** 62 - win) candidate += win;
  else if (candidate > expected + hwin && candidate >= win) candidate -= win;
  return candidate;
}

// ── transport parameters (RFC 9000 §18) ──────────────────────────────────────

/** @param {Array<[number, number|Uint8Array]>} params */
export function encodeTransportParams(params) {
  return concat(params.flatMap(([id, v]) => {
    const value = typeof v === "number" ? encodeVarint(v) : v;
    return [encodeVarint(id), encodeVarint(value.length), value];
  }));
}

/** @param {Uint8Array} bytes @returns {Map<number, Uint8Array>} */
export function decodeTransportParams(bytes) {
  const r = new QuicReader(bytes);
  /** @type {Map<number, Uint8Array>} */
  const out = new Map();
  while (r.left > 0) {
    const id = r.varint();
    const len = r.varint();
    if (out.has(id)) throw new QuicError(QUIC_ERROR.TRANSPORT_PARAMETER_ERROR, `duplicate transport parameter ${id}`);
    out.set(id, r.bytes(len).slice());
  }
  return out;
}

/** @param {Map<number, Uint8Array>} m @param {number} id @param {number} dflt */
function tpInt(m, id, dflt) {
  const v = m.get(id);
  return v ? new QuicReader(v).varint() : dflt;
}

// ── streams ──────────────────────────────────────────────────────────────────

/**
 * One QUIC stream. Received data is delivered in order through `ondata`;
 * `onend` fires after the final byte. `readAll()` collects everything.
 */
export class QuicStream {
  /**
   * @param {QuicConnection} conn @param {number} id
   */
  constructor(conn, id) {
    this.conn = conn;
    this.id = id;
    /** stream id bits (RFC 9000 §2.1): bit 0 = server-initiated, bit 1 = unidirectional */
    this.uni = (id & 0x2) !== 0;
    // send side
    this.sendOffset = 0;
    this.sendFin = false;
    /** queued, not yet framed data @type {Uint8Array[]} */
    this._sendQueue = [];
    this._finQueued = false;
    this.peerMaxData = 0;
    // receive side
    /** @type {Map<number, Uint8Array>} out-of-order segments by offset */
    this._segments = new Map();
    this.readOffset = 0;
    /** @type {number|null} */
    this.finalSize = null;
    this.ended = false;
    this.recvMaxData = 0;
    /** @type {((chunk: Uint8Array) => void)|null} */
    this.ondata = null;
    /** @type {(() => void)|null} */
    this.onend = null;
    /** @type {((code: number) => void)|null} */
    this.onreset = null;
    /** @type {Uint8Array[]} delivered data kept for readAll() */
    this._collected = [];
    /** @type {Array<{ resolve: (b: Uint8Array) => void, reject: (e: Error) => void }>} */
    this._readers = [];
  }

  /** Locally initiated? */
  get local() {
    return ((this.id & 0x1) === 1) === this.conn.isServer;
  }

  /**
   * Queue data for sending; `fin` ends the stream.
   * @param {Uint8Array} data @param {boolean} [fin]
   */
  write(data, fin = false) {
    if (this._finQueued) throw new QuicError(QUIC_ERROR.STREAM_STATE_ERROR, "write after end");
    if (data.length) this._sendQueue.push(data);
    if (fin) this._finQueued = true;
    this.conn._flushSoon();
  }

  end() { this.write(new Uint8Array(0), true); }

  /** Everything up to the end of the stream. @returns {Promise<Uint8Array>} */
  readAll() {
    if (this.ended) return Promise.resolve(concat(this._collected));
    return new Promise((resolve, reject) => this._readers.push({ resolve, reject }));
  }

  /** @param {number} offset @param {Uint8Array} data @param {boolean} fin */
  _receive(offset, data, fin) {
    const end = offset + data.length;
    if (fin) {
      if (this.finalSize !== null && this.finalSize !== end) throw new QuicError(QUIC_ERROR.FINAL_SIZE_ERROR, "final size changed");
      this.finalSize = end;
    }
    if (this.finalSize !== null && end > this.finalSize) throw new QuicError(QUIC_ERROR.FINAL_SIZE_ERROR, "data beyond final size");
    if (end > this.recvMaxData) throw new QuicError(QUIC_ERROR.FLOW_CONTROL_ERROR, `stream ${this.id} flow control`);
    if (end > this.readOffset && data.length) {
      const prev = this._segments.get(offset);
      if (!prev || prev.length < data.length) this._segments.set(offset, data.slice());
    }
    // deliver what is contiguous
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [off, seg] of this._segments) {
        if (off <= this.readOffset && off + seg.length > this.readOffset) {
          const chunk = seg.subarray(this.readOffset - off);
          this._segments.delete(off);
          this.readOffset += chunk.length;
          this.conn._consumed(this, chunk.length);
          this._collected.push(chunk);
          this.ondata?.(chunk);
          progressed = true;
          break;
        } else if (off + seg.length <= this.readOffset) {
          this._segments.delete(off);
        }
      }
    }
    if (!this.ended && this.finalSize !== null && this.readOffset === this.finalSize) {
      this.ended = true;
      this.onend?.();
      const all = concat(this._collected);
      for (const r of this._readers.splice(0)) r.resolve(all);
    }
  }

  /** @param {Error} err */
  _fail(err) {
    for (const r of this._readers.splice(0)) r.reject(err);
  }
}

// ── connection ───────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   frames: any[], ackEliciting: boolean, time: number, size: number,
 * }} SentPacket
 *
 * @typedef {{
 *   pn: number,
 *   largestRecv: number,
 *   ranges: Array<[number, number]>,
 *   ackPending: boolean,
 *   sent: Map<number, SentPacket>,
 *   largestAcked: number,
 *   cryptoSend: number,
 *   cryptoQueue: Uint8Array[],
 *   cryptoRecv: Map<number, Uint8Array>,
 *   cryptoRead: number,
 *   resend: any[],
 *   write: Promise<PacketKeys>|null,
 *   read: Promise<PacketKeys>|null,
 * }} Space
 */

export class QuicConnection {
  /**
   * @param {{
   *   isServer: boolean,
   *   sendDatagram: (bytes: Uint8Array) => void,
   *   alpn: string[],
   *   serverName?: string,
   *   cert?: any,
   *   selectCert?: (sni: string) => any,
   *   trustStore?: any,
   *   now?: () => number,
   *   timer?: { schedule: (fn: () => void, ms: number) => number, cancel: (id: number) => void },
   *   clock?: () => number,
   *   initialRttMs?: number,
   *   idleTimeoutMs?: number,
   *   handshakeTimeoutMs?: number,
   *   originalDcid?: Uint8Array,
   *   peerScid?: Uint8Array,
   *   onPacket?: (dir: "in"|"out", level: Level, pn: number, frames: string[]) => void,
   *   keyLog?: (line: string) => void,
   * }} opts  originalDcid/peerScid: server side, from the client's first Initial;
   *   keyLog: TLS secrets in NSS key log format (SSLKEYLOGFILE)
   */
  constructor(opts) {
    this.isServer = opts.isServer;
    this._sendDatagram = opts.sendDatagram;
    this._timer = opts.timer ?? { schedule: (fn, ms) => simTimer.schedule(fn, ms), cancel: (id) => simTimer.cancel(id) };
    this._clock = opts.clock ?? (() => simTimer.nowMs);
    this.onPacket = opts.onPacket ?? null;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 30_000;

    this.scid = crypto.getRandomValues(new Uint8Array(CID_LEN));
    if (this.isServer) {
      this.originalDcid = /** @type {Uint8Array} */ (opts.originalDcid);
      this.dcid = /** @type {Uint8Array} */ (opts.peerScid);
    } else {
      this.originalDcid = crypto.getRandomValues(new Uint8Array(CID_LEN));
      this.dcid = this.originalDcid;
    }
    this._dcidFromServer = this.isServer;
    /** SCID of the peer's first packet (checked against its transport parameters). */
    this._peerInitialScid = this.isServer ? /** @type {Uint8Array} */ (opts.peerScid) : null;

    /** @type {Record<Level, Space>} */
    this.spaces = /** @type {any} */ ({});
    for (const l of LEVELS) {
      this.spaces[l] = {
        pn: 0, largestRecv: -1, ranges: [], ackPending: false, sent: new Map(), largestAcked: -1,
        cryptoSend: 0, cryptoQueue: [], cryptoRecv: new Map(), cryptoRead: 0, resend: [],
        write: null, read: null,
      };
    }
    this._initialReady = initialSecrets(this.originalDcid).then((s) => {
      this.spaces.initial.write = packetKeysFromSecret(this.isServer ? s.server : s.client);
      this.spaces.initial.read = packetKeysFromSecret(this.isServer ? s.client : s.server);
    });

    // flow control: what we allow (receive) and what the peer allows (send)
    this.localLimits = {
      maxData: 16 * 1024 * 1024, maxStreamData: 4 * 1024 * 1024, maxStreamsBidi: 100, maxStreamsUni: 100,
    };
    this._recvMaxData = this.localLimits.maxData;
    this._recvConsumed = 0;
    this._peerMaxData = 0;
    this._sentData = 0;
    this._peerTp = /** @type {Map<number, Uint8Array>|null} */ (null);

    /** @type {Map<number, QuicStream>} */
    this.streams = new Map();
    this._nextBidi = this.isServer ? 1 : 0;
    this._nextUni = this.isServer ? 3 : 2;
    /** @type {((s: QuicStream) => void)|null} */
    this.onStream = null;
    /** control frames waiting to be sent at app level */
    /** @type {any[]} */
    this._control = [];

    // RTT and loss recovery (RFC 9002, simplified)
    this.srtt = opts.initialRttMs ?? 333;
    this.rttvar = this.srtt / 2;
    this._ptoCount = 0;
    /** @type {number|null} */ this._ptoTimer = null;
    /** @type {number|null} */ this._idleTimer = null;

    this.state = /** @type {"handshake"|"connected"|"closing"|"closed"} */ ("handshake");
    this.handshakeConfirmed = false;
    /** @type {Error|null} */ this.closeError = null;
    /** @type {{ code: number, app: boolean, reason: string }|null} */ this._closeFrame = null;
    this._flushScheduled = false;
    /** @type {Promise<void>} */ this._inChain = Promise.resolve();
    /** @type {Promise<void>} */ this._outChain = Promise.resolve();

    /** @type {(v?: any) => void} */ let resolveReady = () => {};
    /** @type {(e: Error) => void} */ let rejectReady = () => {};
    /** Resolves when the handshake is complete (rejects on failure). */
    this.ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
    this.ready.catch(() => { /* observed via done/closeError too */ });
    this._resolveReady = resolveReady;
    this._rejectReady = rejectReady;
    /** @type {(v?: any) => void} */ let resolveDone = () => {};
    /** Resolves when the connection is closed (for any reason). */
    this.done = new Promise((res) => { resolveDone = res; });
    this._resolveDone = resolveDone;

    const tp = this._transportParams();
    this.tls = new TlsSession({
      send: () => {}, recv: async () => null,
      isServer: this.isServer,
      cert: opts.cert, selectCert: opts.selectCert, trustStore: opts.trustStore,
      serverName: opts.serverName, alpn: opts.alpn,
      keyLog: opts.keyLog,
      timeoutMs: opts.handshakeTimeoutMs ?? 10_000,
      sleepFn: (ms) => new Promise((r) => this._timer.schedule(() => r(undefined), ms)),
      now: opts.now,
      quic: {
        transportParams: tp,
        sendCrypto: (level, data) => {
          this.spaces[level].cryptoQueue.push(data);
          this._flushSoon();
        },
        onSecret: (level, dir, secret) => {
          this.spaces[level][dir] = packetKeysFromSecret(secret);
          if (dir === "read" && this._undecryptable[level].length) {
            const waiting = this._undecryptable[level].splice(0);
            this._inChain = this._inChain.then(async () => {
              for (const u of waiting) await this._processPacket(level, u.pkt, 0, u.pnOffset, u.pkt.length, u.long, u.scid, u.dcid);
              await this._flushNow();
            }).catch((e) => this._closeWith(e instanceof QuicError ? e : new QuicError(QUIC_ERROR.INTERNAL_ERROR, String(e?.message ?? e))));
          }
          this._flushSoon();
        },
        onAlert: (alert, reason) => this._closeWith(new QuicError(QUIC_ERROR.CRYPTO_ERROR + alert, reason)),
      },
    });
  }

  /** Negotiated ALPN protocol. */
  get alpn() { return this.tls.alpn; }

  /** Our transport parameters for the TLS handshake. */
  _transportParams() {
    /** @type {Array<[number, number|Uint8Array]>} */
    const p = [
      [TP.MAX_IDLE_TIMEOUT, this.idleTimeoutMs],
      [TP.MAX_UDP_PAYLOAD_SIZE, QUIC_MAX_DATAGRAM],
      [TP.INITIAL_MAX_DATA, this.localLimits.maxData],
      [TP.INITIAL_MAX_STREAM_DATA_BIDI_LOCAL, this.localLimits.maxStreamData],
      [TP.INITIAL_MAX_STREAM_DATA_BIDI_REMOTE, this.localLimits.maxStreamData],
      [TP.INITIAL_MAX_STREAM_DATA_UNI, this.localLimits.maxStreamData],
      [TP.INITIAL_MAX_STREAMS_BIDI, this.localLimits.maxStreamsBidi],
      [TP.INITIAL_MAX_STREAMS_UNI, this.localLimits.maxStreamsUni],
      [TP.ACTIVE_CONNECTION_ID_LIMIT, 2],
      [TP.INITIAL_SCID, this.scid],
    ];
    if (this.isServer) p.unshift([TP.ORIGINAL_DCID, this.originalDcid]);
    return encodeTransportParams(p);
  }

  /** Start the handshake (client: sends the first Initial). */
  start() {
    this._resetIdle();
    this.tls.handshake().then(async () => {
      this._applyPeerTransportParams();
      this.state = "connected";
      if (this.isServer) {
        // server: handshake complete = confirmed; tell the client (§4.1.2 RFC 9001)
        this._control.push({ type: QUIC_FRAME.HANDSHAKE_DONE });
        this._confirm();
      }
      this._resolveReady();
      this._flushSoon();
    }).catch((e) => {
      this._closeWith(e instanceof QuicError ? e : new QuicError(QUIC_ERROR.CRYPTO_ERROR + (e?.alert ?? 40), e instanceof Error ? e.message : String(e)));
    });
  }

  _applyPeerTransportParams() {
    const raw = this.tls.peerTransportParams;
    if (!raw) throw new QuicError(QUIC_ERROR.TRANSPORT_PARAMETER_ERROR, "no transport parameters");
    const m = decodeTransportParams(raw);
    // RFC 9000 §7.3: connection IDs must match what the packets said
    const iscid = m.get(TP.INITIAL_SCID);
    if (!iscid || !this._peerInitialScid || !eq(iscid, this._peerInitialScid)) {
      throw new QuicError(QUIC_ERROR.TRANSPORT_PARAMETER_ERROR, "initial_source_connection_id mismatch");
    }
    if (!this.isServer) {
      const odcid = m.get(TP.ORIGINAL_DCID);
      if (!odcid || !eq(odcid, this.originalDcid)) {
        throw new QuicError(QUIC_ERROR.TRANSPORT_PARAMETER_ERROR, "original_destination_connection_id mismatch");
      }
    }
    this._peerTp = m;
    this._peerMaxData = tpInt(m, TP.INITIAL_MAX_DATA, 0);
    this._peerStreamsBidi = tpInt(m, TP.INITIAL_MAX_STREAMS_BIDI, 0);
    this._peerStreamsUni = tpInt(m, TP.INITIAL_MAX_STREAMS_UNI, 0);
    const peerIdle = tpInt(m, TP.MAX_IDLE_TIMEOUT, 0);
    if (peerIdle > 0) this.idleTimeoutMs = Math.min(this.idleTimeoutMs, peerIdle);
    for (const s of this.streams.values()) s.peerMaxData = this._initialPeerStreamLimit(s);
  }

  /** @param {QuicStream} s */
  _initialPeerStreamLimit(s) {
    const m = this._peerTp;
    if (!m) return 0;
    if (s.uni) return tpInt(m, TP.INITIAL_MAX_STREAM_DATA_UNI, 0);
    // for a stream we opened, the peer's "bidi_remote" limit applies (§18.2)
    return tpInt(m, s.local ? TP.INITIAL_MAX_STREAM_DATA_BIDI_REMOTE : TP.INITIAL_MAX_STREAM_DATA_BIDI_LOCAL, 0);
  }

  _confirm() {
    if (this.handshakeConfirmed) return;
    this.handshakeConfirmed = true;
    // Initial and Handshake keys are discarded (RFC 9001 §4.9)
    for (const l of /** @type {Level[]} */ (["initial", "handshake"])) {
      const sp = this.spaces[l];
      sp.sent.clear();
      sp.resend = [];
      sp.ackPending = false;
      sp.write = null;
      sp.read = null;
    }
  }

  /**
   * Open a new stream.
   * @param {{ bidi?: boolean }} [o]
   */
  openStream(o = {}) {
    const bidi = o.bidi ?? true;
    const id = bidi ? this._nextBidi : this._nextUni;
    if (bidi) this._nextBidi += 4; else this._nextUni += 4;
    const limit = bidi ? this._peerStreamsBidi ?? 0 : this._peerStreamsUni ?? 0;
    if (Math.floor(id / 4) >= limit) throw new QuicError(QUIC_ERROR.STREAM_LIMIT_ERROR, "stream limit reached");
    return this._getStream(id);
  }

  /** @param {number} id */
  _getStream(id) {
    let s = this.streams.get(id);
    if (!s) {
      s = new QuicStream(this, id);
      s.recvMaxData = this.localLimits.maxStreamData;
      s.peerMaxData = this._initialPeerStreamLimit(s);
      this.streams.set(id, s);
    }
    return s;
  }

  /**
   * Close the connection with CONNECTION_CLOSE.
   * @param {number} [code] @param {string} [reason] @param {boolean} [app] application error (0x1d)
   */
  close(code = 0, reason = "", app = true) {
    if (this.state === "closed" || this.state === "closing") return;
    this._closeFrame = { code, app, reason };
    this.state = "closing";
    this._flushNow().finally(() => this._finish(null));
  }

  /** @param {QuicError} err */
  _closeWith(err) {
    if (this.state === "closed" || this.state === "closing") return;
    if (!err.remote) {
      this._closeFrame = { code: err.code, app: err.app, reason: err.message };
      this.state = "closing";
      this._flushNow().finally(() => this._finish(err));
    } else {
      this._finish(err);
    }
  }

  /** @param {Error|null} err */
  _finish(err) {
    if (this.state === "closed") return;
    this.state = "closed";
    this.closeError = err;
    if (this._ptoTimer !== null) this._timer.cancel(this._ptoTimer);
    if (this._idleTimer !== null) this._timer.cancel(this._idleTimer);
    const e = err ?? new QuicError(QUIC_ERROR.NO_ERROR, "connection closed");
    this._rejectReady(e);
    for (const s of this.streams.values()) s._fail(e);
    this._resolveDone();
  }

  _resetIdle() {
    if (this._idleTimer !== null) this._timer.cancel(this._idleTimer);
    this._idleTimer = this._timer.schedule(() => {
      this._idleTimer = null;
      // idle timeout: close silently (RFC 9000 §10.1)
      this._finish(new QuicError(QUIC_ERROR.NO_ERROR, "idle timeout"));
    }, this.idleTimeoutMs);
  }

  // ── receiving ──────────────────────────────────────────────────────────────

  /**
   * Feed one received UDP datagram (may hold several coalesced packets).
   * Processing is serialised; returns when this datagram is done.
   * @param {Uint8Array} dgram
   */
  handleDatagram(dgram) {
    const job = this._inChain.then(() => this._processDatagram(dgram)).catch((e) => {
      this._closeWith(e instanceof QuicError ? e : new QuicError(QUIC_ERROR.INTERNAL_ERROR, String(e?.message ?? e)));
    });
    this._inChain = job;
    return job;
  }

  /** @param {Uint8Array} dgram */
  async _processDatagram(dgram) {
    if (this.state === "closed") return;
    await this._initialReady;
    let off = 0;
    while (off < dgram.length) {
      const first = dgram[off];
      if ((first & 0x40) === 0) return; // fixed bit must be set; rest is padding/garbage
      if (first & 0x80) {
        const r = new QuicReader(dgram, off);
        r.u8();
        const version = r.u32();
        const dcid = r.bytes(r.u8()).slice();
        const scid = r.bytes(r.u8()).slice();
        if (version !== QUIC_VERSION_1) return;
        const type = (first >> 4) & 0x03;
        if (type === LONG_TYPE.INITIAL) r.bytes(r.varint()); // token
        else if (type !== LONG_TYPE.HANDSHAKE) return;       // 0-RTT / Retry: not supported
        const len = r.varint();
        const pnOffset = r.pos;
        const end = pnOffset + len;
        if (end > dgram.length) return;
        const level = type === LONG_TYPE.INITIAL ? "initial" : "handshake";
        await this._processPacket(level, dgram, off, pnOffset, end, true, scid, dcid);
        off = end;
      } else {
        await this._processPacket("app", dgram, off, off + 1 + CID_LEN, dgram.length, false, null, dgram.subarray(off + 1, off + 1 + CID_LEN));
        off = dgram.length;
      }
    }
    await this._flushNow();
  }

  /**
   * @param {Level} level @param {Uint8Array} dgram @param {number} start @param {number} pnOffset
   * @param {number} end @param {boolean} long @param {Uint8Array|null} scid @param {Uint8Array} dcid
   */
  async _processPacket(level, dgram, start, pnOffset, end, long, scid, dcid) {
    const sp = this.spaces[level];
    if (!eq(dcid, this.scid) && !(this.isServer && level === "initial" && eq(dcid, this.originalDcid))) return;
    if (!sp.read) {
      // not yet: buffer a few packets until the keys exist; afterwards: drop
      if (!this.handshakeConfirmed && level !== "initial" && this._undecryptable[level].length < 8) {
        this._undecryptable[level].push({ pkt: dgram.slice(start, end), pnOffset: pnOffset - start, long, scid, dcid: dcid.slice() });
      }
      return;
    }
    const keys = await sp.read;
    const p = await unprotectPacket(keys, dgram, start, pnOffset, end, long, sp.largestRecv);
    if (!p) return; // authentication failed: drop silently (§12.2)
    if (this._isDuplicate(sp, p.pn)) return;
    this._resetIdle();
    if (long && scid && !this.isServer && !this._dcidFromServer) {
      // the server's chosen connection ID replaces our random initial DCID (§7.2)
      this.dcid = scid;
      this._peerInitialScid = scid;
      this._dcidFromServer = true;
    }
    if (this.isServer && level === "handshake") {
      // a Handshake packet from the client validates its address; Initial is done (§4.9.1 RFC 9001)
      const ini = this.spaces.initial;
      ini.write = null;
      ini.sent.clear();
      ini.resend = [];
      ini.ackPending = false;
    }
    /** @type {string[]} */
    const names = [];
    const ackEliciting = this._processFrames(level, p.payload, names);
    this._recordReceived(sp, p.pn, ackEliciting);
    this.onPacket?.("in", level, p.pn, names);
  }

  /** @param {Space} sp @param {number} pn */
  _isDuplicate(sp, pn) {
    return sp.ranges.some(([lo, hi]) => pn >= lo && pn <= hi);
  }

  /** @param {Space} sp @param {number} pn @param {boolean} ackEliciting */
  _recordReceived(sp, pn, ackEliciting) {
    if (pn > sp.largestRecv) sp.largestRecv = pn;
    // keep ranges sorted descending and merged
    sp.ranges.push([pn, pn]);
    sp.ranges.sort((a, b) => b[1] - a[1]);
    /** @type {Array<[number, number]>} */
    const merged = [];
    for (const r of sp.ranges) {
      const last = merged[merged.length - 1];
      if (last && r[1] >= last[0] - 1) last[0] = Math.min(last[0], r[0]);
      else merged.push([r[0], r[1]]);
    }
    sp.ranges = merged.slice(0, 32);
    if (ackEliciting) sp.ackPending = true;
  }

  /**
   * @param {Level} level @param {Uint8Array} payload @param {string[]} names
   * @returns {boolean} ack-eliciting
   */
  _processFrames(level, payload, names) {
    const r = new QuicReader(payload);
    let ackEliciting = false;
    while (r.left > 0) {
      const type = r.varint();
      if (type === QUIC_FRAME.PADDING) { while (r.left > 0 && r.buf[r.pos] === 0) r.pos++; names.push("PADDING"); continue; }
      if (type !== QUIC_FRAME.ACK && type !== QUIC_FRAME.ACK_ECN && type !== QUIC_FRAME.CONNECTION_CLOSE && type !== QUIC_FRAME.CONNECTION_CLOSE_APP) {
        ackEliciting = true;
      }
      // §12.4: only some frames are allowed in Initial / Handshake packets
      if (level !== "app" && !/** @type {number[]} */ ([QUIC_FRAME.PING, QUIC_FRAME.ACK, QUIC_FRAME.ACK_ECN, QUIC_FRAME.CRYPTO, QUIC_FRAME.CONNECTION_CLOSE]).includes(type)) {
        throw new QuicError(QUIC_ERROR.PROTOCOL_VIOLATION, `frame 0x${type.toString(16)} not allowed at ${level} level`);
      }
      switch (type) {
        case QUIC_FRAME.PING: names.push("PING"); break;
        case QUIC_FRAME.ACK:
        case QUIC_FRAME.ACK_ECN: {
          names.push("ACK");
          this._onAck(level, r, type === QUIC_FRAME.ACK_ECN);
          break;
        }
        case QUIC_FRAME.CRYPTO: {
          const offset = r.varint();
          const data = r.bytes(r.varint()).slice();
          names.push("CRYPTO");
          this._onCrypto(level, offset, data);
          break;
        }
        case QUIC_FRAME.NEW_TOKEN: r.bytes(r.varint()); names.push("NEW_TOKEN"); break;
        case QUIC_FRAME.RESET_STREAM: {
          const id = r.varint(); const code = r.varint(); r.varint();
          names.push("RESET_STREAM");
          const s = this.streams.get(id);
          if (s) { s.onreset?.(code); s._fail(new QuicError(code, `stream ${id} reset`, { remote: true, app: true })); }
          break;
        }
        case QUIC_FRAME.STOP_SENDING: r.varint(); r.varint(); names.push("STOP_SENDING"); break;
        case QUIC_FRAME.MAX_DATA: {
          const v = r.varint();
          names.push("MAX_DATA");
          if (v > this._peerMaxData) this._peerMaxData = v;
          break;
        }
        case QUIC_FRAME.MAX_STREAM_DATA: {
          const id = r.varint(); const v = r.varint();
          names.push("MAX_STREAM_DATA");
          const s = this.streams.get(id);
          if (s && v > s.peerMaxData) s.peerMaxData = v;
          break;
        }
        case QUIC_FRAME.MAX_STREAMS_BIDI: { const v = r.varint(); names.push("MAX_STREAMS"); this._peerStreamsBidi = Math.max(this._peerStreamsBidi ?? 0, v); break; }
        case QUIC_FRAME.MAX_STREAMS_UNI: { const v = r.varint(); names.push("MAX_STREAMS"); this._peerStreamsUni = Math.max(this._peerStreamsUni ?? 0, v); break; }
        case QUIC_FRAME.DATA_BLOCKED: r.varint(); names.push("DATA_BLOCKED"); break;
        case QUIC_FRAME.STREAM_DATA_BLOCKED: r.varint(); r.varint(); names.push("STREAM_DATA_BLOCKED"); break;
        case QUIC_FRAME.STREAMS_BLOCKED_BIDI:
        case QUIC_FRAME.STREAMS_BLOCKED_UNI: r.varint(); names.push("STREAMS_BLOCKED"); break;
        case QUIC_FRAME.NEW_CONNECTION_ID: {
          r.varint(); r.varint(); r.bytes(r.u8()); r.bytes(16);
          names.push("NEW_CONNECTION_ID"); // we keep using the current ID
          break;
        }
        case QUIC_FRAME.RETIRE_CONNECTION_ID: r.varint(); names.push("RETIRE_CONNECTION_ID"); break;
        case QUIC_FRAME.PATH_CHALLENGE: {
          const data = r.bytes(8).slice();
          names.push("PATH_CHALLENGE");
          this._control.push({ type: QUIC_FRAME.PATH_RESPONSE, data });
          break;
        }
        case QUIC_FRAME.PATH_RESPONSE: r.bytes(8); names.push("PATH_RESPONSE"); break;
        case QUIC_FRAME.CONNECTION_CLOSE:
        case QUIC_FRAME.CONNECTION_CLOSE_APP: {
          const code = r.varint();
          if (type === QUIC_FRAME.CONNECTION_CLOSE) r.varint(); // frame type
          const reason = new TextDecoder().decode(r.bytes(r.varint()));
          names.push("CONNECTION_CLOSE");
          this._finish(code === 0 && type === QUIC_FRAME.CONNECTION_CLOSE_APP ? null
            : new QuicError(code, `peer closed: ${reason || `0x${code.toString(16)}`}`, { remote: true, app: type === QUIC_FRAME.CONNECTION_CLOSE_APP }));
          return ackEliciting;
        }
        case QUIC_FRAME.HANDSHAKE_DONE: {
          names.push("HANDSHAKE_DONE");
          if (this.isServer) throw new QuicError(QUIC_ERROR.PROTOCOL_VIOLATION, "HANDSHAKE_DONE from client");
          this._confirm();
          break;
        }
        default: {
          if (type >= QUIC_FRAME.STREAM && type <= 0x0f) {
            const id = r.varint();
            const offset = type & 0x04 ? r.varint() : 0;
            const len = type & 0x02 ? r.varint() : r.left;
            const data = r.bytes(len).slice();
            names.push("STREAM");
            this._onStreamFrame(id, offset, data, (type & 0x01) !== 0);
            break;
          }
          throw new QuicError(QUIC_ERROR.FRAME_ENCODING_ERROR, `unknown frame type 0x${type.toString(16)}`);
        }
      }
    }
    return ackEliciting;
  }

  /** @param {Level} level @param {QuicReader} r @param {boolean} ecn */
  _onAck(level, r, ecn) {
    const sp = this.spaces[level];
    const largest = r.varint();
    r.varint(); // ack delay
    const count = r.varint();
    let hi = largest;
    let lo = hi - r.varint();
    /** @type {Array<[number, number]>} */
    const ranges = [[lo, hi]];
    for (let i = 0; i < count; i++) {
      const gap = r.varint();
      hi = lo - gap - 2;
      lo = hi - r.varint();
      ranges.push([lo, hi]);
    }
    if (ecn) { r.varint(); r.varint(); r.varint(); }
    if (largest >= sp.pn) throw new QuicError(QUIC_ERROR.PROTOCOL_VIOLATION, "ACK for an unsent packet");
    const now = this._clock();
    const largestPkt = sp.sent.get(largest);
    if (largestPkt && largestPkt.ackEliciting) {
      const sample = Math.max(now - largestPkt.time, 1);
      this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.srtt - sample);
      this.srtt = 0.875 * this.srtt + 0.125 * sample;
    }
    let newlyAcked = false;
    for (const [a, b] of ranges) {
      for (const pn of [...sp.sent.keys()]) {
        if (pn >= a && pn <= b) { sp.sent.delete(pn); newlyAcked = true; }
      }
    }
    if (largest > sp.largestAcked) sp.largestAcked = largest;
    // packet threshold loss detection (RFC 9002 §6.1.1)
    for (const [pn, pkt] of [...sp.sent]) {
      if (pn <= sp.largestAcked - 3) {
        sp.sent.delete(pn);
        sp.resend.push(...pkt.frames);
      }
    }
    if (newlyAcked) this._ptoCount = 0;
    this._armPto();
  }

  /** @param {Level} level @param {number} offset @param {Uint8Array} data */
  _onCrypto(level, offset, data) {
    const sp = this.spaces[level];
    if (offset + data.length <= sp.cryptoRead) return;
    sp.cryptoRecv.set(offset, data);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [off, seg] of sp.cryptoRecv) {
        if (off <= sp.cryptoRead && off + seg.length > sp.cryptoRead) {
          const chunk = seg.subarray(sp.cryptoRead - off);
          sp.cryptoRecv.delete(off);
          sp.cryptoRead += chunk.length;
          if (level !== "app") this.tls.provideCrypto(level, chunk);
          progressed = true;
          break;
        } else if (off + seg.length <= sp.cryptoRead) {
          sp.cryptoRecv.delete(off);
        }
      }
    }
  }

  /** @param {number} id @param {number} offset @param {Uint8Array} data @param {boolean} fin */
  _onStreamFrame(id, offset, data, fin) {
    const peerInitiated = ((id & 0x1) === 1) !== this.isServer;
    const uni = (id & 0x2) !== 0;
    if (!peerInitiated && uni) throw new QuicError(QUIC_ERROR.STREAM_STATE_ERROR, "data on our send-only stream");
    let s = this.streams.get(id);
    if (!s) {
      if (!peerInitiated) return; // stream we already forgot
      const limit = uni ? this.localLimits.maxStreamsUni : this.localLimits.maxStreamsBidi;
      if (Math.floor(id / 4) >= limit) throw new QuicError(QUIC_ERROR.STREAM_LIMIT_ERROR, "too many streams");
      // streams of a type open in order: lower ids exist implicitly (§3.2)
      s = this._getStream(id);
      this.onStream?.(s);
    }
    if (this._sumRecv(id, offset + data.length) > this._recvMaxData) {
      throw new QuicError(QUIC_ERROR.FLOW_CONTROL_ERROR, "connection flow control");
    }
    s._receive(offset, data, fin);
  }

  /** Highest offsets seen per stream, for connection-level flow control. */
  _sumRecv(/** @type {number} */ id, /** @type {number} */ end) {
    this._recvHigh ??= new Map();
    const prev = this._recvHigh.get(id) ?? 0;
    if (end > prev) { this._recvHigh.set(id, end); this._recvTotal = (this._recvTotal ?? 0) + end - prev; }
    return this._recvTotal ?? 0;
  }
  /** @type {Map<number, number>|undefined} */ _recvHigh;
  /** @type {number|undefined} */ _recvTotal;
  /** @type {number|undefined} */ _peerStreamsBidi;
  /** @type {number|undefined} */ _peerStreamsUni;

  /**
   * The application read data: extend the peer's credit when half used.
   * @param {QuicStream} s @param {number} n
   */
  _consumed(s, n) {
    this._recvConsumed += n;
    if (this._recvMaxData - this._recvConsumed < this.localLimits.maxData / 2) {
      this._recvMaxData = this._recvConsumed + this.localLimits.maxData;
      this._control.push({ type: QUIC_FRAME.MAX_DATA, value: this._recvMaxData });
    }
    if (!s.ended && s.recvMaxData - s.readOffset < this.localLimits.maxStreamData / 2) {
      s.recvMaxData = s.readOffset + this.localLimits.maxStreamData;
      this._control.push({ type: QUIC_FRAME.MAX_STREAM_DATA, id: s.id, value: s.recvMaxData });
    }
  }

  // ── sending ────────────────────────────────────────────────────────────────

  _flushSoon() {
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    queueMicrotask(() => { this._flushScheduled = false; this._flushNow(); });
  }

  /** Build and send datagrams until nothing is left to send. */
  _flushNow() {
    const job = this._outChain.then(() => this._flush()).catch((e) => {
      this._finish(e instanceof QuicError ? e : new QuicError(QUIC_ERROR.INTERNAL_ERROR, String(e?.message ?? e)));
    });
    this._outChain = job;
    return job;
  }

  async _flush() {
    if (this.state === "closed") return;
    await this._initialReady;
    for (let guard = 0; guard < 1000; guard++) {
      /** @type {Uint8Array[]} */
      const packets = [];
      let room = QUIC_MAX_DATAGRAM;
      let hasInitial = false;
      for (const level of LEVELS) {
        if (room < 64) break;
        const pkt = await this._buildPacket(level, room, false);
        if (!pkt) continue;
        packets.push(pkt.bytes);
        room -= pkt.bytes.length;
        if (level === "initial" && pkt.ackEliciting) hasInitial = true;
      }
      if (packets.length === 0) break;
      if (hasInitial && room > 0) {
        // §14.1: datagrams with ack-eliciting Initial packets are at least 1200 bytes.
        // Rebuild the last packet... simpler: append PADDING inside an extra
        // packet is not allowed for Initial-only datagrams, so pad the Initial itself.
        const padded = await this._padInitialDatagram(packets, room);
        this._emit(padded);
      } else {
        this._emit(concat(packets));
      }
    }
    if (this._closeFrame && this.state === "closing") return;
    this._armPto();
  }

  /** @param {Uint8Array} bytes */
  _emit(bytes) {
    try { this._sendDatagram(bytes); } catch { /* network errors surface as loss */ }
  }

  /**
   * The Initial packet was built first; rebuild it with PADDING so the whole
   * datagram reaches 1200 bytes, keeping the other coalesced packets.
   * @param {Uint8Array[]} packets @param {number} room
   */
  async _padInitialDatagram(packets, room) {
    const last = this._lastInitial;
    if (!last) return concat(packets);
    const sp = this.spaces.initial;
    // undo the bookkeeping of the original Initial and rebuild it larger
    sp.sent.delete(last.pn);
    const keys = /** @type {PacketKeys} */ (await sp.write);
    const payload = concat([last.payload, new Uint8Array(room)]); // PADDING frames are zero bytes
    const bytes = await this._sealLong(LONG_TYPE.INITIAL, keys, last.pn, payload);
    sp.sent.set(last.pn, { frames: last.frames, ackEliciting: true, time: this._clock(), size: bytes.length });
    packets[0] = bytes;
    return concat(packets);
  }
  /** @type {{ pn: number, payload: Uint8Array, frames: any[] }|null} */ _lastInitial = null;
  /** Levels that already carried our CONNECTION_CLOSE. @type {Set<Level>} */ _closeSentAt = new Set();
  /**
   * Packets that arrived before their keys (e.g. a Handshake packet coalesced
   * behind the ServerHello): kept and processed once the keys exist (§5.7 RFC 9001).
   * @type {Record<Level, Array<{ pkt: Uint8Array, pnOffset: number, long: boolean, scid: Uint8Array|null, dcid: Uint8Array }>>}
   */
  _undecryptable = { initial: [], handshake: [], app: [] };

  /**
   * @param {number} type @param {PacketKeys} keys @param {number} pn @param {Uint8Array} payload
   */
  async _sealLong(type, keys, pn, payload) {
    const len = PN_LEN + payload.length + TAG_LEN;
    const header = concat([
      Uint8Array.of(0xc0 | (type << 4) | (PN_LEN - 1)),
      Uint8Array.of(0, 0, 0, 1),
      Uint8Array.of(this.dcid.length), this.dcid,
      Uint8Array.of(this.scid.length), this.scid,
      ...(type === LONG_TYPE.INITIAL ? [encodeVarint(0)] : []), // no token
      varint2(len),
      Uint8Array.of((pn >>> 24) & 0xff, (pn >>> 16) & 0xff, (pn >>> 8) & 0xff, pn & 0xff),
    ]);
    return protectPacket(keys, header, pn, payload, true);
  }

  /** @param {PacketKeys} keys @param {number} pn @param {Uint8Array} payload */
  async _sealShort(keys, pn, payload) {
    const header = concat([
      Uint8Array.of(0x40 | (PN_LEN - 1)),
      this.dcid,
      Uint8Array.of((pn >>> 24) & 0xff, (pn >>> 16) & 0xff, (pn >>> 8) & 0xff, pn & 0xff),
    ]);
    return protectPacket(keys, header, pn, payload, false);
  }

  /**
   * Build one packet at `level` that fits into `room` bytes, or null when
   * there is nothing to send there.
   * @param {Level} level @param {number} room @param {boolean} probe add a PING if nothing else
   */
  async _buildPacket(level, room, probe) {
    const sp = this.spaces[level];
    if (!sp.write) return null;
    const overhead = (level === "app" ? 1 + this.dcid.length : 1 + 4 + 1 + this.dcid.length + 1 + this.scid.length + (level === "initial" ? 1 : 0) + 2) + PN_LEN + TAG_LEN;
    let budget = room - overhead;
    if (budget < 20) return null;
    /** @type {Uint8Array[]} */
    const parts = [];
    /** @type {any[]} */
    const frames = [];
    let ackEliciting = false;
    const names = [];

    // CONNECTION_CLOSE ends everything (§10.2)
    if (this._closeFrame && this.state === "closing") {
      if (this._closeSentAt.has(level)) return null;
      const reason = new TextEncoder().encode(this._closeFrame.reason.slice(0, 100));
      // before the handshake is done, application errors become transport errors (§10.2.3)
      const app = this._closeFrame.app && level === "app";
      parts.push(app
        ? concat([encodeVarint(QUIC_FRAME.CONNECTION_CLOSE_APP), encodeVarint(this._closeFrame.code), encodeVarint(reason.length), reason])
        : concat([encodeVarint(QUIC_FRAME.CONNECTION_CLOSE), encodeVarint(this._closeFrame.app ? QUIC_ERROR.NO_ERROR : this._closeFrame.code), encodeVarint(0), encodeVarint(reason.length), reason]));
      this._closeSentAt.add(level);
      // only the highest available level carries it
      const higher = LEVELS.slice(LEVELS.indexOf(level) + 1).some(l => this.spaces[l].write);
      if (higher) return null;
      const keys = /** @type {PacketKeys} */ (await sp.write);
      const pn = sp.pn++;
      const payload = this._padForSample(concat(parts));
      const bytes = level === "app" ? await this._sealShort(keys, pn, payload)
        : await this._sealLong(level === "initial" ? LONG_TYPE.INITIAL : LONG_TYPE.HANDSHAKE, keys, pn, payload);
      return { bytes, ackEliciting: false };
    }

    if (sp.ackPending && sp.ranges.length) {
      const ack = this._encodeAck(sp);
      if (ack.length <= budget) { parts.push(ack); budget -= ack.length; sp.ackPending = false; names.push("ACK"); }
    }

    /** @param {any} f */
    const addFrame = (f) => {
      const b = this._encodeFrame(f);
      if (b.length > budget) return false;
      parts.push(b); budget -= b.length; frames.push(f); ackEliciting = true; names.push(f.name ?? frameName(f.type));
      return true;
    };

    // retransmissions first
    while (sp.resend.length) {
      const f = sp.resend[0];
      if (f.type === QUIC_FRAME.CRYPTO || f.type === QUIC_FRAME.STREAM) {
        const fixed = this._encodeFrame({ ...f, data: new Uint8Array(0) }).length;
        if (fixed + 1 >= budget) break;
        if (fixed + f.data.length > budget) {
          // split the frame
          const take = budget - fixed - 2;
          if (take <= 0) break;
          sp.resend[0] = { ...f, offset: f.offset + take, data: f.data.subarray(take) };
          addFrame({ ...f, data: f.data.subarray(0, take), fin: false });
          continue;
        }
      }
      if (!addFrame(f)) break;
      sp.resend.shift();
    }

    // new CRYPTO data
    while (sp.cryptoQueue.length && budget > 24) {
      const data = sp.cryptoQueue[0];
      const fixed = 1 + encodeVarint(sp.cryptoSend).length + 2;
      const take = Math.min(data.length, budget - fixed - 2);
      if (take <= 0) break;
      const f = { type: QUIC_FRAME.CRYPTO, offset: sp.cryptoSend, data: data.subarray(0, take) };
      if (!addFrame(f)) break;
      sp.cryptoSend += take;
      if (take === data.length) sp.cryptoQueue.shift(); else sp.cryptoQueue[0] = data.subarray(take);
    }

    if (level === "app" && this.state !== "handshake") {
      while (this._control.length) {
        if (!addFrame(this._control[0])) break;
        this._control.shift();
      }
      // stream data, round-robin over streams with queued data
      for (const s of this.streams.values()) {
        while ((s._sendQueue.length || (s._finQueued && !s.sendFin)) && budget > 24) {
          const connCredit = this._peerMaxData - this._sentData;
          const streamCredit = s.peerMaxData - s.sendOffset;
          const data = s._sendQueue[0] ?? new Uint8Array(0);
          const fixed = 1 + encodeVarint(s.id).length + encodeVarint(s.sendOffset).length + 2;
          const take = Math.min(data.length, budget - fixed - 2, connCredit, streamCredit);
          if (take < 0 || (take === 0 && data.length > 0)) break; // blocked by flow control or space
          const chunk = data.subarray(0, take);
          const last = take === data.length && s._sendQueue.length <= 1;
          const fin = last && s._finQueued;
          const f = { type: QUIC_FRAME.STREAM, id: s.id, offset: s.sendOffset, data: chunk, fin };
          if (!addFrame(f)) break;
          s.sendOffset += take;
          this._sentData += take;
          if (take === data.length) s._sendQueue.shift(); else s._sendQueue[0] = data.subarray(take);
          if (fin) s.sendFin = true;
          if (data.length === 0) s._sendQueue.shift();
        }
      }
    }

    if (probe && !ackEliciting) addFrame({ type: QUIC_FRAME.PING });
    if (parts.length === 0) return null;

    const keys = /** @type {PacketKeys} */ (await sp.write);
    const pn = sp.pn++;
    const payload = this._padForSample(concat(parts));
    const bytes = level === "app" ? await this._sealShort(keys, pn, payload)
      : await this._sealLong(level === "initial" ? LONG_TYPE.INITIAL : LONG_TYPE.HANDSHAKE, keys, pn, payload);
    if (ackEliciting) sp.sent.set(pn, { frames, ackEliciting, time: this._clock(), size: bytes.length });
    if (level === "initial") this._lastInitial = ackEliciting ? { pn, payload, frames } : null;
    this.onPacket?.("out", level, pn, names);
    return { bytes, ackEliciting };
  }

  /** The header-protection sample needs 4 bytes after a 4-byte PN (§5.4.2); with PN_LEN 4 the tag suffices. @param {Uint8Array} p */
  _padForSample(p) {
    return p.length >= 4 ? p : concat([p, new Uint8Array(4 - p.length)]);
  }

  /** @param {Space} sp */
  _encodeAck(sp) {
    const [first, ...rest] = sp.ranges;
    /** @type {Uint8Array[]} */
    const out = [encodeVarint(QUIC_FRAME.ACK), encodeVarint(first[1]), encodeVarint(0), encodeVarint(rest.length), encodeVarint(first[1] - first[0])];
    let prevLo = first[0];
    for (const [lo, hi] of rest) {
      out.push(encodeVarint(prevLo - hi - 2), encodeVarint(hi - lo));
      prevLo = lo;
    }
    return concat(out);
  }

  /** @param {any} f */
  _encodeFrame(f) {
    switch (f.type) {
      case QUIC_FRAME.PING: return Uint8Array.of(QUIC_FRAME.PING);
      case QUIC_FRAME.HANDSHAKE_DONE: return Uint8Array.of(QUIC_FRAME.HANDSHAKE_DONE);
      case QUIC_FRAME.CRYPTO:
        return concat([encodeVarint(QUIC_FRAME.CRYPTO), encodeVarint(f.offset), encodeVarint(f.data.length), f.data]);
      case QUIC_FRAME.STREAM: {
        const t = QUIC_FRAME.STREAM | (f.offset > 0 ? 0x04 : 0) | 0x02 | (f.fin ? 0x01 : 0);
        return concat([encodeVarint(t), encodeVarint(f.id), ...(f.offset > 0 ? [encodeVarint(f.offset)] : []), encodeVarint(f.data.length), f.data]);
      }
      case QUIC_FRAME.MAX_DATA: return concat([encodeVarint(QUIC_FRAME.MAX_DATA), encodeVarint(f.value)]);
      case QUIC_FRAME.MAX_STREAM_DATA: return concat([encodeVarint(QUIC_FRAME.MAX_STREAM_DATA), encodeVarint(f.id), encodeVarint(f.value)]);
      case QUIC_FRAME.PATH_RESPONSE: return concat([encodeVarint(QUIC_FRAME.PATH_RESPONSE), f.data]);
      default: throw new Error(`cannot encode frame ${f.type}`);
    }
  }

  // ── loss recovery timer (RFC 9002 §6.2) ────────────────────────────────────

  _armPto() {
    if (this._ptoTimer !== null) { this._timer.cancel(this._ptoTimer); this._ptoTimer = null; }
    if (this.state === "closed" || this.state === "closing") return;
    const inFlight = LEVELS.some(l => this.spaces[l].sent.size > 0);
    // before the handshake completes the client must keep probing (anti-deadlock, §6.2.2.1)
    const clientWaiting = !this.isServer && !this.handshakeConfirmed && this.state === "handshake";
    if (!inFlight && !clientWaiting) return;
    const pto = (this.srtt + Math.max(4 * this.rttvar, 1)) * 2 ** this._ptoCount;
    this._ptoTimer = this._timer.schedule(() => this._onPto(), pto);
  }

  _onPto() {
    this._ptoTimer = null;
    if (this.state === "closed") return;
    this._ptoCount++;
    let any = false;
    for (const l of LEVELS) {
      const sp = this.spaces[l];
      for (const [pn, pkt] of [...sp.sent]) {
        sp.sent.delete(pn);
        sp.resend.push(...pkt.frames);
        any = true;
      }
    }
    if (!any) {
      // nothing outstanding: send a probe (PING) at the highest available level
      const level = [...LEVELS].reverse().find(l => this.spaces[l].write && (l !== "app" || this.state !== "handshake"));
      if (level) this.spaces[level].resend.push({ type: QUIC_FRAME.PING });
    }
    this._flushNow();
  }
}

/** @param {number} type */
function frameName(type) {
  const e = Object.entries(QUIC_FRAME).find(([, v]) => v === type);
  return e ? e[0] : `0x${type.toString(16)}`;
}

// ── server-side demultiplexing ───────────────────────────────────────────────

/**
 * Accepts QUIC connections on one UDP socket: maps connection IDs to
 * connections and creates a new one for each client Initial.
 */
export class QuicServer {
  /**
   * @param {{
   *   send: (bytes: Uint8Array, peer: any) => void,
   *   alpn: string[],
   *   cert?: any, selectCert?: (sni: string) => any,
   *   onConnection: (conn: QuicConnection, peer: any) => void,
   *   connOptions?: Partial<ConstructorParameters<typeof QuicConnection>[0]>,
   * }} opts
   */
  constructor(opts) {
    this.opts = opts;
    /** @type {Map<string, QuicConnection>} */
    this.byCid = new Map();
  }

  /**
   * @param {Uint8Array} dgram @param {any} peer opaque address, passed back to send()
   */
  handleDatagram(dgram, peer) {
    if (dgram.length < 1 + CID_LEN) return;
    const first = dgram[0];
    /** @type {Uint8Array} */
    let dcid;
    if (first & 0x80) {
      if (dgram.length < 7) return;
      const dl = dgram[5];
      dcid = dgram.subarray(6, 6 + dl);
    } else {
      dcid = dgram.subarray(1, 1 + CID_LEN);
    }
    const conn = this.byCid.get(hex(dcid));
    if (conn) { conn.handleDatagram(dgram); return; }

    // new connection: only a client Initial in a full-size datagram (§14.1)
    if (!(first & 0x80) || ((first >> 4) & 0x03) !== LONG_TYPE.INITIAL) return;
    if (dgram.length < QUIC_MAX_DATAGRAM || dcid.length < 8) return;
    const r = new QuicReader(dgram, 1);
    if (r.u32() !== QUIC_VERSION_1) return; // version negotiation not implemented
    r.bytes(r.u8());
    const scid = r.bytes(r.u8()).slice();
    const c = new QuicConnection({
      ...(this.opts.connOptions ?? {}),
      isServer: true,
      sendDatagram: (b) => this.opts.send(b, peer),
      alpn: this.opts.alpn,
      cert: this.opts.cert,
      selectCert: this.opts.selectCert,
      originalDcid: dcid.slice(),
      peerScid: scid,
    });
    const keys = [hex(dcid), hex(c.scid)];
    for (const k of keys) this.byCid.set(k, c);
    c.done.then(() => { for (const k of keys) if (this.byCid.get(k) === c) this.byCid.delete(k); });
    this.opts.onConnection(c, peer);
    c.start();
    c.handleDatagram(dgram);
  }

  /** Close every connection; resolves when all are closed. */
  closeAll() {
    const conns = [...new Set(this.byCid.values())];
    for (const c of conns) c.close(0x100, "server shutting down"); // H3_NO_ERROR
    return Promise.all(conns.map(c => c.done)).then(() => undefined);
  }
}
