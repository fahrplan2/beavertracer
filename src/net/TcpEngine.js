//@ts-check
import { TCPPacket } from "../net/pdu/TCPPacket.js";
import { IPAddress } from "./models/IPAddress.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";

/**
 * TCP connection states (simplified).
 * @typedef {"LISTEN"|"SYN-RECEIVED"|"ESTABLISHED"|"CLOSED"|"SYN-SENT"|"FIN-WAIT-1"|"FIN-WAIT-2"|"LAST-ACK"|"CLOSE-WAIT"|"TIME-WAIT"|"CLOSING"} TcpState
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

/** a < b (mod 2^32) @param {number} a @param {number} b */
function seqLT(a, b) { return s32diff(a, b) < 0; }
/** a <= b (mod 2^32) @param {number} a @param {number} b */
function seqLE(a, b) { return s32diff(a, b) <= 0; }
/** a > b (mod 2^32) @param {number} a @param {number} b */
function seqGT(a, b) { return s32diff(a, b) > 0; }
/** a >= b (mod 2^32) @param {number} a @param {number} b */
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

    /** @type {number} TIME-WAIT duration in simulated ms */
    this.timeWaitMs = 2000;

    /** @type {number} round-robin pointer for ephemeral port allocation */
    this._nextEphemeralPort = 49152;
  }

  /**
   * Build a 4-byte TCP MSS option (Kind=2, Length=4).
   * @param {number} mss
   * @returns {Uint8Array}
   */
  static _buildMssOption(mss) {
    return new Uint8Array([2, 4, (mss >> 8) & 0xff, mss & 0xff]);
  }

  /**
   * Build a 10-byte TCP Timestamp option (Kind=8, Length=10).
   * @param {number} tsval
   * @param {number} tsecr
   * @returns {Uint8Array}
   */
  static _buildTsOption(tsval, tsecr) {
    const b = new Uint8Array(10);
    b[0] = 8; b[1] = 10;
    b[2] = (tsval >>> 24) & 0xff; b[3] = (tsval >>> 16) & 0xff;
    b[4] = (tsval >>>  8) & 0xff; b[5] =  tsval         & 0xff;
    b[6] = (tsecr >>> 24) & 0xff; b[7] = (tsecr >>> 16) & 0xff;
    b[8] = (tsecr >>>  8) & 0xff; b[9] =  tsecr         & 0xff;
    return b;
  }

  /**
   * Build SYN/SYN-ACK options: MSS (4 bytes) + Timestamp (10 bytes) = 14 bytes.
   * @param {number} mss
   * @param {number} tsval
   * @param {number} tsecr
   * @returns {Uint8Array}
   */
  static _buildSynOptions(mss, tsval, tsecr) {
    const buf = new Uint8Array(14);
    buf.set(TcpEngine._buildMssOption(mss), 0);
    buf.set(TcpEngine._buildTsOption(tsval, tsecr), 4);
    return buf;
  }

  /**
   * Parse MSS value from raw TCP options bytes. Returns null if not present.
   * @param {Uint8Array} options
   * @returns {number|null}
   */
  static _parseMssOption(options) {
    let i = 0;
    while (i < options.length) {
      if (options[i] === 0) break;            // End of Options List
      if (options[i] === 1) { i++; continue; } // NOP
      const kind = options[i];
      if (i + 1 >= options.length) break;
      const len = options[i + 1];
      if (len < 2) break;
      if (kind === 2 && len === 4 && i + 4 <= options.length) {
        return (options[i + 2] << 8) | options[i + 3];
      }
      i += len;
    }
    return null;
  }

  /**
   * Parse Timestamp option from raw TCP options. Returns {tsval, tsecr} or null.
   * @param {Uint8Array} options
   * @returns {{tsval:number, tsecr:number}|null}
   */
  static _parseTsOption(options) {
    let i = 0;
    while (i < options.length) {
      if (options[i] === 0) break;
      if (options[i] === 1) { i++; continue; }
      const kind = options[i];
      if (i + 1 >= options.length) break;
      const len = options[i + 1];
      if (len < 2) break;
      if (kind === 8 && len === 10 && i + 10 <= options.length) {
        const tsval = ((options[i+2]<<24)|(options[i+3]<<16)|(options[i+4]<<8)|options[i+5]) >>> 0;
        const tsecr = ((options[i+6]<<24)|(options[i+7]<<16)|(options[i+8]<<8)|options[i+9]) >>> 0;
        return { tsval, tsecr };
      }
      i += len;
    }
    return null;
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
    const start = this._nextEphemeralPort;
    let p = start;
    do {
      if (!this.sockets.has(p)) {
        this._nextEphemeralPort = (p >= 65534) ? 49152 : p + 1;
        return p;
      }
      p = (p >= 65534) ? 49152 : p + 1;
    } while (p !== start);
    throw new Error("No free TCP ports");
  }

  /**
   * Open a TCP server socket (LISTEN).
   * @param {IPAddress} bindaddr 0.0.0.0 or ::
   * @param {number} port TCP port to listen on
   * @returns {number}
   */
  openServer(bindaddr, port) {
    if (this.sockets.get(port)) throw new Error("Port is in use");
    if (port <= 0 || port > 65535) throw new Error("Port invalid");
    const bindStr = bindaddr.toString();
    if (bindStr !== "0.0.0.0" && bindStr !== "::") throw new Error("Only 0.0.0.0 or :: supported");

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

    // SYN consumes one sequence number — increment before sending so that
    // synchronous loopback delivery sees the correct conn.myacc when the
    // SYN-ACK arrives back within the same call stack.
    const synSeq = conn.myacc;
    conn.myacc = u32(conn.myacc + 1);

    this._sendSegment(conn, {
      seq: synSeq,
      ack: 0,
      flags: TCPPacket.FLAG_SYN,
      window: this._calcRcvWnd(conn),
      options: TcpEngine._buildSynOptions(this.defaultMSS, simTimer.currentTick >>> 0, 0),
      payload: new Uint8Array(),
    });

    // Wait until the handshake completes, or the TCP stack itself gives up —
    // i.e. after TCP_MAX_REXMIT SYN retransmits with exponential backoff
    // (see _fireRto/_destroy). There used to be a separate, much shorter
    // "connect timeout" race here; it fired before even the first SYN
    // retransmit could happen, so a single dropped SYN/SYN-ACK killed the
    // attempt outright instead of letting TCP retry as designed.
    await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
      conn.connectWaiters.push((err) => (err ? reject(err) : resolve()));
      // Loopback delivery can complete the handshake synchronously (within
      // the _sendSegment call above) before this executor even runs.
      if (conn.state === "ESTABLISHED") resolve();
      if (conn.state === "CLOSED")      reject(new Error("connect failed"));
    }));

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
    if (!conn.sendQ || conn.sendQ.length === 0) {
      if (conn.pendingClose) { conn.pendingClose = false; this._sendFin(conn); }
      return;
    }

    const sndUna = (conn.outQ.length > 0) ? (conn.outQ[0].seq >>> 0) : (conn.myacc >>> 0);
    const sndNxt = conn.myacc >>> 0;

    const inFlight = seqDist(sndUna, sndNxt);

    const wnd = Math.min(conn.cwnd >>> 0, conn.sndWnd >>> 0);
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

    if (conn.sendQ.length === 0 && conn.pendingClose) {
      conn.pendingClose = false;
      this._sendFin(conn);
    }
  }

  /**
   * Initiate a TCP connection close (FIN).
   * Defers the FIN if sendQ is non-empty — FIN must follow all outstanding data.
   * @param {string} key
   */
  close(key) {
    const conn = this.conns.get(key);
    if (!conn) return;

    if (conn.state === "ESTABLISHED" || conn.state === "CLOSE-WAIT") {
      if (conn.sendQBytes > 0) {
        conn.pendingClose = true;
        return;
      }
      this._sendFin(conn);
    }
  }

  /**
   * Send a FIN+ACK and advance connection state.
   * @param {TCPSocket} conn
   */
  _sendFin(conn) {
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

  /**
   * Return addressing info for an established connection, or null if not found.
   * @param {string} key
   */
  getConnInfo(key) {
    const conn = this.conns.get(key);
    if (!conn) return null;
    return {
      localIP:   conn.localIP,
      localPort: conn.port,
      peerIP:    conn.peerIP,
      peerPort:  conn.peerPort,
    };
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
   * Called by IPStack when a TCP packet (IPv4 or IPv6) is accepted.
   * @param {import("../net/pdu/IPv4Packet.js").IPv4Packet | import("../net/pdu/IPv6Packet.js").IPv6Packet} packet
   */
  handle(packet) {
    const tcp = TCPPacket.fromBytes(packet.payload);

    const syn = tcp.hasFlag(TCPPacket.FLAG_SYN);
    const ack = tcp.hasFlag(TCPPacket.FLAG_ACK);
    const fin = tcp.hasFlag(TCPPacket.FLAG_FIN);
    const rst = tcp.hasFlag(TCPPacket.FLAG_RST);

    const remoteIP = packet.src;
    const localIP = packet.dst;

    const remotePort = tcp.srcPort | 0;
    const localPort = tcp.dstPort | 0;

    const key = this._tcpKey(localIP, localPort, remoteIP, remotePort);
    let conn = this.conns.get(key);

    // Parse TS option and update tsRecent for established connections
    const inTs = (conn?.tsEnabled)
      ? TcpEngine._parseTsOption(tcp.options ?? new Uint8Array())
      : null;
    if (inTs && conn) conn.tsRecent = inTs.tsval >>> 0;

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

        // Respect peer's advertised MSS (RFC 1122 §4.2.2.6)
        const peerMss = TcpEngine._parseMssOption(tcp.options ?? new Uint8Array());
        if (peerMss != null) conn.mss = Math.min(peerMss, this.defaultMSS);
        conn.cwnd = conn.mss;

        // Timestamp negotiation: offer TS in SYN-ACK if client offered it
        const synTs = TcpEngine._parseTsOption(tcp.options ?? new Uint8Array());
        const synAckOpts = synTs
          ? TcpEngine._buildSynOptions(this.defaultMSS, simTimer.currentTick >>> 0, synTs.tsval >>> 0)
          : TcpEngine._buildMssOption(this.defaultMSS);

        this.conns.set(key, conn);

        const synAckSeq = conn.myacc;
        conn.myacc = u32(conn.myacc + 1);

        this._sendSegment(conn, {
          seq: synAckSeq,
          ack: conn.theiracc,
          flags: TCPPacket.FLAG_SYN | TCPPacket.FLAG_ACK,
          window: this._calcRcvWnd(conn),
          options: synAckOpts,
          payload: new Uint8Array(),
        });

        // Enable TS after SYN-ACK is sent so _sendSegment doesn't auto-append TS yet
        if (synTs) {
          conn.tsEnabled = true;
          conn.tsRecent = synTs.tsval >>> 0;
        }
        return;
      }

      // Port closed => RST for SYN or segments carrying ACK (RFC 793 §3.4: never RST a RST)
      if (!isListening) {
        if (!rst && (syn || ack)) {
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

      if (okAck) this._onAck(conn, ackNo, inTs?.tsecr ?? null);
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
        const peerMss = TcpEngine._parseMssOption(tcp.options ?? new Uint8Array());
        if (peerMss != null) conn.mss = Math.min(peerMss, this.defaultMSS);
        conn.cwnd = conn.mss;

        // Timestamp negotiation: enable if server echoed our TS offer
        const synAckTs = TcpEngine._parseTsOption(tcp.options ?? new Uint8Array());
        if (synAckTs) {
          conn.tsEnabled = true;
          conn.tsRecent = synAckTs.tsval >>> 0;
          // Initial RTT from SYN round-trip (TSecr = TSval we sent in SYN)
          const rttTicks = u32(simTimer.currentTick - synAckTs.tsecr);
          if (rttTicks > 0 && rttTicks < 0x80000000) this._updateRtt(conn, rttTicks);
        }

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
        conn.cwnd = conn.mss; // reset to 1 MSS; _onAck may have grown cwnd for the SYN-ACK seq

        const listen = this.sockets.get(conn.port);
        if (listen && listen.state === "LISTEN") {
          const w = listen.acceptWaiters.shift();
          if (w) w(conn);
          else listen.acceptQueue.push(conn);
        }
      }
      return;
    }

    // FIN-WAIT-1: our FIN ACKed → FIN-WAIT-2 (or TIME-WAIT if their FIN already consumed)
    if (conn.state === "FIN-WAIT-1") {
      if (ack && (tcp.ack >>> 0) === (conn.myacc >>> 0)) {
        conn.state = conn.eof ? "TIME-WAIT" : "FIN-WAIT-2";
        if (conn.state === "TIME-WAIT") {
          this._scheduleTimeWait(conn);
        }
      }
    }

    // CLOSING: waiting for ACK of our FIN after simultaneous close
    if (conn.state === "CLOSING") {
      if (ack && (tcp.ack >>> 0) === (conn.myacc >>> 0)) {
        conn.state = "TIME-WAIT";
        this._scheduleTimeWait(conn);
      }
      return;
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
   * Append TS option to baseOpts if timestamps are enabled for this connection.
   * @param {TCPSocket} conn
   * @param {Uint8Array|undefined} baseOpts
   * @returns {Uint8Array}
   */
  _buildSegmentOptions(conn, baseOpts) {
    if (!conn.tsEnabled) return baseOpts ?? new Uint8Array(0);
    const ts = TcpEngine._buildTsOption(simTimer.currentTick >>> 0, conn.tsRecent >>> 0);
    if (!baseOpts || baseOpts.length === 0) return ts;
    const out = new Uint8Array(baseOpts.length + ts.length);
    out.set(baseOpts); out.set(ts, baseOpts.length);
    return out;
  }

  /**
   * Build and transmit a TCP packet (no outQ involvement).
   * Automatically appends TS option when conn.tsEnabled.
   * @param {TCPSocket} conn
   * @param {{seq:number, ack:number, flags:number, window?:number, options?:Uint8Array, payload:Uint8Array}} seg
   */
  _sendRaw(conn, { seq, ack, flags, window, options, payload }) {
    const tcpBytes = new TCPPacket({
      srcPort: conn.port,
      dstPort: conn.peerPort,
      seq, ack, flags,
      window: (window ?? this._calcRcvWnd(conn)) | 0,
      options: this._buildSegmentOptions(conn, options),
      payload,
    }).pack();
    this._ipSend({ dst: conn.peerIP, src: conn.localIP, protocol: 6, payload: tcpBytes });
  }

  /**
   * Update smoothed RTT and RTO using Jacobson/Karels algorithm (RFC 6298).
   * @param {TCPSocket} conn
   * @param {number} rttTicks  measured round-trip time in simulation ticks
   */
  _updateRtt(conn, rttTicks) {
    const rttMs = rttTicks * SimTimer.SIM_MS_PER_TICK;
    if (conn.srtt === 0) {
      conn.srtt   = rttMs;
      conn.rttvar = rttMs / 2;
    } else {
      const delta = Math.abs(conn.srtt - rttMs);
      conn.rttvar = conn.rttvar * 0.75 + delta * 0.25;
      conn.srtt   = conn.srtt  * 0.875 + rttMs * 0.125;
    }
    conn.rtoMs = Math.max(SimTimer.TCP_MIN_RTO_MS, Math.round(conn.srtt + 4 * conn.rttvar));
  }

  /**
   * Send a TCP segment via IP.
   * @param {TCPSocket} conn
   * @param {{
   *   seq:number,
   *   ack:number,
   *   flags:number,
   *   window?:number,
   *   options?:Uint8Array,
   *   payload:Uint8Array
   * }} seg
   */
  _sendSegment(conn, { seq, ack, flags, window, options, payload }) {
    const syn = (flags & TCPPacket.FLAG_SYN) !== 0;
    const fin = (flags & TCPPacket.FLAG_FIN) !== 0;

    const len = (payload?.length ?? 0) + (syn ? 1 : 0) + (fin ? 1 : 0);
    const end = u32((seq >>> 0) + (len >>> 0));

    const rexmittable = len > 0; // do not queue pure ACKs

    if (rexmittable) {
      const wasEmpty = conn.outQ.length === 0;
      conn.outQ.push({
        seq: seq >>> 0,
        end,
        flags,
        payload,
        rexmit: 0,
      });
      if (wasEmpty) this._scheduleRto(conn);
    }

    this._sendRaw(conn, { seq, ack, flags, window, options, payload });
  }

  /**
   * Process an incoming ACK: remove acked segments, update congestion window.
   * Handles Slow Start, Congestion Avoidance, and Fast Retransmit/Recovery.
   * @param {TCPSocket} conn
   * @param {number} ackNo
   * @param {number|null} [tsecr] TSecr from peer's Timestamp option for RTT measurement
   */
  _onAck(conn, ackNo, tsecr = null) {
    const sndUnaBefore = (conn.outQ.length > 0) ? (conn.outQ[0].seq >>> 0) : (conn.myacc >>> 0);

    let removedAny = false;
    while (conn.outQ.length > 0) {
      const seg = conn.outQ[0];
      if (seqLE(seg.end >>> 0, ackNo >>> 0)) {
        conn.outQ.shift();
        removedAny = true;
      } else break;
    }

    if (!removedAny) {
      // Duplicate ACK: ackNo didn't advance and there is outstanding data
      if (conn.outQ.length > 0 && (ackNo >>> 0) === sndUnaBefore) {
        conn.dupAckCount++;
        if (conn.dupAckCount === 3) {
          // Fast Retransmit: enter Fast Recovery
          const mss = conn.mss | 0;
          conn.ssthresh = Math.max(Math.floor(Math.min(conn.cwnd >>> 0, conn.sndWnd >>> 0) / 2), 2 * mss);
          conn.cwnd = conn.ssthresh + 3 * mss;
          this._retransmitOldest(conn);
        } else if (conn.dupAckCount > 3) {
          // Fast Recovery: inflate cwnd per additional dupACK
          conn.cwnd = (conn.cwnd >>> 0) + (conn.mss | 0);
          this._flushSend(conn);
        }
      }
      return;
    }

    // New data acked
    const bytesAcked = seqDist(sndUnaBefore, ackNo >>> 0);
    conn.dupAckCount = 0;

    // RTT measurement via Timestamps (skip 0-tick samples from synchronous loopbacks)
    if (conn.tsEnabled && tsecr !== null) {
      const rttTicks = u32(simTimer.currentTick - tsecr);
      if (rttTicks > 0 && rttTicks < 0x80000000) this._updateRtt(conn, rttTicks);
    }

    const mss = conn.mss | 0;

    if ((conn.cwnd >>> 0) < (conn.ssthresh >>> 0)) {
      // Slow Start: cwnd grows by one MSS per ACK (doubles each RTT)
      conn.cwnd = (conn.cwnd >>> 0) + Math.min(mss, bytesAcked);
    } else {
      // Congestion Avoidance: linear growth — one MSS per RTT
      conn.cwnd = (conn.cwnd >>> 0) + Math.max(1, Math.floor((mss * mss) / (conn.cwnd >>> 0)));
    }

    if (conn.outQ.length === 0) {
      this._cancelRto(conn);
      if (conn.srtt === 0) conn.rtoMs = 600; // no measurement yet — keep initial value
    } else {
      this._scheduleRto(conn);
    }

    this._flushSend(conn);
  }

  /**
   * Retransmit the oldest unacked segment (used by Fast Retransmit).
   * @param {TCPSocket} conn
   */
  _retransmitOldest(conn) {
    if (conn.outQ.length === 0) return;
    const seg = conn.outQ[0];
    this._sendRaw(conn, {
      seq: seg.seq,
      ack: conn.theiracc >>> 0,
      flags: seg.flags | TCPPacket.FLAG_ACK,
      payload: seg.payload,
    });
  }

  /**
   * Schedule (or reschedule) the RTO timer for conn.
   * @param {TCPSocket} conn
   */
  _scheduleRto(conn) {
    if (conn.rtoTimerId !== null) { simTimer.cancel(conn.rtoTimerId); conn.rtoTimerId = null; }
    if (conn.outQ.length === 0) return;
    conn.rtoTimerId = simTimer.schedule(() => this._fireRto(conn), conn.rtoMs);
  }

  /**
   * Cancel any pending RTO timer for conn.
   * @param {TCPSocket} conn
   */
  _cancelRto(conn) {
    if (conn.rtoTimerId !== null) { simTimer.cancel(conn.rtoTimerId); conn.rtoTimerId = null; }
  }

  /**
   * RTO fired: retransmit oldest unacked segment, apply exponential backoff, reschedule.
   * @param {TCPSocket} conn
   */
  _fireRto(conn) {
    conn.rtoTimerId = null;
    if (conn.outQ.length === 0 || conn.state === "CLOSED") return;

    const seg = conn.outQ[0];
    seg.rexmit++;

    if (seg.rexmit > SimTimer.TCP_MAX_REXMIT) {
      this._destroy(conn, "connection timed out");
      return;
    }

    // Congestion control: timeout → back to Slow Start
    const mss = conn.mss | 0;
    conn.ssthresh = Math.max(Math.floor(conn.cwnd / 2), 2 * mss);
    conn.cwnd = mss;
    conn.dupAckCount = 0;

    conn.rtoMs = Math.min(conn.rtoMs * 2, 60_000);

    const isBareSyn =
      (seg.flags & TCPPacket.FLAG_SYN) !== 0 &&
      (seg.flags & TCPPacket.FLAG_ACK) === 0 &&
      conn.state === "SYN-SENT";

    const flags = isBareSyn ? seg.flags : (seg.flags | TCPPacket.FLAG_ACK);
    const ackNo = isBareSyn ? 0 : (conn.theiracc >>> 0);

    // For SYN retransmits rebuild SYN options (MSS+TS); for data use _sendRaw auto-TS.
    const retxOptions = isBareSyn
      ? TcpEngine._buildSynOptions(conn.mss, simTimer.currentTick >>> 0, 0)
      : undefined;

    this._sendRaw(conn, {
      seq: seg.seq,
      ack: ackNo,
      flags,
      options: retxOptions,
      payload: seg.payload,
    });

    conn.rtoTimerId = simTimer.schedule(() => this._fireRto(conn), conn.rtoMs);
  }

  /**
   * Start the TIME-WAIT timer; destroy the connection when it expires.
   * @param {TCPSocket} conn
   */
  _scheduleTimeWait(conn) {
    if (conn.timeWaitTimerId !== null) { simTimer.cancel(conn.timeWaitTimerId); conn.timeWaitTimerId = null; }
    conn.timeWaitTimerId = simTimer.schedule(() => this._destroy(conn, "TIME-WAIT expired"), this.timeWaitMs);
  }

  /**
   * Destroy a TCP connection and wake all waiters.
   * @param {TCPSocket} conn
   * @param {string} reason
   */
  _destroy(conn, reason) {
    this._cancelRto(conn);
    if (conn.timeWaitTimerId !== null) { simTimer.cancel(conn.timeWaitTimerId); conn.timeWaitTimerId = null; }

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
      } else if (conn.state === "FIN-WAIT-1") {
        // Simultaneous close: their FIN arrived before ACK of ours → CLOSING
        conn.state = "CLOSING";
      } else if (conn.state === "FIN-WAIT-2") {
        conn.state = "TIME-WAIT";
        this._scheduleTimeWait(conn);
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
  // TCP Timestamps (RFC 7323)
  // ---------------------------------------------------------------------------

  /** true once both sides confirmed TS support during handshake */
  tsEnabled = false;

  /** last TSval received from peer — echoed as TSecr in outgoing segments */
  tsRecent = 0;

  // ---------------------------------------------------------------------------
  // RTT estimation (Jacobson/Karels)
  // ---------------------------------------------------------------------------

  /** smoothed RTT in simulated ms (0 = no measurement yet) */
  srtt = 0;

  /** RTT variance in simulated ms */
  rttvar = 0;

  // ---------------------------------------------------------------------------
  // Congestion control
  // ---------------------------------------------------------------------------

  /** congestion window in bytes (starts at 1 MSS) */
  cwnd = 512;

  /** slow start threshold in bytes */
  ssthresh = 65535;

  /** duplicate ACK counter for Fast Retransmit */
  dupAckCount = 0;

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

  /** true when close() was called while sendQ was non-empty; FIN is sent after drain */
  pendingClose = false;

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

  /** @type {Array<{seq:number, end:number, flags:number, payload:Uint8Array, rexmit:number}>} */
  outQ = [];

  /** @type {number} current RTO in simulated ms */
  rtoMs = 600;

  /** @type {number|null} simTimer id for pending RTO retransmit */
  rtoTimerId = null;

  // ---------------------------------------------------------------------------
  // TIME-WAIT
  // ---------------------------------------------------------------------------

  /** @type {number|null} simTimer id for TIME-WAIT expiry */
  timeWaitTimerId = null;
}
