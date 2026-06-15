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

/**
 * Build the IP pseudo-header for VRRPv3 checksum (RFC 5798 §5.2.9).
 * @param {IPAddress} src
 * @param {IPAddress} dst
 * @param {number} length  total VRRP message length in bytes
 * @returns {Uint8Array}
 */
function v3PseudoHeader(src, dst, length) {
    if (src.isV6()) {
        // IPv6 pseudo-header: src(16) + dst(16) + len(4) + zeros(3) + NH(1)
        const buf = new Uint8Array(40);
        buf.set(src.toUInt8(), 0);
        buf.set(dst.toUInt8(), 16);
        buf[32] = (length >>> 24) & 0xff;
        buf[33] = (length >>> 16) & 0xff;
        buf[34] = (length >>> 8) & 0xff;
        buf[35] = length & 0xff;
        buf[39] = 112;
        return buf;
    } else {
        // IPv4 pseudo-header: src(4) + dst(4) + 0 + proto(1) + len(2)
        const buf = new Uint8Array(12);
        buf.set(src.toUInt8(), 0);
        buf.set(dst.toUInt8(), 4);
        buf[9] = 112;
        buf[10] = (length >>> 8) & 0xff;
        buf[11] = length & 0xff;
        return buf;
    }
}

export class VRRPPacket {
    /**
     * @param {{
     *   version?: number,
     *   vrid: number,
     *   priority: number,
     *   advInterval: number,
     *   virtualIPs: IPAddress[],
     *   ipVersion?: number
     * }} opts
     * version 2: advInterval in seconds; version 3: advInterval in centiseconds (100 ms units)
     */
    constructor({ version, vrid, priority, advInterval, virtualIPs, ipVersion = 4 }) {
        this.ipVersion = ipVersion;
        this.version = version ?? (ipVersion === 6 ? 3 : 2);
        this.type = 1;
        this.vrid = vrid;
        this.priority = priority;
        this.advInterval = advInterval;
        this.virtualIPs = virtualIPs;
    }

    /**
     * @param {IPAddress|null} [srcIp]  required for VRRPv3 pseudo-header checksum
     * @param {IPAddress|null} [dstIp]  required for VRRPv3 pseudo-header checksum
     * @returns {Uint8Array}
     */
    pack(srcIp = null, dstIp = null) {
        const count = this.virtualIPs.length;

        if (this.version === 2) {
            // VRRPv2: 8-byte header + 4 bytes/VIP + 8 bytes auth padding (all zeros)
            const buf = new Uint8Array(8 + count * 4 + 8);
            buf[0] = (2 << 4) | 1;
            buf[1] = this.vrid & 0xff;
            buf[2] = this.priority & 0xff;
            buf[3] = count & 0xff;
            buf[4] = 0; // auth type: no auth
            buf[5] = this.advInterval & 0xff;
            for (let i = 0; i < count; i++) {
                buf.set(this.virtualIPs[i].toUInt8(), 8 + i * 4);
            }
            const csum = checksum16(buf);
            buf[6] = (csum >> 8) & 0xff;
            buf[7] = csum & 0xff;
            return buf;
        } else {
            // VRRPv3: 8-byte header + ipLen bytes/VIP (no auth padding)
            const ipLen = this.ipVersion === 6 ? 16 : 4;
            const totalLen = 8 + count * ipLen;
            const buf = new Uint8Array(totalLen);
            buf[0] = (3 << 4) | 1;
            buf[1] = this.vrid & 0xff;
            buf[2] = this.priority & 0xff;
            buf[3] = count & 0xff;
            // Max Adver Int: 12-bit field in centiseconds (rsvd 4 bits at top)
            const adv = this.advInterval & 0x0fff;
            buf[4] = (adv >> 8) & 0x0f;
            buf[5] = adv & 0xff;
            for (let i = 0; i < count; i++) {
                buf.set(this.virtualIPs[i].toUInt8(), 8 + i * ipLen);
            }
            let csum;
            if (srcIp && dstIp) {
                const pseudo = v3PseudoHeader(srcIp, dstIp, totalLen);
                const combined = new Uint8Array(pseudo.length + totalLen);
                combined.set(pseudo);
                combined.set(buf, pseudo.length);
                csum = checksum16(combined);
            } else {
                csum = checksum16(buf);
            }
            buf[6] = (csum >> 8) & 0xff;
            buf[7] = csum & 0xff;
            return buf;
        }
    }

    /**
     * @param {Uint8Array} data
     * @param {number} [ipVersion]  4 or 6 — tells fromBytes how many bytes per VIP for v3 packets
     * @returns {VRRPPacket|null}
     */
    static fromBytes(data, ipVersion = 4) {
        if (!data || data.length < 8) return null;
        const version = (data[0] >> 4) & 0xf;
        const type = data[0] & 0xf;
        if (type !== 1) return null;
        if (version !== 2 && version !== 3) return null;

        const vrid = data[1];
        const priority = data[2];
        const count = data[3];

        if (version === 2) {
            const advInterval = data[5]; // seconds
            if (data.length < 8 + count * 4) return null;
            const virtualIPs = [];
            for (let i = 0; i < count; i++) {
                virtualIPs.push(IPAddress.fromUInt8(data.slice(8 + i * 4, 12 + i * 4)));
            }
            return new VRRPPacket({ version: 2, vrid, priority, advInterval, virtualIPs, ipVersion: 4 });
        } else {
            // v3: Max Adver Int in centiseconds (12-bit)
            const advInterval = ((data[4] & 0x0f) << 8) | data[5];
            const ipLen = ipVersion === 6 ? 16 : 4;
            if (data.length < 8 + count * ipLen) return null;
            const virtualIPs = [];
            for (let i = 0; i < count; i++) {
                virtualIPs.push(IPAddress.fromUInt8(data.slice(8 + i * ipLen, 8 + (i + 1) * ipLen)));
            }
            return new VRRPPacket({ version: 3, vrid, priority, advInterval, virtualIPs, ipVersion });
        }
    }
}
