//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";

/** @type {import("../types.js").Command} */
export const shiftCmd = {
  name: "shift",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.shift.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.shift.tldr.ex.basic", cmd: "while [ $# -gt 0 ]; do echo $1; shift; done" },
    ],
  },
  run: (ctx, args) => {
    const n = args.length === 0 ? 1 : Number(args[0]);
    if (!Number.isInteger(n) || n < 0) {
      throw new CommandError(t("app.terminal.commands.shift.err.badCount", { value: args[0] }));
    }
    if (n > ctx.positional.length) {
      throw new CommandError(t("app.terminal.commands.shift.err.tooFar"));
    }
    ctx.setPositional(ctx.positional.slice(n));
  },
};

export {};
