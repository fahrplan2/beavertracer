#!/usr/bin/env node
//@ts-check

import { spawnSync } from "node:child_process";
import process from "node:process";

const BASE_CMD = "node";
const TRANSLATE_SCRIPT = "./scripts/translate-i18n-via-openai.mjs";
const INPUT = "locales/en.js";

/**
 * target locales to generate
 */
const TARGETS = [
  { lang: "bg", name: "Bulgarian" },
  { lang: "cs", name: "Czech" },
  { lang: "da", name: "Danish" },
  { lang: "de", name: "German" },
  { lang: "el", name: "Greek" },
  { lang: "en", name: "English" },
  { lang: "es", name: "Spanish" },
  { lang: "et", name: "Estonian" },
  { lang: "fi", name: "Finnish" },
  { lang: "fr", name: "French" },
  { lang: "ga", name: "Irish" },
  { lang: "hr", name: "Croatian" },
  { lang: "hu", name: "Hungarian" },
  { lang: "it", name: "Italian" },
  { lang: "lt", name: "Lithuanian" },
  { lang: "lv", name: "Latvian" },
  { lang: "mt", name: "Maltese" },
  { lang: "nl", name: "Dutch" },
  { lang: "pl", name: "Polish" },
  { lang: "pt", name: "Portuguese" },
  { lang: "ro", name: "Romanian" },
  { lang: "sk", name: "Slovak" },
  { lang: "sl", name: "Slovene" },
  { lang: "sv", name: "Swedish" },
];

/**
 * CLI flags
 */
const args = process.argv.slice(2);
const force = args.includes("--force");

for (const t of TARGETS) {
  const cmdArgs = [
    TRANSLATE_SCRIPT,
    "--in", INPUT,
    "--out", `locales/${t.lang}.js`,
    "--target", t.name,
  ];

  if (force) {
    cmdArgs.push("--update", "false");
  }

  console.log(
    `\n→ Translating to ${t.name} (${t.lang})${force ? " [FORCE]" : ""}`
  );

  const res = spawnSync(BASE_CMD, cmdArgs, {
    stdio: "inherit",
  });

  if (res.status !== 0) {
    console.error(`✖ Failed for ${t.lang}`);
    process.exit(res.status ?? 1);
  }
}

console.log("\n✓ All translations completed.");
