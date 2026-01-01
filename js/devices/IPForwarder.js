//@ts-check

import { IPNumberToUint8, IPOctetsToNumber, IPUInt8ToNumber, prefixToNetmask } from "../helpers.js";
import { IPv4Packet } from "../pdu/IPv4Packet.js";
import { NetworkInterface } from "./NetworkInterface.js";
import { Observable } from "../common/Observeable.js";
import { ICMPPacket } from "../pdu/ICMPPacket.js";
import { EthernetPort } from "./EthernetPort.js";
import { UDPPacket } from "../pdu/UDPPacket.js";
import { TCPPacket } from "../pdu/TCPPacket.js";

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
}

export class IPForwarder extends Observable {

    /** @type {Array<NetworkInterface>} */
    interfaces = [];

    /** @type {Array<IPv4Packet>} */
    hostQueue = [];

    /** @type {Array<Route>} */
    routingTable = [];

    forwarding = false;

    /** @type {Map<Number,UDPSocket>} */
    udpSockets = new Map();

    /** @type {Map<number, TCPSocket>} */
    tcpSockets = new Map();

    /** @type {Map<String,TCPSocket>} */
    tcpConns = new Map();

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

        //We are routing the packet, so we need to decrement the TTL by one.
        packet.ttl = packet.ttl - 1;
        if (packet.ttl == 0) {
            console.warn(this.name + ": TTL is zero and ICMP is not implemented yet");
            return;
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
                        this.hostQueue.push(packet);
                        this.accept(packet);
                        return;
                    }

                    //Do not forward packets, if forwarding is disabled
                    if (!internal && !this.forwarding) {
                        console.warn(this.name + ": Packet was not forwarded, forwarding was disabled");
                        return;
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

                    if (mac == null) {
                        console.warn(this.name + ": Host not reachable and ICMP not implemented yet");
                        return;
                    }

                    //forward the packet
                    this.interfaces[r.interf].sendFrame(mac, 0x0800, packet.pack());
                    return;
                }
            }
        }
        console.warn(this.name + ": Host not reachable and ICMP not implemented yet");
    }


    /****************************************************** TCP **********************************/

    /**
     * opens a TCP Socket
     * @param {Number} bindaddr 
     * @param {Number} port
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
    * @param {number} port
    * @returns {Promise<TCPSocket|null>}
     */

    acceptTCPSocket(port) {
        const listen = this.tcpSockets.get(port);
        if (!listen) throw new Error("Port not in use!");
        if (listen.state !== "LISTEN") throw new Error("Socket is not LISTEN");

        if (listen.acceptQueue.length > 0) {
            return Promise.resolve(listen.acceptQueue.shift() ?? null);
        }

        return new Promise((resolve) => {
            listen.acceptWaiters.push(resolve);
        });
    }

    /**
     * closes a TCP Server socket
     * @param {Number} port 
     * @returns 
     */

    closeTCPServerSocket(port) {
        const socket = this.tcpSockets.get(port);
        if (!socket) return;

        if (socket.state === "LISTEN") {
            while (socket.acceptWaiters.length) {
                socket.acceptWaiters.shift()?.(null);
            }
            socket.acceptQueue.length = 0;
            this.tcpSockets.delete(port);
            return;
        }

        throw new Error("Can only close LISTEN sockets");
    }

    /**
     * Close a TCP connection
     * @param {TCPSocket} socket
     */

    closeTCPSocket(socket) {
        if (!socket) return;
        if (socket.state !== "ESTABLISHED") return;

        const myIP = this.interfaces[0].ip; // oder conn.localIP speichern

        this._sendTCP({
            srcIP: myIP,
            dstIP: socket.peerIP,
            srcPort: socket.port,
            dstPort: socket.peerPort,
            seq: socket.myacc,
            ack: socket.theiracc,
            flags: TCPPacket.FLAG_FIN | TCPPacket.FLAG_ACK,
            payload: new Uint8Array()
        });
        socket.myacc += 1;
        socket.state = "FIN-WAIT-1";

    }

    /**
     * 
     * @param {*} dstIP 
     * @param {*} dstPort 
     * @returns 
     */

    async connectTCPSocket(dstIP, dstPort) {
        const srcPort = this._allocEphemeralPort();

        const conn = new TCPSocket();
        conn.port = srcPort;
        conn.bindaddr = 0;
        conn.state = "SYN-SENT";
        conn.myacc = 1000 + Math.floor(Math.random() * 100000);
        conn.theiracc = 0;
        conn.peerIP = dstIP;
        conn.peerPort = dstPort;

        //TODO: WARNING! This is a hack!
        const myIP = this.interfaces[0].ip;
        const key = this._tcpKey(myIP, srcPort, dstIP, dstPort);
        conn.key = key;
        this.tcpConns.set(key, conn);

        // Client-seitige Socket-Registrierung
        this.tcpSockets.set(srcPort, conn);

        //sent a syn
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

        conn.myacc += 1;

        await (/** @type {Promise<void>} */(new Promise((resolve, reject) => {
            const check = () => {
                if (conn.state === "ESTABLISHED") resolve();
                else setTimeout(check, 0);
            };
            check();
        })));

        return conn;
    }

    /**
    * Read from a TCP connection by key.
    * Resolves with payload, or null if closed.
    * @param {TCPSocket} socket
    * @returns {Promise<Uint8Array|null>}
    */

    recvTCPConn(socket) {
        if (!socket) {
            throw new Error("Connection not found!");
        }
        if (socket.in.length > 0) {
            return Promise.resolve(socket.in.shift() ?? null);
        }
        return new Promise((resolve) => socket.waiters.push(resolve));
    }


    /**
     * Send data on an established TCP connection.
     * @param {TCPSocket} socket
     * @param {Uint8Array} data
     */
    sendTCPSocket(socket, data) {
        if (!socket) throw new Error("Connection not found!");
        if (socket.state !== "ESTABLISHED") throw new Error("Not established");

        this._sendTCP({
            srcIP: 0,
            dstIP: socket.peerIP,
            srcPort: socket.port,
            dstPort: socket.peerPort,
            seq: socket.myacc,
            ack: socket.theiracc,
            flags: TCPPacket.FLAG_ACK,
            payload: data
        });

        socket.myacc += data.length;
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
     * handels an incoming TCP packet
     * @param {IPv4Packet} packet 
     * @returns 
     */
    _handleTCP(packet) {
        const tcp = TCPPacket.fromBytes(packet.payload);
        const syn = tcp.hasFlag(TCPPacket.FLAG_SYN);
        const ack = tcp.hasFlag(TCPPacket.FLAG_ACK);
        const fin = tcp.hasFlag(TCPPacket.FLAG_FIN);
        const rst = tcp.hasFlag(TCPPacket.FLAG_RST);

        const ipSrc = IPUInt8ToNumber(packet.src);
        const ipDst = IPUInt8ToNumber(packet.dst);

        const localIP = ipDst;
        const localPort = tcp.dstPort;
        const remoteIP = ipSrc;
        const remotePort = tcp.srcPort;
        const key = this._tcpKey(localIP, localPort, remoteIP, remotePort);

        let conn = this.tcpConns.get(key);

        if (!conn) {
            //LISTEN -> SYN-RECEIVED (we are getting SYN and sending ACK)
            if (syn && !ack) {
                const listen = this.tcpSockets.get(tcp.dstPort);
                if (!listen || listen.state !== "LISTEN") return;

                conn = new TCPSocket();
                conn.port = tcp.dstPort;
                conn.bindaddr = listen.bindaddr;
                conn.state = "SYN-RECEIVED";
                conn.theiracc = tcp.seq + 1;
                conn.myacc = 1000; // TODO randomize
                conn.peerIP = ipSrc;
                conn.peerPort = tcp.srcPort;
                conn.key = key;

                this.tcpConns.set(key, conn);

                this._sendTCP({
                    srcIP: ipDst, dstIP: ipSrc,
                    srcPort: tcp.dstPort, dstPort: tcp.srcPort,
                    seq: conn.myacc,
                    ack: conn.theiracc,
                    flags: TCPPacket.FLAG_SYN | TCPPacket.FLAG_ACK,
                    payload: new Uint8Array()
                });

                conn.myacc += 1;
            }
            return;
        }

        // --- RST handling ---
        if (rst) {
            //cowardly closes the port
            while (conn.waiters.length) conn.waiters.shift()?.(null);
            conn.state = "CLOSED";
            this.tcpConns.delete(key);
            return;
        }

        // --- FIN handling ---
        if (fin) {
            if (tcp.seq === conn.theiracc) conn.theiracc += 1;

            if (conn.state === "FIN-WAIT-1" || conn.state === "FIN-WAIT-2") {
                this._sendTCP({
                    srcIP: ipDst,
                    dstIP: ipSrc,
                    srcPort: tcp.dstPort,
                    dstPort: tcp.srcPort,
                    seq: conn.myacc,           // seq bleibt, kein Verbrauch
                    ack: conn.theiracc,
                    flags: TCPPacket.FLAG_ACK,
                    payload: new Uint8Array()
                });

                while (conn.waiters.length) conn.waiters.shift()?.(null);
                conn.state = "CLOSED";
                this.tcpConns.delete(key);
                return;
            }
        }

        if (conn.state === "SYN-RECEIVED") {
            if (ack && tcp.ack === conn.myacc) {
                conn.state = "ESTABLISHED";
                conn.peerIP = ipSrc;
                conn.peerPort = tcp.srcPort;

                const listen = this.tcpSockets.get(conn.port);
                if (listen && listen.state === "LISTEN") {
                    const aw = listen.acceptWaiters.shift();
                    if (aw) {
                        aw(conn);
                    } else {
                        listen.acceptQueue.push(conn);
                    }
                }
            }
            return;
        }

        // --- Client side: SYN+ACK received ---
        if (conn && conn.state === "SYN-SENT") {
            if (syn && ack && tcp.ack === conn.myacc) {
                conn.theiracc = tcp.seq + 1;
                conn.state = "ESTABLISHED";

                //send ACK
                this._sendTCP({
                    srcIP: ipDst,
                    dstIP: ipSrc,
                    srcPort: tcp.dstPort,
                    dstPort: tcp.srcPort,
                    seq: conn.myacc,
                    ack: conn.theiracc,
                    flags: TCPPacket.FLAG_ACK,
                    payload: new Uint8Array()
                });
            }
            return;
        }

        if (conn.state === "FIN-WAIT-1") {
            if (ack && tcp.ack === conn.myacc) {
                conn.state = "FIN-WAIT-2";
            }
        }

        if (conn.state !== "ESTABLISHED") return;

        const payload = tcp.payload ?? new Uint8Array();

        // In-order check
        if (tcp.seq !== conn.theiracc) {
            // Out-of-order -> ACK what we expect (okay)
            this._sendTCP({
                srcIP: ipDst, dstIP: ipSrc,
                srcPort: tcp.dstPort, dstPort: tcp.srcPort,
                seq: conn.myacc,
                ack: conn.theiracc,
                flags: TCPPacket.FLAG_ACK,
                payload: new Uint8Array()
            });
            return;
        }

        // ACK-only segment? -> do not ACK back
        if (payload.length === 0 && !syn && !fin && !rst) {
            return;
        }

        // Consume payload (if any)
        if (payload.length > 0) {
            conn.theiracc += payload.length;

            const resolve = conn.waiters.shift();
            if (resolve) resolve(payload);
            else conn.in.push(payload);
        }

        // ACK, what we have comsumed
        this._sendTCP({
            srcIP: ipDst, dstIP: ipSrc,
            srcPort: tcp.dstPort, dstPort: tcp.srcPort,
            seq: conn.myacc,
            ack: conn.theiracc,
            flags: TCPPacket.FLAG_ACK,
            payload: new Uint8Array()
        });
    }

    /**
     * sends a packet via tcp
     *
     * @param {Object} [opts]                    
     * @param {number} [opts.srcIP]              
     * @param {number} [opts.dstIP]              
     * @param {number} [opts.srcPort]            
     * @param {number} [opts.dstPort]            
     * @param {number} [opts.seq]                
     * @param {number} [opts.ack]                
     * @param {number} [opts.flags]              
     * @param {Uint8Array} [opts.payload] 
     */
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
            payload
        }).pack();

        this.send({
            dst: dstIP,
            src: srcIP,
            protocol: 6, // TCP
            payload: tcpBytes
        });
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



    /****************************************************** COMMON **********************************/

    /**
     * accepts a packet and treat it to the specific queue
     * @param {IPv4Packet} packet 
     */
    accept(packet) {
        /*console.log(this.name + ": Accepted packet");
        console.log(packet);*/

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
        const ttl = (opts.ttl ?? 65);
        const payload = (opts.payload ?? new Uint8Array());


        const packet = new IPv4Packet({
            dst: IPNumberToUint8(dst),
            src: IPNumberToUint8(src),
            protocol: protocol,
            payload: payload,
            ttl: ttl
        });

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

    /**
     * 
     * @param {IPv4Packet} packet 
     */
    _handleICMP(packet) {
        const icmp = ICMPPacket.fromBytes(packet.payload);

        switch (icmp.type) {
            case 0: //Echo reply

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