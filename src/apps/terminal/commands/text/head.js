//@ts-check

import { t } from "../../../../i18n/index.js";
import { readInput, splitLines } from "../lib/input.js";

/** @type {import("../types.js").Command} */
export const head = {
  name: "head",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.head.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.head.tldr.ex.basic", cmd: "head -n 5 log.txt" },
    ],
  },
  run: async (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.head.err.noFilesystem");

    let n = 10;
    /** @type {string|undefined} */
    let path;

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-n") { n = parseInt(args[++i], 10) || n; }
      else if (/^-\d+$/.test(a)) { n = parseInt(a.slice(1), 10); }
      else path = a;
    }

    const input = await readInput(ctx, fs, path);
    if (input === null) return t("app.terminal.commands.head.usage");

    return splitLines(input).slice(0, n).join("\n");
  },
};
