#!/usr/bin/env node
/**
 * review-i18n-via-claude.mjs
 * Reviews existing translations for quality and correctness.
 * Phase 1: Static checks (placeholder consistency, untranslated strings)
 * Phase 2: AI review via Claude (accuracy, naturalness, terminology)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node scripts/review-i18n-via-claude.mjs
 *   ANTHROPIC_API_KEY=... node scripts/review-i18n-via-claude.mjs --locale de.js
 *   ANTHROPIC_API_KEY=... node scripts/review-i18n-via-claude.mjs --locale de.js --no-ai
 *   ANTHROPIC_API_KEY=... node scripts/review-i18n-via-claude.mjs --output review.md
 *
 * Options:
 *   --locales  ./locales        Directory with locale files
 *   --source   en.js            Source of truth locale
 *   --locale   de.js            Review only this locale (default: all non-source)
 *   --model    claude-sonnet-4-6
 *   --batch    30               Strings per API call
 *   --no-ai                     Static checks only, no API calls
 *   --output   file.md          Write report to file (default: stdout)
 *   --only-issues               Suppress OK lines in the detail section
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

const LOCALES_DIR = path.resolve(getArg("--locales", "./locales"));
const SOURCE_LOCALE = getArg("--source", "en.js");
const SINGLE_LOCALE = getArg("--locale", null);
const MODEL = getArg("--model", "claude-sonnet-4-6");
const BATCH_SIZE = Number(getArg("--batch", 30));
const OUTPUT_FILE = getArg("--output", null);
const NO_AI = hasFlag("--no-ai");
const ONLY_ISSUES = hasFlag("--only-issues");

// ── ANSI colors (stripped when writing to file) ───────────────────────────────

const isTTY = process.stdout.isTTY && !OUTPUT_FILE;
const c = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  red: isTTY ? "\x1b[31m" : "",
  green: isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  blue: isTTY ? "\x1b[34m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
  gray: isTTY ? "\x1b[90m" : "",
};

// ── Output handling ───────────────────────────────────────────────────────────

const lines = [];
function emit(line = "") { lines.push(line); }
function flush() {
  const out = lines.join("\n");
  if (OUTPUT_FILE) {
    // Strip ANSI when writing to file
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

  const entries = new Map(); // key -> value string
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
  const matches = [];
  // {name}, {ip.addr}, ${name}
  for (const m of str.matchAll(/\$?\{[^}]+\}/g)) matches.push(m[0]);
  // %s, %d, %i, %f
  for (const m of str.matchAll(/%[sdif]/g)) matches.push(m[0]);
  return matches;
}

function staticCheck(sourceEntries, localeEntries) {
  const issues = [];

  for (const [key, enValue] of sourceEntries) {
    if (!localeEntries.has(key)) continue; // missing handled by sync check

    const locValue = localeEntries.get(key);

    // Empty translation
    if (locValue.trim() === "") {
      issues.push({ key, severity: "error", type: "empty", enValue, locValue, detail: "Translation is empty." });
      continue;
    }

    // Placeholder mismatch
    const enPlaceholders = extractPlaceholders(enValue);
    const locPlaceholders = extractPlaceholders(locValue);
    const enSet = new Set(enPlaceholders);
    const locSet = new Set(locPlaceholders);

    const missingInLoc = [...enSet].filter((p) => !locSet.has(p));
    const extraInLoc = [...locSet].filter((p) => !enSet.has(p));

    if (missingInLoc.length > 0) {
      issues.push({
        key, severity: "error", type: "placeholder_missing", enValue, locValue,
        detail: `Missing placeholder(s): ${missingInLoc.join(", ")}`,
      });
    }
    if (extraInLoc.length > 0) {
      issues.push({
        key, severity: "warn", type: "placeholder_extra", enValue, locValue,
        detail: `Unexpected placeholder(s): ${extraInLoc.join(", ")}`,
      });
    }

    // Possibly untranslated: identical to English AND looks like real prose
    if (locValue === enValue && !key.startsWith("lang.")) {
      // Strip placeholders and punctuation to get meaningful word content
      const stripped = enValue
        .replace(/\$?\{[^}]+\}/g, "")
        .replace(/%[sdif]/g, "")
        .replace(/[←→⟳⏳✕^]/g, "")
        .trim();
      const words = stripped.split(/\s+/).filter((w) => /[a-zA-Z]{2,}/.test(w));
      const meaningfulChars = stripped.replace(/[^a-zA-Z]/g, "");

      // Only flag if: multiple words AND enough real letter content
      // Single-word technical terms (Gateway, Port, Firewall, …) are legitimately the same
      if (words.length >= 2 && meaningfulChars.length >= 12) {
        issues.push({
          key, severity: "warn", type: "untranslated", enValue, locValue,
          detail: "Translation is identical to English — possibly not translated.",
        });
      }
    }
  }

  return issues;
}

// ── AI review ─────────────────────────────────────────────────────────────────

const AI_SYSTEM_PROMPT =
  "You are a professional translation quality reviewer for software UI strings. " +
  "The application is a network simulation tool (routers, switches, PCs, TCP/IP protocols, DHCP, DNS, etc.). " +
  "You will receive a JSON object with English source strings and their translations. " +
  "Evaluate each translation for: accuracy, naturalness in the target language, " +
  "consistency of technical networking terms, and correct use of formal/informal register. " +
  "Do NOT flag placeholder tokens like {name}, {ip}, {port}, ${name} — those must remain unchanged. " +
  "Return ONLY a valid JSON array (no markdown, no explanation) with one object per string:\n" +
  '[\n  {"key":"...", "status":"ok"|"warn"|"error", "issue":"brief description (omit or empty string for ok)"}\n]\n' +
  "Status guide:\n" +
  "  ok    — translation is correct and natural\n" +
  "  warn  — minor issue: suboptimal phrasing, slightly unnatural, or minor inconsistency\n" +
  "  error — significant problem: wrong meaning, missing content, wrong register, or very unnatural";

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in AI response");
  return JSON.parse(match[0]);
}

async function aiReviewBatch({ client, targetLang, pairs }) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: "text", text: AI_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          targetLanguage: targetLang,
          strings: pairs.reduce((acc, p) => { acc[p.key] = { en: p.en, translated: p.translated }; return acc; }, {}),
        }),
      },
    ],
  });

  const content = msg.content[0]?.text?.trim();
  if (!content) throw new Error("Empty AI response");
  return extractJsonArray(content);
}

async function aiReviewLocale({ client, targetLang, pairs }) {
  const chunks = chunk(pairs, BATCH_SIZE);
  const results = [];
  let done = 0;

  for (const ch of chunks) {
    process.stderr.write(`\r  AI review: ${done}/${pairs.length} strings...`);
    const batchResults = await aiReviewBatch({ client, targetLang, pairs: ch });
    results.push(...batchResults);
    done += ch.length;
  }
  process.stderr.write(`\r  AI review: ${pairs.length}/${pairs.length} strings done.   \n`);

  return results;
}

// ── Report formatting ─────────────────────────────────────────────────────────

function severityLabel(s) {
  if (s === "error") return `${c.red}✖ ERROR${c.reset}`;
  if (s === "warn") return `${c.yellow}⚠ WARN ${c.reset}`;
  return `${c.green}✓ ok   ${c.reset}`;
}

function severitySort(s) { return s === "error" ? 0 : s === "warn" ? 1 : 2; }

function formatIssue(issue, { enValue, locValue } = {}) {
  const label = severityLabel(issue.severity || issue.status);
  const key = `${c.cyan}${issue.key}${c.reset}`;
  const detail = issue.detail || issue.issue || "";
  const lines2 = [`  ${label} ${key}${detail ? ` — ${detail}` : ""}`];
  if (enValue !== undefined) {
    lines2.push(`    ${c.gray}EN:${c.reset} ${truncate(enValue, 80)}`);
    lines2.push(`    ${c.gray}TR:${c.reset} ${truncate(locValue, 80)}`);
  }
  return lines2.join("\n");
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ── Main ──────────────────────────────────────────────────────────────────────

async function reviewLocale({ client, file, sourceEntries }) {
  const filePath = path.join(LOCALES_DIR, file);
  let localeEntries;
  try {
    localeEntries = extractEntries(filePath);
  } catch (e) {
    emit(`${c.red}✖ ${file}${c.reset}: parse error — ${e.message}`);
    return { file, errors: 1, warns: 0, oks: 0 };
  }

  // Derive language name from meta (first line comment or lang.name key)
  const langName = localeEntries.get("lang.name") || file.replace(".js", "");
  const localeName = `${c.bold}${file}${c.reset} (${langName.replace(/\s*\([^)]*\)/, "").trim()})`;

  emit(`\n${"─".repeat(60)}`);
  emit(`${c.bold}Review: ${localeName}${c.reset}`);
  emit(`${"─".repeat(60)}`);

  // ── Phase 1: Static checks ────────────────────────────────────────────────
  emit(`\n${c.bold}Phase 1 — Static checks${c.reset}`);

  const missingKeys = [...sourceEntries.keys()].filter((k) => !localeEntries.has(k));
  const extraKeys = [...localeEntries.keys()].filter((k) => !sourceEntries.has(k));

  if (missingKeys.length > 0) {
    emit(`  ${c.red}Missing keys (${missingKeys.length}):${c.reset}`);
    for (const k of missingKeys) emit(`    ${c.gray}${k}${c.reset}`);
  } else {
    emit(`  ${c.green}✓${c.reset} All ${sourceEntries.size} keys present`);
  }

  if (extraKeys.length > 0) {
    emit(`  ${c.cyan}Extra / obsolete keys (${extraKeys.length}):${c.reset}`);
    for (const k of extraKeys) emit(`    ${c.gray}${k}${c.reset}`);
  }

  const staticIssues = staticCheck(sourceEntries, localeEntries);
  const staticErrors = staticIssues.filter((i) => i.severity === "error");
  const staticWarns = staticIssues.filter((i) => i.severity === "warn");

  emit(
    `\n  Placeholder / content checks: ` +
      `${c.red}${staticErrors.length} errors${c.reset}, ` +
      `${c.yellow}${staticWarns.length} warnings${c.reset}`
  );

  const sortedStatic = [...staticIssues].sort((a, b) => severitySort(a.severity) - severitySort(b.severity));
  for (const issue of sortedStatic) {
    emit(formatIssue(issue, { enValue: issue.enValue, locValue: issue.locValue }));
  }

  // ── Phase 2: AI review ────────────────────────────────────────────────────
  let aiErrors = 0, aiWarns = 0, aiOks = 0;
  const aiIssues = [];

  if (NO_AI) {
    emit(`\n${c.gray}Phase 2 — AI review skipped (--no-ai)${c.reset}`);
  } else {
    emit(`\n${c.bold}Phase 2 — AI review${c.reset} (${MODEL})`);

    // Only review strings that exist in both source and locale, and passed static checks
    const staticErrorKeys = new Set(staticErrors.map((i) => i.key));
    const pairs = [];
    for (const [key, enValue] of sourceEntries) {
      if (!localeEntries.has(key)) continue;
      if (staticErrorKeys.has(key)) continue; // already flagged, skip AI to save tokens
      pairs.push({ key, en: enValue, translated: localeEntries.get(key) });
    }

    emit(`  Sending ${pairs.length} strings for AI review...`);

    let rawResults = [];
    try {
      rawResults = await aiReviewLocale({ client, targetLang: langName, pairs });
    } catch (e) {
      emit(`  ${c.red}AI review failed: ${e.message}${c.reset}`);
    }

    // Build a map from AI results
    const aiMap = new Map(rawResults.map((r) => [r.key, r]));

    for (const pair of pairs) {
      const result = aiMap.get(pair.key);
      if (!result) continue;
      const status = result.status;
      if (status === "error") { aiErrors++; aiIssues.push({ ...result, severity: "error", enValue: pair.en, locValue: pair.translated }); }
      else if (status === "warn") { aiWarns++; aiIssues.push({ ...result, severity: "warn", enValue: pair.en, locValue: pair.translated }); }
      else aiOks++;
    }

    emit(
      `  AI result: ${c.green}${aiOks} ok${c.reset}, ` +
        `${c.yellow}${aiWarns} warnings${c.reset}, ` +
        `${c.red}${aiErrors} errors${c.reset}`
    );

    const sortedAi = [...aiIssues].sort((a, b) => severitySort(a.severity) - severitySort(b.severity));
    for (const issue of sortedAi) {
      if (ONLY_ISSUES && (issue.status === "ok" || issue.severity === "ok")) continue;
      emit(formatIssue(issue, { enValue: issue.enValue, locValue: issue.locValue }));
    }
  }

  // ── Summary for this locale ───────────────────────────────────────────────
  const totalErrors = missingKeys.length + staticErrors.length + aiErrors;
  const totalWarns = extraKeys.length + staticWarns.length + aiWarns;

  const summaryColor = totalErrors > 0 ? c.red : totalWarns > 0 ? c.yellow : c.green;
  const summaryIcon = totalErrors > 0 ? "✖" : totalWarns > 0 ? "⚠" : "✓";
  emit(
    `\n${summaryColor}${summaryIcon}${c.reset} ${c.bold}${file}${c.reset}: ` +
      `${c.red}${totalErrors} errors${c.reset}, ${c.yellow}${totalWarns} warnings${c.reset}`
  );

  return { file, errors: totalErrors, warns: totalWarns, oks: aiOks };
}

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
    grandWarns += s.warns;
  }

  emit();
  if (grandErrors === 0 && grandWarns === 0) {
    emit(`${c.green}${c.bold}All translations look good!${c.reset}`);
  } else {
    emit(`Total: ${c.red}${c.bold}${grandErrors} errors${c.reset}, ${c.yellow}${grandWarns} warnings${c.reset}`);
  }

  flush();
  process.exit(grandErrors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
