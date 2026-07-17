//@ts-check

import { t } from "../../../../i18n/index.js";
import { readInput, splitLines } from "../lib/input.js";

/** @type {import("../types.js").Command} */
export const wc = {
  name: "wc",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.wc.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.wc.tldr.ex.basic", cmd: "wc -l log.txt" },
    ],
  },
  run: async (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.wc.err.noFilesystem");

    let showLines = false;
    let showWords = false;
    let showChars = false;
    /** @type {string|undefined} */
    let path;

    for (const a of args) {
      if (a.startsWith("-") && a.length > 1) {
        for (const ch of a.slice(1)) {
          if (ch === "l") showLines = true;
          else if (ch === "w") showWords = true;
          else if (ch === "c") showChars = true;
        }
      } else {
        path = a;
      }
    }

    if (!showLines && !showWords && !showChars) {
      showLines = showWords = showChars = true;
    }

    const input = await readInput(ctx, fs, path);
    if (input === null) return t("app.terminal.commands.wc.usage");

    const lineCount = splitLines(input).length;
    const wordCount = (input.match(/\S+/g) ?? []).length;
    const charCount = input.length;

    const parts = [];
    if (showLines) parts.push(String(lineCount));
    if (showWords) parts.push(String(wordCount));
    if (showChars) parts.push(String(charCount));
    if (path) parts.push(path);

    return parts.join("  ");
  },
};
