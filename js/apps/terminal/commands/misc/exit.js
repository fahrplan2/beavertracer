//@ts-check

/** @type {import("../types.js").Command} */
export const exit = {
  name: "exit",
  run(_ctx, args) {
    _ctx.os.focus();
    _ctx.clear();
  },
};
