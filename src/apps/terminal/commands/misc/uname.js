//@ts-check

/** @type {import("../types.js").Command} */
export const uname = {
  name: "uname",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.uname.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.uname.tldr.ex.basic", cmd: "uname" },
      { labelKey: "app.terminal.commands.uname.tldr.ex.all",   cmd: "uname -a" },
    ],
  },
  run: (ctx, args) => {
    const a = args[0] ?? "";
    if (a === "-a") return `SimOS ${ctx.os?.name ?? "UnknownOS"} pid=${ctx.pid}`;
    return `${ctx.os?.name ?? "SimOS"}`;
  },
};
