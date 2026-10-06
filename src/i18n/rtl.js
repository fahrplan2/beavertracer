//@ts-check

/** Locales written right-to-left. Shared by the app (LessonsPanel) and the
 *  lesson build (vite-plugin-lessons.mjs) — only lesson content flips, the
 *  app chrome always stays LTR. */
const RTL_LOCALES = new Set(["ar", "fa", "he", "ur"]);

/**
 * @param {string} locale e.g. "ar", "pt-PT"
 * @returns {boolean}
 */
export function isRtlLocale(locale) {
  return RTL_LOCALES.has(locale.split("-")[0]);
}
