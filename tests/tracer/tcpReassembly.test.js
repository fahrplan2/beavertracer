//@ts-check

/**
 * Wireshark's "Allow subdissector to reassemble TCP streams" (tcp.desegment_tcp_streams),
 * which the PCAP viewer exposes as a switch: off -> every packet shows only its own bytes.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';

/** @param {number[]} src @param {number[]} dst @param {Buffer} payload */
function ipv4tcp(src, dst, payload) {
  const ip = Buffer.alloc(20);
  ip[0] = 0x45; ip.writeUInt16BE(20 + payload.length, 2); ip[8] = 64; ip[9] = 6;
  ip.set(src, 12); ip.set(dst, 16);
  let s = 0;
  for (let j = 0; j < 20; j += 2) s += ip.readUInt16BE(j);
  while (s >> 16) s = (s & 0xffff) + (s >> 16);
  ip.writeUInt16BE(~s & 0xffff, 10);
  return Buffer.concat([ip, payload]);
}

/** @param {number} sp @param {number} dp @param {number} seq @param {number} ack @param {Buffer} data */
function tcp(sp, dp, seq, ack, data) {
  const h = Buffer.alloc(20);
  h.writeUInt16BE(sp, 0); h.writeUInt16BE(dp, 2); h.writeUInt32BE(seq, 4); h.writeUInt32BE(ack, 8);
  h[12] = 0x50; h[13] = 0x18; h.writeUInt16BE(65535, 14);
  return Buffer.concat([h, data]);
}

/** A GET and a 2.6 kB response in three segments, as a raw-IP pcap. */
function httpPcap() {
  const C = [10, 0, 0, 2], S = [10, 0, 0, 1];
  const body = '<html><body>' + 'x'.repeat(2500) + '</body></html>\n';
  const resp = Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
  const req = Buffer.from('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
  const pkts = [ipv4tcp(C, S, tcp(50000, 80, 1000, 5000, req))];
  let seq = 5000;
  for (let o = 0; o < resp.length; o += 1000) {
    const part = resp.subarray(o, o + 1000);
    pkts.push(ipv4tcp(S, C, tcp(80, 50000, seq, 1000 + req.length, part)));
    seq += part.length;
  }
  const gh = Buffer.alloc(24);
  gh.writeUInt32LE(0xa1b2c3d4, 0); gh.writeUInt16LE(2, 4); gh.writeUInt16LE(4, 6);
  gh.writeUInt32LE(65535, 16); gh.writeUInt32LE(101, 20);
  const parts = [gh];
  pkts.forEach((p, i) => {
    const rh = Buffer.alloc(16);
    rh.writeUInt32LE(1700000000 + i, 0); rh.writeUInt32LE(p.length, 8); rh.writeUInt32LE(p.length, 12);
    parts.push(rh, p);
  });
  return { bytes: Buffer.concat(parts), count: pkts.length };
}

describe('TCP reassembly preference in Wiregasm', async () => {
  // @ts-ignore no types for the emscripten entry point
  const { default: load } = await import('@goodtools/wiregasm/dist/wiregasm');
  const base = fileURLToPath(new URL('../../node_modules/@goodtools/wiregasm/dist/', import.meta.url));
  const wg = await load({ locateFile: (/** @type {string} */ p) => base + p, print() {}, printErr() {} });
  wg.init();
  wg.FS.mkdirTree('/uploads');

  /** top-level "filter = label" lines per frame with the given setting */
  function dissect(/** @type {boolean} */ reassemble) {
    wg.setPref('tcp', 'desegment_tcp_streams', reassemble ? 'TRUE' : 'FALSE');
    wg.applyPreferences();
    const { bytes, count } = httpPcap();
    wg.FS.writeFile('/uploads/r.pcap', bytes);
    const sess = new wg.DissectSession('/uploads/r.pcap');
    sess.load();
    const frames = [];
    for (let no = 1; no <= count; no++) {
      const t = sess.getFrame(no).tree;
      const top = [];
      for (let i = 0; i < t.size(); i++) top.push(`${t.get(i).filter} = ${t.get(i).label}`);
      frames.push(top);
    }
    sess.delete();
    return frames;
  }

  it('on: the last segment carries the whole reassembled response', () => {
    const f = dissect(true);
    expect(f[3].some(l => /Reassembled TCP Segments/.test(l))).toBe(true);
    expect(f[3].some(l => l.startsWith('http ='))).toBe(true);
    expect(f[1].some(l => l.startsWith('http ='))).toBe(false); // first segment: no HTTP shown
  });

  it('off: every segment shows only its own bytes', () => {
    const f = dissect(false);
    expect(f.flat().some(l => /Reassembled/.test(l))).toBe(false);
    // the status line and headers are in the first response segment
    expect(f[1].some(l => l.startsWith('http ='))).toBe(true);
    // the others are just the continuation of the body
    expect(f[3].some(l => /Reassembled/.test(l))).toBe(false);
  });
});
