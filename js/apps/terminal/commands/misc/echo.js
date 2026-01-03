//@ts-check

/** @type {import("../types.js").Command} */
export const echo = {
  name: "echo",
  run(_ctx, args) {
    return args.join(" ");
  },
};
