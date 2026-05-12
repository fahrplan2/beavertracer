//@ts-check

import { UILib as UI } from "./UILib.js";
import { Disposer } from "../../lib/Disposer.js";
import { SimDialog } from "../../lib/SimDialog.js";
import { t } from "../../i18n/index.js";

/**
 * Reusable filesystem file-picker for OS apps.
 *
 * Usage:
 *   const abs = await OsFilePicker.open({ fs, container, mode: "open", cwd: "/home" });
 *   if (abs) { ... }
 */
export class OsFilePicker {
  /**
   * @param {{
   *   fs: any,
   *   container: HTMLElement,
   *   mode: "open"|"save",
   *   cwd?: string,
   *   filename?: string,
   *   title?: string,
   * }} opts
   * @returns {Promise<string|null>} resolved absolute path, or null if cancelled
   */
  static open({ fs, container, mode, cwd = "/", filename = "", title }) {
    return new Promise((resolve) => {
      const saved = Array.from(container.childNodes);
      const bag = new Disposer();

      const close = (/** @type {string|null} */ result) => {
        bag.dispose();
        container.replaceChildren(...saved);
        resolve(result);
      };

      let pickerCwd = cwd;
      /** @type {string|null} */
      let selectedFile = null;

      // helpers
      const dirOf = (/** @type {string} */ p) => {
        const i = p.lastIndexOf("/");
        return i <= 0 ? "/" : p.slice(0, i);
      };
      const join = (/** @type {string} */ dir, /** @type {string} */ name) =>
        dir === "/" ? "/" + name : dir.replace(/\/+$/, "") + "/" + name;
      const baseName = (/** @type {string} */ p) => {
        const i = p.lastIndexOf("/");
        return i < 0 ? p : p.slice(i + 1);
      };

      // Title
      const titleEl = UI.el("div", {
        className: "fp-title",
        text: title ?? (mode === "open"
          ? t("app.texteditor.picker.title.open")
          : t("app.texteditor.picker.title.save")),
      });

      // Current path indicator
      const pathBar = UI.el("div", { className: "fp-path", text: pickerCwd });

      // Optional filename input for save mode
      /** @type {HTMLInputElement|null} */
      let nameInput = null;
      if (mode === "save") {
        nameInput = /** @type {HTMLInputElement} */ (UI.el("input", {
          className: "input fp-name",
          attrs: {
            type: "text",
            placeholder: t("app.texteditor.picker.placeholder.filename"),
            value: filename ? baseName(filename) : "",
          },
        }));
      }

      const list = UI.el("div", { className: "fp-list" });

      const doConfirm = async () => {
        let name = selectedFile;
        if (mode === "save" && nameInput) name = nameInput.value.trim();
        if (!name) return;

        const abs = join(pickerCwd, name);

        if (mode === "save" && fs.exists?.(abs)) {
          const ok = await SimDialog.confirm(t("app.texteditor.confirm.overwrite"));
          if (!ok) return;
        }

        close(abs);
      };

      const renderList = () => {
        list.replaceChildren();
        pathBar.textContent = pickerCwd;

        if (pickerCwd !== "/") {
          const up = UI.el("div", { className: "fp-item fp-dir", text: t("app.texteditor.picker.item.up") });
          bag.on(up, "click", () => {
            pickerCwd = dirOf(pickerCwd);
            selectedFile = null;
            renderList();
          });
          list.appendChild(up);
        }

        /** @type {string[]} */
        let entries = [];
        try { entries = fs.readdir(pickerCwd); } catch { }

        for (const entry of entries.sort()) {
          const abs = join(pickerCwd, entry);
          let isDir = false;
          try { isDir = fs.stat(abs).type === "dir"; } catch { }

          const el = UI.el("div", {
            className: "fp-item " + (isDir ? "fp-dir" : "fp-file") +
              (!isDir && selectedFile === entry ? " is-selected" : ""),
            text: entry,
          });

          if (isDir) {
            bag.on(el, "click", () => {
              pickerCwd = abs;
              selectedFile = null;
              renderList();
            });
          } else {
            bag.on(el, "click", () => {
              selectedFile = entry;
              if (nameInput) nameInput.value = entry;
              renderList();
            });
            if (mode === "open") {
              bag.on(el, "dblclick", () => doConfirm());
            }
          }
          list.appendChild(el);
        }
      };

      const buttons = UI.buttonRow([
        UI.button(
          mode === "open" ? t("app.texteditor.picker.button.open") : t("app.texteditor.picker.button.save"),
          () => doConfirm(),
          { primary: true }
        ),
        UI.button(t("app.texteditor.picker.button.cancel"), () => close(null)),
      ]);

      const dialog = UI.el("div", { className: "fp-dialog" });
      dialog.appendChild(titleEl);
      if (nameInput) dialog.appendChild(nameInput);
      dialog.appendChild(pathBar);
      dialog.appendChild(list);
      dialog.appendChild(buttons);

      const screen = UI.el("div", { className: "fp-screen", children: [dialog] });
      container.replaceChildren(screen);

      renderList();
      queueMicrotask(() => (nameInput ?? list).focus());
    });
  }
}
