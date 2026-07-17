//@ts-check

import { t } from "../../../../i18n/index.js";
import { readInput, splitLines } from "../lib/input.js";

/** @type {import("../types.js").Command} */
export const sort = {
  name: "sort",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.sort.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.sort.tldr.ex.basic", cmd: "sort names.txt" },
    ],
  },
  run: async (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.sort.err.noFilesystem");

    let reverse = false;
    let numeric = false;
    /** @type {string|undefined} */
    let path;

    for (const a of args) {
      if (a.startsWith("-") && a.length > 1) {
        for (const ch of a.slice(1)) {
          if (ch === "r") reverse = true;
          else if (ch === "n") numeric = true;
        }
      } else {
        path = a;
      }
    }

    const input = await readInput(ctx, fs, path);
    if (input === null) return t("app.terminal.commands.sort.usage");

    const lines = splitLines(input);
    lines.sort(numeric
      ? (a, b) => parseFloat(a) - parseFloat(b)
      : (a, b) => a.localeCompare(b));

    if (reverse) lines.reverse();

    return lines.join("\n");
  },
};
