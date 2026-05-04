//@ts-check

import { EthernetPort } from "./EthernetPort.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { isEqualUint8, prefixToNetmask } from "../lib/helpers.js";
import { ArpPacket } from "../net/pdu/ArpPacket.js";
import { Observable } from "../lib/Observeable.js";
import { simTimer, SimTimer } from "../sim/SimTimer.js";
import { IPv4Packet } from "../net/pdu/IPv4Packet.js";
import { IPv6Packet } from "../net/pdu/IPv6Packet.js";
import { ICMPv6Packet } from "../net/pdu/ICMPv6Packet.js";
import { IPAddress } from "./models/IPAddress.js";

/**
 * This class simulates an "IP endpoint".
 * IPv6-ready design:
 * - IP is an IPAddress (v4/v6)
 * - subnet is represented by prefixLength
 * - address resolution is "neighbor resolution" (ARP for v4, NDP for v6 later)
 */
export class NetworkInterface extends Observable {

    /** @type {Uint8Array} */
    mac;

    /** @type {EthernetPort} */
    port;

    /** @type {IPAddress} */
    ip = IPAddress.fromString("0.0.0.0");

    /** @type {number} */
    prefixLength = 0;

    /** @type {IPAddress|null} */
    ip6 = null;

    /** @type {number} */
    prefixLength6 = 0;

    /** @type {IPAddress|null} Link-local address derived from MAC (EUI-64), always set */
    ip6LL = null;

    /**
     * Neighbor cache: ipKey -> mac
     * (IPv4: ARP cache, IPv6: NDP neighbor cache later)
     * @type {Map<string, Uint8Array>}
     */
    neighborCache = new Map();

    /** @type {String} */
    name = '';

    /**
     * Queue of accepted L3 packets.
     * IPv6-ready: later you can store IPv6 packets too (union type).
     * @type {Array<any>}
     */
    inQueue = [];

    /**
     * Track running neighbor resolvers by ip key
     * @type {Array<string>}
     */
    _activeNeighborResolvers = [];

    /** @type {Set<string>} ip keys of addresses currently undergoing DAD */
    _dadPending = new Set();

    /** @type {Set<string>} ip keys where a DAD conflict was detected */
    _dadConflicts = new Set();

    /**
     * @param {Object} [opts]
     * @param {IPAddress} [opts.ip]
     * @param {number} [opts.prefixLength]
     * @param {String} [opts.name]
     */
    constructor(opts = {}) {
        super();

        // Generate a random MAC-Address for this interface
        this.mac = new Uint8Array(6);
        this.mac[0] = 0xAA; // private use MAC; does not collide with "real" ones
        for (let i = 1; i < 6; i++) {
            this.mac[i] = Math.floor(Math.random() * 256);
        }

        // @ts-ignore // KleC: aktuell wird toHex() nicht als gültige Funktion erkannt. Im Firefox geht es.
        this.name = (opts.name ?? 'enx' + this.mac.toHex());
        this.port = new EthernetPort(this.name);
        this.port.subscribe(this);

        this._assignLinkLocal();
        this.configure(opts);
    }

    /**
     * @param {Object} [opts]
     * @param {IPAddress} [opts.ip]
     * @param {number} [opts.prefixLength]
     * @param {String} [opts.name]
     */
    configure(opts = {}) {
        if (opts.name) this.name = String(opts.name);

        this.ip = (opts.ip ?? IPAddress.fromString("192.168.0.10"));

        // Default prefixes (common sane defaults)
        const defPrefix = this.ip.isV4() ? 24 : 64;
        this.prefixLength = (opts.prefixLength ?? defPrefix) | 0;

        if (this.ip.isV4()) {
            if (this.prefixLength < 0 || this.prefixLength > 32) {
                throw new Error(`Invalid IPv4 prefixLength ${this.prefixLength}`);
            }
        } else if (this.ip.isV6()) {
            if (this.prefixLength < 0 || this.prefixLength > 128) {
                throw new Error(`Invalid IPv6 prefixLength ${this.prefixLength}`);
            }
        } else {
            throw new Error("Unknown IP version");
        }

        // Clear neighbor cache and add our own entries
        this.neighborCache = new Map();
        this.neighborCache.set(this._ipKey(this.ip), this.mac);
        if (this.ip6) this.neighborCache.set(this._ipKey(this.ip6), this.mac);
        if (this.ip6LL) this.neighborCache.set(this._ipKey(this.ip6LL), this.mac);

        // Clear queues
        this.inQueue = [];
    }

    /**
     * Configure the IPv6 address on this interface. Pass ip6=null to disable IPv6.
     * Runs DAD (RFC 4862 §5.4) asynchronously; ip6 is activated only if no conflict.
     * @param {Object} [opts]
     * @param {IPAddress|string|null} [opts.ip6]
     * @param {number} [opts.prefixLength6]
     */
    configure6(opts = {}) {
        if (this.ip6) this.neighborCache.delete(this._ipKey(this.ip6));
        this.ip6 = null;
        this._dadPending.clear();
        this._dadConflicts.clear();

        if (opts.ip6 == null) {
            this.prefixLength6 = 0;
            return;
        }

        const ip6 = (opts.ip6 instanceof IPAddress)
            ? opts.ip6
            : IPAddress.fromString(String(opts.ip6));
        if (!ip6.isV6()) throw new Error("configure6: expected IPv6 address");
        const pl = (opts.prefixLength6 ?? 64) | 0;
        if (pl < 0 || pl > 128) throw new Error(`Invalid IPv6 prefixLength ${pl}`);
        this.prefixLength6 = pl;

        this._runDAD(ip6).catch(e => console.warn(`${this.name}: DAD error`, e));
    }

    /**
     * Duplicate Address Detection (RFC 4862 §5.4).
     * Sends one NS from :: to the solicited-node multicast and waits DAD_PROBE_WAIT_MS.
     * Activates ip6 only if no NA/NS conflict is received within that window.
     * @param {IPAddress} ip6
     */
    async _runDAD(ip6) {
        const key = this._ipKey(ip6);
        this._dadPending.add(key);

        // RFC 4861 §4.3: src=::, no SLLA option when source address is unspecified
        const unspec     = IPAddress.fromString("::");
        const snMcast    = this._solicitedNodeMulticast(ip6);
        const snMcastMac = this._solicitedNodeMulticastMac(ip6);

        const ns = ICMPv6Packet.buildNS(ip6); // no srcMac → no SLLA
        const ipv6pkt = new IPv6Packet({
            src: unspec,
            dst: snMcast,
            nextHeader: 58,
            hopLimit: 255,
            payload: ns.pack(unspec, snMcast),
        });
        this.port.send(new EthernetFrame({
            dstMac: snMcastMac,
            srcMac: this.mac,
            etherType: 0x86DD,
            payload: ipv6pkt.pack(),
        }));

        await simTimer.sleep(SimTimer.DAD_PROBE_WAIT_MS);

        this._dadPending.delete(key);
        if (this._dadConflicts.has(key)) {
            this._dadConflicts.delete(key);
            console.warn(`${this.name}: DAD conflict for ${ip6} — address not assigned`);
            return;
        }

        this.ip6 = ip6;
        this.neighborCache.set(key, this.mac);
        this.doUpdate();
    }

    /**
     * Derive the link-local IPv6 address from this interface's MAC (EUI-64).
     * Result: fe80::/64 prefix + modified EUI-64 interface ID.
     * Called once in constructor; result never changes.
     */
    _assignLinkLocal() {
        const m = this.mac;
        const b = new Uint8Array(16);
        b[0] = 0xfe; b[1] = 0x80;
        // b[2..7] stay 0x00
        b[8]  = m[0] ^ 0x02;
        b[9]  = m[1];
        b[10] = m[2];
        b[11] = 0xff;
        b[12] = 0xfe;
        b[13] = m[3];
        b[14] = m[4];
        b[15] = m[5];
        this.ip6LL = new IPAddress(6, b);
    }

    /**
     * Optional helper: derive an IPv4 netmask number from prefixLength.
     * Useful while other code still wants a 32-bit netmask.
     * @returns {number} netmask as uint32 (IPv4 only)
     */
    getNetmaskV4Number() {
        if (!this.ip.isV4()) throw new Error("getNetmaskV4Number: not IPv4");
        return (prefixToNetmask(this.prefixLength) >>> 0);
    }

    /**
     * Key function for caches. Later you might switch to ip.toKey().
     * @param {IPAddress} ip
     * @returns {string}
     */
    _ipKey(ip) {
        return ip.toString();
    }

    update() {
        const frame = this.port.getNextIncomingFrame();
        if (frame == null) return;

        switch (frame.etherType) {
            case 0x0800:  // IPv4
                this._handleIPv4(IPv4Packet.fromBytes(frame.payload));
                break;

            case 0x0806:  // ARP (IPv4 only)
                this._handleARP(ArpPacket.fromBytes(frame.payload));
                break;

            case 0x8100:  // VLAN
                console.log("Unimplemented yet");
                break;

            case 0x86DD:   // IPv6
                try {
                    this._handleIPv6(IPv6Packet.fromBytes(frame.payload));
                } catch (e) {
                    console.warn("IPv6 parse error:", e);
                }
                break;

            default:
                console.log("Unimplemented etherType", frame.etherType);
        }
    }

    /**
     * @param {ArpPacket} packet
     */
    _handleARP(packet) {
        // ARP is IPv4 only
        if (packet.hlen !== 6 || packet.htype !== 1 || packet.plen !== 4 || packet.ptype !== 0x0800) {
            throw new Error("ARP not understood");
        }

        const spa = IPAddress.fromUInt8(packet.spa);
        const tpa = IPAddress.fromUInt8(packet.tpa);

        const spaKey = this._ipKey(spa);

        // ARP request
        if (packet.oper === 1) {
            // If we are the target: learn sender and respond
            if (this.ip.isV4() && this._ipKey(tpa) === this._ipKey(this.ip)) {
                this.neighborCache.set(spaKey, packet.sha);
                this._doArpResponse(spa);
            }
            return;
        }

        // ARP response
        if (packet.oper === 2) {
            this.neighborCache.set(spaKey, packet.sha);
            return;
        }

        throw new Error("ARP opcode not understood");
    }

    /**
     * @param {IPv4Packet} packet
     */
    _handleIPv4(packet) {
        this.inQueue.push(packet);
        this.doUpdate();
    }

    /**
     * @param {IPv6Packet} packet
     */
    _handleIPv6(packet) {
        // Intercept NDP (NS/NA) — handle like ARP, don't pass to IP stack
        if (packet.nextHeader === 58) {
            try {
                const icmp6 = ICMPv6Packet.fromBytes(packet.payload);
                if (icmp6.type === 135 || icmp6.type === 136) {
                    this._handleNDP(packet, icmp6);
                    return;
                }
            } catch { /* ignore parse errors */ }
        }
        this.inQueue.push(packet);
        this.doUpdate();
    }

    /**
     * Handle NDP Neighbor Solicitation (135) and Advertisement (136).
     * @param {IPv6Packet} ipv6
     * @param {ICMPv6Packet} icmp6
     */
    _handleNDP(ipv6, icmp6) {
        if (icmp6.type === 135) { // Neighbor Solicitation
            const target = icmp6.ndpTarget;
            if (!target) return;
            const key = this._ipKey(target);

            // Another node probing our tentative address → DAD conflict
            if (this._dadPending.has(key)) {
                this._dadConflicts.add(key);
                return;
            }

            const shouldRespond =
                (this.ip6LL && key === this._ipKey(this.ip6LL)) ||
                (this.ip6   && key === this._ipKey(this.ip6));
            if (shouldRespond) {
                const srcMac = icmp6.getLinkLayerAddress();
                if (srcMac) this.neighborCache.set(this._ipKey(ipv6.src), srcMac);
                this._doNDPNeighborAdvertisement(ipv6.src, srcMac, target);
            }
        } else if (icmp6.type === 136) { // Neighbor Advertisement
            const target = icmp6.ndpTarget;
            const mac    = icmp6.getLinkLayerAddress();
            if (target) {
                const key = this._ipKey(target);
                // Someone else owns our tentative address → DAD conflict
                if (this._dadPending.has(key)) {
                    this._dadConflicts.add(key);
                    return;
                }
                if (mac) this.neighborCache.set(key, mac);
            }
        }
    }

    /**
     * sends a (raw) ethernet frame
     * @param {Uint8Array} dstMac
     * @param {Number} etherType
     * @param {Uint8Array} payload
     */
    sendFrame(dstMac, etherType, payload) {
        const frame = new EthernetFrame({
            dstMac: dstMac,
            srcMac: this.mac,
            etherType: etherType,
            payload: payload
        });

        // loopback if for ourselves
        if (isEqualUint8(dstMac, this.mac)) {
            this.port.recieve(frame.pack());
            this.port.doUpdate();
            return;
        }

        this.port.send(frame);
    }

    // -------------------------------------------------------------------------
    // Neighbor resolution (IPv4: ARP, IPv6: NDP later)
    // -------------------------------------------------------------------------

    /**
     * Resolve L3 neighbor address to a MAC address.
     * IPv4 uses ARP. IPv6 will use NDP (TODO).
     * @param {IPAddress} ip
     * @returns {Promise<Uint8Array|null>}
     */
    async resolveNeighbor(ip) {
        if (ip.isV4()) return this._resolveArp(ip);
        if (ip.isV6()) return this._resolveNdp(ip);
        throw new Error("Unknown IP version");
    }

    /**
     * IPv4 neighbor resolution via ARP.
     * @param {IPAddress} ip
     * @returns {Promise<Uint8Array|null>}
     */
    async _resolveArp(ip) {
        if (!ip.isV4()) throw new Error("_resolveArp is IPv4-only");

        const key = this._ipKey(ip);
        let mac = this.neighborCache.get(key) ?? null;

        // Another resolver running?
        if (mac == null && this._activeNeighborResolvers.includes(key)) {
            let retries = 0;
            while (mac == null && retries < SimTimer.ARP_WAIT_RETRIES) {
                await simTimer.sleep(SimTimer.ARP_RETRY_DELAY_MS);
                mac = this.neighborCache.get(key) ?? null;
                retries++;
            }
            return mac;
        }

        // Start new resolver
        this._activeNeighborResolvers.push(key);

        let tries = 0;
        while (mac == null && tries < SimTimer.ARP_ATTEMPTS) {
            let retries = 0;
            this._doArpRequest(ip);

            while (mac == null && retries < SimTimer.ARP_RETRIES) {
                await simTimer.sleep(SimTimer.ARP_RETRY_DELAY_MS);
                mac = this.neighborCache.get(key) ?? null;
                retries++;
            }
            tries++;
        }

        // Remove resolver from active list
        this._activeNeighborResolvers = this._activeNeighborResolvers.filter(elem => elem !== key);
        return mac;
    }

    /**
     * IPv6 neighbor resolution via NDP (Neighbor Solicitation / Advertisement).
     * @param {IPAddress} ip
     * @returns {Promise<Uint8Array|null>}
     */
    async _resolveNdp(ip) {
        if (!ip.isV6()) throw new Error("NDP is IPv6-only");
        if (!this.ip6LL && !this.ip6) throw new Error("Interface has no IPv6 address configured");

        const key = this._ipKey(ip);
        let mac = this.neighborCache.get(key) ?? null;
        if (mac != null) return mac;

        if (this._activeNeighborResolvers.includes(key)) {
            let retries = 0;
            while (mac == null && retries < SimTimer.NDP_WAIT_RETRIES) {
                await simTimer.sleep(SimTimer.NDP_RETRY_DELAY_MS);
                mac = this.neighborCache.get(key) ?? null;
                retries++;
            }
            return mac;
        }

        this._activeNeighborResolvers.push(key);

        let tries = 0;
        while (mac == null && tries < SimTimer.NDP_ATTEMPTS) {
            let retries = 0;
            this._doNDPNeighborSolicitation(ip);
            while (mac == null && retries < SimTimer.NDP_RETRIES) {
                await simTimer.sleep(SimTimer.NDP_RETRY_DELAY_MS);
                mac = this.neighborCache.get(key) ?? null;
                retries++;
            }
            tries++;
        }

        this._activeNeighborResolvers = this._activeNeighborResolvers.filter(e => e !== key);
        return mac;
    }

    /**
     * Compute IPv6 solicited-node multicast address: ff02::1:ffXX:XXXX (last 24 bits of target).
     * @param {IPAddress} target
     * @returns {IPAddress}
     */
    _solicitedNodeMulticast(target) {
        const t = target.toUInt8();
        const b = new Uint8Array(16);
        b[0] = 0xff; b[1] = 0x02;
        b[11] = 0x01; b[12] = 0xff;
        b[13] = t[13]; b[14] = t[14]; b[15] = t[15];
        return new IPAddress(6, b);
    }

    /**
     * Multicast MAC for solicited-node address: 33:33:ff:XX:XX:XX.
     * @param {IPAddress} target
     * @returns {Uint8Array}
     */
    _solicitedNodeMulticastMac(target) {
        const t = target.toUInt8();
        return new Uint8Array([0x33, 0x33, 0xff, t[13], t[14], t[15]]);
    }

    /**
     * Send Neighbor Solicitation for target.
     * @param {IPAddress} target
     */
    _doNDPNeighborSolicitation(target) {
        const snMcast    = this._solicitedNodeMulticast(target);
        const snMcastMac = this._solicitedNodeMulticastMac(target);
        const srcIp = this.ip6LL ?? this.ip6;
        if (!srcIp) throw new Error("NDP requires an IPv6 address on the interface");

        const ns = ICMPv6Packet.buildNS(target, this.mac);
        const ipv6 = new IPv6Packet({
            src: srcIp,
            dst: snMcast,
            nextHeader: 58,
            hopLimit: 255,
            payload: ns.pack(srcIp, snMcast),
        });

        const frame = new EthernetFrame({
            dstMac: snMcastMac,
            srcMac: this.mac,
            etherType: 0x86DD,
            payload: ipv6.pack(),
        });

        this.port.send(frame);
    }

    /**
     * Send Neighbor Advertisement back to requester.
     * @param {IPAddress} dstIp
     * @param {Uint8Array|null} dstMac
     */
    _doNDPNeighborAdvertisement(dstIp, dstMac, /** @type {*} */ solicitedTarget = null) {
        const srcIp = this.ip6LL ?? this.ip6;
        if (!srcIp) return;
        const naTarget = solicitedTarget ?? srcIp;
        const na = ICMPv6Packet.buildNA(naTarget, this.mac, true);
        const ipv6 = new IPv6Packet({
            src: srcIp,
            dst: dstIp,
            nextHeader: 58,
            hopLimit: 255,
            payload: na.pack(srcIp, dstIp),
        });

        const dstMacBytes = dstMac ?? new Uint8Array([0x33, 0x33, 0, 0, 0, 1]);
        const frame = new EthernetFrame({
            dstMac: dstMacBytes,
            srcMac: this.mac,
            etherType: 0x86DD,
            payload: ipv6.pack(),
        });

        this.port.send(frame);
    }

    /**
     * generates an ARP request (IPv4 only)
     * @param {IPAddress} ip
     */
    _doArpRequest(ip) {
        if (!ip.isV4()) throw new Error("ARP is IPv4-only");
        if (!this.ip.isV4()) throw new Error("Cannot ARP from a non-IPv4 interface address");

        const packet = new ArpPacket({
            htype: 1,
            ptype: 0x0800,
            hlen: 6,
            plen: 4,
            oper: 1,
            sha: this.mac,
            spa: this.ip.toUInt8(), // 4 bytes
            tha: new Uint8Array([0, 0, 0, 0, 0, 0]),
            tpa: ip.toUInt8()       // 4 bytes
        });

        const frame = new EthernetFrame({
            dstMac: new Uint8Array([255, 255, 255, 255, 255, 255]),
            srcMac: this.mac,
            etherType: 0x0806,
            payload: packet.pack()
        });

        this.port.send(frame);
    }

    /**
     * generates an ARP response (IPv4 only)
     * @param {IPAddress} ip
     */
    _doArpResponse(ip) {
        if (!ip.isV4()) throw new Error("ARP is IPv4-only");
        if (!this.ip.isV4()) throw new Error("Cannot ARP from a non-IPv4 interface address");

        const mac = this.neighborCache.get(this._ipKey(ip));
        if (!mac) return; // can only respond to a known IP

        const packet = new ArpPacket({
            htype: 1,
            ptype: 0x0800,
            hlen: 6,
            plen: 4,
            oper: 2,
            sha: this.mac,
            spa: this.ip.toUInt8(),
            tha: mac,
            tpa: ip.toUInt8()
        });

        const frame = new EthernetFrame({
            dstMac: mac,
            srcMac: this.mac,
            etherType: 0x0806,
            payload: packet.pack()
        });

        this.port.send(frame);
    }

    // -------------------------------------------------------------------------
    // L3 sending (IPv4 implemented; IPv6 stub)
    // -------------------------------------------------------------------------

    /**
     * Send an IP packet (v4 implemented, v6 stub).
     * @param {Uint8Array} dstMac
     * @param {IPAddress} dstIP
     * @param {Number} protocol for v4: IPv4 protocol field; for v6 later: nextHeader
     * @param {Uint8Array} payload
     */
    async sendIPPacket(dstMac, dstIP, protocol, payload) {
        if (dstIP.isV4()) return this._sendIPv4(dstMac, dstIP, protocol, payload);
        if (dstIP.isV6()) return this._sendIPv6(dstMac, dstIP, protocol, payload);
        throw new Error("Unknown IP version");
    }

    /**
     * IPv4 sender.
     * @param {Uint8Array} dstMac
     * @param {IPAddress} dstIP
     * @param {Number} protocol
     * @param {Uint8Array} payload
     */
    async _sendIPv4(dstMac, dstIP, protocol, payload) {
        if (!dstIP.isV4()) throw new Error("_sendIPv4 requires IPv4 dst");
        if (!this.ip.isV4()) throw new Error("Interface has no IPv4 address configured");

        const packet = new IPv4Packet({
            dst: dstIP,
            src: this.ip,
            protocol: protocol,
            payload: payload
        });

        this.sendFrame(dstMac, 0x0800, packet.pack());
    }

    /**
     * @param {Uint8Array} dstMac
     * @param {IPAddress} dstIP
     * @param {Number} nextHeader
     * @param {Uint8Array} payload
     */
    _sendIPv6(dstMac, dstIP, nextHeader, payload) {
        if (!dstIP.isV6()) throw new Error("_sendIPv6 requires IPv6 dst");
        const dstBytes = dstIP.toUInt8();
        const isLLDst = (dstBytes[0] === 0xfe && (dstBytes[1] & 0xc0) === 0x80);
        const srcIp = (isLLDst ? (this.ip6LL ?? this.ip6) : this.ip6) ?? this.ip6LL;
        if (!srcIp) throw new Error("Interface has no IPv6 address configured");

        const packet = new IPv6Packet({
            dst: dstIP,
            src: srcIp,
            nextHeader,
            payload,
        });

        this.sendFrame(dstMac, 0x86DD, packet.pack());
    }

    /**
     * @returns {any|undefined}
     */
    getNextPacket() {
        return this.inQueue.shift();
    }
}
