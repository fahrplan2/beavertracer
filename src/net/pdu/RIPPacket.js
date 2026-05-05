//@ts-check
// RIPv2 PDU — RFC 2453

export const RIP_CMD_REQUEST  = 1;
export const RIP_CMD_RESPONSE = 2;
export const RIP_VERSION      = 2;
export const RIP_INFINITY     = 16;
export const RIP_AFI_IP       = 2;
export const RIP_PORT         = 520;

export class RIPEntry {
    /**
     * @param {{
     *   afi?: number,
     *   tag?: number,
     *   ip: Uint8Array,
     *   mask: Uint8Array,
     *   nexthop: Uint8Array,
     *   metric: number
     * }} opts
     */
    constructor({ afi = RIP_AFI_IP, tag = 0, ip, mask, nexthop, metric }) {
        this.afi     = afi;
        this.tag     = tag;
        this.ip      = ip;
        this.mask    = mask;
        this.nexthop = nexthop;
        this.metric  = metric;
    }
}

export class RIPPacket {
    /**
     * @param {{ command: number, entries: RIPEntry[] }} opts
     */
    constructor({ command, entries }) {
        this.command = command;
        this.version = RIP_VERSION;
        this.entries = entries;
    }

    pack() {
        const buf = new Uint8Array(4 + this.entries.length * 20);
        buf[0] = this.command;
        buf[1] = this.version;
        let off = 4;
        for (const e of this.entries) {
            buf[off    ] = (e.afi  >> 8) & 0xff;
            buf[off + 1] =  e.afi        & 0xff;
            buf[off + 2] = (e.tag  >> 8) & 0xff;
            buf[off + 3] =  e.tag        & 0xff;
            buf.set(e.ip,      off +  4);
            buf.set(e.mask,    off +  8);
            buf.set(e.nexthop, off + 12);
            const m = e.metric >>> 0;
            buf[off + 16] = (m >>> 24) & 0xff;
            buf[off + 17] = (m >>> 16) & 0xff;
            buf[off + 18] = (m >>>  8) & 0xff;
            buf[off + 19] =  m         & 0xff;
            off += 20;
        }
        return buf;
    }

    /** @param {Uint8Array} data @returns {RIPPacket} */
    static fromBytes(data) {
        if (data.length < 4) throw new Error("RIP packet too short");
        const command = data[0];
        const version = data[1];
        if (version !== RIP_VERSION) throw new Error(`RIP: unsupported version ${version}`);

        const entries = [];
        let off = 4;
        while (off + 20 <= data.length) {
            const afi    = (data[off] << 8) | data[off + 1];
            const tag    = (data[off + 2] << 8) | data[off + 3];
            const ip      = data.slice(off +  4, off +  8);
            const mask    = data.slice(off +  8, off + 12);
            const nexthop = data.slice(off + 12, off + 16);
            const metric  = (
                (data[off + 16] << 24) | (data[off + 17] << 16) |
                (data[off + 18] <<  8) |  data[off + 19]
            ) >>> 0;
            entries.push(new RIPEntry({ afi, tag, ip, mask, nexthop, metric }));
            off += 20;
        }
        return new RIPPacket({ command, entries });
    }
}
