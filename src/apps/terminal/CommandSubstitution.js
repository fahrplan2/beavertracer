//@ts-check

/**
 * Finds the end of a `$(...)` substitution, quote-aware (a `)` inside nested
 * quotes doesn't count, nested `$(...)` parens are balanced) so something
 * like `$(echo ")")` or `$(echo $(date))` doesn't close early. If
 * unterminated, treats the rest of the string as the inner command rather
 * than scanning forever.
 * @param {string} text
 * @param {number} start index of the first character after "$("
 * @returns {{ inner: string, nextIndex: number }} nextIndex is the index of
 *   the closing ")" itself, or `text.length - 1` if unterminated - either
 *   way the caller's loop index becomes this (its own `i++` moves past it).
 */
function scanSubstitution(text, start) {
  let depth = 1;
  let j = start;
  /** @type {null | "'" | '"'} */
  let quote = null;

  while (j < text.length) {
    const c = text[j];

    if (quote === "'") {
      if (c === "'") quote = null;
      j++;
      continue;
    }
    if (c === "\\" && text[j + 1] !== undefined) { j += 2; continue; }
    if (quote === '"') {
      if (c === '"') quote = null;
      j++;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; j++; continue; }
    if (c === "(") { depth++; j++; continue; }
    if (c === ")") {
      depth--;
      if (depth === 0) return { inner: text.slice(start, j), nextIndex: j };
      j++;
      continue;
    }
    j++;
  }

  return { inner: text.slice(start), nextIndex: text.length - 1 };
}

/**
 * Finds the end of a `` `...` `` substitution - like {@link scanSubstitution}
 * but for backticks: no paren-balancing (a backtick span just ends at the
 * next unescaped backtick), quote-aware so an embedded `` ` `` inside
 * `'...'`/`"..."` doesn't end it early, and applies POSIX's backtick-specific
 * unescaping as it goes: inside the span, `\` keeps its special meaning only
 * before `` ` ``, `$`, `\`, and (inside a nested double-quoted part) `"` -
 * every other `\X` stays literal, both characters kept.
 * @param {string} text @param {number} start index right after the opening "`"
 * @returns {{ inner: string, nextIndex: number }} nextIndex is the index of
 *   the closing "`" itself, or `text.length - 1` if unterminated.
 */
function scanBacktick(text, start) {
  let inner = "";
  let j = start;
  /** @type {null | "'" | '"'} */
  let q = null;

  while (j < text.length) {
    const c = text[j];

    if (q === "'") { inner += c; if (c === "'") q = null; j++; continue; }

    if (c === "\\" && (text[j + 1] === "`" || text[j + 1] === "$" || text[j + 1] === "\\" || (q === '"' && text[j + 1] === '"'))) {
      inner += text[j + 1];
      j += 2;
      continue;
    }

    if (q === '"') { if (c === '"') q = null; inner += c; j++; continue; }
    if (c === "'" || c === '"') { q = c; inner += c; j++; continue; }
    if (c === "`") return { inner, nextIndex: j };

    inner += c;
    j++;
  }

  return { inner, nextIndex: text.length - 1 };
}

/**
 * Scans `text` for `$(...)` and `` `...` `` command substitutions - quote-
 * aware: skipped (left completely untouched) inside single quotes, expanded
 * inside double quotes or unquoted, same suppression rule as `$VAR`
 * expansion - and replaces each with the string returned by
 * `runNested(innerText)`. Backticks are POSIX's older substitution syntax,
 * equivalent to `$(...)` but without paren-balancing and with their own
 * backslash-escaping rule (see {@link scanBacktick}); `$(...)` is preferred
 * by everything this shell itself generates, but both are recognized here
 * since real scripts (and habit) still use backticks.
 *
 * This is a pure text pre-processing step that runs BEFORE `parsePipeline`
 * ever sees the line: it only replaces the `$(...)` span itself, leaving
 * any surrounding quote characters untouched. That's what makes normal
 * quoting rules "just work" afterwards - `echo "$(echo a b)"` becomes
 * `echo "a b"` (one argument once tokenized), while `echo $(echo a b)`
 * becomes `echo a b` (two arguments, word-split - matches real shells).
 *
 * Nested substitutions (`$(echo $(date))`) work naturally: `runNested` is
 * expected to run this same scanner on its `innerText` before executing it.
 * @param {string} text
 * @param {(innerText: string) => Promise<string>} runNested
 * @returns {Promise<string>}
 */
export async function expandCommandSubstitutions(text, runNested) {
  let out = "";
  /** @type {null | "'" | '"'} */
  let quote = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote === "'") {
      out += ch;
      if (ch === "'") quote = null;
      continue;
    }

    if (ch === "\\" && text[i + 1] !== undefined) {
      out += ch + text[i + 1];
      i++;
      continue;
    }

    if (quote === '"' && ch === '"') { quote = null; out += ch; continue; }
    if (!quote && (ch === "'" || ch === '"')) { quote = ch; out += ch; continue; }

    // "$((...))" is arithmetic expansion (Arithmetic.js), not command
    // substitution - left completely untouched here (including the outer
    // "$((".."))"), even though "$(" + "(" would otherwise match the branch
    // below and misinterpret "(expr)" as a command to run. The depth-2 nested
    // paren still balances out correctly via the same scanner, so reusing it
    // just to find where the untouched span ends is safe.
    if (ch === "$" && text[i + 1] === "(" && text[i + 2] === "(") {
      const { nextIndex } = scanSubstitution(text, i + 2);
      out += text.slice(i, nextIndex + 1);
      i = nextIndex;
      continue;
    }

    if (ch === "$" && text[i + 1] === "(") {
      const { inner, nextIndex } = scanSubstitution(text, i + 2);
      out += await runNested(inner);
      i = nextIndex;
      continue;
    }

    // Backtick substitution is suppressed inside single quotes exactly like
    // $(...) (the `quote === "'"` branch above already `continue`d before
    // this point in that case) but, like $(...), still runs inside double
    // quotes - so `quote` here can only be null or '"'.
    if (ch === "`") {
      const { inner, nextIndex } = scanBacktick(text, i + 1);
      out += await runNested(inner);
      i = nextIndex;
      continue;
    }

    out += ch;
  }

  return out;
}

export {};
