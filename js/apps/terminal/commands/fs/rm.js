//@ts-check

/** @type {import("../types.js").Command} */
export const rm = {
  name: "rm",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return "rm: no filesystem";
    if (args.length === 0) return "usage: rm [-r|-rf] <path> [...]";

    let recursive = false;
    let force = false;
    const paths = [];

    for (const a of args) {
      if (a === "-r" || a === "-R") recursive = true;
      else if (a === "-f") force = true;
      else if (a === "-rf" || a === "-fr") { recursive = true; force = true; }
      else paths.push(a);
    }

    if (paths.length === 0) return "rm: missing operand";

    const removePath = (abs) => {
      if (!fs.exists(abs)) {
        if (!force) throw new Error(`rm: cannot remove '${abs}': No such file or directory`);
        return;
      }
      const st = fs.stat(abs);
      if (st.type === "dir") {
        if (!recursive) throw new Error(`rm: cannot remove '${abs}': Is a directory`);
        for (const name of fs.readdir(abs)) removePath(fs.resolve(abs, name));
        fs.rmdir(abs);
      } else {
        fs.unlink(abs);
      }
    };

    for (const p of paths) {
      const abs = fs.resolve(ctx.cwd, p);
      try { removePath(abs); }
      catch (e) { if (!force) return e instanceof Error ? e.message : String(e); }
    }
  },
};
