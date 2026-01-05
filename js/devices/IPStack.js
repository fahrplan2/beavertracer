//@ts-check

import { IPNumberToUint8, IPOctetsToNumber, IPUInt8ToNumber, prefixToNetmask } from "../helpers.js";
import { IPv4Packet } from "../pdu/IPv4Packet.js";
import { NetworkInterface } from "./NetworkInterface.js";
import { Observable } from "../common/Observeable.js";
import { ICMPPacket } from "../pdu/ICMPPacket.js";
import { EthernetPort } from "./EthernetPort.js";
import { UDPPacket } from "../pdu/UDPPacket.js";
import { TCPPacket } from "../pdu/TCPPacket.js";
import { SimControl } from "../SimControl.js";

/**
 * TODO:
 * 
 * 1.
 * Es gibt zwei Stellen im Code die mit HACK markiert sind, die nicht mehr funktionieren werden
 * sobald man eine TCP-Verbindung auf einem anderen als dem ersten Interface starten möchte.
 * 
 * Dazu fählt eine Routinglogik, die greift, bevor man das Paket routet, das fehlt hier leider noch
 * 
 */

export class IPStack extends Observable {

    /** @type {Array<NetworkInterface>} */
    interfaces = [];

    /** @type {Array<Route>} */
    routingTable = [];

    forwarding = false;

    /** @type {Map<Number,UDPSocket>} */
    udpSockets = new Map();

    /** @type {Map<number, TCPSocket>} */
    tcpSockets = new Map();

    /** @type {Map<String,TCPSocket>} */
    tcpConns = new Map();

    /** @type {Map<string,any>} */
    _pendingEcho = new Map();
    /** @type {number} */
    _nextIcmpId = (Math.random() * 0xffff) | 0;

    name = '';

    /**
     * 
     * @param {Number} numberOfInterfaces number of interfaces to autocreate
     * @param {String} name name of this IPForwarder
     */
    constructor(numberOfInterfaces, name) {
        super();
        for (let i = 0; i < numberOfInterfaces; i++) {
            const interf = new NetworkInterface({ name: 'eth' + i });
            this.interfaces.push(interf);
            interf.subscribe(this);
        }
        this.name = name;
        this._updateAutoRoutes();
    }

    /**
     * 
     * @param {IPv4Packet} packet 
     * @param {Boolean} internal if the packets source was internal
     */
    async route(packet, internal = false) {
        const dstip = IPUInt8ToNumber(packet.dst);

        //check if the destination is localnet.
        if ((dstip & 0xff000000) == 0x7f000000) { //127.x.x.x
            if (internal && IPUInt8ToNumber(packet.src) === 0) {
                packet.src = IPNumberToUint8(IPOctetsToNumber(127, 0, 0, 1));
            }
            this.accept(packet);
            return;
        }

        //check if we are the destination, then accept the packet in our queue
        for (let i = 0; i < this.interfaces.length; i++) {
            const myip = this.interfaces[i].ip;
            if (dstip == myip) {
                //set sourceaddress if packet was internal
                if (internal && IPUInt8ToNumber(packet.src) == 0) {
                    packet.src = IPNumberToUint8(IPOctetsToNumber(127, 0, 0, 1));
                }

                //accept the packet
                this.accept(packet);
                return;
            }
        }

        //find the correct route
        for (let bits = 32; bits >= 0; bits--) {
            const netmask = prefixToNetmask(bits);
            for (let i = 0; i < this.routingTable.length; i++) {
                const r = this.routingTable[i];

                if (((dstip & netmask) == r.dst) && netmask == r.netmask) {
                    //destination is a loopback interface (has id = "-1" and is not a real interface)
                    if (r.interf == -1) {
                        //set sourceaddress if packet was internal
                        if (internal && IPUInt8ToNumber(packet.src) == 0) {
                            packet.src = IPNumberToUint8(IPOctetsToNumber(127, 0, 0, 1));
                        }
                        //accept the packet
                        this.accept(packet);
                        return;
                    }

                    if (!internal) {
                        //Check if forwarding is enabled
                        if (!this.forwarding) {
                            console.warn("Packet forwarding is disabled on this host");
                            return;
                        }

                        //decrement TTL
                        packet.ttl = packet.ttl - 1;
                        if (packet.ttl <= 0) {
                            this._sendICMPError(packet, 11, 0);
                            return;
                        }
                    }

                    //add soruce address if the packet still does not have one
                    if (internal && IPUInt8ToNumber(packet.src) == 0) {
                        packet.src = IPNumberToUint8(this.interfaces[r.interf].ip);
                    }

                    let mac;
                    //can we reach the destiation directly?
                    if (r.nexthop == 0) {
                        mac = await this.interfaces[r.interf].resolveIP(dstip);
                    } else {
                        mac = await this.interfaces[r.interf].resolveIP(r.nexthop);
                    }

                    //ICMP: Host unreachable
                    if (mac == null) {
                        this._sendICMPError(packet, 3, 1);
                        return;
                    }

                    //forward the packet
                    this.interfaces[r.interf].sendFrame(mac, 0x0800, packet.pack());
                    return;
                }
            }
        }
        //Network is unreachable/unrouteable
        this._sendICMPError(packet, 3, 0);
    }


    /****************************************************** TCP **********************************/

    /**
     * opens a TCP Server Socket
     * @param {number} bindaddr 
     * @param {number} port
     * @return {number} reference to the created socket
     */
    openTCPServerSocket(bindaddr, port) {
        if (this.tcpSockets.get(port) != null) throw new Error("Port is in use");
        if (port <= 0 || port > 65535) throw new Error("Portnumber is not valid");
        if (bindaddr != 0) throw new Error("Currently only bindings to 0.0.0.0 are supported");

        const s = new TCPSocket();
        s.port = port;
        s.bindaddr = bindaddr;
        s.state = "LISTEN";

        this.tcpSockets.set(port, s);
        return port;
    }

    /**
     * Waits for an incoming TCP connection on a listening port (like accept()).
     * Resolves to a connected TCPSocket, or null if the listening socket was closed.
     * @param {number} ref numeric reference to the ServerSocket
     * @returns {Promise<string|null>} Promise, which resolves as soon as someone connects
     */

    acceptTCPConn(ref) {
        const listen = this.tcpSockets.get(ref);
        if (!listen) throw new Error("Port not in use!");
        if (listen.state !== "LISTEN") throw new Error("Socket is not LISTEN");

        if (listen.acceptQueue.length > 0) {
            const conn = listen.acceptQueue.shift() ?? null;
            return Promise.resolve(conn ? conn.key : null);
        }

        return new Promise((resolve) => {
            listen.acceptWaiters.push((conn) => resolve(conn ? conn.key : null));
        });
    }


    /**
     * closes a TCP Server Server socket
     * @param {number} ref numeric reference to the socket
     * @returns 
     */

    closeTCPServerSocket(ref) {
        const socket = this.tcpSockets.get(ref);
        if (!socket) return;

        if (socket.state === "LISTEN") {
            while (socket.acceptWaiters.length) {
                socket.acceptWaiters.shift()?.(null);
            }
            socket.acceptQueue.length = 0;
            this.tcpSockets.delete(ref);
            return;
        }

        throw new Error("Can only close LISTEN sockets");
    }


    /**
     * starts a TCP connection
     * @param {*} dstIP IP Adress
     * @param {*} dstPort Port
     * @returns 
     */

    async connectTCPConn(dstIP, dstPort) {
        const srcPort = this._allocEphemeralPort();

        const conn = new TCPSocket();
        conn.port = srcPort;
        conn.bindaddr = 0;
        conn.state = "SYN-SENT";
        conn.myacc = 1000 + Math.floor(Math.random() * 100000);
        conn.theiracc = 0;
        conn.peerIP = dstIP;
        conn.peerPort = dstPort;

        // TODO hack: choose outgoing IP properly
        const myIP = this.interfaces[0].ip;

        const key = this._tcpKey(myIP, srcPort, dstIP, dstPort);
        conn.key = key;

        this.tcpConns.set(key, conn);
        this.tcpSockets.set(srcPort, conn);

        // send initial SYN
        const sendSyn = () => {
            this._sendTCP({
                srcIP: myIP,
                dstIP,
                srcPort,
                dstPort,
                seq: conn.myacc,
                ack: 0,
                flags: TCPPacket.FLAG_SYN,
                payload: new Uint8Array()
            });
        };

        sendSyn();
        conn.myacc += 1;

        // retransmit SYN a few times
        let tries = 0;
        const maxTries = 3;          
        const rtoMs = 20*SimControl.tick;
        conn._synTimer = setInterval(() => {
            if (conn.state !== "SYN-SENT") return;
            tries++;
            if (tries >= maxTries) {
                // fail connect
                clearInterval(conn._synTimer);
                conn._synTimer = null;
                this._tcpDestroy(key, conn, "connect timeout (SYN-SENT)");
                return;
            }
            // resend SYN with same seq (RFC-ish)
            this._sendTCP({
                srcIP: myIP,
                dstIP,
                srcPort,
                dstPort,
                seq: conn.myacc - 1, // because we already incremented after first SYN
                ack: 0,
                flags: TCPPacket.FLAG_SYN,
                payload: new Uint8Array()
            });
        }, rtoMs);

        // wait until established OR timeout destroys it
        await new Promise((resolve, reject) => {
            conn.connectWaiters.push((err) => (err ? reject(err) : resolve()));
            // if something already happened (rare), resolve immediately
            if (conn.state === "ESTABLISHED") resolve();
            if (conn.state === "CLOSED") reject(new Error("connect failed"));
        });

        return conn;
    }


    /**
     * helper funkction for searching a key
     * @param {string} key 
     * @param {string} fnName 
     * @returns 
     */
    _searchTCPConn(key, fnName) {
        const conn = this.tcpConns.get(key);
        if (!conn) throw new Error(`${fnName}: Connection not found: ${key}`);
        return conn;
    }

    /**
    * Read from a TCP connection by key.
    * Resolves with payload, or null if closed.
    * @param {string} key key to the connection
    * @returns {Promise<Uint8Array|null>} promise resolves as soon as data comes in
    */

    recvTCPConn(key) {
        const conn = this._searchTCPConn(key, "recvTCPConn");

        if (conn.in.length > 0) return Promise.resolve(conn.in.shift() ?? null);
        return new Promise((resolve) => conn.waiters.push(resolve));
    }


    /**
     * Sends data on an established TCP connection.
     * @param {string} key key to the connection
     * @param {Uint8Array} data data to send
     */
    sendTCPConn(key, data) {
        const conn = this._searchTCPConn(key, "sendTCPSocket");
        if (conn.state !== "ESTABLISHED") throw new Error("Not established");

        //TODO: This is a hack
        const myIP = this.interfaces[0].ip;

        this._sendTCP({
            srcIP: myIP,
            dstIP: conn.peerIP,
            srcPort: conn.port,
            dstPort: conn.peerPort,
            seq: conn.myacc,
            ack: conn.theiracc,
            flags: TCPPacket.FLAG_ACK,
            payload: data
        });

        conn.myacc += data.length;
    }

    /**
     * Closes a TCP connection
     * @param {string} key key to the connectiom
     */

    closeTCPConn(key) {
        const conn = this.tcpConns.get(key);
        if (!conn) return;
        if (conn.state !== "ESTABLISHED") return;

        //TODO: Warning: This is a hack!
        const myIP = this.interfaces[0].ip;

        this._sendTCP({
            srcIP: myIP,
            dstIP: conn.peerIP,
            srcPort: conn.port,
            dstPort: conn.peerPort,
            seq: conn.myacc,
            ack: conn.theiracc,
            flags: TCPPacket.FLAG_FIN | TCPPacket.FLAG_ACK,
            payload: new Uint8Array()
        });

        conn.myacc += 1;
        conn.state = "FIN-WAIT-1";
        this._tcpStartAckWatchdog(conn.key, conn, "FIN-WAIT-1 stuck");

    }

    /**
     * Fully closes and removes a TCP connection and frees its port.
     * @param {string} key
     * @param {TCPSocket} conn
     * @param {string} reason
     */
    _tcpDestroy(key, conn, reason = "closed") {
        // stop timers
        if (conn._synTimer != null) { clearInterval(conn._synTimer); conn._synTimer = null; }
        if (conn._fin2Timer != null) { clearTimeout(conn._fin2Timer); conn._fin2Timer = null; }

        // wake readers
        while (conn.waiters.length) conn.waiters.shift()?.(null);

        // wake connect() waiters (if any)
        while (conn.connectWaiters.length) conn.connectWaiters.shift()?.(new Error(reason));

        if (conn._ackTimer != null) { clearTimeout(conn._ackTimer); conn._ackTimer = null; }

        conn.state = "CLOSED";

        // remove from conn map
        this.tcpConns.delete(key);

        // IMPORTANT: free the port entry if this socket is registered there
        const s = this.tcpSockets.get(conn.port);
        if (s === conn) this.tcpSockets.delete(conn.port);
    }

    /**
     * generates a key (srcIP-srcPort-dstIP-dstPort) for a connection pair
     *  @param {number} srcIP 
     *  @param {number} srcPort 
     *  @param {number} dstIP 
     *  @param {number} dstPort 
     * */
    _tcpKey(srcIP, srcPort, dstIP, dstPort) {
        return `${srcIP}:${srcPort}>${dstIP}:${dstPort}`;
    }

    /**
     * allocates a free high port number
     * @returns 
     */
    _allocEphemeralPort() {
        for (let p = 49152; p < 65535; p++) {
            if (!this.tcpSockets.has(p)) return p;
        }
        throw new Error("No free TCP ports");
    }

    /**
      * Very high ACK timeout; defaults safely if SimControl isn't present.
      * @returns {number}
      */
    _tcpAckTimeoutMs() {
        const tick =
            SimControl.tick ?? 10;

        return Math.max(1, (tick | 0) * 100);
    }

    /**
     * Start (or restart) an ACK watchdog for a conn; on timeout, destroy it.
     * @param {string} key
     * @param {TCPSocket} conn
     * @param {string} reason
    */

    _tcpStartAckWatchdog(key, conn, reason) {
        if (conn._ackTimer != null) clearTimeout(conn._ackTimer);

        const ms = this._tcpAckTimeoutMs();
        conn._ackTimer = setTimeout(() => {
            if (conn._ackTimer == null) return; // already cleared
            // Only kill if still waiting in an ACK-dependent state
            if (conn.state === "SYN-RECEIVED" || conn.state === "FIN-WAIT-1") {
                this._tcpDestroy(key, conn, `${reason} (ACK timeout ${ms}ms)`);
            }
        }, ms);
    }

    /** @param {TCPSocket} conn */
    _tcpStopAckWatchdog(conn) {
        if (conn._ackTimer != null) {
            clearTimeout(conn._ackTimer);
            conn._ackTimer = null;
        }
    }


    /** 
     * sends a packet via tcp * 
     * @param {Object} [opts] 
     * @param {number} [opts.srcIP]  
     * @param {number} [opts.dstIP] 
     * @param {number} [opts.srcPort] 
     * @param {number} [opts.dstPort] 
     * @param {number} [opts.seq] 
     * @param {number} [opts.ack]
     * @param {number} [opts.flags] 
     * @param {Uint8Array} [opts.payload] */

    _sendTCP(opts = {}) {

        const {
            srcIP,
            dstIP,
            srcPort,
            dstPort,
            seq,
            ack,
            flags,
            payload 
        } = opts;
        const tcpBytes = new TCPPacket({ 
            srcPort, 
            dstPort, 
            seq, 
            ack, 
            flags, 
            payload }
        ).pack();

        this.send({
            dst: dstIP,
            src: srcIP,
            protocol: 6,
            payload: tcpBytes
        });
    }


    /**
     * handles an incoming TCP packet
     * @param {IPv4Packet} packet
     */
    _handleTCP(packet) {
        const tcp = TCPPacket.fromBytes(packet.payload);

        const syn = tcp.hasFlag(TCPPacket.FLAG_SYN);
        const ack = tcp.hasFlag(TCPPacket.FLAG_ACK);
        const fin = tcp.hasFlag(TCPPacket.FLAG_FIN);
        const rst = tcp.hasFlag(TCPPacket.FLAG_RST);

        const ipSrc = IPUInt8ToNumber(packet.src);
        const ipDst = IPUInt8ToNumber(packet.dst);

        // Our local endpoint is dst of packet; remote endpoint is src of packet.
        const localIP = ipDst;
        const localPort = tcp.dstPort;
        const remoteIP = ipSrc;
        const remotePort = tcp.srcPort;

        const key = this._tcpKey(localIP, localPort, remoteIP, remotePort);

        /** @type {TCPSocket | undefined} */
        let conn = this.tcpConns.get(key);

        // -------------------------------------------------------------------------
        // 0) No existing connection -> possibly a new inbound connection to LISTEN
        // -------------------------------------------------------------------------
        if (!conn) {
            // Only SYN (without ACK) can create a new server-side connection.
            if (!(syn && !ack)) return;

            const listen = this.tcpSockets.get(localPort);
            if (!listen || listen.state !== "LISTEN") return;

            conn = new TCPSocket();
            conn.port = localPort;
            conn.bindaddr = listen.bindaddr;
            conn.state = "SYN-RECEIVED";
            conn.peerIP = remoteIP;
            conn.peerPort = remotePort;
            conn.theiracc = tcp.seq + 1;
            conn.myacc = 1000; // TODO randomize
            conn.key = key;

            this.tcpConns.set(key, conn);

            // Send SYN+ACK
            this._sendTCP({
                srcIP: localIP,
                dstIP: remoteIP,
                srcPort: localPort,
                dstPort: remotePort,
                seq: conn.myacc,
                ack: conn.theiracc,
                flags: TCPPacket.FLAG_SYN | TCPPacket.FLAG_ACK,
                payload: new Uint8Array(),
            });
            conn.myacc += 1;

            // Wait for the final ACK (high timeout)
            this._tcpStartAckWatchdog(key, conn, "SYN-RECEIVED stuck");
            return;
        }

        // -------------------------------------------------------------------------
        // 1) RST: immediate teardown
        // -------------------------------------------------------------------------
        if (rst) {
            this._tcpDestroy(key, conn, "RST");
            return;
        }

        // Helper: send pure ACK reflecting what we consumed/expect.
        const sendAck = () => {
            this._sendTCP({
                srcIP: localIP,
                dstIP: remoteIP,
                srcPort: localPort,
                dstPort: remotePort,
                seq: conn.myacc,
                ack: conn.theiracc,
                flags: TCPPacket.FLAG_ACK,
                payload: new Uint8Array(),
            });
        };

        // Helper: FIN ACK + close (used for FIN-WAIT-1/2)
        const ackFinAndClose = () => {
            sendAck();
            this._tcpDestroy(key, conn, "peer FIN");
        };

        // -------------------------------------------------------------------------
        // 2) Client handshake: SYN-SENT -> ESTABLISHED on SYN+ACK
        // -------------------------------------------------------------------------
        if (conn.state === "SYN-SENT") {
            // Expect SYN+ACK that acknowledges our SYN (ack == conn.myacc)
            if (syn && ack && tcp.ack === conn.myacc) {
                conn.theiracc = tcp.seq + 1;
                conn.state = "ESTABLISHED";

                // stop SYN retransmit timer
                if (conn._synTimer != null) { clearInterval(conn._synTimer); conn._synTimer = null; }

                // resolve connect() awaiters
                while (conn.connectWaiters.length) conn.connectWaiters.shift()?.(null);

                // send final ACK
                sendAck();
            }
            return;
        }

        // -------------------------------------------------------------------------
        // 3) Server handshake: SYN-RECEIVED -> ESTABLISHED on final ACK
        // -------------------------------------------------------------------------
        if (conn.state === "SYN-RECEIVED") {
            if (ack && tcp.ack === conn.myacc) {
                conn.state = "ESTABLISHED";
                this._tcpStopAckWatchdog(conn);

                // publish to accept()
                const listen = this.tcpSockets.get(conn.port);
                if (listen && listen.state === "LISTEN") {
                    const aw = listen.acceptWaiters.shift();
                    if (aw) aw(conn);
                    else listen.acceptQueue.push(conn);
                }
            }
            return;
        }

        // -------------------------------------------------------------------------
        // 4) Closing states (active close side)
        // -------------------------------------------------------------------------

        // FIN received anytime in FIN-WAIT-1 or FIN-WAIT-2: ACK + close
        if (fin && (conn.state === "FIN-WAIT-1" || conn.state === "FIN-WAIT-2")) {
            if (tcp.seq === conn.theiracc) conn.theiracc += 1;
            ackFinAndClose();
            return;
        }

        // FIN-WAIT-1 -> FIN-WAIT-2 when our FIN is ACKed
        if (conn.state === "FIN-WAIT-1") {
            if (ack && tcp.ack === conn.myacc) {
                conn.state = "FIN-WAIT-2";
                this._tcpStopAckWatchdog(conn);

                // FIN-WAIT-2 timeout cleanup (avoid stuck sockets)
                if (conn._fin2Timer != null) clearTimeout(conn._fin2Timer);
                conn._fin2Timer = setTimeout(() => {
                    if (conn.state === "FIN-WAIT-2") {
                        this._tcpDestroy(key, conn, "FIN-WAIT-2 timeout");
                    }
                }, 10 * SimControl.tick);
            }
            // While we are closing, we ignore data path here.
            return;
        }

        // If we're in FIN-WAIT-2 and get only ACK/data etc, we ignore (until FIN arrives or timeout fires)
        if (conn.state === "FIN-WAIT-2") {
            // Could optionally ACK in-order data here, but simplest is to ignore.
            return;
        }

        // -------------------------------------------------------------------------
        // 5) Established data path
        // -------------------------------------------------------------------------
        if (conn.state !== "ESTABLISHED") return;

        // FIN received in ESTABLISHED (passive close) — currently you don't implement CLOSE-WAIT/LAST-ACK.
        // For now: ACK + close (simple, a bit unrealistic but consistent with your minimal stack).
        if (fin) {
            if (tcp.seq === conn.theiracc) conn.theiracc += 1;
            sendAck();
            this._tcpDestroy(key, conn, "peer FIN (ESTABLISHED)");
            return;
        }

        const payload = tcp.payload ?? new Uint8Array();

        // Out-of-order -> ACK what we expect
        if (tcp.seq !== conn.theiracc) {
            sendAck();
            return;
        }

        // Pure ACK-only segment -> ignore
        if (payload.length === 0 && !syn && !fin && !rst) {
            return;
        }

        // Consume payload
        if (payload.length > 0) {
            conn.theiracc += payload.length;

            const resolve = conn.waiters.shift();
            if (resolve) resolve(payload);
            else conn.in.push(payload);
        }

        // ACK consumed bytes
        sendAck();
    }

    /****************************************************** UDP **********************************/
    /**
     * opens an UDP Socket
     * @param {Number} bindaddr
     * @param {Number} port 
     */
    openUDPSocket(bindaddr, port) {
        if (this.udpSockets.get(port) != null) {
            throw new Error("Port is in use");
        }
        if (port <= 0 || port > 65535) {
            throw new Error("Portnumber is not valid");
        }

        if (bindaddr != 0) {
            throw new Error("Currently only bindings to 0.0.0.0 are supported");
        }

        const socket = new UDPSocket;
        socket.port = port;
        this.udpSockets.set(port, socket);

        return port;
    }

    /**
    * sends Data via an UDP Socket
    * @param {Number} port
    * @param {Number} dstip 
    * @param {Number} dstport 
    * @param {Uint8Array} data
    * @returns 
    */
    sendUDPSocket(port, dstip, dstport, data) {
        let socket = this.udpSockets.get(port);
        if (socket == null) {
            throw new Error("Port not in use!");
        }

        this.send({
            dst: dstip,
            src: socket.bindaddr,
            protocol: 17,
            payload: new UDPPacket({
                srcPort: socket.port,
                dstPort: dstport,
                payload: data
            }).pack()
        });
    }

    /**
     * tries to read Data from a UDP Socket
     * @param {Number} port
     */
    recvUDPSocket(port) {
        let socket = this.udpSockets.get(port);
        if (socket == null) {
            throw new Error("Port not in use!");
        }
        if (socket.in.length > 0) return Promise.resolve(socket.in.shift());
        return new Promise((resolve) => {
            socket.waiters.push(resolve);
        });
    }

    /**
     * closes a UDP Socket
     * @param {Number} port
     */
    closeUDPSocket(port) {
        let socket = this.udpSockets.get(port);
        if (socket == null) {
            return;
        }

        //closing the socket, stop waiters
        while (socket.waiters.length > 0) {
            const resolve = socket.waiters.shift();
            if (resolve != null) {
                resolve(null);
            }
        }
        this.udpSockets.delete(port);
    }

    /**
     * handels an incoming UDP packet
     * @param {IPv4Packet} packet 
     */

    _handleUDP(packet) {
        const datagram = UDPPacket.fromBytes(packet.payload);
        const socket = this.udpSockets.get(datagram.dstPort);

        if (socket == null) {
            return;
        }

        const msg = {
            src: IPUInt8ToNumber(packet.src),
            dst: IPUInt8ToNumber(packet.dst),
            srcPort: datagram.srcPort,
            dstPort: datagram.dstPort,
            payload: datagram.payload
        };

        const resolve = socket.waiters.shift();
        if (resolve != null) {
            resolve(msg);
        } else {
            socket.in.push(msg);
        }
    }

    /****************************************************** ICMP ************************************/

    /**
     * @param {number} dstIpNum
     * @param {{timeoutMs?: number, payload?: Uint8Array, identifier?: number, sequence?: number}} [opt]
     * @returns {Promise<{bytes:number, ttl:number, timeMs:number, identifier:number, sequence:number}>}
     */
    async icmpEcho(dstIpNum, opt = {}) {
        const timeoutMs = opt.timeoutMs ?? 20 * SimControl.tick;
        const identifier = opt.identifier ?? (this._nextIcmpId = (this._nextIcmpId + 1) & 0xffff);
        const sequence = opt.sequence ?? (Math.random() * 0xffff) | 0;
        const payload = opt.payload ?? new Uint8Array(32); // beliebig

        const key = this._icmpEchoKey(dstIpNum, identifier, sequence);
        const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingEcho.delete(key);
                reject(new Error("timeout"));
            }, timeoutMs);

            this._pendingEcho.set(key, { resolve, reject, timer, t0 });

            const icmp = new ICMPPacket({
                type: 8,
                code: 0,
                identifier,
                sequence,
                payload,
            }).pack();

            this.send({
                dst: dstIpNum,
                // src: musst du ggf. je nach Interface/Routing setzen – ich nehme hier mal “deine lokale IP”
                // Wenn du das schon automatisch machst, weglassen oder korrekt bestimmen:
                // src: this._getLocalSrcFor(dstIpNum),
                protocol: 1,
                payload: icmp,
            });
        }).then((r) => {
            const t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
            return { ...r, timeMs: Math.max(0, Math.round(t1 - t0)) };
        });
    }

    /**
     * @param {number} dst
     * @param {number} id
     * @param {number} seq
     */
    _icmpEchoKey(dst, id, seq) {
        console.log(`${dst}|${id}|${seq}`);
        return `${dst}|${id}|${seq}`;
    }
    /**
     * 
     * @param {IPv4Packet} original 
     * @param {number} type 
     * @param {number} code 
     * @returns 
     */
    _sendICMPError(original, type, code) {
        const src = IPUInt8ToNumber(original.src);
        const dst = IPUInt8ToNumber(original.dst);

        //Do not reply to 0.0.0.0
        if (src == 0) {
            return;
        }

        //Do not generate Errors if the original is an ICMP packet
        if (original.protocol == 1) {
            return;
        }

        //ICMP takes the fist 8 Bytes from the packet in the response part
        const quotedLen = Math.min(original.payload.length, 8);
        const quoted = new Uint8Array(original.pack().slice(0, original.ihl * 4 + quotedLen));

        const icmpPayload = quoted;
        const icmp = new ICMPPacket({ type, code, payload: icmpPayload }).pack();

        this.send({
            dst: src,
            src: dst,
            protocol: 1,
            payload: icmp
        });
    }

    /**
     * 
     * @param {IPv4Packet} packet 
     */
    _handleICMP(packet) {
        const icmp = ICMPPacket.fromBytes(packet.payload);
        console.debug("ICMP IN", {
            ip_src: IPUInt8ToNumber(packet.src),
            ip_dst: IPUInt8ToNumber(packet.dst),
            ttl: packet.ttl,
            len: packet.payload?.length,
            icmp_type: icmp.type,
            icmp_code: icmp.code,
            id: icmp.identifier,
            seq: icmp.sequence
        });

        switch (icmp.type) {
            case 0:  // Echo reply
                const remote = IPUInt8ToNumber(packet.src); // Reply kommt "von" remote
                const id = icmp.identifier ?? 0;
                const seq = icmp.sequence ?? 0;

                const key = this._icmpEchoKey(remote, id, seq);
                const pending = this._pendingEcho.get(key);

                if (!pending) {
                    // Debug: Reply ohne wartenden Request (Key-Mismatch oder zu spät)
                    console.warn("ICMP echo reply without pending request", { key, remote, id, seq });
                    break;
                }

                clearTimeout(pending.timer);
                this._pendingEcho.delete(key);

                pending.resolve({
                    bytes: packet.payload?.length ?? 0, // oder 64, wie du es darstellen willst
                    ttl: packet.ttl ?? 64,
                    identifier: id,
                    sequence: seq,
                    timeMs: 0, // wird in icmpEcho().then(...) überschrieben
                });
                break;
            case 3: //Destination unreachable

                break;
            case 8: //Echo request
                if (icmp.code != 0) {
                    throw new Error("ICMP-Code not understood");
                }
                this.send({
                    dst: IPUInt8ToNumber(packet.src),
                    src: IPUInt8ToNumber(packet.dst),
                    protocol: 1,
                    payload: new ICMPPacket({
                        type: 0,
                        code: 0,
                        identifier: icmp.identifier,
                        payload: icmp.payload,
                        sequence: icmp.sequence
                    }).pack()
                });
                break;
            case 11: //TTL excceded
                break;
            default:
                throw new Error("ICMP-Type not understood");
        }
    }

    /****************************************************** COMMON **********************************/

    /**
     * accepts a packet and treat it to the specific queue
     * @param {IPv4Packet} packet 
     */
    accept(packet) {
        console.debug(this.name + ": Accepted packet");
        console.debug(packet);

        switch (packet.protocol) {
            case 1: //ICMP
                this._handleICMP(packet);
                break;
            case 6: //TCP
                this._handleTCP(packet);
                break;
            case 17: //UDP
                this._handleUDP(packet);
                break;

            default:
                console.warn(this.name + ": Unknown protocoll number " + packet.protocol);
        }
    }

    /**
     * creats and sends a packet which was generated internaly
     * @param {Object} [opts]
     * @param {Number} [opts.dst] dst
     * @param {Number} [opts.src] src
     * @param {Number} [opts.protocol] protocol
     * @param {Number} [opts.ttl] ttl
     * @param {Uint8Array} [opts.payload] payload
     */

    async send(opts = {}) {
        const dst = (opts.dst ?? 0);
        const src = (opts.src ?? 0);
        const protocol = (opts.protocol ?? 0);
        const ttl = (opts.ttl ?? 64);
        const payload = (opts.payload ?? new Uint8Array());


        const packet = new IPv4Packet({
            dst: IPNumberToUint8(dst),
            src: IPNumberToUint8(src),
            protocol: protocol,
            payload: payload,
            ttl: ttl
        });

        console.debug("IP OUT", { dst, src, protocol, ttl: packet.ttl, payloadLen: payload.length });

        this.route(packet, true).catch(console.error);
    }

    /**
     * 
     * @param {Number} [i]
     * @param {Object} [opts]
     * @param {Number} [opts.ip] ip
     * @param {Number} [opts.netmask] netmask
     * @param {String} [opts.name] name of the interface
     */
    configureInterface(i = 0, opts = {}) {
        if (this.interfaces[i] == null) {
            return;
        }
        const ip = (opts.ip ?? IPOctetsToNumber(192, 168, 0, 10));
        const netmask = (opts.netmask ?? IPOctetsToNumber(255, 255, 255, 0));

        //TODO: assertIP and netmask!

        this.interfaces[i].configure(opts);
        this._updateAutoRoutes();
    }

    update() {
        for (let i = 0; i < this.interfaces.length; i++) {
            let packet = this.interfaces[i].getNextPacket();

            if (packet == null) {
                continue;
            }
            this.route(packet, false);
        }
    }

    /**
     * 
     * @param {Number} dst 
     * @param {Number} netmask 
     * @param {Number} interf 
     * @param {Number} nexthop 
     */

    addRoute(dst, netmask, interf, nexthop) {
        const r = new Route();
        //TODO: assert if valid

        r.dst = dst;
        r.netmask = netmask;
        r.interf = interf;
        r.nexthop = nexthop;
        r.auto = false;

        this.routingTable.push(r);
    }

    _updateAutoRoutes() {
        this.routingTable = this.routingTable.filter(r => !r.auto);

        for (let i = 0; i < this.interfaces.length; i++) {
            //Add the known routes
            const r = new Route();
            const ip = this.interfaces[i].ip;
            const netmask = this.interfaces[i].netmask;

            r.dst = ip & netmask; //network address
            r.netmask = netmask;
            r.interf = i;
            r.nexthop = 0;
            r.auto = true;
            this.routingTable.push(r);
        }

        const r = new Route();
        r.dst = IPOctetsToNumber(127, 0, 0, 0);
        r.netmask = IPOctetsToNumber(255, 0, 0, 0);
        r.interf = -1;
        r.nexthop = 0;
        r.auto = true;
        this.routingTable.push(r);
    }

    /**
     * 
     * @param {Number} i 
     * @returns 
     */
    getInterface(i) {
        return this.interfaces[i];
    }

    /**
     * 
     * @returns {EthernetPort|Null}
     */

    getNextFreeInterfacePort() {
        for (let i = 0; i < this.interfaces.length; i++) {
            const port = this.interfaces[i].port;
            if (port.linkref == null) {
                return port;
            }
        }
        return null;
    }



}



export class Route {
    /** @type {Number} */
    dst = 0;
    netmask = 0;
    nexthop = 0;
    interf = 0;
    auto = true;
}

export class UDPSocket {
    port = 0;
    bindaddr = 0;

    /**
     *  @type {Array<{
     *   src: number,
     *   dst: number,
     *   srcPort: number,
     *   dstPort: number,
     *   payload: Uint8Array
     * }>} 
     */
    in = [];

    /** 
     * @type {Array<(value: {
     *   src: number,
     *   dst: number,
     *   srcPort: number,
     *   dstPort: number,
     *   payload: Uint8Array
     * } | null) => void>} 
     */

    waiters = [];
}

export class TCPSocket {
    port = 0;
    bindaddr = 0;
    key = '';

    peerIP = 0;
    peerPort = 0;

    /** @type {"LISTEN"|"SYN-RECEIVED"|"ESTABLISHED"|"CLOSED"|"SYN-SENT"|"FIN-WAIT-1"|"FIN-WAIT-2"|"LAST-ACK"|"CLOSE-WAIT"} */
    state = "CLOSED";

    myacc = 0;     // our next seq to send
    theiracc = 0;  // next seq we expect from peer

    /** @type {Array<Uint8Array>} */
    in = [];

    /** @type {Array<(value: Uint8Array|null) => void>} */
    waiters = [];

    /** @type {Array<TCPSocket>} */
    acceptQueue = [];

    /** @type {Array<(value: TCPSocket|null) => void>} */
    acceptWaiters = [];

    /** @type {any} */
    _ackTimer = null;

    /** @type {any} */
    _synTimer = null;

    /** @type {any} */
    _fin2Timer = null;

    /** @type {Array<(err: Error|null) => void>} */
    connectWaiters = [];

}