//@ts-check

import { t } from "../../../../i18n/index.js";
import { readInput, splitLines } from "../lib/input.js";

/**
 * Parses a -f field spec like "1,3" or "2-4" into a sorted, deduped list
 * of 1-based field indices. Open-ended ranges ("3-", "-3") are not
 * supported - out of scope for this simulator.
 * @param {string} spec
 * @returns {number[]}
 */
function parseFields(spec) {
  /** @type {Set<number>} */
  const indices = new Set();

  for (const part of spec.split(",")) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const from = Math.min(+range[1], +range[2]);
      const to = Math.max(+range[1], +range[2]);
      for (let i = from; i <= to; i++) indices.add(i);
    } else {
      const n = parseInt(part, 10);
      if (!Number.isNaN(n)) indices.add(n);
    }
  }

  return [...indices].sort((a, b) => a - b);
}

/** @type {import("../types.js").Command} */
export const cut = {
  name: "cut",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.cut.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.cut.tldr.ex.basic", cmd: "cut -d: -f1,3 /etc/passwd" },
    ],
  },
  run: async (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.cut.err.noFilesystem");

    let delim = "\t";
    /** @type {string|undefined} */
    let fieldsSpec;
    /** @type {string|undefined} */
    let path;

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-d") delim = args[++i] ?? delim;
      else if (a === "-f") fieldsSpec = args[++i];
      else path = a;
    }

    if (!fieldsSpec) return t("app.terminal.commands.cut.usage");
    const fields = parseFields(fieldsSpec);

    const input = await readInput(ctx, fs, path);
    if (input === null) return t("app.terminal.commands.cut.usage");

    const out = splitLines(input).map((line) => {
      const parts = line.split(delim);
      return fields.filter((i) => i <= parts.length).map((i) => parts[i - 1]).join(delim);
    });

    return out.join("\n");
  },
};
