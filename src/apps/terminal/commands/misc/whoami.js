//@ts-check

/** @type {import("../types.js").Command} */
export const whoami = {
  name: "whoami",
  run: (ctx) => ctx.env.USER,
};
