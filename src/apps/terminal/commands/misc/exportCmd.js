//@ts-check

/**
 * Named exportCmd.js (not export.js) because `export` is a reserved word -
 * the shell command name itself is still "export" via the `name` field.
 * @type {import("../types.js").Command}
 */
export const exportCmd = {
  name: "export",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.export.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.export.tldr.ex.basic", cmd: "export FOO=bar" },
    ],
  },
  run: (ctx, args) => {
    if (args.length === 0) {
      return Object.entries(ctx.env)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    }

    for (const a of args) {
      const eq = a.indexOf("=");
      if (eq === -1) continue; // `export NAME` w/o value: flat env here, no-op
      ctx.env[a.slice(0, eq)] = a.slice(eq + 1);
    }
  },
};

export {};
