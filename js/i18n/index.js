import de from "./locales/de.js";
import en from "./locales/en.js";

const dicts = { de, en };
const fallback = "en";
let locale = "de";

export function setLocale(next) {
    locale = dicts[next] ? next : fallback;
    localStorage.setItem("locale", locale);
}

export function getLocale() {
    return locale;
}

function format(template, params) {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, key) =>
        params[key] !== undefined ? String(params[key]) : `{${key}}`
    );
}

export function t(key, params) {
    const primary = dicts[locale] ?? dicts[fallback];
    const fallback = dicts[fallback];

    const template = primary[key] ?? fallback?.[key] ?? key; // key sichtbar = Debug
    return format(template, params);
}

export function initLocale() {
    const saved = localStorage.getItem("locale");
    const browser = navigator.language?.split("-")[0]; // "de-DE" -> "de"
    setLocale(saved || (dicts[browser] ? browser : "de"));
}

export function formatDate(d) {
    //Date is in the European Format
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

export function formatTime(d) {
    //24h-clocks only
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${min}`;
}

export function formatNumber(n) {
    //defaults to "."-Notation
    return String(n);
}