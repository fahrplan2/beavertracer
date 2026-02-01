//@ts-check
import { UDPPacket } from "../net/pdu/UDPPacket.js";
import { IPAddress } from "./models/IPAddress.js";

/**
 * @typedef {{
 *   src: IPAddress,
 *   dst: IPAddress,
 *   srcPort: number,
 *   dstPort: number,
 *   payload: Uint8Array
 * }} UdpMessage
 */

export class UdpEngine {
    /**
     * @param {{
     *   ipSend: (opts: {dst:IPAddress, src:IPAddress, protocol:number, payload:Uint8Array}) => (void|Promise<void>),
     *   sendIcmpError?: (original: any, type:number, code:number) => void
     * }} deps
     */
    constructor(deps) {
        this._ipSend = deps.ipSend;
        this._sendIcmpError = deps.sendIcmpError ?? null;

        /** @type {Map<number, UDPSocket>} */
        this.sockets = new Map();
    }

    /**
     * Open a UDP socket.
     * @param {IPAddress} bindaddr currently must be 0.0.0.0
     * @param {number} port
     * @returns {number}
     */
    open(bindaddr, port) {
        if (this.sockets.get(port) != null) throw new Error("Port is in use");
        if (port <= 0 || port > 65535) throw new Error("Portnumber is not valid");
        if (bindaddr.toString() !== "0.0.0.0") throw new Error("Currently only bindings to 0.0.0.0 are supported");

        const socket = new UDPSocket();
        socket.port = port;
        socket.bindaddr = bindaddr;

        this.sockets.set(port, socket);
        return port;
    }

    /**
     * Close a UDP socket.
     * @param {number} port
     */
    close(port) {
        const socket = this.sockets.get(port);
        if (!socket) return;

        while (socket.waiters.length > 0) {
            const resolve = socket.waiters.shift();
            if (resolve) resolve(null);
        }
        this.sockets.delete(port);
    }

    destroyAll(reason = "udp shutdown") {
        // reason reserved for future logging
        const ports = Array.from(this.sockets.keys());
        for (const p of ports) this.close(p);
    }

    /**
     * Send UDP datagram.
     * @param {number} port local UDP socket port (source port)
     * @param {IPAddress} dstip destination IP
     * @param {number} dstport destination UDP port
     * @param {Uint8Array} data payload
     */
    async send(port, dstip, dstport, data) {
        const socket = this.sockets.get(port);
        if (!socket) throw new Error("Port not in use!");

        await this._ipSend({
            dst: dstip,
            src: socket.bindaddr,
            protocol: 17,
            payload: new UDPPacket({
                srcPort: socket.port,
                dstPort: dstport,
                payload: data,
            }).pack(),
        });
    }

    /**
     * Receive UDP message.
     * @param {number} port
     * @returns {Promise<UdpMessage|null>}
     */
    recv(port) {
        const socket = this.sockets.get(port);
        if (!socket) throw new Error("Port not in use!");
        if (socket.in.length > 0) return Promise.resolve(socket.in.shift() ?? null);
        return new Promise((resolve) => socket.waiters.push(resolve));
    }

    /**
     * Called by IPStack when a UDP IPv4Packet was accepted (protocol 17).
     * @param {any} packet IPv4Packet
     */
    handle(packet) {
        const datagram = UDPPacket.fromBytes(packet.payload);
        const socket = this.sockets.get(datagram.dstPort);

        if (!socket) {
            // RFC-ish: ICMP Destination Unreachable / Port Unreachable (Type 3 Code 3)
            if (this._sendIcmpError) this._sendIcmpError(packet, 3, 3);
            return;
        }

        /** @type {UdpMessage} */
        const msg = {
            src: IPAddress.fromUInt8(packet.src),
            dst: IPAddress.fromUInt8(packet.dst),
            srcPort: datagram.srcPort,
            dstPort: datagram.dstPort,
            payload: datagram.payload,
        };

        const resolve = socket.waiters.shift();
        if (resolve) resolve(msg);
        else socket.in.push(msg);
    }
}

export class UDPSocket {
    port = 0;

    /** @type {IPAddress} */
    bindaddr = IPAddress.fromString("0.0.0.0");

    /** @type {UdpMessage[]} */
    in = [];

    /** @type {Array<(value: UdpMessage | null) => void>} */
    waiters = [];
}
