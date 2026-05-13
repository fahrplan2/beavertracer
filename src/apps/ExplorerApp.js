//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { t } from "../i18n/index.js";
import { SimDialog } from "../lib/SimDialog.js";
import { TextEditorApp } from "./TextEditorApp.js";

const TEXT_EXTS = new Set([
  "txt", "html", "htm", "js", "ts", "mjs", "css", "json", "xml",
  "md", "csv", "log", "sh", "conf", "config", "ini", "yaml", "yml",
  "key", "pem", "crt", "cert",
]);

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "bmp",
]);

const IMAGE_MIME = /** @type {Record<string,string>} */ ({
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon",
  webp: "image/webp", bmp: "image/bmp",
});

/** @param {string} name */
function extOf(name) {
  return (name.split(".").pop() ?? "").toLowerCase();
}

/** @param {string} name */
function fileCategory(name) {
  const e = extOf(name);
  if (TEXT_EXTS.has(e)) return "text";
  if (IMAGE_EXTS.has(e)) return "image";
  return "binary";
}

/** @param {string} name @param {boolean} isDir */
function fileIcon(name, isDir) {
  if (isDir) return "fa-folder";
  const cat = fileCategory(name);
  if (cat === "text") return "fa-file-lines";
  if (cat === "image") return "fa-file-image";
  return "fa-file";
}

/** @type {Record<string,string>} */
const MIME_MAP = {
  html: "text/html", htm: "text/html",
  css: "text/css",
  js: "text/javascript", mjs: "text/javascript", ts: "text/javascript",
  json: "application/json",
  xml: "application/xml",
  svg: "image/svg+xml",
  txt: "text/plain", log: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  sh: "text/x-shellscript",
  conf: "text/plain", config: "text/plain", ini: "text/plain",
  yaml: "text/yaml", yml: "text/yaml",
  key: "application/x-pem-file", pem: "application/x-pem-file",
  crt: "application/x-x509-ca-cert", cert: "application/x-x509-ca-cert",
  png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon",
  pdf: "application/pdf",
  zip: "application/zip", gz: "application/gzip", tar: "application/x-tar",
};

/** @param {string} name */
function mimeOf(name) {
  return MIME_MAP[extOf(name)] ?? "application/octet-stream";
}

/** @param {number} bytes */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/** @param {string} p */
function dirOf(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

export class ExplorerApp extends GenericProcess {
  get title() { return t("app.explorer.title"); }
  icon = "fa-folder-open";

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {string} */
  cwd = "/home";

  /** @type {string|null} */
  selected = null;

  /** @type {HTMLElement|null} */
  listEl = null;

  /** @type {HTMLElement|null} */
  breadcrumbEl = null;

  /** @type {HTMLElement|null} */
  previewEl = null;

  /** @type {HTMLElement|null} */
  statusEl = null;

  /** @type {HTMLButtonElement|null} */
  btnDownload = null;

  /** @type {HTMLButtonElement|null} */
  btnEditor = null;

  /** @type {HTMLButtonElement|null} */
  btnDelete = null;

  /** @type {HTMLInputElement|null} */
  fileInput = null;

  run() {
    this.root.classList.add("app", "app-explorer");
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    const fileInput = /** @type {HTMLInputElement} */ (UI.el("input", {
      attrs: { type: "file", multiple: "true", style: "display:none" },
    }));
    this.fileInput = fileInput;
    this.disposer.on(fileInput, "change", () => this._onUpload());

    const btnUpload   = UI.button(t("app.explorer.button.upload"),    () => fileInput.click(),    { icon: "fa-upload" });
    const btnFolder   = UI.button(t("app.explorer.button.newFolder"), () => this._newFolder(),   { icon: "fa-folder-plus" });
    const btnDownload = /** @type {HTMLButtonElement} */ (UI.button(t("app.explorer.button.download"),  () => this._download(),   { icon: "fa-download" }));
    const btnEditor   = /** @type {HTMLButtonElement} */ (UI.button(t("app.explorer.button.openEditor"), () => this._openEditor(), { icon: "fa-file-pen" }));
    const btnDelete   = /** @type {HTMLButtonElement} */ (UI.button(t("app.explorer.button.delete"),    () => this._delete(),     { icon: "fa-trash" }));

    this.btnDownload = btnDownload;
    this.btnEditor   = btnEditor;
    this.btnDelete   = btnDelete;

    const toolbar = UI.buttonRow([btnUpload, btnFolder, btnDownload, btnEditor, btnDelete]);

    const breadcrumb = UI.el("div", { className: "explorer-breadcrumb" });
    this.breadcrumbEl = breadcrumb;

    const listEl = UI.el("div", { className: "explorer-list" });
    this.listEl = listEl;

    const previewEl = UI.el("div", { className: "explorer-preview" });
    this.previewEl = previewEl;

    const statusEl = UI.el("div", { className: "explorer-status" });
    this.statusEl = statusEl;

    const panel = UI.panel([toolbar, breadcrumb, listEl, previewEl, statusEl, fileInput]);
    root.replaceChildren(panel);

    this._render();
  }

  onUnmount() {
    this.disposer.dispose();
    this.listEl = null;
    this.breadcrumbEl = null;
    this.previewEl = null;
    this.statusEl = null;
    this.fileInput = null;
    this.btnDownload = null;
    this.btnEditor = null;
    this.btnDelete = null;
    super.onUnmount();
  }

  _render() {
    this._renderBreadcrumb();
    this._renderList();
    this._renderPreview();
    this._updateButtons();
  }

  _updateButtons() {
    const hasFile = this.selected !== null && (() => {
      try { return this.os.fs.stat(this.selected).type === "file"; } catch { return false; }
    })();
    const hasAny = this.selected !== null;
    const isText = hasFile && (() => {
      const name = (this.selected ?? "").split("/").pop() ?? "";
      return fileCategory(name) === "text";
    })();

    if (this.btnDownload) this.btnDownload.disabled = !hasFile;
    if (this.btnEditor)   this.btnEditor.disabled   = !isText;
    if (this.btnDelete)   this.btnDelete.disabled   = !hasAny;
  }

  _renderBreadcrumb() {
    if (!this.breadcrumbEl) return;

    const parts = this.cwd === "/" ? [] : this.cwd.split("/").filter(Boolean);
    const crumbs = [{ label: "/", path: "/" }];
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      crumbs.push({ label: p, path: acc });
    }

    const nodes = [];
    for (let i = 0; i < crumbs.length; i++) {
      const { label, path } = crumbs[i];
      const isLast = i === crumbs.length - 1;
      const el = UI.el("span", {
        className: "explorer-crumb" + (isLast ? " explorer-crumb-current" : ""),
        text: label,
      });
      if (!isLast) {
        el.addEventListener("click", () => {
          this.cwd = path;
          this.selected = null;
          this._render();
        });
      }
      nodes.push(el);
      if (!isLast) nodes.push(UI.el("span", { className: "explorer-crumb-sep", text: " › " }));
    }
    this.breadcrumbEl.replaceChildren(...nodes);
  }

  _renderList() {
    if (!this.listEl) return;
    const fs = this.os.fs;

    let names;
    try { names = fs.readdir(this.cwd); }
    catch {
      this.listEl.replaceChildren(UI.el("div", { className: "explorer-empty", text: t("app.explorer.label.empty") }));
      return;
    }

    // ".." entry to go up
    const upRow = this.cwd !== "/" ? (() => {
      const row = UI.el("div", {
        className: "explorer-item",
        children: [
          UI.el("span", { className: "explorer-item-icon", children: [
            UI.el("i", { className: "fa-solid fa-folder" }),
          ]}),
          UI.el("span", { className: "explorer-item-name", text: ".." }),
          UI.el("span", { className: "explorer-item-size" }),
          UI.el("span", { className: "explorer-item-date" }),
        ],
      });
      row.addEventListener("click", () => {
        this.cwd = dirOf(this.cwd);
        this.selected = null;
        this._render();
      });
      row.addEventListener("dblclick", () => {
        this.cwd = dirOf(this.cwd);
        this.selected = null;
        this._render();
      });
      return row;
    })() : null;

    if (!names.length) {
      this.listEl.replaceChildren(
        ...(upRow ? [upRow] : []),
        UI.el("div", { className: "explorer-empty", text: t("app.explorer.label.empty") }),
      );
      return;
    }

    // Directories first
    const abs = (n) => this.cwd === "/" ? "/" + n : this.cwd + "/" + n;
    const withStat = names.map(n => {
      try { return { name: n, stat: fs.stat(abs(n)) }; }
      catch { return { name: n, stat: null }; }
    });
    withStat.sort((a, b) => {
      const da = a.stat?.type === "dir" ? 0 : 1;
      const db = b.stat?.type === "dir" ? 0 : 1;
      return da - db || a.name.localeCompare(b.name);
    });

    const rows = withStat.map(({ name, stat }) => {
      const absPath = abs(name);
      const isDir = stat?.type === "dir";

      const row = UI.el("div", {
        className: "explorer-item" + (this.selected === absPath ? " selected" : ""),
        children: [
          UI.el("span", { className: "explorer-item-icon", children: [
            UI.el("i", { className: "fa-solid " + fileIcon(name, isDir ?? false) }),
          ]}),
          UI.el("span", { className: "explorer-item-name", text: name }),
          UI.el("span", { className: "explorer-item-type", text: isDir ? "" : mimeOf(name) }),
          UI.el("span", { className: "explorer-item-size", text: (!isDir && stat) ? formatSize(stat.size) : "" }),
          UI.el("span", { className: "explorer-item-date", text: stat ? new Date(stat.mtime).toLocaleString() : "" }),
        ],
      });

      row.addEventListener("click", () => {
        this.selected = absPath;
        if (this.listEl) {
          for (const el of this.listEl.querySelectorAll(".explorer-item.selected")) {
            el.classList.remove("selected");
          }
          row.classList.add("selected");
        }
        this._renderPreview();
        this._updateButtons();
      });

      row.addEventListener("dblclick", () => {
        if (isDir) {
          this.cwd = absPath;
          this.selected = null;
          this._render();
        } else if (fileCategory(name) === "text") {
          this._openEditor();
        }
      });

      return row;
    });

    this.listEl.replaceChildren(...(upRow ? [upRow] : []), ...rows);
  }

  _renderPreview() {
    if (!this.previewEl) return;
    if (!this.selected) { this.previewEl.replaceChildren(); return; }

    const fs = this.os.fs;
    try {
      const stat = fs.stat(this.selected);
      if (stat.type !== "file") { this.previewEl.replaceChildren(); return; }

      const name = (this.selected.split("/").pop() ?? "");
      if (fileCategory(name) !== "image") { this.previewEl.replaceChildren(); return; }

      const bytes = fs.readBinaryFile(this.selected);
      const CHUNK = 8192;
      let bin = "";
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
      }
      const b64 = btoa(bin);
      const mime = IMAGE_MIME[extOf(name)] ?? "image/*";
      const img = UI.el("img", {
        className: "explorer-preview-img",
        attrs: { src: `data:${mime};base64,${b64}`, alt: name },
      });
      this.previewEl.replaceChildren(img);
    } catch {
      this.previewEl.replaceChildren();
    }
  }

  async _newFolder() {
    const name = await SimDialog.prompt(t("app.explorer.prompt.newFolder"), "");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const abs = this.cwd === "/" ? "/" + trimmed : this.cwd + "/" + trimmed;
    try {
      this.os.fs.mkdir(abs);
      this._renderList();
    } catch (e) {
      await SimDialog.alert(t("app.explorer.error.mkdir", { msg: String(/** @type {any} */(e)?.message ?? e) }));
    }
  }

  async _delete() {
    if (!this.selected) return;
    const name = this.selected.split("/").pop() ?? this.selected;
    const ok = await SimDialog.confirm(t("app.explorer.confirm.delete", { name }));
    if (!ok) return;
    try {
      const stat = this.os.fs.stat(this.selected);
      if (stat.type === "dir") {
        this.os.fs.rmdir(this.selected, { recursive: true });
      } else {
        this.os.fs.unlink(this.selected);
      }
      this.selected = null;
      this._render();
    } catch (e) {
      await SimDialog.alert(t("app.explorer.error.delete", { msg: String(/** @type {any} */(e)?.message ?? e) }));
    }
  }

  _download() {
    if (!this.selected) return;
    const fs = this.os.fs;
    try {
      const stat = fs.stat(this.selected);
      if (stat.type !== "file") return;

      const name = this.selected.split("/").pop() ?? "file";
      const bytes = fs.readBinaryFile(this.selected);
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (this.statusEl) this.statusEl.textContent = String(/** @type {any} */(e)?.message ?? e);
    }
  }

  _openEditor() {
    if (!this.selected) return;
    try {
      const stat = this.os.fs.stat(this.selected);
      if (stat.type !== "file") return;
      const name = (this.selected.split("/").pop() ?? "");
      if (fileCategory(name) !== "text") return;

      const app = /** @type {TextEditorApp|undefined} */ (
        this.os.runningApps.find(a => a instanceof TextEditorApp)
      );
      if (app) {
        app.init({ path: this.selected, cwd: dirOf(this.selected) });
        this.os.focus(app.pid);
      }
    } catch { /* ignore */ }
  }

  async _onUpload() {
    const input = this.fileInput;
    if (!input?.files?.length) return;

    const files = Array.from(input.files);
    input.value = "";

    for (const file of files) {
      try {
        const abs = this.cwd === "/" ? "/" + file.name : this.cwd + "/" + file.name;
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);

        if (fileCategory(file.name) === "text" || file.type.startsWith("text/")) {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          this.os.fs.writeFile(abs, text);
        } else {
          this.os.fs.writeBinaryFile(abs, bytes);
        }

        if (this.statusEl) this.statusEl.textContent = t("app.explorer.status.uploaded", { name: file.name });
      } catch (e) {
        await SimDialog.alert(t("app.explorer.error.upload", { msg: String(/** @type {any} */(e)?.message ?? e) }));
      }
    }

    this._renderList();
  }
}
