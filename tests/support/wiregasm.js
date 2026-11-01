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
 * @param {{ serverPort?: number }} [o] default 443 (QUIC); 53 for DNS
 * @returns {Promise<{ frames: string[][], summary: string[] }>}
 */
export async function dissectUdp(datagrams, o = {}) {
  const wg = await wiregasm();
  const path = `/uploads/t${fileNo++}.pcap`;
  wg.FS.writeFile(path, pcapOf(datagrams, o.serverPort ?? 443));
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
  }
}
