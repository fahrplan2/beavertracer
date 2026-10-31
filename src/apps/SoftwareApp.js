//@ts-check

import { t } from "../i18n/index.js";
import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { SimDialog } from "../lib/SimDialog.js";

/**
 * "Software" app — installs and uninstalls the optional apps of this host.
 * Lists every non-mandatory app from the OS registry, grouped by category;
 * installed apps can be opened or uninstalled right from the list.
 */
export class SoftwareApp extends GenericProcess {
  get title() {
    return t("app.software.title");
  }

  icon = "fa-box-open";

  /** @type {number} scroll offset carried across the OS re-render that (un)installing triggers */
  _scrollTop = 0;

  run() {
    this.root.classList.add("app", "app-software");
  }

  /** @param {HTMLElement} root */
  onMount(root) {
    super.onMount(root);

    const categories = [
      { key: "system", label: t("os.apps.category.system") },
      { key: "client", label: t("os.apps.category.client") },
      { key: "server", label: t("os.apps.category.server") },
    ];

    const catalog = this.os.getAppCatalog();
    const sections = [];

    for (const cat of categories) {
      const entries = catalog.filter(e => e.category === cat.key);
      if (entries.length === 0) continue;

      const rows = entries.map(entry => {
        const name = t(entry.labelKey);
        const actions = entry.pid !== null
          ? [
              UI.button(t("app.software.open"), () => this.os.focus(/** @type {number} */ (entry.pid)), { primary: true }),
              UI.button(t("app.software.uninstall"), () => void this._uninstall(entry.id, name), { icon: "fa-trash-can" }),
            ]
          : [UI.button(t("app.software.install"), () => this._keepScroll(() => this.os.installApp(entry.id)), { icon: "fa-download" })];

        return UI.div("software-row" + (entry.pid !== null ? " is-installed" : ""), [
          UI.el("div", { className: "software-icon", children: [UI.el("i", { className: `fas ${entry.icon}` })] }),
          UI.el("div", { className: "software-name", text: name }),
          UI.div("software-actions", actions),
        ]);
      });

      sections.push(UI.div("software-section", [
        UI.el("div", { className: "software-heading", text: cat.label }),
        ...rows,
      ]));
    }

    this.root.replaceChildren(UI.panel(sections));
    const scroller = this._scroller();
    if (scroller) scroller.scrollTop = this._scrollTop;
    this._scrollTop = 0;
  }

  /** @returns {HTMLElement|null} the OS frame element that scrolls this app */
  _scroller() {
    return /** @type {HTMLElement|null} */ (this.root.closest(".os-frame-content"));
  }

  /**
   * Installing/uninstalling makes the OS rebuild its frame, which resets the
   * scroll position — remember it so the list doesn't jump back to the top.
   * @param {() => void} fn
   */
  _keepScroll(fn) {
    this._scrollTop = this._scroller()?.scrollTop ?? 0;
    fn();
  }

  /**
   * @param {string} appId
   * @param {string} name
   */
  async _uninstall(appId, name) {
    const ok = await SimDialog.confirm(t("app.software.confirmUninstall", { name }));
    if (ok) this._keepScroll(() => this.os.uninstallApp(appId));
  }
}
