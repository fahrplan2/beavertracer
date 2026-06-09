//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const man = {
  name: "man",
  category: "misc",
  tldr: {
    descKey: "app.terminal.commands.man.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.man.tldr.ex.basic", cmd: "man ping" },
    ],
  },
  run: (ctx, args) => {
    const name = args[0];
    if (!name) return t("app.terminal.commands.man.usage");

    const cmd = ctx.app.commands.get(name);
    if (!cmd) return t("app.terminal.commands.man.notFound", { name });
    if (!cmd.tldr) return t("app.terminal.commands.man.noEntry", { name });

    const lines = [`${name} – ${t(cmd.tldr.descKey)}`];
    for (const { labelKey, cmd: example } of cmd.tldr.examples) {
      lines.push("", `  ${t(labelKey)}:`, `    ${example}`);
    }
    return lines.join("\n");
  },
};
