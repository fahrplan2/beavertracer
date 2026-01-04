
export class TabController {
    /** @type {NodeListOf<HTMLButtonElement>} */
    #tabs;

    /** @type {NodeListOf<HTMLElement>} */
    #contents;

    constructor(
        tabSelector = ".tab",
        contentSelector = ".tab-content"
    ) {
        this.#tabs = document.querySelectorAll(tabSelector);
        this.#contents = document.querySelectorAll(contentSelector);

        this.#registerListeners();
    }

    #registerListeners() {
        this.#tabs.forEach(tab => {
            tab.addEventListener("click", () => {
                this.gotoTab(tab.dataset.target);
            });
        });
    }

    /**
     * switches to a tab (if it exists)
     * @param {string | undefined | null} targetId
     * @returns {boolean} 
     */
    gotoTab(targetId) {
        if (!targetId) return false;

        const tab = Array.from(this.#tabs)
            .find(t => t.dataset.target === targetId);
        const content = document.getElementById(targetId);

        if (!tab || !content) return false;

        this.#tabs.forEach(t => t.classList.remove("active"));
        this.#contents.forEach(c => c.classList.remove("active"));

        tab.classList.add("active");
        content.classList.add("active");

        return true;
    }

    /**
     * Optional: get active tab
     */
    get activeTab() {
        return Array.from(this.#tabs)
            .find(t => t.classList.contains("active"))
            ?.dataset.target ?? null;
    }
}
