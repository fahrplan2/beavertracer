//@ts-check

import { t } from "../../i18n/index.js";
import { resolveRedirectTargets, flushFileTarget, readStdinFile } from "./Redirect.js";
import { CommandError } from "./commands/lib/errors.js";

/**
 * Matches a bare `NAME=value` word - a stage consisting of exactly this one
 * word (no other args) is a variable assignment, not a command lookup.
 * `NAME=value cmd args` (temporary per-command env prefix) is not supported -
 * it falls through to a normal (failing) command lookup for "NAME=value".
 */
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * @typedef {import("./Parser.js").Stage} Stage
 * @typedef {import("./commands/types.js").Writer} Writer
 * @typedef {import("./commands/types.js").Reader} Reader
 * @typedef {import("./commands/types.js").ShellContext} ShellContext
 */

/**
 * Minimal in-memory async line queue. Producer calls write()/close(),
 * consumer calls readLine()/readAll(). No backpressure - text is buffered
 * until consumed, matching the small, non-adversarial workloads here.
 */
export class LineStream {
  /** @type {string} */
  #pending = "";
  /** @type {string[]} */
  #lines = [];
  /** @type {boolean} */
  #closed = false;
  /** @type {Array<(line: string|null) => void>} */
  #waiters = [];

  /** @param {string} text */
  write(text) {
    if (this.#closed || !text) return;
    this.#pending += text;
    let idx;
    while ((idx = this.#pending.indexOf("\n")) !== -1) {
      this.#lines.push(this.#pending.slice(0, idx));
      this.#pending = this.#pending.slice(idx + 1);
    }
    this.#drainWaiters();
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#pending.length) {
      this.#lines.push(this.#pending);
      this.#pending = "";
    }
    this.#drainWaiters();
  }

  #drainWaiters() {
    while (this.#waiters.length && (this.#lines.length || this.#closed)) {
      const resolve = /** @type {(line: string|null) => void} */ (this.#waiters.shift());
      resolve(this.#lines.length ? /** @type {string} */ (this.#lines.shift()) : null);
    }
  }

  /** @returns {Promise<string|null>} */
  readLine() {
    if (this.#lines.length) return Promise.resolve(/** @type {string} */ (this.#lines.shift()));
    if (this.#closed) return Promise.resolve(null);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  /** @returns {Promise<string>} */
  async readAll() {
    /** @type {string[]} */
    const out = [];
    /** @type {string|null} */
    let line;
    while ((line = await this.readLine()) !== null) out.push(line);
    return out.join("\n");
  }
}

/**
 * One-shot reader pre-loaded with the full content of a `<file` redirect.
 * @param {string} content
 * @returns {LineStream}
 */
function fileReader(content) {
  const s = new LineStream();
  s.write(content);
  s.close();
  return s;
}

/**
 * Writer that accumulates text in memory for later flush to a file.
 * @returns {{ writer: Writer, getData: () => string }}
 */
function bufferWriter() {
  let data = "";
  return {
    writer: {
      print: (text = "") => { data += text; },
      println: (text = "") => { data += text + "\n"; },
    },
    getData: () => data,
  };
}

/**
 * Writer that pushes text straight into a LineStream (pipe to next stage).
 * @param {LineStream} stream
 * @returns {Writer}
 */
function streamWriter(stream) {
  return {
    print: (text = "") => stream.write(text),
    println: (text = "") => stream.write(text + "\n"),
  };
}

/**
 * Writer that renders straight to the terminal in the given color.
 * @param {import("../TerminalApp.js").TerminalApp} app
 * @param {"0"|"1"} color
 * @returns {Writer}
 */
function terminalWriter(app, color) {
  return {
    print: (text = "") => app.print(text, color),
    println: (text = "") => app.println(text, color),
  };
}

/**
 * Runs a parsed command pipeline. Stages execute concurrently so a slow
 * producer (e.g. ping) and a fast consumer genuinely interleave - this is
 * what makes `|` a real stream rather than buffer-then-forward.
 *
 * stderr never flows through a pipe: it always resolves to the terminal
 * (red) or an explicit 2>/2>> redirect, for every stage, not just the last.
 *
 * Returns whether the pipeline succeeded - the exit status of its *last*
 * stage, matching the default (non-pipefail) shell convention - so callers
 * can implement `;`/`&&`/`||` sequencing.
 *
 * @param {import("../TerminalApp.js").TerminalApp} app
 * @param {Stage[]} stages
 * @param {(overrides: Partial<ShellContext>) => ShellContext} buildCtx
 * @param {(name: string) => import("./commands/types.js").Command | undefined} [resolveFunction]
 *   Looks up a user-defined shell function (`name() { ...; }`, see
 *   Script.js's `makeFunctionResolver`) by name, wrapped to look exactly
 *   like a builtin `Command`. Checked *before* `app.commands` so a function
 *   can shadow a builtin - matching real shells letting you override e.g.
 *   `ls` with a function of the same name.
 * @param {Reader|null} [inheritedStdin]
 *   Falls back to this as stage 0's stdin when it has no `<`/heredoc
 *   redirect of its own - used to pipe input into a shell function or a
 *   whole `sh` script (`echo hi | myfunc`, `echo hi | sh script.sh`), whose
 *   own commands otherwise have no way to see a pipe from *before* the call
 *   (this pipeline is a brand new one, built fresh for whatever simple
 *   statement is executing inside the function/script). The same Reader is
 *   reused for every stage-0 lookup across the whole call (not one per
 *   statement) so a second read after the first already consumed it sees
 *   EOF immediately - matching a real inherited fd.
 * @returns {Promise<boolean>}
 */
export async function runPipeline(app, stages, buildCtx, resolveFunction, inheritedStdin) {
  const fs = app.os.fs;
  const cwd = app.cwd;

  /** @type {LineStream[]} */
  const pipes = [];
  for (let i = 0; i < stages.length - 1; i++) pipes.push(new LineStream());

  /** @type {Array<{ flush: () => void }>} */
  const pendingFlushes = [];

  /**
   * Resolves an output target to an actual Writer, deduping by target
   * object identity so `2>&1` merges stdout+stderr into the same
   * destination (including piping stderr downstream when stdout is piped).
   * @type {Map<import("./Redirect.js").OutputTarget, Writer>}
   */
  const writerCache = new Map();

  /**
   * @param {import("./Redirect.js").OutputTarget} target
   * @param {boolean} isStdout
   * @param {number} stageIndex
   * @returns {Writer}
   */
  const resolveWriter = (target, isStdout, stageIndex) => {
    const cached = writerCache.get(target);
    if (cached) return cached;

    if (target.kind === "file") {
      const { writer, getData } = bufferWriter();
      writerCache.set(target, writer);
      pendingFlushes.push({
        flush: () => {
          try {
            flushFileTarget(fs, cwd, target, getData());
          } catch (e) {
            app.println(t("app.terminal.err.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }), "1");
          }
        },
      });
      return writer;
    }

    // kind === "terminal": non-last stage's stdout defaults into the pipe;
    // everything else (stderr, or the last stage's stdout) goes to the terminal.
    if (isStdout && stageIndex < stages.length - 1) {
      const writer = streamWriter(pipes[stageIndex]);
      writerCache.set(target, writer);
      return writer;
    }

    const writer = terminalWriter(app, isStdout ? "0" : "1");
    writerCache.set(target, writer);
    return writer;
  };

  let lastStageOk = true;

  const runners = stages.map(async (stage, i) => {
    const { stdout, stderr, stdinPath, stdinLiteral } = resolveRedirectTargets(stage.redirects);

    // Order matters: resolve stdout first so a `2>&1` (same target object as
    // stdout) reuses the already-decided pipe-vs-terminal-vs-file writer.
    const stdoutWriter = resolveWriter(stdout, true, i);
    const stderrWriter = resolveWriter(stderr, false, i);

    /** @type {Reader|null} */
    let stdin = null;
    let skip = false;
    let ok = true;

    if (stdinLiteral !== null) {
      stdin = fileReader(stdinLiteral);
    } else if (stdinPath !== null) {
      try {
        stdin = fileReader(readStdinFile(fs, cwd, stdinPath));
      } catch (e) {
        stderrWriter.println(t("app.terminal.err.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }));
        skip = true;
        ok = false;
      }
    } else if (i > 0) {
      stdin = pipes[i - 1];
    } else if (inheritedStdin) {
      stdin = inheritedStdin;
    }

    try {
      if (!skip) {
        if (stage.args.length === 0 && ASSIGNMENT_RE.test(stage.cmd)) {
          const ctx = buildCtx({
            stdout: stdoutWriter,
            stderr: stderrWriter,
            stdin,
            println: (text) => stdoutWriter.println(text ?? ""),
          });
          const eq = stage.cmd.indexOf("=");
          ctx.env[stage.cmd.slice(0, eq)] = stage.cmd.slice(eq + 1);
        } else {
          const entry = resolveFunction?.(stage.cmd) ?? app.commands.get(stage.cmd);

          if (!entry) {
            stderrWriter.println(t("app.terminal.err.commandNotFound", { cmd: stage.cmd }));
            ok = false;
          } else {
            const ctx = buildCtx({
              stdout: stdoutWriter,
              stderr: stderrWriter,
              stdin,
              println: (text) => stdoutWriter.println(text ?? ""),
            });

            const res = await entry.run(ctx, stage.args);
            if (typeof res === "string" && res.length) {
              // Commands that return constructed text (ls, pwd, echo, ...) don't
              // include a trailing newline - println() adds the one separator
              // newline they need. Commands that return raw stored content
              // (cat) may already end in "\n" - appending another would double
              // it into a spurious blank line, compounding on every re-redirect
              // (e.g. `cat a.txt > b.txt` then `cat b.txt > c.txt`).
              if (res.endsWith("\n")) stdoutWriter.print(res);
              else stdoutWriter.println(res);
            }
          }
        }
      }
    } catch (e) {
      ok = false;
      if (!app.currentAbort?.signal.aborted) {
        if (e instanceof CommandError) {
          // An empty message is a deliberate "false, but not an error" signal
          // (e.g. `test`/`[` evaluating to false for if/while) - sets exit
          // status 1 silently, with no stderr output at all.
          if (e.message) stderrWriter.println(e.message);
        } else {
          stderrWriter.println(t("app.terminal.err.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }));
        }
      }
    } finally {
      if (i < stages.length - 1) pipes[i].close();
      if (i === stages.length - 1) lastStageOk = ok;
    }
  });

  await Promise.all(runners);

  for (const { flush } of pendingFlushes) flush();

  return lastStageOk;
}

export {};
