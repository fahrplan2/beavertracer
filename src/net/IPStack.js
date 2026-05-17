//@ts-check

import { prefixToNetmask } from "../lib/helpers.js";
import { IPv4Packet } from "../net/pdu/IPv4Packet.js";
import { IPv6Packet } from "../net/pdu/IPv6Packet.js";
import { NetworkInterface, VLANSubInterface } from "./NetworkInterface.js";
import { Observable } from "../lib/Observeable.js";
import { ICMPPacket } from "../net/pdu/ICMPPacket.js";
import { EthernetPort } from "./EthernetPort.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";
import { TcpEngine } from "./TcpEngine.js";
import { UdpEngine } from "./UdpEngine.js";
import { IPAddress } from "./models/IPAddress.js";
import { ICMPv6Packet } from "../net/pdu/ICMPv6Packet.js";
import { GREPacket } from "../net/pdu/GREPacket.js";
import { write32BE } from "../net/util/byteUtils.js";

class TunnelConfig {
    /** @type {string} */
    name = "";
    /** @type {IPAddress} */
    remoteEndpoint = IPAddress.fromString("0.0.0.0");
}

/**
 * Returns true if addr matches network/prefixLength.
 * Works for both IPv4 (4 bytes) and IPv6 (16 bytes).
 * @param {IPAddress} addr
 * @param {IPAddress} network
 * @param {number} prefixLength
 * @returns {boolean}
 */
function _matchesPrefix(addr, network, prefixLength) {
    const a = addr.toUInt8();
    const n = network.toUInt8();
    if (a.length !== n.length) return false;
    let rem = prefixLength | 0;
    for (let i = 0; i < a.length && rem > 0; i++) {
        if (rem >= 8) {
            if (a[i] !== n[i]) return false;
            rem -= 8;
        } else {
            const mask = (0xff << (8 - rem)) & 0xff;
            if ((a[i] & mask) !== (n[i] & mask)) return false;
            rem = 0;
        }
    }
    return true;
}

/**
 * IPv4-only IP stack (IPv6-ready data model via IPAddress + prefixLength).
 * Routing + ARP are IPv4 only for now.
 */
export class IPStack extends Observable {
    /** @type {Array<NetworkInterface>} */
    interfaces = [];

    /** @type {Array<Route>} */
    routingTable = [];

    /** @type {TunnelConfig[]} */
    tunnels = [];

    forwarding = false;

    /** @type {Map<string,any>} */
    _pendingEcho = new Map();
    /** @type {Map<string,any>} */
    _pendingEcho6 = new Map();
    /** @type {number} */
    _nextIcmpId = (Math.random() * 0xffff) | 0;

    /** @type {Map<number, number|null>} interfaceIndex → active RA timer id */
    _raTimers = new Map();
    /** @type {Map<number, string|null>} interfaceIndex → last seen ip6 string */
    _lastKnownIp6 = new Map();

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
            ipSend: (opts) => {
                if (opts.dst?.isV4?.()) {
                    this.send(opts);
                } else {
                    this.send6({ dst: opts.dst, src: opts.src, nextHeader: opts.protocol, payload: opts.payload });
                }
            },
            resolveSrcIp: (dstIp) => {
                if (dstIp.isV4()) {
                    const out = this._resolveOutgoing(dstIp);
                    return out?.srcIp ?? IPAddress.fromString("0.0.0.0");
                }
                return this._pickSrcIpV6(dstIp);
            },
        });

        this.udp = new UdpEngine({
            ipSend: (opts) => {
                if (opts.dst?.isV4?.()) {
                    this.send(opts);
                } else {
                    this.send6({ dst: opts.dst, src: opts.src, nextHeader: opts.protocol, payload: opts.payload });
                }
            },
            sendIcmpError: (original, type, code) => { this._sendICMPError(original, type, code); },
            resolveSrcIp: (dstIp) => {
                if (dstIp.isV4()) {
                    const out = this._resolveOutgoing(dstIp);
                    return out?.srcIp ?? IPAddress.fromString("0.0.0.0");
                }
                return this._pickSrcIpV6(dstIp);
            },
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
        if (ip.isV4()) return this._v4n(ip) === 0;
        return ip.toUInt8().every(b => b === 0);
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
        if (ip.isV4()) return (this._v4n(ip) & 0xff000000) === 0x7f000000;
        // IPv6 loopback = ::1
        const b = ip.toUInt8();
        return b.slice(0, 15).every(x => x === 0) && b[15] === 1;
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
        /** @type {Route|null} */
        let best = null;
        let bestBits = -1;

        for (const r of this.routingTable) {
            if (!r) continue;
            if (r.dst.isV4() !== dstIp.isV4()) continue; // family filter

            if (!_matchesPrefix(dstIp, r.dst, r.prefixLength)) continue;

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

        // tunnel route — no physical interface needed
        if (best.tunnel) {
            return {
                interfIndex: -2,
                route: best,
                nextHopIp: IPAddress.fromString("0.0.0.0"),
                srcIp: IPAddress.fromString("0.0.0.0"),
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
     * Add a VLAN subinterface (e.g. eth0.10) to an existing interface.
     * @param {string} parentName  e.g. "eth0"
     * @param {number} vid         VLAN ID 1–4094
     */
    addSubInterface(parentName, vid) {
        vid = vid | 0;
        if (vid < 1 || vid > 4094) throw new Error(`Invalid VLAN ID ${vid}`);
        const parent = this.interfaces.find(i => i.name === parentName);
        if (!parent) throw new Error(`Interface ${parentName} not found`);
        if (parent instanceof VLANSubInterface) throw new Error("Cannot create subinterface of a subinterface");
        if (parent._subInterfaces.has(vid)) throw new Error(`Subinterface ${parentName}.${vid} already exists`);

        const sub = new VLANSubInterface(parent, vid);
        parent._subInterfaces.set(vid, sub);
        this.interfaces.push(sub);
        sub.subscribe(this);

        this._updateAutoRoutes();
    }

    /**
     * @param {string} name
     */
    deleteInterface(name) {
        const interf = this.interfaces.find(i => i.name === name);
        if (!interf) {
            console.warn("deleteInterface: interface not found", name);
            return;
        }

        // Cascade: remove subinterfaces first (copy to avoid mutation during iteration)
        if (!(interf instanceof VLANSubInterface)) {
            for (const sub of [...interf._subInterfaces.values()]) {
                this.deleteInterface(sub.name);
            }
        }

        // Re-find index after potential cascade
        const idx = this.interfaces.findIndex(i => i.name === name);
        if (idx === -1) return;

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

        // 6) delete interface (and unregister from parent if it's a subinterface)
        interf.unsubscribe(this);
        interf.port.unsubscribe(interf);
        if (interf instanceof VLANSubInterface) {
            interf._parentIface._subInterfaces.delete(interf.vid);
        }
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
     * @param {number} recvIfIndex  interface the packet arrived on (-1 = locally generated)
     */
    async route(packet, internal = false, recvIfIndex = -1) {
        const dst = packet.dst;
        const src = packet.src;

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
                        src: srcIp,
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
                    packet.src = this.interfaces[bIf].ip;
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

            // RFC 1122 §3.3.1.2: send ICMP Redirect when outgoing == incoming interface
            if (recvIfIndex >= 0 && out.interfIndex === recvIfIndex) {
                const gw = this._isZero(out.route.nexthop) ? dst : out.route.nexthop;
                this._sendICMPRedirect(packet, gw);
                // Continue forwarding anyway (RFC 1122 requirement)
            }
        }

        if (out.route.tunnel) {
            await this._forwardGRE(packet, out.route.tunnel);
            return;
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
    /** @param {IPAddress} bindaddr @param {number} port */
    openTCPServerSocket(bindaddr, port) { return this.tcp.openServer(bindaddr, port); }
    /** @param {*} ref */
    acceptTCPConn(ref) { return this.tcp.accept(ref); }
    /** @param {*} ref */
    closeTCPServerSocket(ref) { return this.tcp.closeServer(ref); }

    /** @param {IPAddress} dstIP @param {number} dstPort */
    connectTCPConn(dstIP, dstPort) { return this.tcp.connect(dstIP, dstPort); }
    /** @param {*} key */
    recvTCPConn(key) { return this.tcp.recv(key); }
    /** @param {*} key @param {*} data */
    sendTCPConn(key, data) { return this.tcp.send(key, data); }
    /** @param {*} key */
    closeTCPConn(key) { return this.tcp.close(key); }
    /** @param {*} key */
    getTCPConnInfo(key) { return this.tcp.getConnInfo(key); }

    /****************************************************** UDP **********************************/
    /** @param {IPAddress} bindaddr @param {number} port */
    openUDPSocket(bindaddr, port) { return this.udp.open(bindaddr, port); }
    /** @param {number} port @param {IPAddress} dstip @param {number} dstport @param {*} data */
    sendUDPSocket(port, dstip, dstport, data) { return this.udp.send(port, dstip, dstport, data); }
    /** @param {number} port */
    recvUDPSocket(port) { return this.udp.recv(port); }
    /** @param {number} port */
    closeUDPSocket(port) { return this.udp.close(port); }
    /** @param {*} packet */
    _handleUDP(packet) { return this.udp.handle(packet); }

    /****************************************************** ICMP ************************************/

    /**
     * @param {IPAddress} dstIp
     * @param {{timeoutMs?: number, payload?: Uint8Array, identifier?: number, sequence?: number, ttl?: number}} [opt]
     * @returns {Promise<{bytes:number, ttl:number, timeMs:number, identifier:number, sequence:number}>}
     */
    async icmpEcho(dstIp, opt = {}) {
        const timeoutSimMs = opt.timeoutMs ?? SimTimer.PING_TIMEOUT_MS;
        const identifier = opt.identifier ?? (this._nextIcmpId = (this._nextIcmpId + 1) & 0xffff);
        const sequence = opt.sequence ?? (Math.random() * 0xffff) | 0;
        const payload = opt.payload ?? new Uint8Array(32);

        const key = this._icmpEchoKey(dstIp, identifier, sequence);
        const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());

        return new Promise((resolve, reject) => {
            const timerId = simTimer.schedule(() => {
                this._pendingEcho.delete(key);
                reject(new Error("timeout"));
            }, timeoutSimMs);

            this._pendingEcho.set(key, { resolve, reject, timerId, t0 });

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
                ttl: opt.ttl,
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
        if (!(original instanceof IPv4Packet)) return; // ICMPv6 errors: Phase 3+

        const src = original.src;
        const dst = original.dst;

        if (this._isZero(src)) return;
        // Don't reply to ICMP error messages (RFC 792), but DO reply to echo requests (type 8)
        if (original.protocol == 1) {
            const icmpType = original.payload?.[0];
            if (icmpType !== 8) return;
        }

        if (this._isLimitedBroadcast(dst)) return;
        if (this._findDirectedBroadcastInterface(dst) !== -1) return;

        const quotedLen = Math.min(original.payload.length, 8);
        const quoted = new Uint8Array(original.pack().slice(0, original.ihl * 4 + quotedLen));
        const icmp = new ICMPPacket({ type, code, payload: quoted }).pack();

        this.send({
            dst: src,
            // src omitted: send() picks the router's own outgoing interface IP via _pickSrcIp
            protocol: 1,
            payload: icmp
        });
    }

    /**
     * Send an ICMP Redirect (Type 5 Code 1 – Host Redirect) to the sender of a forwarded packet.
     * Built manually because ICMPPacket.pack() uses echo layout (identifier+sequence).
     * RFC 792 §5, RFC 1122 §3.3.1.2.
     * @param {IPv4Packet} original
     * @param {IPAddress} gateway  better next-hop to advertise
     */
    _sendICMPRedirect(original, gateway) {
        if (this._isZero(original.src)) return;
        if (this._isLimitedBroadcast(original.src)) return;

        const quotedLen = Math.min(original.payload.length, 8);
        const origHeader = original.pack().slice(0, original.ihl * 4);
        // ICMP Redirect layout: type(1) code(1) checksum(2) gateway(4) orig-header+8
        const icmp = new Uint8Array(4 + 4 + origHeader.length + quotedLen);
        icmp[0] = 5; // Type: Redirect
        icmp[1] = 1; // Code: Redirect for Host
        // icmp[2,3] = checksum placeholder (0)
        icmp.set(gateway.toUInt8(), 4);
        icmp.set(origHeader, 8);
        icmp.set(original.payload.slice(0, quotedLen), 8 + origHeader.length);
        const cs = ICMPPacket.computeChecksum(icmp);
        icmp[2] = (cs >> 8) & 0xff;
        icmp[3] = cs & 0xff;

        this.send({ dst: original.src, protocol: 1, payload: icmp });
    }

    /**
     * Send an ICMPv6 error message in response to an incoming IPv6 packet.
     * @param {IPv6Packet} original
     * @param {number} type
     * @param {number} code
     * @param {number} [pointer] For Type 4 (Parameter Problem): byte offset of the offending field.
     */
    _sendICMPv6Error(original, type, code, pointer = 0) {
        if (!(original instanceof IPv6Packet)) return;

        const src = original.src;
        if (this._isZero(src)) return;

        // Don't reply to ICMPv6 error messages, only to echo requests (type 128)
        if (original.nextHeader === 58) {
            const icmpType = original.payload?.[0];
            if (icmpType !== 128) return;
        }

        // Don't reply to multicast destinations
        if (src.toUInt8()[0] === 0xff) return;

        // Body: 4-byte field (unused for Type 1/3; pointer for Type 4) + original packet (max 1232 bytes)
        const origBytes = original.pack();
        const quotedLen = Math.min(origBytes.length, 1232);
        const body = new Uint8Array(4 + quotedLen);
        write32BE(body, 0, pointer);
        body.set(origBytes.slice(0, quotedLen), 4);

        const mySrc = this._pickSrcIpV6(src);
        const icmpBytes = new ICMPv6Packet({ type, code, body }).pack(mySrc, src);

        this.send6({ dst: src, src: mySrc, nextHeader: 58, payload: icmpBytes });
    }

    /**
     * @param {IPv4Packet} packet
     */
    _handleICMP(packet) {
        const icmp = ICMPPacket.fromBytes(packet.payload);
        const ip_src = packet.src;
        const ip_dst = packet.dst;

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

                simTimer.cancel(pending.timerId);
                this._pendingEcho.delete(key);

                pending.resolve({
                    bytes: packet.payload?.length ?? 0,
                    ttl: packet.ttl ?? 64,
                    identifier: id,
                    sequence: seq,
                    timeMs: 0,
                    from: remote,
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

            case 11: { // Time Exceeded — used by traceroute
                // Payload = quoted original IP header + first 8 bytes of original datagram
                const q = icmp.payload;
                if (!q || q.length < 8) break;

                const origIhl = (q[0] & 0x0f) * 4;
                if (q.length < origIhl + 8) break;

                // Original destination from quoted IP header (bytes 16-19)
                const origDst = IPAddress.fromUInt8(q.slice(16, 20));

                // Original ICMP identifier and sequence (bytes ihl+4..ihl+7)
                const origId  = (q[origIhl + 4] << 8) | q[origIhl + 5];
                const origSeq = (q[origIhl + 6] << 8) | q[origIhl + 7];

                const key = this._icmpEchoKey(origDst, origId, origSeq);
                const pending = this._pendingEcho.get(key);
                if (!pending) break;

                simTimer.cancel(pending.timerId);
                this._pendingEcho.delete(key);

                const err = new Error("ttl-exceeded");
                /** @type {any} */ (err).from = ip_src;
                pending.reject(err);
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
            case 47:
                this._handleGRE(packet);
                break;
            default:
                this._sendICMPError(packet, 3, 2); // Protocol Unreachable
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
            dst,
            src,
            protocol,
            payload,
            ttl
        });

        console.debug("IP OUT", { dst: dst.toString(), src: src.toString(), protocol, ttl: packet.ttl, payloadLen: payload.length });

        this.route(packet, true).catch(console.error);
    }

    // ── GRE tunnel ────────────────────────────────────────────────────────────

    /**
     * @param {IPv4Packet} innerPacket
     * @param {TunnelConfig} tunnel
     */
    async _forwardGRE(innerPacket, tunnel) {
        const gre = new GREPacket({ protocol: 0x0800, payload: innerPacket.pack() });
        await this.send({ dst: tunnel.remoteEndpoint, protocol: 47, payload: gre.pack() });
    }

    /** @param {IPv4Packet} outerPacket */
    _handleGRE(outerPacket) {
        try {
            const gre = GREPacket.fromBytes(outerPacket.payload);
            if (gre.protocol !== 0x0800) return; // only IPv4-in-GRE supported
            const inner = IPv4Packet.fromBytes(gre.payload);
            this.route(inner, false).catch(console.error);
        } catch (e) {
            console.warn("GRE decap error", e);
        }
    }

    /**
     * Add a named GRE tunnel endpoint.
     * @param {string} name
     * @param {IPAddress|string} remoteEndpoint
     * @returns {TunnelConfig}
     */
    addTunnel(name, remoteEndpoint) {
        if (this.tunnels.some(t => t.name === name))
            throw new Error(`Tunnel "${name}" already exists`);
        const tun = new TunnelConfig();
        tun.name = String(name);
        tun.remoteEndpoint = (remoteEndpoint instanceof IPAddress)
            ? remoteEndpoint
            : IPAddress.fromString(String(remoteEndpoint));
        this.tunnels.push(tun);
        return tun;
    }

    /**
     * Remove a tunnel and all routes associated with it.
     * @param {string} name
     */
    removeTunnel(name) {
        this.routingTable = this.routingTable.filter(r => !r.tunnel || r.tunnel.name !== name);
        this.tunnels = this.tunnels.filter(t => t.name !== name);
    }

    /**
     * Add a route that forwards matching traffic into a named tunnel.
     * @param {IPAddress|string} dst
     * @param {number} prefixLength
     * @param {string} tunnelName
     */
    addTunnelRoute(dst, prefixLength, tunnelName) {
        const tun = this.tunnels.find(t => t.name === tunnelName);
        if (!tun) throw new Error(`Tunnel "${tunnelName}" not found`);
        const r = new Route();
        r.dst = (dst instanceof IPAddress) ? dst : IPAddress.fromString(String(dst));
        r.prefixLength = prefixLength | 0;
        r.interf = -2;
        r.nexthop = IPAddress.fromString("0.0.0.0");
        r.auto = false;
        r.tunnel = tun;
        this.routingTable.push(r);
    }

    /**
     * @param {IPAddress|string} dst
     * @param {number} prefixLength
     * @param {string} tunnelName
     */
    delTunnelRoute(dst, prefixLength, tunnelName) {
        const dstStr = (dst instanceof IPAddress) ? dst.toString() : String(dst);
        this.routingTable = this.routingTable.filter(r =>
            !(r.tunnel?.name === tunnelName &&
              r.dst.toString() === dstStr &&
              r.prefixLength === (prefixLength | 0))
        );
    }

    /**
     * Configure an interface.
     * Pass opts.ip to set the IPv4 address (or 0.0.0.0 to disable).
     * Pass opts.ip6 to set the IPv6 address (or null to disable).
     * @param {Number} [i]
     * @param {Object} [opts]
     * @param {IPAddress|string} [opts.ip]
     * @param {number} [opts.prefixLength]
     * @param {String} [opts.name]
     * @param {IPAddress|string|null} [opts.ip6]
     * @param {number} [opts.prefixLength6]
     * @param {boolean} [opts.raEnabled]
     * @param {boolean} [opts.slaac]
     */
    configureInterface(i = 0, opts = {}) {
        if (this.interfaces[i] == null) return;

        if (opts.ip !== undefined) {
            const ip = (opts.ip instanceof IPAddress)
                ? opts.ip
                : IPAddress.fromString(String(opts.ip ?? "0.0.0.0"));
            const prefixLength = (opts.prefixLength ?? (ip.isV4() ? 24 : 64)) | 0;
            this.interfaces[i].configure({
                name: opts.name ?? this.interfaces[i].name,
                ip,
                prefixLength,
            });
        } else if (opts.name !== undefined) {
            this.interfaces[i].name = String(opts.name);
        }

        if ('ip6' in opts || 'slaac' in opts) {
            this.interfaces[i].configure6({ ip6: opts.ip6, prefixLength6: opts.prefixLength6, slaac: opts.slaac });
        }

        if ('raEnabled' in opts) {
            const itf = this.interfaces[i];
            itf.raEnabled = !!opts.raEnabled;
            if (itf.raEnabled && itf.ip6) this._startRATimer(i);
            else                          this._stopRATimer(i);
        }

        this._updateAutoRoutes();
    }

    update() {
        // Detect ip6 changes (SLAAC activation or manual DAD completion) and sync routes/RA timers
        for (let i = 0; i < this.interfaces.length; i++) {
            const current = this.interfaces[i].ip6?.toString() ?? null;
            if (current !== (this._lastKnownIp6.get(i) ?? null)) {
                this._lastKnownIp6.set(i, current);
                this._updateAutoRoutes();
                if (this.interfaces[i].raEnabled) {
                    if (current !== null) this._startRATimer(i);
                    else                  this._stopRATimer(i);
                }
            }
        }

        for (let i = 0; i < this.interfaces.length; i++) {
            const packet = this.interfaces[i].getNextPacket();
            if (packet == null) continue;
            if (packet instanceof IPv6Packet) {
                this.routeV6(packet, false, i);
            } else {
                this.route(packet, false, i);
            }
        }

        this.doUpdate();
    }

    /**
     * Route an incoming or locally generated IPv6 packet.
     * @param {IPv6Packet} packet
     * @param {boolean} internal
     * @param {number} recvIfIndex  interface the packet arrived on (-1 = locally generated)
     */
    async routeV6(packet, internal = false, recvIfIndex = -1) {
        const dst = packet.dst;

        // Is it for one of our IPv6 interfaces (global or link-local)?
        for (let i = 0; i < this.interfaces.length; i++) {
            const itf = this.interfaces[i];
            if ((itf.ip6   && itf.ip6.toString()   === dst.toString()) ||
                (itf.ip6LL && itf.ip6LL.toString() === dst.toString())) {
                this.acceptV6(packet, i);
                return;
            }
        }

        // IPv6 multicast (ff00::/8)
        if (dst.toUInt8()[0] === 0xff) {
            if (internal) {
                // Locally generated multicast: send on all interfaces using 33:33:xx:xx:xx:xx MAC
                const dstBytes = dst.toUInt8();
                const mac = new Uint8Array([0x33, 0x33, dstBytes[12], dstBytes[13], dstBytes[14], dstBytes[15]]);
                for (const itf of this.interfaces) {
                    itf.sendFrame(mac, 0x86DD, packet.pack());
                }
            }
            // Also deliver locally (e.g. for RS/RA handling)
            this.acceptV6(packet, recvIfIndex);
            return;
        }

        // RFC 4007: link-local addresses are interface-scoped.
        // When dst is fe80::/10, resolve the interface via recvIfIndex (reply path)
        // or by searching the neighbor cache (locally-generated traffic).
        const dstBytes = dst.toUInt8();
        if (dstBytes[0] === 0xfe && (dstBytes[1] & 0xc0) === 0x80) {
            let ifIdx = recvIfIndex >= 0 ? recvIfIndex : -1;
            if (ifIdx < 0) {
                const key = dst.toString();
                for (let i = 0; i < this.interfaces.length; i++) {
                    if (this.interfaces[i].neighborCache.has(key)) { ifIdx = i; break; }
                }
            }
            if (ifIdx >= 0) {
                if (!internal && !this.forwarding) return;
                if (!internal) {
                    packet.hopLimit = (packet.hopLimit - 1) & 0xff;
                    if (packet.hopLimit === 0) { this._sendICMPv6Error(packet, 3, 0); return; }
                }
                const mac = await this.interfaces[ifIdx].resolveNeighbor(dst);
                if (mac == null) return;
                this.interfaces[ifIdx].sendFrame(mac, 0x86DD, packet.pack());
                return;
            }
            // No interface found for this link-local destination — fall through to normal routing
        }

        const out = this._resolveOutgoing(dst);
        if (!out) {
            if (!internal) this._sendICMPv6Error(packet, 1, 0); // No route to destination (RFC 4443 §3.1)
            return;
        }

        if (out.interfIndex === -1) {
            this.acceptV6(packet);
            return;
        }

        if (!internal && !this.forwarding) return;

        if (!internal) {
            packet.hopLimit = (packet.hopLimit - 1) & 0xff;
            if (packet.hopLimit === 0) {
                this._sendICMPv6Error(packet, 3, 0);
                return;
            }
        }

        const interf = this.interfaces[out.interfIndex];
        const nh = this._isZero(out.route.nexthop) ? dst : out.route.nexthop;

        const mac = await interf.resolveNeighbor(nh);
        if (mac == null) return;
        interf.sendFrame(mac, 0x86DD, packet.pack());
    }

    /**
     * Accept and dispatch a locally destined IPv6 packet.
     * @param {IPv6Packet} packet
     * @param {number} recvIfIndex  interface the packet arrived on (-1 = locally generated)
     */
    acceptV6(packet, recvIfIndex = -1) {
        switch (packet.nextHeader) {
            case 58:  this._handleICMPv6(packet, recvIfIndex); break;
            case 17:  this._handleUDP(packet);    break;
            case 6:   this.tcp.handle(packet);    break;
            default:
                // RFC 4443 §3.4: Type 4 Code 1 – unrecognized Next Header; pointer = offset 6
                this._sendICMPv6Error(packet, 4, 1, 6);
                console.debug(this.name + ": IPv6 unknown nextHeader=" + packet.nextHeader);
        }
    }

    /**
     * @param {IPv6Packet} packet
     * @param {number} recvIfIndex
     */
    _handleICMPv6(packet, recvIfIndex = -1) {
        /** @type {ICMPv6Packet} */
        let icmp6;
        try {
            icmp6 = ICMPv6Packet.fromBytes(packet.payload);
        } catch (e) {
            console.warn(this.name + ": ICMPv6 parse error", e);
            return;
        }

        const srcIp = packet.src;
        const dstIp = packet.dst;

        switch (icmp6.type) {
            case 133: { // Router Solicitation → unicast RA back to soliciting host
                if (recvIfIndex >= 0 && this.interfaces[recvIfIndex]?.raEnabled) {
                    this._sendRA(recvIfIndex, this._isZero(srcIp) ? null : srcIp);
                }
                break;
            }
            case 128: { // Echo Request → send Reply
                const replyBytes = ICMPv6Packet.buildEchoReply(
                    icmp6.identifier, icmp6.sequence, icmp6.echoPayload
                ).pack(dstIp, srcIp);
                this.send6({ dst: srcIp, src: dstIp, nextHeader: 58, payload: replyBytes });
                break;
            }
            case 129: { // Echo Reply → resolve pending ping6
                const key = this._icmpv6EchoKey(srcIp, icmp6.identifier, icmp6.sequence);
                const pending = this._pendingEcho6.get(key);
                if (!pending) break;
                simTimer.cancel(pending.timerId);
                this._pendingEcho6.delete(key);
                pending.resolve({
                    bytes:      packet.payload?.length ?? 0,
                    ttl:        packet.hopLimit ?? 64,
                    identifier: icmp6.identifier,
                    sequence:   icmp6.sequence,
                    timeMs:     0,
                    from:       srcIp,
                });
                break;
            }
            case 3: { // Time Exceeded — used by traceroute
                // body: 4 unused bytes + quoted original IPv6 packet
                const q = icmp6.body;
                if (!q || q.length < 4 + 48) break; // need IPv6 hdr (40) + ICMPv6 hdr (8)

                // Original destination: bytes 4+24 .. 4+39 of body
                const origDst = IPAddress.fromUInt8(q.slice(28, 44));

                // Original ICMPv6: starts at body[4+40] = body[44]
                const origId  = (q[48] << 8) | q[49];
                const origSeq = (q[50] << 8) | q[51];

                const key = this._icmpv6EchoKey(origDst, origId, origSeq);
                const pending = this._pendingEcho6.get(key);
                if (!pending) break;

                simTimer.cancel(pending.timerId);
                this._pendingEcho6.delete(key);

                const err = new Error("ttl-exceeded");
                /** @type {any} */ (err).from = srcIp;
                pending.reject(err);
                break;
            }
            default:
                console.debug(this.name + ": ICMPv6 unhandled type=" + icmp6.type);
        }
    }

    /**
     * Create and send a locally generated IPv6 packet.
     * @param {Object} [opts]
     * @param {IPAddress} [opts.dst]
     * @param {IPAddress} [opts.src]
     * @param {number}    [opts.nextHeader]
     * @param {number}    [opts.hopLimit]
     * @param {Uint8Array}[opts.payload]
     */
    send6(opts = {}) {
        const dst = opts.dst ?? IPAddress.fromString("::");
        let   src = opts.src ?? IPAddress.fromString("::");

        if (this._isZero(src)) src = this._pickSrcIpV6(dst);

        const nextHeader = opts.nextHeader ?? 59;
        const hopLimit   = opts.hopLimit   ?? 64;
        const payload    = opts.payload    ?? new Uint8Array();

        const packet = new IPv6Packet({ dst, src, nextHeader, hopLimit, payload });

        console.debug("IPv6 OUT", { dst: dst.toString(), src: src.toString(), nextHeader });

        this.routeV6(packet, true).catch(console.error);
    }

    /**
     * Pick a source IPv6 address for locally generated traffic.
     * @param {IPAddress} dstIp
     * @returns {IPAddress}
     */
    _pickSrcIpV6(dstIp) {
        const dstBytes = dstIp.toUInt8();
        const isLL = (dstBytes[0] === 0xfe && (dstBytes[1] & 0xc0) === 0x80);

        const out = this._resolveOutgoing(dstIp);
        if (out && out.interfIndex !== -1) {
            const itf = this.interfaces[out.interfIndex];
            if (itf) {
                if (isLL && itf.ip6LL && !this._isZero(itf.ip6LL)) return itf.ip6LL;
                if (itf.ip6 && !this._isZero(itf.ip6)) return itf.ip6;
                if (itf.ip6LL && !this._isZero(itf.ip6LL)) return itf.ip6LL;
            }
        }
        for (const itf of this.interfaces) {
            if (isLL && itf.ip6LL && !this._isZero(itf.ip6LL)) return itf.ip6LL;
            if (!isLL && itf.ip6 && !this._isZero(itf.ip6)) return itf.ip6;
            if (itf.ip6LL && !this._isZero(itf.ip6LL)) return itf.ip6LL;
        }
        return IPAddress.fromString("::");
    }

    /**
     * Send an ICMPv6 Echo Request and wait for the reply (ping6).
     * @param {IPAddress} dstIp
     * @param {{timeoutMs?:number, payload?:Uint8Array, identifier?:number, sequence?:number, ttl?:number}} [opt]
     * @returns {Promise<{bytes:number, ttl:number, timeMs:number, identifier:number, sequence:number}>}
     */
    async icmpv6Echo(dstIp, opt = {}) {
        const timeoutSimMs = opt.timeoutMs ?? SimTimer.PING_TIMEOUT_MS;
        const identifier = opt.identifier ?? (this._nextIcmpId = (this._nextIcmpId + 1) & 0xffff);
        const sequence   = opt.sequence   ?? (Math.random() * 0xffff) | 0;
        const payload    = opt.payload    ?? new Uint8Array(32);

        const srcIp = this._pickSrcIpV6(dstIp);
        const key   = this._icmpv6EchoKey(dstIp, identifier, sequence);
        const t0    = (typeof performance !== "undefined" ? performance.now() : Date.now());

        return new Promise((resolve, reject) => {
            const timerId = simTimer.schedule(() => {
                this._pendingEcho6.delete(key);
                reject(new Error("timeout"));
            }, timeoutSimMs);

            this._pendingEcho6.set(key, { resolve, reject, timerId, t0 });

            const icmpBytes = ICMPv6Packet.buildEchoRequest(identifier, sequence, payload)
                .pack(srcIp, dstIp);

            this.send6({ dst: dstIp, src: srcIp, nextHeader: 58, payload: icmpBytes, hopLimit: opt.ttl });
        }).then((r) => {
            const t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
            return { .../** @type {any} */ (r), timeMs: Math.max(0, Math.round(t1 - t0)) };
        });
    }

    /**
     * @param {IPAddress} dst
     * @param {number} id
     * @param {number} seq
     * @returns {string}
     */
    _icmpv6EchoKey(dst, id, seq) {
        return `v6|${dst.toString()}|${id}|${seq}`;
    }

    /**
     * Send a Router Advertisement on the given interface (RFC 4861 §6).
     * @param {number} interfIndex
     * @param {IPAddress|null} [unicastDst]  unicast target; null → ff02::1 (all nodes)
     */
    _sendRA(interfIndex, unicastDst = null) {
        const itf = this.interfaces[interfIndex];
        if (!itf?.ip6 || !itf.ip6LL) return;

        // Compute network prefix by zeroing host bits
        const ip6bytes = itf.ip6.toUInt8();
        const netBytes = new Uint8Array(16);
        let rem = itf.prefixLength6 | 0;
        for (let b = 0; b < 16; b++) {
            if      (rem >= 8) { netBytes[b] = ip6bytes[b]; rem -= 8; }
            else if (rem >  0) { netBytes[b] = ip6bytes[b] & (0xff << (8 - rem)) & 0xff; rem = 0; }
        }
        const prefix = new IPAddress(6, netBytes);

        const ra = ICMPv6Packet.buildRA({
            hopLimit: 64,
            routerLifetime: 1800,
            prefix,
            prefixLength: itf.prefixLength6,
        });

        const dst    = unicastDst ?? IPAddress.fromString("ff02::1");
        const dstMac = unicastDst
            ? (itf.neighborCache.get(itf._ipKey(unicastDst)) ?? new Uint8Array([0x33, 0x33, 0, 0, 0, 1]))
            : new Uint8Array([0x33, 0x33, 0, 0, 0, 1]); // ff02::1

        const ipv6pkt = new IPv6Packet({
            src: itf.ip6LL,
            dst,
            nextHeader: 58,
            hopLimit: 255,
            payload: ra.pack(itf.ip6LL, dst),
        });
        itf.sendFrame(dstMac, 0x86DD, ipv6pkt.pack());
    }

    /**
     * Start periodic unsolicited RAs on an interface.
     * @param {number} interfIndex
     */
    _startRATimer(interfIndex) {
        this._stopRATimer(interfIndex);
        const tick = () => {
            this._sendRA(interfIndex);
            this._raTimers.set(interfIndex, simTimer.schedule(tick, SimTimer.RA_INTERVAL_MS));
        };
        this._raTimers.set(interfIndex, simTimer.schedule(tick, SimTimer.RA_INITIAL_DELAY_MS));
    }

    /**
     * Cancel periodic RAs on an interface.
     * @param {number} interfIndex
     */
    _stopRATimer(interfIndex) {
        const id = this._raTimers.get(interfIndex);
        if (id != null) {
            simTimer.cancel(id);
            this._raTimers.delete(interfIndex);
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

        for (let i = 0; i < this.interfaces.length; i++) {
            const itf = this.interfaces[i];

            if (itf.ip.isV4()) {
                const ip32  = this._v4n(itf.ip);
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

            if (itf.ip6 != null && !this._isZero(itf.ip6)) {
                // Zero out host bits to get network address
                const bytes = itf.ip6.toUInt8();
                const netBytes = new Uint8Array(16);
                let rem = itf.prefixLength6 | 0;
                for (let b = 0; b < 16 && rem > 0; b++) {
                    if (rem >= 8) { netBytes[b] = bytes[b]; rem -= 8; }
                    else          { netBytes[b] = bytes[b] & (0xff << (8 - rem)) & 0xff; rem = 0; }
                }

                const r6c = new Route();
                r6c.dst = new IPAddress(6, netBytes);
                r6c.prefixLength = itf.prefixLength6 | 0;
                r6c.interf = i;
                r6c.nexthop = IPAddress.fromString("::");
                r6c.auto = true;
                this.routingTable.push(r6c);
            }

            if (itf.ip6LL) {
                const rLL = new Route();
                rLL.dst = IPAddress.fromString("fe80::");
                rLL.prefixLength = 64;
                rLL.interf = i;
                rLL.nexthop = IPAddress.fromString("::");
                rLL.auto = true;
                this.routingTable.push(rLL);
            }
        }

        // IPv4 loopback
        const r4 = new Route();
        r4.dst = IPAddress.fromString("127.0.0.0");
        r4.prefixLength = 8;
        r4.interf = -1;
        r4.nexthop = IPAddress.fromString("0.0.0.0");
        r4.auto = true;
        this.routingTable.push(r4);

        // IPv6 loopback (::1/128)
        const r6 = new Route();
        r6.dst = IPAddress.fromString("::1");
        r6.prefixLength = 128;
        r6.interf = -1;
        r6.nexthop = IPAddress.fromString("::");
        r6.auto = true;
        this.routingTable.push(r6);
    }

    /** @param {number} i */
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
                ip6: itf.ip6?.toString?.() ?? null,
                prefixLength6: itf.prefixLength6 ?? 0,
                ip6LL: itf.ip6LL?.toString?.() ?? null,
                raEnabled: !!itf.raEnabled,
                ...(itf instanceof VLANSubInterface
                    ? { vid: itf.vid, parentName: itf._parentIface.name }
                    : {}),
            })),

            tunnels: this.tunnels.map(t => ({
                name: t.name,
                remoteEndpoint: t.remoteEndpoint.toString(),
            })),

            routes: this.routingTable
                .filter(r => !r.auto)
                .map(r => ({
                    dst: r.dst.toString(),
                    prefixLength: r.prefixLength,
                    interf: r.interf,
                    nexthop: r.nexthop.toString(),
                    ...(r.tunnel ? { tunnel: r.tunnel.name } : {}),
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

        // Pass 1: create regular interfaces
        stack.interfaces = [];
        for (let i = 0; i < ifs.length; i++) {
            const row = ifs[i] ?? {};
            if (row.vid != null) continue; // subinterfaces in pass 2
            const name = String(row.name ?? `eth${i}`);
            const interf = new NetworkInterface({ name });
            stack.interfaces.push(interf);
            interf.subscribe(stack);
        }

        // Pass 2: create VLAN subinterfaces (parent must already exist)
        for (let i = 0; i < ifs.length; i++) {
            const row = ifs[i] ?? {};
            if (row.vid == null) continue;
            try {
                stack.addSubInterface(String(row.parentName), Number(row.vid));
            } catch (e) {
                console.warn("IPStack.fromJSON: could not restore subinterface", row, e);
            }
        }

        // configure ip/prefix for all interfaces (regular + sub)
        for (let i = 0; i < stack.interfaces.length; i++) {
            const itf = stack.interfaces[i];
            const row = ifs.find((/** @type {any} */ r) => r?.name === itf.name) ?? {};
            const ip = IPAddress.fromString(String(row.ip ?? "0.0.0.0"));
            const prefixLength = Number(row.prefixLength ?? (ip.isV4() ? 24 : 64));
            stack.configureInterface(i, { name: itf.name, ip, prefixLength });

            if (row.ip6) {
                try {
                    const ip6 = IPAddress.fromString(String(row.ip6));
                    const prefixLength6 = Number(row.prefixLength6 ?? 64);
                    stack.configureInterface(i, { ip6, prefixLength6 });
                } catch (e) {
                    console.warn("IPStack.fromJSON: invalid ip6 for interface", i, e);
                }
            }

            if (row.raEnabled) {
                stack.configureInterface(i, { raEnabled: true });
            }
        }

        // rebuild auto routes
        stack._updateAutoRoutes();

        // restore tunnels
        for (const tj of (Array.isArray(json.tunnels) ? json.tunnels : [])) {
            try {
                stack.addTunnel(String(tj.name ?? ""), IPAddress.fromString(String(tj.remoteEndpoint ?? "0.0.0.0")));
            } catch (e) {
                console.warn("IPStack.fromJSON: could not restore tunnel", tj, e);
            }
        }

        // restore manual routes
        const routes = Array.isArray(json.routes) ? json.routes : [];
        for (const rr of routes) {
            if (!rr || typeof rr !== "object") continue;

            if (rr.tunnel) {
                // tunnel route
                try {
                    const dst = IPAddress.fromString(String(rr.dst ?? "0.0.0.0"));
                    const prefixLength = Number(rr.prefixLength ?? 32);
                    stack.addTunnelRoute(dst, prefixLength, String(rr.tunnel));
                } catch (e) {
                    console.warn("IPStack.fromJSON: could not restore tunnel route", rr, e);
                }
                continue;
            }

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

    /** @type {TunnelConfig|null} set for GRE tunnel routes */
    tunnel = null;
}
