//@ts-check

/**
 * Single place for reading/writing the app's query-string state
 * (?sim=, ?embed=, ?editable=, ?debug=, ?lang=, ?lesson=). Before this
 * existed, main.js, i18n/index.js and SimControl.js each read
 * `location.search` and called history.pushState/replaceState independently,
 * with no shared knowledge of what params existed — main.js even had to
 * capture ?sim= into a module-level constant before StaticPageRouter's
 * first replaceState could touch the URL. StaticPageRouter still owns
 * pathname-based routes (/help, /about, ...); this module is only about
 * query-string params and the "back to /" transition out of those routes.
 */

/**
 * @typedef {{
 *   sim: string|null,
 *   embed: boolean,
 *   editable: boolean,
 *   debug: boolean,
 *   lang: string|null,
 *   lesson: string|null,
 * }} BootParams
 */

/**
 * Reads every recognized query param in one pass. Call this once, as early
 * as possible (before StaticPageRouter mounts or i18n applies ?lang=), and
 * pass the result down instead of re-reading location.search elsewhere.
 * @returns {BootParams}
 */
export function readBootParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        sim: params.get("sim"),
        embed: params.get("embed") === "1",
        editable: params.get("editable") === "1",
        debug: params.get("debug") === "1",
        lang: params.get("lang"),
        lesson: params.get("lesson"),
    };
}

/**
 * Sets (or, if value is null, clears) one query param, preserving every
 * other param/pathname/hash currently in the URL. Defaults to replaceState
 * (no new back-history entry) — pass {replace:false} for actions that
 * should be reachable via the back button (see resetPathToRoot).
 * @param {string} key
 * @param {string|null} value
 * @param {{replace?: boolean}} [opts]
 */
export function setParam(key, value, opts = {}) {
    const url = new URL(window.location.href);
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    _write(url, opts.replace ?? true);
}

/**
 * Clears several params at once (single history entry), preserving the rest.
 * @param {string[]} keys
 * @param {{replace?: boolean}} [opts]
 */
export function clearParams(keys, opts = {}) {
    const url = new URL(window.location.href);
    for (const key of keys) url.searchParams.delete(key);
    _write(url, opts.replace ?? true);
}

/**
 * Returns the current URL with `overrides` applied (null clears a key),
 * without touching history — for building a link to open/share elsewhere
 * (e.g. the "open standalone" embed button).
 * @param {Record<string, string|null>} overrides
 * @returns {string}
 */
export function buildUrl(overrides) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(overrides)) {
        if (value == null) url.searchParams.delete(key);
        else url.searchParams.set(key, value);
    }
    return url.toString();
}

/**
 * Resets the pathname to "/" (leaving a StaticPageRouter route like /help),
 * preserving query params/hash. Defaults to pushState (matches the previous
 * per-button behavior: reachable via the back button), unlike setParam/
 * clearParams above.
 * @param {{replace?: boolean}} [opts]
 */
export function resetPathToRoot(opts = {}) {
    if (window.location.pathname === "/") return;
    const url = new URL(window.location.href);
    url.pathname = "/";
    _write(url, opts.replace ?? false);
}

/**
 * @param {URL} url
 * @param {boolean} replace
 */
function _write(url, replace) {
    const historyUrl = url.pathname + url.search + url.hash;
    if (replace) history.replaceState(history.state, "", historyUrl);
    else history.pushState(history.state, "", historyUrl);
}
