//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { TlsCertificate } from "../net/models/TlsCertificate.js";
import { OsFilePicker } from "./lib/OsFilePicker.js";
import { SimDialog } from "../lib/SimDialog.js";
import { t } from "../i18n/index.js";

const CERT_DIR    = "/etc/certs";
const TRUSTED_DIR = "/etc/certs/trusted";

/** @param {string} subject */
const cnOf = (subject) => subject.replace(/^CN=/, "");

/** @param {number} ms */
const expiryStr = (ms) => new Date(ms).toLocaleDateString();

export class CertManagerApp extends GenericProcess {

  get title() { return t("app.certmanager.title"); }
  icon  = "fa-shield-halved";
  badge = "CA";

  /** @type {Disposer} */
  disposer = new Disposer();

  // Tab 1
  /** @type {string|null} */ _t1SelPath = null;
  /** @type {HTMLElement|null} */ _t1ListEl   = null;
  /** @type {HTMLElement|null} */ _t1DetailEl = null;

  // Tab 2
  /** @type {HTMLInputElement|null}  */ _t2CnEl      = null;
  /** @type {HTMLSelectElement|null} */ _t2TypeEl    = null;
  /** @type {HTMLSelectElement|null} */ _t2CaEl      = null;
  /** @type {HTMLElement|null}       */ _t2CaRowEl   = null;
  /** @type {HTMLInputElement|null}  */ _t2IsCaEl    = null;
  /** @type {HTMLSelectElement|null} */ _t2ValidEl   = null;
  /** @type {HTMLInputElement|null}  */ _t2NameEl    = null;
  /** @type {HTMLElement|null}       */ _t2MsgEl     = null;

  // Tab 3
  /** @type {string|null} */ _t3SelPath = null;
  /** @type {HTMLElement|null} */ _t3ListEl   = null;
  /** @type {HTMLElement|null} */ _t3DetailEl = null;

  // Tab 4
  /** @type {HTMLSelectElement|null} */ _t4CertEl    = null;
  /** @type {HTMLSelectElement|null} */ _t4CaEl      = null;
  /** @type {HTMLElement|null}       */ _t4PreviewEl = null;
  /** @type {HTMLInputElement|null}  */ _t4NameEl    = null;
  /** @type {HTMLElement|null}       */ _t4MsgEl     = null;

  run() {
    this.root.classList.add("app", "app-certmanager");
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    // ── Tab 1: My Certs ──────────────────────────────────────────────────────
    this._t1ListEl   = UI.el("div", { className: "cm-list" });
    this._t1DetailEl = UI.el("div", { className: "cm-detail msg" });
    const pane1 = UI.el("div", { className: "cm-split", children: [
      this._t1ListEl,
      this._t1DetailEl,
    ]});

    // ── Tab 2: Generate ──────────────────────────────────────────────────────
    this._t2CnEl   = UI.input({ placeholder: t("app.certmanager.gen.cnPlaceholder") });
    this._t2TypeEl = UI.select([
      { value: "self", label: t("app.certmanager.gen.typeSelf") },
      { value: "ca",   label: t("app.certmanager.gen.typeCa")   },
    ]);
    this._t2CaEl = UI.select([], {});
    this._t2CaRowEl = UI.row(t("app.certmanager.gen.caLabel"), this._t2CaEl);
    this._t2CaRowEl.style.display = "none";

    this._t2TypeEl.addEventListener("change", () => {
      if (this._t2CaRowEl)
        this._t2CaRowEl.style.display = this._t2TypeEl?.value === "ca" ? "" : "none";
    });

    this._t2IsCaEl = /** @type {HTMLInputElement} */ (UI.el("input", { attrs: { type: "checkbox" } }));
    const isCaLabel = UI.el("label", { className: "cm-check-label",
      children: [this._t2IsCaEl, UI.text(" " + t("app.certmanager.gen.isCa"))] });

    this._t2ValidEl = UI.select([
      { value: "90",   label: t("app.certmanager.gen.val90")  },
      { value: "365",  label: t("app.certmanager.gen.val365") },
      { value: "1095", label: t("app.certmanager.gen.val3y")  },
      { value: "1825", label: t("app.certmanager.gen.val5y")  },
    ], { value: "365" });

    this._t2NameEl = UI.input({ placeholder: t("app.certmanager.gen.namePlaceholder") });
    this._t2CnEl.addEventListener("input", () => {
      const cn = this._t2CnEl?.value.trim() ?? "";
      if (this._t2NameEl && !this._t2NameEl.dataset.manual)
        this._t2NameEl.value = cn ? cn + ".cert.json" : "";
    });
    this._t2NameEl.addEventListener("input", () => {
      if (this._t2NameEl) this._t2NameEl.dataset.manual = "1";
    });

    this._t2MsgEl = UI.el("div", { className: "msg" });

    const pane2 = UI.el("div", { children: [
      UI.row(t("app.certmanager.gen.cn"),       this._t2CnEl),
      UI.row(t("app.certmanager.gen.type"),     this._t2TypeEl),
      this._t2CaRowEl,
      UI.row(t("app.certmanager.gen.options"),  isCaLabel),
      UI.row(t("app.certmanager.gen.validity"), this._t2ValidEl),
      UI.row(t("app.certmanager.gen.filename"), this._t2NameEl),
      UI.buttonRow([
        UI.button(t("app.certmanager.gen.btn"), () => this._generateCert(),
          { primary: true, icon: "fa-certificate" }),
      ]),
      this._t2MsgEl,
    ]});

    // ── Tab 3: Trusted CAs ───────────────────────────────────────────────────
    this._t3ListEl   = UI.el("div", { className: "cm-list" });
    this._t3DetailEl = UI.el("div", { className: "cm-detail msg" });
    const pane3 = UI.el("div", { className: "cm-split", children: [
      UI.el("div", { className: "cm-list-col", children: [
        UI.buttonRow([
          UI.button(t("app.certmanager.trusted.import"),
            () => this._importTrusted(), { icon: "fa-file-import" }),
        ]),
        this._t3ListEl,
      ]}),
      this._t3DetailEl,
    ]});

    // ── Tab 4: Sign ──────────────────────────────────────────────────────────
    this._t4CertEl    = UI.select([], {});
    this._t4CaEl      = UI.select([], {});
    this._t4PreviewEl = UI.el("div", { className: "cm-preview" });
    this._t4NameEl    = UI.input({ placeholder: t("app.certmanager.sign.namePlaceholder") });
    this._t4NameEl.addEventListener("input", () => {
      if (this._t4NameEl) this._t4NameEl.dataset.manual = "1";
    });
    this._t4MsgEl = UI.el("div", { className: "msg" });

    const updatePreview = () => this._updateSignPreview();
    this._t4CertEl.addEventListener("change", updatePreview);
    this._t4CaEl.addEventListener("change",   updatePreview);

    const pane4 = UI.el("div", { children: [
      UI.row(t("app.certmanager.sign.cert"),     this._t4CertEl),
      UI.row(t("app.certmanager.sign.ca"),       this._t4CaEl),
      this._t4PreviewEl,
      UI.row(t("app.certmanager.sign.filename"), this._t4NameEl),
      UI.buttonRow([
        UI.button(t("app.certmanager.sign.btn"), () => this._signCert(),
          { primary: true, icon: "fa-pen-nib" }),
      ]),
      this._t4MsgEl,
    ]});

    // ── Tab bar + panel ──────────────────────────────────────────────────────
    const { bar } = UI.tabbedPane([
      { id: "t1", label: t("app.certmanager.tab.certs"),   pane: pane1,
        onShow: () => this._refreshT1() },
      { id: "t2", label: t("app.certmanager.tab.gen"),     pane: pane2,
        onShow: () => this._refreshT2Ca() },
      { id: "t3", label: t("app.certmanager.tab.trusted"), pane: pane3,
        onShow: () => this._refreshT3() },
      { id: "t4", label: t("app.certmanager.tab.sign"),    pane: pane4,
        onShow: () => this._refreshT4() },
    ]);

    this.root.replaceChildren(UI.panel([bar, pane1, pane2, pane3, pane4]));
    this._ensureDirs();
    this._refreshT1();
  }

  onUnmount() {
    this.disposer.dispose();
    this._t1ListEl = this._t1DetailEl = null;
    this._t2CnEl = this._t2TypeEl = this._t2CaEl = this._t2CaRowEl = null;
    this._t2IsCaEl = this._t2ValidEl = this._t2NameEl = this._t2MsgEl = null;
    this._t3ListEl = this._t3DetailEl = null;
    this._t4CertEl = this._t4CaEl = this._t4PreviewEl = this._t4NameEl = this._t4MsgEl = null;
    super.onUnmount();
  }

  // ── filesystem helpers ────────────────────────────────────────────────────

  get _fs() { return this.os.fs; }

  _ensureDirs() {
    const fs = this._fs;
    if (!fs) return;
    try { fs.mkdir(CERT_DIR,    { recursive: true }); } catch { /* already exists */ }
    try { fs.mkdir(TRUSTED_DIR, { recursive: true }); } catch { /* already exists */ }
  }

  /**
   * @param {string} dir
   * @returns {{ cert: TlsCertificate, path: string, name: string }[]}
   */
  _readEntries(dir) {
    const fs = this._fs;
    if (!fs) return [];
    /** @type {string[]} */
    let names = [];
    try { names = fs.readdir(dir); } catch { return []; }
    return names.filter(n => n.endsWith(".json")).flatMap(n => {
      try {
        const cert = TlsCertificate.fromJSON(JSON.parse(fs.readFile(`${dir}/${n}`)));
        return [{ cert, path: `${dir}/${n}`, name: n }];
      } catch { return []; }
    });
  }

  // ── Tab 1 ─────────────────────────────────────────────────────────────────

  _refreshT1() {
    const el = this._t1ListEl;
    if (!el) return;
    const entries = this._readEntries(CERT_DIR);
    const children = entries.length > 0
      ? entries.map(e => this._certItem(e, this._t1SelPath, () => {
          this._t1SelPath = e.path;
          this._renderT1Detail(e);
          this._refreshT1();
        }))
      : [UI.el("div", { className: "cm-empty", text: t("app.certmanager.empty") })];
    el.replaceChildren(...children);
  }

  /** @param {{ cert: TlsCertificate, path: string, name: string }} e */
  _renderT1Detail(e) {
    if (!this._t1DetailEl) return;
    this._t1DetailEl.replaceChildren(this._buildDetail(e.cert, [
      UI.button(t("app.certmanager.detail.delete"), async () => {
        const ok = await SimDialog.confirm(
          t("app.certmanager.detail.confirmDelete", { name: cnOf(e.cert.subject) }));
        if (!ok) return;
        try { this._fs.unlink(e.path); } catch { /* ignore */ }
        this._t1SelPath = null;
        this._t1DetailEl?.replaceChildren();
        this._refreshT1();
      }, { icon: "fa-trash" }),
      UI.button(t("app.certmanager.detail.export"),
        () => this._exportCert(e.cert, e.name), { icon: "fa-file-export" }),
      UI.button(t("app.certmanager.detail.trust"),
        () => { this._addToTrusted(e.cert, e.name); }, { icon: "fa-shield-halved" }),
    ], e.path));
  }

  // ── Tab 2 ─────────────────────────────────────────────────────────────────

  _refreshT2Ca() {
    const sel = this._t2CaEl;
    if (!sel) return;
    const cas = this._readEntries(CERT_DIR).filter(e => e.cert.isCA || e.cert.selfSigned);
    sel.replaceChildren(
      ...cas.length > 0
        ? cas.map(e => UI.el("option", { attrs: { value: e.path }, text: cnOf(e.cert.subject) }))
        : [UI.el("option", { attrs: { value: "" }, text: t("app.certmanager.gen.noCA") })]
    );
  }

  _generateCert() {
    const fs = this._fs;
    if (!fs) return;
    const cn = this._t2CnEl?.value.trim() ?? "";
    if (!cn) { this._setMsg(this._t2MsgEl, t("app.certmanager.gen.errNoCN")); return; }

    const name    = this._t2NameEl?.value.trim() || cn + ".cert.json";
    const outPath = CERT_DIR + "/" + name;
    if (fs.exists(outPath)) {
      this._setMsg(this._t2MsgEl, t("app.certmanager.gen.errExists", { name })); return;
    }

    const days = parseInt(this._t2ValidEl?.value ?? "365", 10);
    const isCA = this._t2IsCaEl?.checked ?? false;
    const type = this._t2TypeEl?.value ?? "self";

    let cert;
    if (type === "ca" && this._t2CaEl?.value) {
      try {
        const ca = TlsCertificate.fromJSON(JSON.parse(fs.readFile(this._t2CaEl.value)));
        cert = TlsCertificate.generate(cn, ca, { isCA, validityDays: days });
      } catch { this._setMsg(this._t2MsgEl, t("app.certmanager.gen.errLoadCA")); return; }
    } else {
      cert = TlsCertificate.generate(cn, null, { isCA, validityDays: days });
    }

    try {
      fs.writeFile(outPath, JSON.stringify(cert.toJSON(), null, 2));
      this._setMsg(this._t2MsgEl, t("app.certmanager.gen.ok", { name }));
      if (this._t2NameEl) { delete this._t2NameEl.dataset.manual; this._t2NameEl.value = ""; }
      if (this._t2CnEl)   this._t2CnEl.value = "";
    } catch { this._setMsg(this._t2MsgEl, t("app.certmanager.gen.errWrite")); }
  }

  // ── Tab 3 ─────────────────────────────────────────────────────────────────

  _refreshT3() {
    const el = this._t3ListEl;
    if (!el) return;
    const entries = this._readEntries(TRUSTED_DIR);
    const children = entries.length > 0
      ? entries.map(e => this._certItem(e, this._t3SelPath, () => {
          this._t3SelPath = e.path;
          this._renderT3Detail(e);
          this._refreshT3();
        }))
      : [UI.el("div", { className: "cm-empty", text: t("app.certmanager.trusted.empty") })];
    el.replaceChildren(...children);
  }

  /** @param {{ cert: TlsCertificate, path: string, name: string }} e */
  _renderT3Detail(e) {
    if (!this._t3DetailEl) return;
    this._t3DetailEl.replaceChildren(this._buildDetail(e.cert, [
      UI.button(t("app.certmanager.trusted.remove"), async () => {
        const ok = await SimDialog.confirm(
          t("app.certmanager.trusted.confirmRemove", { name: cnOf(e.cert.subject) }));
        if (!ok) return;
        try { this._fs.unlink(e.path); } catch { /* ignore */ }
        this.os.reloadCertStore();
        this._t3SelPath = null;
        this._t3DetailEl?.replaceChildren();
        this._refreshT3();
      }, { icon: "fa-trash" }),
      UI.button(t("app.certmanager.detail.export"),
        () => this._exportCert(e.cert, e.name), { icon: "fa-file-export" }),
    ], e.path));
  }

  async _importTrusted() {
    const fs = this._fs;
    if (!fs) return;
    const abs = await OsFilePicker.open({
      fs, container: this.root, mode: "open", cwd: CERT_DIR,
      title: t("app.certmanager.trusted.importTitle"),
    });
    if (!abs) return;
    try {
      const cert = TlsCertificate.fromJSON(JSON.parse(fs.readFile(abs)));
      const name = abs.split("/").pop() ?? "cert.json";
      fs.writeFile(TRUSTED_DIR + "/" + name, JSON.stringify(cert.toJSON(), null, 2));
      this.os.reloadCertStore();
      this._refreshT3();
    } catch { /* ignore invalid file */ }
  }

  // ── Tab 4 ─────────────────────────────────────────────────────────────────

  _refreshT4() {
    const fs = this._fs;
    if (!this._t4CertEl || !this._t4CaEl || !fs) return;

    const all = this._readEntries(CERT_DIR);
    const cas = all.filter(e => e.cert.isCA || e.cert.selfSigned);

    const fillSel = (/** @type {HTMLSelectElement} */ sel,
                     /** @type {typeof all} */ entries) => {
      sel.replaceChildren(
        ...entries.length > 0
          ? entries.map(e => UI.el("option", { attrs: { value: e.path }, text: cnOf(e.cert.subject) }))
          : [UI.el("option", { attrs: { value: "" }, text: "—" })]
      );
    };
    fillSel(this._t4CertEl, all);
    fillSel(this._t4CaEl,   cas);
    this._updateSignPreview();
  }

  _updateSignPreview() {
    const el = this._t4PreviewEl;
    if (!el) return;
    const fs = this._fs;
    const certPath = this._t4CertEl?.value;
    const caPath   = this._t4CaEl?.value;
    if (!fs || !certPath || !caPath || certPath === caPath) {
      el.replaceChildren(); return;
    }
    try {
      const cert  = TlsCertificate.fromJSON(JSON.parse(fs.readFile(certPath)));
      const ca    = TlsCertificate.fromJSON(JSON.parse(fs.readFile(caPath)));
      const chain = [cnOf(cert.subject), cnOf(ca.subject), ...ca.chain.map(c => cnOf(c.subject))];
      el.replaceChildren(
        this._detailRow(t("app.certmanager.detail.subject"), cert.subject),
        this._detailRow(t("app.certmanager.detail.issuer"),  ca.subject),
        this._detailRow(t("app.certmanager.sign.chain"),     chain.join(" ← ")),
      );
      if (this._t4NameEl && !this._t4NameEl.dataset.manual)
        this._t4NameEl.value = cnOf(cert.subject) + "-signed.cert.json";
    } catch { el.replaceChildren(); }
  }

  _signCert() {
    const fs = this._fs;
    if (!fs) return;
    const certPath = this._t4CertEl?.value;
    const caPath   = this._t4CaEl?.value;
    if (!certPath || !caPath) {
      this._setMsg(this._t4MsgEl, t("app.certmanager.sign.errSelect")); return;
    }
    const name    = this._t4NameEl?.value.trim() || "signed.cert.json";
    const outPath = CERT_DIR + "/" + name;
    if (fs.exists(outPath)) {
      this._setMsg(this._t4MsgEl, t("app.certmanager.sign.errExists", { name })); return;
    }
    try {
      const cert   = TlsCertificate.fromJSON(JSON.parse(fs.readFile(certPath)));
      const ca     = TlsCertificate.fromJSON(JSON.parse(fs.readFile(caPath)));
      const signed = TlsCertificate.sign(cert, ca);
      fs.writeFile(outPath, JSON.stringify(signed.toJSON(), null, 2));
      this._setMsg(this._t4MsgEl, t("app.certmanager.sign.ok", { name }));
      if (this._t4NameEl) { delete this._t4NameEl.dataset.manual; this._t4NameEl.value = ""; }
      this._refreshT4();
    } catch { this._setMsg(this._t4MsgEl, t("app.certmanager.sign.errFailed")); }
  }

  // ── shared UI helpers ─────────────────────────────────────────────────────

  /**
   * @param {{ cert: TlsCertificate, path: string, name: string }} e
   * @param {string|null} selPath
   * @param {() => void} onSelect
   */
  _certItem(e, selPath, onSelect) {
    const { cert, path } = e;
    const item = UI.el("div", {
      className: "cm-item" + (selPath === path ? " is-selected" : ""),
      children: [
        UI.el("i", { className: "fas " +
          (cert.isCA ? "fa-building-columns" : "fa-lock") + " cm-item-icon" }),
        UI.el("div", { className: "cm-item-info", children: [
          UI.el("div", { className: "cm-item-cn",   text: cnOf(cert.subject) }),
          UI.el("div", { className: "cm-item-meta", text:
            cert.selfSigned
              ? t("app.certmanager.item.selfSigned")
              : t("app.certmanager.item.issuer", { issuer: cnOf(cert.issuer) }) }),
        ]}),
        cert.isCA ? UI.el("span", { className: "cm-badge", text: "CA" }) : null,
      ].filter(/** @param {any} x */ x => x != null),
    });
    item.addEventListener("click", onSelect);
    return item;
  }

  /**
   * @param {TlsCertificate} cert
   * @param {HTMLButtonElement[]} buttons
   * @param {string} [path]
   */
  _buildDetail(cert, buttons, path) {
    const chain = cert.chain.length
      ? [cnOf(cert.subject), ...cert.chain.map(c => cnOf(c.subject))].join(" ← ")
      : null;
    return UI.el("div", { children: [
      this._detailRow(t("app.certmanager.detail.subject"),     cert.subject),
      this._detailRow(t("app.certmanager.detail.issuer"),
        cert.issuer + (cert.selfSigned ? ` (${t("app.certmanager.detail.selfSigned")})` : "")),
      this._detailRow(t("app.certmanager.detail.fingerprint"), cert.fingerprint()),
      this._detailRow(t("app.certmanager.detail.expiry"),      expiryStr(cert.notAfter)),
      this._detailRow(t("app.certmanager.detail.isCA"),
        cert.isCA ? t("app.certmanager.detail.yes") : t("app.certmanager.detail.no")),
      chain ? this._detailRow(t("app.certmanager.detail.chain"), chain) : null,
      path  ? this._detailRow(t("app.certmanager.detail.path"),  path)  : null,
      UI.buttonRow(buttons),
    ].filter(/** @param {any} x */ x => x != null)});
  }

  /** @param {string} label @param {string} value */
  _detailRow(label, value) {
    return UI.el("div", { className: "cm-detail-row", children: [
      UI.el("span", { className: "cm-detail-label", text: label }),
      UI.el("span", { className: "cm-detail-value", text: value }),
    ]});
  }

  /** @param {TlsCertificate} cert @param {string} name */
  async _exportCert(cert, name) {
    const fs = this._fs;
    if (!fs) return;
    const abs = await OsFilePicker.open({
      fs, container: this.root, mode: "save", cwd: CERT_DIR, filename: name,
      title: t("app.certmanager.detail.exportTitle"),
    });
    if (abs) { try { fs.writeFile(abs, JSON.stringify(cert.toJSON(), null, 2)); } catch { } }
  }

  /** @param {TlsCertificate} cert @param {string} name */
  _addToTrusted(cert, name) {
    const fs = this._fs;
    if (!fs) return;
    try {
      fs.writeFile(TRUSTED_DIR + "/" + name, JSON.stringify(cert.toJSON(), null, 2));
      this.os.reloadCertStore();
    } catch { /* ignore */ }
  }

  /** @param {HTMLElement|null} el @param {string} msg */
  _setMsg(el, msg) {
    if (el) el.textContent = msg;
  }
}
