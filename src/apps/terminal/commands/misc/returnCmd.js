//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError, ReturnSignal } from "../lib/errors.js";

/**
 * Named returnCmd.js (not return.js) because `return` is a reserved word -
 * the shell command name itself is still "return" via the `name` field
 * (same reasoning as exportCmd.js).
 * @type {import("../types.js").Command}
 */
export const returnCmd = {
  name: "return",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.return.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.return.tldr.ex.basic", cmd: 'is_even() { [ $(($1 % 2)) = 0 ] && return 0; return 1; }' },
    ],
  },
  // Not a real error - unwinds the call stack up to the nearest enclosing
  // shell-function call or `.`/source invocation (see ReturnSignal), the two
  // POSIX-legal targets. Used outside of either, it fails the whole script
  // (see Script.js's runScript) - a narrower, simpler fallback than real
  // shells' "warn and keep going" behavior, same tradeoff break/continue
  // already made for the same "outside its valid context" case.
  run: (ctx, args) => {
    if (args.length > 1) throw new CommandError(t("app.terminal.commands.return.usage"));
    if (args.length === 0) throw new ReturnSignal(null);

    const n = Number(args[0]);
    if (!Number.isInteger(n)) {
      throw new CommandError(t("app.terminal.commands.return.err.badStatus", { value: args[0] }));
    }
    // POSIX exit statuses wrap into 0-255, same as a real shell (e.g.
    // `return -1` reads back as 255 via $?).
    throw new ReturnSignal(((n % 256) + 256) % 256);
  },
};

export {};
