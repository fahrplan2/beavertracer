//@ts-check
import { getLocale } from "../i18n/index.js";
import { version } from "./version.js";

/**
 * Static info pages (help, about, downloads, …) for the welcome dialog.
 * - Auto-discovers pages via import.meta.glob ("/pages/<slug>/index.html")
 * - Picks locale variants like index.de.html, falling back to English
 * - Fills partials (<!-- CREDITS --> → _credits.html) and {VERSION} tags
 * - Rebases relative URLs so fragments behave as if served from their file
 */

/**
 * All fragments under /pages as raw strings.
 * Keys look like "/pages/about/index.html"
 */
const modules = /** @type {Record<string, () => Promise<string>>} */ (
  import.meta.glob("/pages/**/*.html", { query: "?raw", import: "default" })
);

const FALLBACK_LOCALE = "en";

/** @type {Map<string, string>} route ("/about") -> module key */
const routeToBaseUrl = new Map();
for (const k of Object.keys(modules)) {
  const m = k.match(/^\/pages\/(.+?)\/index\.html$/i);
  if (m) routeToBaseUrl.set(`/${m[1]}`, k);
}

/** @type {Map<string, string>} */
const cache = new Map();

/**
 * Normalizes a path ("/help/", "/help?x#y") to a page route, or null if
 * there is no such page.
 * @param {string} path
 * @returns {string|null}
 */
export function pageRoute(path) {
  let route = String(path || "").trim().split("?")[0].split("#")[0];
  if (!route.startsWith("/")) route = `/${route}`;
  if (route.length > 1) route = route.replace(/\/+$/g, "");
  return routeToBaseUrl.has(route) ? route : null;
}

/** @returns {string[]} known routes, e.g. ["/about", "/help"] */
export function pageRoutes() {
  return Array.from(routeToBaseUrl.keys()).sort();
}

/**
 * Loads a page in the current locale as finished HTML (wrapped in
 * .about-container), or null for an unknown route.
 * @param {string} route
 * @returns {Promise<string|null>}
 */
export async function loadPage(route) {
  const baseUrl = routeToBaseUrl.get(route);
  if (!baseUrl) return null;
  const html = await resolvePartials(await loadLocalized(baseUrl), baseUrl);
  return rebaseFragment('<div class="about-container">' + replaceTags(html, route) + "</div>", baseUrl);
}

/**
 * Where the desktop builds live and which version the downloads page offers.
 * VITE_LAST_RELEASE = the actual last git tag (e.g. "0.1.11" when the dev
 * version is "0.1.12-dev.x").
 * @returns {{ downloadBase: string, version: string }}
 */
export function downloadInfo() {
  return {
    downloadBase: import.meta.env.VITE_DOWNLOAD_BASE ?? "https://www.beavertracer.eu/releases",
    version: String(import.meta.env.VITE_LAST_RELEASE || version()),
  };
}

/**
 * @param {string} html
 * @param {string} route
 */
function replaceTags(html, route) {
  const { downloadBase, version: vBase } = downloadInfo();
  const v = String(version());
  const vDisplay = route === "/downloads" ? vBase : v;
  return String(html)
    .replace(/\{VERSION\}/g, vDisplay)
    .replace(/\{VERSION_BASE\}/g, vBase)
    .replace(/\{DOWNLOAD_BASE\}/g, downloadBase);
}

/**
 * Replaces <!-- CREDITS --> (and similar named partials) with the content of
 * a _<name>.html file in the same directory as baseUrl.
 * @param {string} html
 * @param {string} baseUrl
 */
async function resolvePartials(html, baseUrl) {
  const PARTIAL_RE = /<!--\s*([A-Z_]+)\s*-->/g;
  const dir = baseUrl.replace(/\/[^/]+$/, "/");
  let result = html;
  for (const [placeholder, name] of html.matchAll(PARTIAL_RE)) {
    const loader = modules[`${dir}_${name.toLowerCase()}.html`];
    if (!loader) continue;
    try {
      result = result.replace(placeholder, String(await loader()));
    } catch { /* leave placeholder if partial fails to load */ }
  }
  return result;
}

/** @param {string} baseUrl */
async function loadLocalized(baseUrl) {
  const candidates = buildCandidates(baseUrl, getLocale());
  const cacheKey = candidates.join("|");
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  for (const url of candidates) {
    const loader = modules[url];
    if (!loader) continue;
    try {
      const out = String(await loader());
      cache.set(cacheKey, out);
      return out;
    } catch {
      // ignore and try next candidate
    }
  }
  return "";
}

/**
 * "/pages/about/index.html" + "pt-PT" → index.pt-PT.html, index.pt.html,
 * index.en.html, index.html
 * @param {string} baseUrl
 * @param {string} locale
 */
function buildCandidates(baseUrl, locale) {
  const m = baseUrl.match(/^(.*\/)([^/]+)\.([a-z0-9]+)$/i);
  if (!m) return [baseUrl];
  const [, dir, name, ext] = m;

  const norm = (locale || "").trim();
  const lang = norm.includes("-") ? norm.split("-")[0] : norm;

  /** @type {string[]} */
  const out = [];
  if (norm) out.push(`${dir}${name}.${norm}.${ext}`);
  if (lang && lang !== norm) out.push(`${dir}${name}.${lang}.${ext}`);
  if (FALLBACK_LOCALE !== lang && FALLBACK_LOCALE !== norm) {
    out.push(`${dir}${name}.${FALLBACK_LOCALE}.${ext}`);
  }
  out.push(baseUrl);
  return out;
}

/**
 * Rewrites relative URLs in the fragment to behave as if fragment was served from baseUrl.
 * @param {string} html
 * @param {string} baseUrl module key like "/pages/about/index.html"
 */
function rebaseFragment(html, baseUrl) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;

  const base = new URL(baseUrl, window.location.origin);
  /** @param {string} v */
  const isAbsolute = (v) => /^(https?:|mailto:|tel:|data:|#)/.test(v);
  /** @param {string} v */
  const rebase = (v) => {
    const u = new URL(v, base);
    return u.pathname + u.search + u.hash;
  };

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
      if (!v || isAbsolute(v)) return;
      try { el.setAttribute(attr, rebase(v)); } catch { /* ignore */ }
    });
  }

  tpl.content.querySelectorAll("img[srcset], source[srcset]").forEach((el) => {
    const srcset = el.getAttribute("srcset");
    if (!srcset) return;
    const rebuilt = srcset.split(",").map((p) => p.trim()).filter(Boolean).map((part) => {
      const [url, ...rest] = part.split(/\s+/);
      if (!url || isAbsolute(url)) return part;
      try { return [rebase(url), ...rest].join(" "); } catch { return part; }
    });
    el.setAttribute("srcset", rebuilt.join(", "));
  });

  return tpl.innerHTML;
}
