//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";

/**
 * Evaluates a `test`-style expression. A "false" result is a completely
 * normal outcome (used by every `if`/`while` condition) - the caller signals
 * it via `throw new CommandError("")` (empty message: sets exit status 1
 * with no stderr output at all), never as a real error.
 * @param {string[]} args
 * @param {import("../types.js").ShellContext} ctx
 * @returns {boolean}
 */
function evaluate(args, ctx) {
  let a = args;
  let negate = false;
  if (a[0] === "!") { negate = true; a = a.slice(1); }

  const fs = ctx.os.fs;
  /** @param {string} p */
  const statOf = (p) => {
    if (!fs) return null;
    const abs = fs.resolve(ctx.cwd, p);
    return fs.exists(abs) ? fs.stat(abs) : null;
  };

  /** @type {boolean} */
  let result;

  if (a.length === 0) {
    result = false;
  } else if (a.length === 1) {
    result = a[0].length > 0;
  } else if (a.length === 2) {
    const [op, operand] = a;
    switch (op) {
      case "-z": result = operand.length === 0; break;
      case "-n": result = operand.length > 0; break;
      case "-e": result = statOf(operand) !== null; break;
      case "-f": result = statOf(operand)?.type === "file"; break;
      case "-d": result = statOf(operand)?.type === "dir"; break;
      default: throw new CommandError(t("app.terminal.commands.test.err.unknownOperator", { op }));
    }
  } else if (a.length === 3) {
    const [lhs, op, rhs] = a;
    switch (op) {
      case "=": result = lhs === rhs; break;
      case "!=": result = lhs !== rhs; break;
      case "-eq": result = Number(lhs) === Number(rhs); break;
      case "-ne": result = Number(lhs) !== Number(rhs); break;
      case "-lt": result = Number(lhs) < Number(rhs); break;
      case "-gt": result = Number(lhs) > Number(rhs); break;
      case "-le": result = Number(lhs) <= Number(rhs); break;
      case "-ge": result = Number(lhs) >= Number(rhs); break;
      default: throw new CommandError(t("app.terminal.commands.test.err.unknownOperator", { op }));
    }
  } else {
    throw new CommandError(t("app.terminal.commands.test.err.tooManyArgs"));
  }

  return negate ? !result : result;
}

/** @type {import("../types.js").Command} */
export const testCmd = {
  name: "test",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.test.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.test.tldr.ex.file", cmd: "test -f /etc/hosts" },
      { labelKey: "app.terminal.commands.test.tldr.ex.str", cmd: 'test "$x" = "y"' },
    ],
  },
  run: (ctx, args) => {
    if (!evaluate(args, ctx)) throw new CommandError("");
  },
};

/** @type {import("../types.js").Command} */
export const bracketCmd = {
  name: "[",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.bracket.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.bracket.tldr.ex.basic", cmd: "[ -d /etc ]" },
    ],
  },
  run: (ctx, args) => {
    if (args[args.length - 1] !== "]") throw new CommandError(t("app.terminal.commands.test.err.missingBracket"));
    if (!evaluate(args.slice(0, -1), ctx)) throw new CommandError("");
  },
};
