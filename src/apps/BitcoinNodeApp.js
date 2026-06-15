//@ts-check

import { LoggedProcess } from "./lib/LoggedProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";
import { nowStamp } from "../lib/helpers.js";
import { IPAddress } from "../net/models/IPAddress.js";

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
    crypto.getRandomValues(new Uint8Array(8)),      // nonce
    varstr("/BeaverNode:0.1/"),                     // user agent
    u32le(height),                                  // start_height
    new Uint8Array([1]),                            // relay = true
  ));
}

/** @returns {Uint8Array} */
function msgVerack() { return btcMsg("verack", new Uint8Array(0)); }

/** @param {Uint8Array} tipHash @returns {Uint8Array} */
function msgGetblocks(tipHash) {
  return btcMsg("getblocks", cat(
    u32le(PROTO_VERSION),
    varint(1), tipHash,         // block locator
    new Uint8Array(32),         // hash_stop = 0 → no limit
  ));
}

/** @param {number} type @param {Uint8Array} hash @returns {Uint8Array} */
function msgInv(type, hash)     { return btcMsg("inv",     cat(varint(1), u32le(type), hash)); }

/** @param {number} type @param {Uint8Array} hash @returns {Uint8Array} */
function msgGetdata(type, hash) { return btcMsg("getdata", cat(varint(1), u32le(type), hash)); }

/**
 * Simplified-but-structurally-valid transaction.
 * @param {string} txId @param {string} from @param {string} to @param {number} satoshis
 * @returns {Uint8Array} raw tx bytes (without btcMsg wrapper)
 */
function rawTx(txId, from, to, satoshis) {
  const prevHash  = fakeHash(txId + "_in");
  const inScript  = new TextEncoder().encode(from);
  const outScript = new TextEncoder().encode(to);
  return cat(
    u32le(1),                                           // version
    varint(1),                                          // 1 input
    prevHash, u32le(0xffffffff),                        // prevout
    varint(inScript.length), inScript, u32le(0xffffffff), // scriptSig + sequence
    varint(1),                                          // 1 output
    i64le(Math.max(0, Math.round(satoshis))),           // value
    varint(outScript.length), outScript,                // scriptPubKey
    u32le(0),                                           // locktime
  );
}

/** @param {{id:string,from:string,to:string,amount:number}} tx @returns {Uint8Array} */
function msgTx(tx) { return btcMsg("tx", rawTx(tx.id, tx.from, tx.to, Math.round(tx.amount * 1e8))); }

/**
 * @param {{id:string,prev:string|null,prevHash:string|null,_hash:string,_header?:string,height:number,txs:string[],miner:string,ts:number}} block
 * @param {Map<string,{id:string,from:string,to:string,amount:number}>} txMap
 * @returns {Uint8Array}
 */
function msgBlock(block, txMap) {
  const header = block._header
    ? fromHex(block._header)
    : cat(
        u32le(1),
        block.prevHash ? fromHex(block.prevHash) : new Uint8Array(32),
        fakeHash(block.id + "_merkle"),
        u32le(Math.floor((block.ts || Date.now()) / 1000)),
        u32le(0x1d00ffff),
        u32le(0),
      );
  const coinbase = rawTx("cb_" + block.id, "coinbase", block.miner, 1e8);
  const txs = [coinbase];
  for (const txId of block.txs) {
    const tx = txMap.get(txId);
    if (tx) txs.push(rawTx(tx.id, tx.from, tx.to, Math.round(tx.amount * 1e8)));
  }
  return btcMsg("block", cat(header, varint(txs.length), ...txs));
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
 * Extract from/to/amount from a rawTx() payload.
 * Layout: version(4) + varint(1) + prevHash(32) + prevoutIdx(4) +
 *         inScriptLen(1) + inScript(N) + sequence(4) +
 *         outCount(1) + satoshis(8) + outScriptLen(1) + outScript(M) + locktime(4)
 * @param {Uint8Array} p @returns {{from:string,to:string,amount:number}|null}
 */
function parseTxPayload(p) {
  if (p.length < 46) return null;
  const inLen = p[41];
  if (inLen >= 0xfd) return null;
  const satOff = 42 + inLen + 5;  // skip inScript + sequence(4) + outCount(1)
  if (p.length < satOff + 9) return null;
  const lo     = (p[satOff]   | (p[satOff+1]<<8) | (p[satOff+2]<<16) | (p[satOff+3]<<24)) >>> 0;
  const hi     = (p[satOff+4] | (p[satOff+5]<<8) | (p[satOff+6]<<16) | (p[satOff+7]<<24)) >>> 0;
  const outLen = p[satOff + 8];
  if (outLen >= 0xfd || p.length < satOff + 9 + outLen) return null;
  const dec = new TextDecoder();
  return {
    from:   dec.decode(p.slice(42, 42 + inLen)),
    to:     dec.decode(p.slice(satOff + 9, satOff + 9 + outLen)),
    amount: (hi * 0x100000000 + lo) / 1e8,
  };
}

// ============================================================
// App
// ============================================================

/**
 * @typedef {{ id: string, prev: string|null, prevHash: string|null, _hash: string, _header?: string, height: number, txs: string[], miner: string, ts: number }} Block
 * @typedef {{ id: string, from: string, to: string, amount: number }} Tx
 * @typedef {{ addr: string, height: number, ready: boolean }} PeerInfo
 */

const BITCOIN_PORT = 8333;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** @param {number} seed @returns {string} */
function genAddress(seed) {
  let h = (seed * 2654435769) >>> 0, addr = "1";
  for (let i = 0; i < 25; i++) { addr += B58[h % 58]; h = Math.imul(h ^ (h >>> 13), 0x9e3779b9) >>> 0; }
  return addr;
}

export class BitcoinNodeApp extends LoggedProcess {
  get title() { return t("app.bitcoin.title"); }
  icon = "fa-coins";
  badge = "";

  /** @type {Disposer} */
  disposer = new Disposer();

  // runtime state
  running = false;
  /** @type {number|null} */ serverRef = null;
  /** @type {Block[]} */ chain = [];
  /** @type {Map<string,Tx>} */ mempool = new Map();
  /** @type {Map<string,Tx>} */ confirmedTxs = new Map();
  /** @type {Map<string,Block>} */ blockMap = new Map();
  /** @type {Map<string,{payload:Uint8Array,fromKey:string}>} */ orphans = new Map();
  /** @type {Map<string,PeerInfo>} */ peers = new Map();

  // hashHex → { type, id } — used to answer getdata and dedup received inv
  /** @type {Map<string,{type:'block'|'tx',id:string}>} */
  hashIndex = new Map();

  // config
  walletAddr = "";
  seedAddr = "";
  _txSeq = 0;
  _blockSeq = 0;

  // UI refs
  /** @type {HTMLButtonElement|null} */ startBtn = null;
  /** @type {HTMLButtonElement|null} */ stopBtn = null;
  /** @type {HTMLButtonElement|null} */ mineBtn = null;
  /** @type {HTMLButtonElement|null} */ resetBtn = null;
  /** @type {HTMLButtonElement|null} */ txBtn = null;
  /** @type {HTMLInputElement|null} */ seedEl = null;
  /** @type {HTMLInputElement|null} */ toEl = null;
  /** @type {HTMLInputElement|null} */ amountEl = null;
  /** @type {HTMLElement|null} */ chainEl = null;
  /** @type {HTMLElement|null} */ mempoolEl = null;
  /** @type {HTMLElement|null} */ ledgerEl = null;
  /** @type {HTMLElement|null} */ balanceEl = null;
  /** @type {HTMLElement|null} */ pendingEl = null;

  run() {
    this.root.classList.add("app", "app-bitcoin");
    this._loadConfig();
    this._loadChain();
    setTimeout(() => this._tryAutostart(), 0);
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
    this._buildUI();
  }

  onUnmount() {
    this.disposer.dispose();
    this.startBtn = null; this.stopBtn = null; this.mineBtn = null; this.resetBtn = null; this.txBtn = null;
    this.seedEl = null; this.toEl = null; this.amountEl = null;
    this.chainEl = null; this.mempoolEl = null; this.ledgerEl = null;
    this.balanceEl = null; this.pendingEl = null;
    super.onUnmount();
  }

  destroy() { this._stop(); super.destroy(); }

  // ---- UI ----

  _buildUI() {
    const walletText    = UI.el("span", { className: "info-value", text: this.walletAddr });
    const copyBtn       = UI.button("", () => {
      navigator.clipboard?.writeText(this.walletAddr).catch(() => {});
    }, { icon: "fa-copy" });
    copyBtn.title = t("app.bitcoin.btn.copywallet");
    const walletDisplay = UI.el("div", { className: "wallet-display", children: [walletText, copyBtn] });

    const balanceSpan   = UI.el("span", { className: "info-value", text: "0.00000000 BTC" });
    const pendingSpan   = UI.el("span", { className: "info-value", text: "0.00000000 BTC" });
    const seedInput     = UI.input({ value: this.seedAddr, placeholder: t("app.bitcoin.placeholder.seed") });
    this.seedEl = seedInput;
    this.balanceEl = balanceSpan;
    this.pendingEl = pendingSpan;

    const configPane = UI.el("div", { children: [
      UI.row(t("app.bitcoin.label.wallet"),      walletDisplay),
      UI.row(t("app.bitcoin.label.balance"),     balanceSpan),
      UI.row(t("app.bitcoin.label.unconfirmed"), pendingSpan),
      UI.row(t("app.bitcoin.label.seed"),        seedInput),
    ]});

    const chainEl = UI.el("div", { className: "msg" });
    this.chainEl = chainEl;

    const ledgerEl = UI.el("div", { className: "msg ledger-msg" });
    this.ledgerEl = ledgerEl;

    const toInput     = UI.input({ placeholder: t("app.bitcoin.placeholder.toAddr") });
    const amountInput = UI.input({ value: "0.5", placeholder: "0.5" });
    const txBtn       = UI.button(t("app.bitcoin.btn.sendtx"), () => this._sendTxFromUI(), { primary: true, icon: "fa-paper-plane" });
    const mempoolEl   = UI.el("div", { className: "msg" });
    this.toEl = toInput; this.amountEl = amountInput; this.txBtn = txBtn; this.mempoolEl = mempoolEl;

    const mempoolPane = UI.el("div", { children: [
      UI.row(t("app.bitcoin.label.to"),     toInput),
      UI.row(t("app.bitcoin.label.amount"), amountInput),
      UI.buttonRow([txBtn]),
      mempoolEl,
    ]});

    const logEl   = UI.el("div", { className: "msg" });
    this.logEl    = logEl;
    const clearBtn = UI.button(t("app.bitcoin.btn.clearlog"), () => { this.log = []; this._renderLog(); }, {});
    const logPane  = UI.el("div", { className: "log-pane", children: [UI.buttonRow([clearBtn]), logEl] });

    const { bar: tabBar } = UI.tabbedPane([
      { id: "config",  label: t("app.bitcoin.tab.config"),  pane: configPane },
      { id: "chain",   label: t("app.bitcoin.tab.chain"),   pane: chainEl },
      { id: "mempool", label: t("app.bitcoin.tab.mempool"), pane: mempoolPane },
      { id: "ledger",  label: t("app.bitcoin.tab.ledger"),  pane: ledgerEl },
      { id: "log",     label: t("app.bitcoin.tab.log"),     pane: logPane },
    ]);

    const startBtn = UI.button(t("app.bitcoin.btn.start"),      () => this._startFromUI(), { primary: true, icon: "fa-play" });
    const stopBtn  = UI.button(t("app.bitcoin.btn.stop"),       () => this._stop(),         { icon: "fa-stop" });
    const mineBtn  = UI.button(t("app.bitcoin.btn.mine"),       () => this._mine(),         { icon: "fa-hammer" });
    const resetBtn = UI.button(t("app.bitcoin.btn.resetchain"), () => this._resetChain(),   { icon: "fa-trash" });
    this.startBtn = startBtn; this.stopBtn = stopBtn; this.mineBtn = mineBtn;
    this.resetBtn = resetBtn;

    const panel = UI.panel([
      UI.el("div", { className: "app-toolbar", children: [UI.buttonRow([startBtn, stopBtn, mineBtn, resetBtn])] }),
      tabBar, configPane, chainEl, mempoolPane, ledgerEl, logPane,
    ]);

    this.root.replaceChildren(panel);
    this._syncUI(); this._renderChain(); this._renderMempool(); this._renderLedger(); this._renderLog();
    this._renderWalletBalance();
  }

  _syncUI() {
    if (this.startBtn) this.startBtn.disabled = this.running;
    if (this.stopBtn)  this.stopBtn.disabled  = !this.running;
    if (this.mineBtn)  this.mineBtn.disabled  = !this.running;
    if (this.txBtn)    this.txBtn.disabled     = !this.running;
    if (this.resetBtn) this.resetBtn.disabled  = this.running;
    if (this.seedEl)   this.seedEl.disabled    = this.running;
  }

  // ---- Lifecycle ----

  _startFromUI() {
    this.seedAddr = (this.seedEl?.value ?? "").trim();
    this._saveConfig();
    this._start();
  }

  async _start() {
    if (this.running) return;
    try {
      this.serverRef = this.os.net.openTCPServerSocket(IPAddress.fromString("::"), BITCOIN_PORT);
    } catch (e) {
      this._appendLog(t("app.bitcoin.log.startfailed", { time: nowStamp(), reason: e instanceof Error ? e.message : String(e) }));
      return;
    }
    this.running = true;
    this._writeAutostart(true);
    this._syncUI();
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
    this._syncUI();
    this._appendLog(t("app.bitcoin.log.stopped", { time: nowStamp() }));
  }

  // ---- Mining ----

  _mine() {
    if (!this.running) return;
    const tip      = this.chain.length > 0 ? this.chain[this.chain.length - 1] : null;
    const prev     = tip?.id ?? null;
    const prevHash = tip?._hash ?? null;
    const height   = tip ? tip.height + 1 : 0;
    const txs      = [...this.mempool.keys()].slice(0, 10);
    const id       = `block#${++this._blockSeq}`;
    const ts       = Date.now();

    // Compute the header hash exactly as msgBlock would produce it, so peers
    // can resolve our prevHash pointer when they receive child blocks.
    const prevHashBytes = prevHash ? fromHex(prevHash) : new Uint8Array(32);
    const headerBytes   = cat(
      u32le(1), prevHashBytes, fakeHash(id + "_merkle"),
      u32le(Math.floor(ts / 1000)), u32le(0x1d00ffff), u32le(0),
    );
    const _hash   = hex(fakeHash(Array.from(headerBytes).join(",")));
    const _header = hex(headerBytes);

    /** @type {Block} */
    const block = { id, prev, prevHash, _hash, _header, height, txs, miner: this.walletAddr, ts };
    this._integrateBlock(block);
    this._appendLog(t("app.bitcoin.log.mined", { time: nowStamp(), id, height, txCount: txs.length }));
    this._broadcastExcept(msgInv(MSG_BLOCK, fromHex(_hash)), "");
  }

  // ---- Transactions ----

  _sendTxFromUI() {
    if (!this.running) return;
    const to     = (this.toEl?.value     ?? "").trim();
    const amount = parseFloat((this.amountEl?.value ?? "").trim());
    if (!to || !Number.isFinite(amount) || amount <= 0) return;

    const { confirmed, pendingOut } = this._walletBalances();
    const available = confirmed - pendingOut;
    if (Math.round(amount * 1e8) > available) {
      this._appendLog(t("app.bitcoin.log.txinsufficient", { time: nowStamp(), available: (available / 1e8).toFixed(8) }));
      return;
    }

    const id = `tx#${++this._txSeq}`;
    /** @type {Tx} */
    const tx = { id, from: this.walletAddr, to, amount };
    this.mempool.set(id, tx);
    this._indexTx(tx);
    // Also store the content-based key so bounced-back tx is dedup'd in _onTx.
    const txRawBytes = rawTx(tx.id, tx.from, tx.to, Math.round(tx.amount * 1e8));
    const txContentHash = fakeHash(Array.from(txRawBytes.slice(0, 32)).join(","));
    this.hashIndex.set(hex(txContentHash), { type: "tx", id });
    this._renderMempool();
    this._appendLog(t("app.bitcoin.log.txcreated", { time: nowStamp(), id, to, amount: amount.toFixed(8) }));
    this._broadcastExcept(msgInv(MSG_TX, txContentHash), "");
    if (this.toEl) this.toEl.value = "";
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
      this.peers.set(key, { addr: key, height: 0, ready: false });
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
        net.sendTCPConn(connKey, msgVersion(this.chain.length));
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
        net.sendTCPConn(connKey, msgVersion(this.chain.length));
        net.sendTCPConn(connKey, msgVerack());
        const ack = await readBtcMsg(net, connKey, state);
        if (!ack || ack.cmd !== "verack") return;
      }

      peer.ready = true;
      this._appendLog(t("app.bitcoin.log.peerin", { time: nowStamp(), addr: peer.addr, height: peer.height }));

      // ---- Initial chain sync ----
      if (peer.height > this.chain.length) {
        const tipBlock = this.chain.length > 0 ? this.chain[this.chain.length - 1] : null;
        const tip = tipBlock?._hash ? fromHex(tipBlock._hash) : new Uint8Array(32);
        net.sendTCPConn(connKey, msgGetblocks(tip));
      } else {
        for (const block of this.chain.slice(peer.height)) {
          net.sendTCPConn(connKey, msgInv(MSG_BLOCK, block._hash ? fromHex(block._hash) : fakeHash(block.id)));
        }
      }

      // ---- Message loop ----
      while (this.running && this.peers.has(connKey)) {
        const msg = await readBtcMsg(net, connKey, state);
        if (msg == null) break;

        switch (msg.cmd) {
          case "inv":      this._onInv(msg.payload, connKey);     break;
          case "getdata":  this._onGetdata(msg.payload, connKey); break;
          case "block":    this._onBlock(msg.payload, connKey);   break;
          case "tx":       this._onTx(msg.payload, connKey);      break;
          case "getblocks": {
            // Parse block locator hash (first entry after version+count)
            const p = msg.payload;
            const locatorCount = p.length > 4 ? (p[4] < 0xfd ? p[4] : 0) : 0;
            const locatorOff   = 4 + (p[4] < 0xfd ? 1 : 3);
            const locatorHex   = locatorCount > 0 && p.length >= locatorOff + 32
              ? hex(p.slice(locatorOff, locatorOff + 32)) : null;
            const locatorIdx   = locatorHex
              ? this.chain.findIndex(b => b._hash === locatorHex)
              : -1;
            const startIdx = locatorIdx >= 0 ? locatorIdx + 1 : 0;
            for (const block of this.chain.slice(startIdx)) {
              net.sendTCPConn(connKey, msgInv(MSG_BLOCK, block._hash ? fromHex(block._hash) : fakeHash(block.id)));
            }
            break;
          }
        }
      }
    } finally {
      this.peers.delete(connKey);
      try { net.closeTCPConn(connKey); } catch { }
      this._appendLog(t("app.bitcoin.log.peerout", { time: nowStamp(), addr: peer.addr }));
    }
  }

  // ---- Protocol handlers ----

  /** @param {Uint8Array} payload @param {string} fromKey */
  _onInv(payload, fromKey) {
    const net = this.os.net;
    for (const { type, hash } of parseInvPayload(payload)) {
      if (!this.hashIndex.has(hex(hash))) {
        try { net.sendTCPConn(fromKey, msgGetdata(type, hash)); } catch { }
      }
    }
  }

  /** @param {Uint8Array} payload @param {string} fromKey */
  _onGetdata(payload, fromKey) {
    const net = this.os.net;
    for (const { type, hash } of parseInvPayload(payload)) {
      const entry = this.hashIndex.get(hex(hash));
      if (!entry) continue;
      try {
        if (entry.type === "block") {
          const b = this.blockMap.get(entry.id);
          if (b) net.sendTCPConn(fromKey, msgBlock(b, this.confirmedTxs));
        } else {
          const tx = this.mempool.get(entry.id) ?? this.confirmedTxs.get(entry.id);
          if (tx) net.sendTCPConn(fromKey, msgTx(tx));
        }
      } catch { }
    }
  }

  /** @param {Uint8Array} payload @param {string} fromKey */
  _onBlock(payload, fromKey) {
    if (payload.length < 80) return;
    // headerKey IS the block's canonical hash — matches what the sender stored as _hash.
    const headerKey   = hex(fakeHash(Array.from(payload.slice(0, 80)).join(",")));
    if (this.hashIndex.has(headerKey)) return;

    const prevHashBytes = payload.slice(4, 36);
    const prevHashHex   = hex(prevHashBytes);
    const isGenesis     = prevHashBytes.every(b => b === 0);
    let prevId = null, prevBlock = null;
    if (!isGenesis) {
      const prevEntry = this.hashIndex.get(prevHashHex);
      if (!prevEntry || prevEntry.type !== "block") {
        if (this.orphans.size < 50) this.orphans.set(headerKey, { payload, fromKey });
        // Request the missing parent so sync doesn't stall waiting for it.
        try { this.os.net.sendTCPConn(fromKey, msgGetdata(MSG_BLOCK, prevHashBytes)); } catch { }
        return;
      }
      prevId    = prevEntry.id;
      prevBlock = this.blockMap.get(prevId) ?? null;
    }
    const height   = prevBlock ? prevBlock.height + 1 : 0;
    const id       = `block#${++this._blockSeq}`;
    const prevHash = isGenesis ? null : prevHashHex;

    const txPayloads = parseBlockTxs(payload);
    const miner = txPayloads.length > 0 ? (parseTxPayload(txPayloads[0])?.to ?? "(peer)") : "(peer)";

    const txsInBlock = [];
    for (const txPay of txPayloads.slice(1)) {
      const p = parseTxPayload(txPay);
      if (!p) continue;
      const pSats = Math.round(p.amount * 1e8);
      let found = false;
      for (const [txId, tx] of this.mempool) {
        if (tx.from === p.from && tx.to === p.to && Math.round(tx.amount * 1e8) === pSats) {
          txsInBlock.push(txId); found = true; break;
        }
      }
      if (!found) {
        // Tx wasn't in our mempool (e.g. full sync from scratch).
        // Check by content hash first to avoid duplicates with late relay arrivals.
        const txKey = hex(fakeHash(Array.from(txPay.slice(0, 32)).join(",")));
        const existing = this.hashIndex.get(txKey);
        if (existing?.type === "tx") {
          txsInBlock.push(existing.id);
        } else {
          const id = `tx#${++this._txSeq}`;
          const tx = { id, from: p.from, to: p.to, amount: p.amount };
          this.confirmedTxs.set(id, tx);
          this._indexTx(tx);
          this.hashIndex.set(txKey, { type: "tx", id });
          txsInBlock.push(id);
        }
      }
    }

    const tsRaw   = ((payload[68] | (payload[69] << 8) | (payload[70] << 16) | (payload[71] << 24)) >>> 0) * 1000;
    const _header = hex(payload.slice(0, 80));
    /** @type {Block} */
    const block = { id, prev: prevId, prevHash, _hash: headerKey, _header, height, txs: txsInBlock, miner, ts: tsRaw };
    this._integrateBlock(block);
    this._appendLog(t("app.bitcoin.log.blockrcv", { time: nowStamp(), id, height, miner }));
    this._broadcastExcept(msgInv(MSG_BLOCK, fromHex(headerKey)), fromKey);
  }

  /** @param {Uint8Array} payload @param {string} fromKey */
  _onTx(payload, fromKey) {
    if (payload.length < 10) return;
    const txKey = hex(fakeHash(Array.from(payload.slice(0, 32)).join(",")));
    if (this.hashIndex.has(txKey)) return;

    const id     = `tx#${++this._txSeq}`;
    const parsed = parseTxPayload(payload);
    /** @type {Tx} */
    const tx = { id, from: parsed?.from ?? "(peer)", to: parsed?.to ?? "(peer)", amount: parsed?.amount ?? 0 };
    this.mempool.set(id, tx);
    this._indexTx(tx);
    this.hashIndex.set(txKey, { type: "tx", id });
    this._appendLog(t("app.bitcoin.log.txrcv", { time: nowStamp(), id, from: tx.from, to: tx.to, amount: tx.amount.toFixed(8) }));
    this._renderMempool();
    this._renderWalletBalance();
    // Relay with the same content-based hash so all nodes use a consistent inv key.
    this._broadcastExcept(msgInv(MSG_TX, fromHex(txKey)), fromKey);
  }

  // ---- Internal helpers ----

  /** @param {Block} block */
  _indexBlock(block) {
    // Use content-based header hash as key so cross-node prevHash lookups resolve correctly.
    // Fall back to fakeHash(id) for legacy blocks loaded from old saves.
    const key = block._hash ?? hex(fakeHash(block.id));
    this.hashIndex.set(key, { type: "block", id: block.id });
  }

  /** @param {Tx} tx */
  _indexTx(tx)       { this.hashIndex.set(hex(fakeHash(tx.id)),   { type: "tx",    id: tx.id    }); }

  /** @param {Block} block */
  _integrateBlock(block) {
    this._indexBlock(block);
    this.blockMap.set(block.id, block);
    const newChain = this._selectChain();
    const newTip   = newChain[newChain.length - 1];
    const oldTip   = this.chain[this.chain.length - 1];
    if (newTip?.id !== oldTip?.id) {
      const isReorg = !!oldTip && !newChain.some(b => b.id === oldTip.id);
      this._reorg(newChain);
      if (isReorg) this._appendLog(t("app.bitcoin.log.reorg", { time: nowStamp(), height: newChain.length - 1 }));
    }
    this._renderChain(); this._renderMempool(); this._renderLedger();
    this._renderWalletBalance(); this._saveChain();
    this._resolveOrphans();
  }

  /** @returns {Block[]} */
  _selectChain() {
    let tip = null;
    for (const b of this.blockMap.values()) {
      if (!tip || b.height > tip.height || (b.height === tip.height && b.ts < tip.ts)) tip = b;
    }
    if (!tip) return [];
    const chain = [];
    /** @type {typeof tip|null} */
    let cur = tip;
    while (cur) { chain.unshift(cur); cur = cur.prev ? (this.blockMap.get(cur.prev) ?? null) : null; }
    return chain;
  }

  /** @param {Block[]} newChain */
  _reorg(newChain) {
    const oldChain = this.chain;
    let fork = 0;
    while (fork < oldChain.length && fork < newChain.length && oldChain[fork].id === newChain[fork].id) fork++;
    for (let i = oldChain.length - 1; i >= fork; i--) {
      for (const txId of oldChain[i].txs) {
        const tx = this.confirmedTxs.get(txId);
        if (tx) { this.mempool.set(txId, tx); this.confirmedTxs.delete(txId); }
      }
    }
    for (let i = fork; i < newChain.length; i++) {
      for (const txId of newChain[i].txs) {
        const tx = this.mempool.get(txId) ?? this.confirmedTxs.get(txId);
        if (tx) { this.confirmedTxs.set(txId, tx); this.mempool.delete(txId); }
      }
    }
    this.chain = newChain;
  }

  _resolveOrphans() {
    let progress = true;
    while (progress) {
      progress = false;
      for (const [key, { payload, fromKey }] of this.orphans) {
        const isGenesis   = payload.slice(4, 36).every(b => b === 0);
        const prevHashHex = hex(payload.slice(4, 36));
        if (isGenesis || this.hashIndex.has(prevHashHex)) {
          this.orphans.delete(key);
          this._onBlock(payload, fromKey);
          progress = true;
          break;
        }
      }
    }
  }

  // ---- Ledger ----

  /** @returns {Map<string,number>} address → satoshis */
  _computeBalances() {
    /** @type {Map<string,number>} */
    const bal = new Map();
    const add = (/** @type {string} */ addr, /** @type {number} */ sats) => bal.set(addr, (bal.get(addr) ?? 0) + sats);

    for (const block of this.chain) {
      add(block.miner, 1e8);
      for (const txId of block.txs) {
        const tx = this.confirmedTxs.get(txId);
        if (tx) {
          add(tx.to,   Math.round(tx.amount * 1e8));
          add(tx.from, -Math.round(tx.amount * 1e8));
        }
      }
    }
    return bal;
  }

  /** @returns {{ confirmed: number, pendingOut: number, pendingIn: number }} satoshis */
  _walletBalances() {
    const confirmed  = this._computeBalances().get(this.walletAddr) ?? 0;
    let pendingOut = 0, pendingIn = 0;
    for (const tx of this.mempool.values()) {
      if (tx.from === this.walletAddr) pendingOut += Math.round(tx.amount * 1e8);
      if (tx.to   === this.walletAddr) pendingIn  += Math.round(tx.amount * 1e8);
    }
    return { confirmed, pendingOut, pendingIn };
  }

  _renderWalletBalance() {
    if (!this.balanceEl && !this.pendingEl) return;
    const { confirmed, pendingOut, pendingIn } = this._walletBalances();
    if (this.balanceEl)
      this.balanceEl.textContent = (confirmed / 1e8).toFixed(8) + " BTC";
    if (this.pendingEl) {
      const net = pendingIn - pendingOut;
      this.pendingEl.textContent = (net >= 0 ? "+" : "") + (net / 1e8).toFixed(8) + " BTC";
    }
  }

  _renderLedger() {
    if (!this.ledgerEl) return;
    const bal = this._computeBalances();
    if (!bal.size) { this.ledgerEl.textContent = t("app.bitcoin.ledger.empty"); return; }

    const { table, tbody } = UI.tableWithBody(
      [t("app.bitcoin.ledger.col.address"), t("app.bitcoin.ledger.col.balance")],
      "ledger-table"
    );
    const sorted = [...bal.entries()].sort((a, b) => b[1] - a[1]);
    for (const [addr, sats] of sorted) {
      const isOwn = addr === this.walletAddr;
      tbody.appendChild(UI.el("tr", { children: [
        UI.el("td", { text: addr, className: isOwn ? "ledger-own" : undefined }),
        UI.el("td", { text: (sats / 1e8).toFixed(8) + " BTC", className: "ledger-amount" }),
      ]}));
    }

    this.ledgerEl.replaceChildren(table);
  }

  /** @param {Uint8Array} data @param {string} excludeKey */
  _broadcastExcept(data, excludeKey) {
    for (const [key, peer] of this.peers) {
      if (key !== excludeKey && peer.ready) { try { this.os.net.sendTCPConn(key, data); } catch { } }
    }
  }

  // ---- Render ----

  _renderChain() {
    if (!this.chainEl) return;
    if (!this.blockMap.size) { this.chainEl.textContent = t("app.bitcoin.chain.empty"); return; }
    const mainIds = new Set(this.chain.map(b => b.id));
    const lines = this.chain.slice().reverse().map(b =>
      `#${b.height}  ${b.id}  TXs:${b.txs.length}  Miner:${b.miner}`
    );
    const stale = [...this.blockMap.values()].filter(b => !mainIds.has(b.id))
      .sort((a, b) => b.height - a.height);
    if (stale.length) {
      lines.push("");
      for (const b of stale)
        lines.push(`${t("app.bitcoin.chain.stale")} #${b.height}  ${b.id}  TXs:${b.txs.length}  Miner:${b.miner}`);
    }
    this.chainEl.textContent = lines.join("\n");
  }

  _renderMempool() {
    if (!this.mempoolEl) return;
    if (!this.mempool.size) { this.mempoolEl.textContent = t("app.bitcoin.mempool.empty"); return; }
    this.mempoolEl.textContent = [...this.mempool.values()].map(tx =>
      `${tx.id}  ${tx.from} → ${tx.to}  ${tx.amount.toFixed(8)} BTC`
    ).join("\n");
  }

  // ---- Config ----

  _loadConfig() {
    const fs = this.os.fs;
    if (!fs) { this._initWallet(); return; }
    try {
      const cfg = JSON.parse(fs.readFile("/etc/bitcoin.conf"));
      if (typeof cfg.walletAddr === "string" && cfg.walletAddr) this.walletAddr = cfg.walletAddr;
      if (typeof cfg.seedAddr === "string") this.seedAddr = cfg.seedAddr;
    } catch { }
    if (!this.walletAddr) this._initWallet();
  }

  _initWallet() {
    this.walletAddr = genAddress((Math.random() * 0xffffffff) >>> 0);
    this._saveConfig();
  }

  _saveConfig() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      fs.writeFile("/etc/bitcoin.conf", JSON.stringify({
        walletAddr: this.walletAddr, seedAddr: this.seedAddr,
      }, null, 2));
    } catch { }
  }

  _loadChain() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      const d = JSON.parse(fs.readFile("/etc/bitcoin.chain"));
      if (Array.isArray(d.confirmedTxs))  this.confirmedTxs = new Map(d.confirmedTxs);
      if (typeof d.blockSeq === "number") this._blockSeq    = d.blockSeq;
      if (typeof d.txSeq    === "number") this._txSeq       = d.txSeq;
      if (Array.isArray(d.blockMap)) {
        this.blockMap = new Map(d.blockMap);
      } else if (Array.isArray(d.chain)) {
        // Legacy format: rebuild blockMap from flat chain array
        for (const block of d.chain) this.blockMap.set(block.id, block);
      }
      for (const block of this.blockMap.values()) this._indexBlock(block);
      for (const tx of this.confirmedTxs.values()) this._indexTx(tx);
      this.chain = this._selectChain();
    } catch { }
  }

  _saveChain() {
    const fs = this.os.fs;
    if (!fs) return;
    try {
      fs.writeFile("/etc/bitcoin.chain", JSON.stringify({
        blockMap:     [...this.blockMap.entries()],
        confirmedTxs: [...this.confirmedTxs.entries()],
        blockSeq:     this._blockSeq,
        txSeq:        this._txSeq,
      }));
    } catch { }
  }

  _resetChain() {
    if (this.running) return;
    this.chain = [];
    this.blockMap = new Map();
    this.confirmedTxs = new Map();
    this.orphans = new Map();
    this.mempool = new Map();
    this._blockSeq = 0;
    this._txSeq = 0;
    this.hashIndex = new Map();
    this._saveChain();
    this._renderChain(); this._renderMempool(); this._renderLedger();
    this._renderWalletBalance();
    this._appendLog(t("app.bitcoin.log.chainreset", { time: nowStamp() }));
  }
}
