//@ts-check
// OSPFv2 PDU — RFC 2328

import { read16BE, read32BE, write16BE, write32BE } from "../util/byteUtils.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const OSPF_PROTO        = 89;
export const OSPF_VERSION      = 2;
export const OSPF_ALL_SPF      = "224.0.0.5";  // AllSPFRouters
export const OSPF_ALL_DR       = "224.0.0.6";  // AllDRouters

export const OSPF_TYPE_HELLO   = 1;
export const OSPF_TYPE_DBD     = 2;
export const OSPF_TYPE_LSR     = 3;
export const OSPF_TYPE_LSU     = 4;
export const OSPF_TYPE_LSACK   = 5;

export const LSA_TYPE_ROUTER   = 1;
export const LSA_TYPE_NETWORK  = 2;
export const LSA_TYPE_SUMMARY  = 3;  // inter-area summary (ABR-originated)

export const LINK_TYPE_TRANSIT = 2;  // Router-LSA link to transit network (via DR)
export const LINK_TYPE_STUB    = 3;  // Router-LSA stub (connected subnet, no neighbors)

export const DBD_FLAG_MS       = 0x01;  // Master/Slave
export const DBD_FLAG_M        = 0x02;  // More
export const DBD_FLAG_I        = 0x04;  // Init

export const OSPF_OPTIONS_E    = 0x02;  // External routing capable

// Initial sequence number per RFC 2328 §12.1
export const LSA_INIT_SEQ      = 0x80000001;
export const LSA_MAX_SEQ       = 0x7fffffff;
export const LSA_MAX_AGE       = 3600;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fletcher checksum for OSPF/LSA bodies (RFC 2328 Appendix C).
 * Operates over `buf[start..end)`, with checksum bytes at positions c0off and c1off zeroed first.
 * @param {Uint8Array} buf
 * @param {number} start
 * @param {number} end
 * @param {number} c0off  offset of checksum byte 0 within buf
 * @param {number} c1off  offset of checksum byte 1 within buf
 * @returns {{ c0: number, c1: number }}
 */
function fletcher16(buf, start, end, c0off, c1off) {
    buf[c0off] = 0;
    buf[c1off] = 0;
    let c0 = 0, c1 = 0;
    for (let i = start; i < end; i++) {
        c0 = (c0 + buf[i]) % 255;
        c1 = (c1 + c0)     % 255;
    }
    const x = ((end - c0off - 1) * c0 - c1) % 255;
    const c0v = x <= 0 ? x + 255 : x;
    const c1v = 510 - c0 - c0v;
    return { c0: c0v > 255 ? c0v - 255 : c0v, c1: c1v > 255 ? c1v - 255 : c1v };
}

/**
 * Standard Internet checksum (one's complement sum of 16-bit words).
 * Used for the OSPF header checksum (over the entire OSPF packet, auth field excluded).
 * @param {Uint8Array} buf
 * @returns {number}
 */
export function ospfChecksum(buf) {
    let sum = 0;
    for (let i = 0; i + 1 < buf.length; i += 2) {
        sum += (buf[i] << 8) | buf[i + 1];
    }
    if (buf.length & 1) sum += buf[buf.length - 1] << 8;
    while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
    return (~sum) & 0xffff;
}

// ── OspfHeader (24 bytes) ────────────────────────────────────────────────────

export class OspfHeader {
    /**
     * @param {{
     *   type: number,
     *   length: number,
     *   routerId: number,
     *   areaId?: number,
     * }} opts
     */
    constructor({ type, length, routerId, areaId = 0 }) {
        this.version  = OSPF_VERSION;
        this.type     = type;
        this.length   = length;
        this.routerId = routerId >>> 0;
        this.areaId   = areaId   >>> 0;
        this.checksum = 0;
        this.authType = 0;
    }

    /** @param {Uint8Array} buf @param {number} off Write header at offset, return next offset */
    writeTo(buf, off = 0) {
        buf[off]     = this.version;
        buf[off + 1] = this.type;
        write16BE(buf, off + 2, this.length);
        write32BE(buf, off + 4, this.routerId);
        write32BE(buf, off + 8, this.areaId);
        write16BE(buf, off + 12, 0);      // checksum placeholder
        write16BE(buf, off + 14, 0);      // authType = 0
        // auth data [16..23] already zeroed
        return off + 24;
    }

    /** @param {Uint8Array} data @param {number} off */
    static readFrom(data, off = 0) {
        if (data.length - off < 24) throw new Error("OSPF header too short");
        const hdr = new OspfHeader({
            type:     data[off + 1],
            length:   read16BE(data, off + 2),
            routerId: read32BE(data, off + 4),
            areaId:   read32BE(data, off + 8),
        });
        hdr.checksum = read16BE(data, off + 12);
        return hdr;
    }
}

// ── OspfHello ────────────────────────────────────────────────────────────────

export class OspfHello {
    /**
     * @param {{
     *   networkMask: number,
     *   helloInterval: number,
     *   options?: number,
     *   routerPriority?: number,
     *   deadInterval: number,
     *   dr?: number,
     *   bdr?: number,
     *   neighbors?: number[],
     * }} opts
     */
    constructor({ networkMask, helloInterval, options = OSPF_OPTIONS_E,
                  routerPriority = 1, deadInterval, dr = 0, bdr = 0, neighbors = [] }) {
        this.networkMask   = networkMask   >>> 0;
        this.helloInterval = helloInterval;
        this.options       = options;
        this.routerPriority = routerPriority;
        this.deadInterval  = deadInterval  >>> 0;
        this.dr            = dr  >>> 0;
        this.bdr           = bdr >>> 0;
        this.neighbors     = neighbors.map(n => n >>> 0);
    }

    /** @returns {Uint8Array} */
    pack() {
        const len = 20 + this.neighbors.length * 4;
        const buf = new Uint8Array(len);
        write32BE(buf, 0, this.networkMask);
        write16BE(buf, 4, this.helloInterval);
        buf[6] = this.options;
        buf[7] = this.routerPriority;
        write32BE(buf, 8,  this.deadInterval);
        write32BE(buf, 12, this.dr);
        write32BE(buf, 16, this.bdr);
        let off = 20;
        for (const n of this.neighbors) { write32BE(buf, off, n); off += 4; }
        return buf;
    }

    /** @param {Uint8Array} data @returns {OspfHello} */
    static fromBytes(data) {
        if (data.length < 20) throw new Error("Hello too short");
        const neighbors = [];
        for (let i = 20; i + 3 < data.length; i += 4) neighbors.push(read32BE(data, i));
        return new OspfHello({
            networkMask:    read32BE(data, 0),
            helloInterval:  read16BE(data, 4),
            options:        data[6],
            routerPriority: data[7],
            deadInterval:   read32BE(data, 8),
            dr:             read32BE(data, 12),
            bdr:            read32BE(data, 16),
            neighbors,
        });
    }
}

// ── LsaHeader (20 bytes) ────────────────────────────────────────────────────

export class LsaHeader {
    /**
     * @param {{
     *   age?: number,
     *   options?: number,
     *   type: number,
     *   lsId: number,
     *   advertisingRouter: number,
     *   seqNum: number,
     *   length: number,
     * }} opts
     */
    constructor({ age = 0, options = OSPF_OPTIONS_E, type, lsId, advertisingRouter, seqNum, length }) {
        this.age               = age;
        this.options           = options;
        this.type              = type;
        this.lsId              = lsId              >>> 0;
        this.advertisingRouter = advertisingRouter >>> 0;
        this.seqNum            = seqNum;
        this.checksum          = 0;
        this.length            = length;
    }

    get key() { return `${this.type}-${this.lsId}-${this.advertisingRouter}`; }

    /** @param {Uint8Array} buf @param {number} off */
    writeTo(buf, off = 0) {
        write16BE(buf, off,      this.age);
        buf[off + 2]           = this.options;
        buf[off + 3]           = this.type;
        write32BE(buf, off + 4, this.lsId);
        write32BE(buf, off + 8, this.advertisingRouter);
        write32BE(buf, off + 12, this.seqNum >>> 0);
        write16BE(buf, off + 16, 0);           // checksum placeholder
        write16BE(buf, off + 18, this.length);
        return off + 20;
    }

    /** @param {Uint8Array} data @param {number} off @returns {LsaHeader} */
    static readFrom(data, off = 0) {
        if (data.length - off < 20) throw new Error("LSA header too short");
        return new LsaHeader({
            age:               read16BE(data, off),
            options:           data[off + 2],
            type:              data[off + 3],
            lsId:              read32BE(data, off + 4),
            advertisingRouter: read32BE(data, off + 8),
            seqNum:            read32BE(data, off + 12),
            length:            read16BE(data, off + 18),
        });
    }
}

// ── RouterLSA body ───────────────────────────────────────────────────────────

export class RouterLink {
    /**
     * @param {{
     *   linkId: number,
     *   linkData: number,
     *   type: number,
     *   metric: number,
     * }} opts
     */
    constructor({ linkId, linkData, type, metric }) {
        this.linkId   = linkId   >>> 0;
        this.linkData = linkData >>> 0;
        this.type     = type;
        this.metric   = metric;
    }
}

export class RouterLSA {
    /**
     * @param {{
     *   flags?: number,
     *   links: RouterLink[],
     * }} opts
     */
    constructor({ flags = 0, links }) {
        this.flags = flags;
        this.links = links;
    }

    /** @returns {Uint8Array} */
    pack() {
        const buf = new Uint8Array(4 + this.links.length * 12);
        buf[0] = this.flags;
        write16BE(buf, 2, this.links.length);
        let off = 4;
        for (const l of this.links) {
            write32BE(buf, off,     l.linkId);
            write32BE(buf, off + 4, l.linkData);
            buf[off + 8] = l.type;
            buf[off + 9] = 0;         // # TOS entries = 0
            write16BE(buf, off + 10, l.metric);
            off += 12;
        }
        return buf;
    }

    /** @param {Uint8Array} data @returns {RouterLSA} */
    static fromBytes(data) {
        if (data.length < 4) throw new Error("RouterLSA too short");
        const flags = data[0];
        const numLinks = read16BE(data, 2);
        const links = [];
        let off = 4;
        for (let i = 0; i < numLinks && off + 11 < data.length; i++) {
            links.push(new RouterLink({
                linkId:   read32BE(data, off),
                linkData: read32BE(data, off + 4),
                type:     data[off + 8],
                metric:   read16BE(data, off + 10),
            }));
            off += 12;
        }
        return new RouterLSA({ flags, links });
    }
}

// ── NetworkLSA body ──────────────────────────────────────────────────────────

export class NetworkLSA {
    /**
     * @param {{
     *   networkMask: number,
     *   attachedRouters: number[],
     * }} opts
     */
    constructor({ networkMask, attachedRouters }) {
        this.networkMask     = networkMask >>> 0;
        this.attachedRouters = attachedRouters.map(r => r >>> 0);
    }

    /** @returns {Uint8Array} */
    pack() {
        const buf = new Uint8Array(4 + this.attachedRouters.length * 4);
        write32BE(buf, 0, this.networkMask);
        let off = 4;
        for (const r of this.attachedRouters) { write32BE(buf, off, r); off += 4; }
        return buf;
    }

    /** @param {Uint8Array} data @returns {NetworkLSA} */
    static fromBytes(data) {
        if (data.length < 4) throw new Error("NetworkLSA too short");
        const networkMask = read32BE(data, 0);
        const attachedRouters = [];
        for (let i = 4; i + 3 < data.length; i += 4) attachedRouters.push(read32BE(data, i));
        return new NetworkLSA({ networkMask, attachedRouters });
    }
}

// ── SummaryLSA body (Type 3) ─────────────────────────────────────────────────

export class SummaryLSA {
    /**
     * @param {{ networkMask: number, metric: number }} opts
     */
    constructor({ networkMask, metric }) {
        this.networkMask = networkMask >>> 0;
        this.metric      = metric & 0xffffff;  // 24-bit
    }

    /** @returns {Uint8Array} */
    pack() {
        const buf = new Uint8Array(8);
        write32BE(buf, 0, this.networkMask);
        buf[4] = 0;  // TOS = 0
        buf[5] = (this.metric >> 16) & 0xff;
        buf[6] = (this.metric >>  8) & 0xff;
        buf[7] =  this.metric        & 0xff;
        return buf;
    }

    /** @param {Uint8Array} data @returns {SummaryLSA} */
    static fromBytes(data) {
        if (data.length < 8) throw new Error("SummaryLSA too short");
        return new SummaryLSA({
            networkMask: read32BE(data, 0),
            metric:      ((data[5] << 16) | (data[6] << 8) | data[7]),
        });
    }
}

// ── OspfDBD ──────────────────────────────────────────────────────────────────

export class OspfDBD {
    /**
     * @param {{
     *   mtu?: number,
     *   options?: number,
     *   flags: number,
     *   ddSeqNum: number,
     *   lsaHeaders?: LsaHeader[],
     * }} opts
     */
    constructor({ mtu = 1500, options = OSPF_OPTIONS_E, flags, ddSeqNum, lsaHeaders = [] }) {
        this.mtu        = mtu;
        this.options    = options;
        this.flags      = flags;
        this.ddSeqNum   = ddSeqNum >>> 0;
        this.lsaHeaders = lsaHeaders;
    }

    /** @returns {Uint8Array} */
    pack() {
        const buf = new Uint8Array(8 + this.lsaHeaders.length * 20);
        write16BE(buf, 0, this.mtu);
        buf[2] = this.options;
        buf[3] = this.flags;
        write32BE(buf, 4, this.ddSeqNum);
        let off = 8;
        for (const h of this.lsaHeaders) { h.writeTo(buf, off); off += 20; }
        return buf;
    }

    /** @param {Uint8Array} data @returns {OspfDBD} */
    static fromBytes(data) {
        if (data.length < 8) throw new Error("DBD too short");
        const lsaHeaders = [];
        for (let off = 8; off + 19 < data.length; off += 20) lsaHeaders.push(LsaHeader.readFrom(data, off));
        return new OspfDBD({
            mtu:       read16BE(data, 0),
            options:   data[2],
            flags:     data[3],
            ddSeqNum:  read32BE(data, 4),
            lsaHeaders,
        });
    }
}

// ── OspfLSR ──────────────────────────────────────────────────────────────────

export class LsaRequest {
    /** @param {{ lsType: number, lsId: number, advertisingRouter: number }} opts */
    constructor({ lsType, lsId, advertisingRouter }) {
        this.lsType            = lsType;
        this.lsId              = lsId              >>> 0;
        this.advertisingRouter = advertisingRouter >>> 0;
    }
}

export class OspfLSR {
    /** @param {{ requests: LsaRequest[] }} opts */
    constructor({ requests }) { this.requests = requests; }

    /** @returns {Uint8Array} */
    pack() {
        const buf = new Uint8Array(this.requests.length * 12);
        let off = 0;
        for (const r of this.requests) {
            write32BE(buf, off,     r.lsType);
            write32BE(buf, off + 4, r.lsId);
            write32BE(buf, off + 8, r.advertisingRouter);
            off += 12;
        }
        return buf;
    }

    /** @param {Uint8Array} data @returns {OspfLSR} */
    static fromBytes(data) {
        const requests = [];
        for (let off = 0; off + 11 < data.length; off += 12) {
            requests.push(new LsaRequest({
                lsType:            read32BE(data, off),
                lsId:              read32BE(data, off + 4),
                advertisingRouter: read32BE(data, off + 8),
            }));
        }
        return new OspfLSR({ requests });
    }
}

// ── LSA (header + raw bytes) ─────────────────────────────────────────────────

export class Lsa {
    /**
     * @param {{
     *   header: LsaHeader,
     *   body: RouterLSA | NetworkLSA,
     * }} opts
     */
    constructor({ header, body }) {
        this.header = header;
        this.body   = body;
    }

    get key() { return this.header.key; }

    /** Serialize full LSA (header + body) and fill in length + checksum. @returns {Uint8Array} */
    pack() {
        const bodyBytes = this.body.pack();
        const total     = 20 + bodyBytes.length;
        const buf       = new Uint8Array(total);
        this.header.length = total;
        this.header.writeTo(buf, 0);
        buf.set(bodyBytes, 20);
        // Fletcher checksum over bytes 2..total (skip age bytes 0-1)
        const { c0, c1 } = fletcher16(buf, 2, total, 16, 17);
        buf[16] = c0;
        buf[17] = c1;
        this.header.checksum = (c0 << 8) | c1;
        return buf;
    }

    /**
     * Parse a single LSA from raw bytes.
     * @param {Uint8Array} data
     * @param {number} [off]
     * @returns {Lsa}
     */
    static fromBytes(data, off = 0) {
        const hdr = LsaHeader.readFrom(data, off);
        if (hdr.length < 20 || off + hdr.length > data.length) throw new Error("LSA length invalid");
        // Verify Fletcher-16 checksum (age bytes 0-1 excluded; checksum at offsets 16-17)
        const c0s = data[off + 16], c1s = data[off + 17];
        const copy = data.slice(off, off + hdr.length);
        const { c0, c1 } = fletcher16(copy, 2, hdr.length, 16, 17);
        if (c0 !== c0s || c1 !== c1s) throw new Error("LSA checksum invalid");
        const bodyData = data.slice(off + 20, off + hdr.length);
        let body;
        if      (hdr.type === LSA_TYPE_ROUTER)  body = RouterLSA.fromBytes(bodyData);
        else if (hdr.type === LSA_TYPE_NETWORK) body = NetworkLSA.fromBytes(bodyData);
        else if (hdr.type === LSA_TYPE_SUMMARY) body = SummaryLSA.fromBytes(bodyData);
        else throw new Error(`Unsupported LSA type ${hdr.type}`);
        return new Lsa({ header: hdr, body });
    }
}

// ── OspfLSU ──────────────────────────────────────────────────────────────────

export class OspfLSU {
    /** @param {{ lsas: Lsa[] }} opts */
    constructor({ lsas }) { this.lsas = lsas; }

    /** @returns {Uint8Array} */
    pack() {
        const parts = this.lsas.map(l => l.pack());
        const total = 4 + parts.reduce((s, p) => s + p.length, 0);
        const buf = new Uint8Array(total);
        write32BE(buf, 0, this.lsas.length);
        let off = 4;
        for (const p of parts) { buf.set(p, off); off += p.length; }
        return buf;
    }

    /** @param {Uint8Array} data @returns {OspfLSU} */
    static fromBytes(data) {
        if (data.length < 4) throw new Error("LSU too short");
        const count = read32BE(data, 0);
        const lsas  = [];
        let off = 4;
        for (let i = 0; i < count && off + 20 <= data.length; i++) {
            const hdr = LsaHeader.readFrom(data, off);
            if (hdr.length < 20 || off + hdr.length > data.length) break;
            try { lsas.push(Lsa.fromBytes(data, off)); } catch { /* skip unknown type */ }
            off += hdr.length;
        }
        return new OspfLSU({ lsas });
    }
}

// ── OspfLSAck ────────────────────────────────────────────────────────────────

export class OspfLSAck {
    /** @param {{ lsaHeaders: LsaHeader[] }} opts */
    constructor({ lsaHeaders }) { this.lsaHeaders = lsaHeaders; }

    /** @returns {Uint8Array} */
    pack() {
        const buf = new Uint8Array(this.lsaHeaders.length * 20);
        let off = 0;
        for (const h of this.lsaHeaders) { h.writeTo(buf, off); off += 20; }
        return buf;
    }

    /** @param {Uint8Array} data @returns {OspfLSAck} */
    static fromBytes(data) {
        const lsaHeaders = [];
        for (let off = 0; off + 19 < data.length; off += 20) lsaHeaders.push(LsaHeader.readFrom(data, off));
        return new OspfLSAck({ lsaHeaders });
    }
}

// ── OspfPacket (full: header + typed body) ───────────────────────────────────

export class OspfPacket {
    /**
     * @param {{
     *   header: OspfHeader,
     *   body: OspfHello | OspfDBD | OspfLSR | OspfLSU | OspfLSAck,
     * }} opts
     */
    constructor({ header, body }) {
        this.header = header;
        this.body   = body;
    }

    /** Build and return the full OSPF packet bytes with checksum. @returns {Uint8Array} */
    pack() {
        const bodyBytes = this.body.pack();
        const total     = 24 + bodyBytes.length;
        const buf       = new Uint8Array(total);
        this.header.length = total;
        this.header.writeTo(buf, 0);
        buf.set(bodyBytes, 24);
        // Checksum over entire packet; auth field (bytes 16-23) is already zero per RFC §A.3.1
        const cs = ospfChecksum(buf);
        write16BE(buf, 12, cs);
        return buf;
    }

    /**
     * Parse an OSPF packet from raw IP payload bytes.
     * @param {Uint8Array} data
     * @returns {OspfPacket}
     */
    static fromBytes(data) {
        if (data.length < 24) throw new Error("OSPF packet too short");
        const hdr      = OspfHeader.readFrom(data, 0);
        const bodyData = data.slice(24, hdr.length);
        let body;
        switch (hdr.type) {
            case OSPF_TYPE_HELLO: body = OspfHello.fromBytes(bodyData); break;
            case OSPF_TYPE_DBD:   body = OspfDBD.fromBytes(bodyData);   break;
            case OSPF_TYPE_LSR:   body = OspfLSR.fromBytes(bodyData);   break;
            case OSPF_TYPE_LSU:   body = OspfLSU.fromBytes(bodyData);   break;
            case OSPF_TYPE_LSACK: body = OspfLSAck.fromBytes(bodyData); break;
            default: throw new Error(`Unknown OSPF type ${hdr.type}`);
        }
        return new OspfPacket({ header: hdr, body });
    }
}
