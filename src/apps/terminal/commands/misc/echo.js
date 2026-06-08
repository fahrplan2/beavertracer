//@ts-check

/** @type {import("../types.js").Command} */
export const echo = {
  name: "echo",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.echo.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.echo.tldr.ex.basic", cmd: "echo Hallo Welt" },
    ],
  },
  run(_ctx, args) {
    return args.join(" ");
  },
};
