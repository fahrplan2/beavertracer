//@ts-check

import { EthernetPort } from "./EthernetPort.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { sleep, isEqualUint8, prefixToNetmask } from "../lib/helpers.js";
import { ArpPacket } from "../net/pdu/ArpPacket.js";
import { Observable } from "../lib/Observeable.js";
import { SimControl } from "../SimControl.js";
import { IPv4Packet } from "../net/pdu/IPv4Packet.js";
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

        // Clear neighbor cache and add our own entry
        this.neighborCache = new Map();
        this.neighborCache.set(this._ipKey(this.ip), this.mac);

        // Clear queues
        this.inQueue = [];
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
                // TODO: implement IPv6Packet.fromBytes(...) and _handleIPv6(...)
                console.log("IPv6 received (not implemented yet)");
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
            while (mac == null && retries < 30) {
                await sleep(SimControl.tick);
                mac = this.neighborCache.get(key) ?? null;
                retries++;
            }
            return mac;
        }

        // Start new resolver
        this._activeNeighborResolvers.push(key);

        let tries = 0;
        while (mac == null && tries < 3) {
            let retries = 0;
            this._doArpRequest(ip);

            while (mac == null && retries < 10) {
                await sleep(SimControl.tick);
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
     * IPv6 neighbor resolution via NDP (not implemented yet).
     * @param {IPAddress} ip
     * @returns {Promise<Uint8Array|null>}
     */
    async _resolveNdp(ip) {
        // Hook for later:
        // - build Neighbor Solicitation (ICMPv6 type 135)
        // - send to solicited-node multicast
        // - wait for Neighbor Advertisement (type 136)
        throw new Error("IPv6 neighbor discovery (NDP) not implemented yet");
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
            dst: dstIP.toUInt8(),
            src: this.ip.toUInt8(),
            protocol: protocol,
            payload: payload
        });

        this.sendFrame(dstMac, 0x0800, packet.pack());
    }

    /**
     * IPv6 sender stub (not implemented yet).
     * @param {Uint8Array} dstMac
     * @param {IPAddress} dstIP
     * @param {Number} nextHeader
     * @param {Uint8Array} payload
     */
    async _sendIPv6(dstMac, dstIP, nextHeader, payload) {
        // TODO:
        // - create IPv6Packet(...)
        // - dst: dstIP.toUInt8() (16 bytes)
        // - src: this.ip.toUInt8() (16 bytes)
        // - nextHeader = nextHeader
        // - sendFrame(dstMac, 0x86DD, ipv6.pack())
        throw new Error("IPv6 send not implemented yet");
    }

    /**
     * @returns {any|undefined}
     */
    getNextPacket() {
        return this.inQueue.shift();
    }
}
