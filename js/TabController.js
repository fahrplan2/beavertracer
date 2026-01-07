//@ts-check

/**
 * Simple tab controller with optional activation hook.
 */
export class TabController {
  /** @type {NodeListOf<HTMLButtonElement>} */
  #tabs;

  /** @type {NodeListOf<HTMLElement>} */
  #contents;

  /** @type {(id: string) => void | Promise<void>} */
  #onTabActivated;

  /**
   * @param {{
   *   tabSelector?: string,
   *   contentSelector?: string,
   *   onTabActivated?: (id: string) => void | Promise<void>
   * }} [opts]
   */
  constructor(opts = {}) {
    const {
      tabSelector = ".tab",
      contentSelector = ".tab-content",
      onTabActivated = () => {},
    } = opts;

    this.#tabs = document.querySelectorAll(tabSelector);
    this.#contents = document.querySelectorAll(contentSelector);
    this.#onTabActivated = onTabActivated;

    this.#registerListeners();
  }

  #registerListeners() {
    this.#tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        void this.gotoTab(tab.dataset.target);
      });
    });
  }

  /**
   * Switches to a tab if it exists.
   * Safe for async onTabActivated logic.
   *
   * @param {string | undefined | null} targetId
   * @returns {Promise<boolean>}
   */
  async gotoTab(targetId) {
    if (!targetId) return false;

    const tab = Array.from(this.#tabs)
      .find(t => t.dataset.target === targetId);
    const content = document.getElementById(targetId);

    if (!tab || !content) return false;

    // deactivate all
    this.#tabs.forEach(t => t.classList.remove("active"));
    this.#contents.forEach(c => c.classList.remove("active"));

    // activate target
    tab.classList.add("active");
    content.classList.add("active");

    // notify hook
    await this.#onTabActivated(targetId);

    return true;
  }

  /**
   * Currently active tab id or null.
   */
  get activeTab() {
    return (
      Array.from(this.#tabs)
        .find(t => t.classList.contains("active"))
        ?.dataset.target ?? null
    );
  }
}
