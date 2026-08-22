//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";

/** @type {import("../types.js").Command} */
export const date = {
  name: "date",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.date.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.date.tldr.ex.basic", cmd: "date" },
      { labelKey: "app.terminal.commands.date.tldr.ex.set",   cmd: "date -s \"2020-01-01 00:00:00\"" },
    ],
  },
  run: (ctx, args) => {
    const clock = ctx.os?.clock;

    if (args[0] === "-s" || args[0] === "--set") {
      const raw = args.slice(1).join(" ").trim();
      if (!raw) throw new CommandError(t("app.terminal.commands.date.err.setUsage"));

      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) throw new CommandError(t("app.terminal.commands.date.err.invalidDate", { raw }));

      if (clock?.setTime) clock.setTime(parsed.getTime());
      return parsed.toString();
    }

    return (clock?.now ? clock.now() : new Date()).toString();
  },
};
