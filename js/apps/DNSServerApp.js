//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "./lib/Disposer.js";
import { t } from "../i18n/index.js";
import { DNSPacket } from "./../pdu/DNSPacket.js";

// helpers
function nowStamp(n = Date.now()) {
  const d = new Date(n);
  return d.toLocaleTimeString();
}
function ipToString(ip) {
  return `${(ip >>> 24) & 255}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}`;
}
function normalizeName(name) {
  name = String(name ?? "").trim().toLowerCase();
  if (name.endsWith(".")) name = name.slice(0, -1);
  return name;
}
function parseIPv4(s) {
  const parts = String(s).trim().split(".");
  if (parts.length !== 4) return null;
  const b = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    b[i] = n;
  }
  return b;
}

/**
 * @typedef {{ key: string, label: string, type?: "text"|"number", placeholder?: string, widthPx?: number }} ColDef
 */

/**
 * Create an editable table editor with add/delete rows.
 *
 * Works with your UILib (opts.children, opts.attrs, opts.init).
 *
 * @param {ColDef[]} cols
 * @param {() => void} onChange
 * @param {() => any} makeDefaultRow
 */
function createTableEditor(cols, onChange, makeDefaultRow) {
  /** @type {HTMLTableElement} */
  const table = UI.el("table", { className: "tbl" });
  const thead = UI.el("thead", {});
  const tbody = UI.el("tbody", {});

  // header row
  const headRow = UI.el("tr", {});
  for (const c of cols) {
    headRow.appendChild(
      UI.el("th", {
        text: c.label,
        attrs: c.widthPx ? { style: `width:${c.widthPx}px` } : undefined,
      })
    );
  }
  headRow.appendChild(UI.el("th", { text: "" }));
  thead.appendChild(headRow);

  table.appendChild(thead);
  table.appendChild(tbody);

  /** @param {any} rowObj */
  function addRow(rowObj) {
    const tr = UI.el("tr", {});
    for (const c of cols) {
      const td = UI.el("td", {});
      const inp = UI.el("input", {
        className: "input",
        attrs: {
          type: c.type ?? "text",
          placeholder: c.placeholder ?? "",
        },
        init: (el) => {
          /** @type {HTMLInputElement} */ (el).value = rowObj?.[c.key] != null ? String(rowObj[c.key]) : "";
          el.addEventListener("input", () => onChange());
        },
      });
      td.appendChild(inp);
      tr.appendChild(td);
    }

    const tdAct = UI.el("td", {});
    const del = UI.button("×", () => {
      tr.remove();
      onChange();
    });
    tdAct.appendChild(del);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  }

  const addBtn = UI.button("+", () => {
    addRow(makeDefaultRow());
    onChange();
  });

  const controls = UI.buttonRow([addBtn]);

  const root = UI.el("div", {
    className: "tblwrap",
    children: [controls, table],
  });

  /** @returns {any[]} */
  function getRows() {
    /** @type {any[]} */
    const out = [];
    const rows = Array.from(tbody.querySelectorAll("tr"));

    for (const tr of rows) {
      /** @type {any} */
      const obj = {};
      const inputs = Array.from(tr.querySelectorAll("td input"));

      cols.forEach((c, i) => {
        const v = /** @type {HTMLInputElement} */ (inputs[i])?.value ?? "";
        obj[c.key] = (c.type === "number") ? Number(v) : v;
      });

      out.push(obj);
    }
    return out;
  }

  /** @param {any[]} rows */
  function setRows(rows) {
    tbody.replaceChildren();
    for (const r of (rows ?? [])) addRow(r);
  }

  return { root, getRows, setRows };
}

/**
 * Simple tabs (A/MX/NS).
 * @param {{id:string, title:string, contentEl:HTMLElement}[]} tabs
 */
function createTabs(tabs) {
  const bar = UI.el("div", { className: "tabbar" });
  const content = UI.el("div", { className: "tabcontent" });

  /** @type {Record<string, HTMLButtonElement>} */
  const buttons = {};
  let active = tabs[0]?.id ?? "";

  function setActive(id) {
    active = id;
    for (const t of tabs) {
      t.contentEl.style.display = (t.id === active) ? "" : "none";
      const b = buttons[t.id];
      if (b) {
        if (t.id === active) b.classList.add("active");
        else b.classList.remove("active");
      }
    }
  }

  for (const t of tabs) {
    const b = UI.button(t.title, () => setActive(t.id));
    buttons[t.id] = b;
    bar.appendChild(b);
    content.appendChild(t.contentEl);
  }

  setActive(active);

  const root = UI.el("div", { children: [bar, content] });
  return { root, setActive };
}

export class DNSServerApp extends GenericProcess {
  get title() {
    return t("app.dnsd.title");
  }

  disposer = new Disposer();

  port = 53;
  socketPort = null;
  running = false;

  configPath = "/etc/dnsd.conf";

  /** @type {{a:any[], mx:any[], ns:any[]}} */
  cfg = { a: [], mx: [], ns: [] };

  /** @type {Array<string>} */
  log = [];

  /** @type {HTMLElement|null} */
  logEl = null;

  /** @type {HTMLButtonElement|null} */
  startBtn = null;
  /** @type {HTMLButtonElement|null} */
  stopBtn = null;
  /** @type {HTMLButtonElement|null} */
  saveBtn = null;

  /** @type {{root:HTMLElement,getRows:()=>any[],setRows:(rows:any[])=>void}|null} */
  aEditor = null;
  /** @type {{root:HTMLElement,getRows:()=>any[],setRows:(rows:any[])=>void}|null} */
  mxEditor = null;
  /** @type {{root:HTMLElement,getRows:()=>any[],setRows:(rows:any[])=>void}|null} */
  nsEditor = null;

  /** @type {any} */
  saveTimer = null;

  run() {
    this.root.classList.add("app", "app-dnsd");
  }

  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const status = UI.textarea({
      className: "msg",
      rows: "5",
      onInput: undefined,
      onChange: undefined,
    });
    status.readOnly = true;

    const onEdit = () => this._scheduleSave();

    this.aEditor = createTableEditor(
      [
        { key: "name", label: "Name", type: "text", placeholder: "example.com" },
        { key: "ip", label: "IPv4", type: "text", placeholder: "192.0.2.10", widthPx: 160 },
        { key: "ttl", label: "TTL", type: "number", placeholder: "60", widthPx: 90 },
      ],
      onEdit,
      () => ({ name: "", ip: "", ttl: 60 })
    );

    this.mxEditor = createTableEditor(
      [
        { key: "name", label: "Name", type: "text", placeholder: "example.com" },
        { key: "preference", label: "Pref", type: "number", placeholder: "10", widthPx: 90 },
        { key: "exchange", label: "Exchange", type: "text", placeholder: "mail.example.com" },
        { key: "ttl", label: "TTL", type: "number", placeholder: "60", widthPx: 90 },
      ],
      onEdit,
      () => ({ name: "", preference: 10, exchange: "", ttl: 60 })
    );

    this.nsEditor = createTableEditor(
      [
        { key: "name", label: "Zone", type: "text", placeholder: "example.com" },
        { key: "host", label: "NS Host", type: "text", placeholder: "ns1.example.com" },
        { key: "ttl", label: "TTL", type: "number", placeholder: "300", widthPx: 90 },
      ],
      onEdit,
      () => ({ name: "", host: "", ttl: 300 })
    );

    const tabs = createTabs([
      { id: "a", title: "A", contentEl: this.aEditor.root },
      { id: "mx", title: "MX", contentEl: this.mxEditor.root },
      { id: "ns", title: "NS", contentEl: this.nsEditor.root },
    ]);

    const start = UI.button(t("app.dnsd.button.start"), () => this._start(), { primary: true });
    const stop = UI.button(t("app.dnsd.button.stop"), () => this._stop());
    const save = UI.button(t("app.dnsd.button.save"), () => this._saveConfigNow());
    this.startBtn = start;
    this.stopBtn = stop;
    this.saveBtn = save;

    const logBox = UI.el("div", { className: "msg" });
    this.logEl = logBox;

    const panel = UI.panel([
      UI.el("div", { text: "DNS Config (saved to " + this.configPath + ")" }),
      tabs.root,
      UI.buttonRow([start, stop, save]),
      status,
      UI.el("div", { text: t("app.dnsd.label.log") }),
      logBox,
    ]);

    this.root.replaceChildren(panel);

    this._loadConfigIntoUI();
    this._syncButtons();
    this._renderLog();

    this.disposer.interval(() => {
      status.value =
        `pid: ${this.pid}\n` +
        `running: ${this.running}\n` +
        `port: ${(this.socketPort ?? "-")}\n` +
        `A/MX/NS: ${this.cfg.a.length}/${this.cfg.mx.length}/${this.cfg.ns.length}\n` +
        `log: ${this.log.length}`;
    }, 300);
  }

  onUnmount() {
    this.disposer.dispose();
    this.logEl = null;
    this.startBtn = null;
    this.stopBtn = null;
    this.saveBtn = null;
    this.aEditor = null;
    this.mxEditor = null;
    this.nsEditor = null;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    super.onUnmount();
  }

  destroy() {
    this._stop();
    super.destroy();
  }

  _appendLog(line) {
    this.log.push(line);
    if (this.log.length > 2000) this.log.splice(0, this.log.length - 2000);
    if (this.mounted) this._renderLog();
  }

  _renderLog() {
    if (!this.logEl) return;
    const maxLines = 200;
    const lines = this.log.length > maxLines ? this.log.slice(-maxLines) : this.log;
    this.logEl.textContent = lines.join("\n");
  }

  _syncButtons() {
    if (this.startBtn) this.startBtn.disabled = this.running;
    if (this.stopBtn) this.stopBtn.disabled = !this.running;
  }

  _loadConfigIntoUI() {
    try {
      const raw = this.os.fs.readFile(this.configPath);
      // @ts-ignore
      const s = (raw instanceof Uint8Array) ? new TextDecoder().decode(raw) : String(raw ?? "");

      const obj = JSON.parse(s);
      this.cfg = {
        a: Array.isArray(obj.a) ? obj.a : [],
        mx: Array.isArray(obj.mx) ? obj.mx : [],
        ns: Array.isArray(obj.ns) ? obj.ns : [],
      };

      this.aEditor?.setRows(this.cfg.a);
      this.mxEditor?.setRows(this.cfg.mx);
      this.nsEditor?.setRows(this.cfg.ns);

      this._appendLog(`[${nowStamp()}] loaded config from ${this.configPath}`);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] config load failed (using empty): ${reason}`);
    }
  }

  _rebuildConfigFromUI() {
    const aRows = this.aEditor?.getRows() ?? [];
    const mxRows = this.mxEditor?.getRows() ?? [];
    const nsRows = this.nsEditor?.getRows() ?? [];

    /** @type {{name:string, ip:string, ttl:number}[]} */
    const a = [];
    for (const r of aRows) {
      const name = normalizeName(r.name);
      const ip = String(r.ip ?? "").trim();
      const ttl = Number(r.ttl ?? 60);
      if (!name || !ip) continue;
      a.push({ name, ip, ttl: Number.isFinite(ttl) ? Math.max(0, ttl | 0) : 60 });
    }

    /** @type {{name:string, preference:number, exchange:string, ttl:number}[]} */
    const mx = [];
    for (const r of mxRows) {
      const name = normalizeName(r.name);
      const exchange = normalizeName(r.exchange);
      const preference = Number(r.preference ?? 10);
      const ttl = Number(r.ttl ?? 60);
      if (!name || !exchange) continue;
      mx.push({
        name,
        exchange,
        preference: Number.isFinite(preference) ? Math.max(0, Math.min(65535, preference | 0)) : 10,
        ttl: Number.isFinite(ttl) ? Math.max(0, ttl | 0) : 60
      });
    }

    /** @type {{name:string, host:string, ttl:number}[]} */
    const ns = [];
    for (const r of nsRows) {
      const name = normalizeName(r.name);
      const host = normalizeName(r.host);
      const ttl = Number(r.ttl ?? 300);
      if (!name || !host) continue;
      ns.push({ name, host, ttl: Number.isFinite(ttl) ? Math.max(0, ttl | 0) : 300 });
    }

    this.cfg = { a, mx, ns };
  }

  _scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this._saveConfigNow();
    }, 350);
  }

  _saveConfigNow() {
    try {
      this._rebuildConfigFromUI();
      const json = JSON.stringify(this.cfg, null, 2);
      this.os.fs.writeFile(this.configPath, json);
      this._appendLog(`[${nowStamp()}] saved config (${this.cfg.a.length}/${this.cfg.mx.length}/${this.cfg.ns.length})`);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] save failed: ${reason}`);
    }
  }

  _start() {
    if (this.running) return;

    try {
      this._rebuildConfigFromUI();
      const port = this.os.net.openUDPSocket(0, this.port);
      this.socketPort = port;
      this.running = true;
      this._appendLog(`[${nowStamp()}] DNS listening on UDP/${this.port}`);
      this._syncButtons();
      this._recvLoop();
    } catch (e) {
      this.socketPort = null;
      this.running = false;
      this._syncButtons();
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] start failed: ${reason}`);
    }
  }

  _stop() {
    if (!this.running && this.socketPort == null) return;

    const port = this.socketPort;
    this.running = false;
    this.socketPort = null;

    if (port != null) {
      try {
        this.os.net.closeUDPSocket(port);
        this._appendLog(`[${nowStamp()}] stopped`);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] stop error: ${reason}`);
      }
    }

    this._syncButtons();
  }

  async _recvLoop() {
    while (this.running && this.socketPort != null) {
      const port = this.socketPort;

      /** @type {any} */
      let pkt = null;
      try {
        pkt = await this.os.net.recvUDPSocket(port);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e));
        this._appendLog(`[${nowStamp()}] recv error: ${reason}`);
        continue;
      }

      if (!this.running || this.socketPort == null) break;
      if (pkt == null) break;

      const srcIp = typeof pkt.src === "number" ? pkt.src : 0;
      const srcPort = typeof pkt.srcPort === "number" ? pkt.srcPort : 0;

      /** @type {Uint8Array} */
      const data =
        pkt.payload instanceof Uint8Array
          ? pkt.payload
          : (pkt.data instanceof Uint8Array ? pkt.data : new Uint8Array());

      this._handleDNSQuery(port, srcIp, srcPort, data);
    }

    this._syncButtons();
  }

  _nameExists(qname) {
    const n = normalizeName(qname);
    for (const r of this.cfg.a) if (normalizeName(r.name) === n) return true;
    for (const r of this.cfg.mx) if (normalizeName(r.name) === n) return true;
    for (const r of this.cfg.ns) if (normalizeName(r.name) === n) return true;
    return false;
  }

  _handleDNSQuery(sockPort, srcIp, srcPort, payload) {
    /** @type {DNSPacket|null} */
    let q = null;

    try {
      q = DNSPacket.fromBytes(payload);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] bad dns from ${ipToString(srcIp)}:${srcPort} (${reason})`);
      return;
    }

    if (q.qr !== 0) return;

    const questions = q.questions ?? [];
    if (questions.length === 0) return;

    const resp = new DNSPacket({
      id: q.id,
      qr: 1,
      opcode: q.opcode,
      aa: 1,
      tc: 0,
      rd: q.rd,
      ra: 0,
      z: 0,
      rcode: 0,
      questions,
      answers: [],
      authorities: [],
      additionals: [],
    });

    let anyAnswered = false;
    let anyNameExists = false;

    for (const qu of questions) {
      const qname = normalizeName(qu.name);
      const qtype = qu.type & 0xffff;
      const qcls = qu.cls & 0xffff;

      if (qcls !== DNSPacket.CLASS_IN) {
        resp.rcode = 4; // Not Implemented
        continue;
      }

      if (this._nameExists(qname)) anyNameExists = true;

      const answersForThis = this._lookup(qname, qtype);
      for (const rr of answersForThis) resp.answers.push(rr);

      if (answersForThis.length > 0) anyAnswered = true;
    }

    if (!anyAnswered) resp.rcode = anyNameExists ? 0 : 3;

    const out = resp.pack();

    try {
      this.os.net.sendUDPSocket(sockPort, srcIp, srcPort, out);
      this._appendLog(`[${nowStamp()}] dns ${ipToString(srcIp)}:${srcPort} q=${questions[0].name} -> rcode=${resp.rcode} an=${resp.answers.length}`);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e));
      this._appendLog(`[${nowStamp()}] send error: ${reason}`);
    }
  }

  /**
   * @param {string} qname normalized
   * @param {number} qtype
   * @returns {import("../pdu/DNSPacket.js").DNSResourceRecord[]}
   */
  _lookup(qname, qtype) {
    /** @type {any[]} */
    const out = [];

    const mkRR = (rr) => ({
      name: rr.name,
      type: rr.type,
      cls: DNSPacket.CLASS_IN,
      ttl: rr.ttl ?? 60,
      data: rr.data,
    });

    // A
    if (qtype === DNSPacket.TYPE_A || qtype === 255 /* ANY */) {
      for (const r of this.cfg.a) {
        if (normalizeName(r.name) !== qname) continue;
        const ip = parseIPv4(r.ip);
        if (!ip) continue;
        out.push(mkRR({ name: r.name, type: DNSPacket.TYPE_A, ttl: r.ttl ?? 60, data: ip }));
      }
    }

    // NS
    if (qtype === DNSPacket.TYPE_NS || qtype === 255) {
      for (const r of this.cfg.ns) {
        if (normalizeName(r.name) !== qname) continue;
        const host = normalizeName(r.host);
        if (!host) continue;
        out.push(mkRR({ name: r.name, type: DNSPacket.TYPE_NS, ttl: r.ttl ?? 300, data: host }));
      }
    }

    // MX
    if (qtype === DNSPacket.TYPE_MX || qtype === 255) {
      for (const r of this.cfg.mx) {
        if (normalizeName(r.name) !== qname) continue;
        const exchange = normalizeName(r.exchange);
        const preference = Number(r.preference ?? 10) | 0;
        if (!exchange) continue;
        out.push(mkRR({
          name: r.name,
          type: DNSPacket.TYPE_MX,
          ttl: r.ttl ?? 60,
          data: { preference, exchange }
        }));
      }
    }

    return /** @type {any} */ (out);
  }
}
