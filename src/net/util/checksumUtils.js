//@ts-check

/**
 * One's complement checksum over one or more Uint8Array buffers.
 * Odd-length buffers are implicitly padded with a zero byte.
 *
 * @param {Uint8Array[]} bufs
 * @returns {number} 16-bit checksum
 */
export function onesComplementChecksum(bufs) {
  let sum = 0;
  for (const b of bufs) {
    if (!(b instanceof Uint8Array)) throw new Error("checksum buffers must be Uint8Array");
    let i = 0;
    for (; i + 1 < b.length; i += 2) {
      sum += (b[i] << 8) | b[i + 1];
      sum = (sum & 0xffff) + (sum >>> 16);
    }
    if (i < b.length) {
      sum += b[i] << 8;
      sum = (sum & 0xffff) + (sum >>> 16);
    }
  }
  return (~sum) & 0xffff;
}

/**
 * Build IPv4 pseudo-header and compute checksum.
 * Pseudo-header layout: src(4) + dst(4) + zero(1) + protocol(1) + length(2)
 *
 * @param {Uint8Array} segment  transport segment with checksum bytes zeroed
 * @param {Uint8Array} srcIp    4 bytes
 * @param {Uint8Array} dstIp    4 bytes
 * @param {number}     protocol IP protocol number (6 = TCP, 17 = UDP)
 * @returns {number} 16-bit checksum
 */
export function computeIPv4PseudoChecksum(segment, srcIp, dstIp, protocol) {
  if (!(segment instanceof Uint8Array)) throw new Error("segment must be Uint8Array");
  if (!(srcIp instanceof Uint8Array) || srcIp.length !== 4) throw new Error("srcIp must be Uint8Array(4)");
  if (!(dstIp instanceof Uint8Array) || dstIp.length !== 4) throw new Error("dstIp must be Uint8Array(4)");

  const len = segment.length;
  const pseudo = new Uint8Array(12);
  pseudo.set(srcIp, 0);
  pseudo.set(dstIp, 4);
  pseudo[9]  = protocol & 0xff;
  pseudo[10] = (len >> 8) & 0xff;
  pseudo[11] = len & 0xff;

  return onesComplementChecksum([pseudo, segment]);
}

/**
 * Build IPv6 pseudo-header and compute checksum.
 * Pseudo-header layout: src(16) + dst(16) + length(4) + zeros(3) + nextHeader(1)
 *
 * @param {Uint8Array} segment    transport segment with checksum bytes zeroed
 * @param {Uint8Array} srcIp      16 bytes
 * @param {Uint8Array} dstIp      16 bytes
 * @param {number}     nextHeader next-header number (17 = UDP, 58 = ICMPv6)
 * @returns {number} 16-bit checksum
 */
export function computeIPv6PseudoChecksum(segment, srcIp, dstIp, nextHeader) {
  if (!(segment instanceof Uint8Array)) throw new Error("segment must be Uint8Array");
  if (!(srcIp instanceof Uint8Array) || srcIp.length !== 16) throw new Error("srcIp must be Uint8Array(16)");
  if (!(dstIp instanceof Uint8Array) || dstIp.length !== 16) throw new Error("dstIp must be Uint8Array(16)");

  const len = segment.length;
  const pseudo = new Uint8Array(40);
  pseudo.set(srcIp, 0);
  pseudo.set(dstIp, 16);
  pseudo[32] = (len >>> 24) & 0xff;
  pseudo[33] = (len >>> 16) & 0xff;
  pseudo[34] = (len >>> 8)  & 0xff;
  pseudo[35] =  len         & 0xff;
  // pseudo[36..38] = 0
  pseudo[39] = nextHeader & 0xff;

  return onesComplementChecksum([pseudo, segment]);
}
