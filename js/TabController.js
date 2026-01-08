//@ts-check

/**
 * Simple tab controller with optional activation hook.
 */
export class TabController {
  /** @type {NodeListOf<HTMLElement>} */
  #contents;

  /** @type {(id: string) => void | Promise<void>} */
  #onTabActivated;

  /**
   * @param {{
   *   contentSelector?: string,
   *   onTabActivated?: (id: string) => void | Promise<void>
   * }} [opts]
   */
  constructor(opts = {}) {
    const {
      contentSelector = ".tab-content",
      onTabActivated = () => {},
    } = opts;

    this.#contents = document.querySelectorAll(contentSelector);
    this.#onTabActivated = onTabActivated;
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

    const content = document.getElementById(targetId);

    if (!content) return false;

    // deactivate all
    this.#contents.forEach(c => c.classList.remove("active"));

    // activate target
    content.classList.add("active");

    // notify hook
    await this.#onTabActivated(targetId);

    return true;
  }

}
