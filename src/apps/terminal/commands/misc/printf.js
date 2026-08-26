//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";

/**
 * Processes the common C-style backslash escapes in a printf format string -
 * always active (unlike `echo`, which has no escape support at all here),
 * matching real `printf`. An unrecognized "\X" keeps its backslash as-is.
 * @param {string} s @returns {string}
 */
function unescape(s) {
  return s.replace(/\\(.)/g, (whole, c) => {
    switch (c) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "a": return "\x07";
      case "b": return "\b";
      case "f": return "\f";
      case "v": return "\v";
      case "\\": return "\\";
      default: return whole;
    }
  });
}

/** @param {number} n */
function toUnsigned(n) { return n < 0 ? n >>> 0 : n; }

/** @param {string} conv @param {string} arg */
function formatConversion(conv, arg) {
  switch (conv) {
    case "s": return arg;
    case "b": return unescape(arg); // bash-ism, not POSIX-required, but cheap and commonly expected
    case "c": return arg.charAt(0);
    case "d": case "i": return String(Math.trunc(Number(arg) || 0));
    case "u": { const n = Math.trunc(Number(arg) || 0); return String(toUnsigned(n)); }
    case "o": return toUnsigned(Math.trunc(Number(arg) || 0)).toString(8);
    case "x": return toUnsigned(Math.trunc(Number(arg) || 0)).toString(16);
    case "X": return toUnsigned(Math.trunc(Number(arg) || 0)).toString(16).toUpperCase();
    default: return arg;
  }
}

/**
 * @param {string} str @param {number} width @param {boolean} left @param {string} fillChar
 */
function pad(str, width, left, fillChar) {
  if (str.length >= width) return str;
  const fill = fillChar.repeat(width - str.length);
  return left ? str + fill : fill + str;
}

const CONV_RE = /%([-0]*)(\d+)?([bcdiosuxX%])/g;
// Same conversion letters as CONV_RE, but without "%" itself - used only to
// check up front whether `format` has any REAL conversion to consume an
// argument (a bare "%%" doesn't count), which decides whether the format
// gets reused/cycled against leftover arguments below.
const HAS_REAL_CONVERSION_RE = /%[-0]*\d*[bcdiosuxX]/;

/**
 * Runs one pass of `format`'s conversions, shifting the arguments they
 * consume off the front of `argQueue` (mutated) - missing operands default
 * to "" (numeric conversions then read as 0), matching real `printf`.
 * @param {string} format @param {string[]} argQueue
 * @returns {string}
 */
function formatOnce(format, argQueue) {
  let out = "";
  let last = 0;
  CONV_RE.lastIndex = 0;
  /** @type {RegExpExecArray|null} */
  let m;
  while ((m = CONV_RE.exec(format))) {
    out += format.slice(last, m.index);
    last = CONV_RE.lastIndex;

    const [, flags, widthStr, conv] = m;
    if (conv === "%") { out += "%"; continue; }

    const left = flags.includes("-");
    const zeroPad = flags.includes("0") && !left;
    const width = widthStr ? Number(widthStr) : 0;
    const arg = argQueue.shift() ?? "";

    let piece = formatConversion(conv, arg);
    if (width) piece = pad(piece, width, left, zeroPad && "diouxX".includes(conv) ? "0" : " ");
    out += piece;
  }
  out += format.slice(last);
  return out;
}

/** @type {import("../types.js").Command} */
export const printfCmd = {
  name: "printf",
  category: /** @type {"misc"} */ ("misc"),
  tldr: {
    descKey: "app.terminal.commands.printf.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.printf.tldr.ex.basic", cmd: 'printf "%s is %d\\n" beaver 3' },
    ],
  },
  // Writes directly to ctx.stdout instead of returning a string - unlike
  // every other text-producing builtin here, printf must NEVER get an
  // automatic trailing newline appended (Pipeline.js does that for any
  // returned string not already ending in "\n" - fine for echo/pwd/etc, but
  // printf's entire point is producing exactly the bytes its format says).
  run: (ctx, args) => {
    const format = args[0];
    if (format === undefined) throw new CommandError(t("app.terminal.commands.printf.usage"));

    const unescapedFormat = unescape(format);
    const reuseFormat = HAS_REAL_CONVERSION_RE.test(unescapedFormat);

    const argQueue = args.slice(1);
    let out = "";
    do {
      out += formatOnce(unescapedFormat, argQueue);
    } while (reuseFormat && argQueue.length > 0);

    ctx.stdout.print(out);
  },
};

export {};
