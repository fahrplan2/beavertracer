//@ts-check
import { t } from "../i18n/index.js";
import { GenericProcess } from "./GenericProcess.js";

export class AboutApp extends GenericProcess {
  /** @type {number|null} */
  timer = null;


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
    this._tick();
  }

  _tick() {
    this.root.replaceChildren();

    const h = document.createElement("h3");
    h.textContent = t("app.about.heading.systemInfo");

    const pre = document.createElement("pre");
    pre.textContent = t("app.about.body.systemInfo", {
      os: this.os.name,
      pid: this.pid,
      runningApps: this.os.runningApps.length,
      focusID: this.os.focusID,
      time: new Date().toLocaleTimeString(),
    });

    this.root.append(h, pre);

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
