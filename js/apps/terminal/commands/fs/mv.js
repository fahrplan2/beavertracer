//@ts-check

/** @type {import("../types.js").Command} */
export const mv = {
  name: "mv",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return "mv: no filesystem";
    if (args.length < 2) return "usage: mv <src>... <dst>";

    const dstArg = args[args.length - 1];
    const srcArgs = args.slice(0, -1);

    const dstAbs = fs.resolve(ctx.cwd, dstArg);
    const dstExists = fs.exists(dstAbs);
    const dstIsDir = dstExists && fs.stat(dstAbs).type === "dir";

    const removePath = (abs) => {
      if (!fs.exists(abs)) return;
      const st = fs.stat(abs);
      if (st.type === "dir") {
        for (const name of fs.readdir(abs)) removePath(fs.resolve(abs, name));
        fs.rmdir(abs);
      } else {
        fs.unlink(abs);
      }
    };

    const copyOne = (srcAbs, dstAbsLocal) => {
      if (!fs.exists(srcAbs)) throw new Error(`mv: cannot stat '${srcAbs}': No such file or directory`);
      const st = fs.stat(srcAbs);

      if (st.type === "dir") {
        if (!fs.exists(dstAbsLocal)) fs.mkdir(dstAbsLocal, { recursive: true });
        else if (fs.stat(dstAbsLocal).type !== "dir") {
          throw new Error(`mv: cannot overwrite non-directory '${dstAbsLocal}' with directory '${srcAbs}'`);
        }

        for (const name of fs.readdir(srcAbs)) {
          copyOne(fs.resolve(srcAbs, name), fs.resolve(dstAbsLocal, name));
        }
        return;
      }

      const data = fs.readFile(srcAbs);
      fs.writeFile(dstAbsLocal, data);
    };

    if (srcArgs.length > 1 && !dstIsDir) return `mv: target '${dstArg}' is not a directory`;

    for (const srcArg of srcArgs) {
      const srcAbs = fs.resolve(ctx.cwd, srcArg);
      let finalDst = dstAbs;
      if (dstIsDir) {
        const base = srcArg.split("/").filter(Boolean).pop() ?? srcArg;
        finalDst = fs.resolve(dstAbs, base);
      }

      try {
        // If your fs has rename, prefer it:
        // if (fs.rename) { fs.rename(srcAbs, finalDst); continue; }

        copyOne(srcAbs, finalDst);
        removePath(srcAbs);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }
  },
};
