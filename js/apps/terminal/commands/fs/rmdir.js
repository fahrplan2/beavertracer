//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const rmdir = {
  name: "rmdir",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.rmdir.err.noFilesystem");
    if (args.length === 0) return t("app.terminal.commands.rmdir.usage");

    for (const p of args) {
      const abs = fs.resolve(ctx.cwd, p);

      if (!fs.exists(abs)) {
        return t("app.terminal.commands.rmdir.err.noSuchFile", { path: p });
      }

      const st = fs.stat(abs);
      if (st.type !== "dir") {
        return t("app.terminal.commands.rmdir.err.notDirectory", { path: p });
      }

      const entries = fs.readdir(abs);
      if (entries.length > 0) {
        return t("app.terminal.commands.rmdir.err.notEmpty", { path: p });
      }

      fs.rmdir(abs);
    }
  },
};
