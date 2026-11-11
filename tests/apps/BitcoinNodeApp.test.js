//@ts-check

/**
 * Multi-node tests for BitcoinNodeApp: several nodes in a virtual TCP mesh
 * (one IP per node), real handshake/inv/getdata/getblocks traffic.
 * Focus: sync, forks, "longest chain wins" reorgs and tx handling.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { BitcoinNodeApp, _internals, COINBASE_MATURITY } from '../../src/apps/BitcoinNodeApp.js';
import * as BC from '../../src/apps/lib/BitcoinCrypto.js';
import { makeQueue, makeFS } from '../support/linkedNet.js';

if (!globalThis.document) {
  const makeFakeEl = () => {
    const el = {
      classList: { add() {}, remove() {} }, style: {}, disabled: false, value: '', textContent: '',
      replaceChildren() {}, appendChild() { return el; }, addEventListener() {}, setAttribute() {},
    };
    return el;
  };
  // @ts-ignore
  globalThis.document = { createElement: () => makeFakeEl(), createTextNode: () => ({}) };
}

/** Virtual mesh: every node gets its own `net` facade bound to an IP. */
function makeMesh() {
  let next = 0;
  /** @type {Map<string, ReturnType<typeof makeQueue>>} "ip:port" → accept queue */
  const listeners = new Map();
  /** @type {Map<string, { inbox: ReturnType<typeof makeQueue>, peer: string }>} */
  const ends = new Map();

  /** @param {string} ip */
  function netFor(ip) {
    return {
      openTCPServerSocket(/** @type {any} */ _ip, /** @type {number} */ port) {
        const ref = `${ip}:${port}`;
        listeners.set(ref, makeQueue());
        return ref;
      },
      closeTCPServerSocket(/** @type {string} */ ref) { listeners.get(ref)?.close(); listeners.delete(ref); },
      acceptTCPConn(/** @type {string} */ ref) { return listeners.get(ref)?.next() ?? Promise.resolve(null); },
      async connectTCPConn(/** @type {any} */ dst, /** @type {number} */ port) {
        const q = listeners.get(`${dst.toString()}:${port}`);
        if (!q) throw new Error('connection refused');
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
        ends.delete(e.peer);
      },
    };
  }

  /** Cut every connection (network partition), listeners stay up. */
  function cutAll() {
    for (const k of [...ends.keys()]) {
      const e = ends.get(k);
      if (!e) continue;
      e.inbox.close(); ends.get(e.peer)?.inbox.close();
      ends.delete(k); ends.delete(e.peer);
    }
  }

  return { netFor, cutAll };
}

/** @type {BitcoinNodeApp[]} */
let nodes = [];

/**
 * Most scenarios are about forks and double spends, not about reward
 * maturity – they use maturity 1 (rewards spendable in the next block).
 * @param {ReturnType<typeof makeMesh>} mesh @param {string} ip @param {{maturity?: number}} [opts]
 */
async function makeNode(mesh, ip, opts = {}) {
  const app = new BitcoinNodeApp(/** @type {any} */ ({ net: mesh.netFor(ip), fs: makeFS({}), dns: null }));
  app.coinbaseMaturity = opts.maturity ?? 1;
  await app._loadConfig();
  await app._start();
  nodes.push(app);
  return app;
}

/** Let the async message loops run until `cond` holds. @param {() => boolean} cond */
async function until(cond, label = 'condition') {
  for (let i = 0; i < 2000; i++) {
    if (cond()) return;
    await new Promise(r => setTimeout(r, 0));
  }
  throw new Error(`timeout waiting for ${label}`);
}

/** @param {BitcoinNodeApp} n */
const tip = n => n.chain.at(-1)?.id;

/** @param {BitcoinNodeApp} a @param {string} ip */
async function connect(a, ip) {
  const before = a.peers.size;
  await a._connectToSeed(ip);
  await until(() => [...a.peers.values()].filter(p => p.ready).length > before, 'handshake');
}

afterEach(() => { for (const n of nodes) n._stop(); nodes = []; });

/** @param {BitcoinNodeApp} n @param {string} to @param {string} amount @param {string} [target] */
const pay = (n, to, amount, target = 'all') => n._send(to, amount, target);

/** connKey of the peer with address `addr`. @param {BitcoinNodeApp} n @param {string} addr */
const peerKey = (n, addr) => /** @type {string} */ ([...n.peers].find(([, p]) => p.addr === addr)?.[0]);

const freshAddress = async () => (await BC.generateWallet()).address;

describe('BitcoinNodeApp – chain sync and longest-chain rule', () => {
  it('a new node downloads the existing chain', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    a._mine(); a._mine(); a._mine();
    const b = await makeNode(mesh, '10.0.0.2');
    await connect(b, '10.0.0.1');
    await until(() => tip(b) === tip(a), 'sync');
    expect(b.chain.map(x => x.id)).toEqual(a.chain.map(x => x.id));
    expect(b.chain.at(-1)?.height).toBe(2);
  });

  it('newly mined blocks propagate over multiple hops', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    const b = await makeNode(mesh, '10.0.0.2');
    const c = await makeNode(mesh, '10.0.0.3');
    await connect(b, '10.0.0.1');
    await connect(c, '10.0.0.2');      // A – B – C
    a._mine();
    await until(() => c.chain.length === 1, 'genesis at C');
    c._mine();
    await until(() => a.chain.length === 2, 'block from C at A');
    expect(tip(a)).toBe(tip(c));
    expect(tip(b)).toBe(tip(c));
  });

  it('after a partition the longer fork wins on both sides (reorg)', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    const b = await makeNode(mesh, '10.0.0.2');
    await connect(b, '10.0.0.1');
    a._mine(); a._mine();
    await until(() => tip(b) === tip(a), 'common prefix');
    const common = tip(a);

    mesh.cutAll();
    await until(() => a.peers.size === 0 && b.peers.size === 0, 'partition');

    a._mine();                       // A: common + 1
    b._mine(); b._mine(); b._mine(); // B: common + 3
    const aOnly = tip(a);
    expect(a.chain.at(-2)?.id).toBe(common);

    await connect(a, '10.0.0.2');
    await until(() => tip(a) === tip(b), 'reorg');
    expect(a.chain.at(-1)?.height).toBe(4);
    // A's own block is still known but no longer on the active chain
    expect(a.blockMap.has(/** @type {string} */ (aOnly))).toBe(true);
    expect(a.chain.some(x => x.id === aOnly)).toBe(false);
    expect(a.log.some(l => /reorg/i.test(l))).toBe(true);
    // B also learned the stale block but did not switch
    await until(() => b.blockMap.has(/** @type {string} */ (aOnly)), 'stale block at B');
    expect(b.chain.at(-1)?.height).toBe(4);
  });

  it('on equal length each node keeps its first-seen tip until the fork is resolved', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    const b = await makeNode(mesh, '10.0.0.2');
    await connect(b, '10.0.0.1');
    a._mine();
    await until(() => tip(b) === tip(a), 'genesis');

    mesh.cutAll();
    await until(() => a.peers.size === 0 && b.peers.size === 0, 'partition');
    a._mine();
    b._mine();
    const aTip = tip(a), bTip = tip(b);

    await connect(a, '10.0.0.2');
    await until(() => a.blockMap.size === 3 && b.blockMap.size === 3, 'both forks known');
    expect(tip(a)).toBe(aTip);
    expect(tip(b)).toBe(bTip);

    b._mine();                       // B's fork becomes longer
    await until(() => tip(a) === tip(b), 'fork resolved');
    expect(a.chain.at(-2)?.id).toBe(bTip);
  });

  it('a long fork arriving via a single inv is fetched through getblocks', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    const b = await makeNode(mesh, '10.0.0.2');
    for (let i = 0; i < 25; i++) b._mine();   // independent chain, own genesis
    a._mine(); a._mine();
    await connect(a, '10.0.0.2');
    await until(() => tip(a) === tip(b), 'sync to longer chain');
    expect(a.chain.length).toBe(25);
    expect(a.orphans.size).toBe(0);
  });
});

describe('BitcoinNodeApp – transactions', () => {
  it('tx is relayed, mined by another node and confirmed everywhere', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    const b = await makeNode(mesh, '10.0.0.2');
    await connect(b, '10.0.0.1');
    a._mine();                                       // A owns 1 BTC
    await until(() => b.chain.length === 1, 'block');

    await pay(a, b.walletAddr, '0.25');
    expect(a.mempool.size).toBe(1);
    await until(() => b.mempool.size === 1, 'tx relay');
    const [txId] = b.mempool.keys();
    expect([...a.mempool.keys()]).toEqual([txId]);  // same ID on both nodes

    b._mine();
    await until(() => a.chain.length === 2, 'block with tx');
    expect(a.mempool.size).toBe(0);
    expect(a.chain[1].txs).toEqual([txId]);
    expect(a._computeBalances().get(a.walletAddr)).toBe(0.75e8);
    expect(a._computeBalances().get(b.walletAddr)).toBe(1.25e8);
    expect(b._computeBalances()).toEqual(a._computeBalances());
  });

  it('txs from a dropped fork go back to the mempool', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    const b = await makeNode(mesh, '10.0.0.2');
    await connect(b, '10.0.0.1');
    a._mine();
    await until(() => tip(b) === tip(a), 'genesis');

    mesh.cutAll();
    await until(() => a.peers.size === 0 && b.peers.size === 0, 'partition');
    const someone = await freshAddress();
    await pay(a, someone, '0.5');    // only A knows the tx
    a._mine();                       // confirmed on A's fork
    expect(a.mempool.size).toBe(0);
    expect(a._computeBalances().get(someone)).toBe(0.5e8);
    b._mine(); b._mine();            // longer fork without the tx

    await connect(a, '10.0.0.2');
    await until(() => tip(a) === tip(b), 'reorg');
    expect(a.mempool.size).toBe(1);  // tx unconfirmed again
    expect(a._computeBalances().get(someone)).toBeUndefined();
    // B learned the tx from A's stale block → it can be mined again
    await until(() => b.mempool.size === 1, 'tx known at B');
    b._mine();
    await until(() => tip(a) === tip(b), 'confirmed again');
    expect(a._computeBalances().get(someone)).toBe(0.5e8);
  });

  it('rejects a tx with an invalid recipient address (checksum)', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    a._mine();
    const addr = await freshAddress();
    const typo = addr.slice(0, -1) + (addr.endsWith('a') ? 'b' : 'a');
    await pay(a, typo, '0.1');
    expect(a.mempool.size).toBe(0);
    await pay(a, addr, '0.1');
    expect(a.mempool.size).toBe(1);
  });

  it('a tx with a tampered amount fails signature verification', async () => {
    const w = await BC.generateWallet();
    const raw = await _internals.signedTx(w, await freshAddress(), 1e7);
    const ok = await _internals.verifyTx(raw);
    expect(ok?.from).toBe(w.address);
    const forged = raw.slice();
    const p = /** @type {NonNullable<ReturnType<typeof _internals.parseTx>>} */ (_internals.parseTx(raw));
    const satOff = 42 + p.scriptSig.length + 5;
    forged[satOff + 3] = 0x10;                       // 1e7 sat → much more
    expect(await _internals.verifyTx(forged)).toBeNull();
  });

  it('nobody can spend from a foreign address (pubkey ≠ sender)', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    const b = await makeNode(mesh, '10.0.0.2');
    await connect(b, '10.0.0.1');
    a._mine();                                       // A owns 1 BTC
    await until(() => b.chain.length === 1, 'block');
    // B signs a payment "from A" with its own key → sender is derived from
    // the public key, so it is a payment from B, which owns nothing.
    const raw = await _internals.signedTx(/** @type {any} */ (b.wallet), b.walletAddr, 0.5e8);
    await a._onTx(raw, 'x');
    expect(a.mempool.size).toBe(0);
    expect(a.log.at(-1)).toMatch(/txrejected/);
  });

  it('double spend: of two conflicting txs the mempool keeps the first, the longer chain decides', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    const b = await makeNode(mesh, '10.0.0.2');
    const c = await makeNode(mesh, '10.0.0.3');
    await connect(b, '10.0.0.1');
    await connect(c, '10.0.0.1');
    a._mine();                                       // A owns 1 BTC
    await until(() => b.chain.length === 1 && c.chain.length === 1, 'genesis');
    mesh.cutAll();
    await until(() => a.peers.size + b.peers.size + c.peers.size === 0, 'partition');

    const w = /** @type {any} */ (a.wallet);
    const tx1 = await _internals.signedTx(w, b.walletAddr, 0.8e8);   // A pays B …
    const tx2 = await _internals.signedTx(w, c.walletAddr, 0.8e8);   // … and C with the same coin
    await b._onTx(tx1, 'x'); await b._onTx(tx2, 'x');
    expect(b.mempool.size).toBe(1);                  // first seen wins
    await c._onTx(tx2, 'x');

    b._mine();                                       // B confirms tx1
    c._mine(); c._mine();                            // C confirms tx2 and is longer
    expect(b._computeBalances().get(b.walletAddr)).toBe(1.8e8);

    await connect(b, '10.0.0.3');
    await until(() => tip(b) === tip(c), 'reorg');
    expect(b._computeBalances().get(b.walletAddr) ?? 0).toBe(0); // payment to B is gone
    expect(b._computeBalances().get(c.walletAddr)).toBe(2.8e8);
    expect(b.mempool.size).toBe(0);                  // tx1 no longer coverable
  });

  it('honest nodes reject blocks of a manipulated miner, even if that chain is longer', async () => {
    const mesh = makeMesh();
    const m = await makeNode(mesh, '10.0.0.1');      // manipulated client
    const b = await makeNode(mesh, '10.0.0.2');
    await connect(b, '10.0.0.1');
    b._mine();
    await until(() => m.chain.length === 1, 'genesis');

    // M patches its client: it believes it owns 100 BTC and pays itself from nothing.
    const realBalances = m._balancesAt.bind(m);
    m._balancesAt = id => { const bal = realBalances(id); bal.set(m.walletAddr, 100e8); return bal; };
    await pay(m, await freshAddress(), '50');
    m._mine(); m._mine(); m._mine();
    expect(m.chain.length).toBe(4);

    await until(() => b.invalid.size >= 1, 'rejection');
    await new Promise(r => setTimeout(r, 20));
    expect(b.chain.length).toBe(1);
    expect(b.log.some(l => /blockinvalid|abgelehnt|rejected/i.test(l))).toBe(true);
    b._mine();                                       // honest chain continues
    expect(b.chain.length).toBe(2);
  });
});

describe('BitcoinNodeApp – wallet and confirmations', () => {
  it('address is derived from the key and survives a restart', async () => {
    const mesh = makeMesh();
    const files = {};
    const os = /** @type {any} */ ({ net: mesh.netFor('10.0.0.1'), fs: makeFS(files), dns: null });
    const a1 = new BitcoinNodeApp(os);
    await a1._loadConfig();
    expect(a1.walletAddr).toMatch(/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/);
    expect(await BC.isValidAddress(a1.walletAddr)).toBe(true);
    expect(files['/etc/bitcoin.wallet']).toContain('privateKey');
    const a2 = new BitcoinNodeApp(os);
    await a2._loadConfig();
    expect(a2.walletAddr).toBe(a1.walletAddr);
  });

  it('counts confirmations of own transactions', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    a._mine();
    await pay(a, await freshAddress(), '0.3');
    expect(a._walletHistory()[0]).toMatchObject({ sats: -0.3e8, conf: 0 });
    a._mine();
    expect(a._walletHistory().find(r => r.sats === -0.3e8)?.conf).toBe(1);
    for (let i = 0; i < 5; i++) a._mine();
    expect(a._walletHistory().find(r => r.sats === -0.3e8)?.conf).toBe(6);
    // genesis reward has 7 confirmations
    expect(a._walletHistory().at(-1)).toMatchObject({ sats: 1e8, conf: 7 });
  });
});

describe('BitcoinNodeApp – double-spend building blocks', () => {
  it('re-spend: own node prefers the new tx, peers keep the first one they saw', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    const b = await makeNode(mesh, '10.0.0.2');
    await connect(b, '10.0.0.1');
    a._mine();
    await until(() => b.chain.length === 1, 'genesis');
    const tx1 = /** @type {any} */ (await pay(a, b.walletAddr, '0.8'));
    await until(() => b.mempool.size === 1, 'tx1');
    const tx2 = /** @type {any} */ (await a._respend(tx1.id));       // back to myself, to all peers
    expect(tx2.input).toBe(tx1.input);
    expect([...a.mempool.keys()]).toEqual([tx2.id]);
    await until(() => b.log.some(l => /txrejected/.test(l)), 'B rejects tx2');
    expect([...b.mempool.keys()]).toEqual([tx1.id]);
  });

  it('race attack: different peers get different versions, the next block settles it', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');      // attacker
    const b = await makeNode(mesh, '10.0.0.2');      // merchant
    const c = await makeNode(mesh, '10.0.0.3');
    a._mine();
    await connect(a, '10.0.0.2');
    await connect(a, '10.0.0.3');
    await connect(c, '10.0.0.2');                    // B and C also talk to each other
    await until(() => b.chain.length === 1 && c.chain.length === 1, 'genesis');

    const tx1 = /** @type {any} */ (await pay(a, b.walletAddr, '0.8', peerKey(a, '10.0.0.2')));
    const tx2 = /** @type {any} */ (await a._respend(tx1.id, a.walletAddr, peerKey(a, '10.0.0.3')));
    await until(() => b.mempool.has(tx1.id) && c.mempool.has(tx2.id), 'split');
    await until(() => [b, c].some(n => n.log.some(l => /txrejected/.test(l))), 'conflict detected');
    expect(b.mempool.has(tx2.id)).toBe(false);       // network is split …

    c._mine();                                       // … until the next block
    await until(() => tip(a) === tip(c) && tip(b) === tip(c), 'block everywhere');
    for (const n of [a, b, c]) {
      expect(n.chain[1].txs).toEqual([tx2.id]);
      expect(n.mempool.size).toBe(0);
    }
    expect(b._computeBalances().get(b.walletAddr) ?? 0).toBe(0);  // merchant got nothing
  });

  it('51 % attack: withhold blocks, re-spend privately, publish the longer fork', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');      // attacker
    const b = await makeNode(mesh, '10.0.0.2');      // merchant
    const c = await makeNode(mesh, '10.0.0.3');      // honest miner
    await connect(b, '10.0.0.1');
    await connect(c, '10.0.0.2');
    a._mine();
    await until(() => c.chain.length === 1, 'genesis');

    a._toggleWithhold();                             // private fork starts here
    const tx1 = /** @type {any} */ (await pay(a, b.walletAddr, '0.8'));
    await until(() => c.mempool.size === 1, 'payment reaches miner');
    c._mine(); c._mine();
    await until(() => b.chain.length === 3, 'confirmations');
    expect(b._walletHistory().find(r => r.sats === 0.8e8)?.conf).toBe(2);

    const tx2 = /** @type {any} */ (await a._respend(tx1.id, a.walletAddr, 'none'));
    a._mine(); a._mine();
    const known = b.blockMap.size;
    await new Promise(r => setTimeout(r, 20));
    expect(b.blockMap.size).toBe(known);             // nothing leaked
    expect(a._withholdStatus()).toEqual({ mine: 2, pub: 2 });
    a._mine();
    expect(a._withholdStatus()).toEqual({ mine: 3, pub: 2 });
    expect(a.withheld.size).toBe(3);
    expect(a.blockMap.get(/** @type {string} */ (a.withhold?.tip))?.height).toBe(3);

    a._toggleWithhold();                             // publish
    expect(a.withhold).toBeNull();
    await until(() => tip(b) === tip(a) && tip(c) === tip(a), 'reorg');
    expect(b.log.some(l => /reorg/.test(l))).toBe(true);
    expect(b._computeBalances().get(b.walletAddr) ?? 0).toBe(0);
    expect(b._walletHistory().some(r => r.sats === 0.8e8)).toBe(false);
    expect(c.chain.some(x => x.txs.includes(tx2.id))).toBe(true);
    expect(c.mempool.size).toBe(0);                  // tx1's coin is spent now
  });

  it('a withheld fork published too early is ignored', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    const b = await makeNode(mesh, '10.0.0.2');
    await connect(b, '10.0.0.1');
    a._mine();
    await until(() => b.chain.length === 1, 'genesis');
    a._toggleWithhold();
    await pay(a, b.walletAddr, '0.5');
    await until(() => b.mempool.size === 1, 'payment');
    b._mine(); b._mine();
    await until(() => a.blockMap.size === 3, 'public blocks at attacker');
    a._mine();                                       // 1 secret vs 2 public
    const bTip = tip(b);
    a._toggleWithhold();
    await until(() => b.blockMap.size === 4, 'withheld block arrives');
    expect(tip(b)).toBe(bTip);
    expect(b._computeBalances().get(b.walletAddr)).toBe(2.5e8);
  });

  it('a re-spend of an already confirmed payment is shown as conflict', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1');
    a._mine();
    const tx1 = /** @type {any} */ (await pay(a, await freshAddress(), '0.3'));
    a._mine();
    const tx2 = /** @type {any} */ (await a._respend(tx1.id));
    expect(a.mempool.has(tx2.id)).toBe(false);
    expect(a._walletHistory().find(r => r.txId === tx2.id)?.conf).toBe(-1);
  });
});

describe('BitcoinNodeApp – coinbase maturity', () => {
  it('defaults to 10 confirmations', () => {
    expect(COINBASE_MATURITY).toBe(10);
    expect(new BitcoinNodeApp(/** @type {any} */ ({ net: null, fs: null })).coinbaseMaturity).toBe(10);
  });

  it('a block reward becomes spendable after 10 confirmations', async () => {
    const mesh = makeMesh();
    const a = await makeNode(mesh, '10.0.0.1', { maturity: 10 });
    a._mine();
    expect(a._walletBalances()).toMatchObject({ confirmed: 1e8, spendable: 0, immature: 1e8 });
    expect(await pay(a, await freshAddress(), '0.5')).toBeNull();
    for (let i = 0; i < 8; i++) a._mine();          // genesis reward: 9 confirmations
    expect(a._walletBalances().spendable).toBe(0);
    a._mine();                                      // 10 confirmations
    expect(a._walletBalances()).toMatchObject({ confirmed: 10e8, spendable: 1e8, immature: 9e8 });
    expect(a._walletHistory().at(-1)).toMatchObject({ reward: true, conf: 10 });
    expect(await pay(a, await freshAddress(), '0.5')).not.toBeNull();
  });

  it('honest nodes reject a block that spends an immature reward', async () => {
    const mesh = makeMesh();
    const m = await makeNode(mesh, '10.0.0.1', { maturity: 10 });
    const b = await makeNode(mesh, '10.0.0.2', { maturity: 10 });
    await connect(b, '10.0.0.1');
    m._mine();
    await until(() => b.chain.length === 1, 'genesis');
    m.coinbaseMaturity = 1;                         // manipulated client ignores the rule
    await pay(m, b.walletAddr, '0.5');
    m._mine();
    expect(m.chain.at(-1)?.txs.length).toBe(1);
    await until(() => b.invalid.size === 1, 'rejection');
    expect(b.chain.length).toBe(1);
    const tx = /** @type {any} */ ([...m.txs.values()][0]);
    expect(b._checkBlockRules(b.chain[0].id, 1e8, [tx])).toMatch(/immature/);
  });
});
