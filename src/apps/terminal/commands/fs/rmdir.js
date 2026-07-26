//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";

/** @type {import("../types.js").Command} */
export const rmdir = {
  name: "rmdir",
  category: /** @type {"fs"} */ ("fs"),
  tldr: {
    descKey: "app.terminal.commands.rmdir.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.rmdir.tldr.ex.basic", cmd: "rmdir leerer_ordner" },
    ],
  },
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) throw new CommandError(t("app.terminal.commands.rmdir.err.noFilesystem"));
    if (args.length === 0) throw new CommandError(t("app.terminal.commands.rmdir.usage"));

    for (const p of args) {
      const abs = fs.resolve(ctx.cwd, p);

      if (!fs.exists(abs)) {
        throw new CommandError(t("app.terminal.commands.rmdir.err.noSuchFile", { path: p }));
      }

      const st = fs.stat(abs);
      if (st.type !== "dir") {
        throw new CommandError(t("app.terminal.commands.rmdir.err.notDirectory", { path: p }));
      }

      const entries = fs.readdir(abs);
      if (entries.length > 0) {
        throw new CommandError(t("app.terminal.commands.rmdir.err.notEmpty", { path: p }));
      }

      fs.rmdir(abs);
    }
  },
};
