//@ts-check
import { TCPPacket } from "../net/pdu/TCPPacket.js";
import { IPAddress } from "./models/IPAddress.js";

/**
 * TCP connection states (simplified).
 * @typedef {"LISTEN"|"SYN-RECEIVED"|"ESTABLISHED"|"CLOSED"|"SYN-SENT"|"FIN-WAIT-1"|"FIN-WAIT-2"|"LAST-ACK"|"CLOSE-WAIT"|"TIME-WAIT"} TcpState
 */

// -----------------------------------------------------------------------------
// TCP sequence number helpers (RFC-style modulo 2^32 comparisons)
// -----------------------------------------------------------------------------

/** @param {number} x @returns {number} */
function u32(x) { return x >>> 0; }

/**
 * Signed 32-bit difference (a-b) in [-2^31, 2^31-1].
 * If values are within half the sequence space, sign indicates ordering.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function s32diff(a, b) {
  return ((u32(a) - u32(b)) | 0);
}

/** a < b (mod 2^32) */
function seqLT(a, b) { return s32diff(a, b) < 0; }
/** a <= b (mod 2^32) */
function seqLE(a, b) { return s32diff(a, b) <= 0; }
/** a > b (mod 2^32) */
function seqGT(a, b) { return s32diff(a, b) > 0; }
/** a >= b (mod 2^32) */
function seqGE(a, b) { return s32diff(a, b) >= 0; }

/**
 * Distance forward from base to x in modulo 2^32 space.
 * Assumes x is "not too far" ahead (e.g. within window).
 * @param {number} base
 * @param {number} x
 * @returns {number}
 */
function seqDist(base, x) {
  return u32(u32(x) - u32(base));
}

/**
 * TCP engine implementing a minimal TCP stack.
 * (IPv4-only as long as the rest of the simulator is IPv4-only.)
 */
export class TcpEngine {
  /**
   * @param {{
   *   ipSend: (opts: {
   *     dst:IPAddress,
   *     src:IPAddress,
   *     protocol:number,
   *     payload:Uint8Array
   *   }) => (void|Promise<void>),
   *   resolveSrcIp: (dstIp:IPAddress) => IPAddress
   * }} deps
   */
  constructor(deps) {
    this._ipSend = deps.ipSend;
    this._resolveSrcIp = deps.resolveSrcIp;

    /** @type {Map<number, TCPSocket>} */
    this.sockets = new Map(); // port -> listen socket or connected socket

    /** @type {Map<string, TCPSocket>} */
    this.conns = new Map(); // connection key -> connected socket

    /** @type {number} */
    this.defaultMSS = 512;

    /** @type {number} simulated time in "ms"; 1 master tick = 1 ms */
    this.nowMs = 0;

    /** @type {number} TIME-WAIT duration in ticks (ms) */
    this.timeWaitMs = 2000;
  }

  /**
   * Advance TCP timers by one master tick.
   * In this simulation, 1 tick == 1 simulated millisecond.
   */
  step() {
    this.nowMs = (this.nowMs + 1) | 0;

    for (const conn of this.conns.values()) {
      this._checkRto(conn);

      if (conn.state === "TIME-WAIT" && conn.timeWaitUntil && this.nowMs >= conn.timeWaitUntil) {
        this._destroy(conn, "TIME-WAIT expired");
      }
    }
  }

  /**
   * Compute advertised receive window (rwnd) from buffers.
   * Returns a 16-bit value (0..65535) for the TCP header window field.
   * @param {TCPSocket} conn
   * @returns {number}
   */
  _calcRcvWnd(conn) {
    let appQueued = 0;
    for (const c of conn.in) appQueued += c.length;

    const used = (conn.oooBytes ?? 0) + appQueued;
    const free = Math.max(0, (conn.rcvCap ?? (256 * 1024)) - used);

    // No window scaling -> clamp to 16-bit.
    return (Math.min(65535, free) | 0) >>> 0;
  }

  /**
   * Build a unique connection key.
   * @param {IPAddress} localIP
   * @param {number} localPort
   * @param {IPAddress} remoteIP
   * @param {number} remotePort
   * @returns {string}
   */
  _tcpKey(localIP, localPort, remoteIP, remotePort) {
    return `${localIP.toString()}:${localPort}>${remoteIP.toString()}:${remotePort}`;
  }

  /**
   * Allocate an ephemeral TCP source port.
   * @returns {number}
   * @throws if no free port is available
   */
  _allocEphemeralPort() {
    for (let p = 49152; p < 65535; p++) {
      if (!this.sockets.has(p)) return p;
    }
    throw new Error("No free TCP ports");
  }

  /**
   * Open a TCP server socket (LISTEN).
   * @param {IPAddress} bindaddr Must be 0.0.0.0
   * @param {number} port TCP port to listen on
   * @returns {number}
   */
  openServer(bindaddr, port) {
    if (this.sockets.get(port)) throw new Error("Port is in use");
    if (port <= 0 || port > 65535) throw new Error("Port invalid");
    if (bindaddr.toString() !== "0.0.0.0") throw new Error("Only 0.0.0.0 supported");

    const s = new TCPSocket();
    s.port = port;
    s.bindaddr = bindaddr;
    s.state = "LISTEN";
    this.sockets.set(port, s);
    return port;
  }

  /**
   * Wait for an incoming TCP connection on a listening socket.
   * @param {number} ref Listening port reference
   * @returns {Promise<string|null>}
   */
  accept(ref) {
    const listen = this.sockets.get(ref);
    if (!listen) throw new Error("Port not in use!");
    if (listen.state !== "LISTEN") throw new Error("Socket not LISTEN");

    if (listen.acceptQueue.length > 0) {
      const c = listen.acceptQueue.shift() ?? null;
      return Promise.resolve(c ? c.key : null);
    }

    return new Promise((resolve) => {
      listen.acceptWaiters.push((conn) => resolve(conn ? conn.key : null));
    });
  }

  /**
   * Close a TCP server socket (LISTEN only).
   * @param {number} ref
   */
  closeServer(ref) {
    const socket = this.sockets.get(ref);
    if (!socket) return;
    if (socket.state !== "LISTEN") throw new Error("Can only close LISTEN sockets");

    while (socket.acceptWaiters.length) socket.acceptWaiters.shift()?.(null);
    socket.acceptQueue.length = 0;
    this.sockets.delete(ref);
  }

  /**
   * Actively establish a TCP connection (client side).
   * @param {IPAddress} dstIP
   * @param {number} dstPort
   * @returns {Promise<TCPSocket>}
   */
  async connect(dstIP, dstPort) {
    const srcPort = this._allocEphemeralPort();
    const localIP = this._resolveSrcIp(dstIP);

    const conn = new TCPSocket();
    conn.localIP = localIP;
    conn.peerIP = dstIP;
    conn.peerPort = dstPort | 0;
    conn.port = srcPort;
    conn.state = "SYN-SENT";
    conn.myacc = (1000 + Math.floor(Math.random() * 100000)) >>> 0;
    conn.theiracc = 0;
    conn.mss = this.defaultMSS;

    const key = this._tcpKey(conn.localIP, conn.port, conn.peerIP, conn.peerPort);
    conn.key = key;

    this.conns.set(key, conn);
    this.sockets.set(srcPort, conn);

    // send SYN (queued for retransmission)
    this._sendSegment(conn, {
      seq: conn.myacc,
      ack: 0,
      flags: TCPPacket.FLAG_SYN,
      window: this._calcRcvWnd(conn),
      payload: new Uint8Array(),
    });
    conn.myacc = u32(conn.myacc + 1);

    // wait until handshake completes
    await new Promise((resolve, reject) => {
      conn.connectWaiters.push((err) => (err ? reject(err) : resolve()));
      if (conn.state === "ESTABLISHED") resolve();
      if (conn.state === "CLOSED") reject(new Error("connect failed"));
    });

    return conn;
  }

  /**
   * Receive data from a TCP connection.
   * @param {string} key
   * @returns {Promise<Uint8Array|null>}
   */
  recv(key) {
    const conn = this.conns.get(key);
    if (!conn) throw new Error(`recv: Connection not found: ${key}`);

    if (conn.in.length > 0) return Promise.resolve(conn.in.shift() ?? null);
    if (conn.eof) return Promise.resolve(null);

    return new Promise((resolve) => conn.waiters.push(resolve));
  }

  /**
   * Enqueue app data into send queue, then flush.
   * @param {string} key
   * @param {Uint8Array} data
   */
  send(key, data) {
    const conn = this.conns.get(key);
    if (!conn) throw new Error(`send: Connection not found: ${key}`);
    if (conn.state !== "ESTABLISHED" && conn.state !== "CLOSE-WAIT") {
      throw new Error("Not established");
    }
    if (!data || data.length === 0) return;

    conn.sendQ.push(data);
    conn.sendQBytes = (conn.sendQBytes ?? 0) + data.length;

    this._flushSend(conn);
  }

  /**
   * Flush queued app data subject to peer window, MSS, and in-flight bytes.
   * @param {TCPSocket} conn
   */
  _flushSend(conn) {
    if (conn.state !== "ESTABLISHED" && conn.state !== "CLOSE-WAIT") return;
    if (!conn.sendQ || conn.sendQ.length === 0) return;

    const sndUna = (conn.outQ.length > 0) ? (conn.outQ[0].seq >>> 0) : (conn.myacc >>> 0);
    const sndNxt = conn.myacc >>> 0;

    const inFlight = seqDist(sndUna, sndNxt);

    const wnd = (conn.sndWnd >>> 0);
    let canSend = 0;
    if (wnd > inFlight) canSend = (wnd - inFlight) >>> 0;

    const mss = (conn.mss ?? this.defaultMSS) | 0;

    while (canSend > 0 && conn.sendQ.length > 0) {
      const head = conn.sendQ[0];
      if (!head || head.length === 0) {
        conn.sendQ.shift();
        continue;
      }

      const n = Math.min(head.length, mss, canSend) | 0;
      if (n <= 0) break;

      const chunk = head.subarray(0, n);

      if (n === head.length) conn.sendQ.shift();
      else conn.sendQ[0] = head.subarray(n);

      conn.sendQBytes = Math.max(0, (conn.sendQBytes ?? 0) - n);

      this._sendSegment(conn, {
        seq: conn.myacc,
        ack: conn.theiracc,
        flags: TCPPacket.FLAG_ACK,
        window: this._calcRcvWnd(conn),
        payload: chunk,
      });
      conn.myacc = u32(conn.myacc + chunk.length);

      canSend = (canSend - n) >>> 0;
    }
  }

  /**
   * Initiate a TCP connection close (FIN).
   * @param {string} key
   */
  close(key) {
    const conn = this.conns.get(key);
    if (!conn) return;

    if (conn.state === "ESTABLISHED" || conn.state === "CLOSE-WAIT") {
      this._sendSegment(conn, {
        seq: conn.myacc,
        ack: conn.theiracc,
        flags: TCPPacket.FLAG_FIN | TCPPacket.FLAG_ACK,
        window: this._calcRcvWnd(conn),
        payload: new Uint8Array(),
      });
      conn.myacc = u32(conn.myacc + 1);
      conn.state = conn.state === "ESTABLISHED" ? "FIN-WAIT-1" : "LAST-ACK";
    }
  }

  /**
   * Destroy all TCP connections and listening sockets.
   * @param {string} reason
   */
  destroyAll(reason = "stack shutdown") {
    const conns = Array.from(this.conns.values());
    for (const conn of conns) this._destroy(conn, reason);

    for (const [port, sock] of this.sockets.entries()) {
      if (sock.state === "LISTEN") {
        while (sock.acceptWaiters.length) sock.acceptWaiters.shift()?.(null);
        sock.acceptQueue.length = 0;
        this.sockets.delete(port);
      }
    }
  }

  /**
   * Send a RST in response to an incoming segment for which no connection exists.
   * @param {IPAddress} localIP
   * @param {number} localPort
   * @param {IPAddress} remoteIP
   * @param {number} remotePort
   * @param {TCPPacket} tcp
   */
  _sendRstForSegment(localIP, localPort, remoteIP, remotePort, tcp) {
    const syn = tcp.hasFlag(TCPPacket.FLAG_SYN);
    const fin = tcp.hasFlag(TCPPacket.FLAG_FIN);
    const ack = tcp.hasFlag(TCPPacket.FLAG_ACK);

    const payloadLen = (tcp.payload?.length ?? 0) | 0;
    const segLen = (payloadLen + (syn ? 1 : 0) + (fin ? 1 : 0)) >>> 0;

    let flags = TCPPacket.FLAG_RST;
    let seq = 0 >>> 0;
    let ackNo = 0 >>> 0;

    if (ack) {
      seq = tcp.ack >>> 0;
      ackNo = 0;
      flags = TCPPacket.FLAG_RST;
    } else {
      seq = 0;
      ackNo = u32((tcp.seq >>> 0) + segLen);
      flags = TCPPacket.FLAG_RST | TCPPacket.FLAG_ACK;
    }

    const rstBytes = new TCPPacket({
      srcPort: localPort,
      dstPort: remotePort,
      seq,
      ack: ackNo,
      flags,
      window: 0,
      payload: new Uint8Array(),
    }).pack();

    this._ipSend({
      dst: remoteIP,
      src: localIP,
      protocol: 6,
      payload: rstBytes,
    });
  }

  /**
   * Called by IPStack when an IPv4 packet with protocol=6 is accepted.
   * @param {import("../net/pdu/IPv4Packet.js").IPv4Packet} packet
   */
  handle(packet) {
    const tcp = TCPPacket.fromBytes(packet.payload);

    const syn = tcp.hasFlag(TCPPacket.FLAG_SYN);
    const ack = tcp.hasFlag(TCPPacket.FLAG_ACK);
    const fin = tcp.hasFlag(TCPPacket.FLAG_FIN);
    const rst = tcp.hasFlag(TCPPacket.FLAG_RST);

    // Requires: IPAddress.fromUInt8(Uint8Array(4))
    const remoteIP = IPAddress.fromUInt8(packet.src);
    const localIP = IPAddress.fromUInt8(packet.dst);

    const remotePort = tcp.srcPort | 0;
    const localPort = tcp.dstPort | 0;

    const key = this._tcpKey(localIP, localPort, remoteIP, remotePort);
    let conn = this.conns.get(key);

    // 0) No existing connection -> possibly a new inbound connection to LISTEN
    if (!conn) {
      const listen = this.sockets.get(localPort);
      const isListening = !!listen && listen.state === "LISTEN";

      // New inbound SYN to LISTEN => normal accept path
      if (syn && !ack && isListening) {
        conn = new TCPSocket();
        conn.localIP = localIP;
        conn.peerIP = remoteIP;
        conn.peerPort = remotePort;
        conn.port = localPort;
        conn.state = "SYN-RECEIVED";
        conn.theiracc = u32((tcp.seq >>> 0) + 1);
        conn.myacc = (1000 + Math.floor(Math.random() * 100000)) >>> 0;
        conn.mss = this.defaultMSS;
        conn.key = key;

        conn.finSeq = null;

        this.conns.set(key, conn);

        this._sendSegment(conn, {
          seq: conn.myacc,
          ack: conn.theiracc,
          flags: TCPPacket.FLAG_SYN | TCPPacket.FLAG_ACK,
          window: this._calcRcvWnd(conn),
          payload: new Uint8Array(),
        });
        conn.myacc = u32(conn.myacc + 1);
        return;
      }

      // Port closed => RST for SYN or segments carrying ACK
      if (!isListening) {
        if (syn || ack) {
          this._sendRstForSegment(localIP, localPort, remoteIP, remotePort, tcp);
        }
      }
      return;
    }

    // 1) RST: immediate teardown
    if (rst) {
      this._destroy(conn, "RST");
      return;
    }

    // Update peer advertised window
    const prevSndWnd = conn.sndWnd >>> 0;
    conn.sndWnd = (tcp.window >>> 0);

    // ACK processing
    if (ack) {
      const ackNo = tcp.ack >>> 0;

      const sndUna = (conn.outQ.length > 0) ? (conn.outQ[0].seq >>> 0) : (conn.myacc >>> 0);
      const sndNxt = (conn.myacc >>> 0);

      const okAck = seqGE(ackNo, sndUna) && seqLE(ackNo, sndNxt);

      if (okAck) this._onAck(conn, ackNo);
    }

    if (conn.sendQBytes > 0 && ((conn.sndWnd >>> 0) !== prevSndWnd || ack)) {
      this._flushSend(conn);
    }

    // TIME-WAIT: ignore payload/state changes, but re-ACK
    if (conn.state === "TIME-WAIT") {
      this._sendAckOnly(conn, true);
      return;
    }

    // LAST-ACK: waiting for ACK of our FIN
    if (conn.state === "LAST-ACK") {
      if (ack && (tcp.ack >>> 0) === (conn.myacc >>> 0)) {
        this._destroy(conn, "closed (LAST-ACK complete)");
      }
      return;
    }

    // Client handshake: SYN-SENT -> ESTABLISHED on SYN+ACK
    if (conn.state === "SYN-SENT") {
      if (syn && ack && (tcp.ack >>> 0) === (conn.myacc >>> 0)) {
        conn.theiracc = u32((tcp.seq >>> 0) + 1);
        conn.state = "ESTABLISHED";

        while (conn.connectWaiters.length) conn.connectWaiters.shift()?.(null);

        this._sendAckOnly(conn);
        this._flushSend(conn);
      }
      return;
    }

    // Server handshake: SYN-RECEIVED -> ESTABLISHED on final ACK
    if (conn.state === "SYN-RECEIVED") {
      if (ack && (tcp.ack >>> 0) === (conn.myacc >>> 0)) {
        conn.state = "ESTABLISHED";

        const listen = this.sockets.get(conn.port);
        if (listen && listen.state === "LISTEN") {
          const w = listen.acceptWaiters.shift();
          if (w) w(conn);
          else listen.acceptQueue.push(conn);
        }
      }
      return;
    }

    // FIN-WAIT-1 -> FIN-WAIT-2 when our FIN is ACKed
    if (conn.state === "FIN-WAIT-1") {
      if (ack && (tcp.ack >>> 0) === (conn.myacc >>> 0)) {
        conn.state = "FIN-WAIT-2";
      }
    }

    // Accept data/FIN only in these states
    if (
      conn.state !== "ESTABLISHED" &&
      conn.state !== "CLOSE-WAIT" &&
      conn.state !== "FIN-WAIT-1" &&
      conn.state !== "FIN-WAIT-2"
    ) {
      return;
    }

    const payload = tcp.payload ?? new Uint8Array();

    // Record FIN position (FIN is after payload)
    if (fin) {
      const finAt = u32((tcp.seq >>> 0) + (payload.length >>> 0));
      if (conn.finSeq == null) conn.finSeq = finAt;
      else conn.finSeq = seqLT(finAt, conn.finSeq >>> 0) ? finAt : (conn.finSeq >>> 0);
    }

    // Ingest payload respecting receive window
    if (payload.length > 0) {
      this._oooIngest(conn, tcp.seq >>> 0, payload);

      const cap = conn.rcvCap ?? (256 * 1024);
      if ((conn.oooBytes ?? 0) > cap) {
        conn.ooo.length = 0;
        conn.oooBytes = 0;
      }
    }

    // Drain contiguous bytes; may consume FIN
    this._oooDrain(conn);

    // ACK cumulatively + advertise current window
    this._sendAckOnly(conn);
  }

  /**
   * Send a pure ACK segment with current advertised receive window.
   * @param {TCPSocket} conn
   * @param {boolean} [force=false]
   */
  _sendAckOnly(conn, force = false) {
    const ackNo = conn.theiracc >>> 0;
    const wnd = this._calcRcvWnd(conn);
    conn.rcvWnd = wnd;

    if (!force && conn.lastAckSent === ackNo && conn.lastWndSent === wnd) return;

    conn.lastAckSent = ackNo;
    conn.lastWndSent = wnd;

    this._sendSegment(conn, {
      seq: conn.myacc,
      ack: ackNo,
      flags: TCPPacket.FLAG_ACK,
      window: wnd,
      payload: new Uint8Array(),
    });
  }

  /**
   * Send a TCP segment via IP.
   * @param {TCPSocket} conn
   * @param {{
   *   seq:number,
   *   ack:number,
   *   flags:number,
   *   window?:number,
   *   payload:Uint8Array
   * }} seg
   */
  _sendSegment(conn, { seq, ack, flags, window, payload }) {
    const syn = (flags & TCPPacket.FLAG_SYN) !== 0;
    const fin = (flags & TCPPacket.FLAG_FIN) !== 0;

    const len = (payload?.length ?? 0) + (syn ? 1 : 0) + (fin ? 1 : 0);
    const end = u32((seq >>> 0) + (len >>> 0));

    const rexmittable = len > 0; // do not queue pure ACKs

    if (rexmittable) {
      conn.outQ.push({
        seq: seq >>> 0,
        end,
        flags,
        payload,
        sentAt: this.nowMs | 0,
        rexmit: 0,
      });

      if (!conn.rtoDeadline) conn.rtoDeadline = (this.nowMs + conn.rtoMs) | 0;
    }

    const tcpBytes = new TCPPacket({
      srcPort: conn.port,
      dstPort: conn.peerPort,
      seq,
      ack,
      flags,
      window: (window ?? this._calcRcvWnd(conn)) | 0,
      payload
    }).pack();

    this._ipSend({
      dst: conn.peerIP,
      src: conn.localIP,
      protocol: 6,
      payload: tcpBytes,
    });
  }

  /**
   * Process an incoming ACK number: remove fully-acked segments from outQ.
   * @param {TCPSocket} conn
   * @param {number} ackNo
   */
  _onAck(conn, ackNo) {
    let removedAny = false;

    while (conn.outQ.length > 0) {
      const seg = conn.outQ[0];
      if (seqLE(seg.end >>> 0, ackNo >>> 0)) {
        conn.outQ.shift();
        removedAny = true;
      } else break;
    }

    if (!removedAny) return;

    if (conn.outQ.length === 0) {
      conn.rtoDeadline = 0;
      conn.rtoMs = 600;
    } else {
      conn.rtoDeadline = (this.nowMs + conn.rtoMs) | 0;
    }

    this._flushSend(conn);
  }

  /**
   * RTO retransmit for the oldest outstanding segment (simple backoff).
   * @param {TCPSocket} conn
   */
  _checkRto(conn) {
    if (conn.outQ.length === 0) return;
    if (!conn.rtoDeadline) return;
    if ((this.nowMs | 0) < (conn.rtoDeadline | 0)) return;

    const seg = conn.outQ[0];
    seg.rexmit++;

    conn.rtoMs = Math.min(conn.rtoMs * 2, 60_000);
    conn.rtoDeadline = (this.nowMs + conn.rtoMs) | 0;

    const isBareSyn =
      (seg.flags & TCPPacket.FLAG_SYN) !== 0 &&
      (seg.flags & TCPPacket.FLAG_ACK) === 0 &&
      conn.state === "SYN-SENT";

    const flags = isBareSyn ? seg.flags : (seg.flags | TCPPacket.FLAG_ACK);
    const ackNo = isBareSyn ? 0 : (conn.theiracc >>> 0);

    const tcpBytes = new TCPPacket({
      srcPort: conn.port,
      dstPort: conn.peerPort,
      seq: seg.seq,
      ack: ackNo,
      flags,
      window: this._calcRcvWnd(conn),
      payload: seg.payload
    }).pack();

    this._ipSend({
      dst: conn.peerIP,
      src: conn.localIP,
      protocol: 6,
      payload: tcpBytes,
    });
  }

  /**
   * Destroy a TCP connection and wake all waiters.
   * @param {TCPSocket} conn
   * @param {string} reason
   */
  _destroy(conn, reason) {
    while (conn.waiters.length) conn.waiters.shift()?.(null);
    while (conn.connectWaiters.length) conn.connectWaiters.shift()?.(new Error(reason));

    this.conns.delete(conn.key);
    const s = this.sockets.get(conn.port);
    if (s === conn) this.sockets.delete(conn.port);
    conn.state = "CLOSED";
  }

  // ---------------------------------------------------------------------------
  // Out-of-order ingest/drain logic below is unchanged (pure sequence logic)
  // ---------------------------------------------------------------------------

  /**
   * @param {TCPSocket} conn
   * @param {number} seq
   * @param {Uint8Array} payload
   */
  _oooIngest(conn, seq, payload) {
    const expected = conn.theiracc >>> 0;
    const segSeq = seq >>> 0;
    if (payload.length === 0) return;

    const wnd = this._calcRcvWnd(conn);
    conn.rcvWnd = wnd;

    const winStart = expected >>> 0;
    const winEnd = u32((winStart + (wnd >>> 0)) >>> 0);

    let s = segSeq >>> 0;
    let p = payload;
    let segEnd = u32(s + (p.length >>> 0));

    if (seqLE(segEnd, expected)) return;

    if (seqLT(s, expected)) {
      const cut = seqDist(s, expected);
      if (cut >= p.length) return;
      p = p.subarray(cut);
      s = expected;
      segEnd = u32(s + (p.length >>> 0));
      if (p.length === 0) return;
    }

    if (!(seqGT(segEnd, winStart) && seqLT(s, winEnd))) return;

    if (seqLT(s, winStart)) {
      const cut = seqDist(s, winStart);
      if (cut >= p.length) return;
      p = p.subarray(cut);
      s = winStart;
      segEnd = u32(s + (p.length >>> 0));
    }

    if (seqGT(segEnd, winEnd)) {
      const keep = seqDist(s, winEnd);
      if (keep === 0) return;
      p = p.subarray(0, keep);
      segEnd = u32(s + (p.length >>> 0));
    }

    if (p.length === 0) return;

    let nb = { start: s >>> 0, end: segEnd >>> 0, data: p };

    for (let i = 0; i < conn.ooo.length; ) {
      const b = conn.ooo[i];

      if (seqLT(b.end >>> 0, nb.start >>> 0) && (b.end >>> 0) !== (nb.start >>> 0)) {
        i++;
        continue;
      }

      if (seqLT(nb.end >>> 0, b.start >>> 0) && (nb.end >>> 0) !== (b.start >>> 0)) {
        break;
      }

      nb = this._mergeBlocks(nb, b);
      conn.ooo.splice(i, 1);
      conn.oooBytes = Math.max(0, (conn.oooBytes ?? 0) - (b.data?.length ?? 0));
      continue;
    }

    const base = conn.theiracc >>> 0;
    let ins = 0;
    const nbD = seqDist(base, nb.start >>> 0);
    while (ins < conn.ooo.length) {
      const d = seqDist(base, conn.ooo[ins].start >>> 0);
      if (d > nbD) break;
      ins++;
    }

    conn.ooo.splice(ins, 0, nb);
    conn.oooBytes = (conn.oooBytes ?? 0) + nb.data.length;
  }

  /**
   * @param {{start:number,end:number,data:Uint8Array}} a
   * @param {{start:number,end:number,data:Uint8Array}} b
   */
  _mergeBlocks(a, b) {
    const aS = a.start >>> 0, aE = a.end >>> 0;
    const bS = b.start >>> 0, bE = b.end >>> 0;

    const start = seqLT(aS, bS) ? aS : bS;
    const end = seqGT(aE, bE) ? aE : bE;

    const out = new Uint8Array(seqDist(start, end));
    out.set(a.data, seqDist(start, aS));
    out.set(b.data, seqDist(start, bS));

    return { start, end, data: out };
  }

  /**
   * @param {TCPSocket} conn
   */
  _oooDrain(conn) {
    while (conn.ooo.length > 0) {
      const expected = conn.theiracc >>> 0;
      const b = conn.ooo[0];

      if (seqGT(b.start >>> 0, expected)) break;

      if (seqLT(b.start >>> 0, expected)) {
        const cut = seqDist(b.start >>> 0, expected);
        if (cut >= b.data.length) {
          conn.ooo.shift();
          conn.oooBytes = Math.max(0, (conn.oooBytes ?? 0) - b.data.length);
          continue;
        }

        const nd = b.data.subarray(cut);
        conn.ooo[0] = {
          start: expected,
          end: u32(expected + nd.length),
          data: nd,
        };

        conn.oooBytes = Math.max(0, (conn.oooBytes ?? 0) - b.data.length) + nd.length;
        continue;
      }

      conn.ooo.shift();
      conn.oooBytes = Math.max(0, (conn.oooBytes ?? 0) - b.data.length);

      conn.theiracc = u32((conn.theiracc >>> 0) + b.data.length);

      const w = conn.waiters.shift();
      if (w) w(b.data);
      else conn.in.push(b.data);
    }

    if (conn.finSeq != null && (conn.finSeq >>> 0) === (conn.theiracc >>> 0)) {
      conn.theiracc = u32((conn.theiracc >>> 0) + 1);
      conn.finSeq = null;

      conn.eof = true;
      while (conn.waiters.length) conn.waiters.shift()?.(null);

      if (conn.state === "ESTABLISHED") {
        conn.state = "CLOSE-WAIT";
      } else if (conn.state === "FIN-WAIT-2") {
        conn.state = "TIME-WAIT";
        conn.timeWaitUntil = (this.nowMs + this.timeWaitMs) | 0;
      }
    }
  }
}

/**
 * Internal TCP socket / connection state.
 */
export class TCPSocket {
  port = 0;

  /** @type {IPAddress} */
  bindaddr = IPAddress.fromString("0.0.0.0");

  key = "";

  /** @type {IPAddress} */
  localIP = IPAddress.fromString("0.0.0.0");
  /** @type {IPAddress} */
  peerIP = IPAddress.fromString("0.0.0.0");

  peerPort = 0;

  /** @type {TcpState} */
  state = "CLOSED";

  myacc = 0;
  theiracc = 0;

  /** @type {number} */
  mss = 512;

  /** @type {Array<Uint8Array>} */
  in = [];

  /** @type {Array<(value: Uint8Array|null) => void>} */
  waiters = [];

  /** @type {Array<TCPSocket>} */
  acceptQueue = [];

  /** @type {Array<(value: TCPSocket|null) => void>} */
  acceptWaiters = [];

  /** @type {Array<(err: Error|null) => void>} */
  connectWaiters = [];

  // ---------------------------------------------------------------------------
  // Flow control / EOF
  // ---------------------------------------------------------------------------

  /** receive buffer capacity used for rwnd */
  rcvCap = 256 * 1024;

  /** advertised receive window (0..65535) */
  rcvWnd = 65535;

  /** set true once FIN has been received/consumed (EOF) */
  eof = false;

  // ---------------------------------------------------------------------------
  // Sender flow control (respect peer window)
  // ---------------------------------------------------------------------------

  /** peer-advertised window (16-bit field), bytes allowed outstanding */
  sndWnd = 65535;

  /** queued app data not yet transmitted due to window limits */
  /** @type {Array<Uint8Array>} */
  sendQ = [];

  /** total bytes currently queued in sendQ */
  sendQBytes = 0;

  // ---------------------------------------------------------------------------
  // OOO receive queue (improved): sorted interval blocks
  // ---------------------------------------------------------------------------

  /** @type {Array<{start:number,end:number,data:Uint8Array}>} */
  ooo = [];

  /** @type {number} */
  oooBytes = 0;

  /** @type {number|null} */
  finSeq = null;

  /** @type {number} */
  lastAckSent = -1;

  /** @type {number} */
  lastWndSent = -1;

  // ---------------------------------------------------------------------------
  // Outgoing retransmission buffer + RTO timer state
  // ---------------------------------------------------------------------------

  /** @type {Array<{seq:number, end:number, flags:number, payload:Uint8Array, sentAt:number, rexmit:number}>} */
  outQ = [];

  /** @type {number} initial RTO in simulated ms (ticks) */
  rtoMs = 600;

  /** @type {number} absolute deadline in engine.nowMs when to retransmit */
  rtoDeadline = 0;

  // ---------------------------------------------------------------------------
  // TIME-WAIT
  // ---------------------------------------------------------------------------

  /** @type {number} absolute time in engine.nowMs when TIME-WAIT ends */
  timeWaitUntil = 0;
}
