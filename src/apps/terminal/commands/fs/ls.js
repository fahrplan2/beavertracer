//@ts-check

import { t } from "../../../../i18n/index.js";

/** @type {import("../types.js").Command} */
export const ls = {
  name: "ls",
  run: (ctx, args) => {
    const fs = ctx.os.fs;
    if (!fs) return t("app.terminal.commands.ls.err.noFilesystem");

    let longFormat = false;
    let showAll = false;
    const paths = [];

    for (const a of args) {
      if (a.startsWith("-")) {
        if (a.includes("l")) longFormat = true;
        if (a.includes("a")) showAll = true;
      } else {
        paths.push(a);
      }
    }

    const p = paths[0] ?? ctx.cwd;
    const abs = fs.resolve(ctx.cwd, p);
    const st = fs.stat(abs);

    if (st.type === "file") return p;

    const allEntries = fs.readdir(abs);
    const entries = showAll ? allEntries : allEntries.filter((/** @type {string} */ n) => !n.startsWith("."));

    if (!longFormat) return entries.join("  ");

    const user = ctx.env?.USER ?? "user";
    const lines = [];

    for (const name of entries) {
      const entryAbs = fs.resolve(abs, name);
      let isDir = false;
      let size = 0;
      try {
        const entrySt = fs.stat(entryAbs);
        isDir = entrySt.type === "dir";
        size = typeof entrySt.size === "number" ? entrySt.size : 0;
      } catch { /* ignore broken entries */ }

      const perm = isDir ? "drwxr-xr-x" : "-rw-r--r--";
      lines.push(`${perm}  1 ${user} ${user}  ${String(size).padStart(6)}  ${name}`);
    }

    return lines.join("\n");
  },
};
