//@ts-check

/**
 * Reads a command's input: from a file argument if given, otherwise from
 * a piped stdin. Returns null when neither is available (caller should
 * show its usage message in that case).
 * @param {import("../types.js").ShellContext} ctx
 * @param {*} fs
 * @param {string|undefined} path
 * @returns {Promise<string|null>}
 */
export async function readInput(ctx, fs, path) {
  if (path) return fs.readFile(fs.resolve(ctx.cwd, path));
  if (ctx.stdin) return ctx.stdin.readAll();
  return null;
}

/**
 * Splits text into logical lines. A single optional trailing newline does
 * not count as an extra empty line (matches how text files are normally
 * terminated).
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  if (!text) return [];
  return text.replace(/\n$/, "").split("\n");
}

export {};
