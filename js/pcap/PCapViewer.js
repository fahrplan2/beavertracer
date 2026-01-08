// @ts-check
import loadWiregasm from "@goodtools/wiregasm/dist/wiregasm";

/**
 * @typedef {any} WiregasmModule
 * @typedef {any} DissectSession
 */

/**
 * @typedef {{
 *   limit?: number;
 *   locateWasm?: string;
 *   locateData?: string;
 *   initialFilter?: string;
 *   autoSelectFirst?: boolean;
 *   onSessionClosed?: (name: string) => void;
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
 *   needsRender: boolean;
 *   pendingAutoSelect: boolean;
 *   pcapPath:string
 * }} SessionState 
 */

export class PCapViewer {
  /** @type {HTMLElement|null} */ #mount;
  /** @type {PCAPViewerOptions} */ #opt;

  /** @type {WiregasmModule|null} */ #wg = null;

  /** @type {Map<string, SessionState>} */ #sessions = new Map();
  /** @type {string|null} */ #activeName = null;

  /** @type {number} */ #LIMIT;

  // DOM refs
  /** @type {HTMLElement|null} */ #root = null;
  /** @type {HTMLTableSectionElement|null} */ #tableBody = null;
  /** @type {HTMLInputElement|null} */ #filterEl = null;
  /** @type {HTMLElement|null} */ #statusEl = null;
  /** @type {HTMLElement|null} */ #treePane = null;
  /** @type {HTMLPreElement|null} */ #rawPane = null;

  /** @type {HTMLElement|null} */ #tabsEl = null;

  /** @type {number} */ #filterTimer = 0;

  /** @type {Promise<WiregasmModule>|null} */ #wgPromise = null;
  /** @type {boolean} */ #wgInited = false;

  /**
   * @param {HTMLElement} mountElement
   * @param {PCAPViewerOptions} [options]
   */
  constructor(mountElement, options = {}) {
    this.#mount = mountElement ?? null;
    this.#opt = options;
    this.#LIMIT = options.limit ?? 200;
  }

  // -------------------- Public API --------------------

  /**
 * Change where the viewer renders into.
 * Does NOT automatically render.
 * @param {HTMLElement|null} el
 */
  setMount(el) {
    this.#mount = el;
  }

  /**
   * Ensure the viewer is rendered into the current mount element.
   * Safe to call multiple times; it will re-render the shell if needed.
   */
  render() {
    if (!this.#mount) return;

    // If we previously rendered somewhere else, remove old root
    if (this.#root && this.#root.parentElement && this.#root.parentElement !== this.#mount) {
      this.#root.parentElement.removeChild(this.#root);
      this.#root = null;
    }

    // If not rendered yet, or mount changed/cleared, render again
    if (!this.#root || this.#root.parentElement !== this.#mount) {
      this.#renderShell();
      this.#wireUI();
    }

    // Repaint active session data into the (new) DOM
    this.#renderTabs();
    this.#renderActiveSession();
  }

  /**
   * Create a new session (tab). If name exists, does nothing.
   * Does NOT automatically load a capture.
   * By default, the first created session becomes active.
   * @param {string} name
   */
  newSession(name) {
    this.render();
    name = String(name ?? "").trim();
    if (!name) throw new Error("newSession(name): name must be non-empty");
    if (this.#sessions.has(name)) return;

    const safeName = name.replaceAll(/[^a-zA-Z0-9._-]/g, "_");

    const s = /** @type {SessionState} */ ({
      name,
      sess: null,
      skip: 0,
      filter: (this.#opt.initialFilter ?? "").trim(),
      selectedNo: null,
      selectedTreeEl: null,
      hasCapture: false,
      needsRender: false,
      pendingAutoSelect: this.#opt.autoSelectFirst ?? true,
      pcapPath: `/uploads/${safeName}.pcap`,
    });

    this.#sessions.set(name, s);

    // If it's the first session, make it active
    if (!this.#activeName) this.#activeName = name;

    this.#renderTabs();
    this.#renderActiveSession();
  }

  /**
   * Switch the active tab/session.
   * @param {string} name
   */
  switchTab(name) {
    if (!this.#sessions.has(name)) throw new Error(`switchTab: session '${name}' not found`);
    this.#activeName = name;

    this.render(); // if you added the mount/dynamic render logic

    const s = this.#active();
    if (s?.sess && s.needsRender) {
      s.needsRender = false;

      this.#loadAndRenderFramesForActive();

      if (s.pendingAutoSelect) {
        const first = this.#getFirstVisibleFrameNo();
        if (typeof first === "number") {
          s.selectedNo = first;
          this.#loadAndRenderFrameDetailsForActive(first);
          this.#highlightSelectedRow(first);
        }
      }
    }

    this.#renderTabs();
  }


  /**
   * Close a session (tab) and delete underlying dissect session if present.
   * If closing active tab, activates a neighbor (arbitrary first remaining).
   * @param {string} name
   */
  closeSession(name) {
    const s = this.#sessions.get(name);
    if (!s) return;

    try {
      if (s.sess) s.sess.delete();
    } catch { }
    s.sess = null;

    this.#sessions.delete(name);

    try { this.#wg?.FS.unlink(s.pcapPath); } catch { }

    if (this.#activeName === name) {
      const next = this.#sessions.keys().next();
      this.#activeName = next.done ? null : next.value;
    }

    this.#renderTabs();
    this.#renderActiveSession();

    try {
      this.#opt.onSessionClosed?.(name);
    } catch (e) {
      // don’t break viewer if user callback throws
      console.error("onSessionClosed threw", e);
    }
  }

  /**
   * Load PCAP bytes into a named session. Does NOT switch the active tab.
   * If that session is active, it re-renders immediately.
   * @param {string} name
   * @param {Uint8Array} pcapBytes
   * @param {LoadBytesOptions} [opts]
   */

  async loadBytes(name, pcapBytes, opts = {}) {
    this.render();
    const s = this.#sessions.get(name);
    if (!s) throw new Error(`loadBytes: session '${name}' not found`);

    const filter = (opts.filter ?? s.filter ?? "").trim();
    s.filter = filter;

    // only reflect filter input if this session is currently active
    if (this.#activeName === name && this.#filterEl) this.#filterEl.value = filter;

    this.#setStatus("Loading Wiregasm…");
    await this.#initWiregasm();

    this.#setStatus("Loading PCAP…");
    this.#loadPcapBytesIntoSession(s, pcapBytes);

    s.skip = 0;
    s.selectedNo = null;
    s.selectedTreeEl = null;
    s.hasCapture = true;

    // Render if this is the active session; otherwise just update status/tabs.
    if (this.#activeName === name) {
      this.#setStatus("Rendering…");
      this.#loadAndRenderFramesForActive();

      const autoSel = opts.autoSelectFirst ?? this.#opt.autoSelectFirst ?? true;

      s.skip = 0;
      s.selectedNo = null;
      s.selectedTreeEl = null;
      s.hasCapture = true;

      // If not active: delay render
      if (this.#activeName !== name) {
        s.needsRender = true;
        this.#renderTabs();       // optional: update tab indicator
        this.#setStatus("Ready"); // or "Loaded (inactive)"
        return;
      }

      // Active: render now
      s.needsRender = false;
      this.#setStatus("Rendering…");
      this.#loadAndRenderFramesForActive();


      if (autoSel) {
        const first = this.#getFirstVisibleFrameNo();
        if (typeof first === "number") {
          s.selectedNo = first;
          this.#loadAndRenderFrameDetailsForActive(first);
          this.#highlightSelectedRow(first);
        }
      }
    }

    this.#renderTabs();
    this.#setStatus("Ready");
  }

  /**
   * Clean up DOM and all sessions.
   */
  destroy() {
    if (this.#filterTimer) window.clearTimeout(this.#filterTimer);

    for (const s of this.#sessions.values()) {
      try {
        if (s.sess) s.sess.delete();
      } catch { }
      s.sess = null;
    }
    this.#sessions.clear();
    this.#activeName = null;

    if (this.#root?.parentElement) this.#root.parentElement.removeChild(this.#root);
    this.#root = null;
  }

  // -------------------- Internal: active session --------------------

  /** @returns {SessionState|null} */
  #active() {
    if (!this.#activeName) return null;
    return this.#sessions.get(this.#activeName) ?? null;
  }

  // -------------------- Rendering shell --------------------

  #renderShell() {
    if (!this.#mount) return;
    const root = document.createElement("div");
    root.className = "pcapviewer-root";
    root.innerHTML = `
      <div class="pcapviewer-tabs"></div>

      <div class="pcapviewer-toolbar">
        <input class="pcapviewer-filter" placeholder="Display filter (z.B. ip.addr==1.2.3.4)" />
        <button class="pcapviewer-prev" type="button" title="Previous page">◀</button>
        <button class="pcapviewer-next" type="button" title="Next page">▶</button>
        <span class="pcapviewer-status"></span>
      </div>

      <div class="pcapviewer-layout">
        <div class="pcapviewer-pane pcapviewer-pane--table">
          <table class="pcapviewer-table">
            <thead>
              <tr>
                <th>No.</th><th>Time</th><th>Source</th><th>Destination</th><th>Protocol</th><th>Info</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        <div class="pcapviewer-bottom">
          <div class="pcapviewer-pane pcapviewer-pane--tree">
            <div class="pcapviewer-treepane"></div>
          </div>
          <div class="pcapviewer-pane pcapviewer-pane--raw">
            <pre class="pcapviewer-rawpane">Select a packet…</pre>
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
    this.#treePane = /** @type {HTMLElement} */ (root.querySelector(".pcapviewer-treepane"));
    this.#rawPane = /** @type {HTMLPreElement} */ (root.querySelector(".pcapviewer-rawpane"));

    this.#renderTabs();
    this.#renderActiveSession();
  }

  #wireUI() {
    if (!this.#root) return;

    const prevBtn = /** @type {HTMLButtonElement} */ (this.#root.querySelector(".pcapviewer-prev"));
    const nextBtn = /** @type {HTMLButtonElement} */ (this.#root.querySelector(".pcapviewer-next"));

    prevBtn.addEventListener("click", () => {
      const s = this.#active();
      if (!s) return;
      s.skip = Math.max(0, s.skip - this.#LIMIT);
      this.#loadAndRenderFramesForActive();
    });

    nextBtn.addEventListener("click", () => {
      const s = this.#active();
      if (!s) return;
      s.skip += this.#LIMIT;
      this.#loadAndRenderFramesForActive();
    });

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
  }

  // -------------------- Tabs --------------------

  #renderTabs() {
    if (!this.#tabsEl) return;

    const names = Array.from(this.#sessions.keys());
    this.#tabsEl.innerHTML = "";

    if (names.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pcapviewer-tabs-empty";
      empty.textContent = "No sessions. Call newSession(name).";
      this.#tabsEl.appendChild(empty);
      return;
    }

    for (const name of names) {
      const s = this.#sessions.get(name);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pcapviewer-tab" + (name === this.#activeName ? " pcapviewer-tab--active" : "");
      btn.textContent = name + (s?.hasCapture ? "" : " •");
      btn.title = s?.hasCapture ? name : `${name} (no capture loaded)`;

      btn.addEventListener("click", () => this.switchTab(name));

      // optional close "x" inside
      const x = document.createElement("span");
      x.className = "pcapviewer-tab-close";
      x.textContent = "×";
      x.title = "Close session";
      x.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.closeSession(name);
      });

      btn.appendChild(x);
      this.#tabsEl.appendChild(btn);
    }
  }

  #renderActiveSession() {
    const s = this.#active();

    // update filter input to active session filter
    if (this.#filterEl) this.#filterEl.value = s?.filter ?? "";

    // render either empty state or frames
    if (!s || !s.sess) {
      this.#renderTable([], 0);
      if (this.#treePane) this.#treePane.textContent = s ? "No capture loaded in this session." : "No active session.";
      if (this.#rawPane) this.#rawPane.textContent = "Select a packet…";
      this.#setStatus(s ? `Active: ${s.name} (no capture loaded)` : "No active session");
      return;
    }

    this.#loadAndRenderFramesForActive();
    if (typeof s.selectedNo === "number") {
      this.#loadAndRenderFrameDetailsForActive(s.selectedNo);
      this.#highlightSelectedRow(s.selectedNo);
    } else {
      if (this.#treePane) this.#treePane.textContent = "Select a packet…";
      if (this.#rawPane) this.#rawPane.textContent = "Select a packet…";
    }
  }

  // -------------------- Status helpers --------------------

  /** @param {string} txt */
  #setStatus(txt) {
    if (this.#statusEl) this.#statusEl.textContent = txt;
  }

  // -------------------- Wiregasm init/session --------------------

  async #initWiregasm() {
    if (this.#wg && this.#wgInited) return;

    if (!this.#wgPromise) {
      const locateWasm = this.#opt.locateWasm ?? "/wiregasm/wiregasm.wasm";
      const locateData = this.#opt.locateData ?? "/wiregasm/wiregasm.data";

      this.#wgPromise = loadWiregasm({
        locateFile: (path, prefix) => {
          if (path.endsWith(".wasm")) return locateWasm;
          if (path.endsWith(".data")) return locateData;
          return prefix + path;
        },
      });
    }

    this.#wg = await this.#wgPromise;

    if (!this.#wgInited) {
      this.#wg.init();
      this.#wgInited = true;
    }
  }


  /** @param {SessionState} s @param {Uint8Array} pcapBytes */
  #loadPcapBytesIntoSession(s, pcapBytes) {
    if (!this.#wg) throw new Error("Wiregasm not initialized");

    this.#wg.FS.mkdirTree("/uploads");
    this.#wg.FS.writeFile(s.pcapPath, pcapBytes);

    if (s.sess) {
      try {
        s.sess.delete();
      } catch { }
      s.sess = null;
    }

    s.sess = new this.#wg.DissectSession(s.pcapPath);

    const ret = s.sess.load();
    if (ret?.code !== 0) throw new Error("sess.load() failed: " + JSON.stringify(ret));
  }

  // -------------------- Embind / unwrap --------------------

  /**
   * @param {any} value
   * @param {{maxDepth?: number, release?: boolean}} [opt]
   */
  #unwrapAll(value, opt = {}) {
    const { maxDepth = 50, release = false } = opt;
    /** @type {WeakMap<object, any>} */
    const seen = new WeakMap();

    const isPrimitive = (x) => x == null || (typeof x !== "object" && typeof x !== "function");
    const isVector = (x) => x && typeof x === "object" && typeof x.size === "function" && typeof x.get === "function";
    const isIterable = (x) => x && typeof x[Symbol.iterator] === "function";

    const tryRelease = (x) => {
      if (!release) return;
      try {
        if (x && typeof x.delete === "function") x.delete();
      } catch { }
    };

    /** @param {any} x @param {number} depth */
    const unwrap = (x, depth) => {
      if (isPrimitive(x)) return x;
      if (depth > maxDepth) return "[[maxDepth]]";

      if (typeof x === "object" || typeof x === "function") {
        if (seen.has(x)) return seen.get(x);
      }

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
            const out = {};
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
            const out = {};
            seen.set(x, out);
            for (const k of keysArr) {
              let v;
              try {
                v = x.get(k);
              } catch {
                v = x.get(String(k));
              }
              out[String(k)] = unwrap(v, depth + 1);
            }
            tryRelease(ks);
            tryRelease(x);
            return out;
          }
        } catch { }
      }

      //@ts-ignore
      if (ArrayBuffer.isView(x) && !(x instanceof DataView)) return Array.from(x);

      if (Array.isArray(x)) {
        const out = new Array(x.length);
        seen.set(x, out);
        for (let i = 0; i < x.length; i++) out[i] = unwrap(x[i], depth + 1);
        return out;
      }

      if (typeof x === "function") return undefined;

      const out = {};
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
        "info", "summary", "columns", "bg", "fg", "marked", "ignored"
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

  // -------------------- Colors --------------------

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

  // -------------------- Frames & table --------------------

  #getFramesPlainForActive() {
    const s = this.#active();
    if (!s?.sess) return { frames: [], matched: 0 };

    const r = s.sess.getFrames(s.filter, s.skip, this.#LIMIT);
    const plain = this.#unwrapAll(r);

    const frames = Array.isArray(plain?.frames) ? plain.frames : this.#asArray(plain?.frames);
    return { frames, matched: plain?.matched ?? frames.length };
  }

  /** @param {any} rawRow */
  #rowView(rawRow) {
    const cols = Array.isArray(rawRow?.columns) ? rawRow.columns : (Array.isArray(rawRow?._raw?.columns) ? rawRow._raw.columns : null);

    if (cols && cols.length >= 6) {
      return {
        no: Number(cols[0]) || (rawRow.no ?? rawRow.num ?? rawRow.number),
        time: cols[1] ?? "",
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

  #loadAndRenderFramesForActive() {
    const s = this.#active();
    const { frames, matched } = this.#getFramesPlainForActive();
    this.#renderTable(frames, matched);

    if (!s) return;
    this.#setStatus(`Active: ${s.name} • shown: ${frames.length} (skip ${s.skip}) / matched ${matched}`);
  }

  /** @param {any[]} frames @param {number} matched */
  #renderTable(frames, matched) {
    if (!this.#tableBody) return;

    this.#tableBody.innerHTML = "";

    const s = this.#active();

    for (const r0 of frames) {
      const r = this.#rowView(r0);
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

  // -------------------- Frame details: tree + raw --------------------

  /** @param {number} no */
  #getFramePlainForActive(no) {
    const s = this.#active();
    if (!s?.sess) return null;
    const d = s.sess.getFrame(no);
    return this.#unwrapAll(d);
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
      this.#treePane.textContent = "Select a packet…";
      return;
    }

    const title = document.createElement("div");
    title.className = "pcapviewer-tree-title";
    title.textContent = `Packet Details (Frame ${details.number ?? "?"})`;
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
    wrapper.appendChild(this.#buildTree(treeRoot, 0));
    this.#treePane.appendChild(wrapper);
  }

  /**
   * All nodes collapsed initially.
   * @param {any[]|any} nodeOrArray
   * @param {number} depth
   */
  #buildTree(nodeOrArray, depth = 0) {
    const ul = document.createElement("ul");
    const nodes = Array.isArray(nodeOrArray) ? nodeOrArray : [nodeOrArray];

    for (const n of nodes) {
      if (!n) continue;

      const li = document.createElement("li");

      const kidsRaw = n.tree ?? n.children ?? n.items ?? n.subtree ?? null;
      const kids = Array.isArray(kidsRaw) ? kidsRaw : (kidsRaw ? [kidsRaw] : []);
      const hasKids = kids.length > 0;

      const row = document.createElement("div");
      row.className = "pcapviewer-tree-node" + (hasKids ? "" : " pcapviewer-tree-leaf");

      const twisty = document.createElement("div");
      twisty.className = "pcapviewer-tree-twisty";

      const label = document.createElement("div");
      label.className = "pcapviewer-tree-label";
      label.textContent = String(n.label ?? n.text ?? n.name ?? "(node)");

      row.appendChild(twisty);
      row.appendChild(label);
      li.appendChild(row);

      if (hasKids) {
        const childWrap = document.createElement("div");
        childWrap.className = "pcapviewer-tree-children";
        childWrap.appendChild(this.#buildTree(kids, depth + 1));
        li.appendChild(childWrap);

        li.classList.add("pcapviewer-collapsed");
        twisty.textContent = "▸";

        const toggle = () => {
          const collapsedNow = li.classList.toggle("pcapviewer-collapsed");
          twisty.textContent = collapsedNow ? "▸" : "▾";
        };

        twisty.addEventListener("click", (ev) => {
          ev.stopPropagation();
          toggle();
        });
        label.addEventListener("click", (ev) => {
          ev.stopPropagation();
          toggle();
        });
      } else {
        twisty.textContent = "•";
      }

      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const s = this.#active();
        if (!s) return;
        if (s.selectedTreeEl) s.selectedTreeEl.classList.remove("pcapviewer-selected");
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
      this.#rawPane.textContent = "Select a packet…";
      return;
    }

    const ds0 = Array.isArray(details.data_sources) ? details.data_sources[0] : null;
    const b64 = ds0?.data;

    if (typeof b64 === "string" && b64.length) {
      const bytes = this.#b64ToBytes(b64);
      this.#rawPane.textContent = this.#toHex(bytes);
      return;
    }

    this.#rawPane.textContent = JSON.stringify(details, null, 2);
  }

  // -------------------- Small helpers --------------------

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
  #toHex(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      out += Array.from(chunk)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ")
        .toUpperCase();
      out += "\n";
    }
    return out;
  }
}
