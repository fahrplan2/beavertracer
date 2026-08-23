//@ts-check

/** @type {import("../types.js").Command} */
export const hostname = {
  name: "hostname",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.hostname.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.hostname.tldr.ex.basic", cmd: "hostname" },
    ],
  },
  run: (ctx) => ctx.os?.name ?? "localhost",
};
