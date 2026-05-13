//@ts-check
import { read16BE, write16BE } from "../util/byteUtils.js";

// RFC 2784 minimal GRE — fixed 4-byte header, no optional fields
// Byte 0-1: flags/version (0x0000), Byte 2-3: Protocol Type (0x0800 = IPv4)
export class GREPacket {
    /** @type {number} EtherType of the encapsulated packet */
    protocol;
    /** @type {Uint8Array} */
    payload;

    /**
     * @param {object} [opts]
     * @param {number} [opts.protocol]  default 0x0800 (IPv4)
     * @param {Uint8Array} [opts.payload]
     */
    constructor(opts = {}) {
        this.protocol = opts.protocol ?? 0x0800;
        this.payload  = opts.payload  ?? new Uint8Array(0);
    }

    /** @param {Uint8Array} buf @returns {GREPacket} */
    static fromBytes(buf) {
        if (buf.length < 4) throw new Error("GRE header needs at least 4 bytes");
        const flags    = read16BE(buf, 0);
        const protocol = read16BE(buf, 2);

        // Skip optional fields if flags indicate their presence
        let offset = 4;
        if (flags & 0x8000) offset += 4; // checksum + reserved
        if (flags & 0x2000) offset += 4; // key
        if (flags & 0x1000) offset += 4; // sequence number

        return new GREPacket({ protocol, payload: buf.slice(offset) });
    }

    /** @returns {Uint8Array} */
    pack() {
        const out = new Uint8Array(4 + this.payload.length);
        write16BE(out, 0, 0x0000);
        write16BE(out, 2, this.protocol);
        out.set(this.payload, 4);
        return out;
    }
}
