//@ts-check

import { t } from "../../i18n/index.js";
import { CommandError } from "./commands/lib/errors.js";

/**
 * Finds the end of a `$((...))` span, i.e. the index of the outer closing
 * `)`. `start` is the index of the first `(` (so the span itself starts one
 * character earlier, at the `$`). No quote-awareness needed - a valid
 * arithmetic expression never contains a quote character.
 * @param {string} text @param {number} start index of the first "("
 * @returns {number} index of the outer closing ")", or `text.length - 1` if
 *   unterminated (matches Parser.js/CommandSubstitution.js's convention of
 *   never scanning past the end of the string)
 */
function findArithmeticEnd(text, start) {
  let depth = 2; // the two "((" already opened
  let j = start + 2;
  while (j < text.length) {
    const c = text[j];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return text.length - 1;
}

/** @param {string} expr */
function syntaxError(expr) {
  return new CommandError(t("app.terminal.commands.sh.err.arithSyntax", { expr }));
}

/**
 * Tokenizes an arithmetic expression: integers, identifiers (optionally
 * `$`-prefixed - `$i` and `i` are equivalent inside `$((...))`, matching
 * POSIX), and the operators/parens this subset supports.
 * @param {string} expr
 * @returns {Array<{ type: "num"|"ident"|"op", value: string }>}
 */
function tokenizeArith(expr) {
  /** @type {Array<{ type: "num"|"ident"|"op", value: string }>} */
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }

    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9]/.test(expr[j])) j++;
      tokens.push({ type: "num", value: expr.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === "$" || /[A-Za-z_]/.test(ch)) {
      let j = ch === "$" ? i + 1 : i;
      const identStart = j;
      if (!/[A-Za-z_]/.test(expr[j] ?? "")) throw syntaxError(expr);
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j++;
      tokens.push({ type: "ident", value: expr.slice(identStart, j) });
      i = j;
      continue;
    }

    const two = expr.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === "==" || two === "!=" || two === "<=" || two === ">=") {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }

    if ("+-*/%()<>!".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    throw syntaxError(expr);
  }
  return tokens;
}

/**
 * Small recursive-descent evaluator for a POSIX-arithmetic subset: integer
 * literals, `$name`/`name` variables (unset -> 0, non-numeric -> error),
 * `+ - * / %` (integer, truncating division/modulo, division by 0 errors),
 * unary `+ - !`, comparisons `< <= > >= == !=` and `&& || !` (all yielding
 * `1`/`0`), and `(...)` grouping. Deliberately excludes assignment operators
 * (`= += ++ --`) and bitwise operators - not needed for the counter/condition
 * patterns (`i=$((i+1))`, `[ $((x % 2)) -eq 0 ]`) this was built for, and the
 * assignment itself already happens at the shell-word level either way.
 * @param {string} expr @param {Record<string,string>} env
 * @returns {number}
 */
export function evaluateArithmetic(expr, env) {
  const tokens = tokenizeArith(expr);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  /** @returns {number} */
  function primary() {
    const tok = peek();
    if (!tok) throw syntaxError(expr);

    if (tok.type === "num") { next(); return parseInt(tok.value, 10); }

    if (tok.type === "ident") {
      next();
      const raw = env[tok.value];
      if (raw === undefined) return 0;
      if (!/^-?[0-9]+$/.test(raw.trim())) {
        throw new CommandError(t("app.terminal.commands.sh.err.arithBadValue", { name: tok.value, value: raw }));
      }
      return parseInt(raw.trim(), 10);
    }

    if (tok.type === "op" && tok.value === "(") {
      next();
      const v = logicalOr();
      const close = peek();
      if (!close || close.value !== ")") throw syntaxError(expr);
      next();
      return v;
    }

    throw syntaxError(expr);
  }

  /** @returns {number} */
  function unary() {
    const tok = peek();
    if (tok && tok.type === "op" && (tok.value === "+" || tok.value === "-" || tok.value === "!")) {
      next();
      const v = unary();
      if (tok.value === "-") return -v;
      if (tok.value === "!") return v === 0 ? 1 : 0;
      return v;
    }
    return primary();
  }

  /** @returns {number} */
  function multiplicative() {
    let v = unary();
    while (peek()?.type === "op" && ["*", "/", "%"].includes(peek().value)) {
      const op = next().value;
      const rhs = unary();
      if ((op === "/" || op === "%") && rhs === 0) {
        throw new CommandError(t("app.terminal.commands.sh.err.arithDivByZero"));
      }
      if (op === "*") v = v * rhs;
      else if (op === "/") v = Math.trunc(v / rhs);
      else v = Math.trunc(v % rhs);
    }
    return v;
  }

  /** @returns {number} */
  function additive() {
    let v = multiplicative();
    while (peek()?.type === "op" && ["+", "-"].includes(peek().value)) {
      const op = next().value;
      const rhs = multiplicative();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  /** @returns {number} */
  function relational() {
    let v = additive();
    while (peek()?.type === "op" && ["<", "<=", ">", ">="].includes(peek().value)) {
      const op = next().value;
      const rhs = additive();
      if (op === "<") v = v < rhs ? 1 : 0;
      else if (op === "<=") v = v <= rhs ? 1 : 0;
      else if (op === ">") v = v > rhs ? 1 : 0;
      else v = v >= rhs ? 1 : 0;
    }
    return v;
  }

  /** @returns {number} */
  function equality() {
    let v = relational();
    while (peek()?.type === "op" && ["==", "!="].includes(peek().value)) {
      const op = next().value;
      const rhs = relational();
      v = (op === "==" ? v === rhs : v !== rhs) ? 1 : 0;
    }
    return v;
  }

  /** @returns {number} */
  function logicalAnd() {
    let v = equality();
    while (peek()?.type === "op" && peek().value === "&&") {
      next();
      const rhs = equality();
      v = v !== 0 && rhs !== 0 ? 1 : 0;
    }
    return v;
  }

  /** @returns {number} */
  function logicalOr() {
    let v = logicalAnd();
    while (peek()?.type === "op" && peek().value === "||") {
      next();
      const rhs = logicalAnd();
      v = v !== 0 || rhs !== 0 ? 1 : 0;
    }
    return v;
  }

  if (tokens.length === 0) throw syntaxError(expr);
  const result = logicalOr();
  if (pos < tokens.length) throw syntaxError(expr);
  return result;
}

/**
 * Text pre-processing pass for `$((...))` arithmetic expansion - same shape
 * as `expandCommandSubstitutions` (quote-aware: untouched inside single
 * quotes, expanded inside double quotes/unquoted), just synchronous, since
 * evaluation never needs to run a nested command. Must run AFTER
 * `expandCommandSubstitutions` (which itself leaves `$((` spans untouched -
 * see the comment there) so a `$(...)` *inside* a `$((...))` (e.g.
 * `$(( $(cat n) + 1 ))`) is deliberately NOT supported: this pass sees it as
 * plain, un-substituted text and reports a syntax error, rather than silently
 * mis-evaluating it.
 * @param {string} text @param {Record<string,string>} env
 * @returns {string}
 */
export function expandArithmetic(text, env) {
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

    if (ch === "$" && text[i + 1] === "(" && text[i + 2] === "(") {
      const end = findArithmeticEnd(text, i + 1);
      const inner = text.slice(i + 3, Math.max(i + 3, end - 1));
      out += String(evaluateArithmetic(inner, env));
      i = end;
      continue;
    }

    out += ch;
  }

  return out;
}

export {};
