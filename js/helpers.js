//@ts-check

import { SimControl } from "./SimControl.js";


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