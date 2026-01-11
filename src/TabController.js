//@ts-check

/**
 * Simple tab controller with optional activation hook.
 * - Always queries contents fresh (supports dynamically mounted tabs)
 * - Scopes operations to a given root container (won't touch other page tabs)
 */
export class TabController {
  /** @type {HTMLElement} */
  #root;

  /** @type {string} */
  #contentSelector;

  /** @type {(id: string) => void | Promise<void>} */
  #onTabActivated;

  /**
   * @param {HTMLElement} root Container that holds all .tab-content nodes
   * @param {{
   *   contentSelector?: string,
   *   onTabActivated?: (id: string) => void | Promise<void>
   * }} [opts]
   */
  constructor(root, opts = {}) {
    if (!root) throw new Error("TabController: root is required");

    const {
      contentSelector = ".tab-content",
      onTabActivated = () => {},
    } = opts;

    this.#root = root;
    this.#contentSelector = contentSelector;
    this.#onTabActivated = onTabActivated;
  }

  /** @returns {NodeListOf<HTMLElement>} */
  #getContents() {
    return this.#root.querySelectorAll(this.#contentSelector);
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

    // IMPORTANT: scope lookup to the same root too
    const content = /** @type {HTMLElement|null} */ (this.#root.querySelector(`#${CSS.escape(targetId)}`));
    if (!content) return false;

    // deactivate all (fresh list each call)
    this.#getContents().forEach(c => c.classList.remove("active"));

    // activate target
    content.classList.add("active");

    // notify hook
    await this.#onTabActivated(targetId);

    return true;
  }
}
