//@ts-check

/** @type {import("../types.js").Command} */
export const date = {
  name: "date",
  run: () => new Date().toString(),
};
