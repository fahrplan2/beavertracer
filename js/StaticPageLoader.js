//@ts-check

import { getLocale } from "./i18n/index.js";
import { version } from "./version.js";

/**
 * Vite-bundled static HTML fragment loader.
 *
 * Public URLs:
 *   /pages/about/index.html
 *
 * Filesystem:
 *   src/pages/about/index.html
 */
export class StaticPageLoader {
  /** @type {string} */
  #fallbackLocale;

  /** @type {Map<string, string>} */
  static #cache = new Map();

  /**
   * All fragments under src/pages as raw strings.
   * Keys look like "/pages/about/index.html"
   *
   * @type {Record<string, () => Promise<string>>}
   */
  //@ts-ignore
  static #modules = import.meta.glob("/pages/**/*.html", { as: "raw" });

  /**
   * @param {{ fallbackLocale?: string }} [opts]
   */
  constructor(opts = {}) {
    this.#fallbackLocale = opts.fallbackLocale ?? "en";
  }

  /**
   * @param {string} html
   */
  _replaceTags(html) {
    return String(html).replace(/\{VERSION\}/g, String(version()));
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
    if (cache && StaticPageLoader.#cache.has(cacheKey)) {
      root.innerHTML = StaticPageLoader.#cache.get(cacheKey) || "";
      onLoaded?.(root, { url: candidates[0] || baseUrl });
      return;
    }

    root.dataset.loading = "true";
    try {
      const res = await this.#loadFirstExisting(candidates);
      if (!res) {
        root.innerHTML = `<div class="content"><p>Page not found.</p></div>`;
        return;
      }

      const html = this._replaceTags(res.html);
      root.innerHTML = html;

      if (cache) StaticPageLoader.#cache.set(cacheKey, html);
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
    const m = baseUrl.match(/^(?:(.*\/))?([^\/]+)\.([a-z0-9]+)$/i);
    if (!m) return [baseUrl];

    const dir = m[1] ?? "";
    const name = m[2];
    const ext = m[3];

    const norm = (locale || "").trim();
    const lang = norm.includes("-") ? norm.split("-")[0] : norm;

    /** @type {string[]} */
    const out = [];

    // index.html special case
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

    // non-index pages
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
   * @param {string[]} urls keys into #modules
   * @returns {Promise<{ url: string, html: string } | null>}
   */
  async #loadFirstExisting(urls) {
    for (const url of urls) {
      const loader = StaticPageLoader.#modules[url];
      if (!loader) continue;

      try {
        const html = await loader();
        return { url, html: String(html) };
      } catch {
        // ignore
      }
    }
    return null;
  }
}
