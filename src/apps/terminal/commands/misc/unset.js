//@ts-check

/**
 * Removes one or more variables from the environment - the flat `ctx.env`
 * dict backs both plain shell variables and exported ones (see `export.js`),
 * so there's no separate "shell var vs env var" distinction to unset from.
 * Only variable removal (`-v`, the default) is supported - `-f` (remove a
 * shell function instead) is not, a narrower scope than real POSIX `unset`.
 * @type {import("../types.js").Command}
 */
export const unsetCmd = {
  name: "unset",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.unset.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.unset.tldr.ex.basic", cmd: "unset FOO" },
    ],
  },
  run: (ctx, args) => {
    for (let a of args) {
      if (a === "-v") continue; // default mode, explicit flag is a no-op
      if (a.startsWith("-")) continue; // e.g. "-f" (unset a function) - not supported, ignored rather than failing the script
      delete ctx.env[a];
    }
  },
};

export {};
