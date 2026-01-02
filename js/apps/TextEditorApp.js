//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { CleanupBag } from "./lib/CleanupBag.js";

export class TextEditorApp extends GenericProcess {
  /** @type {CleanupBag} */
  bag = new CleanupBag();

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
    this.title = "Editor";
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
      this.root.replaceChildren(UI.panel("Editor", [
        UI.el("div", { className: "text", text: "No filesystem available." }),
      ]));
      return;
    }

    const abs = fs.resolve(this.cwd, this.path);
    this.path = abs;
    this.pickerCwd = this._dirOf(this.path);

    // Load (or create empty if missing)
    let data = "";
    if (fs.exists(abs)) {
      try { data = fs.readFile(abs); }
      catch (e) { data = ""; }
    } else {
      data = "";
    }

    this.original = "";
    this.modified = false;

    const status = UI.el("div", { className: "editor-status" });
    this.statusEl = status;

    const ta = /** @type {HTMLTextAreaElement} */ (UI.el("textarea", {
      className: "editor-area input",
      attrs: { spellcheck: "false", wrap: "off" },
      init: (el) => { el.value = data; },
    }));
    this.ta = ta;

    ta.value = "";
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

    const header = UI.el("div", {
      className: "editor-header",
      children: [
        UI.el("div", { className: "editor-title", text: "Text Editor" }),
        status,
      ],
    });

    const actions = UI.buttonRow([
      UI.button("New", () => this._newFile()),
      UI.button("Open...", () => this._openPicker()),
      UI.button("Save", () => this._save(), { primary: true }),
      UI.button("Save As..", () => this._saveAs()),
    ]);

    const panel = UI.panel("Editor", [
      header,
      ta,
      actions,
    ]);

    this.root.replaceChildren(panel);
    this._renderStatus();

    queueMicrotask(() => ta.focus());
  }

  onUnmount() {
    this.bag.dispose();
    this.ta = null;
    this.statusEl = null;
    super.onUnmount();
  }

  _renderStatus() {
    if (!this.statusEl) return;

    let name = "(new file)";
    if (this.path == "") {
      name = this.path;
    }
    const mod = this.modified ? "● modified" : "";
    this.statusEl.textContent = `${name} ${mod}`;
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
      if (this.statusEl) this.statusEl.textContent = `${absPath} — save failed`;
      return false;
    }
  }

  /**
   * 
   * @param {string} p 
   * @returns 
   */
  _dirOf(p) {
    const i = p.lastIndexOf("/");
    return i <= 0 ? "/" : p.slice(0, i);
  }

  /**
   * 
   * @param {string} dir 
   * @param {string} name 
   * @returns 
   */

  _join(dir, name) {
    if (dir === "/") return "/" + name;
    return dir.replace(/\/+$/, "") + "/" + name;
  }

  _newFile() {
    if (!this.ta) return;

    if (this.modified) {
      const ok = window.confirm("You have unsaved changes. Discard and create a new file?");
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

    this._closePicker();

    this.pickerMode = mode;
    this.pickerCallback = onSelect;

    this.pickerCwd = this.pickerCwd || this.cwd || "/";

    const overlay = UI.el("div", { className: "fp-overlay" });
    const dialog = UI.el("div", { className: "fp-dialog" });

    const title = UI.el("div", {
      className: "fp-title",
      text: mode === "open" ? "Open file" : "Save file as",
    });

    /** @type {HTMLInputElement|null} */
    let nameInput = null;

    if (mode === "save") {
      nameInput = /** @type {HTMLInputElement} */ (UI.el("input", {
        className: "input fp-name",
        attrs: {
          type: "text",
          placeholder: "filename.txt",
          value: this.path ? this._baseName(this.path) : "",
        },
      }));
    }

    const list = UI.el("div", { className: "fp-list" });

    /** @type {string|null} */
    let selectedFile = null;

    const render = () => {
      list.replaceChildren();

      if (this.pickerCwd !== "/") {
        const up = UI.el("div", { className: "fp-item fp-dir", text: ".." });
        this.bag.on(up, "click", () => {
          this.pickerCwd = this._dirOf(this.pickerCwd);
          selectedFile = null;
          render();
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
          className: "fp-item " + (isDir ? "fp-dir" : "fp-file"),
          text: name,
        });

        if (!isDir && selectedFile === name) el.classList.add("is-selected");

        if (isDir) {
          this.bag.on(el, "click", () => {
            this.pickerCwd = abs;
            selectedFile = null;
            render();
          });
        } else {
          this.bag.on(el, "click", () => {
            selectedFile = name;
            if (nameInput) nameInput.value = name;
            render();
          });
          if (mode === "open") {
            this.bag.on(el, "dblclick", () => doConfirm());
          }
        }

        list.appendChild(el);
      }
    };

    const doConfirm = () => {
      let filename = selectedFile;

      if (mode === "save" && nameInput) {
        filename = nameInput.value.trim();
      }

      if (!filename) return;

      const abs = fs.resolve(this.pickerCwd, filename);

      if (mode === "save" && fs.exists(abs)) {
        const ok = window.confirm("Overwrite existing file?");
        if (!ok) return;
      }

      this._closePicker();
      onSelect(abs);
    };

    const buttons = UI.buttonRow([
      UI.button(mode === "open" ? "Open" : "Save", () => doConfirm(), { primary: true }),
      UI.button("Cancel", () => this._closePicker()),
    ]);

    dialog.appendChild(title);
    if (nameInput) dialog.appendChild(nameInput);
    dialog.appendChild(list);
    dialog.appendChild(buttons);

    overlay.appendChild(dialog);
    this.root.appendChild(overlay);

    this.modalEl = overlay;
    render();

    queueMicrotask(() => (nameInput ?? list).focus());
  }

  /**
   * 
   * @param {string} p 
   * @returns 
   */

  _baseName(p) {
    const i = p.lastIndexOf("/");
    return i < 0 ? p : p.slice(i + 1);
  }

  _closePicker() {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  /**
   * 
   * @param {string} absPath 
   * @returns 
   */

  _loadFile(absPath) {
    const fs = this.os.fs;
    if (!fs || !this.ta) return;

    if (this.modified) {
      const ok = window.confirm("You have unsaved changes. Discard and open another file?");
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