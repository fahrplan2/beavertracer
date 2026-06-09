//@ts-check

/** @type {import("../types.js").Command} */
export const clear = {
  name: "clear",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.clear.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.clear.tldr.ex.basic", cmd: "clear" },
    ],
  },
  run: (ctx) => { ctx.clear(); },
};
