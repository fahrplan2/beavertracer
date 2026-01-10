// @ts-check

/** @type {string} */
const APP_VERSION = globalThis.__APP_VERSION__;

/** @returns {string} */
export function version() {
  return APP_VERSION || "development";
}
