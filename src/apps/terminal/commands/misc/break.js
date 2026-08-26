//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError, LoopControlSignal } from "../lib/errors.js";

/**
 * Parses `break`/`continue`'s optional `[n]` argument (default 1): how many
 * enclosing loops to unwind. Shared by both commands - see `continue.js`.
 * @param {string[]} args @param {string} name @param {string} usageKey
 * @returns {number}
 */
export function parseLoopControlLevel(args, name, usageKey) {
  if (args.length === 0) return 1;
  if (args.length > 1) throw new CommandError(t(usageKey));

  const n = Number(args[0]);
  if (!Number.isInteger(n) || n < 1) {
    throw new CommandError(t("app.terminal.commands.break.err.badLevel", { name, value: args[0] }));
  }
  return n;
}

/** @type {import("../types.js").Command} */
export const breakCmd = {
  name: "break",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.break.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.break.tldr.ex.basic", cmd: "for i in 1 2 3; do [ \"$i\" = 2 ] && break; echo $i; done" },
      { labelKey: "app.terminal.commands.break.tldr.ex.level", cmd: "break 2" },
    ],
  },
  // Not a real error - unwinds the call stack up to the n-th enclosing
  // runFor/runWhile (Script.js), which catches it and stops that loop; see
  // LoopControlSignal.
  run: (ctx, args) => {
    const level = parseLoopControlLevel(args, "break", "app.terminal.commands.break.usage");
    throw new LoopControlSignal("break", level);
  },
};
