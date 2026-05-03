//@ts-check

/**
 * Returns true when running inside a Tauri desktop build.
 * Tauri v2 injects window.__TAURI_INTERNALS__ into the WebView;
 * this property is undefined in a regular browser.
 * @returns {boolean}
 */
export function isTauri() {
  return typeof (/** @type {any} */ (window)).__TAURI_INTERNALS__ !== "undefined";
}
