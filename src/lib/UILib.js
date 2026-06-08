//@ts-check

/**
 * Helper class to build common DOM elements — shared by the simulator and OS apps.
 */
export class UILib {
  /**
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {Object} [opts]
   * @param {string|string[]} [opts.className]
   * @param {string|number} [opts.text]
   * @param {string} [opts.html]
   * @param {Record<string, string|number|boolean>} [opts.attrs]
   * @param {Partial<CSSStyleDeclaration>} [opts.style]
   * @param {(el: HTMLElementTagNameMap[K]) => void} [opts.init]
   * @param {Array<Node|string|null|undefined|false>} [opts.children]
   * @returns {HTMLElementTagNameMap[K]}
   */
  static el(tag, opts = {}) {
    const el = document.createElement(tag);

    if (opts.className) {
      el.className = Array.isArray(opts.className) ? opts.className.join(" ") : opts.className;
    }
    if (opts.text != null) el.textContent = String(opts.text);
    if (opts.html != null) el.innerHTML = String(opts.html);

    if (opts.attrs) {
      for (const [k, v] of Object.entries(opts.attrs)) el.setAttribute(k, String(v));
    }
    if (opts.style) Object.assign(el.style, opts.style);

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

  /** @param {string} [className] @param {(Node|null|undefined)[]} [children] */
  static div(className = "", children = []) {
    return UILib.el("div", { className, children });
  }

  /** @param {string} text */
  static h1(text) { return UILib.el("h1", { text, style: { margin: "0" } }); }
  /** @param {string} text */
  static h2(text) { return UILib.el("h2", { text, style: { margin: "0" } }); }
  /** @param {string} text */
  static h3(text) { return UILib.el("h3", { text, style: { margin: "0" } }); }
  /** @param {string} text */
  static h4(text) { return UILib.el("h4", { text, style: { margin: "0" } }); }
  /** @param {string} text */
  static h5(text) { return UILib.el("h5", { text, style: { margin: "0" } }); }

  /** @param {string} text */
  static label(text) { return UILib.el("label", { text }); }

  /** @param {Node} child */
  static td(child) { return UILib.el("td", { children: [child] }); }

  /**
   * Button element (app variant — onClick is wired in).
   * @param {string} label
   * @param {(() => void)|null} [onClick]
   * @param {Object} [opts]
   * @param {string|string[]} [opts.className]
   * @param {boolean} [opts.primary]
   * @param {string} [opts.icon] Font Awesome icon class, e.g. "fa-play"
   * @param {boolean} [opts.disabled]
   * @param {string} [opts.title]
   * @param {"button"|"submit"|"reset"} [opts.type]
   * @returns {HTMLButtonElement}
   */
  static button(label, onClick = null, opts = {}) {
    /** @type {HTMLButtonElement} */
    const b = UILib.el("button", {
      className: opts.className ?? (opts.primary ? ["btn", "btn-primary"] : "btn"),
      text: opts.icon ? undefined : label,
      children: opts.icon
        ? [UILib.el("i", { className: `fas ${opts.icon}` }), UILib.el("span", { text: label })]
        : undefined,
      init: (el) => {
        el.type = opts.type ?? "button";
        if (opts.title) el.title = opts.title;
        if (opts.disabled != null) el.disabled = !!opts.disabled;
        if (onClick) el.addEventListener("click", onClick);
      },
    });
    return b;
  }

  /**
   * Input element.
   * @param {Object} [opts]
   * @param {string} [opts.value]
   * @param {string} [opts.placeholder]
   * @param {string} [opts.type]
   * @param {boolean} [opts.disabled]
   * @param {string} [opts.min]
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
        if (opts.type != null) el.type = opts.type;
        if (opts.value != null) el.value = opts.value;
        if (opts.disabled != null) el.disabled = !!opts.disabled;
        if (opts.min != null) el.min = opts.min;
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
   * @param {boolean} [opts.disabled]
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
        if (opts.disabled != null) el.disabled = !!opts.disabled;
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
        spellcheck: /** @type {any} */ (opts.spellcheck),
        readonly: /** @type {any} */ (opts.readonly),
      },
      init: (el) => {
        if (opts.value != null) el.value = opts.value;
        if (opts.onInput) el.addEventListener("input", () => opts.onInput?.(el.value));
        if (opts.onChange) el.addEventListener("change", () => opts.onChange?.(el.value));
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
   * Simple panel container.
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
   * Creates a toolbar/menu button with optional icon, badge, and active state.
   *
   * @param {Object} opts
   * @param {string} opts.label - Button text (shown as tooltip when iconOnly)
   * @param {(ev: MouseEvent) => void} opts.onClick - Click handler
   * @param {string} [opts.icon] - Font Awesome icon class, e.g. "fa-play"
   * @param {string} [opts.badge] - Short badge label shown over the icon
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

    if (icon) {
      const iconEl = document.createElement("i");
      iconEl.classList.add("fas", icon);
      btn.appendChild(iconEl);
    }

    if (badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = "icon-badge";
      badgeEl.textContent = badge;
      btn.appendChild(badgeEl);
    }

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
   * Tab bar wired to pane visibility. The first tab is made active immediately.
   *
   * @param {Array<{id: string, label: string, pane: HTMLElement, onShow?: () => void}>} tabs
   * @returns {{ bar: HTMLElement, setActive: (id: string) => void }}
   */
  static tabbedPane(tabs) {
    /** @param {string} activeId */
    function show(activeId) {
      for (const t of tabs) {
        t.pane.style.display = t.id === activeId ? "" : "none";
        if (t.id === activeId && t.onShow) t.onShow();
      }
    }

    const { bar, setActive: setTab } = UILib.tabGroup(
      tabs.map(({ id, label }) => ({ id, label })),
      (id) => { show(id); }
    );

    /** @param {string} id */
    function setActive(id) {
      setTab(id);
      show(id);
    }

    if (tabs.length > 0) setActive(tabs[0].id);

    return { bar, setActive };
  }

  /**
   * Creates a `<table>` with a fixed header row and an empty `<tbody>`.
   *
   * @param {string[]} headers - Column header labels
   * @param {string} [className] - Optional CSS class for the table element
   * @returns {{ table: HTMLTableElement, tbody: HTMLTableSectionElement }}
   */
  static tableWithBody(headers, className) {
    const table = /** @type {HTMLTableElement} */ (UILib.el("table", className ? { className } : {}));
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const label of headers) {
      const th = document.createElement("th");
      th.textContent = label;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    return { table, tbody };
  }

  /**
   * @param {HTMLElement|null|undefined} el
   * @param {boolean} isInvalid
   */
  static markInvalid(el, isInvalid) {
    if (!el) return;
    el.classList.toggle("is-invalid", !!isInvalid);
  }

  /**
   * Wraps a .sim-table-scroll element in a hint-outer div and attaches
   * ▲/▼ scroll indicators that appear when content overflows.
   * Returns the outer wrapper — append that to the DOM instead of scrollWrap.
   * @param {HTMLElement} scrollWrap
   * @returns {HTMLElement} outer
   */
  static wrapWithScrollHints(scrollWrap) {
    const outer = UILib.div("router-scroll-hint-outer");
    outer.appendChild(scrollWrap);

    const hintTop = UILib.el("div", { className: "router-scroll-hint router-scroll-hint--top", attrs: { "aria-hidden": "true" }, text: "▲" });
    const hintBottom = UILib.el("div", { className: "router-scroll-hint router-scroll-hint--bottom", attrs: { "aria-hidden": "true" }, text: "▼" });
    outer.appendChild(hintTop);
    scrollWrap.appendChild(hintBottom);

    const update = () => {
      const canScroll = scrollWrap.scrollHeight > scrollWrap.clientHeight + 2;
      const atTop     = scrollWrap.scrollTop <= 4;
      const atBottom  = scrollWrap.scrollTop + scrollWrap.clientHeight >= scrollWrap.scrollHeight - 4;
      hintTop.classList.toggle("is-visible",    canScroll && !atTop);
      hintBottom.classList.toggle("is-visible", canScroll && !atBottom);
      const thead = scrollWrap.querySelector("thead");
      if (thead) hintTop.style.top = /** @type {HTMLElement} */ (thead).offsetHeight + "px";
    };

    scrollWrap.addEventListener("scroll", update, { passive: true });
    new ResizeObserver(update).observe(scrollWrap);

    return outer;
  }
}
