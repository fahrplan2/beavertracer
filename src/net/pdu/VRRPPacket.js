//@ts-check
import { IPAddress } from "../models/IPAddress.js";

/** @param {Uint8Array} data @returns {number} */
function checksum16(data) {
    let sum = 0;
    for (let i = 0; i < data.length - 1; i += 2) {
        sum += (data[i] << 8) | data[i + 1];
    }
    if (data.length & 1) sum += data[data.length - 1] << 8;
    while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
    return (~sum) & 0xffff;
}

export class VRRPPacket {
    /**
     * @param {{vrid: number, priority: number, advInterval: number, virtualIPs: IPAddress[]}} opts
     * advInterval in seconds (VRRPv2 field)
     */
    constructor({ vrid, priority, advInterval, virtualIPs }) {
        this.version = 2;
        this.type = 1; // Advertisement
        this.vrid = vrid;
        this.priority = priority;
        this.advInterval = advInterval;
        this.virtualIPs = virtualIPs;
    }

    /** @returns {Uint8Array} */
    pack() {
        const count = this.virtualIPs.length;
        // 8-byte header + 4 bytes per VIP + 8 bytes auth padding (no-auth, all zeros)
        const buf = new Uint8Array(8 + count * 4 + 8);
        buf[0] = ((this.version & 0xf) << 4) | (this.type & 0xf);
        buf[1] = this.vrid & 0xff;
        buf[2] = this.priority & 0xff;
        buf[3] = count & 0xff;
        buf[4] = 0; // auth type: no auth
        buf[5] = this.advInterval & 0xff;
        // buf[6..7]: checksum, filled in below
        for (let i = 0; i < count; i++) {
            buf.set(this.virtualIPs[i].toUInt8(), 8 + i * 4);
        }
        const csum = checksum16(buf);
        buf[6] = (csum >> 8) & 0xff;
        buf[7] = csum & 0xff;
        return buf;
    }

    /**
     * @param {Uint8Array} data
     * @returns {VRRPPacket|null}
     */
    static fromBytes(data) {
        if (!data || data.length < 8) return null;
        const version = (data[0] >> 4) & 0xf;
        const type = data[0] & 0xf;
        if (version !== 2 || type !== 1) return null;
        const vrid = data[1];
        const priority = data[2];
        const count = data[3];
        const advInterval = data[5];
        if (data.length < 8 + count * 4) return null;
        const virtualIPs = [];
        for (let i = 0; i < count; i++) {
            virtualIPs.push(IPAddress.fromUInt8(data.slice(8 + i * 4, 12 + i * 4)));
        }
        return new VRRPPacket({ vrid, priority, advInterval, virtualIPs });
    }
}
