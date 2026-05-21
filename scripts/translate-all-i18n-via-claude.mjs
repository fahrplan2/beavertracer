#!/usr/bin/env node
/**
 * translate-all-i18n-via-claude.mjs
 * Runs translate-i18n-via-claude.mjs for all target locales.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node scripts/translate-all-i18n-via-claude.mjs
 *   ANTHROPIC_API_KEY=... node scripts/translate-all-i18n-via-claude.mjs --force
 *
 * --force       Re-translate all strings (not just missing ones)
 * --max-tokens  Max tokens per API call (default: 8192; increase for CJK languages)
 * --batch       Strings per batch (default: 40)
 */

import { spawnSync } from "node:child_process";
import process from "node:process";
import { LOCALES } from "./locales.mjs";

const TRANSLATE_SCRIPT = "./scripts/translate-i18n-via-claude.mjs";
const INPUT = "locales/en.js";

const HELP_TEXT = `
Usage: ANTHROPIC_API_KEY=... node scripts/translate-all-i18n-via-claude.mjs [options]

Translates all target locales from locales/en.js using Claude.

Options:
  --force              Re-translate all strings (not just missing ones)
  --force-keys <keys>  Comma-separated keys to re-translate in all locales
                       Example: --force-keys app.foo.title,app.bar.button.label
  --batch <n>          Strings per API batch (default: 40)
  --max-tokens <n>     Max tokens per API call (default: 8192)
  --help               Show this help
`.trim();

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const force = args.includes("--force");

// Collect extra pass-through flags (e.g. --max-tokens 8192, --batch 20, --force-keys foo,bar)
const SKIP_FLAGS = new Set(["--force", "--help", "-h"]);
const passThrough = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (SKIP_FLAGS.has(a)) continue;
  if (a.startsWith("--")) {
    passThrough.push(a);
    if (args[i + 1] && !args[i + 1].startsWith("--")) passThrough.push(args[++i]);
  }
}

for (const t of LOCALES) {
  const cmdArgs = [
    TRANSLATE_SCRIPT,
    "--in", INPUT,
    "--out", `locales/${t.code}.js`,
    "--target", t.name,
    ...passThrough,
  ];

  if (force) cmdArgs.push("--update", "false");

  console.log(`\n→ Translating to ${t.name} (${t.code})${force ? " [FORCE]" : ""}`);

  const res = spawnSync("node", cmdArgs, { stdio: "inherit" });

  if (res.status !== 0) {
    console.error(`✖ Failed for ${t.code}`);
    process.exit(res.status ?? 1);
  }
}

console.log("\n✓ All translations completed.");
