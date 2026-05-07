#!/usr/bin/env node
/**
 * review-i18n-via-claude.mjs
 * Reviews existing translations for quality and correctness.
 * Phase 1: Static checks (placeholder consistency, untranslated strings)
 * Phase 2: AI review via Claude (accuracy, naturalness, terminology)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node scripts/review-i18n-via-claude.mjs --locale de.js --save results/de.json
 *   ANTHROPIC_API_KEY=... node scripts/review-i18n-via-claude.mjs --no-ai --locale de.js
 *   ANTHROPIC_API_KEY=... node scripts/review-i18n-via-claude.mjs --output review.md
 *
 * Options:
 *   --locales   ./locales           Directory with locale files
 *   --source    en.js               Source of truth locale
 *   --locale    de.js               Review only this locale (default: all non-source)
 *   --model     claude-sonnet-4-6
 *   --batch     30                  Strings per API call
 *   --no-ai                         Static checks only, no API calls
 *   --output    file.md             Write report to file (default: stdout)
 *   --only-issues                   Suppress OK lines in the detail section
 *   --save      results/de.json     Save triageable issues as JSON (for triage-i18n.mjs)
 *   --accepted  .i18n-accepted.json Already-accepted keys to suppress from report
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "@babel/parser";
import Anthropic from "@anthropic-ai/sdk";

// ── CLI args ──────────────────────────────────────────────────────────────────

function getArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}
function hasFlag(name) { return process.argv.includes(name); }

const LOCALES_DIR   = path.resolve(getArg("--locales", "./locales"));
const SOURCE_LOCALE = getArg("--source", "en.js");
const SINGLE_LOCALE = getArg("--locale", null);
const MODEL         = getArg("--model", "claude-sonnet-4-6");
const BATCH_SIZE    = Number(getArg("--batch", 30));
const OUTPUT_FILE   = getArg("--output", null);
const SAVE_FILE     = getArg("--save", null);
const ACCEPTED_FILE = getArg("--accepted", ".i18n-accepted.json");
const NO_AI         = hasFlag("--no-ai");
const ONLY_ISSUES   = hasFlag("--only-issues");

// ── Accepted list ─────────────────────────────────────────────────────────────
// Shape: { "de.js": { "some.key": { acceptedAt, note } }, ... }

function loadAccepted() {
  try { return JSON.parse(fs.readFileSync(ACCEPTED_FILE, "utf8")); }
  catch { return {}; }
}
const accepted = loadAccepted();

function isAccepted(file, key) {
  return !!accepted[file]?.[key];
}

// ── ANSI colors ───────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY && !OUTPUT_FILE;
const c = {
  reset:  isTTY ? "\x1b[0m"  : "",
  bold:   isTTY ? "\x1b[1m"  : "",
  red:    isTTY ? "\x1b[31m" : "",
  green:  isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  cyan:   isTTY ? "\x1b[36m" : "",
  gray:   isTTY ? "\x1b[90m" : "",
};

// ── Output buffering ──────────────────────────────────────────────────────────

const lines = [];
function emit(line = "") { lines.push(line); }
function flush() {
  const out = lines.join("\n");
  if (OUTPUT_FILE) {
    fs.writeFileSync(OUTPUT_FILE, out.replace(/\x1b\[[0-9;]*m/g, ""), "utf8");
    console.error(`Report written to ${OUTPUT_FILE}`);
  } else {
    console.log(out);
  }
}

// ── AST key/value extraction ──────────────────────────────────────────────────

function isObject(v) { return v !== null && typeof v === "object"; }

function walk(node, visit) {
  if (!isObject(node)) return;
  visit(node);
  if (Array.isArray(node)) { for (const item of node) walk(item, visit); return; }
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) for (const item of val) walk(item, visit);
    else if (isObject(val) && typeof val.type === "string") walk(val, visit);
  }
}

function extractEntries(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript", "decorators-legacy"],
    errorRecovery: true,
  });
  const entries = new Map();
  walk(ast, (node) => {
    if (node.type === "ExportDefaultDeclaration") {
      const decl = node.declaration;
      if (decl?.type === "ObjectExpression") {
        for (const prop of decl.properties) {
          if (prop.type !== "ObjectProperty" || prop.computed) continue;
          const k = prop.key;
          const v = prop.value;
          const key = k.type === "StringLiteral" ? k.value : k.type === "Identifier" ? k.name : null;
          if (key && v.type === "StringLiteral") entries.set(key, v.value);
        }
      }
    }
  });
  return entries;
}

// ── Static checks ─────────────────────────────────────────────────────────────

function extractPlaceholders(str) {
  const out = [];
  for (const m of str.matchAll(/\$?\{[^}]+\}/g)) out.push(m[0]);
  for (const m of str.matchAll(/%[sdif]/g)) out.push(m[0]);
  return out;
}

function staticCheck(sourceEntries, localeEntries) {
  const issues = [];
  for (const [key, enValue] of sourceEntries) {
    if (!localeEntries.has(key)) continue;
    const locValue = localeEntries.get(key);

    if (locValue.trim() === "") {
      issues.push({ key, severity: "error", type: "empty", issue: "Translation is empty.", enValue, locValue });
      continue;
    }

    const enSet  = new Set(extractPlaceholders(enValue));
    const locSet = new Set(extractPlaceholders(locValue));
    const missing = [...enSet].filter((p) => !locSet.has(p));
    const extra   = [...locSet].filter((p) => !enSet.has(p));

    if (missing.length > 0)
      issues.push({ key, severity: "error", type: "placeholder_missing",
        issue: `Missing placeholder(s): ${missing.join(", ")}`, enValue, locValue });
    if (extra.length > 0)
      issues.push({ key, severity: "warn", type: "placeholder_extra",
        issue: `Unexpected placeholder(s): ${extra.join(", ")}`, enValue, locValue });

    // Possibly untranslated — only flag multi-word, non-trivial strings
    if (locValue === enValue && !key.startsWith("lang.")) {
      const stripped = enValue
        .replace(/\$?\{[^}]+\}/g, "").replace(/%[sdif]/g, "")
        .replace(/[←→⟳⏳✕^]/g, "").trim();
      const words = stripped.split(/\s+/).filter((w) => /[a-zA-Z]{2,}/.test(w));
      if (words.length >= 2 && stripped.replace(/[^a-zA-Z]/g, "").length >= 12) {
        issues.push({ key, severity: "warn", type: "untranslated",
          issue: "Translation is identical to English — possibly not translated.", enValue, locValue });
      }
    }
  }
  return issues;
}

// ── AI review ─────────────────────────────────────────────────────────────────

const AI_SYSTEM_PROMPT =
  "You are a professional translation quality reviewer for software UI strings. " +
  "The application is a network simulation tool (routers, switches, PCs, TCP/IP protocols, DHCP, DNS, etc.). " +
  "Evaluate each translation for: accuracy, naturalness in the target language, " +
  "consistency of technical networking terms, and correct use of formal/informal register. " +
  "Do NOT flag placeholder tokens like {name}, {ip}, {port} — those must remain unchanged. " +
  "Return ONLY a valid JSON array (no markdown, no explanation):\n" +
  '[{"key":"...","status":"ok"|"warn"|"error","issue":"brief description or empty string for ok"}]\n' +
  "ok=correct and natural, warn=suboptimal, error=wrong meaning/very unnatural";

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractJsonArray(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("No JSON array in AI response");
  return JSON.parse(m[0]);
}

async function aiReviewLocale({ client, targetLang, pairs }) {
  const chunks = chunk(pairs, BATCH_SIZE);
  const results = [];
  let done = 0;

  for (const ch of chunks) {
    process.stderr.write(`\r  AI review: ${done}/${pairs.length} strings...`);
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: AI_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: JSON.stringify({
          targetLanguage: targetLang,
          strings: ch.reduce((acc, p) => { acc[p.key] = { en: p.en, translated: p.translated }; return acc; }, {}),
        }),
      }],
    });
    const content = msg.content[0]?.text?.trim();
    if (content) results.push(...extractJsonArray(content));
    done += ch.length;
  }
  process.stderr.write(`\r  AI review: ${pairs.length}/${pairs.length} strings done.   \n`);
  return results;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function severityLabel(s) {
  if (s === "error") return `${c.red}✖ ERROR${c.reset}`;
  if (s === "warn")  return `${c.yellow}⚠ WARN ${c.reset}`;
  return `${c.green}✓ ok   ${c.reset}`;
}
function severitySort(s) { return s === "error" ? 0 : s === "warn" ? 1 : 2; }
function truncate(s, n)   { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function formatIssue(issue) {
  const label  = severityLabel(issue.severity);
  const detail = issue.issue || "";
  const out = [`  ${label} ${c.cyan}${issue.key}${c.reset}${detail ? ` — ${detail}` : ""}`];
  if (issue.enValue !== undefined) {
    out.push(`    ${c.gray}EN:${c.reset} ${truncate(issue.enValue, 80)}`);
    out.push(`    ${c.gray}TR:${c.reset} ${truncate(issue.locValue, 80)}`);
  }
  return out.join("\n");
}

// ── Per-locale review ─────────────────────────────────────────────────────────

async function reviewLocale({ client, file, sourceEntries }) {
  const filePath = path.join(LOCALES_DIR, file);
  let localeEntries;
  try {
    localeEntries = extractEntries(filePath);
  } catch (e) {
    emit(`${c.red}✖ ${file}${c.reset}: parse error — ${e.message}`);
    return { file, errors: 1, warns: 0, oks: 0, issues: [] };
  }

  const langName   = localeEntries.get("lang.name") || file.replace(".js", "");
  const langClean  = langName.replace(/\s*\([^)]*\)/, "").trim();

  emit(`\n${"─".repeat(60)}`);
  emit(`${c.bold}Review: ${c.bold}${file}${c.reset} (${langClean})`);
  emit(`${"─".repeat(60)}`);

  // ── Phase 1: Static ───────────────────────────────────────────────────────

  emit(`\n${c.bold}Phase 1 — Static checks${c.reset}`);

  const missingKeys = [...sourceEntries.keys()].filter((k) => !localeEntries.has(k));
  const extraKeys   = [...localeEntries.keys()].filter((k) => !sourceEntries.has(k));

  if (missingKeys.length > 0) {
    emit(`  ${c.red}Missing keys (${missingKeys.length}):${c.reset}`);
    for (const k of missingKeys) emit(`    ${c.gray}${k}${c.reset}`);
  } else {
    emit(`  ${c.green}✓${c.reset} All ${sourceEntries.size} keys present`);
  }
  if (extraKeys.length > 0) {
    emit(`  ${c.cyan}Extra / obsolete (${extraKeys.length}):${c.reset}`);
    for (const k of extraKeys) emit(`    ${c.gray}${k}${c.reset}`);
  }

  const staticIssues = staticCheck(sourceEntries, localeEntries);
  const staticErrors = staticIssues.filter((i) => i.severity === "error");
  const staticWarns  = staticIssues.filter((i) => i.severity === "warn");

  emit(`\n  Checks: ${c.red}${staticErrors.length} errors${c.reset}, ${c.yellow}${staticWarns.length} warnings${c.reset}`);
  for (const issue of [...staticIssues].sort((a, b) => severitySort(a.severity) - severitySort(b.severity))) {
    if (isAccepted(file, issue.key) && issue.severity === "warn") continue;
    emit(formatIssue(issue));
  }

  // ── Phase 2: AI ───────────────────────────────────────────────────────────

  const allTriageableIssues = [
    ...staticIssues.map((i) => ({ ...i, source: "static" })),
  ];

  let aiErrors = 0, aiWarns = 0, aiOks = 0;

  if (NO_AI) {
    emit(`\n${c.gray}Phase 2 — AI review skipped (--no-ai)${c.reset}`);
  } else {
    emit(`\n${c.bold}Phase 2 — AI review${c.reset} (${MODEL})`);

    const staticErrorKeys = new Set(staticErrors.map((i) => i.key));
    const pairs = [];
    for (const [key, enValue] of sourceEntries) {
      if (!localeEntries.has(key) || staticErrorKeys.has(key)) continue;
      pairs.push({ key, en: enValue, translated: localeEntries.get(key) });
    }

    emit(`  Sending ${pairs.length} strings for AI review...`);

    let rawResults = [];
    try { rawResults = await aiReviewLocale({ client, targetLang: langClean, pairs }); }
    catch (e) { emit(`  ${c.red}AI review failed: ${e.message}${c.reset}`); }

    const aiMap = new Map(rawResults.map((r) => [r.key, r]));
    const aiIssues = [];

    for (const pair of pairs) {
      const r = aiMap.get(pair.key);
      if (!r) continue;
      if (r.status === "error") {
        aiErrors++;
        aiIssues.push({ key: pair.key, severity: "error", type: "ai", issue: r.issue || "", enValue: pair.en, locValue: pair.translated, source: "ai" });
      } else if (r.status === "warn") {
        aiWarns++;
        aiIssues.push({ key: pair.key, severity: "warn", type: "ai", issue: r.issue || "", enValue: pair.en, locValue: pair.translated, source: "ai" });
      } else {
        aiOks++;
      }
    }

    allTriageableIssues.push(...aiIssues);

    emit(`  Result: ${c.green}${aiOks} ok${c.reset}, ${c.yellow}${aiWarns} warnings${c.reset}, ${c.red}${aiErrors} errors${c.reset}`);

    const suppressedCount = aiIssues.filter((i) => i.severity !== "error" && isAccepted(file, i.key)).length;
    if (suppressedCount > 0) emit(`  ${c.gray}(${suppressedCount} warnings suppressed by accept list)${c.reset}`);

    for (const issue of [...aiIssues].sort((a, b) => severitySort(a.severity) - severitySort(b.severity))) {
      if (ONLY_ISSUES && issue.severity !== "warn" && issue.severity !== "error") continue;
      if (isAccepted(file, issue.key) && issue.severity !== "error") continue;
      emit(formatIssue(issue));
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const totalErrors = missingKeys.length + staticErrors.length + aiErrors;
  const totalWarns  = extraKeys.length  + staticWarns.length  + aiWarns;
  const icon = totalErrors > 0 ? `${c.red}✖${c.reset}` : totalWarns > 0 ? `${c.yellow}⚠${c.reset}` : `${c.green}✓${c.reset}`;
  emit(`\n${icon} ${c.bold}${file}${c.reset}: ${c.red}${totalErrors} errors${c.reset}, ${c.yellow}${totalWarns} warnings${c.reset}`);

  return {
    file,
    locale: file,
    targetLanguage: langClean,
    errors: totalErrors,
    warns: totalWarns,
    oks: aiOks,
    issues: allTriageableIssues,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const sourceFile = path.join(LOCALES_DIR, SOURCE_LOCALE);
  if (!fs.existsSync(sourceFile)) {
    console.error(`Source locale not found: ${sourceFile}`);
    process.exit(2);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !NO_AI) {
    console.error("Missing ANTHROPIC_API_KEY. Use --no-ai for static checks only.");
    process.exit(1);
  }

  const client = NO_AI ? null : new Anthropic({ apiKey });
  const sourceEntries = extractEntries(sourceFile);

  const localeFiles = SINGLE_LOCALE
    ? [SINGLE_LOCALE]
    : fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".js") && f !== SOURCE_LOCALE).sort();

  emit(`${c.bold}i18n Translation Review${c.reset}`);
  emit(`Source: ${SOURCE_LOCALE} (${sourceEntries.size} keys)`);
  emit(`Locales: ${localeFiles.join(", ")}`);
  emit(`AI model: ${NO_AI ? "disabled" : MODEL}`);
  if (fs.existsSync(ACCEPTED_FILE)) emit(`Accept list: ${ACCEPTED_FILE}`);

  const summaries = [];
  for (const file of localeFiles) {
    const result = await reviewLocale({ client, file, sourceEntries });
    summaries.push(result);
  }

  // ── Overall summary ───────────────────────────────────────────────────────

  emit(`\n${"═".repeat(60)}`);
  emit(`${c.bold}Overall Summary${c.reset}`);
  emit(`${"═".repeat(60)}`);

  let grandErrors = 0, grandWarns = 0;
  for (const s of summaries) {
    const icon = s.errors > 0 ? `${c.red}✖${c.reset}` : s.warns > 0 ? `${c.yellow}⚠${c.reset}` : `${c.green}✓${c.reset}`;
    emit(`  ${icon} ${s.file.padEnd(12)} — ${c.red}${s.errors} errors${c.reset}, ${c.yellow}${s.warns} warnings${c.reset}`);
    grandErrors += s.errors;
    grandWarns  += s.warns;
  }

  emit();
  if (grandErrors === 0 && grandWarns === 0) emit(`${c.green}${c.bold}All translations look good!${c.reset}`);
  else emit(`Total: ${c.red}${c.bold}${grandErrors} errors${c.reset}, ${c.yellow}${grandWarns} warnings${c.reset}`);

  if (SAVE_FILE) {
    const saveDir = path.dirname(SAVE_FILE);
    if (saveDir !== "." && !fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    // One file per locale, or a combined file if reviewing multiple
    if (summaries.length === 1) {
      const s = summaries[0];
      fs.writeFileSync(SAVE_FILE, JSON.stringify({
        locale: s.locale,
        localesDir: LOCALES_DIR,
        sourceLocale: SOURCE_LOCALE,
        targetLanguage: s.targetLanguage,
        generatedAt: new Date().toISOString(),
        issues: s.issues,
      }, null, 2), "utf8");
      console.error(`Issues saved to ${SAVE_FILE} (${s.issues.length} entries)`);
    } else {
      fs.writeFileSync(SAVE_FILE, JSON.stringify({
        localesDir: LOCALES_DIR,
        sourceLocale: SOURCE_LOCALE,
        generatedAt: new Date().toISOString(),
        locales: summaries.map((s) => ({
          locale: s.locale,
          targetLanguage: s.targetLanguage,
          issues: s.issues,
        })),
      }, null, 2), "utf8");
      console.error(`Issues saved to ${SAVE_FILE}`);
    }
  }

  flush();
  process.exit(grandErrors > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
