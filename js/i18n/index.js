//@ts-check

import de from "./locales/de.js";
import en from "./locales/en.js";

/**
 * @typedef {Record<string, string>} TranslationDict
 */

/**
 * All available translations
 * @type {Record<string, TranslationDict>}
 */
let dicts = { de, en };
let fallback = "en";
let locale = "de";

/**
 * tries to sets a locale
 * @param {*} next 
 */

export function setLocale(next) {
    locale = next ?? fallback;
}

export function getLocale() {
    return locale;
}

/**
 * Replaces `{key}` placeholders in a template string with values from `params`.
 *
 * @param {string} template - The template string containing `{key}` placeholders.
 * @param {Record<string, unknown>} [params] - Values to substitute into the template.
 * @returns {string} The formatted string.
 */
function format(template, params) {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, 
        /**
         * @param {string} _ - Full match (unused)
         * @param {string} key - Placeholder key without braces
         * @returns {string}
         */
        (_, key) =>
        params[key] !== undefined ? String(params[key]) : `{${key}}`
    );
}

/**
 * Looks up a translation for a key.
 *
 * @param {string} key - Translation key
 * @param {Record<string, unknown>} [params] - Parameters for placeholder insertion
 * @returns {string}
 */
export function t(key, params) {
    const primaryDict = dicts[locale] ?? dicts[fallback];
    const fallbackDict = dicts[fallback];

    const template = primaryDict[key] ?? fallbackDict?.[key] ?? "[["+key+"]]"; // key sichtbar = Debug
    return format(template, params);
}

/**
 * inits the locale System
 */
export function initLocale() {
    const browser = navigator.language?.split("-")[0]; // "de-DE" -> "de"
    setLocale(browser ?? "de");
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