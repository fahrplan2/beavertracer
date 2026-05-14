//@ts-check

/**
 * Small helper class to build common DOM-elements
 */
export class DOMBuilder {
    /**
     * @template {keyof HTMLElementTagNameMap} K
     * @param {K} tag
     * @param {Object} [opts]
     * @param {string} [opts.className]
     * @param {string|number} [opts.text]
     * @param {string} [opts.html]
     * @param {Record<string, string|number|boolean>} [opts.attrs]
     * @param {Partial<CSSStyleDeclaration>} [opts.style]
     * @param {(Node|null|undefined)[]} [opts.children]
     * @returns {HTMLElementTagNameMap[K]}
     */
    static el(tag, opts = {}) {
        const e = /** @type {HTMLElementTagNameMap[K]} */ (document.createElement(tag));
        if (opts.className) e.className = opts.className;
        if (opts.text != null) e.textContent = String(opts.text);
        if (opts.html != null) e.innerHTML = String(opts.html);
        if (opts.attrs) {
            for (const [k, v] of Object.entries(opts.attrs)) {
                e.setAttribute(k, String(v));
            }
        }
        if (opts.style) Object.assign(e.style, opts.style);
        if (opts.children) {
            for (const c of opts.children) {
                if (c) e.appendChild(c);
            }
        }
        return e;
    }

    /** @param {string} [className] @param {(Node|null|undefined)[]} [children] */
    static div(className = "", children = []) {
        return DOMBuilder.el("div", { className, children });
    }

    /** @param {string} text */
    static h1(text) {
        return DOMBuilder.el("h1", { text, style: { margin: "0" } });
    }

    /** @param {string} text */
    static h2(text) {
        return DOMBuilder.el("h2", { text, style: { margin: "0" } });
    }

    /** @param {string} text */
    static h3(text) {
        return DOMBuilder.el("h3", { text, style: { margin: "0" } });
    }

    /** @param {string} text */
    static h4(text) {
        return DOMBuilder.el("h4", { text, style: { margin: "0" } });
    }

    /** @param {string} text */
    static h5(text) {
        return DOMBuilder.el("h5", { text, style: { margin: "0" } });
    }

    /** @param {string} text */
    static label(text) {
        return DOMBuilder.el("label", { text });
    }

    /**
     * @param {Object} [opts]
     * @param {string} [opts.className]
     * @param {string} [opts.value]
     * @param {string} [opts.placeholder]
     * @param {boolean} [opts.disabled]
     * @param {string} [opts.type]      
     * @returns {HTMLInputElement}
     */
    static input(opts = {}) {
        const i = /** @type {HTMLInputElement} */ (
            DOMBuilder.el("input", {
                className: opts.className
            })
        );

        if (opts.type != null) i.type = opts.type;
        if (opts.value != null) i.value = String(opts.value);
        if (opts.placeholder != null) i.placeholder = String(opts.placeholder);
        if (opts.disabled != null) i.disabled = !!opts.disabled;

        return i;
    }


    /**
     * @param {string} text
     * @param {Object} [opts]
     * @param {string} [opts.className]
     * @param {string} [opts.title]
     * @param {"button"|"submit"|"reset"} [opts.type]
     * @param {boolean} [opts.disabled]
     * @returns {HTMLButtonElement}
     */
    static button(text, opts = {}) {
        const b = /** @type {HTMLButtonElement} */ (DOMBuilder.el("button", { className: opts.className, text }));
        b.type = opts.type ?? "button";
        if (opts.title) b.title = opts.title;
        if (opts.disabled != null) b.disabled = !!opts.disabled;
        return b;
    }

    /**
     * @param {Object} [opts]
     * @param {string} [opts.className]
     * @param {boolean} [opts.disabled]
     * @param {{value:string,label:string}[]} [opts.options]
     * @returns {HTMLSelectElement}
     */
    static select(opts = {}) {
        const s = /** @type {HTMLSelectElement} */ (DOMBuilder.el("select", { className: opts.className }));
        if (opts.disabled != null) s.disabled = !!opts.disabled;

        for (const o of (opts.options ?? [])) {
            s.appendChild(DOMBuilder.el("option", { text: o.label, attrs: { value: o.value } }));
        }
        return s;
    }

    /** @param {HTMLElement} el */
    static clear(el) {
        el.innerHTML = "";
    }

    /** @param {Node} child */
    static td(child) {
        return DOMBuilder.el("td", { children: [child] });
    }

    /**
      * Creates a toolbar button group with a label.
      *
      * @param {string} title - Group label text
      * @param {HTMLElement} toolbar - Parent toolbar element
      * @returns {HTMLDivElement} buttons container (append buttons here)
      */

    static buttongroup(title, toolbar) {
        const group = document.createElement("div");
        group.className = "sim-toolbar-group";

        const label = document.createElement("div");
        label.className = "sim-toolbar-group-label";
        label.textContent = title;

        const buttons = document.createElement("div");
        buttons.className = "sim-toolbar-buttons";

        group.appendChild(label);
        group.appendChild(buttons);
        toolbar.appendChild(group);

        return buttons;
    }

    /**
     * Creates a toolbar button with optional icon and active state.
     *
     * @param {Object} opts
     * @param {string} opts.label - Button text (shown as tooltip when iconOnly)
     * @param {(ev: MouseEvent) => void} opts.onClick - Click handler
     * @param {string} [opts.icon] - Optional icon classes
     * @param {string} [opts.badge] - Short protocol badge label shown over the icon
     * @param {boolean} [opts.active=false] - Whether button starts active
     * @param {string} [opts.className] - Additional CSS classes
     * @param {boolean} [opts.iconOnly=false] - Show icon only, label becomes title tooltip
     * @returns {HTMLButtonElement}
     */

    static iconbutton({
        label,
        onClick,
        icon,
        badge = "",
        active = false,
        className = "",
        iconOnly = false,
    }) {
        const btn = document.createElement("button");
        btn.type = "button";

        if (className) btn.classList.add(...className.split(" ").filter(Boolean));
        if (active) btn.classList.add("active");
        if (iconOnly) btn.classList.add("icon-only");
        btn.title = label;

        // 1) icon
        if (icon) {
            const iconEl = document.createElement("i");
            iconEl.classList.add("fas", icon);
            btn.appendChild(iconEl);
        }

        // 2) optional badge overlay on the icon tile
        if (badge) {
            const badgeEl = document.createElement("span");
            badgeEl.className = "icon-badge";
            badgeEl.textContent = badge;
            btn.appendChild(badgeEl);
        }

        // 3) text (omitted when iconOnly)
        if (!iconOnly) {
            const textEl = document.createElement("span");
            textEl.textContent = label;
            btn.appendChild(textEl);
        }

        btn.addEventListener("click", onClick);

        return btn;
    }

    /**
     * Creates a shared tab bar with underline-style active indicator.
     *
     * @typedef {{ id: string, label: string, icon?: string }} TabDef
     * @param {TabDef[]} tabs
     * @param {(id: string) => void} onChange  called when the user clicks a tab
     * @returns {{ bar: HTMLElement, setActive: (id: string) => void, setBadge: (id: string, text: string, status?: string) => void }}
     */
    static tabGroup(tabs, onChange) {
        const bar = document.createElement("div");
        bar.className = "ui-tabbar";

        /** @type {Map<string, HTMLButtonElement>} */
        const btns = new Map();

        for (const tab of tabs) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ui-tab";
            btn.dataset.tabId = tab.id;

            if (tab.icon) {
                const i = document.createElement("i");
                i.className = `fas ${tab.icon}`;
                btn.appendChild(i);
            }

            const lbl = document.createElement("span");
            lbl.textContent = tab.label;
            btn.appendChild(lbl);

            btn.addEventListener("click", () => { setActive(tab.id); onChange(tab.id); });
            btns.set(tab.id, btn);
            bar.appendChild(btn);
        }

        /** @param {string} id */
        function setActive(id) {
            for (const [btnId, btn] of btns) btn.classList.toggle("is-active", btnId === id);
        }

        /**
         * @param {string} id
         * @param {string} text
         * @param {string} [status]
         */
        function setBadge(id, text, status = "") {
            const btn = btns.get(id);
            if (!btn) return;
            let badge = /** @type {HTMLElement|null} */ (btn.querySelector(".ui-tab-badge"));
            if (!badge) { badge = document.createElement("span"); btn.appendChild(badge); }
            badge.className = `ui-tab-badge${status ? ` status-${status}` : ""}`;
            badge.textContent = text;
        }

        return { bar, setActive, setBadge };
    }

    /**
     * @param {HTMLElement|null|undefined} el
     * @param {boolean} isInvalid
     */
    static markInvalid(el, isInvalid) {
        if (!el) return;
        el.classList.toggle("is-invalid", !!isInvalid);
    }
}