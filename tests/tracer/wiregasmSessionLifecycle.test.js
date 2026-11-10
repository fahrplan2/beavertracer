//@ts-check

/**
 * Contract between PCapViewer and Wiregasm's low-level API: the caller owns
 * every DissectSession and must free it with delete(). PCapViewer relies on
 * this when it deletes all sessions before loading a new capture
 * (#loadPcapBytesIntoSession). If Wiregasm ever starts freeing sessions or
 * results itself, PCapViewer's delete() would hit an already deleted object
 * and its try/catch would hide the error, so these tests catch it instead.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { tcpPcap } from '../support/wiregasm.js';

describe('Wiregasm DissectSession lifecycle', async () => {
  // @ts-ignore no types for the emscripten entry point
  const { default: load } = await import('@goodtools/wiregasm/dist/wiregasm');
  const base = fileURLToPath(new URL('../../node_modules/@goodtools/wiregasm/dist/', import.meta.url));
  const wg = await load({ locateFile: (/** @type {string} */ p) => base + p, print() {}, printErr() {} });
  wg.init();
  wg.FS.mkdirTree('/uploads');

  /** @param {string} path @param {string} body */
  function openSession(path, body) {
    const { pcap, count } = tcpPcap([
      { dir: 'c2s', bytes: Buffer.from(`GET /${body} HTTP/1.1\r\nHost: x\r\n\r\n`) },
    ], { serverPort: 80 });
    wg.FS.writeFile(path, pcap);
    const sess = new wg.DissectSession(path);
    const ret = sess.load();
    expect(ret.code).toBe(0);
    return { sess, count };
  }

  it('a loaded session stays alive until the caller deletes it', () => {
    const { sess } = openSession('/uploads/life1.pcap', 'a');
    expect(sess.isDeleted()).toBe(false);
    sess.getFrames('', 0, 0);
    sess.getFrame(1);
    expect(sess.isDeleted()).toBe(false);
    sess.delete();
    expect(sess.isDeleted()).toBe(true);
  });

  it('deleting a session twice throws (so PCapViewer must delete exactly once)', () => {
    const { sess } = openSession('/uploads/life2.pcap', 'b');
    sess.delete();
    expect(() => sess.delete()).toThrow();
  });

  it('results returned by getFrame/getFrames are still readable after the call', () => {
    const { sess, count } = openSession('/uploads/life3.pcap', 'c');
    const list = sess.getFrames('', 0, count).frames;
    expect(list.size()).toBe(count);
    const tree = sess.getFrame(count).tree;
    expect(tree.size()).toBeGreaterThan(0);
    expect(typeof tree.get(0).label).toBe('string');
    sess.delete();
  });

  it('PCapViewer flow: delete the old session, then a new capture dissects cleanly', () => {
    const first = openSession('/uploads/flow1.pcap', 'first');
    first.sess.delete();
    const second = openSession('/uploads/flow2.pcap', 'second');
    const labels = [];
    const tree = second.sess.getFrame(second.count).tree;
    /** @param {any} t */
    const walk = (t) => { for (let i = 0; i < t.size(); i++) { labels.push(t.get(i).label); walk(t.get(i).tree); } };
    walk(tree);
    expect(labels.some(l => l.includes('/second'))).toBe(true);
    expect(labels.some(l => l.includes('/first'))).toBe(false);
    second.sess.delete();
  });
});
