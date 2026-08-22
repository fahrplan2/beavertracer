//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { TlsCertificate } from "../net/models/TlsCertificate.js";
import { OsFilePicker } from "./lib/OsFilePicker.js";
import { SimDialog } from "../lib/SimDialog.js";
import { CertClipboard } from "../lib/CertClipboard.js";
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
  badge = "";

  /** @type {Disposer} */
  disposer = new Disposer();

  // Tab 1
  /** @type {string|null} */ _t1SelPath = null;
  /** @type {HTMLElement|null} */ _t1ListEl   = null;
  /** @type {HTMLElement|null} */ _t1DetailEl = null;
  /** @type {HTMLElement|null} */ _t1SplitEl  = null;

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
  /** @type {((id: string) => void)|null} */ _setActiveTab = null;

  // Clipboard paste buttons (labels updated reactively)
  /** @type {HTMLButtonElement|null} */ _t1PasteEl = null;
  /** @type {HTMLButtonElement|null} */ _t3PasteEl = null;

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
    this._t1PasteEl  = UI.button(t("app.certmanager.clipboard.pasteEmpty"),
      () => this._pasteFromClipboard("certs"), { icon: "fa-paste" });
    const pane1 = UI.el("div", { className: "cm-split", children: [
      UI.el("div", { className: "cm-list-col", children: [
        this._t1ListEl,
        UI.buttonRow([this._t1PasteEl]),
      ]}),
      this._t1DetailEl,
    ]});
    this._t1SplitEl = pane1;

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
    this._t3PasteEl  = UI.button(t("app.certmanager.clipboard.pasteEmpty"),
      () => this._pasteFromClipboard("trusted"), { icon: "fa-paste" });
    const pane3 = UI.el("div", { className: "cm-split", children: [
      UI.el("div", { className: "cm-list-col", children: [
        this._t3ListEl,
        UI.buttonRow([
          UI.button(t("app.certmanager.trusted.import"),
            () => this._importTrusted(), { icon: "fa-file-import" }),
          this._t3PasteEl,
        ]),
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
    const { bar, setActive } = UI.tabbedPane([
      { id: "t1", label: t("app.certmanager.tab.certs"),   pane: pane1,
        onShow: () => { this._refreshT1(); this._updatePasteButtons(); } },
      { id: "t2", label: t("app.certmanager.tab.gen"),     pane: pane2,
        onShow: () => this._refreshT2Ca() },
      { id: "t3", label: t("app.certmanager.tab.trusted"), pane: pane3,
        onShow: () => { this._refreshT3(); this._updatePasteButtons(); } },
      { id: "t4", label: t("app.certmanager.tab.sign"),    pane: pane4,
        onShow: () => this._refreshT4() },
    ]);

    this._setActiveTab = setActive;
    this.root.replaceChildren(UI.panel([bar, pane1, pane2, pane3, pane4]));
    this._ensureDirs();
    this._refreshT1();
  }

  onUnmount() {
    this.disposer.dispose();
    this._t1ListEl = this._t1DetailEl = this._t1SplitEl = null;
    this._t2CnEl = this._t2TypeEl = this._t2CaEl = this._t2CaRowEl = null;
    this._t2IsCaEl = this._t2ValidEl = this._t2NameEl = this._t2MsgEl = null;
    this._t3ListEl = this._t3DetailEl = null;
    this._t4CertEl = this._t4CaEl = this._t4PreviewEl = this._t4NameEl = this._t4MsgEl = null;
    this._setActiveTab = null;
    this._t1PasteEl = this._t3PasteEl = null;
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
   * @returns {Promise<{ cert: TlsCertificate, path: string, name: string }[]>}
   */
  async _readEntries(dir) {
    const fs = this._fs;
    if (!fs) return [];
    /** @type {string[]} */
    let names = [];
    try { names = fs.readdir(dir); } catch { return []; }
    const jsons = names.filter(n => n.endsWith(".json"));
    const results = await Promise.all(jsons.map(async n => {
      try {
        const cert = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(`${dir}/${n}`)));
        return { cert, path: `${dir}/${n}`, name: n };
      } catch { return null; }
    }));
    return /** @type {{ cert: TlsCertificate, path: string, name: string }[]} */ (
      results.filter(r => r !== null)
    );
  }

  // ── Tab 1 ─────────────────────────────────────────────────────────────────

  async _refreshT1() {
    const el = this._t1ListEl;
    if (!el) return;
    const entries = await this._readEntries(CERT_DIR);
    if (entries.length > 0) {
      if (!entries.find(e => e.path === this._t1SelPath)) {
        this._t1SelPath = entries[0].path;
        this._renderT1Detail(entries[0]);
      }
      el.replaceChildren(...entries.map(e => this._certItem(e, this._t1SelPath, () => {
        this._t1SelPath = e.path;
        this._renderT1Detail(e);
        this._refreshT1();
      })));
    } else {
      this._t1SelPath = null;
      el.replaceChildren();
      const del = UI.button(t("app.certmanager.detail.delete"), () => {}, { icon: "fa-trash" });
      const exp = UI.button(t("app.certmanager.detail.export"), () => {}, { icon: "fa-file-export" });
      const tru = UI.button(t("app.certmanager.detail.trust"),  () => {}, { icon: "fa-shield-halved" });
      del.disabled = exp.disabled = tru.disabled = true;
      this._t1DetailEl?.replaceChildren(this._buildPlaceholderDetail([del, exp, tru]));
    }
  }

  /** @param {{ cert: TlsCertificate, path: string, name: string }} e */
  _renderT1Detail(e) {
    if (!this._t1DetailEl) return;
    const copyKeyBtn = UI.button(t("app.certmanager.clipboard.copyWithKey"),
      () => this._copyToClipboard(e.cert, true), { icon: "fa-key" });
    if (!e.cert.hasPrivateKey) copyKeyBtn.disabled = true;
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
    ], e.path, [
      UI.button(t("app.certmanager.clipboard.copy"),
        () => this._copyToClipboard(e.cert, false), { icon: "fa-copy" }),
      copyKeyBtn,
    ]));
  }

  // ── Tab 2 ─────────────────────────────────────────────────────────────────

  async _refreshT2Ca() {
    const sel = this._t2CaEl;
    if (!sel) return;
    const cas = (await this._readEntries(CERT_DIR)).filter(e => e.cert.isCA && e.cert.hasPrivateKey);
    sel.replaceChildren(
      ...cas.length > 0
        ? cas.map(e => UI.el("option", { attrs: { value: e.path }, text: cnOf(e.cert.subject) }))
        : [UI.el("option", { attrs: { value: "" }, text: t("app.certmanager.gen.noCA") })]
    );
  }

  async _generateCert() {
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

    const nowMs = this.os.clock ? this.os.clock.nowMs() : Date.now();

    let cert;
    try {
      if (type === "ca" && this._t2CaEl?.value) {
        const ca = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(this._t2CaEl.value)));
        cert = await TlsCertificate.generate(cn, ca, { isCA, validityDays: days, nowMs });
      } else {
        cert = await TlsCertificate.generate(cn, null, { isCA, validityDays: days, nowMs });
      }
    } catch { this._setMsg(this._t2MsgEl, t("app.certmanager.gen.errLoadCA")); return; }

    try {
      fs.writeFile(outPath, JSON.stringify(await cert.toSaveData(), null, 2));
      this._setMsg(this._t2MsgEl, t("app.certmanager.gen.ok", { name }));
      if (this._t2NameEl) { delete this._t2NameEl.dataset.manual; this._t2NameEl.value = ""; }
      if (this._t2CnEl)   this._t2CnEl.value = "";
    } catch { this._setMsg(this._t2MsgEl, t("app.certmanager.gen.errWrite")); }
  }

  // ── Tab 3 ─────────────────────────────────────────────────────────────────

  async _refreshT3() {
    const el = this._t3ListEl;
    if (!el) return;
    const entries = await this._readEntries(TRUSTED_DIR);
    if (entries.length > 0) {
      if (!entries.find(e => e.path === this._t3SelPath)) {
        this._t3SelPath = entries[0].path;
        this._renderT3Detail(entries[0]);
      }
      el.replaceChildren(...entries.map(e => this._certItem(e, this._t3SelPath, () => {
        this._t3SelPath = e.path;
        this._renderT3Detail(e);
        this._refreshT3();
      })));
    } else {
      this._t3SelPath = null;
      el.replaceChildren();
      const rem = UI.button(t("app.certmanager.trusted.remove"), () => {}, { icon: "fa-trash" });
      const exp = UI.button(t("app.certmanager.detail.export"),  () => {}, { icon: "fa-file-export" });
      rem.disabled = exp.disabled = true;
      this._t3DetailEl?.replaceChildren(this._buildPlaceholderDetail([rem, exp]));
    }
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
      const cert = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(abs)));
      const name = abs.split("/").pop() ?? "cert.json";
      // Store only public data in the trust store (no private key)
      fs.writeFile(TRUSTED_DIR + "/" + name, JSON.stringify(cert.toJSON(), null, 2));
      this.os.reloadCertStore();
      this._refreshT3();
    } catch { /* ignore invalid file */ }
  }

  // ── Tab 4 ─────────────────────────────────────────────────────────────────

  async _refreshT4() {
    const fs = this._fs;
    if (!this._t4CertEl || !this._t4CaEl || !fs) return;

    const all = await this._readEntries(CERT_DIR);
    const cas = all.filter(e => e.cert.isCA && e.cert.hasPrivateKey);

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

  async _updateSignPreview() {
    const el = this._t4PreviewEl;
    if (!el) return;
    const fs = this._fs;
    const certPath = this._t4CertEl?.value;
    const caPath   = this._t4CaEl?.value;
    if (!fs || !certPath || !caPath || certPath === caPath) {
      el.replaceChildren(); return;
    }
    try {
      const cert  = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(certPath)));
      const ca    = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(caPath)));
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

  async _signCert() {
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
      const cert   = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(certPath)));
      const ca     = await TlsCertificate.fromJSON(JSON.parse(fs.readFile(caPath)));
      const nowMs  = this.os.clock ? this.os.clock.nowMs() : Date.now();
      const signed = await TlsCertificate.sign(cert, ca, { nowMs });
      fs.writeFile(outPath, JSON.stringify(await signed.toSaveData(), null, 2));
      this._setMsg(this._t4MsgEl, t("app.certmanager.sign.ok", { name }));
      if (this._t4NameEl) { delete this._t4NameEl.dataset.manual; this._t4NameEl.value = ""; }
      this._refreshT4();
    } catch { this._setMsg(this._t4MsgEl, t("app.certmanager.sign.errFailed")); }
  }

  // ── shared UI helpers ─────────────────────────────────────────────────────

  /** @param {HTMLButtonElement[]} buttons */
  _buildPlaceholderDetail(buttons) {
    const dash = "—";
    return UI.el("div", { children: [
      this._detailRow(t("app.certmanager.detail.subject"),     dash),
      this._detailRow(t("app.certmanager.detail.issuer"),      dash),
      this._detailRow(t("app.certmanager.detail.fingerprint"), dash),
      this._detailRow(t("app.certmanager.detail.expiry"),      dash),
      this._detailRow(t("app.certmanager.detail.isCA"),        dash),
      this._detailRow(t("app.certmanager.detail.privateKey"),  dash),
      UI.buttonRow(buttons),
    ]});
  }

  /**
   * @param {{ icon: string, title: string, hint?: string, btnLabel?: string, btnFn?: () => void }} opts
   */
  _buildEmptyState({ icon, title, hint, btnLabel, btnFn }) {
    return UI.el("div", { className: "cm-empty-state", children: [
      UI.el("i", { className: `fas ${icon} cm-empty-state-icon` }),
      UI.el("div", { className: "cm-empty-state-title", text: title }),
      hint    ? UI.el("div", { className: "cm-empty-state-hint", text: hint }) : null,
      btnLabel && btnFn ? UI.button(btnLabel, btnFn, { icon: "fa-arrow-right" }) : null,
    ].filter(/** @param {any} x */ x => x != null)});
  }

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
        this._validityStatus(cert).key !== "valid"
          ? UI.el("i", { className: "fas fa-triangle-exclamation cm-item-warn", attrs: { title: this._validityStatus(cert).label } })
          : null,
      ].filter(/** @param {any} x */ x => x != null),
    });
    item.addEventListener("click", onSelect);
    return item;
  }

  /**
   * Validity status of a cert against this host's virtual clock.
   * @param {TlsCertificate} cert
   * @returns {{ key: "valid"|"expired"|"notYetValid", label: string }}
   */
  _validityStatus(cert) {
    const nowMs = this.os.clock ? this.os.clock.nowMs() : Date.now();
    const key = cert.validityStatus(nowMs);
    const label = key === "expired"     ? t("app.certmanager.detail.expired")
                : key === "notYetValid" ? t("app.certmanager.detail.notYetValid")
                : t("app.certmanager.detail.valid");
    return { key, label };
  }

  /**
   * @param {TlsCertificate} cert
   * @param {HTMLButtonElement[]} buttons
   * @param {string} [path]
   * @param {HTMLButtonElement[]} [extraButtons] - rendered as a second button row
   */
  _buildDetail(cert, buttons, path, extraButtons) {
    const chain = cert.chain.length
      ? [cnOf(cert.subject), ...cert.chain.map(c => cnOf(c.subject))].join(" ← ")
      : null;
    const status = this._validityStatus(cert);
    return UI.el("div", { children: [
      this._detailRow(t("app.certmanager.detail.subject"),     cert.subject),
      this._detailRow(t("app.certmanager.detail.issuer"),
        cert.issuer + (cert.selfSigned ? ` (${t("app.certmanager.detail.selfSigned")})` : "")),
      this._detailRow(t("app.certmanager.detail.fingerprint"), cert.fingerprint()),
      this._detailRow(t("app.certmanager.detail.expiry"),      expiryStr(cert.notAfter), status.key, status.label),
      this._detailRow(t("app.certmanager.detail.isCA"),
        cert.isCA ? t("app.certmanager.detail.yes") : t("app.certmanager.detail.no")),
      this._detailRow(t("app.certmanager.detail.privateKey"),
        cert.hasPrivateKey ? t("app.certmanager.detail.yes") : t("app.certmanager.detail.no")),
      chain ? this._detailRow(t("app.certmanager.detail.chain"), chain) : null,
      path  ? this._detailRow(t("app.certmanager.detail.path"),  path)  : null,
      UI.buttonRow(buttons),
      extraButtons ? UI.buttonRow(extraButtons) : null,
    ].filter(/** @param {any} x */ x => x != null)});
  }

  /**
   * @param {string} label @param {string} value
   * @param {"valid"|"expired"|"notYetValid"} [statusKey] - optional colored status badge
   * @param {string} [statusLabel]
   */
  _detailRow(label, value, statusKey, statusLabel) {
    return UI.el("div", { className: "cm-detail-row", children: [
      UI.el("span", { className: "cm-detail-label", text: label }),
      UI.el("span", { className: "cm-detail-value", text: value }),
      statusKey ? UI.el("span", { className: `cm-status cm-status-${statusKey}`, text: statusLabel ?? "" }) : null,
    ].filter(/** @param {any} x */ x => x != null)});
  }

  /** @param {TlsCertificate} cert @param {string} name */
  async _exportCert(cert, name) {
    const fs = this._fs;
    if (!fs) return;
    const abs = await OsFilePicker.open({
      fs, container: this.root, mode: "save", cwd: CERT_DIR, filename: name,
      title: t("app.certmanager.detail.exportTitle"),
    });
    if (abs) { try { fs.writeFile(abs, JSON.stringify(await cert.toSaveData(), null, 2)); } catch { } }
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

  // ── clipboard ─────────────────────────────────────────────────────────────

  /**
   * @param {TlsCertificate} cert
   * @param {boolean} withKey
   */
  async _copyToClipboard(cert, withKey) {
    CertClipboard.data         = withKey ? await cert.toSaveData() : cert.toJSON();
    CertClipboard.hasPrivateKey = withKey && cert.hasPrivateKey;
    CertClipboard.cn           = cnOf(cert.subject);
    this._updatePasteButtons();
  }

  /** @param {"certs"|"trusted"} target */
  async _pasteFromClipboard(target) {
    const fs = this._fs;
    if (!fs || !CertClipboard.data) return;
    const dir = target === "trusted" ? TRUSTED_DIR : CERT_DIR;

    const data = target === "trusted"
      ? (() => { const d = /** @type {any} */ ({ ...CertClipboard.data }); delete d.privateKeyJwk; return d; })()
      : CertClipboard.data;

    const name = this._pasteFilename(CertClipboard.cn, dir);
    if (!name) return;
    try {
      fs.writeFile(`${dir}/${name}`, JSON.stringify(data, null, 2));
      if (target === "trusted") { this.os.reloadCertStore(); this._refreshT3(); }
      else                      { this._refreshT1(); }
    } catch { /* ignore */ }
  }

  /**
   * Find a unique filename for a pasted cert in the given dir.
   * @param {string} cn @param {string} dir
   * @returns {string|null}
   */
  _pasteFilename(cn, dir) {
    const fs = this._fs;
    if (!fs) return null;
    const base = cn.replace(/[^a-zA-Z0-9._-]/g, "-") || "cert";
    const try_ = (/** @type {string} */ name) => fs.exists(`${dir}/${name}`) ? null : name;
    const result = try_(`${base}.cert.json`);
    if (result) return result;
    for (let i = 1; i <= 99; i++) {
      const r = try_(`${base}-${i}.cert.json`);
      if (r) return r;
    }
    return null;
  }

  _updatePasteButtons() {
    const clip = CertClipboard;
    const empty = t("app.certmanager.clipboard.pasteEmpty");

    for (const [btn, isT3] of /** @type {[HTMLButtonElement|null, boolean][]} */ ([
      [this._t1PasteEl, false],
      [this._t3PasteEl, true],
    ])) {
      if (!btn) continue;
      if (!clip.data) {
        btn.disabled = true;
        // lastChild is the text node created by UI.button with icon
        if (btn.lastChild) btn.lastChild.textContent = " " + empty;
        continue;
      }
      btn.disabled = false;
      const base = t("app.certmanager.clipboard.paste", { cn: clip.cn });
      const suffix = clip.hasPrivateKey
        ? (isT3 ? t("app.certmanager.clipboard.pastePublic")
                : t("app.certmanager.clipboard.pasteKey"))
        : "";
      if (btn.lastChild) btn.lastChild.textContent = " " + base + suffix;
    }
  }

  /** @param {HTMLElement|null} el @param {string} msg */
  _setMsg(el, msg) {
    if (el) el.textContent = msg;
  }
}
