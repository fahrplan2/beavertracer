#!/usr/bin/env node
/**
 * translate-all-i18n-via-claude.mjs
 * Runs translate-i18n-via-claude.mjs for all target locales.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node scripts/translate-all-i18n-via-claude.mjs
 *   ANTHROPIC_API_KEY=... node scripts/translate-all-i18n-via-claude.mjs --force
 *
 * --force  Re-translate all strings (not just missing ones)
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

const TRANSLATE_SCRIPT = "./scripts/translate-i18n-via-claude.mjs";
const INPUT = "locales/en.js";

const TARGETS = [
  { lang: "de", name: "German" },
  { lang: "es", name: "Spanish" },
  { lang: "fr", name: "French" },
  { lang: "it", name: "Italian" },
  { lang: "pt", name: "Portuguese" },
];

const args = process.argv.slice(2);
const force = args.includes("--force");

for (const t of TARGETS) {
  const cmdArgs = [
    TRANSLATE_SCRIPT,
    "--in", INPUT,
    "--out", `locales/${t.lang}.js`,
    "--target", t.name,
  ];

  if (force) cmdArgs.push("--update", "false");

  console.log(`\n→ Translating to ${t.name} (${t.lang})${force ? " [FORCE]" : ""}`);

  const res = spawnSync("node", cmdArgs, { stdio: "inherit" });

  if (res.status !== 0) {
    console.error(`✖ Failed for ${t.lang}`);
    process.exit(res.status ?? 1);
  }
}

console.log("\n✓ All translations completed.");
