//@ts-check

const GLOB_RE = /[*?[]/;

/**
 * @typedef {{
 *   resolve: (cwd: string, path: string) => string,
 *   exists: (path: string) => boolean,
 *   stat: (path: string) => { type: "file"|"dir" },
 *   readdir: (path: string) => string[],
 * }} GlobFs
 */

/**
 * Converts a single path-segment glob pattern (`*`, `?`, `[abc]`, `[a-z]`,
 * `[!abc]`/`[^abc]`) into an anchored RegExp matching a whole filename.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      re += ".*";
    } else if (ch === "?") {
      re += ".";
    } else if (ch === "[") {
      let j = i + 1;
      let neg = false;
      if (glob[j] === "!" || glob[j] === "^") { neg = true; j++; }
      const start = j;
      while (j < glob.length && glob[j] !== "]") j++;
      if (j >= glob.length) {
        // unterminated "[" - treat as a literal bracket
        re += "\\[";
        continue;
      }
      const body = glob.slice(start, j).replace(/\\/g, "\\\\");
      re += "[" + (neg ? "^" : "") + body + "]";
      i = j;
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + "$");
}

/**
 * Expands a pathname glob pattern (only in its final path segment - a
 * wildcard in an earlier segment, e.g. "/*\/etc", is left literal, out of
 * scope for this simulator) against the filesystem. Returns the pattern
 * unchanged, as a single-element array, when it has no glob metacharacters,
 * its directory doesn't exist, or nothing matches - matching real shells'
 * default (non-nullglob) behavior of leaving an unmatched glob literal.
 * @param {string} pattern
 * @param {{ fs: GlobFs, cwd: string }} ctx
 * @returns {string[]}
 */
export function expandGlob(pattern, { fs, cwd }) {
  if (!GLOB_RE.test(pattern)) return [pattern];

  const slash = pattern.lastIndexOf("/");
  const dirPart = slash >= 0 ? pattern.slice(0, slash + 1) : "";
  const globPart = slash >= 0 ? pattern.slice(slash + 1) : pattern;

  if (!GLOB_RE.test(globPart)) return [pattern];

  /** @type {string} */
  let absDir;
  try {
    absDir = fs.resolve(cwd, dirPart || ".");
  } catch {
    return [pattern];
  }
  if (!fs.exists(absDir) || fs.stat(absDir).type !== "dir") return [pattern];

  const re = globToRegExp(globPart);
  const showHidden = globPart.startsWith(".");

  const matches = fs.readdir(absDir)
    .filter((name) => (showHidden || !name.startsWith(".")) && re.test(name))
    .map((name) => dirPart + name);

  return matches.length ? matches : [pattern];
}

export {};
