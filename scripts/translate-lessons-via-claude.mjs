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
 * --batch sends all pages through the Message Batches API (half price, results
 * usually within an hour, at most 24 h). The script waits for the batch; the
 * pending batch is recorded in lessons/_translation/batch.json, so an
 * interrupted run picks it up again with the next --batch call. Pages that the
 * batch could not deliver (refusal, wrong structure, errors) are retried
 * directly, at normal price, with the usual retry loop and model fallback.
 *
 * Usage:
 *   node scripts/translate-lessons-via-claude.mjs --status            # what's out of date (no API calls)
 *   node scripts/translate-lessons-via-claude.mjs --adopt --target en # mark existing translations as in sync
 *   node scripts/translate-lessons-via-claude.mjs --target en         # sync one language
 *   node scripts/translate-lessons-via-claude.mjs --target fr,es      # sync several
 *   node scripts/translate-lessons-via-claude.mjs --all               # sync every language in scripts/locales.mjs
 *   node scripts/translate-lessons-via-claude.mjs --all --batch       # same via the Batches API (half price)
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
  --batch              Translate via the Message Batches API (half price, slower).
                       Waits for the batch; if interrupted, run --batch again to
                       collect the results of the pending batch first.
  --cancel-batch       Cancel the pending batch and forget it

Filters:
  --only <files>       Comma-separated lesson files (e.g. 01-einfuehrung.md)

API:
  --model <id>         Claude model (default: claude-sonnet-5-5)
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
const BATCH_FILE = path.join(STATE_DIR, "batch.json");

const MODEL = args.model || "claude-sonnet-5-5";
const EFFORT = args.effort || "high";
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 4);
const STATUS = Boolean(args.status);
const ADOPT = Boolean(args.adopt);
const DRY_RUN = Boolean(args["dry-run"]);
const FORCE = Boolean(args.force);
const GLOSSARY_ONLY = Boolean(args.glossary);
const BATCH = Boolean(args.batch);
const CANCEL_BATCH = Boolean(args["cancel-batch"]);
const BATCH_POLL_MS = 60_000;
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
    addUsage(msg.usage);
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

// Approximate list prices in $ per million tokens (cache write = 5-minute cache).
const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};
const usage = {
  direct: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  batch: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
};

function addUsage(u, batch = false) {
  if (!u) return;
  const t = batch ? usage.batch : usage.direct;
  t.input += u.input_tokens ?? 0;
  t.output += u.output_tokens ?? 0;
  t.cacheWrite += u.cache_creation_input_tokens ?? 0;
  t.cacheRead += u.cache_read_input_tokens ?? 0;
}

function printUsage() {
  const price = PRICES[MODEL];
  let total = 0;
  for (const [kind, t] of Object.entries(usage)) {
    if (!t.input && !t.output) continue;
    let cost = "";
    if (price) {
      const usd = ((t.input * price.input + t.output * price.output + t.cacheWrite * price.cacheWrite + t.cacheRead * price.cacheRead) / 1e6)
        * (kind === "batch" ? 0.5 : 1);
      total += usd;
      cost = `, ≈ $${usd.toFixed(2)}`;
    }
    console.log(
      `${c.gray}usage ${kind}: ${t.input} in, ${t.cacheWrite} cache write, ${t.cacheRead} cache read, ${t.output} out${cost}${c.reset}`
    );
  }
  if (total) console.log(`${c.gray}estimated cost: ≈ $${total.toFixed(2)} (${MODEL} list prices)${c.reset}`);
}

/**
 * Check one response: complete, non-empty, and matching the German page's skeleton.
 * @returns {{ text?: string, error?: string, problems?: string[] }}
 */
function checkResult(msg, newSource) {
  if (msg.stop_reason === "refusal") return { error: `refused (${msg.stop_details?.category ?? "no category"})` };
  if (msg.stop_reason === "max_tokens") return { error: "response truncated (max_tokens)" };
  const text = stripFences(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  if (!text) return { error: `empty response (stop_reason=${msg.stop_reason})` };
  const problems = skeletonDiff(skeleton(newSource), skeleton(text));
  if (problems.length) return { error: `structure differs from German page: ${problems.join("; ")}`, problems };
  return { text };
}

/**
 * Ask Claude, check the result against the German skeleton, feed mismatches back and retry.
 * @param {string} system @param {string} userContent @param {string} newSource
 */
async function translate(system, userContent, newSource, retries = 3) {
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
    addUsage(msg.usage);

    const result = checkResult(msg, newSource);
    if (result.text) return result.text;
    lastErr = result.error;
    if (!result.problems) continue;

    messages.push(
      { role: "assistant", content: msg.content },
      {
        role: "user",
        content:
          `Your translation does not match the structure of the German page:\n- ${result.problems.join("\n- ")}\n` +
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

// ── pages ────────────────────────────────────────────────────────────────────

/**
 * Prompt for one page. baseHash names the German text the existing translation
 * was made from (update mode); null translates the page in full.
 * @param {string} lang @param {string} file @param {string | null} baseHash
 */
function pageJob(lang, file, baseHash, state) {
  const targetName = LANG_NAMES[lang];
  const newSource = readLesson(SOURCE, file);
  const newHash = sha(newSource);
  // English reference, only if it is up to date with the current German page.
  const reference = lang !== PIVOT && state[PIVOT]?.[file] === newHash ? readLesson(PIVOT, file) : undefined;
  const oldSource = baseHash ? loadBase(baseHash) : null;
  if (oldSource !== null) {
    return {
      mode: "update", newSource, newHash, reference,
      prompt: updatePrompt({ targetName, oldSource, newSource, current: readLesson(lang, file), reference }),
    };
  }
  return { mode: "translate", newSource, newHash, reference, prompt: fullPrompt({ targetName, source: newSource, reference }) };
}

/** The base a page is updated from, or null for a full translation. */
const updateBase = (it) => (it.status === "changed" && !FORCE ? it.baseHash : null);

function writePage(lang, file, text, newSource, state) {
  fs.mkdirSync(path.join(LESSONS, lang), { recursive: true });
  fs.writeFileSync(path.join(LESSONS, lang, file), text + "\n", "utf8");
  storeBase(newSource);
  (state[lang] ??= {})[file] = sha(newSource);
  saveState(state); // after every page, so an aborted run loses nothing
}

/** Translate one page directly (streaming, with retries and model fallback). @returns {Promise<boolean>} */
async function translatePage(lang, file, baseHash, state, note = "") {
  const job = pageJob(lang, file, baseHash, state);
  const label = `${job.mode.padEnd(9)} ${BATCH ? lang + "/" : ""}${file}`; // batch retries mix languages
  try {
    const text = await translate(systemPrompt(lang, LANG_NAMES[lang]), job.prompt, job.newSource);
    writePage(lang, file, text, job.newSource, state);
    console.log(`  ${c.green}✓${c.reset} ${label}${job.reference ? c.gray + " (en ref)" + c.reset : ""}${note}`);
    return true;
  } catch (e) {
    console.log(`  ${c.red}✗${c.reset} ${label}: ${e.message}`);
    return false;
  }
}

// ── batch ────────────────────────────────────────────────────────────────────

/** Submit one batch for the given pages and record it in batch.json. */
async function submitBatch(work, state) {
  const systems = new Map();
  const jobs = {};
  const requests = work.map(({ lang, it }, i) => {
    if (!systems.has(lang)) systems.set(lang, systemPrompt(lang, LANG_NAMES[lang]));
    const baseHash = updateBase(it);
    const job = pageJob(lang, it.file, baseHash, state);
    const id = `p${i}`; // custom_id allows only [A-Za-z0-9_-]
    jobs[id] = { lang, file: it.file, baseHash, newHash: job.newHash };
    return {
      custom_id: id,
      params: {
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        // No server-side fallbacks here — the Batches API rejects them; refusals are retried directly.
        system: [{ type: "text", text: systems.get(lang), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: job.prompt }],
      },
    };
  });
  const batch = await client.messages.batches.create({ requests });
  fs.writeFileSync(
    BATCH_FILE,
    JSON.stringify({ id: batch.id, model: MODEL, effort: EFFORT, created: new Date().toISOString(), jobs }, null, 2) + "\n",
    "utf8"
  );
  console.log(
    `\n${c.cyan}batch ${batch.id}${c.reset}: ${requests.length} page(s) submitted. ` +
    `Ctrl-C is safe — run again with --batch to collect the results.`
  );
}

/** Wait for the pending batch, write its results, retry failed pages directly. @returns {Promise<number>} failed pages */
async function collectBatch(state) {
  const saved = JSON.parse(fs.readFileSync(BATCH_FILE, "utf8"));
  const total = Object.keys(saved.jobs).length;
  let batch, lastLine = "";
  for (;;) {
    batch = await client.messages.batches.retrieve(saved.id);
    if (batch.processing_status === "ended") break;
    const n = batch.request_counts;
    const line = `batch ${saved.id}: ${total - n.processing}/${total} done, waiting…`;
    if (line !== lastLine) console.log(`${c.gray}${line}${c.reset}`);
    lastLine = line;
    await new Promise((r) => setTimeout(r, BATCH_POLL_MS));
  }

  console.log(`\nbatch ${saved.id} ended:`);
  /** @type {{ job: any, reason: string }[]} */
  const retry = [];
  let ok = 0;
  for await (const r of await client.messages.batches.results(saved.id)) {
    const job = saved.jobs[r.custom_id];
    if (!job) continue;
    const newSource = readLesson(SOURCE, job.file);
    if (sha(newSource) !== job.newHash) {
      console.log(`  ${c.yellow}skip${c.reset} ${job.lang}/${job.file}: German page changed since the batch was submitted`);
      continue;
    }
    let reason;
    if (r.result.type === "succeeded") {
      addUsage(r.result.message.usage, true);
      const result = checkResult(r.result.message, newSource);
      if (result.text) {
        writePage(job.lang, job.file, result.text, newSource, state);
        ok++;
        continue;
      }
      reason = result.error;
    } else if (r.result.type === "errored") {
      reason = `error: ${r.result.error?.error?.message ?? r.result.error?.error?.type ?? "unknown"}`;
    } else {
      reason = r.result.type; // canceled | expired
    }
    retry.push({ job, reason });
  }
  saveState(state);
  fs.unlinkSync(BATCH_FILE);
  console.log(`  ${c.green}✓${c.reset} ${ok} page(s) written`);

  if (!retry.length) return 0;
  console.log(`  ${retry.length} page(s) not delivered by the batch — retrying directly:`);
  let failed = 0;
  await pool(retry, CONCURRENCY, async ({ job, reason }) => {
    const done = await translatePage(job.lang, job.file, job.baseHash, state, `${c.gray} (batch: ${reason})${c.reset}`);
    if (!done) failed++;
  });
  return failed;
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
  const needsApi = CANCEL_BATCH || (!STATUS && !ADOPT && !DRY_RUN);
  if (needsApi) client = new Anthropic();

  let failed = 0;

  const pending = fs.existsSync(BATCH_FILE) ? JSON.parse(fs.readFileSync(BATCH_FILE, "utf8")) : null;
  if (CANCEL_BATCH) {
    if (!pending) return console.log("No pending batch.");
    await client.messages.batches.cancel(pending.id);
    fs.unlinkSync(BATCH_FILE);
    return console.log(`Batch ${pending.id} canceled.`);
  }
  if (pending) {
    const n = Object.keys(pending.jobs).length;
    if (STATUS || DRY_RUN) {
      console.log(`${c.yellow}Pending batch ${pending.id} (${n} page(s), submitted ${pending.created}).${c.reset}`);
    } else if (!BATCH) {
      console.error(
        `Batch ${pending.id} (${n} page(s)) is still pending. Run with --batch to collect it, ` +
        `or --cancel-batch to drop it.`
      );
      process.exit(1);
    } else {
      failed += await collectBatch(state);
    }
  }

  /** Pages to send in one batch, collected over all languages. @type {{ lang: string, it: any }[]} */
  const work = [];

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

    if (BATCH) {
      for (const it of todo) work.push({ lang, it });
      if (todo.length) console.log(`  ${todo.length} page(s) queued for the batch`);
      continue;
    }

    await pool(todo, CONCURRENCY, async (it) => {
      if (!(await translatePage(lang, it.file, updateBase(it), state))) failed++;
    });
  }

  // English pages first, as a batch of their own: they are the reference for all other languages.
  const enWork = work.filter((w) => w.lang === PIVOT);
  const restWork = work.filter((w) => w.lang !== PIVOT);
  for (const part of enWork.length && restWork.length ? [enWork, restWork] : [work]) {
    if (!part.length) continue;
    await submitBatch(part, state);
    failed += await collectBatch(state);
  }

  if (!STATUS && !DRY_RUN && !ADOPT) printUsage();
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
