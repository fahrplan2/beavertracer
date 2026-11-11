//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { BitcoinNodeView } from "./lib/BitcoinNodeView.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";
import { nowStamp } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js";
import * as BC from "./lib/BitcoinCrypto.js";

// ============================================================
// Bitcoin Wire Protocol  (mainnet, simplified)
// ============================================================

const MAGIC = new Uint8Array([0xF9, 0xBE, 0xB4, 0xD9]);
const CHECKSUM_EMPTY = new Uint8Array([0x5d, 0xf6, 0xe0, 0xe2]); // SHA256d("") first 4 bytes
const MSG_TX    = 1;
const MSG_BLOCK = 2;
const PROTO_VERSION = 70015;

// ---- Encoding helpers ----

/** @param {...Uint8Array} parts @returns {Uint8Array} */
function cat(...parts) {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** uint32 little-endian @param {number} v @returns {Uint8Array} */
function u32le(v) {
  const u = v >>> 0;
  return new Uint8Array([u & 0xff, (u >> 8) & 0xff, (u >> 16) & 0xff, (u >>> 24) & 0xff]);
}

/** int64 little-endian (JS safe integer range) @param {number} v @returns {Uint8Array} */
function i64le(v) {
  const lo = v >>> 0, hi = Math.floor(v / 0x100000000) >>> 0;
  return new Uint8Array([
    lo & 0xff, (lo >> 8) & 0xff, (lo >> 16) & 0xff, (lo >>> 24) & 0xff,
    hi & 0xff, (hi >> 8) & 0xff, (hi >> 16) & 0xff, (hi >>> 24) & 0xff,
  ]);
}

/** Bitcoin variable-length integer @param {number} n @returns {Uint8Array} */
function varint(n) {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, (n >> 8) & 0xff]);
  return new Uint8Array([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}

/** varint-prefixed UTF-8 string @param {string} s @returns {Uint8Array} */
function varstr(s) {
  const b = new TextEncoder().encode(s);
  return cat(varint(b.length), b);
}

/**
 * Deterministic 32-byte pseudo-hash from an arbitrary string.
 * Each node derives the same hash for the same ID.
 * @param {string} id @returns {Uint8Array}
 */
function fakeHash(id) {
  const b = new Uint8Array(32);
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  for (let i = 0; i < 32; i++) { h = Math.imul(h ^ (h >>> 13), 0x9e3779b9) >>> 0; b[i] = h & 0xff; }
  return b;
}

/** @param {Uint8Array} h @returns {string} */
function hex(h) { return Array.from(h).map(b => b.toString(16).padStart(2, "0")).join(""); }

/** Abbreviated hash for logs and UI. @param {string} h */
function shortHash(h) { return h.slice(0, 12); }

/** @param {string} h @returns {Uint8Array} */
function fromHex(h) {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}

/**
 * Build a complete Bitcoin wire message.
 * Checksum is real for empty payloads; zero-filled for non-empty
 * (Wireshark shows a warning but still dissects the message).
 * @param {string} cmd @param {Uint8Array} payload @returns {Uint8Array}
 */
function btcMsg(cmd, payload) {
  const cmdB = new Uint8Array(12);
  for (let i = 0; i < cmd.length && i < 12; i++) cmdB[i] = cmd.charCodeAt(i);
  const cs = payload.length === 0 ? CHECKSUM_EMPTY : new Uint8Array(4);
  return cat(MAGIC, cmdB, u32le(payload.length), cs, payload);
}

/** Pseudo double-SHA256 of raw bytes (deterministic, identical on every node). @param {Uint8Array} b */
function dhash(b) { return fakeHash(Array.from(b).join(",")); }

/** @param {number} n @returns {Uint8Array} */
function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

const ZERO32 = new Uint8Array(32);
const BLOCK_REWARD_SATS = 1e8;
/**
 * A block reward can only be spent after this many confirmations (Bitcoin:
 * 100). Until then the block could still be dropped by a reorg – and its
 * reward with it.
 */
export const COINBASE_MATURITY = 10;

// ---- Message constructors ----

/** @param {number} height @returns {Uint8Array} */
function msgVersion(height) {
  const addrEmpty = new Uint8Array(26); // services(8) + ipv6(16) + port BE(2) all zero
  return btcMsg("version", cat(
    u32le(PROTO_VERSION),
    new Uint8Array(8),                              // services = NODE_NONE
    i64le(Math.floor(Date.now() / 1000)),           // timestamp
    addrEmpty,                                      // addr_recv
    addrEmpty,                                      // addr_from
    randomBytes(8),                                 // nonce
    varstr("/BeaverNode:0.2/"),                     // user agent
    u32le(height),                                  // start_height
    new Uint8Array([1]),                            // relay = true
  ));
}

/** @returns {Uint8Array} */
function msgVerack() { return btcMsg("verack", new Uint8Array(0)); }

/**
 * getblocks with a block locator (newest first, exponentially thinning out
 * towards genesis) so the peer can find the fork point.
 * @param {Uint8Array[]} locator @returns {Uint8Array}
 */
function msgGetblocks(locator) {
  return btcMsg("getblocks", cat(
    u32le(PROTO_VERSION),
    varint(locator.length), ...locator,
    ZERO32,                     // hash_stop = 0 → as many as possible
  ));
}

/** @param {{type:number,hash:Uint8Array}[]} items @returns {Uint8Array} */
function invPayload(items) {
  return cat(varint(items.length), ...items.flatMap(i => [u32le(i.type), i.hash]));
}

/** @param {{type:number,hash:Uint8Array}[]} items */
function msgInv(items)     { return btcMsg("inv",     invPayload(items)); }

/** @param {{type:number,hash:Uint8Array}[]} items */
function msgGetdata(items) { return btcMsg("getdata", invPayload(items)); }

/**
 * Simplified-but-structurally-valid transaction (1 input, 1 output).
 * scriptSig    = <push 64: signature> <push 65: sender public key>  (like P2PKH)
 * scriptPubKey = receiver address (ASCII, simplified)
 * `prevOut` is a random nonce that makes otherwise identical txs unique.
 * The signature covers the same tx with an *empty* scriptSig.
 * @param {Uint8Array} prevOut @param {Uint8Array} inScript @param {string} to @param {number} satoshis
 * @returns {Uint8Array} raw tx bytes (without btcMsg wrapper)
 */
function rawTx(prevOut, inScript, to, satoshis) {
  const outScript = new TextEncoder().encode(to);
  return cat(
    u32le(1),                                           // version
    varint(1),                                          // 1 input
    prevOut, u32le(0xffffffff),                         // prevout
    varint(inScript.length), inScript, u32le(0xffffffff), // scriptSig + sequence
    varint(1),                                          // 1 output
    i64le(Math.max(0, Math.round(satoshis))),           // value
    varint(outScript.length), outScript,                // scriptPubKey
    u32le(0),                                           // locktime
  );
}

/** @param {string} miner @param {number} height */
function coinbaseTx(miner, height) {
  // BIP34-style: the height goes into the coinbase input, so every coinbase is unique.
  return rawTx(ZERO32, new TextEncoder().encode(`coinbase h=${height}`), miner, BLOCK_REWARD_SATS);
}

/** scriptSig of a signed tx. @param {Uint8Array} sig @param {Uint8Array} pubRaw */
function sigScript(sig, pubRaw) { return cat(new Uint8Array([sig.length]), sig, new Uint8Array([pubRaw.length]), pubRaw); }

/**
 * Create and sign a payment.
 * `prevOut` stands for the coin being spent (simplified: a random ID per
 * payment). Two txs with the same prevOut spend the same coin → only one
 * of them can ever be confirmed – that is what a double spend is.
 * @param {BC.Wallet} wallet @param {string} to @param {number} sats @param {Uint8Array} [prevOut]
 * @returns {Promise<Uint8Array>} raw tx
 */
async function signedTx(wallet, to, sats, prevOut = randomBytes(32)) {
  const sig = await BC.sign(wallet.privateKey, rawTx(prevOut, new Uint8Array(0), to, sats));
  return rawTx(prevOut, sigScript(sig, wallet.pubRaw), to, sats);
}

/**
 * Check the signature of a received tx and derive the sender address
 * from the public key in the scriptSig.
 * @param {Uint8Array} raw @returns {Promise<Tx|null>}
 */
async function verifyTx(raw) {
  const p = parseTx(raw);
  if (!p || p.sats <= 0) return null;
  const s = p.scriptSig;
  if (s.length !== 131 || s[0] !== 64 || s[65] !== 65) return null;
  const sig = s.slice(1, 65), pub = s.slice(66);
  if (!await BC.verify(pub, sig, rawTx(p.prevOut, new Uint8Array(0), p.to, p.sats))) return null;
  return { id: hex(dhash(raw)), from: await BC.addressFromPubkey(pub), to: p.to, amount: p.sats / 1e8, raw: hex(raw), input: hex(p.prevOut) };
}

/** Tx record for a payment we signed ourselves. @param {Uint8Array} raw @param {string} from @returns {Tx} */
function ownTx(raw, from) {
  const p = /** @type {NonNullable<ReturnType<typeof parseTx>>} */ (parseTx(raw));
  return { id: hex(dhash(raw)), from, to: p.to, amount: p.sats / 1e8, raw: hex(raw), input: hex(p.prevOut) };
}

/** Fake merkle root over the raw txs (coinbase first). @param {Uint8Array[]} txRaws */
function merkleRoot(txRaws) { return dhash(cat(...txRaws.map(dhash))); }

/**
 * Serialize a block for the "block" message: header + all raw txs.
 * @param {Block} block @param {Map<string,Tx>} txMap @returns {Uint8Array}
 */
function msgBlock(block, txMap) {
  const raws = [fromHex(block.cb)];
  for (const id of block.txs) { const tx = txMap.get(id); if (tx) raws.push(fromHex(tx.raw)); }
  return btcMsg("block", cat(fromHex(block.header), varint(raws.length), ...raws));
}

// ---- Message reader ----

/**
 * Read one complete Bitcoin message from the TCP stream.
 * @param {any} net
 * @param {string} connKey
 * @param {{ buf: Uint8Array }} state
 * @returns {Promise<{cmd:string, payload:Uint8Array}|null>}
 */
async function readBtcMsg(net, connKey, state) {
  while (true) {
    // Ensure we have the 24-byte header
    while (state.buf.length < 24) {
      const chunk = await net.recvTCPConn(connKey);
      if (chunk == null) return null;
      const m = new Uint8Array(state.buf.length + chunk.length);
      m.set(state.buf); m.set(chunk, state.buf.length);
      state.buf = m;
    }

    // Validate magic; skip one byte and resync on mismatch
    if (state.buf[0] !== 0xF9 || state.buf[1] !== 0xBE ||
        state.buf[2] !== 0xB4 || state.buf[3] !== 0xD9) {
      state.buf = state.buf.slice(1);
      continue;
    }

    // Command: 12 bytes, null-terminated ASCII
    let cmdLen = 0;
    while (cmdLen < 12 && state.buf[4 + cmdLen] !== 0) cmdLen++;
    const cmd = String.fromCharCode(...state.buf.slice(4, 4 + cmdLen));

    // Payload length (LE uint32)
    const payLen =
      state.buf[16] | (state.buf[17] << 8) | (state.buf[18] << 16) | ((state.buf[19] & 0x7f) << 24);

    if (payLen > 8 * 1024 * 1024) { state.buf = state.buf.slice(1); continue; } // sanity

    // Wait for full payload
    const total = 24 + payLen;
    while (state.buf.length < total) {
      const chunk = await net.recvTCPConn(connKey);
      if (chunk == null) return null;
      const m = new Uint8Array(state.buf.length + chunk.length);
      m.set(state.buf); m.set(chunk, state.buf.length);
      state.buf = m;
    }

    const payload = state.buf.slice(24, total);
    state.buf = state.buf.slice(total);
    return { cmd, payload };
  }
}

// ---- Parse inv / getdata payload ----

/** @param {Uint8Array} p @returns {{type:number,hash:Uint8Array}[]} */
function parseInvPayload(p) {
  if (!p.length) return [];
  const first = p[0];
  const count = first < 0xfd ? first : first === 0xfd ? (p[1] | (p[2] << 8)) : 0;
  let off = first < 0xfd ? 1 : 3;
  const items = [];
  for (let i = 0; i < count && off + 36 <= p.length; i++) {
    const type = p[off] | (p[off+1] << 8) | (p[off+2] << 16) | (p[off+3] << 24);
    items.push({ type, hash: p.slice(off + 4, off + 36) });
    off += 36;
  }
  return items;
}

/** Locator hashes from a getblocks payload. @param {Uint8Array} p @returns {string[]} */
function parseLocator(p) {
  if (p.length < 5) return [];
  const first = p[4];
  const count = first < 0xfd ? first : first === 0xfd ? (p[5] | (p[6] << 8)) : 0;
  let off = 4 + (first < 0xfd ? 1 : 3);
  const out = [];
  for (let i = 0; i < count && off + 32 <= p.length; i++, off += 32) out.push(hex(p.slice(off, off + 32)));
  return out;
}

/** Extract start_height from a version payload. */
function parseVersionHeight(/** @type {Uint8Array} */ p) {
  // layout: version(4) + services(8) + timestamp(8) + addrRecv(26) + addrFrom(26) + nonce(8) = 80
  if (p.length < 81) return 0;
  const uaLen = p[80] < 0xfd ? p[80] : p[80] === 0xfd ? (p[81] | (p[82] << 8)) : 0;
  const uaVar = p[80] < 0xfd ? 1 : 3;
  const off = 80 + uaVar + uaLen;
  if (off + 4 > p.length) return 0;
  return (p[off] | (p[off+1] << 8) | (p[off+2] << 16) | (p[off+3] << 24)) >>> 0;
}

/**
 * Byte size of one rawTx() starting at offset `off` in buffer `p`.
 * Returns -1 if the buffer is too short or the format is unexpected.
 * @param {Uint8Array} p @param {number} off @returns {number}
 */
function rawTxSize(p, off) {
  if (p.length < off + 42) return -1;
  const inLen = p[off + 41];
  if (inLen >= 0xfd) return -1;
  const satOff = off + 42 + inLen + 5;
  if (p.length < satOff + 9) return -1;
  const outLen = p[satOff + 8];
  if (outLen >= 0xfd || p.length < satOff + 9 + outLen + 4) return -1;
  return 42 + inLen + 5 + 9 + outLen + 4;
}

/**
 * Parse all transaction payloads out of a block payload (Bitcoin wire, header included).
 * @param {Uint8Array} payload @returns {Uint8Array[]}
 */
function parseBlockTxs(payload) {
  if (payload.length < 81) return [];
  const b0 = payload[80];
  const txCount = b0 < 0xfd ? b0 : b0 === 0xfd ? (payload[81] | (payload[82] << 8)) : 0;
  let off = b0 < 0xfd ? 81 : 83;
  const txs = [];
  for (let i = 0; i < txCount; i++) {
    const size = rawTxSize(payload, off);
    if (size < 0) break;
    txs.push(payload.slice(off, off + size));
    off += size;
  }
  return txs;
}

/**
 * Split a rawTx() payload into its fields.
 * Layout: version(4) + varint(1) + prevOut(32) + prevoutIdx(4) +
 *         scriptSigLen(1) + scriptSig(N) + sequence(4) +
 *         outCount(1) + satoshis(8) + outScriptLen(1) + outScript(M) + locktime(4)
 * @param {Uint8Array} p @returns {{prevOut:Uint8Array,scriptSig:Uint8Array,to:string,sats:number}|null}
 */
function parseTx(p) {
  if (p.length < 46) return null;
  const inLen = p[41];
  if (inLen >= 0xfd) return null;
  const satOff = 42 + inLen + 5;  // skip scriptSig + sequence(4) + outCount(1)
  if (p.length < satOff + 9) return null;
  const lo     = (p[satOff]   | (p[satOff+1]<<8) | (p[satOff+2]<<16) | (p[satOff+3]<<24)) >>> 0;
  const hi     = (p[satOff+4] | (p[satOff+5]<<8) | (p[satOff+6]<<16) | (p[satOff+7]<<24)) >>> 0;
  const outLen = p[satOff + 8];
  if (outLen >= 0xfd || p.length < satOff + 9 + outLen) return null;
  return {
    prevOut:   p.slice(5, 37),
    scriptSig: p.slice(42, 42 + inLen),
    to:        new TextDecoder().decode(p.slice(satOff + 9, satOff + 9 + outLen)),
    sats:      hi * 0x100000000 + lo,
  };
}

// ============================================================
// App
// ============================================================

/**
 * Blocks and transactions are identified by the (fake) hash of their wire
 * bytes, so every node derives the same ID for the same object.
 *
 * @typedef {{ id: string, prev: string|null, height: number, txs: string[], miner: string, ts: number, header: string, cb: string }} Block
 *   id = header hash (hex), prev = parent header hash, txs = tx IDs without coinbase,
 *   header = raw 80-byte header (hex), cb = raw coinbase tx (hex)
 * @typedef {{ id: string, from: string, to: string, amount: number, raw: string, input: string }} Tx
 *   id = hash of raw tx bytes, raw = wire bytes (hex), input = spent coin (prevOut, hex)
 * @typedef {{ addr: string, height: number, ready: boolean, locatorTip?: string, locatorAt?: number }} PeerInfo
 */

const BITCOIN_PORT = 8333;

/** For tests and experiments (e.g. crafting a double spend). */
export const _internals = { signedTx, verifyTx, rawTx, parseTx };

export class BitcoinNodeApp extends LoggedProcess {
  get title() { return t("app.bitcoin.title"); }
  icon = "fa-coins";
  badge = "";

  /** @type {Disposer} */
  disposer = new Disposer();

  // runtime state
  running = false;
  /** @type {number|null} */ serverRef = null;
  /** Active (longest) chain, index = height. @type {Block[]} */ chain = [];
  /** All known blocks incl. stale forks, by hash. @type {Map<string,Block>} */ blockMap = new Map();
  /** All known transactions, by hash. @type {Map<string,Tx>} */ txs = new Map();
  /** Known txs not confirmed on the active chain. @type {Map<string,Tx>} */ mempool = new Map();
  /** Blocks whose parent is still missing. @type {Map<string,{payload:Uint8Array,fromKey:string}>} */ orphans = new Map();
  /** @type {Map<string,PeerInfo>} */ peers = new Map();
  /** Outstanding getdata requests: hash → time requested. @type {Map<string,number>} */ inflight = new Map();
  /** Hashes of blocks/txs that broke a rule – never requested again. @type {Set<string>} */ invalid = new Set();

  // double-spend building blocks
  /** Withholding mined blocks (private fork) since `base`. @type {{base:string|null, tip:string|null}|null} */
  withhold = null;
  /** Blocks we mined but did not announce yet. @type {Set<string>} */ withheld = new Set();
  /** Own txs superseded by a re-spend of the same coin (our node prefers the new one). @type {Set<string>} */ replaced = new Set();

  // config / wallet
  /** Key pair; the private key never leaves this node. @type {BC.Wallet|null} */ wallet = null;
  walletAddr = "";
  seedAddr = "";
  /** Resolves once the wallet is loaded or generated. @type {Promise<void>|null} */ _ready = null;

  /** Consensus rule – all nodes of a network must use the same value. */
  coinbaseMaturity = COINBASE_MATURITY;

  /** @type {BitcoinNodeView|null} */ view = null;
  _refreshQueued = false;

  run() {
    this.root.classList.add("app", "app-bitcoin");
    this._loadChain();
    this._ready = this._loadConfig().then(() => {
      this._refresh();
      this._tryAutostart();
    });
  }

  _tryAutostart() {
    try {
      const fs = this.os.fs;
      if (!fs) return;
      const json = JSON.parse(fs.readFile("/etc/bitcoin.conf"));
      if (json.autostart !== true) return;
      void this._start();
    } catch { }
  }

  /** @param {*} val */
  _writeAutostart(val) {
    try {
      const fs = this.os.fs;
      if (!fs) return;
      const txt = fs.readFile("/etc/bitcoin.conf");
      if (!txt?.trim()) return;
      const o = JSON.parse(txt);
      o.autostart = val;
      fs.writeFile("/etc/bitcoin.conf", JSON.stringify(o, null, 2) + "\n");
    } catch { }
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();
    this.view = new BitcoinNodeView(this);
    this.view.mount();
  }

  onUnmount() {
    this.disposer.dispose();
    this.view = null;
    this.logEl = null;
    super.onUnmount();
  }

  destroy() { this._stop(); super.destroy(); }

  // ---- UI ----

  /** Re-render the view once per tick, however many state changes happen. */
  _refresh() {
    if (!this.view || this._refreshQueued) return;
    this._refreshQueued = true;
    queueMicrotask(() => { this._refreshQueued = false; this.view?.render(); });
  }

  // ---- Lifecycle ----

  /** @param {string} [seed] */
  _startFromUI(seed) {
    this.seedAddr = (seed ?? this.seedAddr).trim();
    this._saveConfig();
    this._start();
  }

  async _start() {
    if (this.running) return;
    if (this._ready) await this._ready;
    if (this.running) return;
    try {
      this.serverRef = this.os.net.openTCPServerSocket(IPAddress.fromString("::"), BITCOIN_PORT);
    } catch (e) {
      this._appendLog(t("app.bitcoin.log.startfailed", { time: nowStamp(), reason: e instanceof Error ? e.message : String(e) }));
      return;
    }
    this.running = true;
    this._writeAutostart(true);
    this._refresh();
    this._appendLog(t("app.bitcoin.log.started", { time: nowStamp(), port: BITCOIN_PORT }));
    this._acceptLoop();
    if (this.seedAddr) this._connectToSeed(this.seedAddr);
  }

  _stop() {
    if (!this.running && this.serverRef == null) return;
    this._writeAutostart(false);
    this.running = false;
    for (const [key] of this.peers) { try { this.os.net.closeTCPConn(key); } catch { } }
    this.peers.clear();
    const ref = this.serverRef; this.serverRef = null;
    if (ref != null) { try { this.os.net.closeTCPServerSocket(ref); } catch { } }
    this._refresh();
    this._appendLog(t("app.bitcoin.log.stopped", { time: nowStamp() }));
  }

  // ---- Mining ----

  /**
   * "Mine" a block on top of the current tip. There is no proof-of-work:
   * one click = one block, containing the mempool txs (see _poolAt).
   * While withholding, the block extends our private fork instead and is
   * not announced.
   */
  _mine() {
    if (!this.running || !this.walletAddr) return;
    const w      = this.withhold;
    const tipId  = w ? w.tip : (this.chain.at(-1)?.id ?? null);
    const tip    = tipId ? (this.blockMap.get(tipId) ?? null) : null;
    const height = tip ? tip.height + 1 : 0;
    const ts     = Date.now();
    const picked = [...this._poolAt(tipId).values()].slice(0, 50);

    const cb     = coinbaseTx(this.walletAddr, height);
    const raws   = [cb, ...picked.map(tx => fromHex(tx.raw))];
    const header = cat(
      u32le(1),                                   // version
      tip ? fromHex(tip.id) : ZERO32,             // prev block hash
      merkleRoot(raws),                           // merkle root
      u32le(Math.floor(ts / 1000)),               // timestamp
      u32le(0x1d00ffff),                          // bits
      randomBytes(4),                             // nonce (no PoW, just unique)
    );

    /** @type {Block} */
    const block = {
      id: hex(dhash(header)), prev: tip?.id ?? null, height,
      txs: picked.map(tx => tx.id), miner: this.walletAddr,
      ts: Math.floor(ts / 1000) * 1000, header: hex(header), cb: hex(cb),
    };
    if (w) {
      w.tip = block.id;
      this.withheld.add(block.id);
      this._appendLog(t("app.bitcoin.log.secretmined", { time: nowStamp(), id: shortHash(block.id), height, txCount: picked.length }));
    } else {
      this._appendLog(t("app.bitcoin.log.mined", { time: nowStamp(), id: shortHash(block.id), height, txCount: picked.length }));
    }
    this._integrateBlock(block, "");
  }

  // ---- Transactions ----

  /**
   * Pay `amount` BTC to `to`.
   * @param {string} to @param {string|number} amount
   * @param {string} [target] "all" | "none" (keep local) | connKey of one peer
   * @returns {Promise<Tx|null>}
   */
  async _send(to, amount, target = "all") {
    if (!this.running || !this.wallet) return null;
    to = String(to ?? "").trim();
    const value = parseFloat(String(amount ?? "").replace(",", ".").trim());
    if (!to || !Number.isFinite(value) || value <= 0) return null;
    if (!await BC.isValidAddress(to)) {
      this._appendLog(t("app.bitcoin.log.txbadaddr", { time: nowStamp(), to }));
      return null;
    }
    const sats = Math.round(value * 1e8);
    const { spendable, pendingOut } = this._walletBalances();
    if (sats > spendable - pendingOut) {
      this._appendLog(t("app.bitcoin.log.txinsufficient", { time: nowStamp(), available: ((spendable - pendingOut) / 1e8).toFixed(8) }));
      return null;
    }
    const tx = ownTx(await signedTx(this.wallet, to, sats), this.walletAddr);
    this.txs.set(tx.id, tx);
    this._rebuildMempool();
    this._saveChain();
    if (!this.mempool.has(tx.id)) {
      this._appendLog(t("app.bitcoin.log.txrejected", { time: nowStamp(), id: shortHash(tx.id), reason: t("app.bitcoin.reason.doublespend") }));
      this._refresh();
      return null;
    }
    this._appendLog(t("app.bitcoin.log.txcreated", { time: nowStamp(), id: shortHash(tx.id), to, amount: tx.amount.toFixed(8) }));
    this._announceTx(tx.id, target);
    this._refresh();
    return tx;
  }

  /**
   * Double-spend building block: sign a new payment that spends the SAME
   * coin (input) as one of our earlier payments, but to someone else
   * (default: back to ourselves). Our own node prefers the new version;
   * every other node decides by "first seen" and, in the end, by the
   * longest chain. Combine with peer selection (race attack) or with
   * withholding blocks (51 % attack).
   * @param {string} txId @param {string} [to] @param {string} [target]
   * @returns {Promise<Tx|null>}
   */
  async _respend(txId, to, target = "all") {
    const orig = this.txs.get(txId);
    if (!this.running || !this.wallet || !orig || orig.from !== this.walletAddr) return null;
    to = String(to || this.walletAddr).trim();
    if (!await BC.isValidAddress(to)) {
      this._appendLog(t("app.bitcoin.log.txbadaddr", { time: nowStamp(), to }));
      return null;
    }
    const raw = await signedTx(this.wallet, to, Math.round(orig.amount * 1e8), fromHex(orig.input));
    const tx  = ownTx(raw, this.walletAddr);
    this.txs.set(tx.id, tx);
    this.replaced.add(orig.id);
    this._rebuildMempool();
    this._saveChain();
    this._appendLog(t("app.bitcoin.log.respend", { time: nowStamp(), id: shortHash(tx.id), orig: shortHash(orig.id), to }));
    this._announceTx(tx.id, target);
    this._refresh();
    return tx;
  }

  /** @param {string} id @param {string} target "all" | "none" | connKey */
  _announceTx(id, target) {
    const msg = msgInv([{ type: MSG_TX, hash: fromHex(id) }]);
    if (target === "none") {
      this._appendLog(t("app.bitcoin.log.txlocal", { time: nowStamp(), id: shortHash(id) }));
    } else if (target === "all" || !this.peers.has(target)) {
      this._broadcastExcept(msg, "");
    } else {
      try { this.os.net.sendTCPConn(target, msg); } catch { }
      this._appendLog(t("app.bitcoin.log.txvia", { time: nowStamp(), id: shortHash(id), peer: this.peers.get(target)?.addr ?? target }));
    }
  }

  // ---- Withholding blocks (selfish mining / 51 % attack) ----

  /**
   * On: mined blocks extend a private fork starting at the current tip and
   * are not announced. Off: announce the private fork – if it is longer
   * than the public chain, the network reorganizes onto it.
   */
  _toggleWithhold() {
    if (!this.running) return;
    if (!this.withhold) {
      const tip = this.chain.at(-1) ?? null;
      this.withhold = { base: tip?.id ?? null, tip: tip?.id ?? null };
      this._appendLog(t("app.bitcoin.log.withholdon", { time: nowStamp(), height: tip?.height ?? -1 }));
    } else {
      const { mine, pub } = this._withholdStatus();
      const blocks = this._ancestors(this.withhold.tip).filter(b => this.withheld.has(b.id));
      this.withhold = null;
      this.withheld.clear();
      if (blocks.length) this._broadcastExcept(msgInv(blocks.map(b => ({ type: MSG_BLOCK, hash: fromHex(b.id) }))), "");
      this._appendLog(t("app.bitcoin.log.secretpublish", { time: nowStamp(), mine, pub }));
    }
    this._saveChain();
    this._refresh();
  }

  /** Blocks since the fork point: private fork vs. best public branch. */
  _withholdStatus() {
    const w = this.withhold;
    if (!w) return { mine: 0, pub: 0 };
    const baseH = w.base ? (this.blockMap.get(w.base)?.height ?? -1) : -1;
    const mine  = (w.tip ? (this.blockMap.get(w.tip)?.height ?? baseH) : baseH) - baseH;
    let pubH = baseH;
    for (const b of this.blockMap.values()) if (!this.withheld.has(b.id) && b.height > pubH) pubH = b.height;
    return { mine, pub: pubH - baseH };
  }

  // ---- Networking ----

  async _acceptLoop() {
    while (this.running && this.serverRef != null) {
      let key;
      try { key = await this.os.net.acceptTCPConn(this.serverRef); }
      catch (e) {
        if (this.running) this._appendLog(`[${nowStamp()}] accept: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      if (!this.running || key == null) break;
      let addr = key;
      try { const info = this.os.net.getTCPConnInfo?.(key); if (info?.peerIP) addr = String(info.peerIP); } catch { }
      this.peers.set(key, { addr, height: 0, ready: false });
      this._peerSession(key, false).catch(() => {});
    }
  }

  /** @param {string} addr */
  async _connectToSeed(addr) {
    let host = addr, port = BITCOIN_PORT;
    const bracketPort = /^\[([^\]]+)\]:(\d+)$/.exec(addr);
    const bracketOnly = /^\[([^\]]+)\]$/.exec(addr);
    if (bracketPort) {
      host = bracketPort[1]; port = Number(bracketPort[2]);
    } else if (bracketOnly) {
      host = bracketOnly[1];
    } else if (!addr.includes(":") || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(addr)) {
      // IPv4 with optional :port
      const lc = addr.lastIndexOf(":");
      if (lc > 0) { const p = Number(addr.slice(lc + 1)); if (p > 0 && p < 65536) { host = addr.slice(0, lc); port = p; } }
    }
    // bare IPv6 (no brackets, no port): addr is used as-is

    /** @type {IPAddress|null} */
    let ip = null;
    try { ip = IPAddress.fromString(host); } catch { }
    if (!ip) {
      try {
        if (typeof this.os.dns?.resolveIP === "function") ip = await this.os.dns.resolveIP(host);
        else { const n = await this.os.dns.resolveA(host); ip = n?.length ? new IPAddress(4, n[0] >>> 0) : null; }
      } catch { ip = null; }
    }
    if (!ip) {
      this._appendLog(t("app.bitcoin.log.connectfailed", { time: nowStamp(), addr, reason: "DNS failed" }));
      return;
    }

    let key;
    try {
      const conn = await this.os.net.connectTCPConn(ip, port);
      key = conn?.key; if (!key) throw new Error("no connection key");
    } catch (e) {
      this._appendLog(t("app.bitcoin.log.connectfailed", { time: nowStamp(), addr, reason: e instanceof Error ? e.message : String(e) }));
      return;
    }
    this.peers.set(key, { addr, height: 0, ready: false });
    this._peerSession(key, true).catch(() => {});
  }

  /**
   * Full lifecycle of one peer connection (handshake → sync → message loop).
   * @param {string} connKey
   * @param {boolean} weInitiated
   */
  async _peerSession(connKey, weInitiated) {
    const state  = { buf: new Uint8Array(0) };
    const net    = this.os.net;
    const peer   = this.peers.get(connKey);
    if (!peer) return;

    try {
      // ---- Handshake ----
      if (weInitiated) {
        net.sendTCPConn(connKey, msgVersion(this._tipHeight()));
        const vm = await readBtcMsg(net, connKey, state);
        if (!vm || vm.cmd !== "version") return;
        peer.height = parseVersionHeight(vm.payload);
        net.sendTCPConn(connKey, msgVerack());
        const ack = await readBtcMsg(net, connKey, state);
        if (!ack || ack.cmd !== "verack") return;
      } else {
        const vm = await readBtcMsg(net, connKey, state);
        if (!vm || vm.cmd !== "version") return;
        peer.height = parseVersionHeight(vm.payload);
        net.sendTCPConn(connKey, msgVersion(this._tipHeight()));
        net.sendTCPConn(connKey, msgVerack());
        const ack = await readBtcMsg(net, connKey, state);
        if (!ack || ack.cmd !== "verack") return;
      }

      peer.ready = true;
      this._appendLog(t("app.bitcoin.log.peerin", { time: nowStamp(), addr: peer.addr, height: peer.height }));
      this._refresh();

      // ---- Initial chain sync ----
      // Both sides send their block locator; each peer answers with the
      // blocks of its active chain after the last common block. Whoever
      // has the longer chain thereby convinces the other one.
      this._requestBlocks(connKey, true);

      // ---- Message loop ----
      while (this.running && this.peers.has(connKey)) {
        const msg = await readBtcMsg(net, connKey, state);
        if (msg == null) break;

        switch (msg.cmd) {
          case "inv":       this._onInv(msg.payload, connKey);       break;
          case "getdata":   this._onGetdata(msg.payload, connKey);   break;
          case "block":     await this._onBlock(msg.payload, connKey); break;
          case "tx":        await this._onTx(msg.payload, connKey);    break;
          case "getblocks": this._onGetblocks(msg.payload, connKey); break;
        }
      }
    } finally {
      this.peers.delete(connKey);
      try { net.closeTCPConn(connKey); } catch { }
      this._appendLog(t("app.bitcoin.log.peerout", { time: nowStamp(), addr: peer.addr }));
      this._refresh();
    }
  }

  // ---- Protocol handlers ----

  /** @param {Uint8Array} payload @param {string} fromKey */
  _onInv(payload, fromKey) {
    const now = Date.now();
    const want = [];
    for (const item of parseInvPayload(payload)) {
      const id = hex(item.hash);
      if (this.invalid.has(id)) continue;
      if (item.type === MSG_BLOCK && (this.blockMap.has(id) || this.orphans.has(id))) continue;
      if (item.type === MSG_TX    && this.txs.has(id)) continue;
      if (item.type !== MSG_BLOCK && item.type !== MSG_TX) continue;
      // Don't ask several peers for the same object at once.
      const asked = this.inflight.get(id);
      if (asked != null && now - asked < 5000) continue;
      this.inflight.set(id, now);
      want.push(item);
    }
    if (want.length) { try { this.os.net.sendTCPConn(fromKey, msgGetdata(want)); } catch { } }
  }

  /** @param {Uint8Array} payload @param {string} fromKey */
  _onGetdata(payload, fromKey) {
    const net = this.os.net;
    for (const { type, hash } of parseInvPayload(payload)) {
      const id = hex(hash);
      try {
        if (this.withheld.has(id)) continue;   // withheld blocks stay private
        if (type === MSG_BLOCK) {
          const b = this.blockMap.get(id);
          if (b) net.sendTCPConn(fromKey, msgBlock(b, this.txs));
        } else if (type === MSG_TX) {
          const tx = this.txs.get(id);
          if (tx) net.sendTCPConn(fromKey, btcMsg("tx", fromHex(tx.raw)));
        }
      } catch { }
    }
  }

  /**
   * Answer getblocks: find the first locator hash on our active chain
   * (= last common block) and announce everything after it.
   * @param {Uint8Array} payload @param {string} fromKey
   */
  _onGetblocks(payload, fromKey) {
    // Withheld blocks are always at the top of our chain → cutting them off
    // leaves the public prefix (index = height still holds).
    const chain = this.chain.filter(b => !this.withheld.has(b.id));
    let start = 0;
    for (const id of parseLocator(payload)) {
      const b = this.blockMap.get(id);
      if (b && chain[b.height]?.id === id) { start = b.height + 1; break; }
    }
    const items = chain.slice(start, start + 500).map(b => ({ type: MSG_BLOCK, hash: fromHex(b.id) }));
    if (items.length) { try { this.os.net.sendTCPConn(fromKey, msgInv(items)); } catch { } }
  }

  /**
   * Receive a block. Every node checks every block itself (consensus rules)
   * – a miner can only propose, a block that breaks a rule is dropped even
   * if it would make the chain longer.
   * @param {Uint8Array} payload @param {string} fromKey
   */
  async _onBlock(payload, fromKey) {
    if (payload.length < 81) return;
    const header = payload.slice(0, 80);
    const id     = hex(dhash(header));
    this.inflight.delete(id);
    if (this.blockMap.has(id) || this.invalid.has(id)) return;

    const txRaws = parseBlockTxs(payload);
    if (!txRaws.length || hex(merkleRoot(txRaws)) !== hex(header.slice(36, 68))) {
      this._rejectBlock(id, t("app.bitcoin.reason.merkle"));
      return;
    }

    const prevBytes = header.slice(4, 36);
    const prev      = prevBytes.every(b => b === 0) ? null : hex(prevBytes);
    if (prev && !this.blockMap.has(prev)) {
      if (this.invalid.has(prev)) { this._rejectBlock(id, t("app.bitcoin.reason.badparent")); return; }
      // Parent unknown → we are missing (part of) a fork. Park the block
      // and ask the peer for its chain from our last common block on.
      if (!this.orphans.has(id)) {
        if (this.orphans.size >= 200) this.orphans.delete(this.orphans.keys().next().value ?? "");
        this.orphans.set(id, { payload, fromKey });
        this._appendLog(t("app.bitcoin.log.orphan", { time: nowStamp(), id: shortHash(id), prev: shortHash(prev) }));
      }
      this._requestBlocks(fromKey, false);
      return;
    }

    // Signatures (async – everything after this await is synchronous, so
    // the chain state cannot change between validation and integration).
    /** @type {Tx[]} */
    const txList = [];
    for (const raw of txRaws.slice(1)) {
      const known = this.txs.get(hex(dhash(raw)));
      const tx = known ?? await verifyTx(raw);
      if (!tx) { this._rejectBlock(id, t("app.bitcoin.reason.badsig")); return; }
      txList.push(tx);
    }
    if (this.blockMap.has(id)) return;   // arrived from another peer meanwhile
    const parent = prev ? this.blockMap.get(prev) : null;
    if (prev && !parent) return;

    const cb    = parseTx(txRaws[0]);
    const error = cb ? this._checkBlockRules(prev, cb.sats, txList) : t("app.bitcoin.reason.coinbase");
    if (error) { this._rejectBlock(id, error); return; }

    for (const tx of txList) if (!this.txs.has(tx.id)) this.txs.set(tx.id, tx);
    const ts = ((header[68] | (header[69] << 8) | (header[70] << 16) | (header[71] << 24)) >>> 0) * 1000;
    /** @type {Block} */
    const block = {
      id, prev, height: parent ? parent.height + 1 : 0, txs: txList.map(tx => tx.id),
      miner: /** @type {NonNullable<typeof cb>} */ (cb).to, ts, header: hex(header), cb: hex(txRaws[0]),
    };
    const peer = this.peers.get(fromKey);
    if (peer && block.height > peer.height) peer.height = block.height;
    this._appendLog(t("app.bitcoin.log.blockrcv", { time: nowStamp(), id: shortHash(id), height: block.height, miner: block.miner }));
    this._integrateBlock(block, fromKey);
    await this._connectOrphans(id);
  }

  /**
   * Consensus rules, checked against the chain *up to the block's parent*
   * (a block on a side fork is judged by its own history):
   *  - coinbase pays exactly the block reward
   *  - no tx is confirmed twice
   *  - nobody spends more than they own (→ no double spend)
   * @param {string|null} prev @param {number} coinbaseSats @param {Tx[]} txList
   * @returns {string|null} reason if invalid
   */
  _checkBlockRules(prev, coinbaseSats, txList) {
    if (coinbaseSats !== BLOCK_REWARD_SATS) return t("app.bitcoin.reason.coinbase");
    const bal   = this._balancesAt(prev, true);
    const total = this._balancesAt(prev);
    const seen  = new Set(this._ancestors(prev).flatMap(b => b.txs));
    const spent = this._spentInputs(prev);
    for (const tx of txList) {
      if (seen.has(tx.id)) return t("app.bitcoin.reason.duplicate", { id: shortHash(tx.id) });
      seen.add(tx.id);
      if (spent.has(tx.input)) return t("app.bitcoin.reason.inputspent", { id: shortHash(tx.id), input: shortHash(tx.input) });
      spent.add(tx.input);
      const sats = Math.round(tx.amount * 1e8);
      const have = bal.get(tx.from) ?? 0;
      if (have < sats && (total.get(tx.from) ?? 0) >= sats) {
        return t("app.bitcoin.reason.immature", { id: shortHash(tx.id), from: tx.from, n: this.coinbaseMaturity });
      }
      if (have < sats) {
        return t("app.bitcoin.reason.overspend", { id: shortHash(tx.id), from: tx.from, have: (have / 1e8).toFixed(8), amount: tx.amount.toFixed(8) });
      }
      bal.set(tx.from, have - sats);
      bal.set(tx.to, (bal.get(tx.to) ?? 0) + sats);
      total.set(tx.from, (total.get(tx.from) ?? 0) - sats);
      total.set(tx.to, (total.get(tx.to) ?? 0) + sats);
    }
    return null;
  }

  /** Coins (prevOuts) already spent up to block `tipId`. @param {string|null} tipId @returns {Set<string>} */
  _spentInputs(tipId) {
    const out = new Set();
    for (const b of this._ancestors(tipId)) for (const id of b.txs) { const tx = this.txs.get(id); if (tx) out.add(tx.input); }
    return out;
  }

  /** @param {string} id @param {string} reason */
  _rejectBlock(id, reason) {
    this.invalid.add(id);
    this._appendLog(t("app.bitcoin.log.blockinvalid", { time: nowStamp(), id: shortHash(id), reason }));
  }

  /** Connect orphans that were waiting for `parentId` (recursively). @param {string} parentId */
  async _connectOrphans(parentId) {
    for (const [id, o] of [...this.orphans]) {
      if (hex(o.payload.slice(4, 36)) !== parentId) continue;
      this.orphans.delete(id);
      await this._onBlock(o.payload, o.fromKey);
    }
  }

  /** @param {Uint8Array} payload @param {string} fromKey */
  async _onTx(payload, fromKey) {
    const id = hex(dhash(payload));
    this.inflight.delete(id);
    if (this.txs.has(id) || this.invalid.has(id)) return;
    const tx = await verifyTx(payload);
    if (this.txs.has(id)) return;
    if (!tx) {
      this.invalid.add(id);
      this._appendLog(t("app.bitcoin.log.txrejected", { time: nowStamp(), id: shortHash(id), reason: t("app.bitcoin.reason.badsig") }));
      return;
    }
    this.txs.set(id, tx);
    this._appendLog(t("app.bitcoin.log.txrcv", { time: nowStamp(), id: shortHash(id), from: tx.from, to: tx.to, amount: tx.amount.toFixed(8) }));
    this._rebuildMempool();
    this._saveChain();
    if (!this.mempool.has(id)) {
      // Sender cannot cover this tx on top of the confirmed balance and the
      // txs already in the mempool → double spend attempt, first seen wins.
      this._appendLog(t("app.bitcoin.log.txrejected", { time: nowStamp(), id: shortHash(id), reason: t("app.bitcoin.reason.doublespend") }));
      return;
    }
    this._refresh(); this._broadcastExcept(msgInv([{ type: MSG_TX, hash: fromHex(id) }]), fromKey);
  }

  // ---- Chain management ----

  _tipHeight() { return this.chain.at(-1)?.height ?? 0; }

  /**
   * Block locator: the last 10 blocks, then every 2nd, 4th, 8th … and genesis.
   * @returns {Uint8Array[]}
   */
  _locator() {
    const ids = [];
    let step = 1;
    for (let h = this.chain.length - 1; h >= 0; h -= step) {
      ids.push(this.chain[h].id);
      if (ids.length >= 10) step *= 2;
    }
    if (this.chain.length && ids.at(-1) !== this.chain[0].id) ids.push(this.chain[0].id);
    return ids.map(fromHex);
  }

  /**
   * Send getblocks to a peer. Rate-limited so that a burst of orphans
   * doesn't produce a burst of identical requests.
   * @param {string} connKey @param {boolean} force
   */
  _requestBlocks(connKey, force) {
    const peer = this.peers.get(connKey);
    if (!peer) return;
    const tip = this.chain.at(-1)?.id ?? "";
    const now = Date.now();
    if (!force && peer.locatorTip === tip && now - (peer.locatorAt ?? 0) < 2000) return;
    peer.locatorTip = tip; peer.locatorAt = now;
    try { this.os.net.sendTCPConn(connKey, msgGetblocks(this._locator())); } catch { }
  }

  /**
   * Add a (valid, parent-known) block, switch to the longest chain if
   * necessary, announce the block to the other peers and connect orphans
   * that were waiting for it.
   * @param {Block} block @param {string} fromKey  "" for locally mined blocks
   */
  _integrateBlock(block, fromKey) {
    this.blockMap.set(block.id, block);
    const newChain = this._selectChain();
    if (newChain.at(-1)?.id !== this.chain.at(-1)?.id) this._reorg(newChain);
    else this._rebuildMempool();   // txs of a stale-fork block are still unconfirmed

    this._refresh(); this._saveChain();
    if (!this.withheld.has(block.id)) this._broadcastExcept(msgInv([{ type: MSG_BLOCK, hash: fromHex(block.id) }]), fromKey);
  }

  /**
   * Longest chain wins. On a tie the current tip stays (first seen wins),
   * exactly like Bitcoin Core – so a fork persists until one side gets longer.
   * @returns {Block[]}
   */
  _selectChain() {
    let best = this.chain.at(-1) ?? null;
    if (best && !this.blockMap.has(best.id)) best = null;
    for (const b of this.blockMap.values()) {
      if (!best || b.height > best.height) best = b;
    }
    /** @type {Block[]} */
    const chain = [];
    for (let cur = best; cur; cur = cur.prev ? (this.blockMap.get(cur.prev) ?? null) : null) chain.push(cur);
    return chain.reverse();
  }

  /** @param {Block[]} newChain */
  _reorg(newChain) {
    const oldChain = this.chain;
    let fork = 0;
    while (fork < oldChain.length && fork < newChain.length && oldChain[fork].id === newChain[fork].id) fork++;
    const dropped = oldChain.length - fork;
    this.chain = newChain;
    this._rebuildMempool();
    if (dropped > 0) {
      this._appendLog(t("app.bitcoin.log.reorg", {
        time: nowStamp(), height: fork, dropped, added: newChain.length - fork,
      }));
      // Txs of the dropped blocks are unconfirmed again → re-announce them,
      // other nodes may never have seen them (they only were in our fork).
      const back = oldChain.slice(fork).flatMap(b => b.txs).filter(id => this.mempool.has(id));
      if (back.length) this._broadcastExcept(msgInv(back.map(id => ({ type: MSG_TX, hash: fromHex(id) }))), "");
    }
  }

  /**
   * Txs a block on top of `tipId` could contain: known, not yet confirmed
   * in that chain, coin (input) not yet spent, sender can cover it, and not
   * replaced by our own re-spend. Taken in the order we first saw them, so
   * of two conflicting payments the first one wins.
   * @param {string|null} tipId @returns {Map<string,Tx>}
   */
  _poolAt(tipId) {
    const confirmed = new Set(this._ancestors(tipId).flatMap(b => b.txs));
    const spent = this._spentInputs(tipId);
    const bal = this._balancesAt(tipId, true);
    /** @type {Map<string,Tx>} */
    const pool = new Map();
    for (const tx of this.txs.values()) {
      if (confirmed.has(tx.id) || spent.has(tx.input) || this.replaced.has(tx.id)) continue;
      const sats = Math.round(tx.amount * 1e8);
      const have = bal.get(tx.from) ?? 0;
      if (have < sats) continue;
      bal.set(tx.from, have - sats);
      spent.add(tx.input);
      pool.set(tx.id, tx);
    }
    return pool;
  }

  /** mempool = what the next block on the active chain could contain. */
  _rebuildMempool() { this.mempool = this._poolAt(this.chain.at(-1)?.id ?? null); }

  // ---- Ledger ----

  /** Balances according to the active chain. @returns {Map<string,number>} address → satoshis */
  _computeBalances() { return this._balancesAt(this.chain.at(-1)?.id ?? null); }

  /** Blocks from genesis up to and including `tipId`. @param {string|null} tipId @returns {Block[]} */
  _ancestors(tipId) {
    /** @type {Block[]} */
    const out = [];
    for (let b = tipId ? this.blockMap.get(tipId) : null; b; b = b.prev ? this.blockMap.get(b.prev) : null) out.push(b);
    return out.reverse();
  }

  /**
   * Balances after block `tipId` (null = before genesis). With `spendable`
   * only what a tx in the next block may spend (no immature rewards).
   * @param {string|null} tipId @param {boolean} [spendable] @returns {Map<string,number>}
   */
  _balancesAt(tipId, spendable = false) {
    /** @type {Map<string,number>} */
    const bal = new Map();
    const add = (/** @type {string} */ addr, /** @type {number} */ sats) => bal.set(addr, (bal.get(addr) ?? 0) + sats);
    const blocks = this._ancestors(tipId);
    // a tx in the next block (height = blocks.length) may only spend rewards
    // that have at least `coinbaseMaturity` confirmations by then
    const spendHeight = blocks.length;

    for (const block of blocks) {
      if (!spendable || spendHeight - block.height >= this.coinbaseMaturity) add(block.miner, BLOCK_REWARD_SATS);
      for (const txId of block.txs) {
        const tx = this.txs.get(txId);
        if (tx) {
          add(tx.to,   Math.round(tx.amount * 1e8));
          add(tx.from, -Math.round(tx.amount * 1e8));
        }
      }
    }
    return bal;
  }

  /**
   * Own balance in satoshis: confirmed = everything on the active chain,
   * spendable = without immature block rewards, immature = the difference.
   * @returns {{ confirmed: number, spendable: number, immature: number, pendingOut: number, pendingIn: number }}
   */
  _walletBalances() {
    const tipId      = this.chain.at(-1)?.id ?? null;
    const confirmed  = this._balancesAt(tipId).get(this.walletAddr) ?? 0;
    const spendable  = this._balancesAt(tipId, true).get(this.walletAddr) ?? 0;
    let pendingOut = 0, pendingIn = 0;
    for (const tx of this.mempool.values()) {
      if (tx.from === this.walletAddr) pendingOut += Math.round(tx.amount * 1e8);
      if (tx.to   === this.walletAddr) pendingIn  += Math.round(tx.amount * 1e8);
    }
    return { confirmed, spendable, immature: confirmed - spendable, pendingOut, pendingIn };
  }

  /**
   * Own payments and block rewards with their number of confirmations:
   * 0 = in the mempool, 1 = in the newest block, …, -1 = own tx that is
   * neither confirmed nor valid right now (e.g. a re-spend kept for a
   * private fork).
   * Block rewards carry `reward: true` (spendable from `coinbaseMaturity`
   * confirmations on).
   * @returns {{ sats: number, info: string, conf: number, txId: string|null, reward?: boolean }[]} newest first
   */
  _walletHistory() {
    const me = this.walletAddr, tipH = this.chain.at(-1)?.height ?? -1;
    /** @type {{ sats: number, info: string, conf: number, txId: string|null, reward?: boolean }[]} */
    const out = [];
    /** @param {Tx} tx @param {number} conf */
    const add = (tx, conf) => {
      if (tx.from === me) out.push({ sats: -Math.round(tx.amount * 1e8), info: tx.to, conf, txId: tx.id });
      else if (tx.to === me) out.push({ sats: Math.round(tx.amount * 1e8), info: tx.from, conf, txId: tx.id });
    };
    const confirmed = new Set(this.chain.flatMap(b => b.txs));
    for (const tx of this.txs.values()) {
      if (tx.from === me && !confirmed.has(tx.id) && !this.mempool.has(tx.id) && !this.replaced.has(tx.id)) add(tx, -1);
    }
    for (const tx of this.mempool.values()) add(tx, 0);
    for (const b of this.chain.slice().reverse()) {
      const conf = tipH - b.height + 1;
      for (const id of b.txs) { const tx = this.txs.get(id); if (tx) add(tx, conf); }
      if (b.miner === me) out.push({ sats: BLOCK_REWARD_SATS, info: t("app.bitcoin.history.reward", { height: b.height }), conf, txId: null, reward: true });
    }
    return out;
  }

  /** @param {Uint8Array} data @param {string} excludeKey */
  _broadcastExcept(data, excludeKey) {
    for (const [key, peer] of this.peers) {
      if (key !== excludeKey && peer.ready) { try { this.os.net.sendTCPConn(key, data); } catch { } }
    }
  }

  // ---- Config ----

  /**
   * Load seed node from /etc/bitcoin.conf and the key pair from
   * /etc/bitcoin.wallet (generated on first start). The address is derived
   * from the public key.
   */
  async _loadConfig() {
    const fs = this.os.fs;
    try {
      const cfg = JSON.parse(fs.readFile("/etc/bitcoin.conf"));
      if (typeof cfg.seedAddr === "string") this.seedAddr = cfg.seedAddr;
    } catch { }
    try {
      const w = JSON.parse(fs.readFile("/etc/bitcoin.wallet"));
      this.wallet = await BC.importWallet(w.privateKey);
    } catch { this.wallet = null; }
    if (!this.wallet) {
      this.wallet = await BC.generateWallet();
      try {
        fs?.writeFile("/etc/bitcoin.wallet", JSON.stringify({
          address: this.wallet.address, privateKey: this.wallet.jwk,
        }, null, 2) + "\n");
      } catch { }
    }
    this.walletAddr = this.wallet.address;
    this._saveConfig();
  }

  _saveConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    /** @type {Record<string,any>} */
    let cfg = {};
    try { cfg = JSON.parse(fs.readFile("/etc/bitcoin.conf")) ?? {}; } catch { }
    delete cfg.walletAddr;
    try {
      fs.writeFile("/etc/bitcoin.conf", JSON.stringify({
        ...cfg, address: this.walletAddr, seedAddr: this.seedAddr,
      }, null, 2) + "\n");
    } catch { }
  }

  _loadChain() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      const d = JSON.parse(fs.readFile("/etc/bitcoin.chain"));
      if (d?.v !== 4) return;   // older formats (no signatures / inputs) are not compatible → start fresh
      this.blockMap = new Map(d.blocks);
      this.txs      = new Map(d.txs);
      this.withhold = d.withhold ?? null;
      this.withheld = new Set(d.withheld ?? []);
      this.replaced = new Set(d.replaced ?? []);
      this.chain    = this._selectChain();
      this._rebuildMempool();
    } catch { }
  }

  _saveChain() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      fs.writeFile("/etc/bitcoin.chain", JSON.stringify({
        v: 4,
        blocks: [...this.blockMap.entries()],
        txs:    [...this.txs.entries()],
        withhold: this.withhold, withheld: [...this.withheld], replaced: [...this.replaced],
      }));
    } catch { }
  }

  _resetChain() {
    if (this.running) return;
    this.chain = [];
    this.blockMap = new Map();
    this.txs = new Map();
    this.mempool = new Map();
    this.orphans = new Map();
    this.inflight = new Map();
    this.invalid = new Set();
    this.withhold = null;
    this.withheld = new Set();
    this.replaced = new Set();
    this._saveChain();
    this._refresh(); this._refresh();
    this._appendLog(t("app.bitcoin.log.chainreset", { time: nowStamp() }));
  }
}
