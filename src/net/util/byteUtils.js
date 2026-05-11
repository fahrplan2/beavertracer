//@ts-check

/** @param {Uint8Array} buf @param {number} off @returns {number} */
export function read16BE(buf, off) {
  return (buf[off] << 8) | buf[off + 1];
}

/** @param {Uint8Array} buf @param {number} off @returns {number} */
export function read32BE(buf, off) {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

/** @param {Uint8Array} buf @param {number} off @param {number} v */
export function write16BE(buf, off, v) {
  buf[off]     = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

/** @param {Uint8Array} buf @param {number} off @param {number} v */
export function write32BE(buf, off, v) {
  const u = v >>> 0;
  buf[off]     = (u >>> 24) & 0xff;
  buf[off + 1] = (u >>> 16) & 0xff;
  buf[off + 2] = (u >>> 8)  & 0xff;
  buf[off + 3] =  u         & 0xff;
}
