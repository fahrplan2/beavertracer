//@ts-check

/**
 * @typedef {Record<string, string>} TranslationDict
 * @typedef {{ key: string, label: string }} LocaleDescriptor
 * @typedef {{ name: string, order?: number }} LocaleMeta
 */

/**
 * Runtime cache for already loaded translation dictionaries.
 * @type {Record<string, TranslationDict>}
 */
const dicts = {};

/**
 * Lazy dictionary modules: each locale will become its own chunk.
 * @type {Record<string, () => Promise<{ default: TranslationDict }>>}
 */

//@ts-ignore
const dictModules = import.meta.glob("../../locales/*.js");

/**
 * Lazy meta-only modules: imports ONLY the named export `meta`
 * so the big dictionary is tree-shaken out of the meta chunks.
 * @type {Record<string, () => Promise<LocaleMeta>>}
 */

//@ts-ignore
const metaModules = import.meta.glob("../../locales/*.js", { import: "meta" });

/** @type {string} */
let fallback = "en";

/** @type {string} */
let locale = "de";

/** @type {Set<(loc: string) => void>} */
const listeners = new Set();


/**
 * Finds the module path for a given locale code.
 * @param {string} loc
 * @returns {string | null}
 */
function pathForLocale(loc) {
  const suffix = `/${loc}.js`;
  for (const p of Object.keys(dictModules)) {
    if (p.endsWith(suffix)) return p;
  }
  return null;
}

/**
 * Loads and caches the dictionary for `loc` if available.
 * Returns null if the locale does not exist.
 * @param {string} loc
 * @returns {Promise<TranslationDict | null>}
 */
async function loadLocaleDict(loc) {
  if (dicts[loc]) return dicts[loc];

  const path = pathForLocale(loc);
  if (!path) return null;

  const mod = await dictModules[path]();
  dicts[loc] = mod.default ?? {};
  return dicts[loc];
}

/**
 * Returns all available locales with their labels from `meta.name`,
 * sorted by `meta.order` (ascending), then by label.
 * @returns {Promise<LocaleDescriptor[]>}
 */
export async function getLocales() {
  const paths = Object.keys(metaModules);

  /** @type {{ key: string; label: string; order: number }[]} */
  const out = [];

  await Promise.all(
    paths.map(async (p) => {
      const m = p.match(/\/([^/]+)\.js$/);
      if (!m) return;

      const code = m[1];

      try {
        const meta = await metaModules[p]();

        const label =
          meta && typeof meta.name === "string" ? meta.name : code;

        const order =
          meta && typeof meta.order === "number" ? meta.order : 9999;

        out.push({ key: code, label, order });
      } catch {
        out.push({ key: code, label: code, order: 9999 });
      }
    })
  );

  // First by order, then alphabetically by label
  out.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label);
  });

  // Strip `order` before returning
  return out.map(({ key, label }) => ({ key, label }));
}




/**
 * Sets the active locale and lazily loads its dictionary.
 * Falls back to the fallback locale if not available.
 * @param {string} next
 * @returns {Promise<void>}
 */
export async function setLocale(next) {
  // Always ensure fallback is loaded
  await loadLocaleDict(fallback);

  const ok = await loadLocaleDict(next);
  const available = ok ? next : fallback;

  locale = available;

  // Persist selection
  try {
    localStorage.setItem("sim_locale", locale);
  } catch {
    /* ignore persistence errors */
  }

  // Notify listeners
  for (const fn of listeners) {
    try {
      fn(locale);
    } catch {
      /* ignore listener errors */
    }
  }
}

/**
 * Returns the currently active locale code.
 * @returns {string}
 */
export function getLocale() {
  return locale;
}

/**
 * Subscribes to locale changes.
 * Returns an unsubscribe function.
 * @param {(loc: string) => void} fn
 * @returns {() => void}
 */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Replaces {placeholders} in a template string.
 * @param {string} template
 * @param {Record<string, unknown> | undefined} params
 * @returns {string}
 */
function format(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`
  );
}

/**
 * Translates a key using the active locale with fallback support.
 * If the locale has not been loaded yet, fallback is used.
 * @param {string} key
 * @param {Record<string, unknown>=} params
 * @returns {string}
 */
export function t(key, params) {
  const primaryDict = dicts[locale] ?? dicts[fallback] ?? {};
  const fallbackDict = dicts[fallback] ?? {};
  const template = primaryDict[key] ?? fallbackDict[key] ?? `[[${key}]]`;
  return format(template, params);
}

/**
 * Initializes the locale selection:
 * 1) saved locale from localStorage
 * 2) browser language
 * 3) default "de"
 * Lazily loads the required dictionaries.
 * @returns {Promise<void>}
 */
export async function initLocale() {
  // Always load fallback first
  await loadLocaleDict(fallback);

  // 1) Saved locale
  try {
    const saved = localStorage.getItem("sim_locale");
    if (saved) {
      const ok = await loadLocaleDict(saved);
      if (ok) {
        locale = saved;
        return;
      }
    }
  } catch {
    /* ignore */
  }

  // 2) Browser locale
  const browser = navigator.language?.split("-")[0];
  if (browser && (await loadLocaleDict(browser))) locale = browser;
  else locale = "de";

  // Ensure the chosen locale is loaded
  await loadLocaleDict(locale);
}

/**
 * Formats a date using European format (DD.MM.YYYY).
 * @param {Date} d
 * @returns {string}
 */
export function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Formats a time using 24h format (HH:MM).
 * @param {Date} d
 * @returns {string}
 */
export function formatTime(d) {
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${min}`;
}

/**
 * Formats a decimal number using "." notation.
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  return String(n);
}
