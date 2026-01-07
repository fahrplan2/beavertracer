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
     * @returns {HTMLInputElement}
     */
    static input(opts = {}) {
        const i = /** @type {HTMLInputElement} */ (DOMBuilder.el("input", { className: opts.className }));
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
}
