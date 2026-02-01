//@ts-check

import { prefixToNetmask } from "../lib/helpers.js";
import { IPv4Packet } from "../net/pdu/IPv4Packet.js";
import { NetworkInterface } from "./NetworkInterface.js";
import { Observable } from "../lib/Observeable.js";
import { ICMPPacket } from "../net/pdu/ICMPPacket.js";
import { EthernetPort } from "./EthernetPort.js";
import { SimControl } from "../SimControl.js";
import { TcpEngine } from "./TcpEngine.js";
import { UdpEngine } from "./UdpEngine.js";
import { IPAddress } from "./models/IPAddress.js";

/**
 * IPv4-only IP stack (IPv6-ready data model via IPAddress + prefixLength).
 * Routing + ARP are IPv4 only for now.
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
     * @param {Number} numberOfInterfaces
     * @param {String} name
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
                return out?.srcIp ?? IPAddress.fromString("0.0.0.0");
            },
        });

        this.udp = new UdpEngine({
            ipSend: (opts) => { this.send(opts); },
            sendIcmpError: (original, type, code) => { this._sendICMPError(original, type, code); },
        });
    }

    // ----------- helpers: IPv4-only stack -----------

    /**
     * @param {IPAddress} ip
     * @returns {number} uint32
     */
    _v4n(ip) {
        if (!(ip instanceof IPAddress)) throw new TypeError("Expected IPAddress");
        if (!ip.isV4()) throw new Error("IPv6 is not supported in this IPv4-only stack yet.");
        return /** @type {number} */ (ip.getNumber()) >>> 0;
    }

    /**
     * @param {IPAddress} ip
     * @returns {boolean}
     */
    _isZero(ip) {
        return this._v4n(ip) === 0;
    }

    /**
     * @param {number} prefix
     * @returns {number} uint32 netmask
     */
    _prefixToNetmask32(prefix) {
        if (prefix < 0 || prefix > 32) throw new Error(`Invalid IPv4 prefixLength ${prefix}`);
        return (prefixToNetmask(prefix) >>> 0);
    }

    /**
     * Count leading 1 bits in a netmask (uint32).
     * @param {number} netmask32
     * @returns {number}
     */
    _netmask32ToPrefix(netmask32) {
        let m = (netmask32 >>> 0);
        let bits = 0;
        while (bits < 32 && (m & 0x80000000) !== 0) {
            bits++;
            m = (m << 1) >>> 0;
        }
        return bits;
    }

    /**
     * @param {IPAddress} ip
     * @returns {boolean}
     */
    _isLimitedBroadcast(ip) {
        return this._v4n(ip) === 0xffffffff;
    }

    /**
     * @param {IPAddress} ip
     * @returns {boolean}
     */
    _isLoopback(ip) {
        return (this._v4n(ip) & 0xff000000) === 0x7f000000;
    }

    /**
     * @param {IPAddress} ip
     * @param {IPAddress} ifIp
     * @param {number} ifPrefix
     * @returns {boolean}
     */
    _isDirectedBroadcastForInterface(ip, ifIp, ifPrefix) {
        const addr = this._v4n(ifIp);
        if (addr === 0) return false;

        const nm = this._prefixToNetmask32(ifPrefix);
        if (nm === 0) return false;

        const net = (addr & nm) >>> 0;
        const bcast = (net | (~nm >>> 0)) >>> 0;
        return this._v4n(ip) === bcast;
    }

    /**
     * Returns interface index if dst is a directed broadcast of that interface.
     * @param {IPAddress} dstIp
     * @returns {number} index or -1
     */
    _findDirectedBroadcastInterface(dstIp) {
        for (let i = 0; i < this.interfaces.length; i++) {
            const itf = this.interfaces[i];
            if (!itf.ip.isV4()) continue; // ignore v6-configured (later)
            if (this._isDirectedBroadcastForInterface(dstIp, itf.ip, itf.prefixLength)) return i;
        }
        return -1;
    }

    /**
     * Pick a sane source IP for locally generated traffic.
     * @param {IPAddress} dstIp
     * @returns {IPAddress} src ip (0.0.0.0 if none)
     */
    _pickSrcIp(dstIp) {
        const dst = this._v4n(dstIp);

        // Loopback destination -> loopback src
        if ((dst & 0xff000000) === 0x7f000000) {
            return IPAddress.fromString("127.0.0.1");
        }

        // If destination is one of our interface addresses, use that
        for (const itf of this.interfaces) {
            if (!itf.ip.isV4()) continue;
            if (!this._isZero(itf.ip) && this._v4n(itf.ip) === dst) {
                return itf.ip;
            }
        }

        // Otherwise choose src based on routing (longest prefix match)
        const out = this._resolveOutgoing(dstIp);
        if (out && !this._isZero(out.srcIp)) return out.srcIp;

        return IPAddress.fromString("0.0.0.0");
    }

    /**
     * Resolve outgoing interface + next hop + suitable src IP for a given destination.
     * Longest-prefix match over this.routingTable.
     *
     * @param {IPAddress} dstIp
     * @param {{throwIfNoSrc?: boolean}} [opt]
     * @returns {{interfIndex:number, route:Route, nextHopIp:IPAddress, srcIp:IPAddress, prefixBits:number} | null}
     */
    _resolveOutgoing(dstIp, opt = {}) {
        const dst = this._v4n(dstIp);

        /** @type {Route|null} */
        let best = null;
        let bestBits = -1;

        for (const r of this.routingTable) {
            if (!r) continue;
            if (!r.dst.isV4()) continue; // v6 routes later

            const rdst = this._v4n(r.dst);
            const mask = this._prefixToNetmask32(r.prefixLength);

            if (((dst & mask) >>> 0) !== ((rdst & mask) >>> 0)) continue;

            const bits = r.prefixLength | 0;
            if (bits > bestBits) {
                bestBits = bits;
                best = r;
            }
        }

        if (!best) return null;

        // loopback pseudo-route
        if (best.interf === -1) {
            return {
                interfIndex: -1,
                route: best,
                nextHopIp: IPAddress.fromString("0.0.0.0"),
                srcIp: IPAddress.fromString("127.0.0.1"),
                prefixBits: bestBits,
            };
        }

        const interfIndex = best.interf | 0;
        const itf = this.interfaces[interfIndex];
        if (!itf) return null;

        const nextHopIp = this._isZero(best.nexthop) ? dstIp : best.nexthop;
        const srcIp = itf.ip;

        if ((opt.throwIfNoSrc ?? false) && this._isZero(srcIp)) {
            throw new Error(`_resolveOutgoing: outgoing interface #${interfIndex} has src IP 0.0.0.0 (unconfigured?)`);
        }

        return { interfIndex, route: best, nextHopIp, srcIp, prefixBits: bestBits };
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
        this.tcp.destroyAll(`interface ${name} removed`);

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
                if (!r.auto) console.warn("deleteInterface: removing manual route", r);
                return false;
            }
            return true;
        });

        // 6) delete interface
        this.interfaces.splice(idx, 1);

        // 7) fix route interface indices
        for (const r of this.routingTable) {
            if (r.interf > idx) r.interf -= 1;
        }

        // 8) update auto routes
        this._updateAutoRoutes();
    }

    /**
     * @param {IPv4Packet} packet
     * @param {Boolean} internal
     */
    async route(packet, internal = false) {
        const dst = IPAddress.fromUInt8(packet.dst);
        const src = IPAddress.fromUInt8(packet.src);

        // loopback
        if (this._isLoopback(dst)) {
            if (!internal) return;
            this.accept(packet);
            return;
        }

        // is it for us?
        for (let i = 0; i < this.interfaces.length; i++) {
            const itf = this.interfaces[i];
            if (!itf.ip.isV4()) continue;
            if (this._v4n(dst) === this._v4n(itf.ip)) {
                this.accept(packet);
                return;
            }
        }

        // --- Broadcast handling ---
        const isLimited = this._isLimitedBroadcast(dst);
        const bIf = this._findDirectedBroadcastInterface(dst);

        if (internal) {
            if (isLimited) {
                const bmac = new Uint8Array([255, 255, 255, 255, 255, 255]);

                for (let i = 0; i < this.interfaces.length; i++) {
                    const itf = this.interfaces[i];
                    if (!itf.ip.isV4()) continue;

                    // DHCP: src can be 0.0.0.0
                    const pktSrcIsZero = (this._v4n(src) === 0);
                    const srcIp =
                        !pktSrcIsZero ? src :
                            (!this._isZero(itf.ip) ? itf.ip : IPAddress.fromString("0.0.0.0"));

                    const p2 = new IPv4Packet({
                        dst: packet.dst,
                        src: srcIp.toUInt8(),
                        protocol: packet.protocol,
                        payload: packet.payload,
                        ttl: packet.ttl,
                    });

                    itf.sendFrame(bmac, 0x0800, p2.pack());
                }
                return;
            }

            if (bIf !== -1) {
                if (this._v4n(src) === 0) {
                    packet.src = this.interfaces[bIf].ip.toUInt8();
                }
                const bmac = new Uint8Array([255, 255, 255, 255, 255, 255]);
                this.interfaces[bIf].sendFrame(bmac, 0x0800, packet.pack());
                return;
            }
        } else {
            if (isLimited || bIf !== -1) {
                this.accept(packet);
                return;
            }
        }
        // --- end broadcast handling ---

        const out = this._resolveOutgoing(dst);
        if (!out) {
            this._sendICMPError(packet, 3, 0); // net unreachable
            return;
        }

        if (out.interfIndex === -1) {
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

        const r = out.route;
        const interf = this.interfaces[out.interfIndex];

        const nh = this._isZero(r.nexthop) ? dst : r.nexthop;

        // NEW: resolveNeighbor() (IPv4 uses ARP internally)
        const mac = await interf.resolveNeighbor(nh);

        if (mac == null) {
            this._sendICMPError(packet, 3, 1); // host unreachable
            return;
        }

        interf.sendFrame(mac, 0x0800, packet.pack());
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
     * @param {IPAddress} dstIp
     * @param {{timeoutMs?: number, payload?: Uint8Array, identifier?: number, sequence?: number}} [opt]
     * @returns {Promise<{bytes:number, ttl:number, timeMs:number, identifier:number, sequence:number}>}
     */
    async icmpEcho(dstIp, opt = {}) {
        const timeoutMs = opt.timeoutMs ?? 20 * SimControl.tick;
        const identifier = opt.identifier ?? (this._nextIcmpId = (this._nextIcmpId + 1) & 0xffff);
        const sequence = opt.sequence ?? (Math.random() * 0xffff) | 0;
        const payload = opt.payload ?? new Uint8Array(32);

        const key = this._icmpEchoKey(dstIp, identifier, sequence);
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

            const out = this._resolveOutgoing(dstIp);
            const srcIp = out?.srcIp ?? IPAddress.fromString("0.0.0.0");

            this.send({
                dst: dstIp,
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
     * @param {IPAddress} dst
     * @param {number} id
     * @param {number} seq
     */
    _icmpEchoKey(dst, id, seq) {
        return `${dst.toString()}|${id}|${seq}`;
    }

    /**
     * @param {IPv4Packet} original
     * @param {number} type
     * @param {number} code
     */
    _sendICMPError(original, type, code) {
        const src = IPAddress.fromUInt8(original.src);
        const dst = IPAddress.fromUInt8(original.dst);

        if (this._isZero(src)) return;
        if (original.protocol == 1) return;

        if (this._isLimitedBroadcast(dst)) return;
        if (this._findDirectedBroadcastInterface(dst) !== -1) return;

        const quotedLen = Math.min(original.payload.length, 8);
        const quoted = new Uint8Array(original.pack().slice(0, original.ihl * 4 + quotedLen));
        const icmp = new ICMPPacket({ type, code, payload: quoted }).pack();

        this.send({
            dst: src,
            src: dst,
            protocol: 1,
            payload: icmp
        });
    }

    /**
     * @param {IPv4Packet} packet
     */
    _handleICMP(packet) {
        const icmp = ICMPPacket.fromBytes(packet.payload);
        const ip_src = IPAddress.fromUInt8(packet.src);
        const ip_dst = IPAddress.fromUInt8(packet.dst);

        console.debug("ICMP IN", {
            ip_src: ip_src.toString(),
            ip_dst: ip_dst.toString(),
            ttl: packet.ttl,
            len: packet.payload?.length,
            icmp_type: icmp.type,
            icmp_code: icmp.code,
            id: icmp.identifier,
            seq: icmp.sequence
        });

        switch (icmp.type) {
            case 0: { // Echo reply
                const remote = ip_src;
                const id = icmp.identifier ?? 0;
                const seq = icmp.sequence ?? 0;

                const key = this._icmpEchoKey(remote, id, seq);
                const pending = this._pendingEcho.get(key);

                if (!pending) {
                    console.warn("ICMP echo reply without pending request", { key, remote: remote.toString(), id, seq });
                    break;
                }

                clearTimeout(pending.timer);
                this._pendingEcho.delete(key);

                pending.resolve({
                    bytes: packet.payload?.length ?? 0,
                    ttl: packet.ttl ?? 64,
                    identifier: id,
                    sequence: seq,
                    timeMs: 0,
                });
                break;
            }

            case 8: { // Echo request
                if (icmp.code != 0) throw new Error("ICMP-Code not understood");

                if (this._isLimitedBroadcast(ip_dst) || this._findDirectedBroadcastInterface(ip_dst) !== -1) return;

                this.send({
                    dst: ip_src,
                    src: ip_dst,
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

            default:
                // other types optional
                break;
        }
    }

    /****************************************************** COMMON **********************************/

    /**
     * @param {IPv4Packet} packet
     */
    accept(packet) {
        console.debug(this.name + ": Accepted packet");
        console.debug(packet);

        switch (packet.protocol) {
            case 1:
                this._handleICMP(packet);
                break;
            case 6:
                this.tcp.handle(packet);
                break;
            case 17:
                this._handleUDP(packet);
                break;
            default:
                console.warn(this.name + ": Unknown protocoll number " + packet.protocol);
        }
    }

    /**
     * Create and send a locally generated IPv4 packet.
     * @param {Object} [opts]
     * @param {IPAddress} [opts.dst]
     * @param {IPAddress} [opts.src]
     * @param {Number} [opts.protocol]
     * @param {Number} [opts.ttl]
     * @param {Uint8Array} [opts.payload]
     */
    async send(opts = {}) {
        const dst = opts.dst ?? IPAddress.fromString("0.0.0.0");
        let src = opts.src ?? IPAddress.fromString("0.0.0.0");

        if (this._isZero(src)) src = this._pickSrcIp(dst);

        const protocol = (opts.protocol ?? 0);
        const ttl = (opts.ttl ?? 64);
        const payload = (opts.payload ?? new Uint8Array());

        const packet = new IPv4Packet({
            dst: dst.toUInt8(),
            src: src.toUInt8(),
            protocol,
            payload,
            ttl
        });

        console.debug("IP OUT", { dst: dst.toString(), src: src.toString(), protocol, ttl: packet.ttl, payloadLen: payload.length });

        this.route(packet, true).catch(console.error);
    }

    /**
     * Configure an interface.
     * @param {Number} [i]
     * @param {Object} [opts]
     * @param {IPAddress|string} [opts.ip]
     * @param {number} [opts.prefixLength]
     * @param {String} [opts.name]
     */
    configureInterface(i = 0, opts = {}) {
        if (this.interfaces[i] == null) return;

        const ip = (opts.ip instanceof IPAddress)
            ? opts.ip
            : IPAddress.fromString(String(opts.ip ?? "192.168.0.10"));

        const prefixLength = (opts.prefixLength ?? (ip.isV4() ? 24 : 64)) | 0;

        this.interfaces[i].configure({
            name: opts.name ?? this.interfaces[i].name,
            ip,
            prefixLength,
        });

        this._updateAutoRoutes();
    }

    update() {
        for (let i = 0; i < this.interfaces.length; i++) {
            const packet = this.interfaces[i].getNextPacket();
            if (packet == null) continue;
            this.route(packet, false);
        }
    }

    /**
     * Add a manual route.
     * @param {IPAddress} dst network address
     * @param {number} prefixLength
     * @param {Number} interf
     * @param {IPAddress} nexthop 0.0.0.0 for direct
     */
    addRoute(dst, prefixLength, interf, nexthop) {
        const r = new Route();
        r.dst = dst;
        r.prefixLength = prefixLength | 0;
        r.interf = interf | 0;
        r.nexthop = nexthop;
        r.auto = false;
        this.routingTable.push(r);
    }

    /**
     * Delete a manual route (exact match).
     * @param {IPAddress} dst
     * @param {number} prefixLength
     * @param {number} interf
     * @param {IPAddress} nexthop
     */
    delRoute(dst, prefixLength, interf, nexthop) {
        this.routingTable = this.routingTable.filter(r => {
            const matchManual =
                !r.auto &&
                r.interf === (interf | 0) &&
                r.prefixLength === (prefixLength | 0) &&
                r.dst.toString() === dst.toString() &&
                r.nexthop.toString() === nexthop.toString();
            return !matchManual;
        });
    }

    _updateAutoRoutes() {
        this.routingTable = this.routingTable.filter(r => !r.auto);

        // Add connected routes for each interface (IPv4 only for now)
        for (let i = 0; i < this.interfaces.length; i++) {
            const itf = this.interfaces[i];
            if (!itf.ip.isV4()) continue;

            const ip32 = this._v4n(itf.ip);
            const mask32 = this._prefixToNetmask32(itf.prefixLength);
            const net32 = (ip32 & mask32) >>> 0;

            const r = new Route();
            r.dst = new IPAddress(4, net32);
            r.prefixLength = itf.prefixLength | 0;
            r.interf = i;
            r.nexthop = IPAddress.fromString("0.0.0.0");
            r.auto = true;
            this.routingTable.push(r);
        }

        // Loopback route
        const r = new Route();
        r.dst = IPAddress.fromString("127.0.0.0");
        r.prefixLength = 8;
        r.interf = -1;
        r.nexthop = IPAddress.fromString("0.0.0.0");
        r.auto = true;
        this.routingTable.push(r);
    }

    getInterface(i) {
        return this.interfaces[i];
    }

    /**
     * @returns {EthernetPort|null}
     */
    getNextFreeInterfacePort() {
        for (let i = 0; i < this.interfaces.length; i++) {
            const port = this.interfaces[i].port;
            if (port.linkref == null) return port;
        }
        return null;
    }

    toJSON() {
        return {
            name: this.name,
            forwarding: !!this.forwarding,

            interfaces: this.interfaces.map((itf) => ({
                name: itf.name,
                ip: itf.ip?.toString?.() ?? "0.0.0.0",
                prefixLength: itf.prefixLength ?? 0,
            })),

            routes: this.routingTable
                .filter(r => !r.auto)
                .map(r => ({
                    dst: r.dst.toString(),
                    prefixLength: r.prefixLength,
                    interf: r.interf,
                    nexthop: r.nexthop.toString(),
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

        // create interfaces in stored order
        stack.interfaces = [];
        for (let i = 0; i < ifs.length; i++) {
            const row = ifs[i] ?? {};
            const name = String(row.name ?? `eth${i}`);
            const interf = new NetworkInterface({ name });
            stack.interfaces.push(interf);
            interf.subscribe(stack);
        }

        // configure ip/prefix
        for (let i = 0; i < stack.interfaces.length; i++) {
            const row = ifs[i] ?? {};
            const ip = IPAddress.fromString(String(row.ip ?? "0.0.0.0"));
            const prefixLength = Number(row.prefixLength ?? (ip.isV4() ? 24 : 64));
            stack.configureInterface(i, { name: stack.interfaces[i].name, ip, prefixLength });
        }

        // rebuild auto routes
        stack._updateAutoRoutes();

        // restore manual routes
        const routes = Array.isArray(json.routes) ? json.routes : [];
        for (const rr of routes) {
            if (!rr || typeof rr !== "object") continue;

            const dst = IPAddress.fromString(String(rr.dst ?? "0.0.0.0"));
            const prefixLength = Number(rr.prefixLength ?? (dst.isV4() ? 32 : 128));
            const interf = Number(rr.interf ?? 0);
            const nexthop = IPAddress.fromString(String(rr.nexthop ?? "0.0.0.0"));

            if (interf !== -1 && (interf < 0 || interf >= stack.interfaces.length)) {
                console.warn("IPStack.fromJSON: skipping route with invalid interf index", rr);
                continue;
            }

            stack.addRoute(dst, prefixLength, interf, nexthop);
        }

        return stack;
    }
}

export class Route {
    /** @type {IPAddress} */
    dst = IPAddress.fromString("0.0.0.0");

    /** @type {number} */
    prefixLength = 0;

    /** @type {IPAddress} */
    nexthop = IPAddress.fromString("0.0.0.0");

    /** @type {Number} */
    interf = 0;

    auto = true;
}
