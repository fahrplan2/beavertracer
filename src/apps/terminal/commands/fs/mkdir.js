//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const mkdir = {
  name: "mkdir",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.mkdir.err.noFilesystem");
    if (args.length === 0) return t("app.terminal.commands.mkdir.usage");

    let recursive = false;
    const paths = [];

    for (const a of args) {
      if (a === "-p") recursive = true;
      else paths.push(a);
    }

    if (paths.length === 0) return t("app.terminal.commands.mkdir.err.missingOperand");

    for (const p of paths) {
      const abs = fs.resolve(ctx.cwd, p);
      fs.mkdir(abs, { recursive });
    }
  },
};
