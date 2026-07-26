//@ts-check

import { expandGlob } from "./Glob.js";

/** @typedef {{ type: "stdoutOverwrite", path: string }} RedirectStdoutOverwrite */
/** @typedef {{ type: "stdoutAppend", path: string }} RedirectStdoutAppend */
/** @typedef {{ type: "stderrOverwrite", path: string }} RedirectStderrOverwrite */
/** @typedef {{ type: "stderrAppend", path: string }} RedirectStderrAppend */
/** @typedef {{ type: "stderrToStdout" }} RedirectStderrToStdout */
/** @typedef {{ type: "stdin", path: string }} RedirectStdin */
/** @typedef {{ type: "stdinLiteral", content: string }} RedirectStdinLiteral */
/**
 * @typedef {RedirectStdoutOverwrite|RedirectStdoutAppend|RedirectStderrOverwrite|RedirectStderrAppend|RedirectStderrToStdout|RedirectStdin|RedirectStdinLiteral} Redirect
 */

/**
 * @typedef {{ cmd: string, args: string[], redirects: Redirect[] }} Stage
 */

/**
 * @typedef {{ text: string, op: ";"|"&&"|"||"|null }} RawCommandListEntry
 */

/**
 * Extra, execution-time-dependent context for expansion: `fs`/`cwd` enable
 * pathname (glob) expansion, `pid`/`lastExitCode` back `$$`/`$?`,
 * `positional`/`scriptName` back `$1`-`$9`/`$@`/`$*`/`$#`/`$0` (set while a
 * script runs via `sh`, see Script.js). All optional - omitting them just
 * means `$?`/`$$`/positional params read as "0"/empty and glob patterns are
 * left literal (matches every pre-existing caller).
 * @typedef {{ fs?: import("./Glob.js").GlobFs, cwd?: string, pid?: number, lastExitCode?: number, positional?: string[], scriptName?: string, heredocs?: Map<string, { body: string, literal: boolean }> }} ExpandOpts
 */

/**
 * Finds the index of the ")" that closes a "$(" whose "(" is at
 * `line[openIdx]` - quote-aware (a ")" inside nested quotes doesn't count)
 * and paren-balanced (nested "(" is tracked), same idea as
 * `CommandSubstitution.js`'s scanner but kept local here to avoid coupling
 * the two modules. Returns `line.length` if unterminated, so callers don't
 * need a separate "malformed" branch - the rest of the line is just
 * swallowed as part of the (still unexpanded) substitution text.
 * @param {string} line @param {number} openIdx index of the "("
 * @returns {number}
 */
function findSubstitutionEnd(line, openIdx) {
  let depth = 1;
  let j = openIdx + 1;
  /** @type {null | "'" | '"'} */
  let q = null;
  while (j < line.length) {
    const c = line[j];
    if (q === "'") { if (c === "'") q = null; j++; continue; }
    if (c === "\\" && line[j + 1] !== undefined) { j += 2; continue; }
    if (q === '"') { if (c === '"') q = null; j++; continue; }
    if (c === "'" || c === '"') { q = c; j++; continue; }
    if (c === "(") { depth++; j++; continue; }
    if (c === ")") { depth--; if (depth === 0) return j; j++; continue; }
    j++;
  }
  return line.length;
}

/**
 * Expands a `$NAME`, `${NAME}`, `$?`, `$$`, `$1`-`$9`, `$@`/`$*`, `$#` or
 * `$0` reference starting at `line[i]` (which must be the `$`). Falls back
 * to a literal `$` when the reference is malformed (unterminated `${`) or
 * `$` isn't followed by a valid identifier - matching POSIX's "not an
 * expansion, just a character" rule. Unset/unknown variables expand to ""
 * (no nounset here).
 * @param {string} line
 * @param {number} i index of the "$"
 * @param {Record<string,string>} env
 * @param {ExpandOpts} opts
 * @returns {{ text: string, nextIndex: number }} nextIndex is the index of
 *   the last character consumed (i.e. the loop's `i` should become this).
 */
export function expandDollar(line, i, env, opts) {
  const next = line[i + 1];

  if (next === "?") return { text: String(opts?.lastExitCode ?? 0), nextIndex: i + 1 };
  if (next === "$") return { text: String(opts?.pid ?? 0), nextIndex: i + 1 };
  if (next === "0") return { text: opts?.scriptName ?? "sh", nextIndex: i + 1 };
  if (next === "@" || next === "*") return { text: (opts?.positional ?? []).join(" "), nextIndex: i + 1 };
  if (next === "#") return { text: String((opts?.positional ?? []).length), nextIndex: i + 1 };
  if (next !== undefined && /^[1-9]$/.test(next)) {
    return { text: opts?.positional?.[+next - 1] ?? "", nextIndex: i + 1 };
  }

  if (next === "{") {
    const end = line.indexOf("}", i + 2);
    if (end === -1) return { text: "$", nextIndex: i };
    const name = line.slice(i + 2, end);
    return { text: env[name] ?? "", nextIndex: end };
  }

  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i + 1));
  if (!m) return { text: "$", nextIndex: i };
  return { text: env[m[0]] ?? "", nextIndex: i + m[0].length };
}

/**
 * Tokenizes a shell line into words and operator tokens.
 *
 * Quoting/escaping follows a simplified POSIX subset:
 * - single quotes: fully literal, no escapes, no `$`/`~` expansion
 * - double quotes: `\"`, `\\`, `\$` are unescaped (backslash before any
 *   other character stays literal); `$NAME`/`${NAME}`/`$?`/`$$` is expanded
 * - unquoted: `\X` unescapes any next character X (space, quote, operator,
 *   `$`, ...); `$NAME`/`${NAME}`/`$?`/`$$` is expanded; a leading `~`
 *   (whole word is `~` or starts with `~/`) expands to `env.HOME`; a `#`
 *   at the start of a word starts a comment (rest of the line is dropped)
 *
 * Word tokens carry `noGlob: true` when any quote or escape was used
 * anywhere in them - such words are never pathname-expanded later (matches
 * real shells: quoting/escaping suppresses globbing too).
 *
 * Operator tokens carry `start`/`end` source positions so callers can slice
 * the original line around them (see {@link splitCommandList}) without
 * needing a full word-level parse.
 *
 * Recognized operators (outside quotes, only at a token boundary - never
 * mid-word): `|` `||` `&&` `;` `>>` `>` `<` `<<` `<<-` `2>&1` `2>>` `2>`. An unquoted
 * newline acts exactly like `;` (both a word-flush and a `;` operator token)
 * - irrelevant for single-line interactive input, but what lets
 * {@link splitCommandList} and Script.js's multi-line script parsing work
 * against the exact same tokenizer without a separate implementation.
 * @param {string} line
 * @param {Record<string,string>} env
 * @param {ExpandOpts} [opts]
 * @returns {Array<{ type: "word", value: string, noGlob: boolean, start: number, end: number } | { type: "op", value: string, start: number, end: number }>}
 */
function tokenize(line, env, opts = {}) {
  /** @type {Array<{ type: "word", value: string, noGlob: boolean, start: number, end: number } | { type: "op", value: string, start: number, end: number }>} */
  const tokens = [];
  let cur = "";
  let curHasContent = false;
  let curNoGlob = false;
  let wordStart = 0;
  /** @type {null | "'" | '"'} */
  let quote = null;

  /** @param {number} endIdx */
  const flushWord = (endIdx) => {
    if (curHasContent) {
      tokens.push({ type: "word", value: cur, noGlob: curNoGlob, start: wordStart, end: endIdx });
      cur = "";
      curHasContent = false;
      curNoGlob = false;
    }
  };

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (!curHasContent) wordStart = i;

    // Standalone $@/$* (optionally quoted: "$@") word-splits into one word
    // per positional param - the one expansion that genuinely needs to
    // produce multiple words, unlike every other $-expansion here which is
    // just inline text substitution within a single word. Only recognized
    // as a *complete* word on its own (nothing else glued to it), which
    // covers the idiomatic `for x in "$@"` / `cmd $@` usage.
    if (!curHasContent && quote === null) {
      const m = /^(?:\$[@*]|"\$[@*]")/.exec(line.slice(i));
      if (m) {
        const after = line[i + m[0].length];
        if (after === undefined || /\s/.test(after)) {
          for (const p of opts?.positional ?? []) {
            tokens.push({ type: "word", value: p, noGlob: false, start: i, end: i + m[0].length });
          }
          i += m[0].length - 1;
          continue;
        }
      }
    }

    // Unlike every other operator here (&&, ||, |, redirects - which only
    // count as operators at a token boundary, see below), an unquoted `;`
    // (and newline, which behaves exactly like it) always ends the current
    // word first: `if true; then`/`for f in a b; do` are the idiomatic,
    // near-universal way scripts write these, with no space before the `;`.
    if ((ch === ";" || ch === "\n") && quote === null) {
      flushWord(i);
      tokens.push({ type: "op", value: ";", start: i, end: i + 1 });
      continue;
    }

    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
      curHasContent = true;
      continue;
    }

    if (quote === '"') {
      if (ch === '"') { quote = null; curHasContent = true; continue; }
      const next = line[i + 1];
      if (ch === "\\" && (next === '"' || next === "\\" || next === "$")) {
        cur += next;
        i++;
        curHasContent = true;
        continue;
      }
      // "$(...)" is swallowed whole, unexpanded - command substitution is
      // resolved later by a separate text pass (CommandSubstitution.js),
      // never here. Without this, a "&&"/";"/keyword *inside* the
      // substitution would be mistaken for a top-level one by this same
      // tokenize() when splitCommandList/Script.js's parser call it to find
      // real structure.
      if (ch === "$" && next === "(") {
        const end = findSubstitutionEnd(line, i + 1);
        cur += line.slice(i, Math.min(end + 1, line.length));
        i = Math.min(end, line.length - 1);
        curHasContent = true;
        continue;
      }
      if (ch === "$") {
        const r = expandDollar(line, i, env, opts);
        cur += r.text;
        i = r.nextIndex;
        curHasContent = true;
        continue;
      }
      cur += ch;
      curHasContent = true;
      continue;
    }

    // unquoted
    if (ch === "\\") {
      const next = line[i + 1];
      if (next !== undefined) {
        cur += next;
        i++;
        curHasContent = true;
        curNoGlob = true;
        continue;
      }
      // trailing lone backslash at end of line: keep literally (no line
      // continuation support in this single-line terminal)
      cur += ch;
      curHasContent = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      curHasContent = true;
      curNoGlob = true;
      continue;
    }

    // "#" starts a comment only at the beginning of a word (POSIX rule) -
    // "echo hi#not-a-comment" keeps the "#" literal, "echo hi #comment"
    // truncates the rest of *this line* (not the rest of a multi-line
    // script - the next line's "\n" is handled normally right after).
    if (ch === "#" && !curHasContent) {
      while (i < line.length && line[i] !== "\n") i++;
      i--;
      continue;
    }

    if (ch === "~" && !curHasContent) {
      const next = line[i + 1];
      if (next === undefined || next === "/" || /\s/.test(next)) {
        cur += (env.HOME ?? "/home");
        curHasContent = true;
        continue;
      }
    }

    // "$(...)" swallowed whole, unexpanded - see the identical comment in
    // the double-quote branch above.
    if (ch === "$" && line[i + 1] === "(") {
      const end = findSubstitutionEnd(line, i + 1);
      cur += line.slice(i, Math.min(end + 1, line.length));
      i = Math.min(end, line.length - 1);
      curHasContent = true;
      continue;
    }

    // Unquoted parameter expansion undergoes POSIX field splitting: a
    // whitespace run *inside* the expanded value ends the current word and
    // starts another, even though no whitespace was actually typed there -
    // `x="a b"; echo $x` is 2 arguments, not 1. The first/last fields still
    // glue onto whatever literal text precedes/follows the "$..." in the
    // source word (`echo pre${x}post` -> "prea" "bpost"); a purely-literal
    // (no internal whitespace) expansion result is appended exactly as
    // before - this only changes behavior when splitting is actually
    // observable. $(...)/$((...)) never reach here unquoted-and-unsplit
    // like this: both are resolved as a *textual* pre-pass before this
    // tokenizer ever runs (CommandSubstitution.js/Arithmetic.js), so their
    // output already sits in `line` as plain characters and gets split by
    // the ordinary whitespace-flush path above/below, matching real shells.
    if (ch === "$") {
      const r = expandDollar(line, i, env, opts);
      i = r.nextIndex;

      if (/\s/.test(r.text)) {
        const parts = r.text.split(/\s+/);
        cur += parts[0];
        curHasContent = cur !== "";
        flushWord(i + 1);
        for (let k = 1; k < parts.length - 1; k++) {
          tokens.push({ type: "word", value: parts[k], noGlob: false, start: i + 1, end: i + 1 });
        }
        cur = parts[parts.length - 1];
        curNoGlob = false;
        curHasContent = cur !== "";
        wordStart = i + 1;
      } else {
        cur += r.text;
        curHasContent = true;
      }
      continue;
    }

    if (/\s/.test(ch)) {
      flushWord(i);
      continue;
    }

    // The remaining operators are only recognized at a token boundary (start
    // of a new word), never in the middle of a word already being
    // accumulated - unlike `;`/newline (handled above), these are rarer to
    // want directly glued to a preceding word with no space.
    if (!curHasContent) {
      if (ch === "&" && line[i + 1] === "&") { tokens.push({ type: "op", value: "&&", start: i, end: i + 2 }); i++; continue; }

      if (ch === "|") {
        if (line[i + 1] === "|") { tokens.push({ type: "op", value: "||", start: i, end: i + 2 }); i++; continue; }
        tokens.push({ type: "op", value: "|", start: i, end: i + 1 }); continue;
      }

      if (ch === ">") {
        if (line[i + 1] === ">") { tokens.push({ type: "op", value: ">>", start: i, end: i + 2 }); i++; continue; }
        tokens.push({ type: "op", value: ">", start: i, end: i + 1 });
        continue;
      }

      if (ch === "<") {
        if (line[i + 1] === "<") {
          if (line[i + 2] === "-") { tokens.push({ type: "op", value: "<<-", start: i, end: i + 3 }); i += 2; continue; }
          tokens.push({ type: "op", value: "<<", start: i, end: i + 2 }); i += 1; continue;
        }
        tokens.push({ type: "op", value: "<", start: i, end: i + 1 });
        continue;
      }

      if (ch === "2" && line[i + 1] === ">") {
        if (line[i + 2] === "&" && line[i + 3] === "1") { tokens.push({ type: "op", value: "2>&1", start: i, end: i + 4 }); i += 3; continue; }
        if (line[i + 2] === ">") { tokens.push({ type: "op", value: "2>>", start: i, end: i + 3 }); i += 2; continue; }
        tokens.push({ type: "op", value: "2>", start: i, end: i + 2 });
        i += 1;
        continue;
      }
    }

    cur += ch;
    curHasContent = true;
  }

  flushWord(line.length);
  return tokens;
}

export { tokenize };

/**
 * Expands `$VAR`/`${VAR}`/`$?`/`$$`/positional-param references in an
 * already-substituted text blob with no word-splitting, globbing or
 * operator recognition - the same treatment double-quoted content gets.
 * Used for heredoc bodies: POSIX expands an unquoted-delimiter heredoc body
 * like a double-quoted string (backslash keeps its special meaning only
 * before `$`, `` ` `` and itself; every other character, quotes included,
 * is completely literal).
 * @param {string} text @param {Record<string,string>} env @param {ExpandOpts} [opts]
 * @returns {string}
 */
export function expandHeredocBody(text, env, opts = {}) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && (text[i + 1] === "$" || text[i + 1] === "`" || text[i + 1] === "\\")) {
      out += text[i + 1];
      i++;
      continue;
    }
    if (ch === "$") {
      const r = expandDollar(text, i, env, opts);
      out += r.text;
      i = r.nextIndex;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Splits a line into raw pipeline substrings connected by `;`, `&&`, `||` -
 * purely structural (quote/escape/operator recognition only), with **no**
 * variable/tilde/glob expansion. Each `text` is a verbatim slice of the
 * original line for one pipeline.
 *
 * Expansion is deliberately deferred to {@link parsePipeline}, called once
 * per entry immediately before that entry runs (see
 * `TerminalApp._handleLine`) - not upfront for the whole line. That's what
 * lets `$?`, env changes from `export`/bare assignment, and `cd` earlier in
 * the same line be visible to later entries on that line, matching real
 * shell behavior.
 * @param {string} line
 * @returns {RawCommandListEntry[]}
 */
export function splitCommandList(line) {
  const tokens = tokenize(line, {}); // env/opts irrelevant here - word values are discarded

  /** @type {RawCommandListEntry[]} */
  const entries = [];
  let start = 0;
  /** @type {";"|"&&"|"||"|null} */
  let op = null;

  for (const tok of tokens) {
    if (tok.type === "op" && (tok.value === ";" || tok.value === "&&" || tok.value === "||")) {
      entries.push({ text: line.slice(start, tok.start).trim(), op });
      start = tok.end;
      op = tok.value;
    }
  }
  entries.push({ text: line.slice(start).trim(), op });

  return entries;
}

/**
 * Resolves one already-tokenized word into one or more final argument
 * strings: pathname (glob) expansion when `opts.fs` is set and the word
 * wasn't quoted/escaped, otherwise the word's value unchanged.
 * @param {{ value: string, noGlob: boolean }} w
 * @param {ExpandOpts} opts
 * @returns {string[]}
 */
function resolveWordToken(w, opts) {
  if (w.noGlob || !opts.fs) return [w.value];
  return expandGlob(w.value, { fs: opts.fs, cwd: opts.cwd ?? "/" });
}

/**
 * Tokenizes and fully expands a plain word list (no pipes/redirects/command
 * name - e.g. the `in word1 word2 ...` part of a `for` loop, see
 * Script.js). Any stray operator tokens (`|`, `>`, ...) are ignored rather
 * than treated as pipeline structure - this is a word-list context, not a
 * command.
 * @param {string} text
 * @param {Record<string,string>} [env]
 * @param {ExpandOpts} [opts]
 * @returns {string[]}
 */
export function expandWords(text, env = {}, opts = {}) {
  const tokens = tokenize(text, env, opts);
  /** @type {string[]} */
  const out = [];
  for (const tok of tokens) {
    if (tok.type === "word") out.push(...resolveWordToken(tok, opts));
  }
  return out;
}

/**
 * Parses and fully expands a single pipeline (stages connected by `|`, each
 * with its own redirects). `env` drives `$VAR`/`${VAR}`/`~`; `opts` adds
 * `$?`/`$$` and, when `opts.fs` is given, pathname (glob) expansion of
 * argument words (never the command name or redirect targets).
 *
 * Only ever resolves a single pipeline - if `line` contains a top-level
 * `;`/`&&`/`||` (it shouldn't, once split via {@link splitCommandList}),
 * parsing stops at the first one and only the stages built so far are
 * returned.
 * @param {string} line
 * @param {Record<string,string>} [env]
 * @param {ExpandOpts} [opts]
 * @returns {Stage[]}
 */
export function parsePipeline(line, env = {}, opts = {}) {
  const tokens = tokenize(line, env, opts);

  /** @type {Stage[]} */
  const stages = [];
  /** @type {Array<{ value: string, noGlob: boolean }>} */
  let words = [];
  /** @type {Redirect[]} */
  let redirects = [];

  const pushStage = () => {
    const cmd = words[0]?.value ?? "";
    const argWords = words.slice(1);
    const args = argWords.flatMap((w) => resolveWordToken(w, opts));
    stages.push({ cmd, args, redirects });
    words = [];
    redirects = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.type === "word") {
      words.push({ value: tok.value, noGlob: tok.noGlob });
      continue;
    }

    // operator token
    switch (tok.value) {
      case "|":
        pushStage();
        break;

      case ";":
      case "&&":
      case "||":
        pushStage();
        return stages;

      case "2>&1":
        redirects.push({ type: "stderrToStdout" });
        break;

      case ">":
      case ">>":
      case "2>":
      case "2>>":
      case "<": {
        const next = tokens[i + 1];
        const path = next && next.type === "word" ? next.value : "";
        if (next && next.type === "word") i++;

        if (tok.value === ">") redirects.push({ type: "stdoutOverwrite", path });
        else if (tok.value === ">>") redirects.push({ type: "stdoutAppend", path });
        else if (tok.value === "2>") redirects.push({ type: "stderrOverwrite", path });
        else if (tok.value === "2>>") redirects.push({ type: "stderrAppend", path });
        else redirects.push({ type: "stdin", path });
        break;
      }

      // The delimiter word here is never the literal `<<EOF` text a user
      // typed - Script.js's heredoc pre-pass (extractHeredocs) already
      // rewrote it into an inert marker before this text ever reached the
      // tokenizer, and pre-resolved+expanded the body against `opts.heredocs`
      // (see `runSimpleText`). A marker with nothing registered for it (e.g.
      // this text came from `_runNestedCapture`/`$(...)`, which doesn't run
      // that pre-pass - heredocs inside command substitution aren't
      // supported) degrades to an empty stdin rather than a crash.
      case "<<":
      case "<<-": {
        const next = tokens[i + 1];
        const marker = next && next.type === "word" ? next.value : "";
        if (next && next.type === "word") i++;
        const entry = opts.heredocs?.get(marker);
        redirects.push({ type: "stdinLiteral", content: entry?.body ?? "" });
        break;
      }
    }
  }

  pushStage();
  return stages;
}
