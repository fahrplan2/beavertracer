import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Translated courses (lessons/<lang>/) must stay in step with the German
// source: same pages, same simulations, task checks, quiz types and answer
// slots — only the prose differs. Fails when a de page was changed and a
// translation wasn't updated. Languages that only have the placeholder
// page (00-index.md) aren't translations yet and are skipped.

const LESSONS = path.resolve(__dirname, "../../lessons");
const SOURCE = "de";
/** Pages that are intentionally not translated (yet). */
const UNTRANSLATED = new Set(["99-protokollunterstuetzung.md"]);

const mdFiles = (lang) => fs.readdirSync(path.join(LESSONS, lang)).filter((f) => f.endsWith(".md")).sort();
const read = (lang, file) => fs.readFileSync(path.join(LESSONS, lang, file), "utf8");

/** Language-independent skeleton of a lesson page. */
function skeleton(src) {
  return {
    directives: [...src.matchAll(/^(:::(?:sim|task|quiz|osi|evaluate|goal|tip|note|warning|danger|draft)\b[^\n]*|check: [^\n]*|url=[^\n]*|empty$|count=\d+|- \[[x ]\])/gm)]
      // callout titles and button labels are prose
      .map((m) => m[1].replace(/^(:::(?:tip|note|warning|danger|evaluate))\b.*$/, "$1")),
    gaps: (src.match(/\{[^}\n]+\}/g) ?? []).length,
    matchPairs: (src.match(/^[^\n]+ -> [^\n]+$/gm) ?? []).length,
    links: [...src.matchAll(/\]\(([\w.-]+\.html)\)/g)].map((m) => m[1]),
  };
}

const translations = fs.readdirSync(LESSONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== SOURCE && fs.existsSync(path.join(LESSONS, d.name, "01-einfuehrung.md")))
  .map((d) => d.name);

describe("lesson translations", () => {
  it("there is at least one translation to check", () => {
    expect(translations).toContain("en");
  });

  for (const lang of translations) {
    describe(lang, () => {
      const sourcePages = mdFiles(SOURCE).filter((f) => !UNTRANSLATED.has(f));

      it("has every German page under the same file name", () => {
        const own = new Set(mdFiles(lang));
        expect(sourcePages.filter((f) => !own.has(f))).toEqual([]);
      });

      it("has no pages the German course doesn't have", () => {
        const source = new Set(mdFiles(SOURCE));
        expect(mdFiles(lang).filter((f) => !source.has(f))).toEqual([]);
      });

      for (const file of sourcePages) {
        it(`${file} matches the German structure`, () => {
          if (!fs.existsSync(path.join(LESSONS, lang, file))) return; // reported above
          expect(skeleton(read(lang, file))).toEqual(skeleton(read(SOURCE, file)));
        });
      }
    });
  }
});
