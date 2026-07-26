//@ts-check

import { t } from "../../../../i18n/index.js";
import { readInput, splitLines } from "../lib/input.js";
import { CommandError } from "../lib/errors.js";

/** @type {import("../types.js").Command} */
export const uniq = {
  name: "uniq",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.uniq.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.uniq.tldr.ex.basic", cmd: "sort names.txt | uniq -c" },
    ],
  },
  run: async (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) throw new CommandError(t("app.terminal.commands.uniq.err.noFilesystem"));

    let showCount = false;
    /** @type {string|undefined} */
    let path;

    for (const a of args) {
      if (a === "-c") showCount = true;
      else path = a;
    }

    const input = await readInput(ctx, fs, path);
    if (input === null) throw new CommandError(t("app.terminal.commands.uniq.usage"));

    const lines = splitLines(input);
    /** @type {string[]} */
    const out = [];

    /** @type {string|null} */
    let prev = null;
    let count = 0;

    const flush = () => {
      if (prev === null) return;
      out.push(showCount ? `${String(count).padStart(4)} ${prev}` : prev);
    };

    for (const line of lines) {
      if (line === prev) {
        count++;
      } else {
        flush();
        prev = line;
        count = 1;
      }
    }
    flush();

    return out.join("\n");
  },
};
