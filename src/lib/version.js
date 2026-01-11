// @ts-check

/**
 * Returns the application version.
 *
 * @param {boolean} [short=false] If true, strips metadata after +dev
 * @returns {string}
 */
export function version(short = false) {
  // @ts-ignore
  const v = import.meta.env.VITE_APP_VERSION || "development";

  if (!short) return v;

  const devIndex = v.indexOf("+dev");
  if (devIndex === -1) {
    return v;
  }

  return v.slice(0, devIndex + 4); // "+dev".length === 4
}
