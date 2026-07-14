// @ts-check
import loadWiregasm from "@goodtools/wiregasm/dist/wiregasm";
import { TabPicker } from "./lib/TabPicker.js";
import { SplitGrid } from "./lib/SplitGrid.js";
import { SimControl } from "../SimControl.js";
import { t } from "../i18n/index.js";
import { makeDraggable } from "../lib/dragabble.js";

/** @typedef {any} WiregasmModule */
/** @typedef {any} DissectSession */


/**
 * @typedef {{
 *   limit?: number;
 *   locateWasm?: string;
 *   locateData?: string;
 *   initialFilter?: string;
 *   autoSelectFirst?: boolean;
 *   onSessionClosed?: (name: string) => void;
 *   onActiveTabChange?: (name: string | null) => void;
 *   hideComputedTreeNodes?: boolean;
 *   simControl?: SimControl;
 * }} PCAPViewerOptions
 */

/**
 * @typedef {{
 *   filter?: string;
 *   autoSelectFirst?: boolean;
 * }} LoadBytesOptions
 */

/**
 * @typedef {{
 *   name: string;
 *   sess: DissectSession|null;
 *   skip: number;
 *   filter: string;
 *   selectedNo: number|null;
 *   selectedTreeEl: HTMLElement|null;
 *   hasCapture: boolean;
 *   pendingAutoSelect: boolean;
 *   pcapPath: string;
 *   hidden: boolean;
 *   loadSeq: number;
 *   pcapBytes: Uint8Array|null;
 *   startTime: number|null;
 * }} SessionState
 */

/**
 * @typedef {{
 *   containerSel: string;
 *   splitterSel: string;
 *   primaryPaneSel: string;
 *   splitSizePx: number;
 *   minA: number;
 *   minB: number;
 *   axis: "x" | "y";
 *   cursor: "col-resize" | "row-resize";
 *   storageKey: string;
 *   getRatio: () => number|null;
 *   setRatio: (v: number|null) => void;
 *   getAbort: () => AbortController|null;
 *   setAbort: (ac: AbortController|null) => void;
 * }} SplitConfig
 */

export class PCapViewer {
  /** @type {HTMLElement|null} */ #mount;
  /** @type {PCAPViewerOptions} */ #opt;

  /** @type {number} */ #LIMIT;

  // Wiregasm
  /** @type {WiregasmModule|null} */ #wg = null;
  /** @type {Promise<WiregasmModule>|null} */ #wgPromise = null;
  /** @type {boolean} */ #wgInited = false;

  // Sessions
  /** @type {Map<string, SessionState>} */ #sessions = new Map();
  /** @type {string|null} */ #activeName = null;

  // DOM refs
  /** @type {HTMLElement|null} */ #root = null;
  /** @type {HTMLElement|null} */ #tabsEl = null;
  /** @type {HTMLTableSectionElement|null} */ #tableBody = null;
  /** @type {HTMLInputElement|null} */ #filterEl = null;
  /** @type {HTMLElement|null} */ #statusEl = null;
  /** @type {HTMLElement|null} */ #loadingOverlay = null;
  /** @type {HTMLElement|null} */ #treePane = null;
  /** @type {HTMLElement|null} */ #rawPane = null;
  /** @type {HTMLButtonElement|null} */ #prevBtn = null;
  /** @type {HTMLButtonElement|null} */ #nextBtn = null;
  /** @type {HTMLButtonElement|null} */ #followBtn = null;

  // UI state
  /** @type {number} */ #filterTimer = 0;

  // Splitters (ratios + listener lifetime)
  /** @type {number|null} */ #hSplitRatio = null;
  /** @type {AbortController|null} */ #hSplitAbort = null;
  /** @type {number|null} */ #vSplitRatio = null;
  /** @type {AbortController|null} */ #vSplitAbort = null;

  /** @type {Uint8Array|null} */ #activeFrameBytes = null;

  /** @type {boolean} */ #tabPickerOpen = false;
  /** @type {AbortController|null} */ #tabPickerAbort = null;

  /** @type {Set<number>} */ #openLayers = new Set();

  /** @type {string|null} */ #pickerDevice = null;
  /** @type {TabPicker} */ #tabPicker = new TabPicker();
  /** @type {SplitGrid} */ #splitGrid = new SplitGrid();
  /** @type {SplitGrid} */ #vSplitGrid = new SplitGrid();

  /**
   * @param {HTMLElement|null} mountElement
   * @param {PCAPViewerOptions} [options]
   */
  constructor(mountElement, options = {}) {
    this.#mount = mountElement ?? null;
    this.#opt = options;
    this.#LIMIT = options.limit ?? 200;
  }

  // ======================================================================
  // Public API
  // ======================================================================

  /** @param {HTMLElement|null} el */
  setMount(el) {
    this.#mount = el;
  }

  /** Render (or re-render) into current mount */
  render() {
    if (!this.#mount) return;

    // If rendered elsewhere, detach old root
    if (this.#root && this.#root.parentElement && this.#root.parentElement !== this.#mount) {
      this.#root.parentElement.removeChild(this.#root);
      this.#root = null;
    }

    // Create shell if needed
    if (!this.#root || this.#root.parentElement !== this.#mount) {
      this.#renderShell();
      this.#wireUI();

      // wire splitters (safe even if missing)
      if (this.#root) {
        this.#splitGrid.wire(this.#root, this.#makeHSplitConfig());
        this.#vSplitGrid.wire(this.#root, this.#makeVSplitConfig());
      }
    }

    this.#renderTabs();
    this.#renderActiveSession();
  }

  /** @param {string} name */
  newSession(name) {
    this.render();

    name = String(name ?? "").trim();
    if (!name) throw new Error("newSession(name): name must be non-empty");
    if (this.#sessions.has(name)) return;

    const safe = name.replaceAll(/[^a-zA-Z0-9._-]/g, "_");

    const s = /** @type {SessionState} */ ({
      name,
      sess: null,
      skip: 0,
      filter: (this.#opt.initialFilter ?? "").trim(),
      selectedNo: null,
      selectedTreeEl: null,
      hasCapture: false,
      pendingAutoSelect: this.#opt.autoSelectFirst ?? true,
      pcapPath: `/uploads/${safe}.pcap`,
      hidden: true,
      loadSeq: 0,
      pcapBytes: null,
    });

    this.#sessions.set(name, s);
    this.#renderTabs();
    this.#renderActiveSession();
  }

  /** Hide a tab (session remains alive). @param {string} name */
  hideTab(name) {
    const s = this.#sessions.get(name);
    if (!s) return;

    s.hidden = true;

    // If hiding the active tab, pick another visible tab (or none)
    if (this.#activeName === name) {
      const nextVisible = Array.from(this.#sessions.values())
        .filter(x => !x.hidden)
        .map(x => x.name)
        .sort((a, b) => a.localeCompare(b))[0] ?? null;

      this.#activeName = nextVisible;
      this.#opt.onActiveTabChange?.(nextVisible);
    }

    this.#closeTabPicker();
    this.#renderTabs();
    this.#renderActiveSession();
  }


  /** @param {string} name */
  switchTab(name) {
    if (!this.#sessions.has(name)) throw new Error(`switchTab: session '${name}' not found`);

    const ss = this.#sessions.get(name);
    if (ss) ss.hidden = false;

    this.#activeName = name;

    this.#closeTabPicker();
    this.#renderTabs();
    this.#opt.onActiveTabChange?.(name);
    this.render();
  }

  /** @param {string} name */
  closeSession(name) {
    this.#closeTabPicker();
    const s = this.#sessions.get(name);
    if (!s) return;

    try { s.sess?.delete?.(); } catch { }
    s.sess = null;

    this.#sessions.delete(name);
    try { this.#wg?.FS.unlink(s.pcapPath); } catch { }

    if (this.#activeName === name) {
      const nextVisible = Array.from(this.#sessions.values())
        .filter(x => !x.hidden)
        .map(x => x.name)
        .sort((a, b) => a.localeCompare(b))[0] ?? null;
      this.#activeName = nextVisible;
      this.#opt.onActiveTabChange?.(nextVisible);
    }

    this.#renderTabs();
    this.#renderActiveSession();

    try { this.#opt.onSessionClosed?.(name); } catch (e) {
      console.error("onSessionClosed threw", e);
    }
  }

  /**
   * Load bytes into a named session (does not switch).
   * Renders only if that tab is active; otherwise marks dirty.
   * @param {string} name
   * @param {Uint8Array} pcapBytes
   * @param {LoadBytesOptions} [opts]
   */
  async loadBytes(name, pcapBytes, opts = {}) {
    this.render();

    const s = this.#sessions.get(name);
    if (!s) throw new Error(`loadBytes: session '${name}' not found`);

    const mySeq = ++s.loadSeq;          // ✅ claim “latest”
    const stillLatest = () => s.loadSeq === mySeq;

    s.filter = (opts.filter ?? s.filter ?? "").trim();
    s.pendingAutoSelect = opts.autoSelectFirst ?? this.#opt.autoSelectFirst ?? true;

    if (this.#activeName === name && this.#filterEl) this.#filterEl.value = s.filter;

    this.#setStatus(t("pcap.status.loading.wiregasm"));
    await this.#initWiregasm();
    if (!stillLatest()) return;         // ✅ stale completion -> ignore

    this.#setStatus(t("pcap.status.loading.pcap"));
    this.#loadPcapBytesIntoSession(s, pcapBytes);
    if (!stillLatest()) return;

    // reset session state
    s.skip = 0;
    s.selectedNo = null;
    s.selectedTreeEl = null;
    s.hasCapture = true;

    if (this.#activeName !== name) {
      this.#renderTabs();
      this.#setStatus(t("pcap.status.ready"));
      return;
    }

    this.#setStatus(t("pcap.status.rendering"));
    this.#loadAndRenderFramesForActive();
    if (!stillLatest()) return;

    if (s.pendingAutoSelect) {
      const first = this.#getFirstVisibleFrameNo();
      if (typeof first === "number") {
        s.selectedNo = first;
        this.#loadAndRenderFrameDetailsForActive(first);
        this.#highlightSelectedRow(first);
      }
    }

    this.#renderTabs();
  }


  destroy() {
    if (this.#filterTimer) window.clearTimeout(this.#filterTimer);

    this.#tabPickerAbort?.abort();
    this.#tabPickerAbort = null;
    this.#closeTabPicker();

    for (const s of this.#sessions.values()) {
      try { s.sess?.delete?.(); } catch { }
      s.sess = null;
    }
    this.#sessions.clear();
    this.#activeName = null;

    this.#splitGrid.destroy();
    this.#vSplitGrid.destroy();

    if (this.#root?.parentElement) this.#root.parentElement.removeChild(this.#root);
    this.#root = null;
  }

  // ======================================================================
  // Shell / UI Wiring
  // ======================================================================

  #renderShell() {
    if (!this.#mount) return;

    const root = document.createElement("div");
    root.className = "pcapviewer-root";
    root.innerHTML = `
      <div class="pcapviewer-tabs"></div>

      <div class="pcapviewer-toolbar">
        <input class="pcapviewer-filter" placeholder="${t("pcap.filter.placeholder")}" />
        <span class="pcapviewer-status"></span>
      </div>

      <div class="pcapviewer-layout">
        <div class="pcapviewer-wg-overlay" aria-live="polite">
          <div class="pcapviewer-wg-spinner"></div>
          <div class="pcapviewer-wg-msg"></div>
        </div>
        <div class="pcapviewer-pane pcapviewer-pane--table">
          <table class="pcapviewer-table">
            <colgroup>
              <col style="width:50px">
              <col style="width:140px">
              <col style="width:130px">
              <col style="width:130px">
              <col style="width:80px">
              <col>
            </colgroup>
            <thead>
              <tr>
                <th>${t("pcap.col.no")}<div class="pcapviewer-col-resize"></div></th>
                <th>${t("pcap.col.time")}<div class="pcapviewer-col-resize"></div></th>
                <th>${t("pcap.col.source")}<div class="pcapviewer-col-resize"></div></th>
                <th>${t("pcap.col.destination")}<div class="pcapviewer-col-resize"></div></th>
                <th>${t("pcap.col.protocol")}<div class="pcapviewer-col-resize"></div></th>
                <th>${t("pcap.col.info")}</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        <div class="pcapviewer-splitter"></div>

        <div class="pcapviewer-bottom">
          <div class="pcapviewer-pane pcapviewer-pane--tree">
            <div class="pcapviewer-treepane"></div>
          </div>
          <div class="pcapviewer-vsplitter"></div>
          <div class="pcapviewer-pane pcapviewer-pane--raw">
            <div class="pcapviewer-rawpane">${t("pcap.packet.select")}</div>
          </div>
        </div>
      </div>
    `;

    this.#mount.innerHTML = "";
    this.#mount.appendChild(root);

    this.#root = root;
    this.#tabsEl = /** @type {HTMLElement} */ (root.querySelector(".pcapviewer-tabs"));
    this.#tableBody = /** @type {HTMLTableSectionElement} */ (root.querySelector(".pcapviewer-table tbody"));
    this.#filterEl = /** @type {HTMLInputElement} */ (root.querySelector(".pcapviewer-filter"));
    this.#statusEl = /** @type {HTMLElement} */ (root.querySelector(".pcapviewer-status"));
    this.#loadingOverlay = /** @type {HTMLElement} */ (root.querySelector(".pcapviewer-wg-overlay"));
    this.#treePane = /** @type {HTMLElement} */ (root.querySelector(".pcapviewer-treepane"));
    this.#rawPane = /** @type {HTMLElement} */ (root.querySelector(".pcapviewer-rawpane"));
  }

  #wireUI() {
    if (!this.#root) return;

    this.#filterEl?.addEventListener("input", () => {
      window.clearTimeout(this.#filterTimer);
      this.#filterTimer = window.setTimeout(() => {
        const s = this.#active();
        if (!s) return;
        s.filter = (this.#filterEl?.value ?? "").trim();
        s.skip = 0;
        this.#loadAndRenderFramesForActive();
      }, 300);
    });

    this.#wireColumnResize();
  }

  #wireColumnResize() {
    const table = this.#root?.querySelector(".pcapviewer-table");
    if (!table) return;

    const cols = /** @type {NodeListOf<HTMLTableColElement>} */ (table.querySelectorAll("col"));
    const ths  = /** @type {NodeListOf<HTMLTableCellElement>} */ (table.querySelectorAll("thead th"));
    const handles = table.querySelectorAll(".pcapviewer-col-resize");

    handles.forEach((handle, i) => {
      const col = cols[i];
      const th  = ths[i];
      if (!col || !th) return;

      handle.addEventListener("pointerdown", (ev) => {
        const e = /** @type {PointerEvent} */ (ev);
        e.preventDefault();
        const startX = e.clientX;
        const startW = th.getBoundingClientRect().width;

        handle.classList.add("is-resizing");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const onMove = (/** @type {PointerEvent} */ e) => {
          col.style.width = Math.max(30, startW + e.clientX - startX) + "px";
        };
        const onUp = () => {
          handle.classList.remove("is-resizing");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          window.removeEventListener("pointermove", onMove, true);
          window.removeEventListener("pointerup", onUp, true);
        };

        window.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", onUp, true);
      });
    });
  }

  // ======================================================================
  // Tabs / Active Session Rendering
  // ======================================================================

  /** @returns {SessionState|null} */
  #active() {
    if (!this.#activeName) return null;
    return this.#sessions.get(this.#activeName) ?? null;
  }

  #renderTabs() {
    if (!this.#tabsEl) return;

    const all = Array.from(this.#sessions.values());
    const visible = all.filter(s => !s.hidden);

    this.#tabsEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "pcapviewer-tabs-title";
    empty.textContent = t("pcap.tabs.title");
    this.#tabsEl.appendChild(empty);

    // If no visible tabs, show a small hint (but still show +)
    if (visible.length === 0) {

    } else {
      for (const s of visible) {
        const name = s.name;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pcapviewer-tab" + (name === this.#activeName ? " pcapviewer-tab--active" : "");
        btn.title = s.hasCapture ? name : t("pcap.tab.nocapture", { name });

        const label = document.createElement("span");
        label.textContent = this.#displayName(name) + (s.hasCapture ? "" : " •");
        btn.appendChild(label);

        btn.addEventListener("click", () => this.switchTab(name));

        const x = document.createElement("span");
        x.className = "pcapviewer-tab-close";
        x.textContent = "×";
        x.title = t("pcap.btn.hidetab");
        x.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.hideTab(name);
        });

        btn.appendChild(x);
        this.#tabsEl.appendChild(btn);
      }
    }

    // ---- "+" picker at the end ----
    const plusWrap = document.createElement("div");
    plusWrap.className = "pcapviewer-tabplus";

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "pcapviewer-tab pcapviewer-tab--plus";
    plusBtn.textContent = "+";
    plusBtn.title = t("pcap.btn.showtab");
    plusBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.#tabPickerOpen = !this.#tabPickerOpen;
      this.#renderTabPicker(plusBtn);
    });

    plusWrap.appendChild(plusBtn);
    this.#tabsEl.appendChild(plusWrap);
  }

  #renderActiveSession() {
    const s = this.#active();

    if (this.#filterEl) this.#filterEl.value = s?.filter ?? "";

    if (!s || !s.sess) {
      this.#renderTable([], 0);
      if (this.#treePane) this.#treePane.textContent = s ? t("pcap.packet.nocapture") : t("pcap.packet.nosession");
      if (this.#rawPane) this.#rawPane.textContent = t("pcap.packet.select");
      this.#setStatus(s ? t("pcap.status.active.nocapture", { name: this.#displayName(s.name) }) : t("pcap.status.nosession"));
      return;
    }

    this.#loadAndRenderFramesForActive();

    if (typeof s.selectedNo === "number") {
      this.#loadAndRenderFrameDetailsForActive(s.selectedNo);
      this.#highlightSelectedRow(s.selectedNo);
    } else {
      if (this.#treePane) this.#treePane.textContent = t("pcap.packet.select");
      if (this.#rawPane) this.#rawPane.textContent = t("pcap.packet.select");
    }
  }

  /** @param {HTMLElement} anchorEl */
  #renderTabPicker(anchorEl) {
    if (!this.#tabPickerOpen) return;

    this.#tabPicker.open(anchorEl, {
      sessions: Array.from(this.#sessions.values()).map(s => ({ name: s.name, hidden: !!s.hidden })),
      activeName: this.#activeName,
      pickerDevice: this.#pickerDevice,
      setPickerDevice: (d) => { this.#pickerDevice = d; },
      onPick: (name) => this.switchTab(name),
      onClose: () => this.#closeTabPicker(),
      simControl: /** @type {any} */ (this.#opt.simControl),
    });
  }

  #closeTabPicker() {
    this.#tabPickerOpen = false;
    this.#tabPicker.close();
  }


  // ======================================================================
  // Wiregasm init + loading
  // ======================================================================

  #makeWgPromise() {
    const locateWasm = this.#opt.locateWasm ?? "/wiregasm/wiregasm.wasm";
    const locateData = this.#opt.locateData ?? "/wiregasm/wiregasm.data";
    return loadWiregasm({
      locateFile: (/** @type {string} */ path, /** @type {string} */ prefix) => {
        if (path.endsWith(".wasm")) return locateWasm;
        if (path.endsWith(".data")) return locateData;
        return prefix + path;
      },
    });
  }

  async #initWiregasm() {
    if (this.#wg && this.#wgInited) return;
    if (!this.#wgPromise) this.#wgPromise = this.#makeWgPromise();

    this.#showWgOverlay(t("pcap.status.loading.wiregasm"));
    try {
      this.#wg = await this.#wgPromise;
      if (!this.#wgInited) {
        this.#wg.init();
        this.#wgInited = true;
      }
    } finally {
      this.#hideWgOverlay();
    }
  }

  /** Start loading the Wiregasm WASM module in the background without blocking the UI.
   *  Call this during idle time so the module is ready by the time the user opens the trace tab. */
  preloadWiregasm() {
    if (this.#wgPromise) return;
    this.#wgPromise = this.#makeWgPromise();
    // Clear on failure so the next real use can retry normally
    const _p = this.#wgPromise;
    if (_p) _p.catch(() => { this.#wgPromise = null; });
  }

  /** @param {string} msg */
  #showWgOverlay(msg) {
    if (!this.#loadingOverlay) return;
    const msgEl = this.#loadingOverlay.querySelector(".pcapviewer-wg-msg");
    if (msgEl) msgEl.textContent = msg;
    this.#loadingOverlay.classList.add("is-visible");
  }

  #hideWgOverlay() {
    this.#loadingOverlay?.classList.remove("is-visible");
  }

  /** @param {SessionState} s @param {Uint8Array} pcapBytes */
  #loadPcapBytesIntoSession(s, pcapBytes) {
    if (!this.#wg) throw new Error("Wiregasm not initialized");

    s.pcapBytes = pcapBytes;
    this.#wg.FS.mkdirTree("/uploads");
    this.#wg.FS.writeFile(s.pcapPath, pcapBytes);

    // Delete all DissectSessions before creating a new one — Wireshark's TCP
    // analysis uses global conversation tables, so stale sessions from other
    // tabs would contaminate the analysis of the new session.
    for (const other of this.#sessions.values()) {
      if (other.sess) { try { other.sess.delete(); } catch { } other.sess = null; }
    }
    s.sess = new this.#wg.DissectSession(s.pcapPath);

    const ret = s.sess.load();
    if (ret?.code !== 0) throw new Error("sess.load() failed: " + JSON.stringify(ret));
    s.startTime = ret?.summary?.start_time ?? null;
  }

  /**
   * Appends raw PCAP packet records (no global header) to an existing session and re-renders.
   * Only works after loadBytes() has been called at least once for this session.
   * @param {string} name
   * @param {Uint8Array} recordBytes
   */
  appendRecords(name, recordBytes) {
    const s = this.#sessions.get(name);
    if (!s?.pcapBytes || !this.#wg || !this.#wgInited) return;

    const combined = new Uint8Array(s.pcapBytes.length + recordBytes.length);
    combined.set(s.pcapBytes);
    combined.set(recordBytes, s.pcapBytes.length);

    this.#loadPcapBytesIntoSession(s, combined);
    s.hasCapture = true;

    if (this.#activeName === name) {
      this.#loadAndRenderFramesForActive();
      if (typeof s.selectedNo === "number") {
        this.#loadAndRenderFrameDetailsForActive(s.selectedNo);
        this.#highlightSelectedRow(s.selectedNo);
      }
    }

    this.#renderTabs();
  }

  // ======================================================================
  // Frames & Table
  // ======================================================================

  #getFramesPlainForActive() {
    const s = this.#active();
    if (!s?.sess) return { frames: [], matched: 0 };

    const r = s.sess.getFrames(s.filter, s.skip, this.#LIMIT);
    const plain = this.#unwrapAll(r);

    const frames = Array.isArray(plain?.frames) ? plain.frames : this.#asArray(plain?.frames);
    return { frames, matched: plain?.matched ?? frames.length };
  }

  #loadAndRenderFramesForActive() {
    const s = this.#active();
    const { frames, matched } = this.#getFramesPlainForActive();
    this.#renderTable(frames, matched);

    if (!s) return;
    const from = frames.length > 0 ? s.skip + 1 : 0;
    const to   = s.skip + frames.length;
    this.#setStatus(t("pcap.status.active", { name: this.#displayName(s.name), from, to, matched }));
    this.#notifySimControl();
  }

  /** @param {number} startTimeSec @param {string} relTimeStr @returns {string} */
  static #formatAbsTime(startTimeSec, relTimeStr) {
    const abs = startTimeSec + parseFloat(relTimeStr);
    const d = new Date(abs * 1000);
    const p = (/** @type {number} */ n, w = 2) => String(n).padStart(w, '0');
    const frac = (abs % 1).toFixed(6).slice(1);
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${frac}`;
  }

  /** @param {any} rawRow @param {number|null} startTime */
  #rowView(rawRow, startTime = null) {
    const cols = Array.isArray(rawRow?.columns)
      ? rawRow.columns
      : (Array.isArray(rawRow?._raw?.columns) ? rawRow._raw.columns : null);

    // columns: [No, Time, Source, Destination, Protocol, Length, Info]
    if (cols && cols.length >= 6) {
      const relTime = cols[1] ?? "";
      return {
        no: Number(cols[0]) || (rawRow.no ?? rawRow.num ?? rawRow.number),
        time: (startTime != null && relTime !== "") ? PCapViewer.#formatAbsTime(startTime, relTime) : relTime,
        src: cols[2] ?? "",
        dst: cols[3] ?? "",
        proto: cols[4] ?? "",
        info: cols[6] ?? cols[5] ?? "",
        _raw: rawRow,
      };
    }

    return {
      no: rawRow.no ?? rawRow.num ?? rawRow.number,
      time: rawRow.time ?? rawRow.rel_time ?? rawRow.abs_time ?? rawRow.time_relative ?? "",
      src: rawRow.src ?? rawRow.source ?? "",
      dst: rawRow.dst ?? rawRow.destination ?? "",
      proto: rawRow.protocol ?? rawRow.proto ?? rawRow.protocols ?? "",
      info: rawRow.info ?? rawRow.summary ?? "",
      _raw: rawRow,
    };
  }

  /** @param {any[]} frames @param {number} matched */
  #renderTable(frames, matched) {
    if (!this.#tableBody) return;

    this.#tableBody.innerHTML = "";
    const s = this.#active();

    for (const r0 of frames) {
      const r = this.#rowView(r0, s?.startTime ?? null);
      const tr = document.createElement("tr");
      tr.className = "pcapviewer-row";

      const bg = this.#wiregasmColorToCss(r0?.bg);
      const fg = this.#wiregasmColorToCss(r0?.fg);
      if (bg) tr.style.backgroundColor = bg;
      if (fg) tr.style.color = fg;

      if (r0?.ignored) tr.classList.add("pcapviewer-row--ignored");
      if (r0?.marked) tr.classList.add("pcapviewer-row--marked");
      if (s && r.no === s.selectedNo) tr.classList.add("pcapviewer-row--selected");

      tr.innerHTML = `
        <td>${this.#escapeHtml(String(r.no ?? ""))}</td>
        <td>${this.#escapeHtml(String(r.time ?? ""))}</td>
        <td>${this.#escapeHtml(String(r.src ?? ""))}</td>
        <td>${this.#escapeHtml(String(r.dst ?? ""))}</td>
        <td>${this.#escapeHtml(String(r.proto ?? ""))}</td>
        <td>${this.#escapeHtml(String(r.info ?? ""))}</td>
      `;

      tr.addEventListener("click", () => {
        const s2 = this.#active();
        if (!s2) return;

        s2.selectedNo = Number(r.no);
        this.#highlightSelectedRow(s2.selectedNo);
        this.#loadAndRenderFrameDetailsForActive(s2.selectedNo);
        this.#notifySimControl();
      });

      this.#tableBody.appendChild(tr);
    }
  }

  /** @returns {number|undefined} */
  #getFirstVisibleFrameNo() {
    if (!this.#tableBody) return undefined;
    const first = this.#tableBody.querySelector("tr td");
    if (!first) return undefined;
    const no = Number(first.textContent ?? "");
    return Number.isFinite(no) ? no : undefined;
  }

  /** @param {number} no */
  #highlightSelectedRow(no) {
    if (!this.#tableBody) return;
    for (const tr of /** @type {NodeListOf<HTMLTableRowElement>} */ (this.#tableBody.querySelectorAll("tr"))) {
      tr.classList.toggle("pcapviewer-row--selected", Number(tr.cells?.[0]?.textContent) === no);
    }
  }

  // ======================================================================
  // Frame details: Tree + Raw
  // ======================================================================

  /** @param {number} no */
  #getFramePlainForActive(no) {
    const s = this.#active();
    if (!s?.sess) return null;
    return this.#unwrapAll(s.sess.getFrame(no));
  }

  /** @param {number} no */
  #loadAndRenderFrameDetailsForActive(no) {
    const details = this.#getFramePlainForActive(no);
    this.#renderTree(details);
    this.#renderRaw(details);
  }

  /** @param {any} details */
  #renderTree(details) {
    if (!this.#treePane) return;
    this.#treePane.innerHTML = "";

    const s = this.#active();
    if (!details) {
      this.#treePane.textContent = t("pcap.packet.select");
      return;
    }

    const title = document.createElement("div");
    title.className = "pcapviewer-tree-title";
    title.textContent = t("pcap.tree.title", { no: details.number ?? "?" });
    this.#treePane.appendChild(title);

    const treeRoot = details.tree ?? details.protocol_tree ?? details?.frame?.tree ?? null;
    if (!treeRoot) {
      const pre = document.createElement("pre");
      pre.className = "pcapviewer-tree-fallback";
      pre.textContent = JSON.stringify(details, null, 2);
      this.#treePane.appendChild(pre);
      return;
    }

    if (s) s.selectedTreeEl = null;

    const wrapper = document.createElement("div");
    wrapper.className = "pcapviewer-tree";
    wrapper.appendChild(this.#buildTree(treeRoot));
    this.#treePane.appendChild(wrapper);
  }

  /** @param {any[]|any} nodeOrArray @param {number} [depth] */
  #buildTree(nodeOrArray, depth = 0) {
    const ul = document.createElement("ul");
    const nodes = Array.isArray(nodeOrArray) ? nodeOrArray : [nodeOrArray];

    let protoIdx = 0;

    for (const n of nodes) {
      if (!n) continue;

      const kidsRaw = n.tree ?? n.children ?? n.items ?? n.subtree ?? null;
      const kids = Array.isArray(kidsRaw) ? kidsRaw : (kidsRaw ? [kidsRaw] : []);

      const hideComputed = this.#opt.hideComputedTreeNodes ?? true; // default: hide for teaching
      const isComputed = this.#isComputedTreeNode(n);

      // ✅ If computed: hide it, but keep its children (promote)
      if (hideComputed && isComputed) {
        if (kids.length > 0) {
          // append children directly at this level
          ul.appendChild(this.#buildTree(kids, depth));
        }
        // if it has no kids -> just skip it entirely
        continue;
      }

      const layerIdx = depth === 0 ? protoIdx++ : -1;

      // Build children first so we know if any survive after computed filtering
      const childUl = kids.length > 0 ? this.#buildTree(kids, depth + 1) : null;
      const hasKids = !!childUl && childUl.children.length > 0;

      // ----- normal rendering below (your existing code) -----
      const li = document.createElement("li");
      const row = document.createElement("div");

      const start = Number(n.start ?? 0);
      const length = Number(n.length ?? 0);
      const ds = Number(n.data_source_idx ?? 0);

      row.className = "pcapviewer-tree-node" +
        (hasKids ? "" : " pcapviewer-tree-leaf") +
        (depth === 0 ? " pcapviewer-tree-proto" : "");

      const twisty = document.createElement("div");
      twisty.className = "pcapviewer-tree-twisty";

      const label = document.createElement("div");
      label.className = "pcapviewer-tree-label";

      // No more [] here (since we hide those nodes anyway)
      label.textContent = String(n.label ?? n.text ?? n.name ?? t("pcap.tree.node"));

      row.appendChild(twisty);
      row.appendChild(label);
      li.appendChild(row);

      if (hasKids) {
        const childWrap = document.createElement("div");
        childWrap.className = "pcapviewer-tree-children";
        childWrap.appendChild(/** @type {HTMLElement} */ (childUl));
        li.appendChild(childWrap);

        const startOpen = layerIdx >= 0 && this.#openLayers.has(layerIdx);

        if (startOpen) {
          twisty.textContent = "▾";
        } else {
          li.classList.add("pcapviewer-collapsed");
          twisty.textContent = "▸";
        }

        const toggle = () => {
          const collapsedNow = li.classList.toggle("pcapviewer-collapsed");
          twisty.textContent = collapsedNow ? "▸" : "▾";
          if (layerIdx >= 0) {
            if (collapsedNow) this.#openLayers.delete(layerIdx);
            else this.#openLayers.add(layerIdx);
          }
        };

        twisty.addEventListener("click", (ev) => { ev.stopPropagation(); toggle(); });
        label.addEventListener("click", (ev) => { ev.stopPropagation(); toggle(); });
      } else {
        twisty.textContent = "•";
      }

      // hover/click highlight stays as you have it:
      row.addEventListener("pointerenter", () => this.#highlightHexRange(start, length, ds));
      row.addEventListener("pointerleave", () => this.#highlightHexRange(0, 0, ds));
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!(length > 0)) return;
        this.#highlightHexRange(start, length, ds);
        const s = this.#active();
        if (!s) return;
        s.selectedTreeEl?.classList.remove("pcapviewer-selected");
        row.classList.add("pcapviewer-selected");
        s.selectedTreeEl = row;
      });

      ul.appendChild(li);
    }

    return ul;
  }

  /** @param {any} details */
  #renderRaw(details) {
    if (!this.#rawPane) return;

    if (!details) {
      this.#rawPane.textContent = t("pcap.packet.select");
      return;
    }

    const ds0 = Array.isArray(details.data_sources) ? details.data_sources[0] : null;
    const b64 = ds0?.data;

    if (typeof b64 === "string" && b64.length) {
      const bytes = this.#b64ToBytes(b64);
      this.#activeFrameBytes = bytes;
      this.#renderHexHtml(bytes);     // NEW (instead of textContent)
      return;
    }


    this.#rawPane.textContent = JSON.stringify(details, null, 2);
  }

  // ======================================================================
  // Splitters (generic)
  // ======================================================================

  #makeHSplitConfig() {
    /** @type {SplitConfig} */
    return {
      containerSel: ".pcapviewer-layout",
      splitterSel: ".pcapviewer-splitter",
      primaryPaneSel: ".pcapviewer-pane--table",
      splitSizePx: 16,
      minA: 80,
      minB: 120,
      defaultRatio: 0.4,
      axis: "y",
      cursor: "row-resize",
      storageKey: "pcapviewer.splitRatio.v1",
      getRatio: () => this.#hSplitRatio,
      setRatio: (/** @type {number} */ v) => { this.#hSplitRatio = v; },
      getAbort: () => this.#hSplitAbort,
      setAbort: (/** @type {*} */ ac) => { this.#hSplitAbort = ac; },
    };
  }

  #makeVSplitConfig() {
    /** @type {SplitConfig} */
    return {
      containerSel: ".pcapviewer-bottom",
      splitterSel: ".pcapviewer-vsplitter",
      primaryPaneSel: ".pcapviewer-pane--tree",
      splitSizePx: 16,
      minA: 120,
      minB: 0,
      defaultRatio: 0.65,
      axis: "x",
      cursor: "col-resize",
      storageKey: "pcapviewer.vSplitRatio.v1",
      getRatio: () => this.#vSplitRatio,
      setRatio: (/** @type {number} */ v) => { this.#vSplitRatio = v; },
      getAbort: () => this.#vSplitAbort,
      setAbort: (/** @type {*} */ ac) => { this.#vSplitAbort = ac; },
    };
  }

  // ======================================================================
  // Embind / unwrap
  // ======================================================================

  /**
   * @param {any} value
   * @param {{maxDepth?: number, release?: boolean}} [opt]
   */
  #unwrapAll(value, opt = {}) {
    const { maxDepth = 50, release = false } = opt;
    /** @type {WeakMap<object, any>} */
    const seen = new WeakMap();

    /** @param {*} x */
    const isPrimitive = (x) => x == null || (typeof x !== "object" && typeof x !== "function");
    /** @param {*} x */
    const isVector = (x) => x && typeof x === "object" && typeof x.size === "function" && typeof x.get === "function";
    /** @param {*} x */
    const isIterable = (x) => x && typeof x[Symbol.iterator] === "function";

    /** @param {*} x */
    const tryRelease = (x) => {
      if (!release) return;
      try { if (x && typeof x.delete === "function") x.delete(); } catch { }
    };

    /** @param {*} x @param {number} depth */
    const unwrap = (x, depth) => {
      if (isPrimitive(x)) return x;
      if (depth > maxDepth) return "[[maxDepth]]";

      if ((typeof x === "object" || typeof x === "function") && seen.has(x)) return seen.get(x);

      if (isVector(x)) {
        const n = x.size();
        const out = new Array(n);
        seen.set(x, out);
        for (let i = 0; i < n; i++) out[i] = unwrap(x.get(i), depth + 1);
        tryRelease(x);
        return out;
      }

      if (x && typeof x === "object" && typeof x.entries === "function") {
        try {
          const ent = x.entries();
          if (isIterable(ent)) {
            const out = /** @type {Record<string, any>} */ ({});
            seen.set(x, out);
            for (const [k, v] of ent) out[String(unwrap(k, depth + 1))] = unwrap(v, depth + 1);
            tryRelease(ent);
            tryRelease(x);
            return out;
          }
        } catch { }
      }

      if (x && typeof x === "object" && typeof x.keys === "function" && typeof x.get === "function") {
        try {
          const ks = x.keys();
          const keysArr = unwrap(ks, depth + 1);
          if (Array.isArray(keysArr)) {
            const out = /** @type {Record<string, any>} */ ({});
            seen.set(x, out);
            for (const k of keysArr) {
              let v;
              try { v = x.get(k); } catch { v = x.get(String(k)); }
              out[String(k)] = unwrap(v, depth + 1);
            }
            tryRelease(ks);
            tryRelease(x);
            return out;
          }
        } catch { }
      }

      if (ArrayBuffer.isView(x) && !(x instanceof DataView)) return Array.from(/** @type {ArrayLike<any>} */ (/** @type {unknown} */ (x)));
      if (Array.isArray(x)) {
        const out = new Array(x.length);
        seen.set(x, out);
        for (let i = 0; i < x.length; i++) out[i] = unwrap(x[i], depth + 1);
        return out;
      }

      if (typeof x === "function") return undefined;

      const out = /** @type {Record<string, any>} */ ({});
      seen.set(x, out);

      for (const k of Object.keys(x)) {
        const v = x[k];
        if (typeof v === "function") continue;
        out[k] = unwrap(v, depth + 1);
      }

      for (const k of [
        "label", "text", "name", "filter", "start", "length",
        "tree", "children", "items", "subtree",
        "no", "num", "number", "time", "rel_time", "abs_time", "time_relative",
        "src", "source", "dst", "destination", "proto", "protocol", "protocols",
        "info", "summary", "columns", "bg", "fg", "marked", "ignored",
      ]) {
        if (k in out) continue;
        try {
          if (k in x) {
            const v = x[k];
            if (typeof v === "function") continue;
            out[k] = unwrap(v, depth + 1);
          }
        } catch { }
      }

      return out;
    };

    return unwrap(value, 0);
  }

  /** @param {any} v */
  #asArray(v) {
    const u = this.#unwrapAll(v);
    return Array.isArray(u) ? u : (u ? Object.values(u) : []);
  }

  // ======================================================================
  // Colors + small helpers
  // ======================================================================

  /** @param {number} n */
  #wiregasmColorToCss(n) {
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;

    if (n > 0xFFFFFF) {
      const a = (n >>> 24) & 0xFF;
      const r = (n >>> 16) & 0xFF;
      const g = (n >>> 8) & 0xFF;
      const b = n & 0xFF;
      const alpha = Math.max(0, Math.min(1, a / 255));
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    const r = (n >>> 16) & 0xFF;
    const g = (n >>> 8) & 0xFF;
    const b = n & 0xFF;
    return `rgb(${r}, ${g}, ${b})`;
  }

  /** @param {string} name */
  #displayName(name) {
    if (!this.#opt.simControl) return name;
    const id = parseInt(name);
    const obj = this.#opt.simControl.simobjects.find(e => e.id === id);
    if (!obj) return name;
    const port = name.split(":").slice(1).join(":").trim();
    return port ? `${obj.name}: ${port}` : obj.name;
  }

  /** @param {string} txt */
  #setStatus(txt) {
    if (this.#statusEl) this.#statusEl.textContent = txt;
  }

  /** @param {string} s */
  #escapeHtml(s) {
    return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  /** @param {string} b64 */
  #b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** @param {Uint8Array} bytes */
  #renderHexHtml(bytes) {
    if (!this.#rawPane) return;

    const COLS = 16;
    let html = "";

    for (let row = 0; row * COLS < bytes.length; row++) {
      const base = row * COLS;
      const offset = base.toString(16).toUpperCase().padStart(4, "0");

      let hexPart = "";
      let asciiPart = "";
      for (let col = 0; col < COLS; col++) {
        const i = base + col;
        if (col === 8) hexPart += `<span class="hex-gap"> </span>`;
        if (i < bytes.length) {
          const hex = bytes[i].toString(16).toUpperCase().padStart(2, "0");
          hexPart += `<span class="pcapviewer-hexbyte" data-i="${i}">${hex}</span> `;
          const c = bytes[i];
          asciiPart += (c >= 32 && c < 127) ? String.fromCharCode(c) : `<span class="hex-ascii-dot">·</span>`;
        } else {
          hexPart += `<span class="hex-pad">   </span>`;
          asciiPart += " ";
        }
      }

      html += `<div class="hex-row">` +
        `<span class="hex-offset">${offset}</span>` +
        `<span class="hex-bytes">${hexPart}</span>` +
        `<span class="hex-ascii">${asciiPart}</span>` +
        `</div>`;
    }

    this.#rawPane.innerHTML = html;
  }

  /** @param {number} start @param {number} length @param {number} ds */
  #highlightHexRange(start, length, ds) {
    if (!this.#rawPane) return;
    if (!this.#activeFrameBytes) return;       // only ds0 supported in this minimal version
    if (ds !== 0) return;

    // Clear old highlight
    for (const el of this.#rawPane.querySelectorAll(".pcapviewer-hexbyte--hl")) {
      el.classList.remove("pcapviewer-hexbyte--hl");
    }

    // If no range -> nothing to highlight
    if (!(length > 0)) return;

    const end = Math.min(this.#activeFrameBytes.length, start + length);
    for (let i = start; i < end; i++) {
      const el = this.#rawPane.querySelector(`.pcapviewer-hexbyte[data-i="${i}"]`);
      if (el) el.classList.add("pcapviewer-hexbyte--hl");
    }

  }

  /** @param {any} n */
  #isComputedTreeNode(n) {
    const start = Number(n?.start ?? 0);
    const length = Number(n?.length ?? 0);
    return start === 0 && length === 0;
  }

  // ======================================================================
  // Public API for sim toolbar
  // ======================================================================

  prevPage() {
    const s = this.#active(); if (!s) return;
    s.skip = Math.max(0, s.skip - this.#LIMIT);
    this.#loadAndRenderFramesForActive();
  }

  nextPage() {
    const s = this.#active(); if (!s) return;
    s.skip += this.#LIMIT;
    this.#loadAndRenderFramesForActive();
  }

  canPrevPage() {
    const s = this.#active();
    return !!s?.sess && (s.skip ?? 0) > 0;
  }

  canNextPage() {
    const s = this.#active();
    if (!s?.sess) return false;
    const { frames, matched } = this.#getFramesPlainForActive();
    return s.skip + frames.length < matched;
  }

  canFollowTcpStream() {
    const s = this.#active();
    return !!s?.pcapBytes && typeof s.selectedNo === "number";
  }

  #notifySimControl() {
    this.#opt.simControl?._invalidateUI?.();
  }

  // ======================================================================
  // Follow TCP Stream
  // ======================================================================

  #updateFollowBtn() { /* state managed via sim toolbar */ }

  followTcpStream() {
    const s = this.#active();
    if (!s?.pcapBytes || typeof s.selectedNo !== "number") return;

    const frames = this.#parsePcapFrames(s.pcapBytes);
    const sel = frames[s.selectedNo - 1]; // Wireshark is 1-based

    if (!sel?.tcp) {
      this.#openStreamDialog({ title: t("pcap.stream.notcp"), chunks: [], totalA: 0, totalB: 0 });
      return;
    }

    const { srcIp, srcPort, dstIp, dstPort } = sel.tcp;
    const fmtAddr = (/** @type {string} */ ip) => ip.includes(":") ? `[${ip}]` : ip;
    const labelA = `${fmtAddr(srcIp)}:${srcPort}`;
    const labelB = `${fmtAddr(dstIp)}:${dstPort}`;

    /** @type {Array<{ts:number, dir:"a"|"b", seq:number, payload:Uint8Array}>} */
    const segs = [];
    for (const f of frames) {
      if (!f.tcp || f.tcp.payload.length === 0) continue;
      const tc = f.tcp;
      if (tc.srcIp === srcIp && tc.srcPort === srcPort && tc.dstIp === dstIp && tc.dstPort === dstPort) {
        segs.push({ ts: f.ts, dir: "a", seq: tc.seq, payload: tc.payload });
      } else if (tc.srcIp === dstIp && tc.srcPort === dstPort && tc.dstIp === srcIp && tc.dstPort === srcPort) {
        segs.push({ ts: f.ts, dir: "b", seq: tc.seq, payload: tc.payload });
      }
    }

    segs.sort((x, y) => x.ts !== y.ts ? (x.ts < y.ts ? -1 : 1) : ((x.seq - y.seq) | 0));

    // Group consecutive same-direction segments into chunks
    /** @type {Array<{dir:"a"|"b", bytes:Uint8Array}>} */
    const chunks = [];
    /** @type {{dir:"a"|"b", segs:typeof segs}|null} */
    let cur = null;
    for (const seg of segs) {
      if (!cur || cur.dir !== seg.dir) {
        if (cur) chunks.push({ dir: cur.dir, bytes: this.#reassembleTcp(cur.segs) });
        cur = { dir: seg.dir, segs: [seg] };
      } else {
        cur.segs.push(seg);
      }
    }
    if (cur) chunks.push({ dir: cur.dir, bytes: this.#reassembleTcp(cur.segs) });

    const totalA = chunks.filter(c => c.dir === "a").reduce((s2, c) => s2 + c.bytes.length, 0);
    const totalB = chunks.filter(c => c.dir === "b").reduce((s2, c) => s2 + c.bytes.length, 0);

    this.#openStreamDialog({ title: `${labelA} ↔ ${labelB}`, labelA, labelB, chunks, totalA, totalB });
  }

  /**
   * Parse all frames from a PCAP byte array.
   * @param {Uint8Array} bytes
   * @returns {Array<{ts:number, tcp:{srcIp:string,srcPort:number,dstIp:string,dstPort:number,seq:number,payload:Uint8Array}|null}>}
   */
  #parsePcapFrames(bytes) {
    if (bytes.length < 24) return [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = view.getUint32(0, true);
    const le = magic === 0xA1B2C3D4 || magic === 0xA1B23C4D;

    const frames = [];
    let off = 24;
    while (off + 16 <= bytes.length) {
      const tsSec  = view.getUint32(off,     le);
      const tsUsec = view.getUint32(off + 4, le);
      const capLen = view.getUint32(off + 8, le);
      off += 16;
      if (off + capLen > bytes.length) break;
      // Slice to the exact frame so payload subarray is naturally bounded.
      const frame = bytes.subarray(off, off + capLen);
      frames.push({ ts: tsSec * 1_000_000 + tsUsec, tcp: this.#parseTcpFromEthernet(frame, 0) });
      off += capLen;
    }
    return frames;
  }

  /**
   * @param {Uint8Array} b
   * @param {number} frameOff  start of Ethernet frame within b
   * @returns {{srcIp:string,srcPort:number,dstIp:string,dstPort:number,seq:number,payload:Uint8Array}|null}
   */
  #parseTcpFromEthernet(b, frameOff) {
    let off = frameOff + 12; // skip dst+src MAC
    while (off + 2 <= b.length) {
      const et = (b[off] << 8) | b[off + 1];
      off += 2;
      if (et === 0x8100 || et === 0x88A8) { off += 2; continue; } // VLAN tag
      if (et === 0x0800) return this.#parseTcpFromIPv4(b, off);
      if (et === 0x86DD) return this.#parseTcpFromIPv6(b, off);
      return null;
    }
    return null;
  }

  /** @param {Uint8Array} b @param {number} off */
  #parseTcpFromIPv4(b, off) {
    if (b.length < off + 20) return null;
    const ihl = (b[off] & 0x0f) * 4;
    if (b[off + 9] !== 6) return null;
    const srcIp = `${b[off+12]}.${b[off+13]}.${b[off+14]}.${b[off+15]}`;
    const dstIp = `${b[off+16]}.${b[off+17]}.${b[off+18]}.${b[off+19]}`;
    return this.#parseTcpSegment(b, off + ihl, srcIp, dstIp);
  }

  /** @param {Uint8Array} b @param {number} ipOff */
  #parseTcpFromIPv6(b, ipOff) {
    if (b.length < ipOff + 40) return null;
    let nh = b[ipOff + 6];
    let hoff = ipOff + 40;
    // Walk extension headers
    while (nh !== 6) {
      if (nh === 59 || hoff + 2 > b.length) return null;
      if (nh === 0 || nh === 43 || nh === 60) { nh = b[hoff]; hoff += (b[hoff + 1] + 1) * 8; }
      else if (nh === 44)                      { nh = b[hoff]; hoff += 8; }
      else return null;
      if (hoff > b.length) return null;
    }
    const g = (/** @type {number} */ base, /** @type {number} */ i) =>
      ((b[base + i * 2] << 8) | b[base + i * 2 + 1]).toString(16);
    const srcIp = [0,1,2,3,4,5,6,7].map(i => g(ipOff + 8,  i)).join(":");
    const dstIp = [0,1,2,3,4,5,6,7].map(i => g(ipOff + 24, i)).join(":");
    return this.#parseTcpSegment(b, hoff, srcIp, dstIp);
  }

  /** @param {Uint8Array} b @param {number} off @param {string} srcIp @param {string} dstIp */
  #parseTcpSegment(b, off, srcIp, dstIp) {
    if (b.length < off + 20) return null;
    const srcPort = (b[off] << 8) | b[off + 1];
    const dstPort = (b[off + 2] << 8) | b[off + 3];
    const seq     = ((b[off+4] << 24) | (b[off+5] << 16) | (b[off+6] << 8) | b[off+7]) >>> 0;
    const dataOff = ((b[off + 12] >> 4) & 0x0f) * 4;
    if (b.length < off + dataOff) return null;
    return { srcIp, srcPort, dstIp, dstPort, seq, payload: b.subarray(off + dataOff) };
  }

  /**
   * Sort segments by seq and concatenate, handling retransmits and gaps.
   * @param {Array<{seq:number, payload:Uint8Array}>} segs
   */
  #reassembleTcp(segs) {
    if (segs.length === 0) return new Uint8Array(0);
    segs.sort((a, b) => (a.seq - b.seq) | 0);

    const parts = [];
    let next = segs[0].seq;

    for (const { seq, payload } of segs) {
      const end = (seq + payload.length) >>> 0;
      if (((seq - next) | 0) > 0) {
        // Gap — include anyway (missing or filtered packets)
        parts.push(payload); next = end;
      } else if (((end - next) | 0) > 0) {
        // Partial overlap — trim already-delivered prefix
        const skip = (next - seq) >>> 0;
        if (skip < payload.length) { parts.push(payload.subarray(skip)); next = end; }
        // else fully within already-delivered range → skip retransmit
      }
    }

    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  /**
   * @param {{
   *   title: string,
   *   labelA?: string,
   *   labelB?: string,
   *   chunks: Array<{dir:"a"|"b", bytes:Uint8Array}>,
   *   totalA: number,
   *   totalB: number,
   * }} opts
   */
  #openStreamDialog(opts) {
    // Replace any existing dialog
    this.#root?.querySelector(".pcapviewer-stream-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "pcapviewer-stream-overlay";

    const panel = document.createElement("div");
    panel.className = "pcapviewer-stream-panel";

    // Header
    const hdr = document.createElement("div");
    hdr.className = "pcapviewer-stream-hdr";
    hdr.innerHTML = `
      <span class="pcapviewer-stream-hdr-title">${this.#escapeHtml(t("pcap.stream.title"))}</span>
      <span class="pcapviewer-stream-hdr-sub">${this.#escapeHtml(opts.title)}</span>
      <button class="pcapviewer-stream-close" type="button"
              aria-label="${this.#escapeHtml(t("pcap.stream.close"))}">×</button>
    `;
    panel.appendChild(hdr);

    if (!opts.labelA) {
      // Not a TCP frame
      const msg = document.createElement("div");
      msg.className = "pcapviewer-stream-msg";
      msg.textContent = opts.title;
      panel.appendChild(msg);
    } else {
      // Legend
      const legend = document.createElement("div");
      legend.className = "pcapviewer-stream-legend";
      legend.innerHTML = `
        <span class="pcapviewer-stream-dot pcapviewer-stream-dot--a"></span>
        <span>${this.#escapeHtml(opts.labelA)}</span>
        <span class="pcapviewer-stream-dot pcapviewer-stream-dot--b" style="margin-left:1.2em"></span>
        <span>${this.#escapeHtml(opts.labelB ?? "")}</span>
        <span class="pcapviewer-stream-totals">${opts.totalA} / ${opts.totalB} ${t("pcap.stream.bytes")}</span>
      `;
      panel.appendChild(legend);

      // Content
      const content = document.createElement("pre");
      content.className = "pcapviewer-stream-content";
      if (opts.chunks.length === 0) {
        content.textContent = t("pcap.stream.empty");
      } else {
        for (const chunk of opts.chunks) {
          const span = document.createElement("span");
          span.className = chunk.dir === "a" ? "pcapviewer-stream-a" : "pcapviewer-stream-b";
          span.textContent = this.#tcpBytesToAscii(chunk.bytes);
          content.appendChild(span);
        }
      }
      panel.appendChild(content);
    }

    overlay.appendChild(panel);
    this.#root?.appendChild(overlay);

    makeDraggable(panel, {
      handle: hdr,
      boundary: overlay,
      cancelSelector: "button",
    });

    const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
    hdr.querySelector(".pcapviewer-stream-close")?.addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
  }

  /** @param {Uint8Array} bytes */
  #tcpBytesToAscii(bytes) {
    let s = "";
    for (const b of bytes) {
      if      (b === 10) s += "\n";
      else if (b === 13) s += "\r";
      else if (b === 9)  s += "\t";
      else if (b >= 32 && b < 127) s += String.fromCharCode(b);
      else s += "·";
    }
    return s;
  }
}
