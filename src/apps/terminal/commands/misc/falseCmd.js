//@ts-check

import { CommandError } from "../lib/errors.js";

/** @type {import("../types.js").Command} */
export const falseCmd = {
  name: "false",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.false.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.false.tldr.ex.basic", cmd: "false || echo failed" },
    ],
  },
  // Fails without printing anything - a normal, expected outcome (like
  // test/[ evaluating to false), never an error.
  run: () => { throw new CommandError(""); },
};

export {};
