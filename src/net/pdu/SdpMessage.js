//@ts-check

/**
 * SDP (RFC 4566) — just enough for a single-audio-stream offer/answer.
 *
 * The simulator negotiates exactly one thing: one `m=audio` line carrying
 * PCMU (payload type 0) at a chosen RTP port, with a `ptime` and a direction
 * attribute. This helper parses that shape and rebuilds it; anything it does
 * not recognise on parse is preserved as a raw attribute line so a
 * round-trip stays lossless enough for display.
 */

const CRLF = "\r\n";

/**
 * @typedef {Object} SdpMedia
 * @property {string} type          e.g. "audio"
 * @property {number} port          RTP port
 * @property {string} proto         e.g. "RTP/AVP"
 * @property {number[]} formats     payload type numbers
 * @property {string|null} connectionAddr  media-level c= address, if present
 * @property {Map<number, string>} rtpmap  pt -> "PCMU/8000"
 * @property {number|null} ptime    a=ptime value in ms
 * @property {"sendrecv"|"sendonly"|"recvonly"|"inactive"} direction
 * @property {string[]} rawAttrs    other a= lines, verbatim (without "a=")
 */

export class SdpMessage {

  /** @type {number} */ version = 0;
  /** @type {string} */ originUser = "-";
  /** @type {string} */ originSessId = "0";
  /** @type {string} */ originSessVersion = "0";
  /** @type {string} */ originAddr = "0.0.0.0";
  /** @type {string} */ sessionName = "-";
  /** @type {string|null} */ connectionAddr = null;
  /** @type {SdpMedia[]} */ media = [];

  /**
   * Build a one-audio-stream SDP offer/answer.
   * @param {object} opts
   * @param {string} opts.address           our RTP IP (goes in o= and c=)
   * @param {number} opts.port              our RTP port
   * @param {number} [opts.ptime]           default 100
   * @param {number} [opts.payloadType]     default 0 (PCMU)
   * @param {string} [opts.codec]           default "PCMU/8000"
   * @param {"sendrecv"|"sendonly"|"recvonly"|"inactive"} [opts.direction]
   * @param {string} [opts.sessId]
   * @returns {SdpMessage}
   */
  static audioOffer({ address, port, ptime = 100, payloadType = 0, codec = "PCMU/8000", direction = "sendrecv", sessId }) {
    const m = new SdpMessage();
    m.originUser = "beaverphone";
    m.originSessId = sessId ?? String(Math.floor(Math.random() * 1e9));
    m.originSessVersion = m.originSessId;
    m.originAddr = address;
    m.sessionName = "BeaverPhone call";
    m.connectionAddr = address;
    m.media = [{
      type: "audio",
      port,
      proto: "RTP/AVP",
      formats: [payloadType],
      connectionAddr: null,
      rtpmap: new Map([[payloadType, codec]]),
      ptime,
      direction,
      rawAttrs: [],
    }];
    return m;
  }

  /** The first audio media description, or null. @returns {SdpMedia|null} */
  get audio() {
    return this.media.find(x => x.type === "audio") ?? null;
  }

  /** Effective connection address for a media entry (media-level c= wins). @param {SdpMedia} m */
  addressFor(m) {
    return m.connectionAddr ?? this.connectionAddr ?? this.originAddr;
  }

  /**
   * @param {string|Uint8Array} input
   * @returns {SdpMessage}
   */
  static parse(input) {
    const text = typeof input === "string"
      ? input
      : new TextDecoder().decode(input);
    const sdp = new SdpMessage();
    /** @type {SdpMedia|null} */
    let cur = null;

    for (const rawLine of text.split(/\r\n|\n/)) {
      const line = rawLine.trimEnd();
      if (line === "") continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const type = line.slice(0, eq);
      const val = line.slice(eq + 1);

      switch (type) {
        case "v":
          sdp.version = Number(val) || 0;
          break;
        case "o": {
          const p = val.split(/\s+/);
          if (p.length >= 6) {
            sdp.originUser = p[0];
            sdp.originSessId = p[1];
            sdp.originSessVersion = p[2];
            sdp.originAddr = p[5];
          }
          break;
        }
        case "s":
          sdp.sessionName = val;
          break;
        case "c": {
          const p = val.split(/\s+/);
          const addr = p[2] ? p[2].split("/")[0] : null;
          if (cur) cur.connectionAddr = addr;
          else sdp.connectionAddr = addr;
          break;
        }
        case "m": {
          const p = val.split(/\s+/);
          cur = {
            type: p[0],
            port: Number(p[1]) || 0,
            proto: p[2] ?? "RTP/AVP",
            formats: p.slice(3).map(Number).filter(n => Number.isFinite(n)),
            connectionAddr: null,
            rtpmap: new Map(),
            ptime: null,
            direction: "sendrecv",
            rawAttrs: [],
          };
          sdp.media.push(cur);
          break;
        }
        case "a": {
          const target = cur;
          if (!target) break;
          const rtpmap = val.match(/^rtpmap:(\d+)\s+(.+)$/i);
          if (rtpmap) { target.rtpmap.set(Number(rtpmap[1]), rtpmap[2].trim()); break; }
          const ptime = val.match(/^ptime:(\d+)$/i);
          if (ptime) { target.ptime = Number(ptime[1]); break; }
          if (/^(sendrecv|sendonly|recvonly|inactive)$/i.test(val)) {
            target.direction = /** @type {any} */ (val.toLowerCase());
            break;
          }
          target.rawAttrs.push(val);
          break;
        }
        default:
          // t=, other session lines: ignored (not meaningful for the sim)
          break;
      }
    }
    return sdp;
  }

  /** @returns {string} */
  toString() {
    const lines = [];
    lines.push(`v=${this.version}`);
    lines.push(`o=${this.originUser} ${this.originSessId} ${this.originSessVersion} IN IP4 ${this.originAddr}`);
    lines.push(`s=${this.sessionName}`);
    if (this.connectionAddr) lines.push(`c=IN IP4 ${this.connectionAddr}`);
    lines.push("t=0 0");
    for (const m of this.media) {
      lines.push(`m=${m.type} ${m.port} ${m.proto} ${m.formats.join(" ")}`);
      if (m.connectionAddr) lines.push(`c=IN IP4 ${m.connectionAddr}`);
      for (const [pt, enc] of m.rtpmap) lines.push(`a=rtpmap:${pt} ${enc}`);
      if (m.ptime != null) lines.push(`a=ptime:${m.ptime}`);
      lines.push(`a=${m.direction}`);
      for (const raw of m.rawAttrs) lines.push(`a=${raw}`);
    }
    return lines.join(CRLF) + CRLF;
  }
}
