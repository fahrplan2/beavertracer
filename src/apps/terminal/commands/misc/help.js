//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const help = {
  name: "help",
  run: (ctx) => {
    const names = [...ctx.app.commands.keys()].sort();

    return [
      t("app.terminal.commands.help.header"),
      t("app.terminal.commands.help.list", { commands: names.join("  ") }),
    ].join("\n");
  },
};
