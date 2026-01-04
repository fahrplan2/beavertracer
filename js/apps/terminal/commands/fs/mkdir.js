//@ts-check

/** @type {import("../types.js").Command} */
export const mkdir = {
  name: "mkdir",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return "mkdir: no filesystem";
    if (args.length === 0) return "usage: mkdir [-p] <dir> [...]";

    let recursive = false;
    const paths = [];

    for (const a of args) {
      if (a === "-p") recursive = true;
      else paths.push(a);
    }

    if (paths.length === 0) return "mkdir: missing operand";

    for (const p of paths) {
      const abs = fs.resolve(ctx.cwd, p);
      fs.mkdir(abs, { recursive });
    }
  },
};
