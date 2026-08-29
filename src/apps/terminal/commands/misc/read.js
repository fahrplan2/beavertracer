//@ts-check

import { CommandError } from "../lib/errors.js";

/**
 * Reads one logical line from `stdin` (following any non-raw trailing
 * backslash as a line-continuation into the next physical line, like real
 * `read`), returns `null` at immediate EOF (nothing read at all).
 * @param {import("../types.js").Reader} stdin @param {boolean} raw
 * @returns {Promise<string|null>}
 */
async function readLogicalLine(stdin, raw) {
  /** @type {string|null} */
  let full = null;
  while (true) {
    const line = await stdin.readLine();
    if (line === null) return full;
    full = (full ?? "") + line;
    if (raw) return full;

    // An ODD run of trailing backslashes means the very last one is an
    // unescaped continuation marker: drop it and keep reading. An even run
    // means they're all already paired up as escapes (self-canceling as far
    // as "is there a continuation" goes) - stop.
    const run = /\\+$/.exec(full);
    if (run && run[0].length % 2 === 1) { full = full.slice(0, -1); continue; }
    return full;
  }
}

/**
 * Splits `line` into exactly `count` fields on whitespace - matching the
 * project-wide (IFS-less, see the terminal's known POSIX gaps) convention of
 * hardcoded-whitespace field splitting. The LAST field absorbs everything
 * left over, separators included (POSIX: extra fields aren't dropped, they
 * stay attached to the last named variable).
 * @param {string} line @param {number} count
 * @returns {string[]}
 */
function splitFields(line, count) {
  if (count <= 1) return [line.trim()];

  const fields = [];
  let rest = line.trim();
  for (let i = 0; i < count - 1; i++) {
    const m = /^(\S+)\s*/.exec(rest);
    if (!m) { fields.push(""); continue; }
    fields.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  fields.push(rest);
  return fields;
}

/** @type {import("../types.js").Command} */
export const readCmd = {
  name: "read",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.read.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.read.tldr.ex.basic", cmd: "cat file.txt | while read line; do echo \"$line\"; done" },
      { labelKey: "app.terminal.commands.read.tldr.ex.vars", cmd: "read name age < info.txt" },
    ],
  },
  // Only reads from a piped/redirected/heredoc `stdin` - there's no live
  // keyboard-input capture wired into command execution here, so unlike a
  // real shell, plain `read x` typed at the interactive prompt (no stdin
  // attached) fails immediately (EOF) instead of blocking for the next line
  // the user types.
  run: async (ctx, args) => {
    let raw = false;
    let i = 0;
    while (args[i] === "-r") { raw = true; i++; }
    const names = args.slice(i);
    if (names.length === 0) names.push("REPLY");

    if (!ctx.stdin) throw new CommandError("");

    const line = await readLogicalLine(ctx.stdin, raw);
    if (line === null) throw new CommandError("");

    const unescaped = raw ? line : line.replace(/\\(.)/g, "$1");
    const fields = splitFields(unescaped, names.length);
    names.forEach((name, idx) => { ctx.env[name] = fields[idx] ?? ""; });
  },
};

export {};
