//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";

/**
 * Expands a tr character-set spec (e.g. "a-z") into an explicit array of
 * characters, supporting simple single-range shorthand like real tr.
 * @param {string} spec
 * @returns {string[]}
 */
function expandSet(spec) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < spec.length; i++) {
    if (spec[i + 1] === "-" && spec[i + 2] !== undefined) {
      const from = spec.charCodeAt(i);
      const to = spec.charCodeAt(i + 2);
      for (let c = from; c <= to; c++) out.push(String.fromCharCode(c));
      i += 2;
    } else {
      out.push(spec[i]);
    }
  }
  return out;
}

/** @type {import("../types.js").Command} */
export const tr = {
  name: "tr",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.tr.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.tr.tldr.ex.basic", cmd: "echo hi | tr a-z A-Z" },
      { labelKey: "app.terminal.commands.tr.tldr.ex.delete", cmd: "echo a1b2 | tr -d 0-9" },
    ],
  },
  run: async (ctx, args) => {
    let del = false;
    /** @type {string[]} */
    const positional = [];

    for (const a of args) {
      if (a === "-d") del = true;
      else positional.push(a);
    }

    const [set1Spec, set2Spec] = positional;
    if (!set1Spec) throw new CommandError(t("app.terminal.commands.tr.usage"));
    if (!ctx.stdin) throw new CommandError(t("app.terminal.commands.tr.err.noStdin"));

    const input = await ctx.stdin.readAll();
    const set1 = expandSet(set1Spec);

    if (del) {
      const delSet = new Set(set1);
      return [...input].filter((ch) => !delSet.has(ch)).join("");
    }

    if (!set2Spec) throw new CommandError(t("app.terminal.commands.tr.usage"));
    const set2 = expandSet(set2Spec);
    while (set2.length < set1.length) set2.push(set2[set2.length - 1]);

    /** @type {Map<string,string>} */
    const map = new Map();
    set1.forEach((ch, i) => { if (!map.has(ch)) map.set(ch, set2[i]); });

    return [...input].map((ch) => map.get(ch) ?? ch).join("");
  },
};
