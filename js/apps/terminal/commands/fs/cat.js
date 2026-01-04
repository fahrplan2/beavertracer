//@ts-check

/** @type {import("../types.js").Command} */
export const cat = {
  name: "cat",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return "cat: no filesystem";
    if (!args[0]) return "usage: cat <file>";

    const abs = fs.resolve(ctx.cwd, args[0]);
    return fs.readFile(abs);
  },
};
