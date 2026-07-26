//@ts-check

/** @type {import("../types.js").Command} */
export const envCmd = {
  name: "env",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.env.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.env.tldr.ex.basic", cmd: "env" },
    ],
  },
  run: (ctx) =>
    Object.entries(ctx.env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
};

export {};
