//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";

/** @type {import("../types.js").Command} */
export const cd = {
  name: "cd",
  category: /** @type {"fs"} */ ("fs"),
  tldr: {
    descKey: "app.terminal.commands.cd.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.cd.tldr.ex.dir",  cmd: "cd /etc" },
      { labelKey: "app.terminal.commands.cd.tldr.ex.home", cmd: "cd" },
      { labelKey: "app.terminal.commands.cd.tldr.ex.back",  cmd: "cd -" },
    ],
  },
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) throw new CommandError(t("app.terminal.commands.cd.err.noFilesystem"));

    // `~`/`~/...` already arrive expanded (general tilde expansion happens
    // in the parser) - only "-" (previous directory) needs handling here.
    let target = args[0] ?? "/home";
    let printResult = false;

    if (target === "-") {
      if (!ctx.env.OLDPWD) throw new CommandError(t("app.terminal.commands.cd.err.noOldPwd"));
      target = ctx.env.OLDPWD;
      printResult = true;
    }

    const abs = fs.resolve(ctx.cwd, target);

    const st = fs.stat(abs);
    if (st.type !== "dir") {
      throw new CommandError(t("app.terminal.commands.cd.err.notDirectory", { path: target }));
    }

    ctx.env.OLDPWD = ctx.cwd;
    ctx.setCwd(abs);

    if (printResult) return abs;
  },
};
