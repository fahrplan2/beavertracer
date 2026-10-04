#!/usr/bin/env node
/**
 * translate-lessons-via-claude.mjs
 * Keeps the translated courses (lessons/<lang>/*.md) in sync with the German
 * course (lessons/de/*.md, authoritative) using the Anthropic Claude API.
 *
 * Change detection: for every language, lessons/_translation/state.json records
 * the SHA-256 of the German file each translation was made from, and
 * lessons/_translation/base/<sha>.md keeps a copy of that German text (the
 * "shadow" source, shared across languages). When a German page changes, the
 * script diffs shadow vs. current German text and asks Claude to apply just
 * that change to the existing translation — untouched passages stay as they
 * are. New pages are translated in full, pages removed from de are deleted.
 * lessons/_translation/ is skipped by the lessons build (leading "_").
 *
 * The English course (if up to date for a page) is passed along as a
 * reference translation; German always wins on disagreement.
 *
 * Glossary (lessons/_translation/glossary.json) keeps terms consistent:
 * "ui" maps German UI labels to locale keys — their translation is read from
 * locales/<lang>.js, so lessons name buttons exactly as the app shows them;
 * "terms" maps German technical terms to the English course's wording. For
 * other languages the terms are translated once and stored in
 * lessons/_translation/glossary/<lang>.json (new terms are added on the next
 * run; edit that file to fix a term — pages already translated are not
 * re-translated automatically).
 *
 * Every result is checked against the German page's skeleton (directives,
 * task checks, quiz slots, links — see lesson-skeleton.mjs, same rule as the
 * parity test). A translation that fails the check is retried and, if it still
 * fails, not written; the page stays "changed" and is retried on the next run.
 *
 * Usage:
 *   node scripts/translate-lessons-via-claude.mjs --status            # what's out of date (no API calls)
 *   node scripts/translate-lessons-via-claude.mjs --adopt --target en # mark existing translations as in sync
 *   node scripts/translate-lessons-via-claude.mjs --target en         # sync one language
 *   node scripts/translate-lessons-via-claude.mjs --target fr,es      # sync several
 *   node scripts/translate-lessons-via-claude.mjs --all               # sync every language in scripts/locales.mjs
 *
 * Run with --help for all options.
 */

import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { LOCALES } from "./locales.mjs";
import { skeleton, skeletonDiff, UNTRANSLATED } from "./lesson-skeleton.mjs";

const HELP_TEXT = `
Usage: node scripts/translate-lessons-via-claude.mjs [options]

Keeps lessons/<lang>/ in sync with lessons/de/ (authoritative).

Selecting languages:
  --target <codes>     Comma-separated target locales (e.g. en or fr,es)
  --all                All locales from scripts/locales.mjs (English first)
                       Without --target/--all: every lessons/<lang>/ that is
                       already a translation (has more than the placeholder page)

Modes:
  --glossary           Only create/complete glossary/<lang>.json, no pages
  --status             Only report what is up to date / changed / new / untracked
  --adopt              Record the current German files as the base of the existing
                       translations, without calling the API. Use once for courses
                       that were translated before this script tracked state, or
                       after fixing a translation by hand to match a German change.
  --dry-run            Show what would be translated, without calling the API
  --force              Re-translate selected pages from scratch (ignores state)

Filters:
  --only <files>       Comma-separated lesson files (e.g. 01-einfuehrung.md)

API:
  --model <id>         Claude model (default: claude-opus-5-5)
  --effort <level>     low | medium | high | xhigh | max (default: high)
  --concurrency <n>    Parallel requests per language (default: 4)
  --help               Show this help

Needs ANTHROPIC_API_KEY (or an \`ant auth login\` profile) unless --status/--adopt/--dry-run.
`.trim();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const ROOT = path.resolve(import.meta.dirname, "..");
const LESSONS = path.join(ROOT, "lessons");
const SOURCE = "de";
const PIVOT = "en";
const STATE_DIR = path.join(LESSONS, "_translation");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const BASE_DIR = path.join(STATE_DIR, "base");
const GLOSSARY_FILE = path.join(STATE_DIR, "glossary.json");
const GLOSSARY_DIR = path.join(STATE_DIR, "glossary");
const LOCALES_DIR = path.join(ROOT, "locales");

const MODEL = args.model || "claude-opus-5-5";
const EFFORT = args.effort || "high";
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 4);
const STATUS = Boolean(args.status);
const ADOPT = Boolean(args.adopt);
const DRY_RUN = Boolean(args["dry-run"]);
const FORCE = Boolean(args.force);
const GLOSSARY_ONLY = Boolean(args.glossary);
const ONLY = args.only ? new Set(String(args.only).split(",").map((s) => s.trim()).filter(Boolean)) : null;

const LANG_NAMES = Object.fromEntries([...LOCALES.map((l) => [l.code, l.name]), ["en", "English"]]);

const c = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", gray: "\x1b[90m" };

// ── files & state ────────────────────────────────────────────────────────────

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const mdFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : []);
const readLesson = (lang, file) => fs.readFileSync(path.join(LESSONS, lang, file), "utf8");

/** @returns {Record<string, Record<string, string>>} lang -> file -> sha of the German source it was translated from */
function loadState() {
  return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
}

function saveState(state) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  const sorted = Object.fromEntries(
    Object.keys(state).sort().map((lang) => [lang, Object.fromEntries(Object.keys(state[lang]).sort().map((f) => [f, state[lang][f]]))])
  );
  fs.writeFileSync(STATE_FILE, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  // Drop shadow copies no language refers to anymore.
  const used = new Set(Object.values(state).flatMap((files) => Object.values(files)));
  for (const f of fs.readdirSync(BASE_DIR)) {
    if (!used.has(f.replace(/\.md$/, ""))) fs.unlinkSync(path.join(BASE_DIR, f));
  }
}

function storeBase(text) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  const p = path.join(BASE_DIR, `${sha(text)}.md`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, text, "utf8");
}

function loadBase(hash) {
  const p = path.join(BASE_DIR, `${hash}.md`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

/** Source pages that should exist in every translation. */
function sourcePages() {
  return mdFiles(path.join(LESSONS, SOURCE)).filter((f) => !UNTRANSLATED.has(f));
}

/** A lessons/<lang>/ folder counts as a translation once it has more than the "not available" placeholder. */
function isTranslation(lang) {
  return mdFiles(path.join(LESSONS, lang)).some((f) => f !== "00-index.md");
}

/**
 * Classify every page of one language.
 * @returns {{ file: string, status: "ok"|"changed"|"new"|"untracked"|"orphan", baseHash?: string }[]}
 */
function plan(lang, state) {
  const own = new Set(mdFiles(path.join(LESSONS, lang)));
  const src = sourcePages();
  const srcSet = new Set(src);
  const langState = state[lang] ?? {};
  const out = [];
  for (const file of src) {
    if (ONLY && !ONLY.has(file)) continue;
    const recorded = langState[file];
    if (!own.has(file)) out.push({ file, status: "new" });
    else if (!recorded) out.push({ file, status: "untracked" });
    else if (recorded !== sha(readLesson(SOURCE, file))) out.push({ file, status: "changed", baseHash: recorded });
    else out.push({ file, status: "ok" });
  }
  for (const file of own) {
    if (srcSet.has(file) || (ONLY && !ONLY.has(file))) continue;
    // Untranslated German pages (e.g. 99-…) may legitimately be missing, but never extra.
    out.push({ file, status: "orphan" });
  }
  return out;
}

// ── glossary ─────────────────────────────────────────────────────────────────

const GLOSSARY = fs.existsSync(GLOSSARY_FILE)
  ? JSON.parse(fs.readFileSync(GLOSSARY_FILE, "utf8"))
  : { ui: {}, terms: {} };

/** @returns {Map<string, string>} key -> string, from a locales/<code>.js file */
function loadLocaleStrings(code) {
  const p = path.join(LOCALES_DIR, `${code}.js`);
  const map = new Map();
  if (!fs.existsSync(p)) return map;
  const src = fs.readFileSync(p, "utf8");
  for (const m of src.matchAll(/^\s*"([\w.-]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/gm)) {
    map.set(m[1], JSON.parse(`"${m[2]}"`));
  }
  return map;
}

/** Warn about ui entries whose German label no longer matches locales/de.js. */
function checkUiGlossary() {
  const de = loadLocaleStrings(SOURCE);
  for (const [label, key] of Object.entries(GLOSSARY.ui ?? {})) {
    if (!de.has(key)) console.log(`${c.yellow}glossary: ui key "${key}" (${label}) not found in locales/de.js${c.reset}`);
    else if (de.get(key) !== label) console.log(`${c.yellow}glossary: "${label}" — locales/de.js now says "${de.get(key)}" for ${key}${c.reset}`);
  }
}

const glossaryPath = (lang) => path.join(GLOSSARY_DIR, `${lang}.json`);

/** Stored term translations for one language (English comes from glossary.json itself). */
function loadTerms(lang) {
  if (lang === PIVOT) return { ...(GLOSSARY.terms ?? {}) };
  const p = glossaryPath(lang);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

const missingTerms = (lang) => {
  const have = loadTerms(lang);
  return Object.keys(GLOSSARY.terms ?? {}).filter((t) => !have[t]);
};

/** Translate glossary terms not yet in glossary/<lang>.json; drops terms removed from glossary.json. */
async function completeGlossary(lang, targetName) {
  if (lang === PIVOT) return;
  const terms = GLOSSARY.terms ?? {};
  const have = loadTerms(lang);
  const missing = Object.keys(terms).filter((t) => !have[t]);
  const kept = Object.fromEntries(Object.entries(have).filter(([t]) => t in terms));
  if (missing.length) {
    const list = missing.map((t) => `${t}\t${terms[t]}`).join("\n");
    const msg = await client.messages
      .stream({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: EFFORT },
        system:
          `You build a terminology glossary for translating networking lessons (BeaverTracer network simulator, ` +
          `upper secondary school) from German to ${targetName}. For each German term (with its English equivalent ` +
          `for orientation) give the term a ${targetName} networking textbook for that age group would use. ` +
          `Keep the grammatical form (singular noun etc.); for UI-like terms ("Run mode", "tab", "workspace") use ` +
          `the usual software wording in ${targetName}. Answer with one JSON object mapping each German term ` +
          `exactly as given to its ${targetName} term, nothing else.`,
        messages: [{ role: "user", content: `German term<TAB>English term:\n${list}` }],
      })
      .finalMessage();
    if (msg.stop_reason !== "end_turn") throw new Error(`glossary: stop_reason=${msg.stop_reason}`);
    const text = stripFences(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    for (const t of missing) {
      if (typeof parsed[t] === "string" && parsed[t].trim()) kept[t] = parsed[t].trim();
    }
    const still = missing.filter((t) => !kept[t]);
    if (still.length) console.log(`  ${c.yellow}glossary: no translation for ${still.join(", ")}${c.reset}`);
    console.log(`  ${c.green}✓${c.reset} glossary   ${missing.length - still.length} new term(s)`);
  }
  fs.mkdirSync(GLOSSARY_DIR, { recursive: true });
  const ordered = Object.fromEntries(Object.keys(terms).filter((t) => kept[t]).map((t) => [t, kept[t]]));
  fs.writeFileSync(glossaryPath(lang), JSON.stringify(ordered, null, 2) + "\n", "utf8");
}

/** Glossary section for the system prompt of one language. */
function glossaryPrompt(lang) {
  const locale = loadLocaleStrings(lang);
  const en = loadLocaleStrings(PIVOT);
  const ui = Object.entries(GLOSSARY.ui ?? {})
    .map(([label, key]) => [label, locale.get(key) ?? en.get(key)]) // the app falls back to English too
    .filter(([, v]) => v);
  const terms = Object.entries(loadTerms(lang));
  if (!ui.length && !terms.length) return "";
  const lines = ["", "Rules — GLOSSARY:"];
  if (ui.length) {
    lines.push(
      "- UI labels: the app shows these German labels as follows. When the German text refers to the button, tab,",
      "  window or field (usually in **bold**), use exactly this wording, including capitalization:",
      ...ui.map(([de, t]) => `  ${de} → ${t}`)
    );
  }
  if (terms.length) {
    lines.push(
      "- Technical terms: translate these consistently as given (inflect as the grammar requires):",
      ...terms.map(([de, t]) => `  ${de} → ${t}`)
    );
  }
  return lines.join("\n");
}

// ── line diff (for the prompt) ───────────────────────────────────────────────

/** Minimal unified-style diff (LCS over lines) — lesson pages are small enough. */
function lineDiff(oldText, newText, context = 3) {
  const a = oldText.split("\n"), b = newText.split("\n");
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  /** @type {{ t: " "|"-"|"+", line: string }[]} */
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: " ", line: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ t: "-", line: a[i++] });
    else ops.push({ t: "+", line: b[j++] });
  }
  while (i < n) ops.push({ t: "-", line: a[i++] });
  while (j < m) ops.push({ t: "+", line: b[j++] });

  const keep = ops.map(() => false);
  ops.forEach((op, k) => {
    if (op.t === " ") return;
    for (let d = Math.max(0, k - context); d <= Math.min(ops.length - 1, k + context); d++) keep[d] = true;
  });
  const lines = [];
  ops.forEach((op, k) => {
    if (!keep[k]) {
      if (lines.at(-1) !== "…") lines.push("…");
      return;
    }
    lines.push(`${op.t} ${op.line}`);
  });
  return lines.join("\n");
}

// ── prompts ──────────────────────────────────────────────────────────────────

function systemPrompt(lang, targetName) {
  return `
You are a professional translator localizing lesson content for BeaverTracer, an interactive
browser-based network simulator used as a teaching tool in German vocational upper secondary
school (grade 12). The German course is the authoritative original.

You translate lesson files written in a custom Markdown dialect from German to ${targetName}.

Rules — CONTENT:
- Translate all prose, headings, list items, table cell text, and callout text naturally and accurately.
- Keep TCP/IP and networking terminology accurate and consistent with how it is normally taught in ${targetName}.
- Address the student informally (the German original uses "du"), as appropriate in ${targetName}.
- Use sentence case for headings unless ${targetName} conventions say otherwise.
- Do NOT translate proper nouns/product names: BeaverTracer, Wireshark, Wiregasm, Font Awesome.
- Names of devices and people inside the simulations (e.g. "Mailserver Schule", "Anna", hostnames,
  e-mail addresses, domains) refer to things the student sees in the loaded simulation, which is NOT
  translated. Keep them exactly as in the German text.

Rules — SYNTAX (preserve exactly, do not translate or alter):
- Markdown structure: headings (#), lists, tables, emphasis, horizontal rules (---).
- The line "[[toc]]" — leave verbatim.
- Container directives like ":::note", ":::tip", ":::warning", ":::danger", ":::goal", ":::task", ":::draft",
  ":::sim", ":::osi", ":::quiz", ":::evaluate" and their closing ":::" — the directive keyword and any
  modifier on the same line (e.g. ":::osi 3", ":::quiz mc") must stay exactly as written. Free-text titles
  after ":::tip", ":::note", ":::warning", ":::danger", ":::evaluate" are prose and get translated.
- Icon tokens like ":fa-gear:", ":far-file:", ":router:", ":switch:" — leave verbatim.
- Inline code and fenced code blocks represent literal commands, output and configuration — leave them
  unchanged, including German words inside them.
- Links to other lessons, e.g. "[text](01-einfuehrung.html)" — translate the link TEXT, keep the target
  unchanged (file names are identical in all languages).
- Raw HTML tags and attributes — keep unchanged, translate only visible text inside them.
- ":::task" blocks: "title:" text is prose; "check:" lines are code and stay completely unchanged.
- ":::sim" blocks: lines like "url=…", "empty", "count=…" stay unchanged.
- ":::quiz mc": keep "- [ ]" / "- [x]" markers exactly, translate the answer text.
- ":::quiz fill": "{Subnetzmaske}" is a blank with the expected answer — translate the word, keep the braces.
  Keep the number of blanks identical.
- ":::quiz match": pairs "Left -> Right" — translate both sides, keep " -> ".
- ":::quiz short": lines starting with "=" are accepted answers — translate words, keep numbers/technical values.
- Do not add, remove, merge, split or reorder blocks, list items, quiz answers or directives.

Output: only the complete translated file content — no explanation, no code fences around it.
${glossaryPrompt(lang)}
`.trim();
}

/** @param {{ targetName: string, source: string, reference?: string }} p */
function fullPrompt({ targetName, source, reference }) {
  const parts = [`Translate this German lesson page to ${targetName}.`, `<german_source>\n${source}\n</german_source>`];
  if (reference) {
    parts.push(
      `For orientation, here is the existing English translation of the same page. Use it to resolve ` +
      `ambiguities and keep terminology consistent; where it disagrees with the German, follow the German.\n` +
      `<english_reference>\n${reference}\n</english_reference>`
    );
  }
  return parts.join("\n\n");
}

/** @param {{ targetName: string, oldSource: string, newSource: string, current: string, reference?: string }} p */
function updatePrompt({ targetName, oldSource, newSource, current, reference }) {
  const parts = [
    `The German original of a lesson page was edited. Update the existing ${targetName} translation so that ` +
    `it matches the new German version. Change only what the German edit requires; keep every other ` +
    `passage of the existing translation word for word, even where you would phrase it differently.`,
    `<diff_of_german_source>\n${lineDiff(oldSource, newSource)}\n</diff_of_german_source>`,
    `<new_german_source>\n${newSource}\n</new_german_source>`,
    `<current_translation>\n${current}\n</current_translation>`,
  ];
  if (reference) {
    parts.push(
      `For orientation, the English translation of the new German version (follow the German where they disagree):\n` +
      `<english_reference>\n${reference}\n</english_reference>`
    );
  }
  parts.push(`Return the complete updated ${targetName} file.`);
  return parts.join("\n\n");
}

// ── API ──────────────────────────────────────────────────────────────────────

/** @type {Anthropic | null} */
let client = null;

/** Strip markdown code fences the model sometimes adds despite instructions. */
function stripFences(text) {
  return text.replace(/^```[a-z]*\n/i, "").replace(/\n```\s*$/i, "").trim();
}

/**
 * Ask Claude, check the result against the German skeleton, feed mismatches back and retry.
 * @param {string} system @param {string} userContent @param {string} newSource
 */
async function translate(system, userContent, newSource, retries = 3) {
  const want = skeleton(newSource);
  /** @type {import("@anthropic-ai/sdk").default.Beta.BetaMessageParam[]} */
  const messages = [{ role: "user", content: userContent }];
  let lastErr = "no attempt";
  for (let attempt = 1; attempt <= retries; attempt++) {
    const msg = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        // Re-run declined requests on a suitable fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // The system prompt is identical for all pages of one language → cached.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
      })
      .finalMessage();

    if (msg.stop_reason === "refusal") {
      lastErr = `refused (${msg.stop_details?.category ?? "no category"})`;
      continue;
    }
    if (msg.stop_reason === "max_tokens") {
      lastErr = "response truncated (max_tokens)";
      continue;
    }
    const text = stripFences(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    if (!text) {
      lastErr = `empty response (stop_reason=${msg.stop_reason})`;
      continue;
    }
    const problems = skeletonDiff(want, skeleton(text));
    if (problems.length === 0) return text;

    lastErr = `structure differs from German page: ${problems.join("; ")}`;
    messages.push(
      { role: "assistant", content: msg.content },
      {
        role: "user",
        content:
          `Your translation does not match the structure of the German page:\n- ${problems.join("\n- ")}\n` +
          `Directives, check:/url= lines, quiz markers, blanks, match pairs and link targets must be identical ` +
          `to the German page. Return the complete corrected file.`,
      }
    );
  }
  throw new Error(lastErr);
}

/** Run async jobs with a fixed number of workers. */
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// ── main ─────────────────────────────────────────────────────────────────────

function selectLanguages() {
  let langs;
  if (args.target) langs = String(args.target).split(",").map((s) => s.trim()).filter(Boolean);
  else if (args.all) langs = Object.keys(LANG_NAMES);
  else {
    langs = fs.readdirSync(LESSONS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_") && isTranslation(d.name))
      .map((d) => d.name);
  }
  langs = [...new Set(langs)].filter((l) => l !== SOURCE);
  // English first: it is the reference translation for all others.
  return langs.sort((a, b) => (a === PIVOT ? -1 : b === PIVOT ? 1 : a.localeCompare(b)));
}

const STATUS_COLOR = { ok: c.gray, changed: c.yellow, new: c.cyan, untracked: c.red, orphan: c.red };

async function main() {
  const langs = selectLanguages();
  for (const l of langs) {
    if (!LANG_NAMES[l]) {
      console.error(`Unknown locale "${l}" (not in scripts/locales.mjs).`);
      process.exit(1);
    }
  }
  if (langs.length === 0) {
    console.log("No target languages selected (use --target or --all).");
    return;
  }

  checkUiGlossary();
  const state = loadState();
  const needsApi = !STATUS && !ADOPT && !DRY_RUN;
  if (needsApi) client = new Anthropic();

  let failed = 0;

  for (const lang of langs) {
    const targetName = LANG_NAMES[lang];
    const items = plan(lang, state);
    const counts = Object.fromEntries(["ok", "changed", "new", "untracked", "orphan"].map((s) => [s, items.filter((i) => i.status === s).length]));
    console.log(
      `\n${lang} (${targetName}): ${counts.ok} ok, ${counts.changed} changed, ${counts.new} new, ` +
      `${counts.untracked} untracked, ${counts.orphan} orphan`
    );

    const gMissing = lang === PIVOT ? [] : missingTerms(lang);
    if (gMissing.length) console.log(`  glossary: ${gMissing.length} term(s) not yet translated`);

    if (STATUS) {
      for (const it of items) if (it.status !== "ok") console.log(`  ${STATUS_COLOR[it.status]}${it.status.padEnd(9)}${c.reset} ${it.file}`);
      continue;
    }

    if (ADOPT) {
      state[lang] ??= {};
      for (const it of items) {
        if (it.status === "untracked" || it.status === "changed" || (FORCE && it.status === "ok")) {
          const src = readLesson(SOURCE, it.file);
          storeBase(src);
          state[lang][it.file] = sha(src);
          console.log(`  adopt  ${it.file}`);
        }
      }
      continue;
    }

    // Glossary first: every page of this language is translated with it.
    if (DRY_RUN) {
      if (gMissing.length) console.log(`  would translate ${gMissing.length} glossary term(s)`);
    } else {
      try {
        await completeGlossary(lang, targetName);
      } catch (e) {
        failed++;
        console.log(`  ${c.red}✗${c.reset} glossary: ${e.message} — skipping ${lang}`);
        continue;
      }
    }
    if (GLOSSARY_ONLY) continue;

    // Pages removed from the German course (and the "not available" placeholder).
    for (const it of items.filter((i) => i.status === "orphan")) {
      console.log(`  ${c.red}delete${c.reset} ${it.file}`);
      if (!DRY_RUN) {
        fs.unlinkSync(path.join(LESSONS, lang, it.file));
        if (state[lang]) delete state[lang][it.file];
      }
    }

    const untracked = items.filter((i) => i.status === "untracked");
    if (untracked.length && !FORCE) {
      console.log(
        `  ${c.red}${untracked.length} page(s) exist without a recorded German base — skipped.${c.reset}\n` +
        `  Run with --adopt if they match the current German pages, or --force to re-translate them.`
      );
    }

    const todo = items.filter((i) =>
      i.status === "new" || i.status === "changed" || (FORCE && (i.status === "untracked" || i.status === "ok"))
    );
    if (DRY_RUN) {
      for (const it of todo) console.log(`  would ${it.status === "changed" && !FORCE ? "update" : "translate"} ${it.file}`);
      continue;
    }

    fs.mkdirSync(path.join(LESSONS, lang), { recursive: true });
    const system = systemPrompt(lang, targetName);

    await pool(todo, CONCURRENCY, async (it) => {
      const newSource = readLesson(SOURCE, it.file);
      const newHash = sha(newSource);
      // English reference, only if it is up to date with the current German page.
      const reference = lang !== PIVOT && state[PIVOT]?.[it.file] === newHash ? readLesson(PIVOT, it.file) : undefined;
      const oldSource = it.status === "changed" && !FORCE ? loadBase(it.baseHash) : null;

      let mode = "translate", prompt;
      if (oldSource !== null) {
        mode = "update";
        prompt = updatePrompt({ targetName, oldSource, newSource, current: readLesson(lang, it.file), reference });
      } else {
        prompt = fullPrompt({ targetName, source: newSource, reference });
      }

      try {
        const result = await translate(system, prompt, newSource);
        fs.writeFileSync(path.join(LESSONS, lang, it.file), result + "\n", "utf8");
        storeBase(newSource);
        (state[lang] ??= {})[it.file] = newHash;
        saveState(state); // after every page, so an aborted run loses nothing
        console.log(`  ${c.green}✓${c.reset} ${mode.padEnd(9)} ${it.file}${reference ? c.gray + " (en ref)" + c.reset : ""}`);
      } catch (e) {
        failed++;
        console.log(`  ${c.red}✗${c.reset} ${mode.padEnd(9)} ${it.file}: ${e.message}`);
      }
    });
  }

  if (!STATUS && !DRY_RUN) saveState(state);
  if (failed > 0) {
    console.log(`\n${failed} page(s) failed — they stay marked as out of date and are retried on the next run.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
