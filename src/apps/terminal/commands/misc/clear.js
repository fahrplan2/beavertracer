//@ts-check

/** @type {import("../types.js").Command} */
export const clear = {
  name: "clear",
  run: (ctx) => { ctx.clear(); },
};
