//@ts-check

import { IPAddress } from '../../src/net/models/IPAddress.js';

/**
 * In-memory TCP network shared by a client app and a server app in tests.
 * Every connection has a server-side ("sN") and a client-side ("cN") key;
 * closing one side signals EOF to the other (like a FIN).
 */

export function makeQueue() {
  /** @type {any[]} */
  const pending = [];
  let closed = false;
  /** @type {((v: any) => void) | null} */
  let waiter = null;
  return {
    push(/** @type {any} */ v) {
      if (closed) return;
      if (waiter) { const w = waiter; waiter = null; w(v); } else pending.push(v);
    },
    close() {
      if (closed) return;
      closed = true;
      if (waiter) { const w = waiter; waiter = null; w(null); }
    },
    /** @returns {Promise<any>} */
    next() {
      if (pending.length) return Promise.resolve(pending.shift());
      if (closed) return Promise.resolve(null);
      return new Promise(r => { waiter = r; });
    },
  };
}

export function makeLinkedNet() {
  let next = 0;
  /** @type {Map<number, ReturnType<typeof makeQueue>>} */
  const listeners = new Map(); // port -> accept queue
  /** @type {Map<string, { inbox: ReturnType<typeof makeQueue>, peer: string }>} */
  const ends = new Map();
  const stats = { connects: 0, udpSent: 0, udpDropped: 0 };
  /** @type {Map<number, ReturnType<typeof makeQueue>>} */
  const udp = new Map();
  /**
   * blockUdp: simulate a firewall that drops all UDP.
   * udpSrc: source address reported for every datagram (one shared host namespace).
   */
  const control = { blockUdp: false, udpSrc: '10.0.0.2' };

  const net = {
    openTCPServerSocket(/** @type {any} */ _ip, /** @type {number} */ port) {
      listeners.set(port, makeQueue());
      return port;
    },
    closeTCPServerSocket(/** @type {number} */ ref) { listeners.get(ref)?.close(); listeners.delete(ref); },
    acceptTCPConn(/** @type {number} */ ref) { return listeners.get(ref)?.next() ?? Promise.resolve(null); },
    async connectTCPConn(/** @type {any} */ _ip, /** @type {number} */ port) {
      const q = listeners.get(port);
      if (!q) throw new Error('connection refused');
      stats.connects++;
      const n = ++next;
      const ck = `c${n}`, sk = `s${n}`;
      ends.set(ck, { inbox: makeQueue(), peer: sk });
      ends.set(sk, { inbox: makeQueue(), peer: ck });
      q.push(sk);
      return { key: ck };
    },
    recvTCPConn(/** @type {string} */ k) { return ends.get(k)?.inbox.next() ?? Promise.resolve(null); },
    sendTCPConn(/** @type {string} */ k, /** @type {Uint8Array} */ d) {
      const e = ends.get(k);
      if (!e) throw new Error('not connected');
      ends.get(e.peer)?.inbox.push(d);
    },
    closeTCPConn(/** @type {string} */ k) {
      const e = ends.get(k);
      if (!e) return;
      ends.get(e.peer)?.inbox.close();
      e.inbox.close();
      ends.delete(k);
    },
    getTCPConnInfo() { return null; },

    // ── UDP: one shared port space, delivery by destination port ──
    openUDPSocket(/** @type {any} */ _bind, /** @type {number} */ port) {
      if (udp.has(port)) throw new Error('Port is in use');
      udp.set(port, makeQueue());
      return port;
    },
    sendUDPSocket(/** @type {number} */ port, /** @type {any} */ _dst, /** @type {number} */ dstPort, /** @type {Uint8Array} */ data) {
      stats.udpSent++;
      if (control.blockUdp) { stats.udpDropped++; return Promise.resolve(); }
      udp.get(dstPort)?.push({ src: IPAddress.fromString(control.udpSrc), srcPort: port, payload: data.slice() });
      return Promise.resolve();
    },
    recvUDPSocket(/** @type {number} */ port) { return udp.get(port)?.next() ?? Promise.resolve(null); },
    closeUDPSocket(/** @type {number} */ port) { udp.get(port)?.close(); udp.delete(port); },
  };
  return { net, stats, control, openEnds: () => ends.size, udpPorts: () => [...udp.keys()] };
}

/** @param {Record<string,string>} files */
export function makeFS(files) {
  return {
    mkdir() {},
    readFile(/** @type {string} */ p) {
      if (p in files) return files[p];
      throw new Error('ENOENT');
    },
    exists(/** @type {string} */ p) { return p in files; },
    writeFile(/** @type {string} */ p, /** @type {string} */ d) { files[p] = d; },
  };
}
