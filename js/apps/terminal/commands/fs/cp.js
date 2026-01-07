//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const cp = {
  name: "cp",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.cp.err.noFilesystem");
    if (args.length === 0) return t("app.terminal.commands.cp.usage");

    let recursive = false;
    const paths = [];
    for (const a of args) {
      if (a === "-r" || a === "-R") recursive = true;
      else paths.push(a);
    }

    if (paths.length < 2) {
      return t("app.terminal.commands.cp.err.missingDestination");
    }

    const dstArg = paths[paths.length - 1];
    const srcArgs = paths.slice(0, -1);

    const dstAbs = fs.resolve(ctx.cwd, dstArg);
    const dstExists = fs.exists(dstAbs);
    const dstIsDir = dstExists && fs.stat(dstAbs).type === "dir";

    const copyOne = (srcAbs, dstAbsLocal) => {
      if (!fs.exists(srcAbs)) {
        throw new Error(
          t("app.terminal.commands.cp.err.noSuchFile", { path: srcAbs })
        );
      }

      const st = fs.stat(srcAbs);

      if (st.type === "dir") {
        if (!recursive) {
          throw new Error(
            t("app.terminal.commands.cp.err.omitDirectory", { path: srcAbs })
          );
        }

        if (!fs.exists(dstAbsLocal)) {
          fs.mkdir(dstAbsLocal, { recursive: true });
        } else if (fs.stat(dstAbsLocal).type !== "dir") {
          throw new Error(
            t("app.terminal.commands.cp.err.overwriteNonDir", {
              dst: dstAbsLocal,
              src: srcAbs,
            })
          );
        }

        for (const name of fs.readdir(srcAbs)) {
          copyOne(
            fs.resolve(srcAbs, name),
            fs.resolve(dstAbsLocal, name)
          );
        }
        return;
      }

      const data = fs.readFile(srcAbs);
      fs.writeFile(dstAbsLocal, data);
    };

    if (srcArgs.length > 1 && !dstIsDir) {
      return t("app.terminal.commands.cp.err.targetNotDir", { target: dstArg });
    }

    for (const srcArg of srcArgs) {
      const srcAbs = fs.resolve(ctx.cwd, srcArg);
      let finalDst = dstAbs;

      if (dstIsDir) {
        const base = srcArg.split("/").filter(Boolean).pop() ?? srcArg;
        finalDst = fs.resolve(dstAbs, base);
      }

      try {
        copyOne(srcAbs, finalDst);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }
  },
};
