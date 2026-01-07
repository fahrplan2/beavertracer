//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const ls = {
  name: "ls",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.ls.err.noFilesystem");

    const p = args[0] ?? ctx.cwd;
    const abs = fs.resolve(ctx.cwd, p);
    const st = fs.stat(abs);

    if (st.type === "file") return p;
    return fs.readdir(abs).join("  ");
  },
};
