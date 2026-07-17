//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const cat = {
  name: "cat",
  category: /** @type {"fs"} */ ("fs"),
  tldr: {
    descKey: "app.terminal.commands.cat.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.cat.tldr.ex.basic", cmd: "cat /etc/hosts" },
    ],
  },
  run: async (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.cat.err.noFilesystem");

    if (!args[0]) {
      if (!ctx.stdin) return t("app.terminal.commands.cat.usage", { cmd: "cat" });
      return ctx.stdin.readAll();
    }

    const abs = fs.resolve(ctx.cwd, args[0]);
    return fs.readFile(abs);
  },
};
