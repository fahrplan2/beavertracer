//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const help = {
  name: "help",
  category: "misc",
  tldr: {
    descKey: "app.terminal.commands.help.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.help.tldr.ex.basic", cmd: "help" },
    ],
  },
  run: (ctx) => {
    const cats = [
      { key: "net",  labelKey: "app.terminal.commands.help.cat.net" },
      { key: "fs",   labelKey: "app.terminal.commands.help.cat.fs" },
      { key: "misc", labelKey: "app.terminal.commands.help.cat.misc" },
    ];

    const lines = [t("app.terminal.commands.help.header"), ""];

    for (const { key, labelKey } of cats) {
      const names = [...ctx.app.commands.entries()]
        .filter(([, c]) => !c.hidden && c.category === key)
        .map(([n]) => n)
        .sort();
      if (names.length === 0) continue;
      lines.push(`${t(labelKey)}:`);
      lines.push(`  ${names.join("  ")}`);
      lines.push("");
    }

    lines.push("", t("app.terminal.commands.help.hint"));
    return lines.join("\n");
  },
};
