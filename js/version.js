// @ts-check

/**
 * @returns {string}
 */
export function version() {
  //@ts-ignore
  return import.meta.env.VITE_APP_VERSION || "development";
}
