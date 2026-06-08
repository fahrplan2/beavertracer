//@ts-check
import { ss } from "./ss.js";

/** @type {import("../types.js").Command} */
export const netstat = {
  name: "netstat",
  category: "net",
  tldr: {
    descKey: "app.terminal.commands.netstat.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.netstat.tldr.ex.all", cmd: "netstat" },
      { labelKey: "app.terminal.commands.netstat.tldr.ex.tcp", cmd: "netstat -t" },
    ],
  },
  run: (ctx, args) => ss.run(ctx, args),
};
