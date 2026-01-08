/**
 * @returns {string}
 */
export function version() {
  try {
    // @ts-ignore
    return import.meta.env?.VITE_APP_VERSION || "development";
  } catch {
    return "development";
  }
}