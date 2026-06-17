//@ts-check

/**
 * Utility class for LLDP (IEEE 802.1AB) TLV encoding and decoding.
 * No state — all methods are static.
 */
export class LLDPDaemon {
    static ETHERTYPE = 0x88CC;
    static DEST_MAC  = new Uint8Array([0x01, 0x80, 0xC2, 0x00, 0x00, 0x0E]);

    /**
     * Encode an LLDP PDU.
     * @param {Uint8Array} chassisMAC  6-byte MAC
     * @param {string}     portId      port label (e.g. "port 1" or "eth0")
     * @param {string}     systemName  device name
     * @param {number}     [ttl]       seconds (default 120)
     * @returns {Uint8Array}
     */
    static encode(chassisMAC, portId, systemName, ttl = 120) {
        const portIdBytes   = new TextEncoder().encode(portId);
        const sysNameBytes  = new TextEncoder().encode(systemName);

        // Chassis ID TLV: type=1, subtype=4 (MAC addr), 6 bytes
        const chassisLen = 1 + 6;
        // Port ID TLV:    type=2, subtype=5 (interface name)
        const portLen    = 1 + portIdBytes.length;
        // TTL TLV:        type=3, 2 bytes
        const ttlLen     = 2;
        // System Name TLV: type=5
        const sysNameLen = sysNameBytes.length;
        // End TLV:        type=0, length=0

        const totalBytes =
            (2 + chassisLen) +
            (2 + portLen)    +
            (2 + ttlLen)     +
            (2 + sysNameLen) +
            2;                // end TLV

        const buf = new Uint8Array(totalBytes);
        let off = 0;

        const writeTlvHeader = (/** @type {number} */ type, /** @type {number} */ len) => {
            const hdr = ((type & 0x7F) << 9) | (len & 0x1FF);
            buf[off++] = (hdr >> 8) & 0xFF;
            buf[off++] =  hdr       & 0xFF;
        };

        // TLV 1: Chassis ID
        writeTlvHeader(1, chassisLen);
        buf[off++] = 4; // subtype MAC
        buf.set(chassisMAC.slice(0, 6), off); off += 6;

        // TLV 2: Port ID
        writeTlvHeader(2, portLen);
        buf[off++] = 5; // subtype interface name
        buf.set(portIdBytes, off); off += portIdBytes.length;

        // TLV 3: TTL
        writeTlvHeader(3, ttlLen);
        buf[off++] = (ttl >> 8) & 0xFF;
        buf[off++] =  ttl       & 0xFF;

        // TLV 5: System Name
        writeTlvHeader(5, sysNameLen);
        buf.set(sysNameBytes, off); off += sysNameBytes.length;

        // TLV 0: End
        writeTlvHeader(0, 0);

        return buf;
    }

    /**
     * Decode an LLDP PDU.
     * @param {Uint8Array} payload
     * @returns {{ chassisId: string, portId: string, systemName: string, ttl: number } | null}
     */
    static decode(payload) {
        if (!payload || payload.length < 4) return null;

        let chassisId  = "";
        let portId     = "";
        let systemName = "";
        let ttl        = 120;
        let off        = 0;

        try {
            while (off + 2 <= payload.length) {
                const hdr  = (payload[off] << 8) | payload[off + 1];
                const type = (hdr >> 9) & 0x7F;
                const len  =  hdr & 0x1FF;
                off += 2;

                if (type === 0) break; // End TLV
                if (off + len > payload.length) break;

                const val = payload.slice(off, off + len);
                off += len;

                switch (type) {
                    case 1: // Chassis ID
                        if (len >= 7 && val[0] === 4) {
                            chassisId = LLDPDaemon.macToStr(val.slice(1, 7));
                        }
                        break;
                    case 2: // Port ID
                        if (len >= 2) {
                            portId = new TextDecoder().decode(val.slice(1));
                        }
                        break;
                    case 3: // TTL
                        if (len === 2) ttl = (val[0] << 8) | val[1];
                        break;
                    case 5: // System Name
                        systemName = new TextDecoder().decode(val);
                        break;
                }
            }
        } catch {
            return null;
        }

        if (!chassisId) return null;
        return { chassisId, portId, systemName, ttl };
    }

    /**
     * @param {Uint8Array} mac
     * @returns {string}
     */
    static macToStr(mac) {
        return Array.from(mac).map(b => b.toString(16).padStart(2, "0")).join(":");
    }
}
