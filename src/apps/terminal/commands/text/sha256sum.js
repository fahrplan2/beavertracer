//@ts-check

import { t } from "../../../../i18n/index.js";
import { readInput } from "../lib/input.js";
import { CommandError } from "../lib/errors.js";

/** @param {string} text */
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** @type {import("../types.js").Command} */
export const sha256sum = {
  name: "sha256sum",
  category: /** @type {"text"} */ ("text"),
  tldr: {
    descKey: "app.terminal.commands.sha256sum.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.sha256sum.tldr.ex.file", cmd: "sha256sum notes.txt" },
      { labelKey: "app.terminal.commands.sha256sum.tldr.ex.text", cmd: "echo Hallo | sha256sum" },
    ],
  },
  run: async (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) throw new CommandError(t("app.terminal.commands.sha256sum.err.noFilesystem"));

    const paths = args.filter(a => !(a.startsWith("-") && a.length > 1));
    if (paths.length === 0) {
      const input = await readInput(ctx, fs, undefined);
      if (input === null) throw new CommandError(t("app.terminal.commands.sha256sum.usage"));
      return `${await sha256Hex(input)}  -`;
    }

    const lines = [];
    for (const path of paths) {
      let input;
      try {
        input = await readInput(ctx, fs, path);
      } catch {
        throw new CommandError(t("app.terminal.commands.sha256sum.err.noFile", { path }));
      }
      lines.push(`${await sha256Hex(input ?? "")}  ${path}`);
    }
    return lines.join("\n");
  },
};
