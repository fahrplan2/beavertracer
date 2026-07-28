//@ts-check

/** @type {import("../types.js").Command} */
export const trueCmd = {
  name: "true",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.true.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.true.tldr.ex.basic", cmd: "while true; do echo hi; done" },
    ],
  },
  run: () => {},
};

export {};
