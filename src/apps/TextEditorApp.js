//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";
import { SimDialog } from "../lib/SimDialog.js";
import { OsFilePicker } from "./lib/OsFilePicker.js";

export class TextEditorApp extends GenericProcess {

  get title() {
    return t("app.texteditor.title");
  }

  icon = "fa-file-pen";

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {HTMLTextAreaElement|null} */
  ta = null;

  /** @type {string} */
  path = "";

  /** @type {string} */
  cwd = "/home";

  /** @type {string} */
  original = "";

  /** @type {boolean} */
  modified = false;

  /** @type {HTMLElement|null} */
  statusEl = null;

  /** @type {string} */
  pickerCwd = "/";

  /** @type {HTMLElement|null} */
  mainView = null;

  /**
   * Optional initializer for opening a file.
   * Call this right after creating the process, before mount.
   * @param {{ path?: string, cwd?: string }} opts
   */
  init(opts = {}) {
    if (typeof opts.cwd === "string") this.cwd = opts.cwd;
    if (typeof opts.path === "string") this.path = opts.path;
  }

  run() {
    this.root.classList.add("app", "app-editor");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const fs = this.os.fs;
    if (!fs) {
      this.root.replaceChildren(UI.panel([
        UI.el("div", { className: "text", text: t("app.texteditor.noFilesystem") }),
      ]));
      return;
    }

    // If no initial path provided: start as a new empty file
    let data = "";
    if (!this.path) {
      this.path = "";
      this.original = "";
      this.modified = false;
      this.pickerCwd = this.cwd || "/";
    } else {
      const abs = fs.resolve(this.cwd, this.path);
      this.path = abs;
      this.pickerCwd = this._dirOf(abs);

      if (fs.exists(abs)) {
        try { data = fs.readFile(abs); } catch { data = ""; }
      } else {
        data = "";
      }

      this.original = data;
      this.modified = false;
    }

    const status = UI.el("div", { className: "editor-status" });
    this.statusEl = status;

    const ta = /** @type {HTMLTextAreaElement} */ (UI.el("textarea", {
      className: "editor-area input",
      attrs: { spellcheck: "false", wrap: "off" },
      init: (el) => { el.value = data; },
    }));
    this.ta = ta;

    ta.value = data;
    this._renderStatus();

    // Mark modified on input
    this.disposer.on(ta, "input", () => {
      this.modified = (ta.value !== this.original);
      this._renderStatus();
    });

    // Keyboard shortcuts: Ctrl+S save
    this.disposer.on(ta, "keydown", (ev) => {
      const e = /** @type {KeyboardEvent} */ (ev);

      // Ctrl+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        this._save();
        return;
      }
    });

    const statusBar = UI.el("div", {
      className: "editor-header",
      children: [
        status,
      ],
    });

    const toolbar = UI.el("div", {
      className: "app-toolbar",
      children: [
        UI.buttonRow([
          UI.button(t("app.texteditor.button.new"), () => this._newFile(), { icon: "fa-file" }),
          UI.button(t("app.texteditor.button.open"), () => this._openPicker(), { icon: "fa-folder-open" }),
          UI.button(t("app.texteditor.button.save"), () => this._save(), { primary: true, icon: "fa-floppy-disk" }),
          UI.button(t("app.texteditor.button.saveAs"), () => this._saveAs(), { icon: "fa-file-export" }),
        ]),
      ],
    });

    const panel = UI.panel([
      toolbar,
      ta,
      statusBar,
    ]);

    this.mainView = panel;
    this.root.replaceChildren(panel);

    this._renderStatus();

    queueMicrotask(() => ta.focus());
  }

  onUnmount() {
    this.disposer.dispose();
    this.ta = null;
    this.statusEl = null;
    super.onUnmount();
  }

  _renderStatus() {
    if (!this.statusEl) return;

    let name = t("app.texteditor.status.newFile");
    if (this.path !== "") name = this.path;

    const mod = this.modified ? t("app.texteditor.status.modified") : "";
    this.statusEl.textContent = `${name} ${mod}`.trim();
  }

  _save() {
    if (!this.path) return this._saveAs();
    return this._saveToPath(this.path);
  }

  async _saveAs() {
    const fs = this.os.fs;
    if (!fs) return;
    const abs = await OsFilePicker.open({
      fs,
      container: this.root,
      mode: "save",
      cwd: this.pickerCwd,
      filename: this.path,
      title: t("app.texteditor.picker.title.save"),
    });
    if (abs) {
      this.pickerCwd = this._dirOf(abs);
      this._saveToPath(abs);
    }
  }

  /**
   * @param {string} absPath
   * @returns {boolean}
   */
  _saveToPath(absPath) {
    const fs = this.os.fs;
    if (!fs || !this.ta) return false;

    try {
      fs.writeFile(absPath, this.ta.value);

      this.path = absPath;
      this.original = this.ta.value;
      this.modified = false;

      this.pickerCwd = this._dirOf(absPath);
      this._renderStatus();
      return true;
    } catch {
      if (this.statusEl) {
        this.statusEl.textContent = t("app.texteditor.save.failed", { path: absPath });
      }
      return false;
    }
  }

  /**
   * @param {string} p
   * @returns {string}
   */
  _dirOf(p) {
    const i = p.lastIndexOf("/");
    return i <= 0 ? "/" : p.slice(0, i);
  }

  /**
   * @param {string} dir
   * @param {string} name
   * @returns {string}
   */
  _join(dir, name) {
    if (dir === "/") return "/" + name;
    return dir.replace(/\/+$/, "") + "/" + name;
  }

  async _newFile() {
    if (!this.ta) return;

    if (this.modified) {
      const ok = await SimDialog.confirm(t("app.texteditor.confirm.discardNew"));
      if (!ok) return;
    }

    this.path = "";
    this.original = "";
    this.modified = false;

    this.ta.value = "";
    this._renderStatus();

    this.pickerCwd = this.cwd || "/";
  }

  async _openPicker() {
    const fs = this.os.fs;
    if (!fs) return;
    const abs = await OsFilePicker.open({
      fs,
      container: this.root,
      mode: "open",
      cwd: this.pickerCwd,
      title: t("app.texteditor.picker.title.open"),
    });
    if (abs) {
      this.pickerCwd = this._dirOf(abs);
      this._loadFile(abs);
    }
  }

  /**
   * @param {string} absPath
   */
  async _loadFile(absPath) {
    const fs = this.os.fs;
    if (!fs || !this.ta) return;

    if (this.modified) {
      const ok = await SimDialog.confirm(t("app.texteditor.confirm.discardOpen"));
      if (!ok) return;
    }

    let data = "";
    if (fs.exists(absPath)) data = fs.readFile(absPath);

    this.path = absPath;
    this.original = data;
    this.modified = false;

    this.ta.value = data;
    this._renderStatus();
  }
}