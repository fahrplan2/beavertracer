//@ts-check

/** @type {import("../types.js").Command} */
export const pwd = {
  name: "pwd",
  run: (ctx) => ctx.cwd,
};
