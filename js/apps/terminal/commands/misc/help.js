//@ts-check

/** @type {import("../types.js").Command} */
export const help = {
  name: "help",
  run: (ctx) => {
    const names = [...ctx.app.commands.keys()].sort();
    return ["Built-in commands:", "  " + names.join("  ")].join("\n");
  },
};
