//@ts-check

/**
 * Wireshark (Wiregasm) as a test oracle: dissect raw IPv4/UDP datagrams and
 * return every frame's protocol tree as indented text lines.
 */

import { fileURLToPath } from 'node:url';

/** @type {Promise<any>|null} */
let wgPromise = null;

async function wiregasm() {
  wgPromise ??= (async () => {
    // @ts-ignore no types for the emscripten entry point
    const { default: load } = await import('@goodtools/wiregasm/dist/wiregasm');
    const base = fileURLToPath(new URL('../../node_modules/@goodtools/wiregasm/dist/', import.meta.url));
    const wg = await load({ locateFile: (/** @type {string} */ p) => base + p, print: () => {}, printErr: () => {} });
    wg.init();
    wg.FS.mkdirTree('/uploads');
    return wg;
  })();
  return wgPromise;
}

/**
 * @param {Array<{ dir: 'c2s'|'s2c', bytes: Uint8Array }>} datagrams client 10.0.0.2:50000 <-> server 10.0.0.1:<serverPort>
 * @param {number} serverPort
 */
function pcapOf(datagrams, serverPort) {
  const parts = [];
  const gh = Buffer.alloc(24);
  gh.writeUInt32LE(0xa1b2c3d4, 0); gh.writeUInt16LE(2, 4); gh.writeUInt16LE(4, 6);
  gh.writeUInt32LE(65535, 16); gh.writeUInt32LE(101, 20); // LINKTYPE_RAW (IPv4)
  parts.push(gh);
  datagrams.forEach((d, i) => {
    const c2s = d.dir === 'c2s';
    const udp = Buffer.alloc(8 + d.bytes.length);
    udp.writeUInt16BE(c2s ? 50000 : serverPort, 0); udp.writeUInt16BE(c2s ? serverPort : 50000, 2);
    udp.writeUInt16BE(udp.length, 4);
    Buffer.from(d.bytes).copy(udp, 8);
    const ip = Buffer.alloc(20);
    ip[0] = 0x45; ip.writeUInt16BE(20 + udp.length, 2); ip[8] = 64; ip[9] = 17;
    ip.set(c2s ? [10, 0, 0, 2] : [10, 0, 0, 1], 12); ip.set(c2s ? [10, 0, 0, 1] : [10, 0, 0, 2], 16);
    let sum = 0;
    for (let j = 0; j < 20; j += 2) sum += ip.readUInt16BE(j);
    while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
    ip.writeUInt16BE(~sum & 0xffff, 10);
    const pkt = Buffer.concat([ip, udp]);
    const rh = Buffer.alloc(16);
    rh.writeUInt32LE(1700000000 + i, 0); rh.writeUInt32LE(pkt.length, 8); rh.writeUInt32LE(pkt.length, 12);
    parts.push(rh, pkt);
  });
  return Buffer.concat(parts);
}

let fileNo = 0;

/**
 * @param {Array<{ dir: 'c2s'|'s2c', bytes: Uint8Array }>} datagrams
 * @param {{ serverPort?: number, keylog?: string }} [o] default 443 (QUIC); 53 for DNS;
 *   keylog: NSS key log (SSLKEYLOGFILE) contents for TLS/QUIC decryption
 * @returns {Promise<{ frames: string[][], summary: string[] }>}
 */
export async function dissectUdp(datagrams, o = {}) {
  return dissectPcap(pcapOf(datagrams, o.serverPort ?? 443), datagrams.length, o.keylog);
}

/** @param {number[]} src @param {number[]} dst @param {number} proto @param {Buffer} payload */
function ipv4(src, dst, proto, payload) {
  const ip = Buffer.alloc(20);
  ip[0] = 0x45; ip.writeUInt16BE(20 + payload.length, 2); ip[8] = 64; ip[9] = proto;
  ip.set(src, 12); ip.set(dst, 16);
  let sum = 0;
  for (let j = 0; j < 20; j += 2) sum += ip.readUInt16BE(j);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  ip.writeUInt16BE(~sum & 0xffff, 10);
  return Buffer.concat([ip, payload]);
}

/** @param {Buffer[]} packets raw IPv4 packets */
function pcapOfPackets(packets) {
  const gh = Buffer.alloc(24);
  gh.writeUInt32LE(0xa1b2c3d4, 0); gh.writeUInt16LE(2, 4); gh.writeUInt16LE(4, 6);
  gh.writeUInt32LE(65535, 16); gh.writeUInt32LE(101, 20);
  const parts = [gh];
  packets.forEach((p, i) => {
    const rh = Buffer.alloc(16);
    rh.writeUInt32LE(1700000000 + i, 0); rh.writeUInt32LE(p.length, 8); rh.writeUInt32LE(p.length, 12);
    parts.push(rh, p);
  });
  return Buffer.concat(parts);
}

/**
 * A TCP connection client 10.0.0.2:50000 <-> server 10.0.0.1:<serverPort>:
 * three-way handshake, then each chunk as segments (max 1400 bytes) with
 * consistent sequence numbers.
 * @param {Array<{ dir: 'c2s'|'s2c', bytes: Uint8Array }>} chunks
 * @param {{ serverPort?: number, keylog?: string }} [o]
 */
export async function dissectTcp(chunks, o = {}) {
  const C = [10, 0, 0, 2], S = [10, 0, 0, 1], cp = 50000, sp = o.serverPort ?? 443;
  let cseq = 1000, sseq = 5000;
  /** @param {boolean} c2s @param {number} flags @param {Buffer} data */
  const seg = (c2s, flags, data) => {
    const h = Buffer.alloc(20);
    h.writeUInt16BE(c2s ? cp : sp, 0); h.writeUInt16BE(c2s ? sp : cp, 2);
    h.writeUInt32BE(c2s ? cseq : sseq, 4); h.writeUInt32BE(c2s ? sseq : cseq, 8);
    h[12] = 0x50; h[13] = flags; h.writeUInt16BE(65535, 14);
    return ipv4(c2s ? C : S, c2s ? S : C, 6, Buffer.concat([h, data]));
  };
  const packets = [seg(true, 0x02, Buffer.alloc(0))];
  cseq++;
  packets.push(seg(false, 0x12, Buffer.alloc(0)));
  sseq++;
  packets.push(seg(true, 0x10, Buffer.alloc(0)));
  for (const ch of chunks) {
    const c2s = ch.dir === 'c2s';
    for (let off = 0; off < ch.bytes.length; off += 1400) {
      const data = Buffer.from(ch.bytes.subarray(off, off + 1400));
      packets.push(seg(c2s, 0x18, data));
      if (c2s) cseq += data.length; else sseq += data.length;
    }
  }
  return dissectPcap(pcapOfPackets(packets), packets.length, o.keylog);
}

/**
 * @param {Buffer} pcap @param {number} count @param {string} [keylog]
 * @returns {Promise<{ frames: string[][], summary: string[] }>}
 */
async function dissectPcap(pcap, count, keylog) {
  const wg = await wiregasm();
  const path = `/uploads/t${fileNo++}.pcap`;
  wg.FS.writeFile(path, pcap);
  const keyPath = `/uploads/keys${fileNo}.log`;
  if (keylog) wg.FS.writeFile(keyPath, keylog);
  wg.setPref('tls', 'keylog_file', keylog ? keyPath : '');
  wg.applyPreferences();
  const datagrams = { length: count };
  const sess = new wg.DissectSession(path);
  try {
    const ret = sess.load();
    if (ret.code !== 0) throw new Error(`wiregasm load failed: ${JSON.stringify(ret)}`);
    /** @type {string[][]} */
    const frames = [];
    /** @param {any} tree @param {number} depth @param {string[]} out */
    const walk = (tree, depth, out) => {
      for (let i = 0; i < tree.size(); i++) {
        const node = tree.get(i);
        out.push('  '.repeat(depth) + node.label);
        walk(node.tree, depth + 1, out);
      }
    };
    for (let no = 1; no <= datagrams.length; no++) {
      /** @type {string[]} */
      const lines = [];
      walk(sess.getFrame(no).tree, 0, lines);
      frames.push(lines);
    }
    const list = sess.getFrames('', 0, datagrams.length).frames;
    /** @type {string[]} */
    const summary = [];
    for (let i = 0; i < list.size(); i++) {
      const f = list.get(i);
      summary.push(Array.from({ length: f.columns.size() }, (_, j) => f.columns.get(j)).join(' | '));
    }
    return { frames, summary };
  } finally {
    sess.delete?.();
    try { wg.FS.unlink(path); } catch { /* ignore */ }
    if (keylog) {
      wg.setPref('tls', 'keylog_file', '');
      wg.applyPreferences();
      try { wg.FS.unlink(keyPath); } catch { /* ignore */ }
    }
  }
}
