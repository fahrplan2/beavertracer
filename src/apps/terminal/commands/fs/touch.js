//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const touch = {
  name: "touch",
  category: /** @type {"fs"} */ ("fs"),
  tldr: {
    descKey: "app.terminal.commands.touch.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.touch.tldr.ex.basic", cmd: "touch datei.txt" },
      { labelKey: "app.terminal.commands.touch.tldr.ex.multi", cmd: "touch a.txt b.txt c.txt" },
    ],
  },
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.touch.err.noFilesystem");
    if (args.length === 0) return t("app.terminal.commands.touch.usage");

    for (const p of args) {
      const abs = fs.resolve(ctx.cwd, p);
      if (!fs.exists(abs)) {
        fs.writeFile(abs, "");
      } else {
        const data = fs.readFile(abs);
        fs.writeFile(abs, data);
      }
    }
  },
};
