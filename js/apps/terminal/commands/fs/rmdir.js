//@ts-check

/** @type {import("../types.js").Command} */
export const rmdir = {
  name: "rmdir",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return "rmdir: no filesystem";
    if (args.length === 0) return "usage: rmdir <dir> [...]";

    for (const p of args) {
      const abs = fs.resolve(ctx.cwd, p);

      if (!fs.exists(abs)) return `rmdir: failed to remove '${p}': No such file or directory`;
      const st = fs.stat(abs);
      if (st.type !== "dir") return `rmdir: failed to remove '${p}': Not a directory`;

      const entries = fs.readdir(abs);
      if (entries.length > 0) return `rmdir: failed to remove '${p}': Directory not empty`;

      fs.rmdir(abs);
    }
  },
};
