//@ts-check
import { TCPPacket } from "../pdu/TCPPacket.js";
import { IPUInt8ToNumber } from "../helpers.js";

/**
 * TCP connection states (simplified).
 * @typedef {"LISTEN"|"SYN-RECEIVED"|"ESTABLISHED"|"CLOSED"|"SYN-SENT"|"FIN-WAIT-1"|"FIN-WAIT-2"|"LAST-ACK"|"CLOSE-WAIT"} TcpState
 */

/**
 * TCP engine implementing a minimal TCP stack:
 * - connection management
 * - segmentation (pseudo-MSS)
 * - basic handshake and close FSM
 * - in-order data delivery
 *
 * All TCP state is owned by this engine.
 */
export class TcpEngine {

  /**
   * @param {{
   *   ipSend: (opts: {
   *     dst:number,
   *     src:number,
   *     protocol:number,
   *     payload:Uint8Array
   *   }) => (void|Promise<void>),
   *   resolveSrcIp: (dstIp:number) => number,
   *   tickMs: () => number
   * }} deps
   *
   * @description
   * `ipSend`        – callback to send an IPv4 packet (protocol=6).
   * `resolveSrcIp` – returns the local source IP to use for a given destination.
   * `tickMs`       – simulation tick duration (used for future timers).
   */
  constructor(deps) {
    this._ipSend = deps.ipSend;
    this._resolveSrcIp = deps.resolveSrcIp;
    this._tickMs = deps.tickMs;

    /** @type {Map<number, TCPSocket>} */
    this.sockets = new Map(); // port -> listen socket or connected socket

    /** @type {Map<string, TCPSocket>} */
    this.conns = new Map();   // connection key -> connected socket

    /** @type {number} */
    this.defaultMSS = 512;
  }

  /**
   * Build a unique connection key.
   * @param {number} localIP
   * @param {number} localPort
   * @param {number} remoteIP
   * @param {number} remotePort
   * @returns {string}
   */
  _tcpKey(localIP, localPort, remoteIP, remotePort) {
    return `${localIP}:${localPort}>${remoteIP}:${remotePort}`;
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
   *
   * @param {number} bindaddr Must be 0 (0.0.0.0)
   * @param {number} port TCP port to listen on
   * @returns {number} The listening port reference
   */
  openServer(bindaddr, port) {
    if (this.sockets.get(port)) throw new Error("Port is in use");
    if (port <= 0 || port > 65535) throw new Error("Port invalid");
    if (bindaddr !== 0) throw new Error("Only 0.0.0.0 supported");

    const s = new TCPSocket();
    s.port = port;
    s.bindaddr = bindaddr;
    s.state = "LISTEN";
    this.sockets.set(port, s);
    return port;
  }

  /**
   * Wait for an incoming TCP connection on a listening socket.
   *
   * @param {number} ref Listening port reference
   * @returns {Promise<string|null>}
   * Resolves with the connection key, or null if the server socket was closed.
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
   *
   * @param {number} ref Listening port reference
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
   *
   * @param {number} dstIP Destination IPv4 address (numeric)
   * @param {number} dstPort Destination TCP port
   * @returns {Promise<TCPSocket>}
   * Resolves once the connection reaches ESTABLISHED.
   */
  async connect(dstIP, dstPort) {
    const srcPort = this._allocEphemeralPort();
    const localIP = this._resolveSrcIp(dstIP) >>> 0;

    const conn = new TCPSocket();
    conn.localIP = localIP;
    conn.peerIP = dstIP >>> 0;
    conn.peerPort = dstPort | 0;
    conn.port = srcPort;
    conn.state = "SYN-SENT";
    conn.myacc = 1000 + Math.floor(Math.random() * 100000);
    conn.theiracc = 0;
    conn.mss = this.defaultMSS;

    const key = this._tcpKey(conn.localIP, conn.port, conn.peerIP, conn.peerPort);
    conn.key = key;

    this.conns.set(key, conn);
    this.sockets.set(srcPort, conn);

    // send SYN
    this._sendSegment(conn, {
      seq: conn.myacc,
      ack: 0,
      flags: TCPPacket.FLAG_SYN,
      payload: new Uint8Array(),
    });
    conn.myacc += 1;

    // wait until handshake completes
    await new Promise((resolve, reject) => {
      conn.connectWaiters.push((err) => (err ? reject(err) : resolve()));
      if (conn.state === "ESTABLISHED") resolve();
      if (conn.state === "CLOSED") reject(new Error("connect failed"));
    });

    return conn;
  }

  /**
   * Receive data from an established TCP connection.
   *
   * @param {string} key Connection key
   * @returns {Promise<Uint8Array|null>}
   * Resolves with received payload, or null if the connection closes.
   */
  recv(key) {
    const conn = this.conns.get(key);
    if (!conn) throw new Error(`recv: Connection not found: ${key}`);
    if (conn.in.length > 0) return Promise.resolve(conn.in.shift() ?? null);
    return new Promise((resolve) => conn.waiters.push(resolve));
  }

  /**
   * Send application data over an established TCP connection.
   *
   * Performs TCP segmentation using a pseudo-MSS.
   *
   * @param {string} key Connection key
   * @param {Uint8Array} data Application payload
   */
  send(key, data) {
    const conn = this.conns.get(key);
    if (!conn) throw new Error(`send: Connection not found: ${key}`);
    if (conn.state !== "ESTABLISHED") throw new Error("Not established");

    const mss = (conn.mss ?? this.defaultMSS) | 0;

    for (let off = 0; off < data.length; off += mss) {
      const chunk = data.subarray(off, Math.min(data.length, off + mss));
      this._sendSegment(conn, {
        seq: conn.myacc,
        ack: conn.theiracc,
        flags: TCPPacket.FLAG_ACK,
        payload: chunk,
      });
      conn.myacc += chunk.length;
    }
  }

  /**
   * Initiate a TCP connection close (FIN).
   *
   * @param {string} key Connection key
   */
  close(key) {
    const conn = this.conns.get(key);
    if (!conn) return;

    if (conn.state === "ESTABLISHED" || conn.state === "CLOSE-WAIT") {
      this._sendSegment(conn, {
        seq: conn.myacc,
        ack: conn.theiracc,
        flags: TCPPacket.FLAG_FIN | TCPPacket.FLAG_ACK,
        payload: new Uint8Array(),
      });
      conn.myacc += 1;
      conn.state = (conn.state === "ESTABLISHED") ? "FIN-WAIT-1" : "LAST-ACK";
    }
  }

  /**
   * Destroy all TCP connections and listening sockets.
   *
   * @param {string} reason Reason passed to waiters
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
   * Called by IPStack when an IPv4 packet with protocol=6 is accepted.
   * @param {import("../pdu/IPv4Packet.js").IPv4Packet} packet
   */
  /**
  * Called by IPStack when an IPv4 packet with protocol=6 is accepted.
  * @param {import("../pdu/IPv4Packet.js").IPv4Packet} packet
  */
  handle(packet) {

    const tcp = TCPPacket.fromBytes(packet.payload);

    const syn = tcp.hasFlag(TCPPacket.FLAG_SYN);
    const ack = tcp.hasFlag(TCPPacket.FLAG_ACK);
    const fin = tcp.hasFlag(TCPPacket.FLAG_FIN);
    const rst = tcp.hasFlag(TCPPacket.FLAG_RST);

    const remoteIP = IPUInt8ToNumber(packet.src) >>> 0;
    const localIP = IPUInt8ToNumber(packet.dst) >>> 0;
    const remotePort = tcp.srcPort | 0;
    const localPort = tcp.dstPort | 0;

    const key = this._tcpKey(localIP, localPort, remoteIP, remotePort);
    let conn = this.conns.get(key);

    // -------------------------------------------------------------------------
    // 0) No existing connection -> possibly a new inbound connection to LISTEN
    // -------------------------------------------------------------------------
    if (!conn) {
      if (!(syn && !ack)) return;

      const listen = this.sockets.get(localPort);
      if (!listen || listen.state !== "LISTEN") return;

      conn = new TCPSocket();
      conn.localIP = localIP;
      conn.peerIP = remoteIP;
      conn.peerPort = remotePort;
      conn.port = localPort;
      conn.state = "SYN-RECEIVED";
      conn.theiracc = (tcp.seq + 1) >>> 0;
      conn.myacc = 1000;
      conn.mss = this.defaultMSS;
      conn.key = key;

      conn.finSeq = null;

      this.conns.set(key, conn);

      this._sendSegment(conn, {
        seq: conn.myacc,
        ack: conn.theiracc,
        flags: TCPPacket.FLAG_SYN | TCPPacket.FLAG_ACK,
        payload: new Uint8Array(),
      });
      conn.myacc = (conn.myacc + 1) >>> 0;
      return;
    }

    // -------------------------------------------------------------------------
    // 1) RST: immediate teardown
    // -------------------------------------------------------------------------
    if (rst) {
      this._destroy(conn, "RST");
      return;
    }

    // -------------------------------------------------------------------------
    // 1b) LAST-ACK: waiting for ACK of our FIN (passive close completion)
    // -------------------------------------------------------------------------
    if (conn.state === "LAST-ACK") {
      if (ack && (tcp.ack >>> 0) === (conn.myacc >>> 0)) {
        this._destroy(conn, "closed (LAST-ACK complete)");
      }
      return;
    }

    // -------------------------------------------------------------------------
    // 2) Client handshake: SYN-SENT -> ESTABLISHED on SYN+ACK
    // -------------------------------------------------------------------------
    if (conn.state === "SYN-SENT") {
      if (syn && ack && (tcp.ack >>> 0) === (conn.myacc >>> 0)) {
        conn.theiracc = (tcp.seq + 1) >>> 0;
        conn.state = "ESTABLISHED";

        while (conn.connectWaiters.length) conn.connectWaiters.shift()?.(null);

        this._sendAckOnly(conn);
      }
      return;
    }

    // -------------------------------------------------------------------------
    // 3) Server handshake: SYN-RECEIVED -> ESTABLISHED on final ACK
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // 4) Closing state (active close side): FIN-WAIT-1 -> FIN-WAIT-2 when our FIN is ACKed
    // -------------------------------------------------------------------------
    if (conn.state === "FIN-WAIT-1") {
      if (ack && (tcp.ack >>> 0) === (conn.myacc >>> 0)) {
        conn.state = "FIN-WAIT-2";
      }
      // Continue processing FIN/data below if present.
    }

    // -------------------------------------------------------------------------
    // 5) Data + FIN handling with out-of-order reassembly
    // -------------------------------------------------------------------------
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
      const finAt = (((tcp.seq >>> 0) + (payload.length >>> 0)) >>> 0);
      if (conn.finSeq == null) conn.finSeq = finAt;
      else conn.finSeq = Math.min(conn.finSeq >>> 0, finAt) >>> 0;
    }

    // Ingest payload (in-order OR out-of-order)
    if (payload.length > 0) {
      this._oooIngest(conn, tcp.seq >>> 0, payload);

      const cap = 256 * 1024; // 256 KiB per conn
      if ((conn.oooBytes ?? 0) > cap) {
        conn.ooo.clear();
        conn.oooBytes = 0;
      }
    }

    // Drain contiguous bytes starting at expected sequence number.
    // This will also consume FIN if finSeq matches the boundary.
    this._oooDrain(conn);

    // ACK cumulatively (next expected byte)
    this._sendAckOnly(conn);
  }



  /**
   * Send a pure ACK segment.
   * @param {TCPSocket} conn
   */
  _sendAckOnly(conn, force = false) {
    const ackNo = conn.theiracc >>> 0;

    if (!force && conn.lastAckSent === ackNo) {
      return; // suppress duplicate ACK
    }

    conn.lastAckSent = ackNo;

    this._sendSegment(conn, {
      seq: conn.myacc,
      ack: ackNo,
      flags: TCPPacket.FLAG_ACK,
      payload: new Uint8Array(),
    });
  }

  /**
   * Send a TCP segment via IP.
   *
   * @param {TCPSocket} conn
   * @param {{
   *   seq:number,
   *   ack:number,
   *   flags:number,
   *   payload:Uint8Array
   * }} seg
   */
  _sendSegment(conn, { seq, ack, flags, payload }) {
    const tcpBytes = new TCPPacket({
      srcPort: conn.port,
      dstPort: conn.peerPort,
      seq,
      ack,
      flags,
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
   * Destroy a TCP connection and wake all waiters.
   *
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

  /**
   * Buffer or immediately consume an incoming payload at a given sequence number.
   * Out-of-order payload is stored in conn.ooo.
   *
   * @param {TCPSocket} conn
   * @param {number} seq Segment sequence number (tcp.seq)
   * @param {Uint8Array} payload Segment payload
   */
  _oooIngest(conn, seq, payload) {
    const expected = conn.theiracc >>> 0;
    const segSeq = seq >>> 0;

    if (payload.length === 0) return;

    // Duplicate/old data entirely before expected -> ignore
    if (segSeq + payload.length <= expected) {
      return;
    }

    // Overlap: trim prefix that we already consumed
    let p = payload;
    let s = segSeq;
    if (s < expected) {
      const cut = expected - s;
      p = p.subarray(cut);
      s = expected;
      if (p.length === 0) return;
    }

    // If exactly in-order start, deliver directly by putting into buffer at expected
    // (we'll drain uniformly in _oooDrain).
    if (!conn.ooo.has(s)) {
      conn.ooo.set(s, p);
      conn.oooBytes = (conn.oooBytes ?? 0) + p.length;
    }
  }

  /**
   * Drain buffered in-order payload starting at conn.theiracc,
   * delivering sequential chunks to application waiters / queue.
   *
   * @param {TCPSocket} conn
   */
  _oooDrain(conn) {
    while (true) {
      const expected = conn.theiracc >>> 0;
      const chunk = conn.ooo.get(expected);
      if (!chunk) break;

      conn.ooo.delete(expected);
      conn.oooBytes = Math.max(0, (conn.oooBytes ?? 0) - chunk.length);

      // deliver
      conn.theiracc = (conn.theiracc + chunk.length) >>> 0;

      const w = conn.waiters.shift();
      if (w) w(chunk);
      else conn.in.push(chunk);
    }

    // If FIN arrived exactly at the boundary we have now reached, consume it
    if (conn.finSeq != null && (conn.finSeq >>> 0) === (conn.theiracc >>> 0)) {
      // FIN consumes one sequence number
      conn.theiracc = (conn.theiracc + 1) >>> 0;
      conn.finSeq = null;

      // Passive close entry
      if (conn.state === "ESTABLISHED") conn.state = "CLOSE-WAIT";
      else if (conn.state === "FIN-WAIT-2") this._destroy(conn, "closed");
    }
  }
}

/**
 * Internal TCP socket / connection state.
 */
export class TCPSocket {
  port = 0;
  bindaddr = 0;
  key = "";

  localIP = 0;
  peerIP = 0;
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

  /** @type {Map<number, Uint8Array>} */
  ooo = new Map(); // out-of-order payload chunks keyed by seq

  /** @type {number} */
  oooBytes = 0; // total buffered bytes (simple cap)

  /** @type {number|null} */
  finSeq = null; // if FIN received, sequence number AFTER last byte (seq + payloadLen)

  /** @type {number} */
  lastAckSent = -1;
}
