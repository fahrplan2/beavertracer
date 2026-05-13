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

const TRANSLATE_SCRIPT = "./scripts/translate-i18n-via-claude.mjs";
const INPUT = "locales/en.js";

const TARGETS = [
  { lang: "de", name: "German" },
  { lang: "es", name: "Spanish" },
  { lang: "fr", name: "French" },
  { lang: "it", name: "Italian" },
  { lang: "id", name: "Indonesian" },
  { lang: "bg", name: "Bulgarian" },
  { lang: "bs", name: "Bosnian" },
  { lang: "cs", name: "Czech" },
  { lang: "da", name: "Danish" },
  { lang: "et", name: "Estonian" },
  { lang: "fi", name: "Finnish" },
  { lang: "lv", name: "Latvian" },
  { lang: "lt", name: "Lithuanian" },
  { lang: "sl", name: "Slovenian" },
  { lang: "el", name: "Greek" },
  { lang: "hr", name: "Croatian" },
  { lang: "fa", name: "Persian (Farsi)" },
  { lang: "pt-PT", name: "European Portuguese (Portugal)" },
  { lang: "ro", name: "Romanian" },
  { lang: "ru", name: "Russian" },
  { lang: "nl", name: "Dutch" },
  { lang: "pl", name: "Polish" },
  { lang: "tr", name: "Turkish" },
  { lang: "vi", name: "Vietnamese" },
  { lang: "sv", name: "Swedish" },
  { lang: "ja", name: "Japanese" },
  { lang: "ko", name: "Korean" },
  { lang: "zh", name: "Simplified Chinese" },
  { lang: "ar", name: "Arabic" },
  { lang: "ua", name: "Ukrainian" },
];

const args = process.argv.slice(2);
const force = args.includes("--force");

// Collect extra pass-through flags (e.g. --max-tokens 8192, --batch 20)
const passThrough = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--force") continue;
  if (a.startsWith("--")) {
    passThrough.push(a);
    if (args[i + 1] && !args[i + 1].startsWith("--")) passThrough.push(args[++i]);
  }
}

for (const t of TARGETS) {
  const cmdArgs = [
    TRANSLATE_SCRIPT,
    "--in", INPUT,
    "--out", `locales/${t.lang}.js`,
    "--target", t.name,
    ...passThrough,
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
