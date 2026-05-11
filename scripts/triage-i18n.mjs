#!/usr/bin/env node
/**
 * triage-i18n.mjs
 * Interactive triage for translation review results.
 * Reads a JSON file produced by review-i18n-via-claude.mjs --save and lets
 * you work through each issue one by one.
 *
 * Usage:
 *   node scripts/triage-i18n.mjs --results results/de.json
 *   node scripts/triage-i18n.mjs --results results/de.json --accepted .i18n-accepted.json
 *   node scripts/triage-i18n.mjs --results results/de.json --errors-only
 *
 * Keys:
 *   [a]  Accept — mark as ok, won't show in future reviews
 *   [s]  Skip   — leave for later (default for Enter)
 *   [e]  Edit   — Claude suggests a fix; Enter to use it, [t]ype own, [c]ancel
 *   [q]  Quit   — save progress and exit
 */

import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import process from "node:process";
import recast from "recast";
import * as babelParser from "@babel/parser";
import Anthropic from "@anthropic-ai/sdk";

// ── CLI args ──────────────────────────────────────────────────────────────────

function getArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}
function hasFlag(name) { return process.argv.includes(name); }

const RESULTS_FILE  = getArg("--results", null);
const ACCEPTED_FILE = getArg("--accepted", ".i18n-accepted.json");
const SUGGEST_MODEL = getArg("--model", "claude-haiku-4-5-20251001");
const ERRORS_ONLY   = hasFlag("--errors-only");

if (!RESULTS_FILE) {
  console.error("Usage: node triage-i18n.mjs --results results/de.json");
  process.exit(1);
}

// Anthropic client — optional, only used for suggestions
const apiKey = process.env.ANTHROPIC_API_KEY;
const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

// ── ANSI ──────────────────────────────────────────────────────────────────────

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
  blue:   "\x1b[34m",
};

// ── Accepted list helpers ─────────────────────────────────────────────────────

function loadAccepted() {
  try { return JSON.parse(fs.readFileSync(ACCEPTED_FILE, "utf8")); }
  catch { return {}; }
}

function saveAccepted(data) {
  fs.writeFileSync(ACCEPTED_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function markAccepted(accepted, locale, key, note = "") {
  if (!accepted[locale]) accepted[locale] = {};
  accepted[locale][key] = { acceptedAt: new Date().toISOString(), note };
}

// ── Locale file editing (recast-based) ───────────────────────────────────────

function babelParse(code) {
  return recast.parse(code, {
    parser: {
      parse(source) {
        return babelParser.parse(source, {
          sourceType: "module",
          plugins: ["jsx", "typescript", "classProperties", "decorators-legacy"],
          allowReturnOutsideFunction: true,
          tokens: true,
        });
      },
    },
  });
}

function updateLocaleValue(localeFile, key, newValue) {
  const code = fs.readFileSync(localeFile, "utf8");
  const ast  = babelParse(code);
  let updated = false;

  recast.types.visit(ast, {
    visitExportDefaultDeclaration(p) {
      const decl = p.node.declaration;
      if (decl?.type !== "ObjectExpression") return false;
      for (const prop of decl.properties) {
        if (prop.type !== "ObjectProperty") continue;
        const k = prop.key;
        const propKey =
          k.type === "StringLiteral" ? k.value :
          k.type === "Identifier"    ? k.name  : null;
        if (propKey === key && prop.value?.type === "StringLiteral") {
          prop.value.value = newValue;
          updated = true;
        }
      }
      return false;
    },
  });

  if (!updated) throw new Error(`Key "${key}" not found in ${localeFile}`);
  fs.writeFileSync(localeFile, recast.print(ast).code, "utf8");
}

// ── AI suggestion ─────────────────────────────────────────────────────────────

async function suggestFix({ targetLanguage, key, enValue, locValue, issue }) {
  if (!anthropic) return null;
  const msg = await anthropic.messages.create({
    model: SUGGEST_MODEL,
    max_tokens: 512,
    messages: [{
      role: "user",
      content:
        `You are a professional translator for a network simulation application.\n` +
        `Fix this translation issue and return ONLY the corrected string — no explanation, no quotes.\n\n` +
        `Target language: ${targetLanguage}\n` +
        `Key: ${key}\n` +
        `Issue: ${issue}\n` +
        `English: ${enValue}\n` +
        `Current translation (problematic): ${locValue}`,
    }],
  });
  return msg.content[0]?.text?.trim() ?? null;
}

// ── Terminal I/O helpers ──────────────────────────────────────────────────────

function waitForKey() {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (ch) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(ch);
    });
  });
}

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

// ── Display helpers ───────────────────────────────────────────────────────────

function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + "…" : (s || ""); }

function severityColor(s) {
  if (s === "error") return c.red;
  if (s === "warn")  return c.yellow;
  return c.green;
}

function clearLine() { process.stdout.write("\r\x1b[K"); }

function printIssue(issue, idx, total, alreadyAccepted) {
  const sc = severityColor(issue.severity);
  const typeTag = issue.type === "ai" ? "AI" : "static";

  console.log();
  console.log(`${"─".repeat(60)}`);
  console.log(
    `${c.bold}[${idx + 1}/${total}]${c.reset}  ` +
    `${sc}${issue.severity.toUpperCase()}${c.reset}  ` +
    `${c.gray}(${typeTag})${c.reset}` +
    (alreadyAccepted ? `  ${c.gray}[already accepted]${c.reset}` : "")
  );
  console.log(`${c.cyan}${issue.key}${c.reset}`);
  if (issue.issue) console.log(`${c.yellow}Issue:${c.reset} ${issue.issue}`);
  if (issue.enValue !== undefined) {
    console.log(`${c.gray}EN:${c.reset} ${truncate(issue.enValue, 100)}`);
    console.log(`${c.gray}TR:${c.reset} ${truncate(issue.locValue, 100)}`);
  }
  console.log();
  const editNote = issue.severity !== "error" ? "[a]ccept  " : "";
  process.stdout.write(`${editNote}[e]dit  [s]kip  [q]uit  → `);
}

// ── Main triage loop ──────────────────────────────────────────────────────────

async function main() {
  // Load results
  let results;
  try {
    results = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
  } catch (e) {
    console.error(`Cannot read results file: ${e.message}`);
    process.exit(1);
  }

  // Support both single-locale and multi-locale save format
  const localeJobs = results.locale
    ? [{ locale: results.locale, localesDir: results.localesDir, targetLanguage: results.targetLanguage, issues: results.issues }]
    : results.locales.map((l) => ({ ...l, localesDir: results.localesDir }));

  const accepted = loadAccepted();
  let totalAccepted = 0, totalEdited = 0, totalSkipped = 0;

  for (const job of localeJobs) {
    const { locale, localesDir, issues } = job;
    const localeFile = path.join(localesDir, locale);

    let filteredIssues = issues.filter((i) => {
      if (ERRORS_ONLY && i.severity !== "error") return false;
      return true;
    });

    const alreadyAcceptedKeys = new Set(Object.keys(accepted[locale] || {}));
    const newIssues     = filteredIssues.filter((i) => !alreadyAcceptedKeys.has(i.key));
    const alreadyDone   = filteredIssues.length - newIssues.length;

    console.log(`\n${c.bold}Triage: ${locale}${c.reset} (${job.targetLanguage})`);
    console.log(`${filteredIssues.length} issues total, ${alreadyDone} already accepted, ${newIssues.length} to triage`);

    if (newIssues.length === 0) {
      console.log(`${c.green}✓ Nothing left to triage.${c.reset}`);
      continue;
    }

    let i = 0;
    while (i < newIssues.length) {
      const issue = newIssues[i];
      const alreadyAccepted = alreadyAcceptedKeys.has(issue.key);
      printIssue(issue, i, newIssues.length, alreadyAccepted);

      const key = await waitForKey();
      clearLine();

      // Ctrl+C
      if (key === "") {
        console.log("\nInterrupted.");
        saveAccepted(accepted);
        process.exit(0);
      }

      if (key === "q" || key === "Q") {
        console.log(`Quit. Progress saved.`);
        break;
      }

      if ((key === "a" || key === "A") && issue.severity !== "error") {
        markAccepted(accepted, locale, issue.key);
        saveAccepted(accepted);
        totalAccepted++;
        console.log(`${c.green}✓ Accepted${c.reset}`);
        i++;
        continue;
      }

      if (key === "e" || key === "E") {
        let suggestion = null;

        if (anthropic) {
          process.stdout.write(`${c.gray}Fetching suggestion…${c.reset}`);
          try {
            suggestion = await suggestFix({
              targetLanguage: job.targetLanguage,
              key: issue.key,
              enValue: issue.enValue,
              locValue: issue.locValue,
              issue: issue.issue,
            });
          } catch (err) {
            suggestion = null;
          }
          clearLine();
        }

        console.log(`\n${c.gray}EN:${c.reset}      ${issue.enValue}`);
        console.log(`${c.gray}Current:${c.reset} ${issue.locValue}`);

        if (suggestion) {
          console.log(`${c.green}Suggest:${c.reset} ${suggestion}`);
          console.log();
          process.stdout.write(`[Enter] use suggestion  [t]ype own  [c]ancel  → `);
          const choice = await waitForKey();
          clearLine();

          if (choice === "c" || choice === "C" || choice === "\x1b") {
            console.log(`${c.gray}Cancelled${c.reset}`);
            i++;
            continue;
          }

          let newVal;
          if (choice === "t" || choice === "T") {
            newVal = (await promptLine(`New value: `)).trim();
          } else {
            // Enter or anything else → accept suggestion
            newVal = suggestion;
          }

          if (!newVal) {
            console.log(`${c.gray}(unchanged)${c.reset}`);
          } else {
            try {
              updateLocaleValue(localeFile, issue.key, newVal);
              console.log(`${c.green}✓ Updated in ${locale}${c.reset}`);
              totalEdited++;
              markAccepted(accepted, locale, issue.key, "edited");
              saveAccepted(accepted);
              totalAccepted++;
            } catch (err) {
              console.log(`${c.red}Update failed: ${err.message}${c.reset}`);
            }
          }
        } else {
          // No suggestion available (no API key or request failed)
          if (!anthropic) console.log(`${c.gray}(no ANTHROPIC_API_KEY — type manually)${c.reset}`);
          const newVal = (await promptLine(`New value: `)).trim();
          if (!newVal) {
            console.log(`${c.gray}(unchanged)${c.reset}`);
          } else {
            try {
              updateLocaleValue(localeFile, issue.key, newVal);
              console.log(`${c.green}✓ Updated in ${locale}${c.reset}`);
              totalEdited++;
              markAccepted(accepted, locale, issue.key, "edited");
              saveAccepted(accepted);
              totalAccepted++;
            } catch (err) {
              console.log(`${c.red}Update failed: ${err.message}${c.reset}`);
            }
          }
        }

        i++;
        continue;
      }

      // [s], Enter, or anything else → skip
      console.log(`${c.gray}Skipped${c.reset}`);
      totalSkipped++;
      i++;
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`${c.bold}Session summary${c.reset}`);
  console.log(`  ${c.green}Accepted: ${totalAccepted}${c.reset}`);
  console.log(`  ${c.cyan}Edited:   ${totalEdited}${c.reset}`);
  console.log(`  ${c.gray}Skipped:  ${totalSkipped}${c.reset}`);
  if (totalAccepted > 0 || totalEdited > 0)
    console.log(`  Accept list saved to ${c.bold}${ACCEPTED_FILE}${c.reset}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
