/**
 * lesson-skeleton.mjs
 * Language-independent skeleton of a lesson page, shared by the translation
 * parity test (tests/lessons/translationParity.test.js) and the translation
 * script (scripts/translate-lessons-via-claude.mjs): same simulations, task
 * checks, quiz types and answer slots — only the prose differs.
 */

/** Pages that are intentionally not translated (yet). */
export const UNTRANSLATED = new Set(["99-protokollunterstuetzung.md"]);

/** @param {string} src */
export function skeleton(src) {
  return {
    directives: [...src.matchAll(/^(:::(?:sim|task|quiz|osi|evaluate|goal|tip|note|warning|danger|draft)\b[^\n]*|check: [^\n]*|url=[^\n]*|empty$|count=\d+|- \[[x ]\])/gm)]
      // callout titles and button labels are prose
      .map((m) => m[1].replace(/^(:::(?:tip|note|warning|danger|evaluate))\b.*$/, "$1")),
    gaps: (src.match(/\{[^}\n]+\}/g) ?? []).length,
    matchPairs: (src.match(/^[^\n]+ -> [^\n]+$/gm) ?? []).length,
    links: [...src.matchAll(/\]\(([\w.-]+\.html)\)/g)].map((m) => m[1]),
  };
}

/**
 * Human-readable list of skeleton differences (empty when they match).
 * @param {ReturnType<typeof skeleton>} want @param {ReturnType<typeof skeleton>} got
 */
export function skeletonDiff(want, got) {
  const out = [];
  for (const key of /** @type {const} */ (["gaps", "matchPairs"])) {
    if (want[key] !== got[key]) out.push(`${key}: expected ${want[key]}, got ${got[key]}`);
  }
  for (const key of /** @type {const} */ (["directives", "links"])) {
    const a = want[key], b = got[key];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) {
        out.push(`${key}[${i}]: expected ${JSON.stringify(a[i] ?? null)}, got ${JSON.stringify(b[i] ?? null)}`);
        break; // the first mismatch is enough, the rest usually just shifts
      }
    }
  }
  return out;
}
