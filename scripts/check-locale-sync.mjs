#!/usr/bin/env node
/**
 * check-locale-sync.mjs
 * Compares all locale files against en.js (source of truth).
 * Reports missing keys (in en but not in locale) and extra keys (in locale but not in en).
 *
 * Usage:
 *   node scripts/check-locale-sync.mjs
 *   node scripts/check-locale-sync.mjs --locales ./locales --source en.js
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "@babel/parser";

const HELP_TEXT = `
Usage: node scripts/check-locale-sync.mjs [options]

Compares all locale files against en.js (source of truth).
Reports missing keys and removes obsolete keys from target locales.

Options:
  --locales <dir>   Directory containing locale files (default: ./locales)
  --source <file>   Source locale filename (default: en.js)
  --help            Show this help
`.trim();

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP_TEXT);
  process.exit(0);
}

function getArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const LOCALES_DIR = path.resolve(getArg("--locales", "./locales"));
const SOURCE_LOCALE = getArg("--source", "en.js");

const PROTECTED_KEYS = new Set(["lang.name"]);

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function isObject(v) {
  return v !== null && typeof v === "object";
}

function walk(node, visit) {
  if (!isObject(node)) return;
  visit(node);
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) for (const item of val) walk(item, visit);
    else if (isObject(val) && typeof val.type === "string") walk(val, visit);
  }
}

function extractKeys(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript", "decorators-legacy"],
    errorRecovery: true,
  });

  const keys = new Set();
  walk(ast, (node) => {
    if (node.type === "ExportDefaultDeclaration") {
      const decl = node.declaration;
      if (decl?.type === "ObjectExpression") {
        for (const prop of decl.properties) {
          if (prop.type !== "ObjectProperty" || prop.computed) continue;
          const k = prop.key;
          if (k.type === "StringLiteral") keys.add(k.value);
          else if (k.type === "Identifier") keys.add(k.name);
        }
      }
    }
  });

  return keys;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeKeysFromFile(filePath, keysToRemove) {
  if (keysToRemove.length === 0) return [];
  let code = fs.readFileSync(filePath, "utf8");
  const removed = [];
  for (const key of keysToRemove) {
    const re = new RegExp(
      `^[ \\t]*["']${escapeRegex(key)}["'][ \\t]*:.*,?[ \\t]*(\\r?\\n)?`,
      "m"
    );
    const next = code.replace(re, "");
    if (next !== code) {
      code = next;
      removed.push(key);
    }
  }
  if (removed.length > 0) fs.writeFileSync(filePath, code, "utf8");
  return removed;
}

function main() {
  const sourceFile = path.join(LOCALES_DIR, SOURCE_LOCALE);
  if (!fs.existsSync(sourceFile)) {
    console.error(`Source locale not found: ${sourceFile}`);
    process.exit(2);
  }

  const sourceKeys = extractKeys(sourceFile);
  console.log(
    `${c.bold}Locale sync check${c.reset} — source: ${SOURCE_LOCALE} (${sourceKeys.size} keys)\n`
  );

  const localeFiles = fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".js") && f !== SOURCE_LOCALE)
    .sort();

  let totalMissing = 0;
  let totalExtra = 0;

  for (const file of localeFiles) {
    const filePath = path.join(LOCALES_DIR, file);
    let localeKeys;
    try {
      localeKeys = extractKeys(filePath);
    } catch (e) {
      console.log(`${c.red}✖ ${file}${c.reset}: parse error — ${e.message}\n`);
      continue;
    }

    const missing = [...sourceKeys].filter((k) => !localeKeys.has(k)).sort();
    const extra = [...localeKeys].filter((k) => !sourceKeys.has(k)).sort();

    totalMissing += missing.length;
    totalExtra += extra.length;

    const deletable = extra.filter((k) => !PROTECTED_KEYS.has(k));
    const protected_ = extra.filter((k) => PROTECTED_KEYS.has(k));
    const removed = removeKeysFromFile(filePath, deletable);

    if (missing.length === 0 && extra.length === 0) {
      console.log(
        `${c.green}✓${c.reset} ${c.bold}${file}${c.reset} — ${localeKeys.size} keys, in sync`
      );
    } else {
      console.log(
        `${c.yellow}⚠${c.reset} ${c.bold}${file}${c.reset} — ${localeKeys.size} keys`
      );
      if (missing.length > 0) {
        console.log(`  ${c.red}Missing (${missing.length}):${c.reset}`);
        for (const k of missing) console.log(`    ${c.gray}${k}${c.reset}`);
      }
      if (removed.length > 0) {
        console.log(`  ${c.cyan}Deleted obsolete (${removed.length}):${c.reset}`);
        for (const k of removed) console.log(`    ${c.gray}${k}${c.reset}`);
      }
      if (protected_.length > 0) {
        console.log(`  ${c.cyan}Kept protected (${protected_.length}):${c.reset}`);
        for (const k of protected_) console.log(`    ${c.gray}${k}${c.reset}`);
      }
    }
    console.log();
  }

  const status =
    totalMissing === 0 && totalExtra === 0
      ? `${c.green}All locales in sync.${c.reset}`
      : `${c.yellow}${totalMissing} missing${c.reset}, ${c.cyan}${totalExtra} extra${c.reset} keys across ${localeFiles.length} locales`;

  console.log(`${c.bold}Summary:${c.reset} ${status}`);
  process.exit(totalMissing > 0 ? 1 : 0);
}

main();
