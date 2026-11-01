//@ts-check

/**
 * HTTP/2 connection (RFC 9113) over any byte transport ({ send, recv }) —
 * plain TCP for h2c with prior knowledge, or a TLS session after ALPN "h2".
 *
 * One class serves both roles:
 *  - client: `request()` opens a stream per request; several requests run
 *    multiplexed over the one connection.
 *  - server: `onRequest(req, res)` is called once a request is complete.
 *
 * Implemented: frame layer with size checks, SETTINGS + ACK, HEADERS +
 * CONTINUATION, DATA with connection/stream flow control (WINDOW_UPDATE),
 * PING, RST_STREAM, GOAWAY, PRIORITY (parsed, ignored), HPACK. Not
 * implemented: server push (we send SETTINGS_ENABLE_PUSH=0 and never push),
 * stream prioritisation, CONNECT.
 */

import { HpackEncoder, HpackDecoder, HpackError } from "./Hpack.js";

// ── constants ────────────────────────────────────────────────────────────────

export const H2_FRAME = Object.freeze({
  DATA: 0x0, HEADERS: 0x1, PRIORITY: 0x2, RST_STREAM: 0x3, SETTINGS: 0x4,
  PUSH_PROMISE: 0x5, PING: 0x6, GOAWAY: 0x7, WINDOW_UPDATE: 0x8, CONTINUATION: 0x9,
});

export const H2_FLAG = Object.freeze({
  END_STREAM: 0x1, ACK: 0x1, END_HEADERS: 0x4, PADDED: 0x8, PRIORITY: 0x20,
});

export const H2_SETTING = Object.freeze({
  HEADER_TABLE_SIZE: 0x1, ENABLE_PUSH: 0x2, MAX_CONCURRENT_STREAMS: 0x3,
  INITIAL_WINDOW_SIZE: 0x4, MAX_FRAME_SIZE: 0x5, MAX_HEADER_LIST_SIZE: 0x6,
});

export const H2_ERROR = Object.freeze({
  NO_ERROR: 0x0, PROTOCOL_ERROR: 0x1, INTERNAL_ERROR: 0x2, FLOW_CONTROL_ERROR: 0x3,
  SETTINGS_TIMEOUT: 0x4, STREAM_CLOSED: 0x5, FRAME_SIZE_ERROR: 0x6, REFUSED_STREAM: 0x7,
  CANCEL: 0x8, COMPRESSION_ERROR: 0x9, CONNECT_ERROR: 0xa, ENHANCE_YOUR_CALM: 0xb,
  INADEQUATE_SECURITY: 0xc, HTTP_1_1_REQUIRED: 0xd,
});

const ERROR_NAMES = Object.fromEntries(Object.entries(H2_ERROR).map(([k, v]) => [v, k]));

/** @param {number} code */
export function h2ErrorName(code) {
  return ERROR_NAMES[code] ?? `0x${code.toString(16)}`;
}

/** Client connection preface (RFC 9113 §3.4). */
export const H2_PREFACE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

const DEFAULT_WINDOW = 65535;
const MAX_WINDOW = 0x7fffffff;
const DEFAULT_MAX_FRAME = 16384;

/** Connection-specific fields are forbidden in HTTP/2 (RFC 9113 §8.2.2). */
const CONNECTION_SPECIFIC = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade"]);

// ── errors ───────────────────────────────────────────────────────────────────

export class Http2Error extends Error {
  /**
   * @param {number} code H2_ERROR value
   * @param {string} message
   * @param {{ streamId?: number, remote?: boolean, retryable?: boolean }} [opts]
   *   streamId 0 = connection error; remote = the peer reported it (RST/GOAWAY);
   *   retryable = request was never processed (GOAWAY, REFUSED_STREAM)
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = "Http2Error";
    this.code = code;
    this.streamId = opts.streamId ?? 0;
    this.remote = opts.remote ?? false;
    this.retryable = opts.retryable ?? false;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** @param {Uint8Array} b @param {number} o */
const read32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** @param {number} v */
const u32 = (v) => Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);

/** @param {Uint8Array[]} parts */
function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Strip padding (and the priority fields of HEADERS) from a frame payload.
 * @param {number} flags
 * @param {Uint8Array} payload
 * @param {boolean} hasPriority
 * @param {number} streamId
 */
function unpad(flags, payload, hasPriority, streamId) {
  let start = 0, end = payload.length;
  if (flags & H2_FLAG.PADDED) {
    if (payload.length < 1) throw new Http2Error(H2_ERROR.FRAME_SIZE_ERROR, "padded frame without pad length");
    const pad = payload[0];
    start = 1;
    if (pad >= payload.length) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "padding exceeds payload");
    end -= pad;
  }
  if (hasPriority) {
    if (end - start < 5) throw new Http2Error(H2_ERROR.FRAME_SIZE_ERROR, "HEADERS priority truncated");
    const dep = read32(payload, start) & 0x7fffffff;
    if (dep === streamId) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "stream depends on itself", { streamId });
    start += 5;
  }
  return payload.subarray(start, end);
}

/**
 * @typedef {{
 *   id: number,
 *   state: "open"|"half-closed-local"|"half-closed-remote"|"closed",
 *   sendWindow: number,
 *   recvUnacked: number,
 *   headers: Array<[string, string]>|null,
 *   trailers: Array<[string, string]>|null,
 *   data: Uint8Array[],
 *   resolve?: (r: Http2Response) => void,
 *   reject?: (e: Error) => void,
 *   windowWaiters: Array<() => void>,
 * }} Stream
 *
 * @typedef {{ status: number, headers: Array<[string, string]>, body: Uint8Array, streamId: number }} Http2Response
 *
 * @typedef {{
 *   streamId: number, method: string, scheme: string, authority: string, path: string,
 *   headers: Array<[string, string]>, body: Uint8Array,
 * }} Http2Request
 *
 * @typedef {{ respond: (status: number, headers: Array<[string, string]>, body?: Uint8Array) => Promise<void>,
 *             reset: (code: number) => void }} Http2Responder
 */

// ── connection ───────────────────────────────────────────────────────────────

export class Http2Connection {
  /**
   * @param {{
   *   send: (d: Uint8Array) => any,
   *   recv: () => Promise<Uint8Array|null>,
   *   isServer: boolean,
   *   onRequest?: (req: Http2Request, res: Http2Responder) => any,
   *   onIdle?: () => void,
   *   onActive?: () => void,
   *   onGoaway?: (code: number, lastStreamId: number) => void,
   *   onFrame?: (dir: "in"|"out", type: number, flags: number, streamId: number, length: number) => void,
   *   maxConcurrentStreams?: number,
   * }} opts
   */
  constructor(opts) {
    this._send = opts.send;
    this._recv = opts.recv;
    this.isServer = opts.isServer;
    this.onRequest = opts.onRequest ?? null;
    this.onIdle = opts.onIdle ?? null;
    this.onActive = opts.onActive ?? null;
    this.onGoaway = opts.onGoaway ?? null;
    this.onFrame = opts.onFrame ?? null;

    /** Our settings, announced in the first SETTINGS frame. */
    /** @type {Record<number, number>} */
    this.localSettings = {
      [H2_SETTING.HEADER_TABLE_SIZE]: 4096,
      [H2_SETTING.MAX_CONCURRENT_STREAMS]: opts.maxConcurrentStreams ?? 100,
      [H2_SETTING.INITIAL_WINDOW_SIZE]: DEFAULT_WINDOW,
      [H2_SETTING.MAX_FRAME_SIZE]: DEFAULT_MAX_FRAME,
    };
    // a client disables server push (RFC 9113 §8.4)
    if (!this.isServer) this.localSettings[H2_SETTING.ENABLE_PUSH] = 0;
    /** Peer settings; RFC 9113 §6.5.2 initial values until its SETTINGS arrives. */
    this.remoteSettings = {
      headerTableSize: 4096,
      enablePush: 1,
      maxConcurrentStreams: Infinity,
      initialWindowSize: DEFAULT_WINDOW,
      maxFrameSize: DEFAULT_MAX_FRAME,
    };

    this.encoder = new HpackEncoder();
    this.decoder = new HpackDecoder({ maxTableSize: 4096 });

    /** @type {Map<number, Stream>} */
    this.streams = new Map();
    this._nextStreamId = this.isServer ? 2 : 1;
    /** Id of the stream opened by the latest request() (client side). */
    this.lastStreamId = 0;
    this._lastPeerStreamId = 0;
    this._connSendWindow = DEFAULT_WINDOW;
    this._connRecvUnacked = 0;
    /** @type {Array<() => void>} */
    this._connWindowWaiters = [];

    /** @type {Uint8Array} */
    this._buf = new Uint8Array(0);
    this._prefaceSeen = !this.isServer;
    this._settingsSeen = false;
    /** HEADERS waiting for CONTINUATION @type {{ streamId: number, flags: number, parts: Uint8Array[] }|null} */
    this._headerBlock = null;

    /** GOAWAY received: no new streams. */
    this.goawayReceived = false;
    this.goawaySent = false;
    this.closed = false;
    /** @type {Error|null} */
    this.closeError = null;
    /** @type {((v?: any) => void)|null} */
    this._resolveClosed = null;
    /** @type {((v?: any) => void)|null} */
    this._resolveReady = null;
    /** Settles when the transport has ended (or a connection error occurred). @type {Promise<void>} */
    this.done = new Promise((r) => { this._resolveClosed = r; });
    /** Resolves once the peer's first SETTINGS frame has arrived. @type {Promise<void>} */
    this.ready = new Promise((r) => { this._resolveReady = r; });
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Send our preface (client: magic + SETTINGS; server: SETTINGS) and start
   * reading. Returns immediately; `ready` / `done` track progress.
   */
  start() {
    if (!this.isServer) this._write(H2_PREFACE);
    this._writeFrame(H2_FRAME.SETTINGS, 0, 0, this._encodeSettings(this.localSettings));
    this._readLoop();
  }

  /** Number of streams not yet closed. */
  get activeStreams() {
    let n = 0;
    for (const s of this.streams.values()) if (s.state !== "closed") n++;
    return n;
  }

  /** Can this connection take another request? */
  get usable() {
    return !this.closed && !this.goawayReceived && !this.goawaySent;
  }

  /**
   * Graceful shutdown: GOAWAY with the last processed peer stream.
   * @param {number} [code]
   * @param {string} [debug]
   */
  goaway(code = H2_ERROR.NO_ERROR, debug = "") {
    if (this.goawaySent || this.closed) return;
    this.goawaySent = true;
    this._writeFrame(H2_FRAME.GOAWAY, 0, 0, concat([u32(this._lastPeerStreamId), u32(code), new TextEncoder().encode(debug)]));
  }

  /** @param {Error|null} err */
  _finish(err) {
    if (this.closed) return;
    this.closed = true;
    this.closeError = err;
    const e = err ?? new Http2Error(H2_ERROR.CONNECT_ERROR, "connection closed", { retryable: true });
    for (const s of this.streams.values()) {
      if (s.state !== "closed") this._failStream(s, e);
    }
    for (const w of this._connWindowWaiters.splice(0)) w();
    this._resolveReady?.();
    this._resolveClosed?.();
  }

  // ── client API ─────────────────────────────────────────────────────────────

  /**
   * Send a request on a new stream and wait for the complete response.
   * @param {{ method?: string, scheme: string, authority: string, path: string,
   *           headers?: Array<[string, string]>, body?: Uint8Array|null }} r
   * @returns {Promise<Http2Response>}
   */
  request(r) {
    if (this.isServer) return Promise.reject(new Error("request() on a server connection"));
    if (!this.usable) return Promise.reject(new Http2Error(H2_ERROR.REFUSED_STREAM, "connection not usable", { retryable: true }));
    if (this.activeStreams >= this.remoteSettings.maxConcurrentStreams) {
      return Promise.reject(new Http2Error(H2_ERROR.REFUSED_STREAM, "too many concurrent streams", { retryable: true }));
    }
    const id = this._nextStreamId;
    this._nextStreamId += 2;
    this.lastStreamId = id;
    const body = r.body ?? null;
    const stream = this._newStream(id);

    const p = new Promise((resolve, reject) => {
      stream.resolve = resolve;
      stream.reject = reject;
    });

    /** @type {Array<[string, string]>} */
    const fields = [
      [":method", r.method ?? "GET"],
      [":scheme", r.scheme],
      [":authority", r.authority],
      [":path", r.path],
      ...(r.headers ?? []).map(([k, v]) => /** @type {[string, string]} */ ([k.toLowerCase(), v]))
        .filter(([k]) => !CONNECTION_SPECIFIC.has(k) && k !== "host"),
    ];
    const hasBody = body !== null && body.length > 0;
    this._writeHeaders(id, fields, !hasBody);
    if (hasBody) this._sendData(stream, body, true).catch(() => { /* reported via the stream */ });
    return /** @type {Promise<Http2Response>} */ (p);
  }

  // ── stream bookkeeping ─────────────────────────────────────────────────────

  /** @param {number} id @returns {Stream} */
  _newStream(id) {
    const wasIdle = this.activeStreams === 0;
    /** @type {Stream} */
    const s = {
      id, state: "open",
      sendWindow: this.remoteSettings.initialWindowSize,
      recvUnacked: 0,
      headers: null, trailers: null, data: [],
      windowWaiters: [],
    };
    this.streams.set(id, s);
    if (wasIdle) this.onActive?.();
    return s;
  }

  /** @param {Stream} s */
  _closeStream(s) {
    if (s.state === "closed") return;
    s.state = "closed";
    for (const w of s.windowWaiters.splice(0)) w();
    // keep a short history so late frames on closed streams are recognised
    if (this.streams.size > 200) {
      for (const [id, st] of this.streams) {
        if (st.state === "closed") { this.streams.delete(id); if (this.streams.size <= 100) break; }
      }
    }
    if (this.activeStreams === 0) this.onIdle?.();
  }

  /** @param {Stream} s @param {Error} err */
  _failStream(s, err) {
    const reject = s.reject;
    s.resolve = undefined;
    s.reject = undefined;
    this._closeStream(s);
    reject?.(err);
  }

  /** Local end of stream sent. @param {Stream} s */
  _localEnd(s) {
    if (s.state === "open") s.state = "half-closed-local";
    else if (s.state === "half-closed-remote") this._closeStream(s);
  }

  /** Remote end of stream received. @param {Stream} s */
  _remoteEnd(s) {
    if (s.state === "open") s.state = "half-closed-remote";
    else if (s.state === "half-closed-local") this._closeStream(s);
    this._onStreamComplete(s);
  }

  /**
   * Stream error: RST_STREAM to the peer (RFC 9113 §5.4.2).
   * @param {number} streamId
   * @param {number} code
   * @param {string} msg
   */
  _resetStream(streamId, code, msg) {
    this._writeFrame(H2_FRAME.RST_STREAM, 0, streamId, u32(code));
    const s = this.streams.get(streamId);
    if (s && s.state !== "closed") this._failStream(s, new Http2Error(code, msg, { streamId }));
  }

  // ── writing ────────────────────────────────────────────────────────────────

  /** @param {Uint8Array} bytes */
  _write(bytes) {
    if (this.closed) return;
    try {
      const r = this._send(bytes);
      if (r && typeof r.catch === "function") r.catch(() => this._finish(new Error("send failed")));
    } catch {
      this._finish(new Error("send failed"));
    }
  }

  /**
   * @param {number} type @param {number} flags @param {number} streamId
   * @param {Uint8Array} payload
   */
  _writeFrame(type, flags, streamId, payload) {
    const h = new Uint8Array(9 + payload.length);
    h[0] = (payload.length >>> 16) & 0xff;
    h[1] = (payload.length >>> 8) & 0xff;
    h[2] = payload.length & 0xff;
    h[3] = type;
    h[4] = flags;
    h.set(u32(streamId & 0x7fffffff), 5);
    h.set(payload, 9);
    this.onFrame?.("out", type, flags, streamId, payload.length);
    this._write(h);
  }

  /**
   * HPACK-encode and send a header block, split into HEADERS + CONTINUATION
   * frames at the peer's maximum frame size. Encoding and sending happen in
   * one synchronous step so the HPACK state stays in wire order.
   * @param {number} streamId
   * @param {Array<[string, string]>} fields
   * @param {boolean} endStream
   */
  _writeHeaders(streamId, fields, endStream) {
    const block = this.encoder.encode(fields);
    const max = this.remoteSettings.maxFrameSize;
    let off = 0;
    let first = true;
    do {
      const part = block.subarray(off, off + max);
      off += part.length;
      const last = off >= block.length;
      const flags = (last ? H2_FLAG.END_HEADERS : 0) | (first && endStream ? H2_FLAG.END_STREAM : 0);
      this._writeFrame(first ? H2_FRAME.HEADERS : H2_FRAME.CONTINUATION, flags, streamId, part);
      first = false;
    } while (off < block.length);
    if (endStream) {
      const s = this.streams.get(streamId);
      if (s) this._localEnd(s);
    }
  }

  /**
   * Send a body as DATA frames, respecting both flow-control windows and the
   * peer's maximum frame size; waits for WINDOW_UPDATE when a window is empty.
   * @param {Stream} s
   * @param {Uint8Array} body
   * @param {boolean} endStream
   */
  async _sendData(s, body, endStream) {
    let off = 0;
    while (off < body.length) {
      if (this.closed || s.state === "closed") throw new Http2Error(H2_ERROR.STREAM_CLOSED, "stream closed while sending", { streamId: s.id });
      const room = Math.min(this.remoteSettings.maxFrameSize, this._connSendWindow, s.sendWindow, body.length - off);
      if (room <= 0) {
        await new Promise((r) => {
          if (this._connSendWindow <= 0) this._connWindowWaiters.push(() => r(undefined));
          else s.windowWaiters.push(() => r(undefined));
        });
        continue;
      }
      const chunk = body.subarray(off, off + room);
      off += room;
      this._connSendWindow -= room;
      s.sendWindow -= room;
      const last = off >= body.length;
      this._writeFrame(H2_FRAME.DATA, last && endStream ? H2_FLAG.END_STREAM : 0, s.id, chunk);
    }
    if (body.length === 0 && endStream) this._writeFrame(H2_FRAME.DATA, H2_FLAG.END_STREAM, s.id, new Uint8Array(0));
    if (endStream) this._localEnd(s);
  }

  /** @param {Record<number, number>} settings */
  _encodeSettings(settings) {
    const entries = Object.entries(settings);
    const out = new Uint8Array(entries.length * 6);
    entries.forEach(([id, v], i) => {
      out[i * 6] = (Number(id) >>> 8) & 0xff;
      out[i * 6 + 1] = Number(id) & 0xff;
      out.set(u32(v), i * 6 + 2);
    });
    return out;
  }

  // ── reading ────────────────────────────────────────────────────────────────

  async _readLoop() {
    try {
      while (!this.closed) {
        const chunk = await this._recv();
        if (chunk == null) break;
        this._buf = this._buf.length ? concat([this._buf, chunk]) : chunk;
        this._processBuffer();
      }
      this._finish(null);
    } catch (e) {
      this._connectionError(e);
    }
  }

  /** @param {any} e */
  _connectionError(e) {
    const err = e instanceof Http2Error ? e
      : e instanceof HpackError ? new Http2Error(H2_ERROR.COMPRESSION_ERROR, e.message)
      : new Http2Error(H2_ERROR.INTERNAL_ERROR, e instanceof Error ? e.message : String(e));
    if (!err.remote) this.goaway(err.code, err.message);
    this._finish(err);
  }

  _processBuffer() {
    if (!this._prefaceSeen) {
      if (this._buf.length < H2_PREFACE.length) {
        for (let i = 0; i < this._buf.length; i++) {
          if (this._buf[i] !== H2_PREFACE[i]) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "invalid connection preface");
        }
        return;
      }
      for (let i = 0; i < H2_PREFACE.length; i++) {
        if (this._buf[i] !== H2_PREFACE[i]) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "invalid connection preface");
      }
      this._buf = this._buf.subarray(H2_PREFACE.length);
      this._prefaceSeen = true;
    }
    while (this._buf.length >= 9 && !this.closed) {
      const len = (this._buf[0] << 16) | (this._buf[1] << 8) | this._buf[2];
      if (len > this.localSettings[H2_SETTING.MAX_FRAME_SIZE]) {
        throw new Http2Error(H2_ERROR.FRAME_SIZE_ERROR, `frame of ${len} bytes exceeds SETTINGS_MAX_FRAME_SIZE`);
      }
      if (this._buf.length < 9 + len) return;
      const type = this._buf[3];
      const flags = this._buf[4];
      const streamId = read32(this._buf, 5) & 0x7fffffff;
      const payload = this._buf.slice(9, 9 + len);
      this._buf = this._buf.subarray(9 + len);
      this.onFrame?.("in", type, flags, streamId, len);
      this._handleFrame(type, flags, streamId, payload);
    }
  }

  /**
   * @param {number} type @param {number} flags @param {number} streamId
   * @param {Uint8Array} payload
   */
  _handleFrame(type, flags, streamId, payload) {
    // The first frame from the peer must be SETTINGS (RFC 9113 §3.4).
    if (!this._settingsSeen && type !== H2_FRAME.SETTINGS) {
      throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "first frame is not SETTINGS");
    }
    // A header block must be continued without interleaving (§6.10).
    if (this._headerBlock && (type !== H2_FRAME.CONTINUATION || streamId !== this._headerBlock.streamId)) {
      throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "expected CONTINUATION");
    }

    switch (type) {
      case H2_FRAME.DATA: return this._onData(flags, streamId, payload);
      case H2_FRAME.HEADERS: return this._onHeaders(flags, streamId, payload);
      case H2_FRAME.PRIORITY:
        if (streamId === 0) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "PRIORITY on stream 0");
        if (payload.length !== 5) return this._resetStream(streamId, H2_ERROR.FRAME_SIZE_ERROR, "PRIORITY length");
        return;
      case H2_FRAME.RST_STREAM: return this._onRstStream(streamId, payload);
      case H2_FRAME.SETTINGS: return this._onSettings(flags, streamId, payload);
      case H2_FRAME.PUSH_PROMISE:
        // we disable push as client and never accept it as server
        throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "PUSH_PROMISE not allowed");
      case H2_FRAME.PING: return this._onPing(flags, streamId, payload);
      case H2_FRAME.GOAWAY: return this._onGoaway(streamId, payload);
      case H2_FRAME.WINDOW_UPDATE: return this._onWindowUpdate(streamId, payload);
      case H2_FRAME.CONTINUATION: return this._onContinuation(flags, streamId, payload);
      default: return; // unknown frame types are ignored (§4.1)
    }
  }

  /** @param {number} flags @param {number} streamId @param {Uint8Array} payload */
  _onSettings(flags, streamId, payload) {
    if (streamId !== 0) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "SETTINGS on a stream");
    if (flags & H2_FLAG.ACK) {
      if (payload.length !== 0) throw new Http2Error(H2_ERROR.FRAME_SIZE_ERROR, "SETTINGS ACK with payload");
      return;
    }
    if (payload.length % 6 !== 0) throw new Http2Error(H2_ERROR.FRAME_SIZE_ERROR, "SETTINGS length not a multiple of 6");
    for (let i = 0; i < payload.length; i += 6) {
      const id = (payload[i] << 8) | payload[i + 1];
      const v = read32(payload, i + 2);
      switch (id) {
        case H2_SETTING.HEADER_TABLE_SIZE:
          this.remoteSettings.headerTableSize = v;
          this.encoder.setMaxTableSize(v);
          break;
        case H2_SETTING.ENABLE_PUSH:
          if (v > 1) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "ENABLE_PUSH must be 0 or 1");
          if (!this.isServer && v !== 0) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "server sent ENABLE_PUSH=1");
          this.remoteSettings.enablePush = v;
          break;
        case H2_SETTING.MAX_CONCURRENT_STREAMS:
          this.remoteSettings.maxConcurrentStreams = v;
          break;
        case H2_SETTING.INITIAL_WINDOW_SIZE: {
          if (v > MAX_WINDOW) throw new Http2Error(H2_ERROR.FLOW_CONTROL_ERROR, "INITIAL_WINDOW_SIZE too large");
          const delta = v - this.remoteSettings.initialWindowSize;
          this.remoteSettings.initialWindowSize = v;
          // §6.9.2: the change applies to all open streams
          for (const s of this.streams.values()) {
            if (s.state === "closed") continue;
            s.sendWindow += delta;
            if (s.sendWindow > MAX_WINDOW) throw new Http2Error(H2_ERROR.FLOW_CONTROL_ERROR, "stream window overflow");
            if (s.sendWindow > 0) for (const w of s.windowWaiters.splice(0)) w();
          }
          break;
        }
        case H2_SETTING.MAX_FRAME_SIZE:
          if (v < DEFAULT_MAX_FRAME || v > 0xffffff) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "MAX_FRAME_SIZE out of range");
          this.remoteSettings.maxFrameSize = v;
          break;
        default:
          break; // unknown or advisory (MAX_HEADER_LIST_SIZE): ignore (§6.5.2)
      }
    }
    this._writeFrame(H2_FRAME.SETTINGS, H2_FLAG.ACK, 0, new Uint8Array(0));
    if (!this._settingsSeen) {
      this._settingsSeen = true;
      this._resolveReady?.();
    }
  }

  /** @param {number} flags @param {number} streamId @param {Uint8Array} payload */
  _onPing(flags, streamId, payload) {
    if (streamId !== 0) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "PING on a stream");
    if (payload.length !== 8) throw new Http2Error(H2_ERROR.FRAME_SIZE_ERROR, "PING length");
    if (!(flags & H2_FLAG.ACK)) this._writeFrame(H2_FRAME.PING, H2_FLAG.ACK, 0, payload);
  }

  /** @param {number} streamId @param {Uint8Array} payload */
  _onGoaway(streamId, payload) {
    if (streamId !== 0) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "GOAWAY on a stream");
    if (payload.length < 8) throw new Http2Error(H2_ERROR.FRAME_SIZE_ERROR, "GOAWAY length");
    const last = read32(payload, 0) & 0x7fffffff;
    const code = read32(payload, 4);
    this.goawayReceived = true;
    // streams we opened above `last` were not processed: safe to retry
    for (const s of this.streams.values()) {
      const ours = (s.id % 2 === 0) === this.isServer;
      if (ours && s.id > last && s.state !== "closed") {
        this._failStream(s, new Http2Error(H2_ERROR.REFUSED_STREAM, "not processed (GOAWAY)", { streamId: s.id, remote: true, retryable: true }));
      }
    }
    this.onGoaway?.(code, last);
    if (code !== H2_ERROR.NO_ERROR) {
      this._finish(new Http2Error(code, `peer sent GOAWAY ${h2ErrorName(code)}`, { remote: true }));
    }
  }

  /** @param {number} streamId @param {Uint8Array} payload */
  _onRstStream(streamId, payload) {
    if (streamId === 0) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "RST_STREAM on stream 0");
    if (payload.length !== 4) throw new Http2Error(H2_ERROR.FRAME_SIZE_ERROR, "RST_STREAM length");
    this._checkNotIdle(streamId);
    const code = read32(payload, 0);
    const s = this.streams.get(streamId);
    if (s && s.state !== "closed") {
      this._failStream(s, new Http2Error(code, `stream reset by peer: ${h2ErrorName(code)}`,
        { streamId, remote: true, retryable: code === H2_ERROR.REFUSED_STREAM }));
    }
  }

  /** @param {number} streamId @param {Uint8Array} payload */
  _onWindowUpdate(streamId, payload) {
    if (payload.length !== 4) throw new Http2Error(H2_ERROR.FRAME_SIZE_ERROR, "WINDOW_UPDATE length");
    const inc = read32(payload, 0) & 0x7fffffff;
    if (streamId === 0) {
      if (inc === 0) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "WINDOW_UPDATE increment 0");
      this._connSendWindow += inc;
      if (this._connSendWindow > MAX_WINDOW) throw new Http2Error(H2_ERROR.FLOW_CONTROL_ERROR, "connection window overflow");
      for (const w of this._connWindowWaiters.splice(0)) w();
      return;
    }
    this._checkNotIdle(streamId);
    const s = this.streams.get(streamId);
    if (!s || s.state === "closed") return; // may arrive after the stream ended
    if (inc === 0) return this._resetStream(streamId, H2_ERROR.PROTOCOL_ERROR, "WINDOW_UPDATE increment 0");
    s.sendWindow += inc;
    if (s.sendWindow > MAX_WINDOW) return this._resetStream(streamId, H2_ERROR.FLOW_CONTROL_ERROR, "stream window overflow");
    for (const w of s.windowWaiters.splice(0)) w();
  }

  /**
   * Frames other than HEADERS/PRIORITY on a stream that was never opened are
   * a connection error (§5.1, "idle" state).
   * @param {number} streamId
   */
  _checkNotIdle(streamId) {
    const peerInitiated = (streamId % 2 === 1) === this.isServer;
    const idle = peerInitiated ? streamId > this._lastPeerStreamId : streamId >= this._nextStreamId;
    if (idle) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, `frame on idle stream ${streamId}`);
  }

  /** @param {number} flags @param {number} streamId @param {Uint8Array} payload */
  _onData(flags, streamId, payload) {
    if (streamId === 0) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "DATA on stream 0");
    this._checkNotIdle(streamId);
    // flow control counts the whole frame payload, padding included (§6.1)
    this._connRecvUnacked += payload.length;
    if (this._connRecvUnacked >= DEFAULT_WINDOW / 2) {
      this._writeFrame(H2_FRAME.WINDOW_UPDATE, 0, 0, u32(this._connRecvUnacked));
      this._connRecvUnacked = 0;
    }
    const s = this.streams.get(streamId);
    if (!s || s.state === "closed" || s.state === "half-closed-remote") {
      return this._resetStream(streamId, H2_ERROR.STREAM_CLOSED, "DATA on closed stream");
    }
    if (!s.headers) return this._resetStream(streamId, H2_ERROR.PROTOCOL_ERROR, "DATA before HEADERS");
    const data = unpad(flags, payload, false, streamId);
    if (data.length) s.data.push(data);
    const end = (flags & H2_FLAG.END_STREAM) !== 0;
    if (!end) {
      s.recvUnacked += payload.length;
      if (s.recvUnacked >= DEFAULT_WINDOW / 2) {
        this._writeFrame(H2_FRAME.WINDOW_UPDATE, 0, streamId, u32(s.recvUnacked));
        s.recvUnacked = 0;
      }
    } else {
      this._remoteEnd(s);
    }
  }

  /** @param {number} flags @param {number} streamId @param {Uint8Array} payload */
  _onHeaders(flags, streamId, payload) {
    if (streamId === 0) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "HEADERS on stream 0");
    const fragment = unpad(flags, payload, (flags & H2_FLAG.PRIORITY) !== 0, streamId);
    this._headerBlock = { streamId, flags, parts: [fragment] };
    if (flags & H2_FLAG.END_HEADERS) this._endHeaderBlock();
  }

  /** @param {number} flags @param {number} streamId @param {Uint8Array} payload */
  _onContinuation(flags, streamId, payload) {
    if (!this._headerBlock) throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, "unexpected CONTINUATION");
    this._headerBlock.parts.push(payload);
    if (flags & H2_FLAG.END_HEADERS) this._endHeaderBlock();
  }

  _endHeaderBlock() {
    const hb = /** @type {{ streamId: number, flags: number, parts: Uint8Array[] }} */ (this._headerBlock);
    this._headerBlock = null;
    // decode even for streams we will reject: the HPACK state must advance
    const fields = this.decoder.decode(concat(hb.parts));
    const endStream = (hb.flags & H2_FLAG.END_STREAM) !== 0;
    const id = hb.streamId;
    let s = this.streams.get(id);

    if (!s) {
      const peerInitiated = (id % 2 === 1) === this.isServer;
      if (!peerInitiated || !this.isServer) {
        // a client never accepts new streams (no push); a server only odd ones
        throw new Http2Error(H2_ERROR.PROTOCOL_ERROR, `unexpected HEADERS on stream ${id}`);
      }
      if (id <= this._lastPeerStreamId) throw new Http2Error(H2_ERROR.STREAM_CLOSED, `stream ${id} already used`);
      this._lastPeerStreamId = id;
      if (this.goawaySent) return; // §6.8: ignore new streams after GOAWAY
      if (this.activeStreams >= this.localSettings[H2_SETTING.MAX_CONCURRENT_STREAMS]) {
        this._writeFrame(H2_FRAME.RST_STREAM, 0, id, u32(H2_ERROR.REFUSED_STREAM));
        return;
      }
      s = this._newStream(id);
    }

    if (s.state === "closed" || s.state === "half-closed-remote") {
      return this._resetStream(id, H2_ERROR.STREAM_CLOSED, "HEADERS on closed stream");
    }

    if (s.headers === null) {
      // client: skip interim 1xx responses, wait for the final one
      if (!this.isServer) {
        const status = fields.find(([n]) => n === ":status")?.[1] ?? "";
        if (/^1\d\d$/.test(status)) return;
      }
      const problem = this._validateFields(fields, this.isServer ? "request" : "response");
      if (problem) return this._resetStream(id, H2_ERROR.PROTOCOL_ERROR, problem);
      s.headers = fields;
    } else {
      // trailers: must end the stream and carry no pseudo-headers (§8.1)
      if (!endStream || fields.some(([n]) => n.startsWith(":"))) {
        return this._resetStream(id, H2_ERROR.PROTOCOL_ERROR, "malformed trailers");
      }
      s.trailers = fields;
    }
    if (endStream) this._remoteEnd(s);
  }

  /**
   * Field validation (RFC 9113 §8.2, §8.3). Returns a problem description
   * for a malformed message, or null.
   * @param {Array<[string, string]>} fields
   * @param {"request"|"response"} kind
   */
  _validateFields(fields, kind) {
    let regularSeen = false;
    /** @type {Record<string, number>} */
    const pseudo = {};
    for (const [n, v] of fields) {
      if (n !== n.toLowerCase()) return `upper-case field name '${n}'`;
      if (n.startsWith(":")) {
        if (regularSeen) return `pseudo-header '${n}' after regular fields`;
        const allowed = kind === "request" ? [":method", ":scheme", ":authority", ":path"] : [":status"];
        if (!allowed.includes(n)) return `unknown pseudo-header '${n}'`;
        if (pseudo[n]) return `duplicate '${n}'`;
        pseudo[n] = 1;
      } else {
        regularSeen = true;
        if (CONNECTION_SPECIFIC.has(n)) return `connection-specific field '${n}'`;
        if (n === "te" && v !== "trailers") return "TE other than 'trailers'";
      }
    }
    if (kind === "request") {
      for (const p of [":method", ":scheme", ":path"]) if (!pseudo[p]) return `missing '${p}'`;
      if (fields.find(([n]) => n === ":path")?.[1] === "") return "empty ':path'";
    } else if (!pseudo[":status"]) {
      return "missing ':status'";
    }
    return null;
  }

  /** Both directions of a stream are done or the remote side finished. @param {Stream} s */
  _onStreamComplete(s) {
    const body = concat(s.data);
    s.data = [];
    const headers = /** @type {Array<[string, string]>} */ (s.headers ?? []);
    if (!this.isServer) {
      const resolve = s.resolve;
      s.resolve = undefined;
      s.reject = undefined;
      resolve?.({
        status: Number(headers.find(([n]) => n === ":status")?.[1] ?? 0),
        headers: headers.filter(([n]) => !n.startsWith(":")),
        body,
        streamId: s.id,
      });
      return;
    }
    const get = (/** @type {string} */ n) => headers.find(([k]) => k === n)?.[1] ?? "";
    /** @type {Http2Request} */
    const req = {
      streamId: s.id,
      method: get(":method"),
      scheme: get(":scheme"),
      authority: get(":authority") || get("host"),
      path: get(":path"),
      headers: headers.filter(([n]) => !n.startsWith(":")),
      body,
    };
    const stream = s;
    /** @type {Http2Responder} */
    const res = {
      respond: async (status, hdrs, resBody = new Uint8Array(0)) => {
        if (stream.state === "closed" || this.closed) return;
        /** @type {Array<[string, string]>} */
        const fields = [[":status", String(status)],
          ...hdrs.map(([k, v]) => /** @type {[string, string]} */ ([k.toLowerCase(), v]))
            .filter(([k]) => !CONNECTION_SPECIFIC.has(k))];
        const hasBody = resBody.length > 0;
        this._writeHeaders(stream.id, fields, !hasBody);
        if (hasBody) await this._sendData(stream, resBody, true);
      },
      reset: (code) => this._resetStream(stream.id, code, "reset by application"),
    };
    try {
      const r = this.onRequest?.(req, res);
      if (r && typeof r.catch === "function") r.catch(() => this._resetStream(stream.id, H2_ERROR.INTERNAL_ERROR, "handler failed"));
    } catch {
      this._resetStream(stream.id, H2_ERROR.INTERNAL_ERROR, "handler failed");
    }
  }
}
