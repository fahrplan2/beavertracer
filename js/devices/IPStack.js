//@ts-check

import { IPNumberToUint8, IPOctetsToNumber, IPUInt8ToNumber, prefixToNetmask } from "../helpers.js";
import { IPv4Packet } from "../pdu/IPv4Packet.js";
import { NetworkInterface } from "./NetworkInterface.js";
import { Observable } from "../common/Observeable.js";
import { ICMPPacket } from "../pdu/ICMPPacket.js";
import { EthernetPort } from "./EthernetPort.js";
import { SimControl } from "../SimControl.js";

import { TcpEngine } from "./TcpEngine.js";
import { UdpEngine } from "./UdpEngine.js";



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

        this.tcp = new TcpEngine({
            ipSend: (opts) => { this.send(opts); },
            resolveSrcIp: (dstIp) => {
                const out = this._resolveOutgoing(dstIp);
                if (!out || out.interfIndex === -1) return 0;
                return out.srcIp >>> 0;
            },
        });

        this.udp = new UdpEngine({
            ipSend: (opts) => { this.send(opts); },
            sendIcmpError: (original, type, code) => { this._sendICMPError(original, type, code); },
        });
    }

    /**
     * Count leading 1 bits in a netmask.
     * @param {number} netmask
     * @returns {number}
     */
    _netmaskToPrefix(netmask) {
        let m = (netmask >>> 0);
        let bits = 0;
        while (bits < 32 && (m & 0x80000000) !== 0) {
            bits++;
            m = (m << 1) >>> 0;
        }
        return bits;
    }

    _isLimitedBroadcast(ip) {
        return (ip >>> 0) === 0xffffffff;
    }

    /**
     * Pick a sane source IP for locally generated traffic.
     * @param {number} dstIpNum
     * @returns {number} src ip (0 if none)
     */
    _pickSrcIp(dstIpNum) {
        const dst = dstIpNum >>> 0;

        // Loopback destination -> loopback src
        if ((dst & 0xff000000) === 0x7f000000) {
            return IPOctetsToNumber(127, 0, 0, 1) >>> 0;
        }

        // If destination is one of our interface addresses, use that
        for (const itf of this.interfaces) {
            if ((itf.ip >>> 0) === dst && (itf.ip >>> 0) !== 0) {
                return itf.ip >>> 0;
            }
        }

        // Otherwise choose src based on routing (longest prefix match)
        const out = this._resolveOutgoing(dst);
        if (out && (out.srcIp >>> 0) !== 0) return out.srcIp >>> 0;

        return 0;
    }

    /**
     * @param {number} ip
     */
    _isLoopback(ip) {
        return ((ip >>> 0) & 0xff000000) === 0x7f000000;
    }

    /**
     * @param {number} ip
     * @param {number} ifIp
     * @param {number} ifMask
     */
    _isDirectedBroadcastForInterface(ip, ifIp, ifMask) {
        const nm = ifMask >>> 0;
        const addr = ifIp >>> 0;
        if (addr === 0 || nm === 0) return false;
        const net = (addr & nm) >>> 0;
        const bcast = (net | (~nm >>> 0)) >>> 0;
        return ((ip >>> 0) === bcast);
    }

    /**
     * Returns interface index if dst is a directed broadcast of that interface.
     * @param {number} dstIp
     * @returns {number} index or -1
     */
    _findDirectedBroadcastInterface(dstIp) {
        const dst = dstIp >>> 0;
        for (let i = 0; i < this.interfaces.length; i++) {
            const itf = this.interfaces[i];
            if (this._isDirectedBroadcastForInterface(dst, itf.ip, itf.netmask)) return i;
        }
        return -1;
    }


    /**
     * Resolve outgoing interface + next hop + suitable src IP for a given destination.
     * Longest-prefix match over this.routingTable.
     *
     * @param {number} dstIpNum
     * @param {{throwIfNoSrc?: boolean}} [opt]
     * @returns {{interfIndex:number, route:Route, nextHopIp:number, srcIp:number, prefixBits:number} | null}
     */
    _resolveOutgoing(dstIpNum, opt = {}) {
        const dst = (dstIpNum >>> 0);

        /** @type {Route|null} */
        let best = null;
        let bestBits = -1;

        for (const r of this.routingTable) {
            if (!r) continue;
            const mask = (r.netmask >>> 0);
            if ((((dst & mask) >>> 0) !== ((r.dst >>> 0) & mask) >>> 0)) continue;

            const bits = this._netmaskToPrefix(mask);
            if (bits > bestBits) {
                bestBits = bits;
                best = r;
            }
        }

        if (!best) return null;

        if (best.interf === -1) {
            return {
                interfIndex: -1,
                route: best,
                nextHopIp: 0,
                srcIp: IPOctetsToNumber(127, 0, 0, 1),
                prefixBits: bestBits,
            };
        }

        const interfIndex = best.interf | 0;
        const itf = this.interfaces[interfIndex];
        if (!itf) return null;

        const nextHopIp = ((best.nexthop >>> 0) === 0) ? dst : (best.nexthop >>> 0);
        const srcIp = (itf.ip >>> 0);

        if ((opt.throwIfNoSrc ?? false) && srcIp === 0) {
            throw new Error(`_resolveOutgoing: outgoing interface #${interfIndex} has src IP 0 (unconfigured?)`);
        }

        return {
            interfIndex,
            route: best,
            nextHopIp,
            srcIp,
            prefixBits: bestBits,
        };
    }

    /**
     * searches for a free eth-Number
     * @returns {number}
     */
    _getFreeEthIndex() {
        const used = new Set();

        for (const i of this.interfaces) {
            const m = /^eth(\d+)$/.exec(i.name);
            if (m) used.add(Number(m[1]));
        }

        let n = 0;
        while (used.has(n)) n++;
        return n;
    }

    addNewInterface() {
        const idx = this._getFreeEthIndex();
        const interf = new NetworkInterface({ name: `eth${idx}` });

        this.interfaces.push(interf);
        interf.subscribe(this);

        this._updateAutoRoutes();
    }

    /**
     * Delets a network interface, tries to clean up all associated structures
     *
     * @param {string} name
     */
    deleteInterface(name) {
        const idx = this.interfaces.findIndex(i => i.name === name);
        if (idx === -1) {
            console.warn("deleteInterface: interface not found", name);
            return;
        }

        const interf = this.interfaces[idx];

        // 1) destroy ethernet link
        if (interf.port.linkref != null) {
            interf.port.linkref.link.simcontrol.deleteObject(interf.port.linkref.link);
        }

        // 2) destroy all TCP-connections
        for (const [key, conn] of this.tcp.conns.entries()) {
            //TODO: If there are interface-specific bound TCP rules, we need to do more
            this.tcp.destroyAll(`interface ${name} removed`);
        }

        // 3) close all TCP sockets
        for (const [port, sock] of this.tcp.sockets.entries()) {
            if (sock.state === "LISTEN") {
                this.closeTCPServerSocket(port);
            }
        }

        // 4) close all UDP sockets
        for (const port of this.udp.sockets.keys()) {
            this.closeUDPSocket(port);
        }

        // 5) cleanup routing table
        this.routingTable = this.routingTable.filter(r => {
            if (r.interf === idx) {
                if (!r.auto) {
                    console.warn("deleteInterface: removing manual route", r);
                }
                return false;
            }
            return true;
        });

        // 6) now delete the interface
        this.interfaces.splice(idx, 1);

        // 7) correct the routing table interfaces
        for (const r of this.routingTable) {
            if (r.interf > idx) {
                r.interf -= 1;
            }
        }

        // 8) update automatic routes
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
            if (!internal) return; // drop inbound loopback
            this.accept(packet);
            return;
        }

        //check if we are the destination, then accept the packet in our queue
        for (let i = 0; i < this.interfaces.length; i++) {
            const myip = this.interfaces[i].ip;
            if (dstip == myip) {
                //accept the packet
                this.accept(packet);
                return;
            }
        }

        // --- Broadcast handling ---
        const isLimited = this._isLimitedBroadcast(dstip);
        const bIf = this._findDirectedBroadcastInterface(dstip);

        if (internal) {
            // internal: send broadcasts out on all links, do NOT accept() them
            if (isLimited) {
                const bmac = new Uint8Array([255, 255, 255, 255, 255, 255]);

                for (let i = 0; i < this.interfaces.length; i++) {
                    const itf = this.interfaces[i];
                    const ifIp = (itf.ip >>> 0);

                    // DHCP uses src 0.0.0.0 and limited broadcast 255.255.255.255.
                    // so we want them to go out.
                    const pktSrc = (IPUInt8ToNumber(packet.src) >>> 0);

                    const srcIp =
                        pktSrc !== 0 ? pktSrc :
                            (ifIp !== 0 ? ifIp : 0);

                    const p2 = new IPv4Packet({
                        dst: packet.dst,
                        src: IPNumberToUint8(srcIp),
                        protocol: packet.protocol,
                        payload: packet.payload,
                        ttl: packet.ttl,
                    });

                    itf.sendFrame(bmac, 0x0800, p2.pack());
                }
                return;
            }

            if (bIf !== -1) {
                if (IPUInt8ToNumber(packet.src) === 0) {
                    packet.src = IPNumberToUint8(this.interfaces[bIf].ip >>> 0);
                }

                const bmac = new Uint8Array([255, 255, 255, 255, 255, 255]);
                this.interfaces[bIf].sendFrame(bmac, 0x0800, packet.pack());
                return;
            }
        } else {
            // inbound: deliver broadcasts locally, never forward them
            if (isLimited || bIf !== -1) {
                this.accept(packet);
                return;
            }
        }
        // --- end broadcast handling ---

        const out = this._resolveOutgoing(dstip);
        if (!out) {
            this._sendICMPError(packet, 3, 0); // net unreachable
            return;
        }

        if (out.interfIndex === -1) {
            // loopback route
            this.accept(packet);
            return;
        }

        if (!internal) {
            if (!this.forwarding) {
                console.warn("Packet forwarding is disabled on this host");
                return;
            }

            packet.ttl = packet.ttl - 1;
            if (packet.ttl <= 0) {
                this._sendICMPError(packet, 11, 0);
                return;
            }
        }

        // Next hop resolution
        const r = out.route;
        const interf = this.interfaces[out.interfIndex];

        const nh = (r.nexthop >>> 0) === 0 ? dstip : (r.nexthop >>> 0);
        const mac = await interf.resolveIP(nh);

        if (mac == null) {
            this._sendICMPError(packet, 3, 1); // host unreachable
            return;
        }

        interf.sendFrame(mac, 0x0800, packet.pack());
        return;
    }

    /****************************************************** TCP **********************************/

    openTCPServerSocket(bindaddr, port) { return this.tcp.openServer(bindaddr, port); }
    acceptTCPConn(ref) { return this.tcp.accept(ref); }
    closeTCPServerSocket(ref) { return this.tcp.closeServer(ref); }

    connectTCPConn(dstIP, dstPort) { return this.tcp.connect(dstIP, dstPort); }
    recvTCPConn(key) { return this.tcp.recv(key); }
    sendTCPConn(key, data) { return this.tcp.send(key, data); }
    closeTCPConn(key) { return this.tcp.close(key); }

    /****************************************************** UDP **********************************/


    openUDPSocket(bindaddr, port) { return this.udp.open(bindaddr, port); }
    sendUDPSocket(port, dstip, dstport, data) { return this.udp.send(port, dstip, dstport, data); }
    recvUDPSocket(port) { return this.udp.recv(port); }
    closeUDPSocket(port) { return this.udp.close(port); }
    _handleUDP(packet) { return this.udp.handle(packet); }

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

            // FIX: choose src IP based on routing (multi-IF correct)
            const out = this._resolveOutgoing(dstIpNum);
            const srcIp = out?.srcIp ?? 0;

            this.send({
                dst: dstIpNum,
                src: srcIp,
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

        // Never generate ICMP errors for packets sent to limited broadcast
        if (this._isLimitedBroadcast(dst)) return;

        // Never generate ICMP errors for directed broadcast destinations
        if (this._findDirectedBroadcastInterface(dst) !== -1) return;

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
            case 8: { // Echo request
                if (icmp.code != 0) throw new Error("ICMP-Code not understood");

                const dst = IPUInt8ToNumber(packet.dst);
                if (this._isLimitedBroadcast(dst) || this._findDirectedBroadcastInterface(dst) !== -1) {
                    return; // don't reply to broadcast pings
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
            }
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
                this.tcp.handle(packet);
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
        const dst = (opts.dst ?? 0) >>> 0;
        let src = (opts.src ?? 0) >>> 0;
        if (src === 0) {
            src = this._pickSrcIp(dst);
        }
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

    /**
     * deletes an route. Can not delete auto-routes
     *
     * @param {number} dst
     * @param {number} netmask
     * @param {number} interf
     * @param {number} nexthop
     */
    delRoute(dst, netmask, interf, nexthop) {
        const anyMatch = this.routingTable.some(r =>
            r.dst === dst &&
            r.netmask === netmask &&
            r.interf === interf &&
            r.nexthop === nexthop
        );

        let removed = 0;
        this.routingTable = this.routingTable.filter(r => {
            const matchManual =
                !r.auto &&
                r.dst === dst &&
                r.netmask === netmask &&
                r.interf === interf &&
                r.nexthop === nexthop;

            if (matchManual) removed++;
            return !matchManual;
        });
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

    toJSON() {
        return {
            name: this.name,
            forwarding: !!this.forwarding,

            interfaces: this.interfaces.map((itf) => ({
                name: itf.name,
                ip: itf.ip ?? 0,
                netmask: itf.netmask ?? 0,
            })),

            // store only manual routes; auto routes are derived
            routes: this.routingTable
                .filter(r => !r.auto)
                .map(r => ({
                    dst: r.dst,
                    netmask: r.netmask,
                    interf: r.interf,
                    nexthop: r.nexthop,
                })),
        };
    }

    /**
     * @param {any} json
     * @returns {IPStack}
     */
    static fromJSON(json) {
        if (!json || typeof json !== "object") {
            throw new Error("IPStack.fromJSON: invalid json");
        }

        const ifs = Array.isArray(json.interfaces) ? json.interfaces : [];
        const stack = new IPStack(0, String(json.name ?? ""));

        stack.forwarding = !!json.forwarding;

        // create interfaces in the stored order with stored names
        stack.interfaces = [];
        for (let i = 0; i < ifs.length; i++) {
            const row = ifs[i] ?? {};
            const name = String(row.name ?? `eth${i}`);
            const interf = new NetworkInterface({ name });
            stack.interfaces.push(interf);
            interf.subscribe(stack);
        }

        // configure IP/netmask
        for (let i = 0; i < stack.interfaces.length; i++) {
            const row = ifs[i] ?? {};
            stack.configureInterface(i, {
                name: stack.interfaces[i].name,
                ip: Number(row.ip ?? 0),
                netmask: Number(row.netmask ?? 0),
            });
        }

        // rebuild auto routes
        stack._updateAutoRoutes();

        // restore manual routes
        const routes = Array.isArray(json.routes) ? json.routes : [];
        for (const rr of routes) {
            if (!rr || typeof rr !== "object") continue;

            const dst = Number(rr.dst ?? 0);
            const netmask = Number(rr.netmask ?? 0);
            const interf = Number(rr.interf ?? 0);
            const nexthop = Number(rr.nexthop ?? 0);

            if (interf !== -1 && (interf < 0 || interf >= stack.interfaces.length)) {
                console.warn("IPStack.fromJSON: skipping route with invalid interf index", rr);
                continue;
            }

            stack.addRoute(dst, netmask, interf, nexthop);
        }

        return stack;
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

