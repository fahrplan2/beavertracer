//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "./lib/Disposer.js";
import { t } from "../i18n/index.js";

export class TextEditorApp extends GenericProcess {

  title = t("apps.editor.title");

  /** @type {Disposer} */
  bag = new Disposer();

  /** @type {Disposer} */
  pickerBag = new Disposer();

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

  /** @type {HTMLElement|null} */
  modalEl = null;

  /** @type {string} */
  pickerCwd = "/";

  /** @type {"open"|"save"|null} */
  pickerMode = null;

  /** @type {((absPath: string) => void)|null} */
  pickerCallback = null;

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
    this.title = t("app.texteditor.windowTitle");
    this.root.classList.add("app", "app-editor");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.bag.dispose();

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
    this.bag.on(ta, "input", () => {
      this.modified = (ta.value !== this.original);
      this._renderStatus();
    });

    // Keyboard shortcuts: Ctrl+S save
    this.bag.on(ta, "keydown", (ev) => {
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

    const actions = UI.buttonRow([
      UI.button(t("app.texteditor.button.new"), () => this._newFile()),
      UI.button(t("app.texteditor.button.open"), () => this._openPicker()),
      UI.button(t("app.texteditor.button.save"), () => this._save(), { primary: true }),
      UI.button(t("app.texteditor.button.saveAs"), () => this._saveAs()),
    ]);

    const panel = UI.panel([
      actions,
      ta,
      statusBar,
    ]);

    this.mainView = panel;
    this.root.replaceChildren(panel);

    this._renderStatus();

    queueMicrotask(() => ta.focus());
  }

  onUnmount() {
    this.bag.dispose();
    this.pickerBag.dispose();
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

  /**
   * Ask for a path and save there.
   */
  _saveAs() {
    this._openFilePicker("save", (abs) => {
      this._saveToPath(abs);
    });
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

  _newFile() {
    if (!this.ta) return;

    if (this.modified) {
      const ok = window.confirm(t("app.texteditor.confirm.discardNew"));
      if (!ok) return;
    }

    this.path = "";
    this.original = "";
    this.modified = false;

    this.ta.value = "";
    this._renderStatus();

    this.pickerCwd = this.cwd || "/";
  }

  _openPicker() {
    this._openFilePicker("open", (abs) => {
      this._loadFile(abs);
    });
  }

  /**
   * @param {"open"|"save"} mode
   * @param {(absPath: string) => void} onSelect
   */
  _openFilePicker(mode, onSelect) {
    const fs = this.os.fs;
    if (!fs) return;

    // If already open, close and restore editor first
    this._closePicker();
    this.pickerBag.dispose();

    this.pickerMode = mode;
    this.pickerCallback = onSelect;
    this.pickerCwd = this.pickerCwd || this.cwd || "/";

    // Show current path
    const pathBar = UI.el("div", {
      className: "fp-path",
      text: this.pickerCwd,
    });

    // ---- Build picker UI ----
    const dialog = UI.el("div", { className: "fp-dialog" });

    const title = UI.el("div", {
      className: "fp-title",
      text: mode === "open"
        ? t("app.texteditor.picker.title.open")
        : t("app.texteditor.picker.title.save"),
    });

    /** @type {HTMLInputElement|null} */
    let nameInput = null;

    if (mode === "save") {
      nameInput = /** @type {HTMLInputElement} */ (UI.el("input", {
        className: "input fp-name",
        attrs: {
          type: "text",
          placeholder: t("app.texteditor.picker.placeholder.filename"),
          value: this.path ? this._baseName(this.path) : "",
        },
      }));
    }

    const list = UI.el("div", { className: "fp-list" });

    /** @type {string|null} */
    let selectedFile = null;

    const doConfirm = () => {
      let filename = selectedFile;

      if (mode === "save" && nameInput) {
        filename = nameInput.value.trim();
      }

      if (!filename) return;

      const abs = fs.resolve(this.pickerCwd, filename);

      if (mode === "save" && fs.exists(abs)) {
        const ok = window.confirm(t("app.texteditor.confirm.overwrite"));
        if (!ok) return;
      }

      this._closePicker();
      onSelect(abs);
    };

    const buttons = UI.buttonRow([
      UI.button(
        mode === "open"
          ? t("app.texteditor.picker.button.open")
          : t("app.texteditor.picker.button.save"),
        () => doConfirm(),
        { primary: true }
      ),
      UI.button(t("app.texteditor.picker.button.cancel"), () => this._closePicker()),
    ]);

    const renderList = () => {
      list.replaceChildren();

      pathBar.textContent = this.pickerCwd;

      if (this.pickerCwd !== "/") {
        const up = UI.el("div", { className: "fp-item fp-dir", text: t("app.texteditor.picker.item.up") });
        this.pickerBag.on(up, "click", () => {
          this.pickerCwd = this._dirOf(this.pickerCwd);
          selectedFile = null;
          renderList();
        });
        list.appendChild(up);
      }

      /** @type {string[]} */
      let entries = [];
      try { entries = fs.readdir(this.pickerCwd); } catch { }

      for (const name of entries.sort()) {
        const abs = fs.resolve(this.pickerCwd, name);

        let isDir = false;
        try { isDir = fs.stat(abs).type === "dir"; } catch { }

        const el = UI.el("div", {
          className:
            "fp-item " +
            (isDir ? "fp-dir" : "fp-file") +
            (!isDir && selectedFile === name ? " is-selected" : ""),
          text: name,
        });

        if (isDir) {
          this.pickerBag.on(el, "click", () => {
            this.pickerCwd = abs;
            selectedFile = null;
            renderList();
          });
        } else {
          this.pickerBag.on(el, "click", () => {
            selectedFile = name;
            if (nameInput) nameInput.value = name;
            renderList();
          });
          if (mode === "open") {
            this.pickerBag.on(el, "dblclick", () => doConfirm());
          }
        }
        list.appendChild(el);
      }
    };

    dialog.appendChild(title);
    if (nameInput) dialog.appendChild(nameInput);
    dialog.appendChild(pathBar);
    dialog.appendChild(list);
    dialog.appendChild(buttons);

    // Full-screen picker container (replaces editor)
    const pickerView = UI.el("div", { className: "fp-screen", children: [dialog] });

    // Swap UI
    this.modalEl = pickerView;
    this.root.replaceChildren(pickerView);

    // Initial render + focus
    renderList();
    queueMicrotask(() => (nameInput ?? list).focus());
  }

  /**
   * @param {string} p
   * @returns {string}
   */
  _baseName(p) {
    const i = p.lastIndexOf("/");
    return i < 0 ? p : p.slice(i + 1);
  }

  _closePicker() {
    this.pickerBag.dispose();

    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
    if (this.mainView) {
      this.root.replaceChildren(this.mainView);
      queueMicrotask(() => this.ta?.focus());
    }
  }

  /**
   * @param {string} absPath
   */
  _loadFile(absPath) {
    const fs = this.os.fs;
    if (!fs || !this.ta) return;

    if (this.modified) {
      const ok = window.confirm(t("app.texteditor.confirm.discardOpen"));
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