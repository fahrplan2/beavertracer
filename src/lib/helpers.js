//@ts-check

/**
 * checks if the object is an UInt8Array
 * @param {Object} x 
 * @returns 
 */
export function assertU8(x) {
    if (!(x instanceof Uint8Array)) throw new Error("Expected Uint8Array");
    return x;
}

/**
 * checks if the object is a valid Mac-Adress (UInt8Array(6))
 * @param {Uint8Array} mac 
 * @returns 
 */

export function assertMac(mac) {
    assertU8(mac);
    if (mac.length !== 6) throw new Error(`MAC must be 6 bytes, got ${mac.length}`);
    return mac;
}


/**
 * Checks if the UInt8Array has the correct length
 * @param {Uint8Array} x 
 * @param {Number} len length
 * @param {String} name name to write in the error message (optional)
 * @returns 
 */

export function assertLenU8(x, len, name = "field") {
    const b = assertU8(x);
    if (b.length !== len) throw new RangeError(`${name} must be length ${len}, got ${b.length}`);
    return b;
}

/**
 * converts 4 octests into an IPNumber
 * @param {Number} a 
 * @param {Number} b 
 * @param {Number} c 
 * @param {Number} d 
 * @returns {Number} IP-Adress
 */

export function IPOctetsToNumber(a, b, c, d) {
    return (
        ((a & 0xFF) << 24) |
        ((b & 0xFF) << 16) |
        ((c & 0xFF) << 8)  |
        (d & 0xFF)
    ) >>> 0;
}

/**
 * Converts an IPNumber into 4 decimal octets
 * @param {Number} ip 
 * @returns {Array<Number>} array
 */

export function IPNumberToOctets(ip) {
    ip >>>= 0;
    return [
        (ip >>> 24) & 0xFF,
        (ip >>> 16) & 0xFF,
        (ip >>> 8)  & 0xFF,
        ip & 0xFF
    ];
}


/**
 * Converts an IPNumber into an UInt8Array
 * @param {Number} ip 
 */
export function IPNumberToUint8(ip) {
    const a = new Uint8Array(4);
    a.set(IPNumberToOctets(ip), 0);
    return a;
}

/**
 * 
 * @param {Uint8Array} ip 
 */
export function IPUInt8ToNumber(ip) {
    return IPOctetsToNumber(ip[0], ip[1], ip[2], ip[3]);
}


/**
 * 
 * 
 * @param {Uint8Array} mac
 */

export function MACToNumber(mac) {
  if (!(mac instanceof Uint8Array) || mac.length !== 6) {
    throw new Error("MAC must be Uint8Array(6)");
  }

  let v = 0n;
  for (const b of mac) {
    v = (v << 8n) | BigInt(b);
  }
  return v;
}

/**
 * sleeps given time
 * @param {Number} ms 
 * @returns 
 */
export async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 
 * @param {Uint8Array} a 
 * @param {Uint8Array} b 
 * @returns 
 */
export function isEqualUint8(a, b) {
    if (a.length != b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] != b[i]) {
            return false;
        }
    }
    return true;
}


/**
 * 
 * @param {Number} bits 
 * @returns 
 */

export function prefixToNetmask(bits) {
    if (bits < 0 || bits > 32) {
        throw new RangeError("Prefix must be between 0 and 32");
    }

    if (bits === 0) return 0;

    return (0xFFFFFFFF << (32 - bits)) >>> 0;
}

/**
 * "255.255.255.0" → prefix length (0..32), or null if not a valid contiguous mask.
 * @param {string} s
 * @returns {number|null}
 */
export function netmaskStrToPrefix(s) {
    const parts = String(s).trim().split(".");
    if (parts.length !== 4) return null;
    const octets = parts.map(Number);
    if (octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    const m = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;

    let seenZero = false;
    let c = 0;
    for (let i = 31; i >= 0; i--) {
        const bit = (m >>> i) & 1;
        if (bit === 1) {
            if (seenZero) return null;
            c++;
        } else {
            seenZero = true;
        }
    }
    return c;
}

/**
 * Prefix length → "255.255.255.0" dotted-decimal string.
 * @param {number} prefix
 * @returns {string}
 */
export function prefixToNetmaskStr(prefix) {
    const p = prefix | 0;
    if (p < 0 || p > 32) throw new RangeError(`Invalid prefix: ${p}`);
    const m = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
    return `${(m >>> 24) & 255}.${(m >>> 16) & 255}.${(m >>> 8) & 255}.${m & 255}`;
}


/**
 * @param {number} n
 */
export function nowStamp(n = Date.now()) {
  const d = new Date(n);
  return d.toLocaleTimeString();
}

/**
 * @param {number} ip
 */
export function ipToString(ip) {
  return `${(ip >>> 24) & 255}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}`;
}

/**
 * @param {Uint8Array} data
 */
export function hexPreview(data) {
  const max = 24;
  const slice = data.slice(0, max);
  let s = "";
  for (let i = 0; i < slice.length; i++) {
    s += slice[i].toString(16).padStart(2, "0");
    if (i < slice.length - 1) s += " ";
  }
  if (data.length > max) s += " …";
  return s;
}


/**
 * Encode as UTF-8 bytes (with fallback).
 * @param {string} s
 */
export function encodeUTF8(s) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  // very small fallback (ASCII only)
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Decode UTF-8 bytes (with fallback).
 * @param {Uint8Array} b
 */
export function decodeUTF8(b) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
  // small fallback (ASCII only)
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}