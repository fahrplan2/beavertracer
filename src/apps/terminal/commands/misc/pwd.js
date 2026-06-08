//@ts-check

/** @type {import("../types.js").Command} */
export const pwd = {
  name: "pwd",
  category: /** @type {"fs"} */ ("fs"),
  tldr: {
    descKey: "app.terminal.commands.pwd.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.pwd.tldr.ex.basic", cmd: "pwd" },
    ],
  },
  run: (ctx) => ctx.cwd,
};
