//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";
import { parseScript, runWithReturnBoundary, wrapAppForCtx, IncompleteInputError } from "../../Script.js";

/**
 * `.`/`source` - unlike `sh script.sh` (a real, isolated subprocess: own
 * env/cwd copy, empty function table), this runs the target script's
 * statements IN THE CURRENT shell environment: `env` and `functions` are the
 * exact same (mutable) objects as the caller's, so a variable assignment or
 * `name() {...}` definition inside the sourced script is visible to the
 * caller afterward, same as if its lines had been typed directly. `cwd` and
 * (when no extra args were given to `.` itself) `positional` are copied in
 * and explicitly written back after, since - unlike env/functions - there's
 * no single shared mutable object for those (see ctx.setCwd/setPositional).
 * If args ARE given, they become the positional parameters just for the
 * call's duration (like a function call), then the caller's own are
 * restored - `.` never touches `$0` either way (POSIX: only a real new
 * process like `sh script.sh` does that).
 * `return [n]` inside ends just the sourced script (via
 * `runWithReturnBoundary`), not the caller - the other POSIX-legal target
 * for `return` besides a function call.
 * @param {import("../types.js").ShellContext} ctx @param {string[]} args
 * @param {string} programName
 */
async function runSourced(ctx, args, programName) {
  const [path, ...scriptArgs] = args;
  if (!path) throw new CommandError(t("app.terminal.commands.dot.usage", { cmd: programName }));

  const fs = ctx.os.fs;
  if (!fs) throw new CommandError(t("app.terminal.commands.dot.err.noFilesystem", { cmd: programName }));

  const abs = fs.resolve(ctx.cwd, path);
  const text = fs.readFile(abs); // throws (generic error path, like cat) if missing

  /** @type {import("../../Script.js").ScriptNode[]} */
  let nodes;
  try {
    nodes = parseScript(text);
  } catch (e) {
    // Reads one complete, static file, like `sh` - no "wait for more input"
    // concept here, so a missing closing fi/done/esac is just a syntax error.
    if (e instanceof IncompleteInputError) throw new CommandError(e.message);
    throw e;
  }

  const hasOwnArgs = scriptArgs.length > 0;
  /** @type {import("../../Script.js").ScriptExecState} */
  const state = {
    app: wrapAppForCtx(ctx.app, ctx),
    env: ctx.env,
    cwd: ctx.cwd,
    pid: ctx.pid,
    positional: hasOwnArgs ? scriptArgs : ctx.positional,
    scriptName: ctx.scriptName,
    lastExitCode: 0,
    signal: ctx.signal,
    functions: ctx.functions,
    heredocs: /** @type {any} */ (nodes).heredocs ?? new Map(),
    inheritedStdin: ctx.stdin,
  };

  try {
    const ok = await runWithReturnBoundary(nodes, state);
    if (!ok) throw new CommandError(t("app.terminal.commands.dot.err.scriptFailed", { cmd: programName }));
  } finally {
    ctx.setCwd(state.cwd);
    if (!hasOwnArgs) ctx.setPositional(state.positional);
  }
}

/** @type {import("../types.js").Command} */
export const dotCmd = {
  name: ".",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.dot.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.dot.tldr.ex.basic", cmd: ". ./utils.sh" },
    ],
  },
  run: (ctx, args) => runSourced(ctx, args, "."),
};

/**
 * Bash-style alias for `.` - not POSIX-required, but cheap and expected.
 * @type {import("../types.js").Command}
 */
export const sourceCmd = {
  name: "source",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.dot.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.dot.tldr.ex.basic", cmd: "source ./utils.sh" },
    ],
  },
  run: (ctx, args) => runSourced(ctx, args, "source"),
};

export {};
