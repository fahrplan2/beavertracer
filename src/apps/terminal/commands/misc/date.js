//@ts-check

/** @type {import("../types.js").Command} */
export const date = {
  name: "date",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.date.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.date.tldr.ex.basic", cmd: "date" },
    ],
  },
  run: () => new Date().toString(),
};
