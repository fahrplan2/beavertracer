//@ts-check
// BGP-4 PDU helpers — RFC 4271

import { IPAddress } from "../models/IPAddress.js";
import { read16BE, read32BE, write16BE, write32BE } from "../util/byteUtils.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const BGP_PORT    = 179;
export const BGP_VERSION = 4;

export const BGP_MSG_OPEN         = 1;
export const BGP_MSG_UPDATE       = 2;
export const BGP_MSG_NOTIFICATION = 3;
export const BGP_MSG_KEEPALIVE    = 4;

// Path attribute type codes
export const PA_ORIGIN          = 1;
export const PA_AS_PATH         = 2;
export const PA_NEXT_HOP        = 3;
export const PA_MED             = 4;
export const PA_LOCAL_PREF      = 5;
export const PA_MP_REACH_NLRI   = 14;  // RFC 4760 §3
export const PA_MP_UNREACH_NLRI = 15;  // RFC 4760 §4

// Address Family Identifiers (AFI)
export const AFI_IPV4 = 1;
export const AFI_IPV6 = 2;

// Subsequent Address Family Identifiers (SAFI)
export const SAFI_UNICAST = 1;

// BGP Capability codes (RFC 5492)
export const CAP_MP_BGP = 1;

// ORIGIN values
export const ORIGIN_IGP        = 0;
export const ORIGIN_INCOMPLETE = 2;

// AS_PATH segment types
export const AS_SEQUENCE = 2;

// Attribute flags
export const ATTR_TRANSITIVE              = 0x40;
export const ATTR_OPTIONAL                = 0x80;
export const ATTR_OPTIONAL_EXT_LEN       = 0x90; // optional + extended-length

// NOTIFICATION error codes
export const ERR_CEASE    = 6;

// 16-byte BGP marker
const MARKER = new Uint8Array(16).fill(0xff);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** @param {Uint8Array[]} parts @returns {Uint8Array} */
function concat(parts) {
    const len = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}

/** @param {number} n @returns {Uint8Array} */
function u32bytes(n) {
    const b = new Uint8Array(4);
    write32BE(b, 0, n >>> 0);
    return b;
}

// ── Message building ─────────────────────────────────────────────────────────

/**
 * Wrap a body in a BGP header (marker + length + type).
 * @param {number} type
 * @param {Uint8Array} body
 * @returns {Uint8Array}
 */
function buildMessage(type, body) {
    const total = 19 + body.length;
    const hdr = new Uint8Array(19);
    hdr.set(MARKER);
    write16BE(hdr, 16, total);
    hdr[18] = type;
    return concat([hdr, body]);
}

/**
 * @param {number} localAS
 * @param {number} holdTime  seconds
 * @param {IPAddress} routerId
 * @returns {Uint8Array}
 */
export function buildOpen(localAS, holdTime, routerId) {
    // Optional parameter: Capabilities (type 2, RFC 5492)
    // Capability: Multiprotocol Extensions (code 1, RFC 4760) for IPv6 unicast
    //   Capability code (1) + cap_len (1) + AFI (2) + reserved (1) + SAFI (1) = 6 bytes
    const capValue = new Uint8Array([CAP_MP_BGP, 4, 0x00, AFI_IPV6, 0x00, SAFI_UNICAST]);
    const optParam = new Uint8Array(2 + capValue.length);
    optParam[0] = 2;               // Optional Parameter type = Capabilities
    optParam[1] = capValue.length;
    optParam.set(capValue, 2);

    const body = new Uint8Array(10 + optParam.length);
    body[0] = BGP_VERSION;
    write16BE(body, 1, localAS & 0xffff);
    write16BE(body, 3, holdTime & 0xffff);
    body.set(routerId.toUInt8(), 5);
    body[9] = optParam.length;
    body.set(optParam, 10);
    return buildMessage(BGP_MSG_OPEN, body);
}

/** @returns {Uint8Array} */
export function buildKeepalive() {
    return buildMessage(BGP_MSG_KEEPALIVE, new Uint8Array(0));
}

/**
 * @param {number} code
 * @param {number} subcode
 * @returns {Uint8Array}
 */
export function buildNotification(code, subcode) {
    return buildMessage(BGP_MSG_NOTIFICATION, new Uint8Array([code, subcode]));
}

/**
 * Build an UPDATE message.
 * @param {{
 *   withdrawn: Array<{dst: IPAddress, prefLen: number}>,
 *   nextHop: IPAddress,
 *   asPath: number[],
 *   localPref: number,
 *   med: number,
 *   nlri: Array<{dst: IPAddress, prefLen: number}>,
 *   mp6Reach?: { nextHop: IPAddress, nlri: Array<{dst: IPAddress, prefLen: number}> },
 *   mp6Unreach?: Array<{dst: IPAddress, prefLen: number}>,
 * }} opts
 * @returns {Uint8Array}
 */
export function buildUpdate({ withdrawn, nextHop, asPath, localPref, med, nlri, mp6Reach, mp6Unreach }) {
    // Withdrawn routes (IPv4 only)
    const wdrBytes = concat(withdrawn.map(encodePrefix));
    const wdrLenBuf = new Uint8Array(2);
    write16BE(wdrLenBuf, 0, wdrBytes.length);

    const hasV4Nlri   = nlri.length > 0;
    const hasMp6Reach = mp6Reach != null && mp6Reach.nlri.length > 0;
    const hasMp6Unreach = mp6Unreach != null && mp6Unreach.length > 0;

    // Path attributes (required when any NLRI present)
    /** @type {Uint8Array} */
    let paBytes = new Uint8Array(0);
    if (hasV4Nlri || hasMp6Reach || hasMp6Unreach) {
        paBytes = buildPathAttrs(nextHop, asPath, localPref, med, mp6Reach, mp6Unreach);
    }
    const paLenBuf = new Uint8Array(2);
    write16BE(paLenBuf, 0, paBytes.length);

    // NLRI (IPv4 only — IPv6 NLRI lives inside MP_REACH_NLRI path attribute)
    const nlriBytes = concat(nlri.map(encodePrefix));

    const body = concat([wdrLenBuf, wdrBytes, paLenBuf, paBytes, nlriBytes]);
    return buildMessage(BGP_MSG_UPDATE, body);
}

/**
 * Build MP_REACH_NLRI attribute (RFC 4760 §3) for IPv6 unicast.
 * @param {IPAddress} nextHop  global unicast IPv6 address
 * @param {Array<{dst: IPAddress, prefLen: number}>} nlri
 * @returns {Uint8Array}
 */
function buildMPReachNLRI(nextHop, nlri) {
    const nhBytes = nextHop.toUInt8(); // 16 bytes
    const nlriBytes = concat(nlri.map(encodePrefix));
    // value: AFI(2) + SAFI(1) + nhLen(1) + nh(16) + SNPA(1) + NLRI
    const value = concat([
        new Uint8Array([0x00, AFI_IPV6, SAFI_UNICAST, nhBytes.length]),
        nhBytes,
        new Uint8Array([0x00]), // SNPA count = 0
        nlriBytes,
    ]);
    // flags: optional(0x80) + extended-length(0x10) = 0x90
    const hdr = new Uint8Array(4);
    hdr[0] = ATTR_OPTIONAL_EXT_LEN;
    hdr[1] = PA_MP_REACH_NLRI;
    write16BE(hdr, 2, value.length);
    return concat([hdr, value]);
}

/**
 * Build MP_UNREACH_NLRI attribute (RFC 4760 §4) for IPv6 unicast.
 * @param {Array<{dst: IPAddress, prefLen: number}>} prefixes
 * @returns {Uint8Array}
 */
function buildMPUnreachNLRI(prefixes) {
    const nlriBytes = concat(prefixes.map(encodePrefix));
    // value: AFI(2) + SAFI(1) + withdrawn NLRI
    const value = concat([
        new Uint8Array([0x00, AFI_IPV6, SAFI_UNICAST]),
        nlriBytes,
    ]);
    const hdr = new Uint8Array(4);
    hdr[0] = ATTR_OPTIONAL_EXT_LEN;
    hdr[1] = PA_MP_UNREACH_NLRI;
    write16BE(hdr, 2, value.length);
    return concat([hdr, value]);
}

/**
 * @param {IPAddress} nextHop
 * @param {number[]} asPath
 * @param {number} localPref
 * @param {number} med
 * @param {{ nextHop: IPAddress, nlri: Array<{dst: IPAddress, prefLen: number}> }|undefined} mp6Reach
 * @param {Array<{dst: IPAddress, prefLen: number}>|undefined} mp6Unreach
 * @returns {Uint8Array}
 */
function buildPathAttrs(nextHop, asPath, localPref, med, mp6Reach, mp6Unreach) {
    const parts = [];

    // ORIGIN: well-known mandatory, IGP (0)
    parts.push(new Uint8Array([ATTR_TRANSITIVE, PA_ORIGIN, 1, ORIGIN_IGP]));

    // AS_PATH: well-known mandatory
    const asPathBody = buildASPath(asPath);
    const asPathHdr  = new Uint8Array([ATTR_TRANSITIVE, PA_AS_PATH, asPathBody.length]);
    parts.push(concat([asPathHdr, asPathBody]));

    // NEXT_HOP: well-known mandatory for IPv4 (4 bytes); omit when only carrying IPv6 MP attributes
    if (nextHop.isV4()) {
        const nhBytes = nextHop.toUInt8();
        parts.push(new Uint8Array([ATTR_TRANSITIVE, PA_NEXT_HOP, 4, ...nhBytes]));
    }

    // LOCAL_PREF: well-known discretionary (4 bytes)
    parts.push(new Uint8Array([ATTR_TRANSITIVE, PA_LOCAL_PREF, 4, ...u32bytes(localPref)]));

    // MED: optional non-transitive (4 bytes)
    parts.push(new Uint8Array([ATTR_OPTIONAL, PA_MED, 4, ...u32bytes(med)]));

    // MP_REACH_NLRI (RFC 4760 §3) — IPv6 announcements
    if (mp6Reach != null && mp6Reach.nlri.length > 0) {
        parts.push(buildMPReachNLRI(mp6Reach.nextHop, mp6Reach.nlri));
    }

    // MP_UNREACH_NLRI (RFC 4760 §4) — IPv6 withdrawals
    if (mp6Unreach != null && mp6Unreach.length > 0) {
        parts.push(buildMPUnreachNLRI(mp6Unreach));
    }

    return concat(parts);
}

/**
 * @param {number[]} asns  2-byte AS numbers
 * @returns {Uint8Array}
 */
function buildASPath(asns) {
    if (asns.length === 0) {
        // Empty AS_SEQUENCE segment
        return new Uint8Array([AS_SEQUENCE, 0]);
    }
    const out = new Uint8Array(2 + asns.length * 2);
    out[0] = AS_SEQUENCE;
    out[1] = asns.length;
    for (let i = 0; i < asns.length; i++) {
        write16BE(out, 2 + i * 2, asns[i] & 0xffff);
    }
    return out;
}

/**
 * Encode a prefix as length-byte + network bytes.
 * @param {{ dst: IPAddress, prefLen: number }} p
 * @returns {Uint8Array}
 */
function encodePrefix({ dst, prefLen }) {
    const octets = Math.ceil(prefLen / 8);
    const out = new Uint8Array(1 + octets);
    out[0] = prefLen & 0xff;
    out.set(dst.toUInt8().subarray(0, octets), 1);
    return out;
}

// ── Message parsing ───────────────────────────────────────────────────────────

/**
 * Validate BGP marker and return { type, body } or null if invalid.
 * @param {Uint8Array} msg  complete BGP message (19+ bytes)
 * @returns {{ type: number, body: Uint8Array }|null}
 */
export function parseMessage(msg) {
    if (msg.length < 19) return null;
    for (let i = 0; i < 16; i++) if (msg[i] !== 0xff) return null;
    const len  = read16BE(msg, 16);
    const type = msg[18];
    if (len !== msg.length) return null;
    return { type, body: msg.subarray(19) };
}

/**
 * @param {Uint8Array} body  OPEN body (after header)
 * @returns {{ version: number, myAS: number, holdTime: number, bgpId: IPAddress }}
 */
export function parseOpen(body) {
    if (body.length < 10) throw new Error("OPEN too short");
    const version  = body[0];
    const myAS     = read16BE(body, 1);
    const holdTime = read16BE(body, 3);
    const bgpId    = IPAddress.fromUInt8(body.subarray(5, 9));
    return { version, myAS, holdTime, bgpId };
}

/**
 * @param {Uint8Array} body  UPDATE body (after header)
 * @returns {{
 *   withdrawn: Array<{dst: IPAddress, prefLen: number}>,
 *   attrs: { asPath: number[], nextHop: IPAddress|null, localPref: number, med: number, mp6Reach: { nextHop: IPAddress, nlri: Array<{dst: IPAddress, prefLen: number}> }|null, mp6Unreach: Array<{dst: IPAddress, prefLen: number}> },
 *   nlri: Array<{dst: IPAddress, prefLen: number}>,
 * }}
 */
export function parseUpdate(body) {
    let off = 0;

    // Withdrawn routes
    if (off + 2 > body.length) return { withdrawn: [], attrs: emptyAttrs(), nlri: [] };
    const wdrLen = read16BE(body, off); off += 2;
    const withdrawn = decodePrefixes(body, off, off + wdrLen);
    off += wdrLen;

    // Path attributes
    if (off + 2 > body.length) return { withdrawn, attrs: emptyAttrs(), nlri: [] };
    const paLen = read16BE(body, off); off += 2;
    const attrs = parsePathAttrs(body, off, off + paLen);
    off += paLen;

    // NLRI
    const nlri = decodePrefixes(body, off, body.length);

    return { withdrawn, attrs, nlri };
}

/**
 * @returns {{
 *   asPath: number[], nextHop: IPAddress|null, localPref: number, med: number,
 *   mp6Reach: { nextHop: IPAddress, nlri: Array<{dst: IPAddress, prefLen: number}> }|null,
 *   mp6Unreach: Array<{dst: IPAddress, prefLen: number}>,
 * }}
 */
function emptyAttrs() {
    return { asPath: [], nextHop: null, localPref: 100, med: 0, mp6Reach: null, mp6Unreach: [] };
}

/**
 * @param {Uint8Array} data
 * @param {number} off
 * @param {number} end
 * @returns {{ asPath: number[], nextHop: IPAddress|null, localPref: number, med: number, mp6Reach: { nextHop: IPAddress, nlri: Array<{dst: IPAddress, prefLen: number}> }|null, mp6Unreach: Array<{dst: IPAddress, prefLen: number}> }}
 */
function parsePathAttrs(data, off, end) {
    const result = emptyAttrs();
    while (off + 2 <= end) {
        const flags = data[off++];
        const type  = data[off++];
        const extLen = (flags & 0x10) !== 0;
        if (off + (extLen ? 2 : 1) > end) break;
        const len = extLen ? (read16BE(data, off) & 0xffff) : data[off];
        off += extLen ? 2 : 1;
        const valEnd = off + len;
        if (valEnd > end) break;

        switch (type) {
            case PA_AS_PATH:
                result.asPath = parseASPath(data, off, valEnd);
                break;
            case PA_NEXT_HOP:
                if (len >= 4) result.nextHop = IPAddress.fromUInt8(data.subarray(off, off + 4));
                break;
            case PA_LOCAL_PREF:
                if (len >= 4) result.localPref = read32BE(data, off);
                break;
            case PA_MED:
                if (len >= 4) result.med = read32BE(data, off);
                break;
            case PA_MP_REACH_NLRI: {   // RFC 4760 §3
                const afi  = read16BE(data, off);
                const safi = data[off + 2];
                const nhLen = data[off + 3];
                if (afi === AFI_IPV6 && safi === SAFI_UNICAST && nhLen >= 16 && off + 4 + nhLen <= valEnd) {
                    const nh6 = IPAddress.fromUInt8(data.subarray(off + 4, off + 4 + nhLen));
                    const snpaOff = off + 4 + nhLen;
                    // skip SNPA count byte
                    const nlriOff = snpaOff + 1;
                    const nlri6 = decodePrefixes(data, nlriOff, valEnd, 16);
                    result.mp6Reach = { nextHop: nh6, nlri: nlri6 };
                }
                break;
            }
            case PA_MP_UNREACH_NLRI: { // RFC 4760 §4
                const afi  = read16BE(data, off);
                const safi = data[off + 2];
                if (afi === AFI_IPV6 && safi === SAFI_UNICAST) {
                    result.mp6Unreach = decodePrefixes(data, off + 3, valEnd, 16);
                }
                break;
            }
        }
        off = valEnd;
    }
    return result;
}

/**
 * @param {Uint8Array} data
 * @param {number} off
 * @param {number} end
 * @returns {number[]}
 */
function parseASPath(data, off, end) {
    const asns = [];
    while (off + 2 <= end) {
        /* const segType = */ off++; // skip segment type
        const count = data[off++];
        for (let i = 0; i < count && off + 2 <= end; i++) {
            asns.push(read16BE(data, off));
            off += 2;
        }
    }
    return asns;
}

/**
 * @param {Uint8Array} data
 * @param {number} off
 * @param {number} end
 * @param {4|16} addrLen  4 for IPv4, 16 for IPv6
 * @returns {Array<{dst: IPAddress, prefLen: number}>}
 */
function decodePrefixes(data, off, end, addrLen = 4) {
    const result = [];
    while (off < end) {
        const prefLen = data[off++];
        const octets  = Math.ceil(prefLen / 8);
        if (off + octets > end) break;
        const addrBytes = new Uint8Array(addrLen);
        addrBytes.set(data.subarray(off, off + octets));
        off += octets;
        result.push({ dst: IPAddress.fromUInt8(addrBytes), prefLen });
    }
    return result;
}
