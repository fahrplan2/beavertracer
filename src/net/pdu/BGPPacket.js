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
export const PA_ORIGIN     = 1;
export const PA_AS_PATH    = 2;
export const PA_NEXT_HOP   = 3;
export const PA_MED        = 4;
export const PA_LOCAL_PREF = 5;

// ORIGIN values
export const ORIGIN_IGP        = 0;
export const ORIGIN_INCOMPLETE = 2;

// AS_PATH segment types
export const AS_SEQUENCE = 2;

// Attribute flags
export const ATTR_TRANSITIVE = 0x40;
export const ATTR_OPTIONAL   = 0x80;

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
    const body = new Uint8Array(10);
    body[0] = BGP_VERSION;
    write16BE(body, 1, localAS & 0xffff);
    write16BE(body, 3, holdTime & 0xffff);
    body.set(routerId.toUInt8(), 5);
    body[9] = 0; // no optional parameters
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
 * }} opts
 * @returns {Uint8Array}
 */
export function buildUpdate({ withdrawn, nextHop, asPath, localPref, med, nlri }) {
    // Withdrawn routes
    const wdrParts = withdrawn.map(encodePrefix);
    const wdrBytes = concat(wdrParts);
    const wdrLenBuf = new Uint8Array(2);
    write16BE(wdrLenBuf, 0, wdrBytes.length);

    // Path attributes (only when NLRI is non-empty)
    let paBytes = new Uint8Array(0);
    if (nlri.length > 0) {
        paBytes = buildPathAttrs(nextHop, asPath, localPref, med);
    }
    const paLenBuf = new Uint8Array(2);
    write16BE(paLenBuf, 0, paBytes.length);

    // NLRI
    const nlriBytes = concat(nlri.map(encodePrefix));

    const body = concat([wdrLenBuf, wdrBytes, paLenBuf, paBytes, nlriBytes]);
    return buildMessage(BGP_MSG_UPDATE, body);
}

/**
 * @param {IPAddress} nextHop
 * @param {number[]} asPath
 * @param {number} localPref
 * @param {number} med
 * @returns {Uint8Array}
 */
function buildPathAttrs(nextHop, asPath, localPref, med) {
    const parts = [];

    // ORIGIN: well-known mandatory, IGP (0)
    parts.push(new Uint8Array([ATTR_TRANSITIVE, PA_ORIGIN, 1, ORIGIN_IGP]));

    // AS_PATH: well-known mandatory
    const asPathBody = buildASPath(asPath);
    const asPathHdr  = new Uint8Array([ATTR_TRANSITIVE, PA_AS_PATH, asPathBody.length]);
    parts.push(concat([asPathHdr, asPathBody]));

    // NEXT_HOP: well-known mandatory (4 bytes IPv4)
    const nhBytes = nextHop.toUInt8();
    parts.push(new Uint8Array([ATTR_TRANSITIVE, PA_NEXT_HOP, 4, ...nhBytes]));

    // LOCAL_PREF: well-known discretionary (4 bytes)
    parts.push(new Uint8Array([ATTR_TRANSITIVE, PA_LOCAL_PREF, 4, ...u32bytes(localPref)]));

    // MED: optional non-transitive (4 bytes)
    parts.push(new Uint8Array([ATTR_OPTIONAL, PA_MED, 4, ...u32bytes(med)]));

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
 *   attrs: { asPath: number[], nextHop: IPAddress|null, localPref: number, med: number },
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

/** @returns {{ asPath: number[], nextHop: IPAddress|null, localPref: number, med: number }} */
function emptyAttrs() {
    return { asPath: [], nextHop: null, localPref: 100, med: 0 };
}

/**
 * @param {Uint8Array} data
 * @param {number} off
 * @param {number} end
 * @returns {{ asPath: number[], nextHop: IPAddress|null, localPref: number, med: number }}
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
 * @returns {Array<{dst: IPAddress, prefLen: number}>}
 */
function decodePrefixes(data, off, end) {
    const result = [];
    while (off < end) {
        const prefLen = data[off++];
        const octets  = Math.ceil(prefLen / 8);
        if (off + octets > end) break;
        const addrBytes = new Uint8Array(4);
        addrBytes.set(data.subarray(off, off + octets));
        off += octets;
        result.push({ dst: IPAddress.fromUInt8(addrBytes), prefLen });
    }
    return result;
}
