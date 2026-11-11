//@ts-check

import { UILib as UI } from "./UILib.js";
import { t } from "../../i18n/index.js";

/**
 * UI of the Bitcoin node: toolbar + 4 tabs (Wallet, Blockchain, Network, Log).
 * Holds no protocol state – everything is read from the app on render().
 *
 * @typedef {import("../BitcoinNodeApp.js").BitcoinNodeApp} App
 * @typedef {{ id: string, prev: string|null, height: number, txs: string[], miner: string }} BlockLike
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const SAFE_CONFIRMATIONS = 6;
const GRAPH_HEIGHTS = 30;          // show at most the newest 30 heights

/** @param {number} sats */
const btc = sats => (sats / 1e8).toFixed(8);
/** @param {string} s @param {number} n */
const short = (s, n = 10) => s.length > n + 1 ? s.slice(0, n) + "…" : s;

/**
 * @template {keyof SVGElementTagNameMap} K
 * @param {K} tag @param {Record<string, string|number>} attrs @param {(Node|null)[]} [children]
 * @returns {SVGElementTagNameMap[K]}
 */
function svg(tag, attrs, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

export class BitcoinNodeView {
  /** @param {App} app */
  constructor(app) {
    this.app = app;
    /** Tx whose "spend again" form is open. @type {string|null} */
    this.respendFor = null;

    // Toolbar
    this.startBtn = UI.button(t("app.bitcoin.btn.start"), () => app._startFromUI(this.seedInput.value), { primary: true, icon: "fa-play" });
    this.stopBtn  = UI.button(t("app.bitcoin.btn.stop"), () => app._stop(), { icon: "fa-stop" });
    this.mineBtn  = UI.button(t("app.bitcoin.btn.mine"), () => app._mine(), { icon: "fa-hammer" });
    this.withholdBtn = UI.button(t("app.bitcoin.btn.withhold"), () => app._toggleWithhold(), {
      icon: "fa-user-secret", title: t("app.bitcoin.withhold.title"),
    });
    this.withholdChip = UI.el("span", { className: "btc-chip btc-chip-secret" });
    const toolbar = UI.el("div", { className: "app-toolbar btc-toolbar", children: [
      UI.buttonRow([this.startBtn, this.stopBtn, this.mineBtn, this.withholdBtn]), this.withholdChip,
    ]});

    // ---- Wallet tab
    this.addrEl = UI.el("span", { className: "info-value btc-addr" });
    const copyBtn = UI.button("", () => { navigator.clipboard?.writeText(app.walletAddr).catch(() => {}); }, { icon: "fa-copy" });
    copyBtn.title = t("app.bitcoin.btn.copywallet");
    this.balanceEl = UI.el("div", { className: "btc-stat-value" });
    this.immatureEl = UI.el("div", { className: "btc-stat-value btc-stat-small" });
    this.pendingEl = UI.el("div", { className: "btc-stat-value btc-stat-small" });

    this.toInput     = UI.input({ placeholder: t("app.bitcoin.placeholder.toAddr"), className: "input btc-grow" });
    this.amountInput = UI.input({ value: "0.5", className: "input btc-amount" });
    this.sendVia     = UI.select([], { className: "input btc-via" });
    this.sendBtn     = UI.button(t("app.bitcoin.btn.sendtx"), () => this._send(), { primary: true, icon: "fa-paper-plane" });
    this.history     = this._scrollBox();
    this.historyEl   = this.history.content;

    // persistent "spend again" form, moved into the table row it belongs to
    this.respendTo   = UI.input({ className: "input btc-grow" });
    this.respendVia  = UI.select([], { className: "input btc-via" });
    this.respendForm = UI.el("div", { className: "btc-respend", children: [
      UI.el("span", { className: "btc-muted", text: t("app.bitcoin.respend.to") }),
      this.respendTo, this.respendVia,
      UI.button(t("app.bitcoin.respend.send"), () => this._respend(), { primary: true, icon: "fa-rotate-left" }),
    ]});

    const walletPane = UI.el("div", { className: "btc-pane", children: [
      UI.el("div", { className: "wallet-display", children: [
        UI.el("span", { className: "btc-muted", text: t("app.bitcoin.label.wallet") }), this.addrEl, copyBtn,
      ]}),
      UI.el("div", { className: "btc-stats", children: [
        UI.el("div", { className: "btc-stat", children: [UI.el("div", { className: "btc-muted", text: t("app.bitcoin.label.spendable") }), this.balanceEl] }),
        UI.el("div", { className: "btc-stat", attrs: { title: t("app.bitcoin.immature.title", { n: app.coinbaseMaturity }) },
          children: [UI.el("div", { className: "btc-muted", text: t("app.bitcoin.label.immature") }), this.immatureEl] }),
        UI.el("div", { className: "btc-stat", children: [UI.el("div", { className: "btc-muted", text: t("app.bitcoin.label.unconfirmed") }), this.pendingEl] }),
      ]}),
      UI.el("div", { className: "btc-send", children: [this.toInput, this.amountInput, this.sendVia, this.sendBtn] }),
      this.history.outer,
    ]});

    // ---- Blockchain tab
    this.graphEl  = UI.el("div", { className: "btc-graph" });
    this.graphHintL = UI.el("div", { className: "btc-hint-x btc-hint-left", attrs: { "aria-hidden": "true" }, text: "◀" });
    this.graphHintR = UI.el("div", { className: "btc-hint-x btc-hint-right", attrs: { "aria-hidden": "true" }, text: "▶" });
    this.graphEl.addEventListener("scroll", () => this._updateGraphHints(), { passive: true });
    const graphOuter = UI.el("div", { className: "btc-graph-outer", children: [this.graphEl, this.graphHintL, this.graphHintR] });
    this.ledger   = this._scrollBox();
    this.ledgerEl = this.ledger.content;
    const legend = UI.el("div", { className: "btc-legend", children: [
      UI.el("span", { className: "btc-chip btc-chip-main",   text: t("app.bitcoin.chain.legend.active") }),
      UI.el("span", { className: "btc-chip btc-chip-stale",  text: t("app.bitcoin.chain.legend.stale") }),
      UI.el("span", { className: "btc-chip btc-chip-secret", text: t("app.bitcoin.chain.legend.secret") }),
    ]});
    const chainPane = UI.el("div", { className: "btc-pane", children: [
      graphOuter, legend,
      UI.el("div", { className: "btc-h", text: t("app.bitcoin.tab.ledger") }), this.ledger.outer,
    ]});

    // ---- Network tab
    this.seedInput = UI.input({ value: app.seedAddr, placeholder: t("app.bitcoin.placeholder.seed") });
    this.peers     = this._scrollBox();
    this.peersEl   = this.peers.content;
    this.mempool   = this._scrollBox();
    this.mempoolEl = this.mempool.content;
    this.resetBtn  = UI.button(t("app.bitcoin.btn.resetchain"), () => app._resetChain(), { icon: "fa-trash" });
    const netPane = UI.el("div", { className: "btc-pane", children: [
      UI.row(t("app.bitcoin.label.seed"), this.seedInput),
      UI.el("div", { className: "btc-h", text: t("app.bitcoin.net.peers") }), this.peers.outer,
      UI.el("div", { className: "btc-h", text: t("app.bitcoin.tab.mempool") }), this.mempool.outer,
      UI.buttonRow([this.resetBtn]),
    ]});

    // ---- Log tab
    const logEl = UI.el("div", { className: "msg" });
    app.logEl = logEl;
    const clearBtn = UI.button(t("app.bitcoin.btn.clearlog"), () => { app.log = []; app._renderLog(); }, {});
    const logPane = UI.el("div", { className: "log-pane", children: [UI.buttonRow([clearBtn]), logEl] });

    const { bar } = UI.tabbedPane([
      { id: "wallet",  label: t("app.bitcoin.tab.wallet"),  pane: walletPane, onShow: () => this._updateHints() },
      { id: "chain",   label: t("app.bitcoin.tab.chain"),   pane: chainPane, onShow: () => { this._scrollGraph(); this._updateHints(); } },
      { id: "network", label: t("app.bitcoin.tab.network"), pane: netPane, onShow: () => this._updateHints() },
      { id: "log",     label: t("app.bitcoin.tab.log"),     pane: logPane },
    ]);

    this.panel = UI.panel([toolbar, bar, walletPane, chainPane, netPane, logPane]);
  }

  mount() {
    this.app.root.replaceChildren(this.panel);
    this.render();
    this.app._renderLog();
  }

  async _send() {
    const tx = await this.app._send(this.toInput.value, this.amountInput.value, this.sendVia.value);
    if (tx) this.toInput.value = "";
  }

  async _respend() {
    const id = this.respendFor;
    if (!id) return;
    const tx = await this.app._respend(id, this.respendTo.value, this.respendVia.value);
    if (tx) { this.respendFor = null; this.render(); }
  }

  // ----------------------------------------------------------------- render

  render() {
    const app = this.app;
    const running = app.running;
    const w = app.withhold;

    this.startBtn.disabled = running;
    this.stopBtn.disabled = !running;
    this.mineBtn.disabled = !running;
    this.sendBtn.disabled = !running;
    this.withholdBtn.disabled = !running;
    this.resetBtn.disabled = running;
    this.seedInput.disabled = running;
    this.withholdBtn.classList.toggle("is-active", !!w);
    const label = this.withholdBtn.querySelector("span");
    if (label) label.textContent = t(w ? "app.bitcoin.btn.publish" : "app.bitcoin.btn.withhold");
    const icon = this.withholdBtn.querySelector("i");
    if (icon) icon.className = `fas ${w ? "fa-bullhorn" : "fa-user-secret"}`;
    if (w) {
      const { mine, pub } = app._withholdStatus();
      this.withholdChip.textContent = t("app.bitcoin.withhold.status", { mine, pub });
      this.withholdChip.style.display = "";
    } else {
      this.withholdChip.style.display = "none";
    }

    // wallet
    this.addrEl.textContent = app.walletAddr || "…";
    this.respendTo.placeholder = app.walletAddr;
    const { spendable, immature, pendingOut, pendingIn } = app._walletBalances();
    const net = pendingIn - pendingOut;
    this.balanceEl.textContent = `${btc(spendable)} BTC`;
    this.immatureEl.textContent = `${btc(immature)} BTC`;
    this.pendingEl.textContent = `${net >= 0 ? "+" : ""}${btc(net)} BTC`;
    this._fillVia(this.sendVia, false);
    this._fillVia(this.respendVia, true);
    this._renderHistory();

    // chain
    this._renderGraph();
    this._renderLedger();

    // network
    this._renderPeers();
    this._renderMempool();
    this._updateHints();
  }

  /**
   * Scrollable table area with the shared ▲/▼ hints. Render into `content`;
   * the hint element lives next to it inside the scroller.
   */
  _scrollBox() {
    const content = UI.el("div");
    const wrap = UI.el("div", { className: "sim-table-scroll btc-scroll", children: [content] });
    const outer = UI.wrapWithScrollHints(wrap);
    return { outer, content, update: () => wrap.dispatchEvent(new Event("scroll")) };
  }

  /** Hints only update on scroll/resize – content changes need a nudge. */
  _updateHints() {
    for (const box of [this.history, this.ledger, this.peers, this.mempool]) box.update();
    this._updateGraphHints();
  }

  _updateGraphHints() {
    const g = this.graphEl;
    const canScroll = g.scrollWidth > g.clientWidth + 2;
    this.graphHintL.classList.toggle("is-visible", canScroll && g.scrollLeft > 4);
    this.graphHintR.classList.toggle("is-visible", canScroll && g.scrollLeft + g.clientWidth < g.scrollWidth - 4);
  }

  /** Peer selector: all / single peer / nobody. @param {HTMLSelectElement} sel @param {boolean} preferNone */
  _fillVia(sel, preferNone) {
    const app = this.app;
    const items = [
      { value: "all",  label: t("app.bitcoin.peers.all") },
      ...[...app.peers].filter(([, p]) => p.ready).map(([k, p]) => ({ value: k, label: p.addr })),
      { value: "none", label: t("app.bitcoin.peers.none") },
    ];
    const key = items.map(i => i.value + i.label).join("|");
    if (sel.dataset.key === key) return;
    const prev = sel.value || (preferNone && app.withhold ? "none" : "all");
    sel.replaceChildren(...items.map(i => UI.el("option", { attrs: { value: i.value }, text: i.label })));
    sel.value = items.some(i => i.value === prev) ? prev : "all";
    sel.dataset.key = key;
  }

  _renderHistory() {
    const rows = this.app._walletHistory();
    if (!rows.length) { this.historyEl.replaceChildren(UI.el("div", { className: "btc-muted", text: t("app.bitcoin.history.empty") })); return; }
    const { table, tbody } = UI.tableWithBody(
      [t("app.bitcoin.history.col.amount"), t("app.bitcoin.history.col.party"), t("app.bitcoin.history.col.conf"), ""],
      "ledger-table");
    for (const r of rows) {
      const maturity = this.app.coinbaseMaturity;
      const conf = r.conf < 0 ? t("app.bitcoin.history.conflict")
        : r.conf === 0 ? t("app.bitcoin.history.unconfirmed")
        : r.reward && r.conf < maturity ? t("app.bitcoin.history.immature", { conf: r.conf, n: maturity })
        : r.conf >= SAFE_CONFIRMATIONS ? `${r.conf} ✓` : String(r.conf);
      const actions = UI.el("td", { className: "btc-actions" });
      if (r.txId && r.sats < 0 && !this.app.replaced.has(r.txId)) {
        const b = UI.button("", () => { this.respendFor = this.respendFor === r.txId ? null : r.txId; this.respendTo.value = ""; this.render(); },
          { icon: "fa-rotate-left", className: "btn btn-icon" });
        b.title = t("app.bitcoin.history.respend");
        actions.appendChild(b);
      }
      const rowCls = r.conf < 0 ? "btc-row-conflict"
        : r.conf === 0 || (r.reward && r.conf < maturity) ? "btc-row-pending" : undefined;
      tbody.appendChild(UI.el("tr", { className: rowCls, children: [
        UI.el("td", { className: "ledger-amount " + (r.sats < 0 ? "btc-neg" : "btc-pos"), text: `${r.sats >= 0 ? "+" : ""}${btc(r.sats)}` }),
        UI.el("td", { text: short(r.info, 24), attrs: { title: r.info } }),
        UI.el("td", { text: conf }),
        actions,
      ]}));
      if (r.txId && r.txId === this.respendFor) {
        const td = UI.el("td", { attrs: { colspan: 4 }, children: [this.respendForm] });
        tbody.appendChild(UI.el("tr", { children: [td] }));
      }
    }
    this.historyEl.replaceChildren(table);
  }

  _renderLedger() {
    const bal = this.app._computeBalances();
    if (!bal.size) { this.ledgerEl.replaceChildren(UI.el("div", { className: "btc-muted", text: t("app.bitcoin.ledger.empty") })); return; }
    const { table, tbody } = UI.tableWithBody([t("app.bitcoin.ledger.col.address"), t("app.bitcoin.ledger.col.balance")], "ledger-table");
    for (const [addr, sats] of [...bal].sort((a, b) => b[1] - a[1])) {
      tbody.appendChild(UI.el("tr", { children: [
        UI.el("td", { text: addr, className: addr === this.app.walletAddr ? "ledger-own" : undefined }),
        UI.el("td", { text: `${btc(sats)} BTC`, className: "ledger-amount" }),
      ]}));
    }
    this.ledgerEl.replaceChildren(table);
  }

  _renderPeers() {
    const peers = [...this.app.peers.values()];
    if (!peers.length) { this.peersEl.replaceChildren(UI.el("div", { className: "btc-muted", text: t("app.bitcoin.net.nopeers") })); return; }
    const { table, tbody } = UI.tableWithBody([t("app.bitcoin.net.col.addr"), t("app.bitcoin.net.col.height")], "ledger-table");
    for (const p of peers) {
      tbody.appendChild(UI.el("tr", { children: [
        UI.el("td", { text: p.addr }), UI.el("td", { text: p.ready ? String(p.height) : "…" }),
      ]}));
    }
    this.peersEl.replaceChildren(table);
  }

  _renderMempool() {
    const txs = [...this.app.mempool.values()];
    if (!txs.length) { this.mempoolEl.replaceChildren(UI.el("div", { className: "btc-muted", text: t("app.bitcoin.mempool.empty") })); return; }
    const { table, tbody } = UI.tableWithBody(
      ["TX", t("app.bitcoin.mempool.col.from"), t("app.bitcoin.mempool.col.to"), t("app.bitcoin.history.col.amount")], "ledger-table");
    for (const tx of txs) {
      tbody.appendChild(UI.el("tr", { children: [
        UI.el("td", { text: tx.id.slice(0, 8) }),
        UI.el("td", { text: short(tx.from, 12), attrs: { title: tx.from } }),
        UI.el("td", { text: short(tx.to, 12), attrs: { title: tx.to } }),
        UI.el("td", { text: btc(Math.round(tx.amount * 1e8)), className: "ledger-amount" }),
      ]}));
    }
    this.mempoolEl.replaceChildren(table);
  }

  // ------------------------------------------------------------ fork graph

  /**
   * Blocks as boxes, one column per height. The active chain is row 0,
   * every other branch gets its own row below, connected to its fork point.
   */
  _renderGraph() {
    const app = this.app;
    /** @type {BlockLike[]} */
    const blocks = [...app.blockMap.values()];
    if (!blocks.length) { this.graphEl.replaceChildren(UI.el("div", { className: "btc-muted", text: t("app.bitcoin.chain.empty") })); return; }

    const maxH = Math.max(...blocks.map(b => b.height));
    const minH = Math.max(0, maxH - GRAPH_HEIGHTS + 1);
    const mainIds = new Set(app.chain.map(b => b.id));

    /** @type {Map<string, number>} */
    const row = new Map();
    for (const b of app.chain) row.set(b.id, 0);
    const hasChild = new Set(blocks.map(b => b.prev).filter(Boolean));
    const tips = blocks.filter(b => !hasChild.has(b.id) && !row.has(b.id)).sort((a, b) => b.height - a.height);
    let nextRow = 1;
    for (const tip of tips) {
      const r = nextRow++;
      for (let b = /** @type {BlockLike|undefined} */ (tip); b && !row.has(b.id); b = b.prev ? app.blockMap.get(b.prev) : undefined) row.set(b.id, r);
    }

    const W = 96, H = 52, GX = 22, GY = 16, P = 6;
    /** @param {BlockLike} b */
    const pos = b => ({ x: P + (b.height - minH) * (W + GX), y: P + (row.get(b.id) ?? 0) * (H + GY) });
    const shown = blocks.filter(b => b.height >= minH);
    const width = P * 2 + (maxH - minH + 1) * (W + GX) - GX;
    const height = P * 2 + nextRow * (H + GY) - GY;

    const lines = [], boxes = [];
    for (const b of shown) {
      const { x, y } = pos(b);
      const parent = b.prev ? app.blockMap.get(b.prev) : undefined;
      if (parent && parent.height >= minH) {
        const p = pos(parent);
        const x1 = p.x + W, y1 = p.y + H / 2, x2 = x, y2 = y + H / 2;
        lines.push(svg("path", { d: `M${x1},${y1} C${x1 + GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2},${y2}`, class: "btc-link" }));
      }
      const kind = app.withheld.has(b.id) ? "secret" : mainIds.has(b.id) ? "main" : "stale";
      const own = b.miner === app.walletAddr;
      const title = svg("title", {});
      title.textContent = `#${b.height}  ${b.id}\nMiner: ${b.miner}\nTXs: ${b.txs.length}`;
      boxes.push(svg("g", { class: `btc-blk btc-blk-${kind}${own ? " btc-blk-own" : ""}`, transform: `translate(${x},${y})` }, [
        title,
        svg("rect", { width: W, height: H, rx: 6 }),
        this._svgText(8, 16, `#${b.height}`, "btc-blk-h"),
        this._svgText(W - 8, 16, own ? t("app.bitcoin.chain.mine") : "", "btc-blk-own-label", "end"),
        this._svgText(8, 31, b.id.slice(0, 10), "btc-blk-hash"),
        this._svgText(8, 45, `${b.txs.length} TX`, "btc-blk-tx"),
      ]));
    }
    const graph = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}` }, [...lines, ...boxes]);
    this.graphEl.replaceChildren(graph);
    this._scrollGraph();
  }

  /** @param {number} x @param {number} y @param {string} text @param {string} cls @param {string} [anchor] */
  _svgText(x, y, text, cls, anchor = "start") {
    const el = svg("text", { x, y, class: cls, "text-anchor": anchor });
    el.textContent = text;
    return el;
  }

  _scrollGraph() { this.graphEl.scrollLeft = this.graphEl.scrollWidth; this._updateGraphHints(); }
}
