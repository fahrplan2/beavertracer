//@ts-check
import { t } from "../i18n/index.js";
import { GenericProcess } from "./GenericProcess.js";

export class AboutApp extends GenericProcess {
  /** @type {number|null} */
  timer = null;

  /** @type {HTMLPreElement|null} */
  infoEl = null;

  /** @type {HTMLInputElement|null} */
  nameInput = null;

  get title() {
    return t("app.about.title");
  }

  run() {
    this.root.classList.add("app-about");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);

    this.root.replaceChildren();

    // Heading
    const h = document.createElement("h3");
    h.textContent = t("app.about.heading.systemInfo");

    // --- PC Name Editor ---
    const nameRow = document.createElement("div");
    nameRow.style.display = "flex";
    nameRow.style.gap = "6px";
    nameRow.style.alignItems = "center";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = this.os.name;
    nameInput.placeholder = t("app.about.placeholder.pcName");
    this.nameInput = nameInput;

    const renameBtn = document.createElement("button");
    renameBtn.textContent = t("app.about.button.rename");
    renameBtn.onclick = () => {
      const v = nameInput.value.trim();
      if (v) {
        this.os.setName(v);
        nameInput.value = this.os.name; // falls setName normalisiert
      }
    };

    nameRow.append(nameInput, renameBtn);

    // --- System Info ---
    const pre = document.createElement("pre");
    this.infoEl = pre;

    this.root.append(h, nameRow, pre);

    this._tick();
  }

  _tick() {
    if (!this.infoEl) return;

    this.infoEl.textContent = t("app.about.body.systemInfo", {
      os: this.os.name,
      pid: this.pid,
      runningApps: this.os.runningApps.length,
      focusID: this.os.focusID,
      time: new Date().toLocaleTimeString(),
    });

    this.timer = window.setTimeout(() => this._tick(), 500);
  }

  onUnmount() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    super.onUnmount();
  }
}
