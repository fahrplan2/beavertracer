//@ts-check


/**
 * This class has many static helper functions to create standard DOM - Elements
 * which is usefull for the OSApps.
 * 
 */
export class UILib {
  /**
   * Create a DOM element with optional class/text/attrs/children.
   *
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {Object} [opts]
   * @param {string|string[]} [opts.className]
   * @param {string} [opts.text]
   * @param {Record<string, string>} [opts.attrs]
   * @param {(el: HTMLElementTagNameMap[K]) => void} [opts.init]
   * @param {Array<Node|string|null|undefined|false>} [opts.children]
   * @returns {HTMLElementTagNameMap[K]}
   */
  static el(tag, opts = {}) {
    const el = document.createElement(tag);

    if (opts.className) {
      el.className = Array.isArray(opts.className) ? opts.className.join(" ") : opts.className;
    }
    if (opts.text != null) el.textContent = opts.text;

    if (opts.attrs) {
      for (const [k, v] of Object.entries(opts.attrs)) el.setAttribute(k, v);
    }

    if (opts.children) {
      for (const c of opts.children) {
        if (c == null || c === false) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
      }
    }

    if (opts.init) opts.init(el);

    return el;
  }

  /** @param {string} text */
  static text(text) {
    return document.createTextNode(text);
  }

  /** @param {HTMLElement} el */
  static clear(el) {
    el.replaceChildren();
    return el;
  }

  /**
   * Button element.
   * @param {string} label
   * @param {() => void} onClick
   * @param {Object} [opts]
   * @param {string|string[]} [opts.className]
   * @param {boolean} [opts.primary]
   * @returns {HTMLButtonElement}
   */
  static button(label, onClick, opts = {}) {
    /** @type {HTMLButtonElement} */
    const b = UILib.el("button", {
      className: opts.className ?? (opts.primary ? ["btn", "btn-primary"] : "btn"),
      text: label,
      init: (el) => {
        el.type = "button";
        el.addEventListener("click", onClick);
      },
    });
    return b;
  }

  /**
   * Input element.
   * @param {Object} [opts]
   * @param {string} [opts.value]
   * @param {string} [opts.placeholder]
   * @param {(value: string) => void} [opts.onInput]
   * @param {string|string[]} [opts.className]
   * @returns {HTMLInputElement}
   */
  static input(opts = {}) {
    /** @type {HTMLInputElement} */
    const i = UILib.el("input", {
      className: opts.className ?? "input",
      attrs: { placeholder: opts.placeholder ?? "" },
      init: (el) => {
        if (opts.value != null) el.value = opts.value;
        if (opts.onInput) el.addEventListener("input", () => opts.onInput?.(el.value));
      },
    });
    return i;
  }

  /**
   * Select element.
   * @param {Array<{value: string, label: string}>} items
   * @param {Object} [opts]
   * @param {string} [opts.value]
   * @param {(value: string) => void} [opts.onChange]
   * @param {string|string[]} [opts.className]
   * @returns {HTMLSelectElement}
   */
  static select(items, opts = {}) {
    /** @type {HTMLSelectElement} */
    const s = UILib.el("select", {
      className: opts.className ?? "input",
      init: (el) => {
        for (const it of items) {
          el.appendChild(UILib.el("option", { attrs: { value: it.value }, text: it.label }));
        }
        if (opts.value != null) el.value = opts.value;
        if (opts.onChange) {
          el.addEventListener("change", () => opts.onChange?.(el.value));
        }
      },
    });
    return s;
  }

  /**
   * Textarea element.
   * @param {Object} [opts]
   * @param {string} [opts.value]
   * @param {(value: string) => void} [opts.onChange]
   * @param {(value: string) => void} [opts.onInput]
   * @param {string|string[]} [opts.className]
   * @param {string} [opts.rows]
   * @param {string} [opts.cols]
   * @param {string} [opts.spellcheck]
   * @param {string} [opts.readonly]
   * @param {string} [opts.placeholder]
   * @returns {HTMLTextAreaElement}
   */
  static textarea(opts = {}) {
    /** @type {HTMLTextAreaElement} */
    const ta = UILib.el("textarea", {
      className: opts.className ?? "input",
      attrs: {
        rows: (opts.rows ?? "5"),
        cols: (opts.cols ?? "20"),
        placeholder: (opts.placeholder ?? ""),
        spellcheck: (opts.spellcheck),
        readonly: opts.readonly,
      },
      init: (el) => {
        if (opts.value != null) el.value = opts.value;

        if (opts.onInput) {
          el.addEventListener("input", () => opts.onInput?.(el.value));
        }

        if (opts.onChange) {
          el.addEventListener("change", () => opts.onChange?.(el.value));
        }
      },
    });

    return ta;
  }

  /**
   * Form row: label + control.
   * @param {string} label
   * @param {HTMLElement} control
   * @returns {HTMLDivElement}
   */
  static row(label, control) {
    /** @type {HTMLDivElement} */
    const r = UILib.el("div", {
      className: "form-row",
      children: [
        UILib.el("div", { className: "form-label", text: label }),
        UILib.el("div", { className: "form-control", children: [control] }),
      ],
    });
    return r;
  }

  /**
   * Simple panel container with title.
   * @param {Array<HTMLElement|Node|string|null|undefined|false>} children
   * @param {Object} [opts]
   * @param {string|string[]} [opts.className]
   * @returns {HTMLDivElement}
   */
  static panel(children, opts = {}) {
    /** @type {HTMLDivElement} */
    const p = UILib.el("div", {
      className: opts.className ?? "panel",
      children: children,
    });
    return p;
  }

  /**
   * Button row container.
   * @param {Array<HTMLButtonElement>} buttons
   * @returns {HTMLDivElement}
   */
  static buttonRow(buttons) {
    /** @type {HTMLDivElement} */
    const r = UILib.el("div", { className: "btn-row", children: buttons });
    return r;
  }
}