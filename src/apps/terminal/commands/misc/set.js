//@ts-check

/**
 * Only the positional-parameter-setting form of `set` is implemented
 * (`set -- args...` / the POSIX-legal `set args...` without `--`) plus the
 * no-args "list variables" form - real shell OPTIONS (`set -e`, `set -x`,
 * `set -u`, ...) aren't implemented at all. An option-looking first arg
 * (starts with "-" but isn't exactly "--") is silently accepted as a no-op
 * rather than rejected, so a script that defensively opens with `set -e`
 * doesn't fail outright over an unsupported option - it just runs without
 * that option's effect, same tradeoff as an unrecognized `unset -f`.
 * @type {import("../types.js").Command}
 */
export const setCmd = {
  name: "set",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.set.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.set.tldr.ex.basic", cmd: "set -- a b c" },
    ],
  },
  run: (ctx, args) => {
    if (args.length === 0) {
      return Object.entries(ctx.env)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    }

    if (args[0] === "--") { ctx.setPositional(args.slice(1)); return; }
    if (!args[0].startsWith("-")) { ctx.setPositional(args); return; }
    // Otherwise: an unsupported option list - no-op, see above.
  },
};

export {};
