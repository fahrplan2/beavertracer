//@ts-check
// RIPng PDU — RFC 2080

export const RIPNG_CMD_REQUEST  = 1;
export const RIPNG_CMD_RESPONSE = 2;
export const RIPNG_VERSION      = 1;
export const RIPNG_INFINITY     = 16;
export const RIPNG_PORT         = 521;
export const RIPNG_MCAST        = "ff02::9";

// metric 0xFF marks a next-hop RTE
const NEXTHOP_METRIC = 0xFF;

export class RIPngEntry {
    /**
     * @param {{
     *   prefix: Uint8Array,
     *   tag?: number,
     *   prefixLen: number,
     *   metric: number
     * }} opts
     */
    constructor({ prefix, tag = 0, prefixLen, metric }) {
        this.prefix    = prefix;      // Uint8Array(16)
        this.tag       = tag;
        this.prefixLen = prefixLen;
        this.metric    = metric;
    }

    get isNexthop() { return (this.metric & 0xFF) === NEXTHOP_METRIC; }
}

export class RIPngPacket {
    /**
     * @param {{ command: number, entries: RIPngEntry[] }} opts
     */
    constructor({ command, entries }) {
        this.command = command;
        this.version = RIPNG_VERSION;
        this.entries = entries;
    }

    pack() {
        const buf = new Uint8Array(4 + this.entries.length * 20);
        buf[0] = this.command;
        buf[1] = this.version;
        // bytes 2-3: reserved (zero)
        let off = 4;
        for (const e of this.entries) {
            buf.set(e.prefix.slice(0, 16), off);
            buf[off + 16] = (e.tag >>> 8) & 0xFF;
            buf[off + 17] = e.tag & 0xFF;
            buf[off + 18] = e.prefixLen & 0xFF;
            buf[off + 19] = e.metric & 0xFF;
            off += 20;
        }
        return buf;
    }

    /** @param {Uint8Array} data @returns {RIPngPacket} */
    static fromBytes(data) {
        if (data.length < 4) throw new Error("RIPng packet too short");
        const command = data[0];
        const version = data[1];
        if (version !== RIPNG_VERSION) throw new Error(`RIPng: unsupported version ${version}`);

        const entries = [];
        let off = 4;
        while (off + 20 <= data.length) {
            const prefix    = data.slice(off, off + 16);
            const tag       = (data[off + 16] << 8) | data[off + 17];
            const prefixLen = data[off + 18];
            const metric    = data[off + 19];
            entries.push(new RIPngEntry({ prefix, tag, prefixLen, metric }));
            off += 20;
        }
        return new RIPngPacket({ command, entries });
    }
}
