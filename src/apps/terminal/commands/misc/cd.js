//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const cd = {
  name: "cd",
  category: /** @type {"fs"} */ ("fs"),
  tldr: {
    descKey: "app.terminal.commands.cd.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.cd.tldr.ex.dir",  cmd: "cd /etc" },
      { labelKey: "app.terminal.commands.cd.tldr.ex.home", cmd: "cd" },
    ],
  },
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.cd.err.noFilesystem");

    const target = args[0] ?? "/home";
    const abs = fs.resolve(ctx.cwd, target);

    const st = fs.stat(abs);
    if (st.type !== "dir") {
      return t("app.terminal.commands.cd.err.notDirectory", { path: target });
    }

    ctx.setCwd(abs);
  },
};
