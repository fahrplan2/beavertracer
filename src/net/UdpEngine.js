//@ts-check
import { UDPPacket } from "../net/pdu/UDPPacket.js";
import { IPUInt8ToNumber } from "../lib/helpers.js";

/**
 * @typedef {{
 *   src: number,
 *   dst: number,
 *   srcPort: number,
 *   dstPort: number,
 *   payload: Uint8Array
 * }} UdpMessage
 */

export class UdpEngine {
    /**
     * @param {{
     *   ipSend: (opts: {dst:number, src:number, protocol:number, payload:Uint8Array}) => (void|Promise<void>),
     *   sendIcmpError?: (original: any, type:number, code:number) => void
     * }} deps
     */
    constructor(deps) {
        this._ipSend = deps.ipSend;
        this._sendIcmpError = deps.sendIcmpError ?? null;

        /** @type {Map<number, UDPSocket>} */
        this.sockets = new Map();
    }

    open(bindaddr, port) {
        if (this.sockets.get(port) != null) throw new Error("Port is in use");
        if (port <= 0 || port > 65535) throw new Error("Portnumber is not valid");
        if (bindaddr !== 0) throw new Error("Currently only bindings to 0.0.0.0 are supported");

        const socket = new UDPSocket();
        socket.port = port;
        socket.bindaddr = bindaddr;

        this.sockets.set(port, socket);
        return port;
    }

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

    async send(port, dstip, dstport, data) {
        const socket = this.sockets.get(port);
        if (!socket) throw new Error("Port not in use!");

        await this._ipSend({
            dst: dstip >>> 0,
            src: socket.bindaddr >>> 0,
            protocol: 17,
            payload: new UDPPacket({
                srcPort: socket.port,
                dstPort: dstport,
                payload: data,
            }).pack(),
        });
    }

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
            src: IPUInt8ToNumber(packet.src),
            dst: IPUInt8ToNumber(packet.dst),
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
    bindaddr = 0;

    /** @type {UdpMessage[]} */
    in = [];

    /** @type {Array<(value: UdpMessage | null) => void>} */
    waiters = [];
}
