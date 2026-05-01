//@ts-check
import { t } from "../i18n/index.js";
import { UILib as UI } from "./lib/UILib.js";
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

  icon="fa-circle-question";

  run() {
    this.root.classList.add("app-about");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);

    const nameInput = UI.input({
      value: this.os.name,
      placeholder: t("app.about.placeholder.pcName"),
    });
    this.nameInput = nameInput;

    const renameBtn = UI.button(t("app.about.button.rename"), () => {
      const v = nameInput.value.trim();
      if (v) {
        this.os.setName(v);
        nameInput.value = this.os.name;
      }
    }, { primary: true });

    const infoEl = UI.el("pre", {});
    this.infoEl = infoEl;

    const panel = UI.panel([
      UI.el("h4", { text: t("app.about.heading.systemInfo") }),
      UI.row(t("app.about.placeholder.pcName"), nameInput),
      UI.buttonRow([renameBtn]),
      infoEl,
    ]);

    this.root.replaceChildren(panel);
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
