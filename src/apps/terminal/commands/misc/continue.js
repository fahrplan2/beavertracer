//@ts-check

import { LoopControlSignal } from "../lib/errors.js";
import { parseLoopControlLevel } from "./break.js";

/** @type {import("../types.js").Command} */
export const continueCmd = {
  name: "continue",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.continue.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.continue.tldr.ex.basic", cmd: "for i in 1 2 3; do [ \"$i\" = 2 ] && continue; echo $i; done" },
    ],
  },
  // Not a real error - unwinds the call stack up to the n-th enclosing
  // runFor/runWhile (Script.js), which catches it and moves on to that
  // loop's next iteration; see LoopControlSignal.
  run: (ctx, args) => {
    const level = parseLoopControlLevel(args, "continue", "app.terminal.commands.continue.usage");
    throw new LoopControlSignal("continue", level);
  },
};
