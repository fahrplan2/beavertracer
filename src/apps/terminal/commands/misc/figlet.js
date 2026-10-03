//@ts-check

import { HEIGHT, HARDBLANK, GLYPHS } from "./figletFont.js";

// Easter egg: homage to FIGlet. Hidden (no help/man/completion entry).
// Renders with FIGlet's horizontal "smushing" (rules 1-4, as the standard
// font's header requests), so the output matches the real thing.

/**
 * FIGlet's smushem(): the single character that replaces `l` and `r` when
 * they overlap, or "" if they can't be smushed.
 * @param {string} l
 * @param {string} r
 * @param {number} lWidth
 * @param {number} rWidth
 */
function smush(l, r, lWidth, rWidth) {
  if (l === " ") return r;
  if (r === " ") return l;
  if (lWidth < 2 || rWidth < 2) return "";
  if (l === HARDBLANK || r === HARDBLANK) return "";
  // Rule 1: equal characters
  if (l === r) return l;
  // Rule 2: underscore gets replaced by a border character
  const borders = "|/\\[]{}()<>";
  if (l === "_" && borders.includes(r)) return r;
  if (r === "_" && borders.includes(l)) return l;
  // Rule 3: hierarchy - the "higher" class wins
  const classes = ["|", "/\\", "[]", "{}", "()", "<>"];
  const cl = classes.findIndex((c) => c.includes(l));
  const cr = classes.findIndex((c) => c.includes(r));
  if (cl >= 0 && cr >= 0 && cl !== cr) return cl > cr ? l : r;
  // Rule 4: opposite brackets become a vertical bar
  if ("[] ][ {} }{ () )(".split(" ").includes(l + r)) return "|";
  return "";
}

/**
 * Renders one line of text. Wraps at word boundaries (or mid-word if a
 * single word is wider than `width`), like figlet does at its -w width.
 * @param {string} text
 * @param {number} width
 * @returns {string[][]} one block of HEIGHT rows per output line
 */
export function renderFiglet(text, width) {
  /** @type {string[][]} */
  const blocks = [];
  /** @type {string[]} */
  let rows = Array(HEIGHT).fill("");
  let prevWidth = 0;

  /** @param {string[]} glyph */
  const smushAmount = (glyph) => {
    const w = glyph[0].length;
    let max = w;
    for (let y = 0; y < HEIGHT; y++) {
      const line = rows[y];
      // Last non-blank column of the output so far (0 if none), as in figlet.c
      let lb = line.length;
      while (lb > 0 && (lb >= line.length || line[lb] === " ")) lb--;
      const l = line[lb] ?? " ";
      let cb = 0;
      while (cb < w && glyph[y][cb] === " ") cb++;
      const r = glyph[y][cb];
      let amt = cb + line.length - 1 - lb;
      if (l === " ") amt++;
      else if (r !== undefined && smush(l, r, prevWidth, w) !== "") amt++;
      if (amt < max) max = amt;
    }
    return max;
  };

  /** @param {string[]} glyph @returns {boolean} false if it didn't fit */
  const add = (glyph) => {
    const w = glyph[0].length;
    const amt = smushAmount(glyph);
    if (rows[0].length + w - amt > width && rows[0].length > 0) return false;
    rows = rows.map((line, y) => {
      const chars = line.split("");
      for (let k = 0; k < amt; k++) {
        const col = line.length - amt + k;
        if (col >= 0) chars[col] = smush(chars[col], glyph[y][k], prevWidth, w) || chars[col];
      }
      return chars.join("") + glyph[y].slice(amt);
    });
    prevWidth = w;
    return true;
  };

  const flush = () => {
    if (rows[0].length > 0) blocks.push(rows);
    rows = Array(HEIGHT).fill("");
    prevWidth = 0;
  };

  const words = text.split(" ");
  words.forEach((word, i) => {
    const glyphs = [...(i > 0 ? " " : "") + word].map((ch) => GLYPHS[ch]).filter(Boolean);
    const saved = { rows, prevWidth };
    if (glyphs.every((g) => add(g))) return;
    // Doesn't fit: move the whole word to a fresh line, char-wrapping only
    // if it's too wide even on its own.
    ({ rows, prevWidth } = saved);
    flush();
    for (const g of glyphs.slice(i > 0 ? 1 : 0)) {
      if (!add(g)) { flush(); add(g); }
    }
  });
  flush();

  return blocks.map((block) => block.map((line) => line.replaceAll(HARDBLANK, " ")));
}

/** @type {import("../types.js").Command} */
export const figlet = {
  name: "figlet",
  hidden: true,
  run: async (ctx, args) => {
    let width = ctx.app?.cols ?? 80;
    let center = false;
    /** @type {string[]} */
    const words = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-w" && args[i + 1]) width = Math.max(1, parseInt(args[++i], 10) || width);
      else if (a === "-c") center = true;
      else words.push(a);
    }

    let input = words.join(" ");
    if (!words.length && ctx.stdin) input = await ctx.stdin.readAll();

    const out = [];
    for (const line of input.replace(/\n$/, "").split("\n")) {
      if (!line) continue;
      for (const block of renderFiglet(line.replace(/\t/g, " "), width)) {
        const pad = center ? " ".repeat(Math.max(0, Math.floor((width - block[0].length) / 2))) : "";
        for (const row of block) out.push((pad + row).replace(/\s+$/, ""));
      }
    }
    return out.join("\n");
  },
};
