//@ts-check

import { t } from "../../../../i18n/index.js";
import { readInput, splitLines } from "../lib/input.js";
import { CommandError } from "../lib/errors.js";

/** @type {import("../types.js").Command} */
export const grep = {
  name: "grep",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.grep.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.grep.tldr.ex.basic", cmd: "grep error log.txt" },
      { labelKey: "app.terminal.commands.grep.tldr.ex.pipe", cmd: "ls -l | grep txt" },
    ],
  },
  run: async (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) throw new CommandError(t("app.terminal.commands.grep.err.noFilesystem"));

    let ignoreCase = false;
    let invert = false;
    let lineNumbers = false;
    /** @type {string[]} */
    const positional = [];

    for (const a of args) {
      if (a.startsWith("-") && a.length > 1) {
        for (const ch of a.slice(1)) {
          if (ch === "i") ignoreCase = true;
          else if (ch === "v") invert = true;
          else if (ch === "n") lineNumbers = true;
        }
      } else {
        positional.push(a);
      }
    }

    const [pattern, path] = positional;
    if (!pattern) throw new CommandError(t("app.terminal.commands.grep.usage"));

    /** @type {RegExp} */
    let re;
    try {
      re = new RegExp(pattern, ignoreCase ? "i" : "");
    } catch {
      throw new CommandError(t("app.terminal.commands.grep.err.invalidPattern", { pattern }));
    }

    const input = await readInput(ctx, fs, path);
    if (input === null) throw new CommandError(t("app.terminal.commands.grep.usage"));

    const lines = splitLines(input);
    /** @type {string[]} */
    const out = [];

    lines.forEach((line, i) => {
      if (re.test(line) !== invert) {
        out.push(lineNumbers ? `${i + 1}:${line}` : line);
      }
    });

    return out.join("\n");
  },
};
