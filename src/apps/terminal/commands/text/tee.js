//@ts-check

import { t } from "../../../../i18n/index.js";
import { flushFileTarget } from "../../Redirect.js";

/** @type {import("../types.js").Command} */
export const tee = {
  name: "tee",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.tee.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.tee.tldr.ex.basic", cmd: "ls -l | tee listing.txt" },
    ],
  },
  run: async (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.tee.err.noFilesystem");

    let append = false;
    /** @type {string[]} */
    const paths = [];

    for (const a of args) {
      if (a === "-a") append = true;
      else paths.push(a);
    }

    if (paths.length === 0) return t("app.terminal.commands.tee.usage");
    if (!ctx.stdin) return t("app.terminal.commands.tee.err.noStdin");

    const input = await ctx.stdin.readAll();

    for (const path of paths) {
      flushFileTarget(fs, ctx.cwd, { kind: "file", path, mode: append ? "a" : "w" }, input);
    }

    return input;
  },
};
