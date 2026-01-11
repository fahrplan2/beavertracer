//@ts-check
import { getLocale } from "./i18n/index.js";
import { version } from "./version.js";

/**
 * Static page router for Vite-bundled HTML fragments.
 * - Auto-discovers pages via import.meta.glob
 * - Auto-builds routes from file paths under /pages
 * - Fixes relative URLs inside fragments
 * - Intercepts internal links (scoped to mounted root) and routes client-side
 * - Supports locale variants like index.de.html
 * - Notifies host app on successful static-route navigation (onRoute callback)
 */
export class StaticPageRouter {
  /** @type {string} */
  #fallbackLocale;

  /** @type {((info: { route: string, baseUrl: string }) => void) | null} */
  #onRoute;

  /** @type {HTMLElement|null} */
  #root = null;

  /** @type {Map<string, string>} */
  #cache = new Map();

  /**
   * All fragments under /pages as raw strings.
   * Keys look like "/pages/about/index.html"
   * @type {Record<string, () => Promise<string>>}
   */
  // @ts-ignore
  static #modules = import.meta.glob("/pages/**/*.html", { as: "raw" });

  /** @type {Map<string, string[]>} route -> baseUrl keys (module keys for index.html) */
  #routeToBaseUrls = new Map();

  /** @type {Map<string, string>} baseUrl (module key) -> route */
  #baseUrlToRoute = new Map();

  /** @type {(e: MouseEvent) => void} */
  #onClickBound;

  /** @type {(e: PopStateEvent) => void} */
  #onPopStateBound;

  /**
   * @param {{
   *   fallbackLocale?: string,
   *   onRoute?: (info: { route: string, baseUrl: string }) => void
   * }} [opts]
   */
  constructor(opts = {}) {
    this.#fallbackLocale = opts.fallbackLocale ?? "en";
    this.#onRoute = typeof opts.onRoute === "function" ? opts.onRoute : null;

    this.#onClickBound = this.#onClick.bind(this);
    this.#onPopStateBound = this.#onPopState.bind(this);

    this.#indexPages();
  }

  // -------------------- Public API --------------------

  /**
   * Mount router into a container. Optionally navigate immediately.
   * Click interception is scoped to this root.
   *
   * @param {HTMLElement} root
   * @param {{ initial?: string }} [opts]
   */
  mount(root, opts = {}) {
    this.#root = root;
    root.addEventListener("click", this.#onClickBound);
    window.addEventListener("popstate", this.#onPopStateBound);

    const initial = opts.initial ?? window.location.pathname;
    void this.navigate(initial, { replace: true });
  }

  unmount() {
    this.#root?.removeEventListener("click", this.#onClickBound);
    window.removeEventListener("popstate", this.#onPopStateBound);
    this.#root = null;
  }

  /**
   * Navigate to a route ("/about") or a page URL ("/pages/about/index.html").
   * @param {string} to
   * @param {{ replace?: boolean }} [opts]
   */
  async navigate(to, opts = {}) {
    if (!this.#root) throw new Error("StaticPageRouter not mounted");

    const route = this.#normalizeRouteOrUrl(to);
    const baseUrl = this.#resolveRouteToBaseUrl(route);

    if (!baseUrl) {
      this.#root.innerHTML = `<div class="content"><p>Page not found.</p></div>`;
      if (opts.replace) history.replaceState({ route }, "", route);
      else history.pushState({ route }, "", route);
      return;
    }

    // Notify host app so it can switch tab/mode when a static page is active
    this.#onRoute?.({ route, baseUrl });

    const html = await this.#loadLocalized(baseUrl);

    const finalHtml = '<div class="about-container">' + this.#replaceTags(html) + '</div>';

    // Rebase relative URLs so fragment behaves as if it lived at baseUrl
    const rebased = this.#rebaseFragment(finalHtml, baseUrl);

    this.#root.innerHTML = rebased;
    const scroller = this.#root.closest(".about");
    if (scroller) scroller.scrollTop = 0;

    if (opts.replace) history.replaceState({ route }, "", route);
    else history.pushState({ route }, "", route);
  }

  /**
   * Returns the known routes, e.g. ["/", "/about", "/legal"]
   */
  getRoutes() {
    return Array.from(this.#routeToBaseUrls.keys()).sort();
  }

  /**
   * Returns true if a route exists (after normalization).
   * @param {string} routeOrUrl
   */
  hasRoute(routeOrUrl) {
    const r = this.#normalizeRouteOrUrl(routeOrUrl);
    return this.#routeToBaseUrls.has(r);
  }

  // -------------------- Indexing --------------------

  #indexPages() {
    const keys = Object.keys(StaticPageRouter.#modules);

    // We consider any ".../index.html" a page entry.
    // (Localized variants handled at runtime by #loadLocalized)
    for (const k of keys) {
      if (!k.endsWith("/index.html")) continue;

      const route = this.#routeFromBaseUrl(k);
      if (!route) continue;

      this.#baseUrlToRoute.set(k, route);

      const list = this.#routeToBaseUrls.get(route) ?? [];
      list.push(k);
      this.#routeToBaseUrls.set(route, list);
    }
  }

  /**
   * "/pages/about/index.html" -> "/about"
   * "/pages/index.html" -> "/"
   */
  #routeFromBaseUrl(baseUrl) {
    const m = baseUrl.match(/^\/pages(?:\/(.*?))?\/index\.html$/i);
    if (!m) return null;

    const slug = (m[1] ?? "").replace(/\/+$/g, "");
    return slug ? `/${slug}` : "/";
  }

  /**
   * Normalize input path or url into a route.
   * - strips query/hash
   * - strips trailing slash (except root)
   * - maps "/pages/.../index.html" to route if known
   */
  #normalizeRouteOrUrl(to) {
    // If user passed a direct base url like "/pages/about/index.html", map to route
    if (to.startsWith("/pages/") && to.endsWith(".html")) {
      const baseUrl = to.replace(/\/+$/g, "");
      const route = this.#baseUrlToRoute.get(baseUrl);
      return route ?? this.#routeFromBaseUrl(baseUrl) ?? "/";
    }

    let route = String(to || "/").trim();
    // drop query/hash
    route = route.split("?")[0].split("#")[0];
    if (!route.startsWith("/")) route = `/${route}`;
    // normalize trailing slash (except root)
    if (route.length > 1) route = route.replace(/\/+$/g, "");
    return route;
  }

  #resolveRouteToBaseUrl(route) {
    if (this.#routeToBaseUrls.has(route)) {
      return (this.#routeToBaseUrls.get(route) ?? [])[0] ?? null;
    }
    return null;
  }

  // -------------------- Loading --------------------

  #replaceTags(html) {
    return String(html).replace(/\{VERSION\}/g, String(version()));
  }

  async #loadLocalized(baseUrl) {
    const locale = getLocale();
    const candidates = this.#buildCandidates(baseUrl, locale);
    const cacheKey = candidates.join("|");

    if (this.#cache.has(cacheKey)) return this.#cache.get(cacheKey) ?? "";

    for (const url of candidates) {
      const loader = StaticPageRouter.#modules[url];
      if (!loader) continue;
      try {
        const raw = await loader();
        const out = String(raw);
        this.#cache.set(cacheKey, out);
        return out;
      } catch {
        // ignore and try next candidate
      }
    }
    return "";
  }

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

    // Non-index pages (unused currently; kept for completeness)
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

  // -------------------- URL rebasing inside fragments --------------------

  /**
   * Rewrites relative URLs in the fragment to behave as if fragment was served from baseUrl.
   * @param {string} html
   * @param {string} baseUrl module key like "/pages/about/index.html"
   */
  #rebaseFragment(html, baseUrl) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;

    const base = new URL(baseUrl, window.location.origin);

    const urlAttrs = [
      ["a", "href"],
      ["img", "src"],
      ["script", "src"],
      ["link", "href"],
      ["source", "src"],
      ["iframe", "src"],
      ["video", "src"],
      ["audio", "src"],
    ];

    for (const [tag, attr] of urlAttrs) {
      tpl.content.querySelectorAll(`${tag}[${attr}]`).forEach((el) => {
        const v = el.getAttribute(attr);
        if (!v) return;

        // ignore absolute URLs, mailto/tel/data, hash-only
        if (
          v.startsWith("http:") ||
          v.startsWith("https:") ||
          v.startsWith("mailto:") ||
          v.startsWith("tel:") ||
          v.startsWith("data:") ||
          v.startsWith("#")
        ) return;

        try {
          const u = new URL(v, base);
          el.setAttribute(attr, u.pathname + u.search + u.hash);
        } catch {
          // ignore
        }
      });
    }

    // srcset handling
    tpl.content
      .querySelectorAll("img[srcset], source[srcset]")
      .forEach((el) => {
        const srcset = el.getAttribute("srcset");
        if (!srcset) return;

        const parts = srcset
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);

        const rebuilt = parts.map((part) => {
          const [url, ...rest] = part.split(/\s+/);
          if (!url) return part;

          if (
            url.startsWith("http:") ||
            url.startsWith("https:") ||
            url.startsWith("data:")
          ) return part;

          try {
            const u = new URL(url, base);
            return [u.pathname + u.search + u.hash, ...rest].join(" ");
          } catch {
            return part;
          }
        });

        el.setAttribute("srcset", rebuilt.join(", "));
      });

    return tpl.innerHTML;
  }

  // -------------------- Click interception + history --------------------

  /** @param {MouseEvent} e */
  #onClick(e) {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return; // left click only
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const a = target.closest("a[href]");
    if (!a) return;

    const href = a.getAttribute("href");
    if (!href) return;

    // respect target/_blank and downloads
    if (a.getAttribute("target") === "_blank") return;
    if (a.hasAttribute("download")) return;

    // external absolute schemes
    if (
      href.startsWith("http:") ||
      href.startsWith("https:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) return;

    // If link points to a known static route, route it.
    // Otherwise, let it fall through (could be sim internal or hash etc).
    const route = this.#normalizeRouteOrUrl(href);
    if (!this.#routeToBaseUrls.has(route)) return;

    e.preventDefault();
    void this.navigate(route);
  }

  /** @param {PopStateEvent} e */
  #onPopState(e) {
    let route =
      e.state && e.state.route ? String(e.state.route) : window.location.pathname;

    route = route.split("?")[0].split("#")[0];
    if (route.length > 1) route = route.replace(/\/+$/g, "");

    void this.navigate(route, { replace: true });
  }
}
