//@ts-check

import { t } from "../../../../i18n/index.js";
import { readInput, splitLines } from "../lib/input.js";
import { CommandError } from "../lib/errors.js";

/** @type {import("../types.js").Command} */
export const tail = {
  name: "tail",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.tail.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.tail.tldr.ex.basic", cmd: "tail -n 5 log.txt" },
    ],
  },
  run: async (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) throw new CommandError(t("app.terminal.commands.tail.err.noFilesystem"));

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
    if (input === null) throw new CommandError(t("app.terminal.commands.tail.usage"));

    const lines = splitLines(input);
    return lines.slice(Math.max(0, lines.length - n)).join("\n");
  },
};
