//@ts-check

import { t } from "../../i18n/index.js";
import { tokenize, splitCommandList, parsePipeline, expandWords, expandHeredocBody } from "./Parser.js";
import { runPipeline } from "./Pipeline.js";
import { expandCommandSubstitutions } from "./CommandSubstitution.js";
import { expandArithmetic } from "./Arithmetic.js";
import { globToRegExp } from "./Glob.js";
import { CommandError, LoopControlSignal, ReturnSignal } from "./commands/lib/errors.js";
import { sleepAbortable } from "./commands/lib/abort.js";

/**
 * @typedef {{ type: "simple", text: string }} SimpleNode
 * @typedef {{ type: "if", clauses: { condText: string, body: ScriptNode[] }[], elseBody: ScriptNode[]|null }} IfNode
 * @typedef {{ type: "for", varName: string, wordsText: string, body: ScriptNode[] }} ForNode
 * @typedef {{ type: "while", condText: string, body: ScriptNode[], negate: boolean }} WhileNode
 * @typedef {{ type: "case", subjectText: string, clauses: { patterns: string[], body: ScriptNode[] }[] }} CaseNode
 * @typedef {{ type: "funcdef", name: string, body: ScriptNode[] }} FunctionDefNode
 * @typedef {SimpleNode|IfNode|ForNode|WhileNode|CaseNode|FunctionDefNode} ScriptNode
 */

/**
 * Mutable interpreter state, threaded by reference through the whole
 * recursive walk - `env`/`cwd`/`lastExitCode` are updated in place as
 * execution proceeds, so a `cd`/`export` in one statement is visible to
 * every later one in the same script. `functions` is likewise mutated in
 * place by a `name() { ... }` definition; sharing/copying it across
 * sh/`$(...)` boundaries is what gives functions the right scoping (see
 * `sh.js` and `TerminalApp._runNestedCapture`). `heredocs` is populated once,
 * up front, by `parseScript`'s heredoc pre-pass (extractHeredocs) - it never
 * changes during execution, unlike the other fields here. `inheritedStdin`
 * is normally absent/null (nothing to inherit); a function call or `sh`
 * invocation that itself received piped/redirected stdin sets it for the
 * call's duration (see `makeFunctionResolver` and `sh.js`) so the callee's
 * own first-stage commands can read it, same as a real inherited fd.
 * `loopDepth` counts currently-active enclosing runFor/runWhile calls
 * (absent/0 outside of any loop) - see `runLoopBody`. Since it lives on this
 * shared, mutable `state` rather than being passed down a call chain, a
 * function called from within a loop sees the same nonzero depth its caller
 * does, giving `break`/`continue` inside that function the same
 * caller-loop-affecting scoping real shells have (a function body itself
 * with no loop of its own doesn't reset it back to 0).
 * @typedef {{
 *   app: any,
 *   env: Record<string,string>,
 *   cwd: string,
 *   pid: number,
 *   lastExitCode: number,
 *   positional: string[],
 *   scriptName: string,
 *   signal: AbortSignal,
 *   functions: Map<string, ScriptNode[]>,
 *   heredocs: Map<string, { body: string, literal: boolean }>,
 *   inheritedStdin?: import("./commands/types.js").Reader | null,
 *   loopDepth?: number,
 * }} ScriptExecState
 */

const KEYWORDS = new Set(["if", "then", "elif", "else", "fi", "for", "in", "do", "done", "while", "until", "case", "esac"]);
const COMPOUND_START = new Set(["if", "for", "while", "until", "case"]);
const MAX_LOOP_ITERATIONS = 100000;
/** Matches one of extractHeredocs' own synthetic delimiter markers. */
const HEREDOC_MARKER_RE = /^heredoc\d+mark$/;

/**
 * @param {string} key suffix of an `app.terminal.commands.sh.err.*` key -
 *   each one is a complete, standalone translated message (own "sh: " lead-in
 *   included), not a generic wrapper - see locales/de.js and locales/en.js.
 * @param {Record<string,string>} [params]
 */
function syntaxError(key, params) {
  return new CommandError(t(`app.terminal.commands.sh.err.${key}`, params));
}

/**
 * Thrown when parsing ran out of tokens/text while a construct was still
 * open (e.g. `if true; then` with no `fi` yet) - as opposed to `CommandError`
 * (via {@link syntaxError}), which means the input seen so far is genuinely
 * wrong, no matter how much more text follows. The distinction is what lets
 * the interactive prompt tell "keep waiting for more lines" (this) apart
 * from "show the user an error now" (CommandError) - see
 * `TerminalApp._handleLine`. `sh` (which reads one complete, static file)
 * has no use for that distinction and normalizes this back into a regular
 * CommandError - see `sh.js`. Message is already fully translated (same
 * keys as {@link syntaxError}), so `sh.js` can reuse it as-is, no re-wrap.
 */
export class IncompleteInputError extends Error {}

/** @param {string} key @param {Record<string,string>} [params] */
function needMoreInput(key, params) {
  return new IncompleteInputError(t(`app.terminal.commands.sh.err.${key}`, params));
}

// ── Parser ───────────────────────────────────────────────────────────────
// Reuses Parser.js's tokenize() purely for structure (quotes/escapes,
// operator + word boundaries, source positions) - never its expanded word
// *values* for content (those may have been wrongly resolved against the
// throwaway env={} used here). Content that needs to survive to run time
// ($VAR, positional params, globs in a `for` list, ...) is always pulled as
// a raw source-text slice via token start/end and expanded later, lazily,
// exactly like splitCommandList/parsePipeline already do for `;`/`&&`/`||`.
// Keyword recognition on `tok.value` is safe even with env={}: a literal
// keyword like "if" never contains a "$", so expansion can't affect it.

/**
 * @typedef {{ tokens: ReturnType<typeof tokenize>, i: number }} ParsePos
 */

/** @param {ParsePos} pos */
function peek(pos) { return pos.tokens[pos.i]; }

/** @param {ParsePos} pos @param {string} value */
function isWordValue(pos, value) {
  const tok = peek(pos);
  return !!tok && tok.type === "word" && tok.value === value;
}

/** @param {ParsePos} pos @param {string} value */
function expectWordValue(pos, value) {
  if (!isWordValue(pos, value)) {
    const got = peek(pos);
    if (!got) throw needMoreInput("missingToken", { expected: value });
    throw syntaxError("unexpectedGotToken", { expected: value, got: got.value });
  }
  pos.i++;
}

/**
 * Raw source text between two token indices (exclusive of the token at
 * `toIdx`), trimmed. Used for anything that must stay unexpanded until run
 * time (condition text, for-loop word lists, case subject/patterns, plain
 * command chains).
 * @param {string} text @param {ParsePos["tokens"]} tokens @param {number} fromIdx @param {number} toIdx
 */
function sliceRaw(text, tokens, fromIdx, toIdx) {
  const startPos = fromIdx < tokens.length ? tokens[fromIdx].start : text.length;

  // End at the last WORD token's own end, not at tokens[toIdx].start or the
  // raw text's end: an operator token's position can be "stretched" past a
  // swallowed comment (`echo hi # trailing\n` -> the trailing ";" token for
  // that newline sits right after the comment text), and a bare ";"/newline
  // separator right before a stop keyword isn't part of the content anyway.
  let endPos = startPos;
  for (let k = Math.min(toIdx, tokens.length) - 1; k >= fromIdx; k--) {
    if (tokens[k].type === "word") { endPos = tokens[k].end; break; }
  }

  return text.slice(startPos, endPos).trim();
}

/**
 * Scans forward from `pos.i` (mutating it) for the first word token in
 * `stopWords` at command position, WITHOUT recursing into nested compound
 * commands - a condition/word-list/subject position is always a plain
 * `;`/`&&`/`||`-joined command list, never itself an `if`/`for`/etc.
 * (nesting is still fully supported in *bodies* - see {@link parseList}).
 * @param {ParsePos} pos @param {string[]} stopWords
 */
function findKeyword(pos, stopWords) {
  let atCmdPos = true;
  while (pos.i < pos.tokens.length) {
    const tok = pos.tokens[pos.i];
    if (tok.type === "op") {
      if (tok.value === ";" || tok.value === "&&" || tok.value === "||" || tok.value === "|") atCmdPos = true;
      pos.i++;
      continue;
    }
    if (atCmdPos && stopWords.includes(tok.value)) return;
    if (atCmdPos && COMPOUND_START.has(tok.value)) {
      throw syntaxError("unexpectedInCondition", { token: tok.value });
    }
    if (atCmdPos && KEYWORDS.has(tok.value)) {
      // A stray closing/other keyword (fi/done/esac/elif/else/then/do/in)
      // while still scanning for `stopWords` almost always means the
      // expected one is simply missing, e.g. "if true; echo hi; fi" (no
      // "then") - report it as "expected X, got Y", not the (wrong here)
      // "nested compound commands aren't supported" message above, which
      // is only accurate for genuine if/for/while/until/case nesting.
      throw syntaxError("unexpectedGotToken", { expected: stopWords.join("' or '"), got: tok.value });
    }
    atCmdPos = false;
    pos.i++;
  }
  throw needMoreInput("missingToken", { expected: stopWords.join("' or '") });
}

/**
 * Scans forward from `pos.i` (mutating it) for a word token with exact
 * value `stopWord`, ignoring command position entirely - unlike a
 * condition/word-list, `case`'s subject is just a plain word (or a couple
 * of them), never itself a `;`/`&&`/`||`-joined list, so "in" can
 * legitimately follow it directly with no operator in between.
 * @param {ParsePos} pos @param {string} stopWord
 */
function scanUntilWord(pos, stopWord) {
  while (pos.i < pos.tokens.length) {
    if (pos.tokens[pos.i].type === "word" && pos.tokens[pos.i].value === stopWord) return;
    pos.i++;
  }
  throw needMoreInput("missingToken", { expected: stopWord });
}

/**
 * Skips any bare ";" separators (including ones from a plain newline) -
 * used between `case ... in` and the first clause, and between clauses,
 * where such a separator is optional filler rather than meaningful
 * structure (unlike `parseList`, which uses it to reset command position).
 * @param {ParsePos} pos
 */
function skipSeparators(pos) {
  while (pos.i < pos.tokens.length && pos.tokens[pos.i].type === "op" && pos.tokens[pos.i].value === ";") {
    pos.i++;
  }
}

/**
 * Recognizes a `name() {` function-definition header at `pos.i` in either
 * spelling POSIX allows - glued (`name()`, one word) or spaced (`name`
 * then `()`, two words). Pure lookahead - never mutates `pos` itself, so a
 * caller can check this cheaply and fall through to ordinary simple-command
 * parsing on a miss (a bare word like a command name must never be consumed
 * speculatively). On a match, the caller is expected to call `flushSimple()`
 * *then* advance `pos.i` by `consumed` itself - mirrors exactly how
 * `if`/`for`/etc. are handled in {@link parseList}: flush before mutating
 * position, never after (a flush after would see the header's own tokens
 * as leftover "simple" text and wrongly re-emit them as a node).
 * @param {ParsePos} pos
 * @returns {{ name: string, consumed: number }|null}
 */
function tryConsumeFunctionHeader(pos) {
  const t0 = peek(pos);
  if (!t0 || t0.type !== "word") return null;

  const glued = /^([A-Za-z_][A-Za-z0-9_]*)\(\)$/.exec(t0.value);
  if (glued) {
    const t1 = pos.tokens[pos.i + 1];
    if (!t1 || t1.type !== "word" || t1.value !== "{") return null;
    return { name: glued[1], consumed: 2 };
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t0.value)) {
    const t1 = pos.tokens[pos.i + 1];
    const t2 = pos.tokens[pos.i + 2];
    if (t1 && t1.type === "word" && t1.value === "()" && t2 && t2.type === "word" && t2.value === "{") {
      return { name: t0.value, consumed: 3 };
    }
  }

  return null;
}

/**
 * Parses a list of statements until a word token in `stopWords` is seen at
 * command position (or, if `stopWords` is empty, until the tokens run out -
 * used for the top level of a script). Leaves `pos.i` sitting ON the
 * stopping keyword token for the caller to consume.
 * @param {ParsePos} pos @param {string} text @param {string[]} stopWords
 * @returns {ScriptNode[]}
 */
function parseList(pos, text, stopWords) {
  /** @type {ScriptNode[]} */
  const nodes = [];
  let simpleStart = pos.i;
  let atCmdPos = true;

  const flushSimple = () => {
    if (pos.i > simpleStart) {
      const raw = sliceRaw(text, pos.tokens, simpleStart, pos.i);
      if (raw) nodes.push({ type: "simple", text: raw });
    }
  };

  while (pos.i < pos.tokens.length) {
    const tok = pos.tokens[pos.i];

    if (tok.type === "op") {
      if (tok.value === ";" || tok.value === "&&" || tok.value === "||" || tok.value === "|") atCmdPos = true;
      pos.i++;
      continue;
    }

    if (atCmdPos) {
      if (stopWords.includes(tok.value)) { flushSimple(); return nodes; }

      const funcHeader = tryConsumeFunctionHeader(pos);
      if (funcHeader) {
        flushSimple();
        pos.i += funcHeader.consumed;
        const body = parseList(pos, text, ["}"]);
        expectWordValue(pos, "}");
        nodes.push({ type: "funcdef", name: funcHeader.name, body });
        simpleStart = pos.i;
        atCmdPos = true;
        continue;
      }

      if (tok.value === "if")    { flushSimple(); nodes.push(parseIf(pos, text));                    simpleStart = pos.i; atCmdPos = true; continue; }
      if (tok.value === "for")   { flushSimple(); nodes.push(parseFor(pos, text));                   simpleStart = pos.i; atCmdPos = true; continue; }
      if (tok.value === "while") { flushSimple(); nodes.push(parseWhileUntil(pos, text, false));     simpleStart = pos.i; atCmdPos = true; continue; }
      if (tok.value === "until") { flushSimple(); nodes.push(parseWhileUntil(pos, text, true));      simpleStart = pos.i; atCmdPos = true; continue; }
      if (tok.value === "case")  { flushSimple(); nodes.push(parseCase(pos, text));                  simpleStart = pos.i; atCmdPos = true; continue; }
      if (KEYWORDS.has(tok.value)) throw syntaxError("unexpectedToken", { token: tok.value });
    }

    atCmdPos = false;
    pos.i++;
  }

  flushSimple();
  if (stopWords.length > 0) throw needMoreInput("missingToken", { expected: stopWords.join("' or '") });
  return nodes;
}

/** @param {ParsePos} pos @param {string} text @returns {IfNode} */
function parseIf(pos, text) {
  pos.i++; // consume "if"
  /** @type {IfNode["clauses"]} */
  const clauses = [];

  while (true) {
    const condStart = pos.i;
    findKeyword(pos, ["then"]);
    const condText = sliceRaw(text, pos.tokens, condStart, pos.i);
    expectWordValue(pos, "then");

    const body = parseList(pos, text, ["elif", "else", "fi"]);
    clauses.push({ condText, body });

    const stop = peek(pos);
    if (!stop) throw needMoreInput("missingToken", { expected: "fi" }); // defensive - parseList above already throws if input ran out
    if (stop.value === "elif") { pos.i++; continue; }
    if (stop.value === "else") {
      pos.i++;
      const elseBody = parseList(pos, text, ["fi"]);
      expectWordValue(pos, "fi");
      return { type: "if", clauses, elseBody };
    }
    pos.i++; // "fi"
    return { type: "if", clauses, elseBody: null };
  }
}

/** @param {ParsePos} pos @param {string} text @returns {ForNode} */
function parseFor(pos, text) {
  pos.i++; // consume "for"
  const varTok = peek(pos);
  if (!varTok) throw needMoreInput("expectedForVarName");
  if (varTok.type !== "word") throw syntaxError("expectedForVarName");
  const varName = varTok.value;
  pos.i++;

  expectWordValue(pos, "in");

  const wordsStart = pos.i;
  findKeyword(pos, ["do"]);
  const wordsText = sliceRaw(text, pos.tokens, wordsStart, pos.i);
  expectWordValue(pos, "do");

  const body = parseList(pos, text, ["done"]);
  expectWordValue(pos, "done");

  return { type: "for", varName, wordsText, body };
}

/** @param {ParsePos} pos @param {string} text @param {boolean} negate @returns {WhileNode} */
function parseWhileUntil(pos, text, negate) {
  pos.i++; // consume "while"/"until"
  const condStart = pos.i;
  findKeyword(pos, ["do"]);
  const condText = sliceRaw(text, pos.tokens, condStart, pos.i);
  expectWordValue(pos, "do");

  const body = parseList(pos, text, ["done"]);
  expectWordValue(pos, "done");

  return { type: "while", condText, body, negate };
}

/** @param {ParsePos} pos @param {string} text @returns {CaseNode} */
function parseCase(pos, text) {
  pos.i++; // consume "case"
  const subjStart = pos.i;
  scanUntilWord(pos, "in");
  const subjectText = sliceRaw(text, pos.tokens, subjStart, pos.i);
  expectWordValue(pos, "in");
  skipSeparators(pos);

  /** @type {CaseNode["clauses"]} */
  const clauses = [];

  while (!isWordValue(pos, "esac")) {
    const patterns = parseCasePatterns(pos, text);
    const body = parseCaseClauseBody(pos, text);
    clauses.push({ patterns, body });
    skipSeparators(pos);
  }
  pos.i++; // consume "esac"

  return { type: "case", subjectText, clauses };
}

/**
 * Parses `pattern1|pattern2)` right up to (and consuming) the closing ")".
 * Works directly off raw source characters rather than tokens: the
 * idiomatic style glues patterns tightly together with "|" and no spaces
 * (`foo|bar)`), which the general tokenizer won't split out as separate
 * tokens (operators there need a token boundary); our own parens aren't a
 * tokenizer concept at all. Known simplification: a literal ")" inside a
 * quoted pattern would end the scan early - rare enough to accept.
 * @param {ParsePos} pos @param {string} text
 * @returns {string[]}
 */
function parseCasePatterns(pos, text) {
  const tok = peek(pos);
  if (!tok) throw needMoreInput("expectedCasePattern");
  if (tok.type !== "word") throw syntaxError("expectedCasePattern");

  let j = tok.start;
  while (j < text.length && text[j] !== ")") j++;
  if (j >= text.length) throw needMoreInput("expectedCaseClose");

  const patterns = text.slice(tok.start, j).split("|").map((s) => s.trim()).filter(Boolean);
  if (patterns.length === 0) throw syntaxError("expectedCasePattern");

  while (pos.i < pos.tokens.length && pos.tokens[pos.i].start <= j) pos.i++;

  return patterns;
}

/**
 * A case clause's body is a statement list like {@link parseList}, but also
 * stops at a bare `;;` (two consecutive `;` operator tokens - our tokenizer
 * has no single token for it) or at `esac` (the last clause may omit `;;`).
 * @param {ParsePos} pos @param {string} text
 * @returns {ScriptNode[]}
 */
function parseCaseClauseBody(pos, text) {
  /** @type {ScriptNode[]} */
  const nodes = [];
  let simpleStart = pos.i;
  let atCmdPos = true;

  const flushSimple = () => {
    if (pos.i > simpleStart) {
      const raw = sliceRaw(text, pos.tokens, simpleStart, pos.i);
      if (raw) nodes.push({ type: "simple", text: raw });
    }
  };

  while (pos.i < pos.tokens.length) {
    const tok = pos.tokens[pos.i];

    if (tok.type === "op" && tok.value === ";") {
      const next = pos.tokens[pos.i + 1];
      if (next && next.type === "op" && next.value === ";") {
        flushSimple();
        pos.i += 2;
        return nodes;
      }
      atCmdPos = true;
      pos.i++;
      continue;
    }

    if (tok.type === "op") {
      if (tok.value === "&&" || tok.value === "||" || tok.value === "|") atCmdPos = true;
      pos.i++;
      continue;
    }

    if (atCmdPos) {
      if (tok.value === "esac") { flushSimple(); return nodes; } // last clause may omit ";;"

      const funcHeader = tryConsumeFunctionHeader(pos);
      if (funcHeader) {
        flushSimple();
        pos.i += funcHeader.consumed;
        const body = parseList(pos, text, ["}"]);
        expectWordValue(pos, "}");
        nodes.push({ type: "funcdef", name: funcHeader.name, body });
        simpleStart = pos.i;
        atCmdPos = true;
        continue;
      }

      if (tok.value === "if")    { flushSimple(); nodes.push(parseIf(pos, text));                simpleStart = pos.i; atCmdPos = true; continue; }
      if (tok.value === "for")   { flushSimple(); nodes.push(parseFor(pos, text));               simpleStart = pos.i; atCmdPos = true; continue; }
      if (tok.value === "while") { flushSimple(); nodes.push(parseWhileUntil(pos, text, false)); simpleStart = pos.i; atCmdPos = true; continue; }
      if (tok.value === "until") { flushSimple(); nodes.push(parseWhileUntil(pos, text, true));  simpleStart = pos.i; atCmdPos = true; continue; }
      if (tok.value === "case")  { flushSimple(); nodes.push(parseCase(pos, text));               simpleStart = pos.i; atCmdPos = true; continue; }
      if (KEYWORDS.has(tok.value)) throw syntaxError("unexpectedToken", { token: tok.value });
    }

    atCmdPos = false;
    pos.i++;
  }

  throw needMoreInput("missingSemiOrEsac");
}

/**
 * Parses a full script's text into a list of top-level statements.
 * @param {string} text
 * @returns {ScriptNode[]}
 */
/**
 * Finds and removes heredoc bodies (`<<WORD`/`<<-WORD` ... `WORD`) from
 * `text`, replacing each delimiter word with a unique inert marker (never
 * legal shell syntax, so it can't collide with anything a script could
 * actually write) that survives untouched through every later text-rewriting
 * pass (splitCommandList/expandCommandSubstitutions/expandArithmetic) all
 * the way to `parsePipeline`'s own `<<`/`<<-` handling, which looks the
 * marker up in the returned `heredocs` map instead of re-deriving the body.
 * `<<-` additionally strips leading tabs from both the delimiter-matching
 * line and every body line (POSIX rule, meant for indenting heredocs inside
 * indented script bodies). Body content itself is stored raw/unexpanded -
 * `runSimpleText` re-expands it (command substitution, arithmetic, `$VAR`)
 * against the *current* env each time the owning command actually runs,
 * same as a real heredoc - a quoted delimiter (tracked via the delimiter
 * token's `noGlob`) marks it `literal: true` instead, suppressing that.
 *
 * Re-tokenizes `text` from scratch after each extraction, since removing a
 * body shifts every later offset - fine at script/line scale (heredocs are
 * rare and small here). Only recognizes ONE heredoc per source line's `<<`
 * occurrence at a time, but loops until none remain, so multiple heredocs
 * across a script (even several in one script) all resolve correctly.
 * @param {string} text
 * @returns {{ text: string, heredocs: Map<string, { body: string, literal: boolean }> }}
 */
function extractHeredocs(text) {
  /** @type {Map<string, { body: string, literal: boolean }>} */
  const heredocs = new Map();
  let n = 0;

  while (true) {
    const tokens = tokenize(text, {});
    // Skip a "<<"/"<<-" whose delimiter is already one of our own markers -
    // that's a heredoc from a previous pass through this loop, left in place
    // on purpose (parsePipeline still needs to see the operator+marker at
    // run time), not a new one to extract.
    const idx = tokens.findIndex((tk, i) =>
      tk.type === "op" && (tk.value === "<<" || tk.value === "<<-") &&
      !(tokens[i + 1]?.type === "word" && HEREDOC_MARKER_RE.test(tokens[i + 1].value)),
    );
    if (idx === -1) return { text, heredocs };

    const opTok = tokens[idx];
    const delimTok = tokens[idx + 1];
    if (!delimTok || delimTok.type !== "word") throw syntaxError("expectedHeredocDelimiter");

    const stripTabs = opTok.value === "<<-";
    const delimiter = delimTok.value;
    const literal = delimTok.noGlob;

    const firstNl = text.indexOf("\n", delimTok.end);
    if (firstNl === -1) throw needMoreInput("missingHeredocBody", { delim: delimiter });
    const bodyStart = firstNl + 1;

    /** @type {string[]} */
    const lines = [];
    let pos = bodyStart;
    let closed = false;
    let closeEnd = -1;

    while (pos <= text.length) {
      const nlIdx = text.indexOf("\n", pos);
      const lineEnd = nlIdx === -1 ? text.length : nlIdx;
      const rawLine = text.slice(pos, lineEnd);
      const line = stripTabs ? rawLine.replace(/^\t+/, "") : rawLine;

      if (line === delimiter) {
        closed = true;
        closeEnd = nlIdx === -1 ? text.length : nlIdx + 1;
        break;
      }
      lines.push(line);
      if (nlIdx === -1) break;
      pos = nlIdx + 1;
    }

    if (!closed) throw needMoreInput("missingHeredocBody", { delim: delimiter });

    const marker = `heredoc${n++}mark`;
    heredocs.set(marker, { body: lines.length ? lines.join("\n") + "\n" : "", literal });

    text = text.slice(0, delimTok.start) + marker + text.slice(delimTok.end, bodyStart) + text.slice(closeEnd);
  }
}

/**
 * Parses a full script's text into a list of top-level statements. The
 * returned array carries a non-enumerable `heredocs` property (see below).
 * @param {string} text
 * @returns {ScriptNode[]}
 */
export function parseScript(text) {
  const { text: rewritten, heredocs } = extractHeredocs(text);
  const tokens = tokenize(rewritten, {});
  const pos = { tokens, i: 0 };
  const nodes = parseList(pos, rewritten, []);
  // Non-enumerable so existing `toEqual([...])`-style assertions against
  // the plain node array (tests, and any other structural comparison)
  // aren't affected by this extra property riding along on the array.
  Object.defineProperty(nodes, "heredocs", { value: heredocs, enumerable: false });
  return nodes;
}

// ── Interpreter ──────────────────────────────────────────────────────────

/**
 * Wraps `app` so `.cwd` reads `cwd` instead of the real app's own -
 * `runPipeline` resolves `<`/`>`/`>>` redirect (and stdin) paths via
 * `app.cwd` directly, not `ctx.cwd`, so without this a `cd` inside a script
 * would leave redirects still resolving against the *outer* session's
 * directory instead of the script's own.
 * @param {any} app @param {string} cwd
 */
function appWithCwd(app, cwd) {
  return new Proxy(app, {
    get: (target, prop) => (prop === "cwd" ? cwd : Reflect.get(target, prop)),
  });
}

/** @param {ScriptExecState} state */
function scriptOpts(state) {
  return {
    fs: state.app.os.fs,
    cwd: state.cwd,
    pid: state.pid,
    lastExitCode: state.lastExitCode,
    positional: state.positional,
    scriptName: state.scriptName,
  };
}

/**
 * Applies the two text-level expansion passes any raw command text gets
 * before it's tokenized - command substitution, then arithmetic - against
 * `state`'s (possibly isolated) env/cwd/functions. Shared by
 * `runSimpleText` (a command or an if/while condition) and `runFor`/
 * `runCaseNode` (a for-loop word list or case subject/pattern), which need
 * exactly the same treatment but don't go through parsePipeline directly -
 * `$(...)`/`$((...))` in a for-list or case subject was previously left
 * un-expanded entirely (a pre-existing bug - `if`/`while` already got this).
 * @param {string} text @param {ScriptExecState} state
 * @returns {Promise<string>}
 */
async function expandText(text, state) {
  const substituted = await expandCommandSubstitutions(
    text,
    (inner) => state.app._runNestedCapture(inner, state.env, state.cwd, state.functions),
  );
  return expandArithmetic(substituted, state.env);
}

/**
 * Runs a raw, possibly `;`/`&&`/`||`-joined and possibly `$(...)`-containing
 * chunk of text as ordinary commands - the same steps
 * `TerminalApp._handleLine` runs for interactive input, just against
 * `state`'s (possibly isolated, see `sh.js`) env/cwd instead of the live
 * session's.
 * @param {string} text @param {ScriptExecState} state
 * @returns {Promise<boolean>}
 */
async function runSimpleText(text, state) {
  const entries = splitCommandList(text);
  let lastOk = true;

  for (const entry of entries) {
    if (!entry.text) continue;
    if (entry.op === "&&" && !lastOk) continue;
    if (entry.op === "||" && lastOk) continue;

    const expanded = await expandText(entry.text, state);

    // Heredoc bodies are re-expanded (command substitution, arithmetic,
    // $VAR - like a double-quoted string) against the *current* env every
    // time a command actually runs, same as a real heredoc; a literal
    // (quoted-delimiter) one is used as-is. Skipped entirely when this
    // script has no heredocs at all (the common case).
    let resolvedHeredocs = state.heredocs;
    if (state.heredocs.size > 0) {
      resolvedHeredocs = new Map();
      for (const [marker, hd] of state.heredocs) {
        resolvedHeredocs.set(marker, hd.literal ? hd : {
          body: expandHeredocBody(await expandText(hd.body, state), state.env, scriptOpts(state)),
          literal: false,
        });
      }
    }

    const stages = parsePipeline(expanded, state.env, { ...scriptOpts(state), heredocs: resolvedHeredocs });

    const buildCtx = (/** @type {any} */ overrides) => ({
      app: state.app,
      os: state.app.os,
      pid: state.pid,
      env: state.env,
      cwd: state.cwd,
      setCwd: (/** @type {string} */ cwd) => { state.cwd = cwd; },
      positional: state.positional,
      setPositional: (/** @type {string[]} */ values) => { state.positional = values; },
      scriptName: state.scriptName,
      functions: state.functions,
      clear: () => state.app._clear(),
      terminate: () => state.app.terminate(),
      signal: state.signal,
      onInterrupt: (/** @type {() => void} */ fn) => { state.app.interruptHandlers?.push(fn); },
      ...overrides,
    });

    lastOk = await runPipeline(appWithCwd(state.app, state.cwd), stages, buildCtx, makeFunctionResolver(state), state.inheritedStdin ?? null);
    state.lastExitCode = lastOk ? 0 : 1;
  }

  return lastOk;
}

/** @param {ScriptNode[]} nodes @param {ScriptExecState} state @returns {Promise<boolean>} */
async function runList(nodes, state) {
  let ok = true;
  for (const node of nodes) ok = await runNode(node, state);
  return ok;
}

/** @param {ScriptNode} node @param {ScriptExecState} state @returns {Promise<boolean>} */
async function runNode(node, state) {
  if (state.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  switch (node.type) {
    case "simple": return runSimpleText(node.text, state);
    case "if": return runIf(node, state);
    case "for": return runFor(node, state);
    case "while": return runWhile(node, state);
    case "case": return runCaseNode(node, state);
    case "funcdef": return runFuncDef(node, state);
    default: return true;
  }
}

/** @param {FunctionDefNode} node @param {ScriptExecState} state */
function runFuncDef(node, state) {
  state.functions.set(node.name, node.body);
  return true;
}

/** @param {IfNode} node @param {ScriptExecState} state */
async function runIf(node, state) {
  for (const clause of node.clauses) {
    const condOk = await runSimpleText(clause.condText, state);
    if (condOk) return runList(clause.body, state);
  }
  if (node.elseBody) return runList(node.elseBody, state);
  return true;
}

/**
 * Runs one loop body iteration and interprets a `break`/`continue` thrown
 * out of it (see `LoopControlSignal`): `{ stop: true }` tells the caller to
 * end the loop entirely (`break`, or a level-1 `continue` never reaches this
 * - see below); `{ stop: false }` tells it to proceed to the next iteration.
 *
 * A level > 1 (`break 2`, `continue 2`) means an outer loop is meant to be
 * unwound past too - normally rethrown, decremented by one, for the
 * next-outer runFor/runWhile to catch instead. But if THIS loop is currently
 * the outermost one active (`state.loopDepth === 1`, set by runFor/runWhile
 * below), there is no next-outer loop to hand it to; POSIX's rule for a level
 * bigger than the actual nesting is to just target the last (outermost)
 * enclosing loop, so it's clamped here instead of escaping the whole script
 * as a "break/continue outside a loop" error. A bare `continue` is level 1
 * and never reaches here at all - it's just a normal (non-exceptional)
 * return from `runList`.
 * @param {ScriptNode[]} body @param {ScriptExecState} state
 * @returns {Promise<{ ok: boolean, stop: boolean }>}
 */
async function runLoopBody(body, state) {
  try {
    return { ok: await runList(body, state), stop: false };
  } catch (e) {
    if (!(e instanceof LoopControlSignal)) throw e;
    if (e.level > 1 && (state.loopDepth ?? 0) > 1) throw new LoopControlSignal(e.kind, e.level - 1);
    // The break/continue "command" itself always succeeds ($? == 0 after
    // it, same as any other command that ran) - runPipeline never got a
    // chance to set this itself (LoopControlSignal skips straight past its
    // normal post-await state.lastExitCode assignment in runSimpleText, see
    // Pipeline.js), so it's set here instead, at the point the signal is
    // actually consumed rather than passed further up.
    state.lastExitCode = 0;
    return { ok: true, stop: e.kind === "break" };
  }
}

/** @param {ForNode} node @param {ScriptExecState} state */
async function runFor(node, state) {
  const wordsText = await expandText(node.wordsText, state);
  const words = expandWords(wordsText, state.env, scriptOpts(state));
  let ok = true;
  let i = 0;
  state.loopDepth = (state.loopDepth ?? 0) + 1;
  try {
    for (const w of words) {
      if (state.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      state.env[node.varName] = w;
      const res = await runLoopBody(node.body, state);
      ok = res.ok;
      if (res.stop) break;
      i++;
      if (i % 200 === 0) await sleepAbortable(0, state.signal);
    }
  } finally {
    state.loopDepth--;
  }
  return ok;
}

/** @param {WhileNode} node @param {ScriptExecState} state */
async function runWhile(node, state) {
  let ok = true;
  let iterations = 0;
  state.loopDepth = (state.loopDepth ?? 0) + 1;
  try {
    while (true) {
      if (state.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const condOk = await runSimpleText(node.condText, state);
      if ((node.negate ? !condOk : condOk) !== true) break;

      const res = await runLoopBody(node.body, state);
      ok = res.ok;
      if (res.stop) break;
      iterations++;
      if (iterations >= MAX_LOOP_ITERATIONS) {
        throw new CommandError(t("app.terminal.commands.sh.err.loopLimit"));
      }
      if (iterations % 200 === 0) await sleepAbortable(0, state.signal);
    }
  } finally {
    state.loopDepth--;
  }
  return ok;
}

/** @param {CaseNode} node @param {ScriptExecState} state */
async function runCaseNode(node, state) {
  // $-expanded but never glob-expanded against the filesystem - a case
  // subject/pattern is a plain string match, unrelated to real files, even
  // though the pattern syntax (*, ?, [abc]) looks the same as globbing.
  const opts = { pid: state.pid, lastExitCode: state.lastExitCode, positional: state.positional, scriptName: state.scriptName };
  const subjectText = await expandText(node.subjectText, state);
  const word = expandWords(subjectText, state.env, opts).join(" ");

  for (const clause of node.clauses) {
    /** @type {string[]} */
    const patterns = [];
    for (const p of clause.patterns) {
      const expandedP = await expandText(p, state);
      patterns.push(expandWords(expandedP, state.env, opts)[0] ?? expandedP);
    }
    if (patterns.some((p) => globToRegExp(p).test(word))) {
      return runList(clause.body, state);
    }
  }
  return true;
}

/**
 * Runs a parsed script. Returns the exit status of the last statement
 * actually executed (true/0 if the script had nothing to run). Used for the
 * genuine top level - the interactive prompt (`TerminalApp._handleLine`) and
 * `sh script.sh` - where a `break`/`continue`/`return` escaping every
 * enclosing loop/function/`.`-call is simply invalid, unlike
 * `runWithReturnBoundary` below (used by an actual function call or
 * `.`/source, where a `return` reaching this same point is the norm).
 * @param {ScriptNode[]} nodes @param {ScriptExecState} state
 * @returns {Promise<boolean>}
 */
export async function runScript(nodes, state) {
  try {
    return await runList(nodes, state);
  } catch (e) {
    // A break/continue/return that escaped every enclosing runFor/runWhile/
    // runWithReturnBoundary - i.e. used outside of any loop, function, or
    // `.`/source call. Real shells warn and carry on with the next
    // statement; reproducing that here would mean catching this at every
    // node in runList instead of just at this one top-level entry point, for
    // a case that only ever happens in an already-malformed script - so this
    // settles for failing the script cleanly instead, like a syntax error.
    if (e instanceof LoopControlSignal) {
      throw new CommandError(t(`app.terminal.commands.sh.err.${e.kind}OutsideLoop`));
    }
    if (e instanceof ReturnSignal) {
      throw new CommandError(t("app.terminal.commands.sh.err.returnOutsideFunction"));
    }
    throw e;
  }
}

/**
 * Like {@link runScript}, but treats a `return [n]` (see `ReturnSignal`)
 * reaching this call as the normal, expected way to end early instead of an
 * error - the two POSIX-legal targets for `return`, a shell-function call
 * (`makeFunctionResolver` below) and `.`/source (`commands/misc/dot.js`),
 * both run their body through this instead of `runScript`. `status: null`
 * (a bare `return`) reuses whatever `$?` already was.
 *
 * An explicit `return N`'s own precise N only decides the boolean this
 * returns (0 = success) - it's NOT written back into `state.lastExitCode`,
 * because it wouldn't survive there anyway: both call sites (the function
 * wrapper, `dot.js`) turn that boolean back into a plain thrown/not-thrown
 * outcome for their own caller, which `runSimpleText`'s normal per-statement
 * bookkeeping then collapses to exactly 0 or 1 right after, same as any
 * other command's exit status here. So `return 3; echo $?` reads back `1`,
 * not `3` - a real (documented) simplification, not a bug.
 * @param {ScriptNode[]} nodes @param {ScriptExecState} state
 * @returns {Promise<boolean>}
 */
export async function runWithReturnBoundary(nodes, state) {
  try {
    return await runList(nodes, state);
  } catch (e) {
    if (!(e instanceof ReturnSignal)) throw e;
    return (e.status ?? state.lastExitCode) === 0;
  }
}

/**
 * Wraps `app` so `print`/`println` land in `ctx.stdout`/`ctx.stderr`
 * instead of the real terminal - what lets something that itself runs as
 * one Command (a shell function via `makeFunctionResolver`, or `sh` in
 * sh.js) have ITS OWN internal commands' output respect whatever the call
 * site did with this Command's output (piped, redirected to a file,
 * captured by `$(...)`), instead of always rendering straight to the
 * terminal regardless. Everything else forwards to `app` unchanged.
 * @param {any} app @param {{ stdout: import("./commands/types.js").Writer, stderr: import("./commands/types.js").Writer }} ctx
 * @returns {any}
 */
export function wrapAppForCtx(app, ctx) {
  return new Proxy(app, {
    get: (target, prop) => {
      if (prop === "print") return (/** @type {string} */ text, /** @type {"0"|"1"} */ color = "0") =>
        color === "1" ? ctx.stderr.print(text) : ctx.stdout.print(text);
      if (prop === "println") return (/** @type {string} */ text, /** @type {"0"|"1"} */ color = "0") =>
        color === "1" ? ctx.stderr.println(text) : ctx.stdout.println(text);
      return Reflect.get(target, prop);
    },
  });
}

/**
 * Builds a function-lookup callback for {@link runPipeline}'s optional 4th
 * param: turns a name defined via `name() { ... }` (see `runFuncDef`) into a
 * synthetic Command that runs the function's body against the SAME
 * (mutable) `state` - no subshell isolation, matching real shell functions
 * (a `cd`/export/assignment inside a function affects the caller, unlike
 * `sh script.sh`). Positional params are swapped to the call's own args for
 * the duration of the call and restored after ($0 is left alone - POSIX
 * functions don't change it). A body whose last statement fails (or that
 * ends via `return N` with a nonzero N) throws a silent `CommandError("")`
 * (exit 1, no message) - the same "false, not an error" convention `test`/
 * `[` already use. Runs the body through `runWithReturnBoundary`, not plain
 * `runList`, so a `return` inside ends just this call - see there.
 *
 * `state.app` is temporarily swapped via {@link wrapAppForCtx} for the
 * duration of the call - without this, the body's own commands (which
 * resolve their I/O via `state.app` deep inside `runSimpleText`/
 * `runPipeline`, oblivious to how *this* call itself was invoked) would
 * always render straight to the real terminal, ignoring a pipe
 * (`myfunc | grep x`) or capture (`$(myfunc)`) the call site put it in.
 * Nested function calls compose correctly: each call wraps whatever
 * `state.app` currently is (the enclosing call's own proxy, if any), so
 * output threads back through every layer to the original call site.
 *
 * `state.inheritedStdin` is swapped the same way, to the call's own
 * `ctx.stdin` - so `echo hi | myfunc` lets the function's own first
 * unredirected stdin-reader see "hi", the same real fd-inheritance
 * `runPipeline`'s `inheritedStdin` param implements.
 * @param {ScriptExecState} state
 * @returns {(name: string) => import("./commands/types.js").Command | undefined}
 */
export function makeFunctionResolver(state) {
  return (name) => {
    const body = state.functions.get(name);
    if (!body) return undefined;
    return {
      name,
      category: /** @type {any} */ ("misc"),
      run: async (/** @type {any} */ ctx, /** @type {string[]} */ args) => {
        const savedPositional = state.positional;
        const savedApp = state.app;
        const savedStdin = state.inheritedStdin;
        state.positional = args;
        state.inheritedStdin = ctx.stdin;
        state.app = wrapAppForCtx(savedApp, ctx);
        try {
          // runWithReturnBoundary (not plain runList) - a `return` inside
          // the function body ends just this call, see there.
          const ok = await runWithReturnBoundary(body, state);
          if (!ok) throw new CommandError("");
        } finally {
          state.positional = savedPositional;
          state.app = savedApp;
          state.inheritedStdin = savedStdin;
        }
      },
    };
  };
}

export {};
