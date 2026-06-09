//@ts-check

/** @type {import("../types.js").Command} */
export const whoami = {
  name: "whoami",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.whoami.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.whoami.tldr.ex.basic", cmd: "whoami" },
    ],
  },
  run: (ctx) => ctx.env.USER,
};
