//@ts-check

/**
 * All available translations (auto-loaded)
 * @type {Record<string, TranslationDict>}
 */
const dicts = {};

// @ts-ignore
const modules = import.meta.glob("../../locales/*.js", { eager: true });

for (const path in modules) {
  const m = modules[path];
  const code = path.match(/\/([a-z]{2})\.js$/)?.[1];
  if (!code) continue;
  dicts[code] = m.default;
}

export { dicts };


/**
 * @typedef {Record<string, string>} TranslationDict
 * @typedef {{ key: string, label: string }} LocaleDescriptor
 */
let fallback = "en";

/** @type {string} */
let locale = "de";

/** @type {Set<(loc:string)=>void>} */
const listeners = new Set();

/**
 * Returns all locales that exist in dicts, with label coming from each locale's own dict ("lang.name")
 * @returns {{key:string, label:string}[]}
 */
export function getLocales() {
  const keys = Object.keys(dicts);

  /** @param {string} loc @param {string} key */
  const lookupInLocale = (loc, key) => {
    const primary = dicts[loc];
    const fb = dicts[fallback];
    return primary?.[key] ?? fb?.[key] ?? `[[${key}]]`;
  };

  return keys.map((k) => ({
    key: k,
    label: lookupInLocale(k, "lang.name"),
  }));
}


export function setLocale(next) {
  const available = dicts[next] ? next : fallback;
  locale = available;

  // persist
  try {
    localStorage.setItem("sim_locale", locale);
  } catch { /* ignore */ }

  // notify
  for (const fn of listeners) {
    try { fn(locale); } catch { /* ignore */ }
  }
}

export function getLocale() {
  return locale;
}

/** subscribe to changes (returns unsubscribe) */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function format(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`
  );
}

export function t(key, params) {
  const primaryDict = dicts[locale] ?? dicts[fallback];
  const fallbackDict = dicts[fallback];
  const template = primaryDict[key] ?? fallbackDict?.[key] ?? "[[" + key + "]]";
  return format(template, params);
}

export function initLocale() {
  // 1) saved
  try {
    const saved = localStorage.getItem("sim_locale");
    if (saved && dicts[saved]) {
      locale = saved;
      return;
    }
  } catch { /* ignore */ }

  // 2) browser
  const browser = navigator.language?.split("-")[0];
  if (browser && dicts[browser]) locale = browser;
  else locale = "de";
}

/**
 * formats a date
 * @param {Date} d 
 * @returns 
 */

export function formatDate(d) {
    //Date is in the European Format
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

/**
 * formats a Time
 * @param {Date} d 
 * @returns 
 */

export function formatTime(d) {
    //24h-clocks only
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${min}`;
}

/**
 * formats a decimal Number
 * @param {number} n 
 * @returns 
 */

export function formatNumber(n) {
    //defaults to "."-Notation
    return String(n);
}