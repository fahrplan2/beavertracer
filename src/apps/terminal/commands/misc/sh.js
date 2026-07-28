//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";
import { parseScript, runScript, wrapAppForCtx, IncompleteInputError } from "../../Script.js";

const MAX_SH_DEPTH = 50;

/** @type {import("../types.js").Command} */
export const sh = {
  name: "sh",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.sh.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.sh.tldr.ex.basic", cmd: "sh script.sh" },
      { labelKey: "app.terminal.commands.sh.tldr.ex.args",  cmd: "sh script.sh arg1 arg2" },
    ],
  },
  run: async (ctx, args) => {
    const [path, ...scriptArgs] = args;
    if (!path) throw new CommandError(t("app.terminal.commands.sh.usage"));

    const depth = Number(ctx.env.__SH_DEPTH ?? "0");
    if (depth >= MAX_SH_DEPTH) throw new CommandError(t("app.terminal.commands.sh.err.tooDeep"));

    const fs = ctx.os.fs;
    if (!fs) throw new CommandError(t("app.terminal.commands.sh.err.noFilesystem"));

    const abs = fs.resolve(ctx.cwd, path);
    const text = fs.readFile(abs); // throws (generic error path, like cat) if missing

    /** @type {import("../../Script.js").ScriptNode[]} */
    let nodes;
    try {
      nodes = parseScript(text);
    } catch (e) {
      // sh reads one complete, static file - there's no "wait for more
      // input" concept here (unlike the interactive prompt), so a script
      // that's missing its closing fi/done/esac is just a syntax error.
      // IncompleteInputError's message is already fully translated (same
      // keys as every other parse error), so it's reused as-is.
      if (e instanceof IncompleteInputError) throw new CommandError(e.message);
      throw e;
    }

    // Runs isolated like a real subprocess: env/cwd are copies and functions
    // start out empty, so cd/export/assignments/`name() {...}` defs inside
    // the script never leak into the caller (and, symmetrically, the
    // caller's own shell functions aren't visible to the script either -
    // matching a real separate process, which wouldn't inherit them).
    // `app` is wrapped so the script's own commands' output goes wherever
    // THIS `sh` call's own output was directed (piped, redirected, captured)
    // instead of always straight to the terminal; `inheritedStdin` likewise
    // lets an unredirected command inside the script see stdin piped into
    // `sh` itself (`echo hi | sh script.sh`) - same reasoning as shell
    // functions, see Script.js's `makeFunctionResolver`.
    const state = {
      app: wrapAppForCtx(ctx.app, ctx),
      env: { ...ctx.env, __SH_DEPTH: String(depth + 1) },
      cwd: ctx.cwd,
      pid: ctx.pid,
      positional: scriptArgs,
      scriptName: path,
      lastExitCode: 0,
      signal: ctx.signal,
      functions: new Map(),
      heredocs: /** @type {Map<string, {body: string, literal: boolean}>} */ (
        /** @type {any} */ (nodes).heredocs ?? new Map()
      ),
      inheritedStdin: ctx.stdin,
    };

    const ok = await runScript(nodes, state);
    if (!ok) throw new CommandError(t("app.terminal.commands.sh.err.scriptFailed"));
  },
};
