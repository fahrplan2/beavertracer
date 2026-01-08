//@ts-check

import { getLocale, initLocale } from "./i18n/index.js";

/**
 * Loads localized static HTML fragments into containers.
 */
export class StaticPageLoader {
  /** @type {string} */
  #fallbackLocale;

  /** @type {Map<string, string>} */
  #cache = new Map();

  /**
   * @param {{
   *   fallbackLocale?: string
   * }} [opts]
   */
  constructor(opts = {}) {
    this.#fallbackLocale = opts.fallbackLocale ?? "en";
  }

  /**
   * Load a static page into a container.
   *
   * @param {HTMLElement} root
   * @param {string} baseUrl e.g. "/pages/about/index.html"
   * @param {{
   *   cache?: boolean,
   *   onLoaded?: (root: HTMLElement, info: { url: string }) => void
   * }} [opts]
   */
  async load(root, baseUrl, opts = {}) {
    const { cache = true, onLoaded } = opts;

    const locale = getLocale();
    const candidates = this.#buildCandidates(baseUrl, locale);

    const cacheKey = candidates.join("|");
    if (cache && this.#cache.has(cacheKey)) {
      root.innerHTML = this.#cache.get(cacheKey);
      return;
    }

    root.dataset.loading = "true";
    try {
      const res = await this.#fetchFirstExisting(candidates);
      if (!res) {
        root.innerHTML = `<div class="content"><p>Page not found.</p></div>`;
        return;
      }

      root.innerHTML = res.html;
      if (cache) this.#cache.set(cacheKey, res.html);
      onLoaded?.(root, { url: res.url });
    } finally {
      delete root.dataset.loading;
    }
  }

  // ---------------------------------------------------------------------------

  /**
   * @param {string} baseUrl
   * @param {string} locale
   * @returns {string[]}
   */
  #buildCandidates(baseUrl, locale) {
    // allow optional directory (so "index.html" also matches)
    const m = baseUrl.match(/^(?:(.*\/))?([^\/]+)\.([a-z0-9]+)$/i);
    if (!m) return [baseUrl];

    const dir = m[1] ?? "";      // "" if no directory
    const name = m[2];
    const ext = m[3];

    const norm = (locale || "").trim();
    const lang = norm.includes("-") ? norm.split("-")[0] : norm;

    /** @type {string[]} */
    const out = [];

    // If it's index.html (your special case), do exactly the order you want:
    // locale -> lang -> fallback -> base
    if (name.toLowerCase() === "index") {
      if (norm) out.push(`${dir}${name}.${norm}.${ext}`);
      if (lang && lang !== norm) out.push(`${dir}${name}.${lang}.${ext}`);

      if (
        this.#fallbackLocale &&
        this.#fallbackLocale !== lang &&
        this.#fallbackLocale !== norm
      ) {
        out.push(`${dir}${name}.${this.#fallbackLocale}.${ext}`);
      }

      out.push(baseUrl);
      return out;
    }

    // For non-index pages, keep existing behavior (same ordering)
    if (norm) out.push(`${dir}${name}.${norm}.${ext}`);
    if (lang && lang !== norm) out.push(`${dir}${name}.${lang}.${ext}`);

    if (
      this.#fallbackLocale &&
      this.#fallbackLocale !== lang &&
      this.#fallbackLocale !== norm
    ) {
      out.push(`${dir}${name}.${this.#fallbackLocale}.${ext}`);
    }

    out.push(baseUrl);
    return out;
  }
  
  /**
   * @param {string[]} urls
   * @returns {Promise<{ url: string, html: string } | null>}
   */
  async #fetchFirstExisting(urls) {
    for (const url of urls) {
      try {
        // HEAD first (cheap existence check)
        const head = await fetch(url, { method: "HEAD" });
        if (!head.ok) continue;

        const res = await fetch(url);
        if (!res.ok) continue;

        return { url, html: await res.text() };
      } catch {
        // Some dev servers don’t like HEAD → try GET directly
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          return { url, html: await res.text() };
        } catch {
          /* ignore */
        }
      }
    }
    return null;
  }
}
