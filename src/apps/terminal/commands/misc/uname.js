//@ts-check

/** @type {import("../types.js").Command} */
export const uname = {
  name: "uname",
  run: (ctx, args) => {
    const a = args[0] ?? "";
    if (a === "-a") return `SimOS ${ctx.os?.name ?? "UnknownOS"} pid=${ctx.pid}`;
    return `${ctx.os?.name ?? "SimOS"}`;
  },
};
