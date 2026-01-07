//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const cat = {
  name: "cat",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.cat.err.noFilesystem");
    if (!args[0]) return t("app.terminal.commands.cat.usage", { cmd: "cat" });

    const abs = fs.resolve(ctx.cwd, args[0]);
    return fs.readFile(abs);
  },
};
