//@ts-check

/**
 * HTTP/3 (RFC 9114) over a QuicConnection.
 *
 * Same interface as Http2Connection: a client calls `request()`, a server
 * gets `onRequest(req, res)`. Each request uses its own bidirectional QUIC
 * stream (HEADERS, DATA…, FIN); both sides open a control stream with
 * SETTINGS. QPACK runs without a dynamic table, so no encoder/decoder
 * streams are needed. Server push is not used.
 */

import { encodeVarint, QuicReader, QuicError } from "./Quic.js";
import { qpackEncode, qpackDecode, QpackError, QPACK_DECOMPRESSION_FAILED } from "./Qpack.js";
import { validateHttpFields } from "./Http2.js";

export const H3_FRAME = Object.freeze({
  DATA: 0x00, HEADERS: 0x01, CANCEL_PUSH: 0x03, SETTINGS: 0x04, PUSH_PROMISE: 0x05, GOAWAY: 0x07, MAX_PUSH_ID: 0x0d,
});

export const H3_STREAM = Object.freeze({ CONTROL: 0x00, PUSH: 0x01, QPACK_ENCODER: 0x02, QPACK_DECODER: 0x03 });

export const H3_SETTING = Object.freeze({ QPACK_MAX_TABLE_CAPACITY: 0x01, MAX_FIELD_SECTION_SIZE: 0x06, QPACK_BLOCKED_STREAMS: 0x07 });

export const H3_ERROR = Object.freeze({
  NO_ERROR: 0x100, GENERAL_PROTOCOL_ERROR: 0x101, INTERNAL_ERROR: 0x102, STREAM_CREATION_ERROR: 0x103,
  CLOSED_CRITICAL_STREAM: 0x104, FRAME_UNEXPECTED: 0x105, FRAME_ERROR: 0x106, EXCESSIVE_LOAD: 0x107,
  ID_ERROR: 0x108, SETTINGS_ERROR: 0x109, MISSING_SETTINGS: 0x10a, REQUEST_REJECTED: 0x10b,
  REQUEST_CANCELLED: 0x10c, REQUEST_INCOMPLETE: 0x10d, MESSAGE_ERROR: 0x10e, CONNECT_ERROR: 0x10f,
  VERSION_FALLBACK: 0x110,
});

export class Http3Error extends Error {
  /** @param {number} code @param {string} msg @param {{ retryable?: boolean }} [o] */
  constructor(code, msg, o = {}) {
    super(msg);
    this.name = "Http3Error";
    this.code = code;
    this.retryable = o.retryable ?? false;
  }
}

/** @param {Uint8Array[]} parts */
function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** @param {number} type @param {Uint8Array} payload */
export function h3Frame(type, payload) {
  return concat([encodeVarint(type), encodeVarint(payload.length), payload]);
}

/**
 * Split a complete stream into HTTP/3 frames.
 * @param {Uint8Array} data
 * @returns {Array<{ type: number, payload: Uint8Array }>}
 */
export function parseH3Frames(data) {
  const r = new QuicReader(data);
  /** @type {Array<{ type: number, payload: Uint8Array }>} */
  const out = [];
  try {
    while (r.left > 0) {
      const type = r.varint();
      const len = r.varint();
      out.push({ type, payload: r.bytes(len).slice() });
    }
  } catch {
    throw new Http3Error(H3_ERROR.FRAME_ERROR, "truncated HTTP/3 frame");
  }
  return out;
}

/**
 * A request or response message: HEADERS, DATA*, optional trailing HEADERS
 * (RFC 9114 §4.1). Unknown and reserved frame types are skipped (§9).
 * @param {Uint8Array} data
 * @returns {{ fields: Array<[string, string]>, body: Uint8Array }}
 */
function parseMessage(data) {
  const frames = parseH3Frames(data);
  /** @type {Array<[string, string]>|null} */
  let fields = null;
  /** @type {Uint8Array[]} */
  const body = [];
  let trailersSeen = false;
  for (const f of frames) {
    if (f.type === H3_FRAME.HEADERS) {
      if (trailersSeen) throw new Http3Error(H3_ERROR.FRAME_UNEXPECTED, "frame after trailers");
      let decoded;
      try { decoded = qpackDecode(f.payload); } catch (e) {
        if (e instanceof QpackError) throw new Http3Error(QPACK_DECOMPRESSION_FAILED, e.message);
        throw e;
      }
      if (fields === null) fields = decoded;
      else trailersSeen = true;
    } else if (f.type === H3_FRAME.DATA) {
      if (fields === null || trailersSeen) throw new Http3Error(H3_ERROR.FRAME_UNEXPECTED, "DATA before HEADERS");
      body.push(f.payload);
    } else if (/** @type {number[]} */ ([H3_FRAME.SETTINGS, H3_FRAME.GOAWAY, H3_FRAME.MAX_PUSH_ID, H3_FRAME.CANCEL_PUSH]).includes(f.type)) {
      throw new Http3Error(H3_ERROR.FRAME_UNEXPECTED, `control frame 0x${f.type.toString(16)} on a request stream`);
    }
  }
  if (fields === null) throw new Http3Error(H3_ERROR.REQUEST_INCOMPLETE, "no HEADERS");
  return { fields, body: concat(body) };
}

/**
 * @typedef {import("./Http2.js").Http2Request} Http3Request
 * @typedef {import("./Http2.js").Http2Responder} Http3Responder
 * @typedef {import("./Http2.js").Http2Response} Http3Response
 * @typedef {import("./Quic.js").QuicConnection} QuicConnection
 * @typedef {import("./Quic.js").QuicStream} QuicStream
 */

export class Http3Connection {
  /**
   * @param {{
   *   quic: QuicConnection,
   *   onRequest?: (req: Http3Request, res: Http3Responder) => any,
   *   onIdle?: () => void,
   *   onActive?: () => void,
   * }} opts
   */
  constructor(opts) {
    this.quic = opts.quic;
    this.isServer = this.quic.isServer;
    this.onRequest = opts.onRequest ?? null;
    this.onIdle = opts.onIdle ?? null;
    this.onActive = opts.onActive ?? null;
    /** Peer SETTINGS once received. @type {Map<number, number>|null} */
    this.peerSettings = null;
    this.goawayReceived = false;
    this.goawaySent = false;
    /** @type {QuicStream|null} */
    this._control = null;
    this._active = 0;
    this._lastPeerStream = -1;
    /** @type {Set<number>} unidirectional stream types already seen (control must be unique) */
    this._uniTypes = new Set();
  }

  /** Open our control stream with SETTINGS and start handling peer streams (call after quic.ready). */
  start() {
    this.quic.onStream = (s) => this._onPeerStream(s);
    this._control = this.quic.openStream({ bidi: false });
    const settings = concat([
      encodeVarint(H3_SETTING.QPACK_MAX_TABLE_CAPACITY), encodeVarint(0),
      encodeVarint(H3_SETTING.QPACK_BLOCKED_STREAMS), encodeVarint(0),
    ]);
    this._control.write(concat([encodeVarint(H3_STREAM.CONTROL), h3Frame(H3_FRAME.SETTINGS, settings)]));
  }

  get usable() {
    return this.quic.state === "connected" && !this.goawayReceived && !this.goawaySent;
  }

  get activeStreams() { return this._active; }

  /** Graceful shutdown (RFC 9114 §5.2): no new requests beyond the last one seen. */
  goaway() {
    if (this.goawaySent || !this._control || this.quic.state !== "connected") return;
    this.goawaySent = true;
    const id = this.isServer ? this._lastPeerStream + 4 : 0;
    this._control.write(h3Frame(H3_FRAME.GOAWAY, encodeVarint(Math.max(id, 0))));
  }

  /** @param {number} delta */
  _track(delta) {
    const before = this._active;
    this._active += delta;
    if (before === 0 && this._active > 0) this.onActive?.();
    if (before > 0 && this._active === 0) this.onIdle?.();
  }

  // ── client ─────────────────────────────────────────────────────────────────

  /**
   * @param {{ method?: string, scheme: string, authority: string, path: string,
   *           headers?: Array<[string, string]>, body?: Uint8Array|null }} r
   * @returns {Promise<Http3Response>}
   */
  async request(r) {
    if (!this.usable) throw new Http3Error(H3_ERROR.REQUEST_REJECTED, "connection not usable", { retryable: true });
    let s;
    try {
      s = this.quic.openStream();
    } catch {
      throw new Http3Error(H3_ERROR.REQUEST_REJECTED, "stream limit", { retryable: true });
    }
    this.lastStreamId = s.id;
    /** @type {Array<[string, string]>} */
    const fields = [
      [":method", r.method ?? "GET"], [":scheme", r.scheme], [":authority", r.authority], [":path", r.path],
      ...(r.headers ?? []).map(([k, v]) => /** @type {[string, string]} */ ([k.toLowerCase(), v]))
        .filter(([k]) => !["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "host"].includes(k)),
    ];
    const parts = [h3Frame(H3_FRAME.HEADERS, qpackEncode(fields))];
    if (r.body && r.body.length) parts.push(h3Frame(H3_FRAME.DATA, r.body));
    this._track(1);
    try {
      s.write(concat(parts), true);
      let data;
      try { data = await s.readAll(); } catch (e) {
        const q = /** @type {QuicError} */ (e);
        throw new Http3Error(q.code ?? H3_ERROR.INTERNAL_ERROR, q.message,
          { retryable: q.code === H3_ERROR.REQUEST_REJECTED || this.quic.state === "closed" });
      }
      // interim 1xx responses come first as their own HEADERS (§4.1)
      let msg = parseMessage(data);
      while (/^1\d\d$/.test(msg.fields.find(([n]) => n === ":status")?.[1] ?? "")) {
        const frames = parseH3Frames(data);
        data = concat(frames.slice(1).map(f => h3Frame(f.type, f.payload)));
        msg = parseMessage(data);
      }
      const problem = validateHttpFields(msg.fields, "response");
      if (problem) throw new Http3Error(H3_ERROR.MESSAGE_ERROR, problem);
      return {
        status: Number(msg.fields.find(([n]) => n === ":status")?.[1] ?? 0),
        headers: msg.fields.filter(([n]) => !n.startsWith(":")),
        body: msg.body,
        streamId: s.id,
      };
    } finally {
      this._track(-1);
    }
  }
  /** Stream id of the latest request. */
  lastStreamId = 0;

  // ── both sides: peer-initiated streams ─────────────────────────────────────

  /** @param {QuicStream} s */
  _onPeerStream(s) {
    if (s.uni) { this._onUniStream(s); return; }
    if (!this.isServer) {
      // RFC 9114 §6.1: a server must not open bidirectional streams
      this.quic.close(H3_ERROR.STREAM_CREATION_ERROR, "server-initiated bidirectional stream");
      return;
    }
    this._lastPeerStream = Math.max(this._lastPeerStream, s.id);
    if (this.goawaySent) return; // §5.2: ignore requests after GOAWAY
    this._track(1);
    s.readAll().then((data) => this._serveRequest(s, data)).catch(() => this._track(-1));
  }

  /** @param {QuicStream} s */
  _onUniStream(s) {
    /** @type {Uint8Array} */
    let buf = new Uint8Array(0);
    /** @type {number|null} */
    let type = null;
    s.ondata = (chunk) => {
      buf = concat([buf, chunk]);
      const r = new QuicReader(buf);
      try {
        if (type === null) {
          type = r.varint();
          if (type === H3_STREAM.CONTROL || type === H3_STREAM.QPACK_ENCODER || type === H3_STREAM.QPACK_DECODER) {
            if (this._uniTypes.has(type)) {
              this.quic.close(H3_ERROR.STREAM_CREATION_ERROR, "duplicate critical stream");
              return;
            }
            this._uniTypes.add(type);
          }
          if (type === H3_STREAM.PUSH && this.isServer) {
            this.quic.close(H3_ERROR.STREAM_CREATION_ERROR, "push stream from a client");
            return;
          }
          buf = buf.slice(r.pos);
        }
        if (type !== H3_STREAM.CONTROL) { buf = new Uint8Array(0); return; } // QPACK streams unused, unknown types ignored (§6.2)
        this._parseControl(() => buf, (b) => { buf = b; });
      } catch (e) {
        if (e instanceof QuicError) return; // incomplete: wait for more
        throw e;
      }
    };
    s.onend = () => {
      if (type === H3_STREAM.CONTROL) this.quic.close(H3_ERROR.CLOSED_CRITICAL_STREAM, "control stream closed");
    };
  }

  /**
   * Consume complete frames from the control stream buffer.
   * @param {() => Uint8Array} get @param {(b: Uint8Array) => void} set
   */
  _parseControl(get, set) {
    for (;;) {
      const buf = get();
      const r = new QuicReader(buf);
      let type, payload;
      try {
        type = r.varint();
        const len = r.varint();
        payload = r.bytes(len).slice();
      } catch {
        return; // need more data
      }
      set(buf.slice(r.pos));
      if (this.peerSettings === null) {
        if (type !== H3_FRAME.SETTINGS) {
          this.quic.close(H3_ERROR.MISSING_SETTINGS, "first control frame is not SETTINGS");
          return;
        }
        /** @type {Map<number, number>} */
        const m = new Map();
        const pr = new QuicReader(payload);
        while (pr.left > 0) {
          const id = pr.varint(), v = pr.varint();
          if (m.has(id)) { this.quic.close(H3_ERROR.SETTINGS_ERROR, "duplicate setting"); return; }
          // HTTP/2 setting ids are reserved in HTTP/3 (§7.2.4.1)
          if ([0x02, 0x03, 0x04, 0x05].includes(id)) { this.quic.close(H3_ERROR.SETTINGS_ERROR, `HTTP/2 setting 0x${id.toString(16)}`); return; }
          m.set(id, v);
        }
        this.peerSettings = m;
        continue;
      }
      if (type === H3_FRAME.SETTINGS) { this.quic.close(H3_ERROR.FRAME_UNEXPECTED, "second SETTINGS"); return; }
      if (type === H3_FRAME.GOAWAY) this.goawayReceived = true;
      if (type === H3_FRAME.DATA || type === H3_FRAME.HEADERS) {
        this.quic.close(H3_ERROR.FRAME_UNEXPECTED, "DATA/HEADERS on the control stream");
        return;
      }
    }
  }

  // ── server ─────────────────────────────────────────────────────────────────

  /** @param {QuicStream} s @param {Uint8Array} data */
  async _serveRequest(s, data) {
    let done = false;
    const finish = () => { if (!done) { done = true; this._track(-1); } };
    /** @param {number} status @param {Array<[string, string]>} headers @param {Uint8Array} [body] */
    const respond = async (status, headers, body = new Uint8Array(0)) => {
      if (done) return;
      /** @type {Array<[string, string]>} */
      const fields = [[":status", String(status)], ...headers.map(([k, v]) => /** @type {[string, string]} */ ([k.toLowerCase(), v]))
        .filter(([k]) => !["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade"].includes(k))];
      const parts = [h3Frame(H3_FRAME.HEADERS, qpackEncode(fields))];
      if (body.length) parts.push(h3Frame(H3_FRAME.DATA, body));
      s.write(concat(parts), true);
      finish();
    };
    try {
      const msg = parseMessage(data);
      const problem = validateHttpFields(msg.fields, "request");
      if (problem) {
        await respond(400, [["content-type", "text/plain"]], new TextEncoder().encode(problem));
        return;
      }
      const get = (/** @type {string} */ n) => msg.fields.find(([k]) => k === n)?.[1] ?? "";
      /** @type {Http3Request} */
      const req = {
        streamId: s.id,
        method: get(":method"), scheme: get(":scheme"), authority: get(":authority"), path: get(":path"),
        headers: msg.fields.filter(([n]) => !n.startsWith(":")),
        body: msg.body,
      };
      await this.onRequest?.(req, { respond, reset: () => { s.end(); finish(); } });
    } catch (e) {
      if (e instanceof Http3Error && e.code === QPACK_DECOMPRESSION_FAILED) {
        this.quic.close(e.code, e.message);
      } else if (e instanceof Http3Error) {
        await respond(400, [["content-type", "text/plain"]], new TextEncoder().encode(e.message));
      } else {
        await respond(500, [], new Uint8Array(0));
      }
    } finally {
      finish();
    }
  }
}
