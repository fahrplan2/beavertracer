//@ts-check

/** @type {import("../types.js").Command} */
export const exit = {
  name: "exit",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.exit.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.exit.tldr.ex.basic", cmd: "exit" },
    ],
  },
  run(_ctx, args) {
    _ctx.os.focus();
    _ctx.clear();
  },
};
