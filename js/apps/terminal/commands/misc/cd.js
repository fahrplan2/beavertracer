//@ts-check

/** @type {import("../types.js").Command} */
export const cd = {
  name: "cd",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return "cd: no filesystem";

    const target = args[0] ?? "/home";
    const abs = fs.resolve(ctx.cwd, target);

    const st = fs.stat(abs);
    if (st.type !== "dir") return `cd: not a directory: ${target}`;

    ctx.setCwd(abs);
  },
};
