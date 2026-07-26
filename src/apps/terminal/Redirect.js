//@ts-check

/**
 * @typedef {{ kind: "terminal" }} TerminalTarget
 * @typedef {{ kind: "file", path: string, mode: "w"|"a" }} FileTarget
 * @typedef {TerminalTarget | FileTarget} OutputTarget
 */

const DEV_NULL = "/dev/null";

/**
 * Resolves a stage's ordered redirect list into stdout/stderr/stdin targets.
 * Redirects are applied in order so `2>&1` captures whatever stdout target
 * is current *at that point* (POSIX fd-dup semantics) - a later `>` does not
 * retroactively change an earlier `2>&1`.
 * @param {import("./Parser.js").Redirect[]} redirects
 * @returns {{ stdout: OutputTarget, stderr: OutputTarget, stdinPath: string|null, stdinLiteral: string|null }}
 */
export function resolveRedirectTargets(redirects) {
  /** @type {OutputTarget} */
  let stdout = { kind: "terminal" };
  /** @type {OutputTarget} */
  let stderr = { kind: "terminal" };
  /** @type {string|null} */
  let stdinPath = null;
  /** @type {string|null} */
  let stdinLiteral = null;

  for (const r of redirects) {
    switch (r.type) {
      case "stdoutOverwrite": stdout = { kind: "file", path: r.path, mode: "w" }; break;
      case "stdoutAppend": stdout = { kind: "file", path: r.path, mode: "a" }; break;
      case "stderrOverwrite": stderr = { kind: "file", path: r.path, mode: "w" }; break;
      case "stderrAppend": stderr = { kind: "file", path: r.path, mode: "a" }; break;
      case "stderrToStdout": stderr = stdout; break;
      case "stdin": stdinPath = r.path; stdinLiteral = null; break;
      case "stdinLiteral": stdinLiteral = r.content; stdinPath = null; break;
    }
  }

  return { stdout, stderr, stdinPath, stdinLiteral };
}

/**
 * Writes buffered text to a file target, honoring overwrite/append mode
 * and the special /dev/null no-op sink. Uses only the existing
 * VirtualFileSystem read/write API (it has no native append).
 * @param {import("../lib/VirtualFileSystem.js").VirtualFileSystem} fs
 * @param {string} cwd
 * @param {FileTarget} target
 * @param {string} data
 */
export function flushFileTarget(fs, cwd, target, data) {
  if (target.path === DEV_NULL) return;

  const abs = fs.resolve(cwd, target.path);

  if (target.mode === "a") {
    const existing = fs.exists(abs) ? fs.readFile(abs) : "";
    fs.writeFile(abs, existing + data);
  } else {
    fs.writeFile(abs, data);
  }
}

/**
 * Reads the content for a `<file` stdin redirect. Returns "" for /dev/null.
 * @param {import("../lib/VirtualFileSystem.js").VirtualFileSystem} fs
 * @param {string} cwd
 * @param {string} path
 * @returns {string}
 */
export function readStdinFile(fs, cwd, path) {
  if (path === DEV_NULL) return "";
  const abs = fs.resolve(cwd, path);
  return fs.readFile(abs);
}

export { DEV_NULL };
