//@ts-check

/** @type {import("../types.js").Command} */
export const touch = {
  name: "touch",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return "touch: no filesystem";
    if (args.length === 0) return "usage: touch <file> [...]";

    for (const p of args) {
      const abs = fs.resolve(ctx.cwd, p);
      if (!fs.exists(abs)) fs.writeFile(abs, "");
      else {
        const data = fs.readFile(abs);
        fs.writeFile(abs, data);
      }
    }
  },
};
