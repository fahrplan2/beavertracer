//@ts-check
// Picks the game content (src/game/content/<lang>.js) for the active
// language. Languages without their own content file fall back to English,
// like the app's interface strings do.

import { getContentLocale } from "../i18n/index.js";

/** @typedef {typeof import("./content/de.js").default} GameContent */

const modules = /** @type {Record<string, GameContent>} */ (import.meta.glob("./content/*.js", { eager: true, import: "default" }));

/** @type {Record<string, GameContent>} */
const BY_LANG = Object.fromEntries(Object.entries(modules).map(([p, c]) => [p.replace(/^.*\/(.+)\.js$/, "$1"), c]));

/** Languages that have their own game content. */
export const CONTENT_LANGS = Object.keys(BY_LANG);

/**
 * @param {string} [locale]
 * @returns {GameContent}
 */
export function gameContent(locale = getContentLocale()) {
    return BY_LANG[locale] ?? BY_LANG.en ?? BY_LANG.de;
}

/**
 * Fills {placeholders} in a content template.
 * @param {string} tpl
 * @param {Record<string, string|number>} [params]
 */
export function fmt(tpl, params) {
    if (!params) return tpl;
    return tpl.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}
