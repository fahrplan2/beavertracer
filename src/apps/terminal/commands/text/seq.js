//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";

/**
 * Zero-pads `s` to `width`, keeping a leading "-" in front of the padding
 * rather than treating it as just another character (`-5` at width 3 becomes
 * `-05`, not `0-5`) - used by `-w`.
 * @param {string} s @param {number} width
 */
function padNum(s, width) {
  if (s.length >= width) return s;
  if (s.startsWith("-")) return "-" + s.slice(1).padStart(width - 1, "0");
  return s.padStart(width, "0");
}

/** @type {import("../types.js").Command} */
export const seq = {
  name: "seq",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.seq.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.seq.tldr.ex.last",  cmd: "seq 5" },
      { labelKey: "app.terminal.commands.seq.tldr.ex.range", cmd: "for i in $(seq 1 10); do echo $i; done" },
    ],
  },
  // Integer-only (like this shell's own `$((...))` arithmetic - see
  // Arithmetic.js) - no fractional FIRST/INCREMENT/LAST, unlike real GNU seq.
  run: (ctx, args) => {
    let sep = "\n";
    let equalWidth = false;
    /** @type {string[]} */
    const nums = [];

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-s") { sep = args[++i] ?? sep; }
      else if (a.startsWith("-s") && a.length > 2) { sep = a.slice(2); }
      else if (a === "-w") { equalWidth = true; }
      else if (a === "--") { nums.push(...args.slice(i + 1)); break; }
      else nums.push(a);
    }

    if (nums.length === 0 || nums.length > 3) throw new CommandError(t("app.terminal.commands.seq.usage"));
    if (!nums.every((n) => /^-?\d+$/.test(n))) {
      throw new CommandError(t("app.terminal.commands.seq.err.badArg", { value: nums.find((n) => !/^-?\d+$/.test(n)) ?? "" }));
    }

    let first = 1, increment = 1, last;
    if (nums.length === 1) { [last] = nums.map(Number); }
    else if (nums.length === 2) { [first, last] = nums.map(Number); }
    else { [first, increment, last] = nums.map(Number); }

    if (increment === 0) throw new CommandError(t("app.terminal.commands.seq.err.zeroIncrement"));

    /** @type {number[]} */
    const out = [];
    if (increment > 0) {
      for (let n = first; n <= last; n += increment) out.push(n);
    } else {
      for (let n = first; n >= last; n += increment) out.push(n);
    }
    if (out.length === 0) return "";

    let strs = out.map(String);
    if (equalWidth) {
      const width = Math.max(...strs.map((s) => s.length));
      strs = strs.map((s) => padNum(s, width));
    }

    return strs.join(sep);
  },
};

export {};
