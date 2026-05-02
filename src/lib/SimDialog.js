//@ts-check
import { t } from "../i18n/index.js";

export class SimDialog {
  /**
   * @param {"alert"|"confirm"|"prompt"} type
   * @param {string} message
   * @param {string} [defaultValue]
   * @returns {Promise<any>}
   */
  static #show(type, message, defaultValue = "") {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "sim-dialog-backdrop";

      const box = document.createElement("div");
      box.className = "sim-dialog";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");

      const msg = document.createElement("p");
      msg.className = "sim-dialog-msg";
      msg.textContent = message;
      box.appendChild(msg);

      /** @type {HTMLInputElement|null} */
      let input = null;
      if (type === "prompt") {
        input = document.createElement("input");
        input.type = "text";
        input.className = "sim-dialog-input";
        input.value = defaultValue;
        box.appendChild(input);
      }

      const actions = document.createElement("div");
      actions.className = "sim-dialog-actions";

      /** @type {HTMLButtonElement|null} */
      let cancelBtn = null;
      if (type !== "alert") {
        cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "sim-dialog-btn sim-dialog-cancel";
        cancelBtn.textContent = t("ui.cancel");
        actions.appendChild(cancelBtn);
      }

      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "sim-dialog-btn sim-dialog-ok";
      okBtn.textContent = t("ui.ok");
      actions.appendChild(okBtn);

      box.appendChild(actions);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);

      if (type === "prompt" && input) {
        input.focus();
        input.select();
      } else {
        okBtn.focus();
      }

      /** @param {unknown} value */
      const done = (value) => {
        backdrop.remove();
        resolve(value);
      };

      okBtn.addEventListener("click", () => {
        if (type === "prompt") done(input?.value ?? "");
        else if (type === "confirm") done(true);
        else done(undefined);
      });

      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
          done(type === "confirm" ? false : null);
        });
      }

      if (type !== "alert") {
        backdrop.addEventListener("click", (ev) => {
          if (ev.target === backdrop) done(type === "confirm" ? false : null);
        });
      }

      backdrop.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          if (document.activeElement === cancelBtn) {
            done(type === "confirm" ? false : null);
          } else {
            if (type === "prompt") done(input?.value ?? "");
            else if (type === "confirm") done(true);
            else done(undefined);
          }
        } else if (ev.key === "Escape" && type !== "alert") {
          ev.preventDefault();
          done(type === "confirm" ? false : null);
        }
      });
    });
  }

  /** @param {string} message @returns {Promise<void>} */
  static alert(message) {
    return SimDialog.#show("alert", message);
  }

  /** @param {string} message @returns {Promise<boolean>} */
  static confirm(message) {
    return SimDialog.#show("confirm", message);
  }

  /**
   * @param {string} message
   * @param {string} [defaultValue]
   * @returns {Promise<string|null>}
   */
  static prompt(message, defaultValue = "") {
    return SimDialog.#show("prompt", message, defaultValue);
  }
}
