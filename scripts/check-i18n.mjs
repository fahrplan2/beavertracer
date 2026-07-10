#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "@babel/parser";

const HELP_TEXT = `
Usage: node scripts/check-i18n.mjs [options]

Scans source files for t("key") calls and checks them against the source locale.
Reports missing keys (used in code but not in locale), keys that are only referenced
indirectly (spelled out as a string literal but not passed straight into t(), e.g. via
an array/object consumed generically), and truly unused keys (no reference found at all).

Options:
  --src <dir>      Directory to scan for source files (default: ./)
  --locale <file>  Source locale file to check against (default: ./locales/en.js)
  --ext <csv>      File extensions to scan (default: js,jsx,ts,tsx)
  --help           Show this help
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

const SRC_DIR = path.resolve(getArg("--src", "./"));
const LOCALE_FILE = path.resolve(getArg("--locale", "./locales/en.js"));
const EXTENSIONS = new Set(
  getArg("--ext", "js,jsx,ts,tsx")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

/** Directories we skip while scanning */
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".git",
  ".next",
  ".nuxt",
  "coverage",
]);

function isObject(v) {
  return v !== null && typeof v === "object";
}

/**
 * Generic AST walker (dependency-free)
 */
const KEY_BEARING_TYPES = new Set(["ObjectProperty", "ObjectMethod", "ClassProperty", "ClassMethod"]);

function walk(node, visit) {
  if (!isObject(node)) return;
  visit(node);

  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }

  for (const key of Object.keys(node)) {
    // Skip the `key` field of a non-computed property/method definition. A
    // quoted property name like `"a.b": "..."` (as in the locale dictionaries
    // themselves) *defines* key "a.b" — it is not a reference/usage of it, and
    // must not be picked up by the indirect-string-literal scan below.
    if (key === "key" && !node.computed && KEY_BEARING_TYPES.has(node.type)) continue;

    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) walk(item, visit);
    } else if (isObject(val) && typeof val.type === "string") {
      walk(val, visit);
    }
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function parseFileToAst(code, filePath) {
  // Enable TS + JSX parsing safely across mixed codebases
  return parse(code, {
    sourceType: "module",
    sourceFilename: filePath,
    plugins: [
      "jsx",
      "typescript",
      "classProperties",
      "classPrivateProperties",
      "classPrivateMethods",
      "decorators-legacy",
      "dynamicImport",
      "importMeta",
      "topLevelAwait",
    ],
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  });
}

/**
 * Extract keys from: export default { "a.b": "…", ... }
 */
function extractLocaleKeys(localeFile) {
  const code = readText(localeFile);
  const ast = parseFileToAst(code, localeFile);

  const keys = new Set();

  walk(ast, (node) => {
    if (node.type === "ExportDefaultDeclaration") {
      const decl = node.declaration;
      if (decl?.type === "ObjectExpression") {
        for (const prop of decl.properties) {
          // Only handle plain properties: "x": "...", 'x': '...'
          if (prop.type !== "ObjectProperty") continue;
          if (prop.computed) continue;

          const k = prop.key;
          if (k.type === "StringLiteral") {
            keys.add(k.value);
          } else if (k.type === "Identifier") {
            // Uncommon in i18n dictionaries, but support it anyway
            keys.add(k.name);
          }
        }
      }
    }
  });

  return keys;
}

/**
 * Extract key references from a source file:
 *  - `direct`: static string/template literal passed straight into a t(...) call
 *  - `indirect`: any string literal elsewhere in the file that happens to spell
 *    out a known dict key. Covers indirection the direct scan can't trace, e.g.
 *    keys collected into an array/object and passed to t() via a variable:
 *      for (const key of ["a.b", "a.c"]) { ...t(key)... }
 *      { descKey: "app.foo.desc" }   // consumed generically as t(entry.descKey)
 * @param {string} code
 * @param {string} filePath
 * @param {Set<string>} dictKeys
 */
function extractKeyReferencesFromSource(code, filePath, dictKeys) {
  const ast = parseFileToAst(code, filePath);
  const direct = new Set();
  const indirect = new Set();

  walk(ast, (node) => {
    if (node.type === "CallExpression") {
      // Match callee: t(...)
      const callee = node.callee;
      const isT =
        (callee?.type === "Identifier" && callee.name === "t") ||
        // Optional: support this.t("key")
        (callee?.type === "MemberExpression" &&
          !callee.computed &&
          callee.property?.type === "Identifier" &&
          callee.property.name === "t");

      if (isT) {
        const arg0 = node.arguments?.[0];
        if (arg0) {
          if (arg0.type === "StringLiteral") {
            direct.add(arg0.value);
          } else if (arg0.type === "TemplateLiteral" && arg0.expressions.length === 0) {
            // Template literal with no expressions: t(`menu.start`)
            const cooked = arg0.quasis?.[0]?.value?.cooked;
            if (typeof cooked === "string") direct.add(cooked);
          }
          // Dynamic keys like t(`menu.${x}`) or t(someVar) are intentionally not resolved here.
        }
      }
    }

    if (node.type === "StringLiteral" && dictKeys.has(node.value)) {
      indirect.add(node.value);
    }
  });

  return { direct, indirect };
}

function listFilesRecursive(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
      out.push(...listFilesRecursive(path.join(dir, ent.name)));
      continue;
    }
    if (!ent.isFile()) continue;

    const ext = path.extname(ent.name).slice(1).toLowerCase();
    if (!EXTENSIONS.has(ext)) continue;

    const fp = path.join(dir, ent.name);
    out.push(fp);
  }

  return out;
}

function main() {
  if (!fs.existsSync(LOCALE_FILE)) {
    console.error(`Locale file not found: ${LOCALE_FILE}`);
    process.exit(2);
  }
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Source dir not found: ${SRC_DIR}`);
    process.exit(2);
  }

  const dictKeys = extractLocaleKeys(LOCALE_FILE);

  const files = listFilesRecursive(SRC_DIR);
  const directKeys = new Set();
  const indirectKeys = new Set();

  const parseErrors = [];

  for (const filePath of files) {
    let code;
    try {
      code = readText(filePath);
    } catch (e) {
      parseErrors.push({ filePath, error: String(e) });
      continue;
    }

    try {
      const { direct, indirect } = extractKeyReferencesFromSource(code, filePath, dictKeys);
      for (const k of direct) directKeys.add(k);
      for (const k of indirect) indirectKeys.add(k);
    } catch (e) {
      // With errorRecovery this should be rare, but still track it
      parseErrors.push({ filePath, error: String(e) });
    }
  }

  const missing = [...directKeys].filter((k) => !dictKeys.has(k)).sort();
  const indirectOnly = [...indirectKeys].filter((k) => !directKeys.has(k)).sort();
  const unused = [...dictKeys].filter((k) => !directKeys.has(k) && !indirectKeys.has(k)).sort();

  console.log(`\nLocale: ${LOCALE_FILE}`);
  console.log(`Source: ${SRC_DIR}`);
  console.log(`Files scanned: ${files.length}`);
  console.log(`Used keys (direct t() calls): ${directKeys.size}`);
  console.log(`Dict keys: ${dictKeys.size}`);

  if (parseErrors.length) {
    console.log(`\n⚠️  Files with read/parse issues: ${parseErrors.length}`);
    for (const e of parseErrors.slice(0, 20)) {
      console.log(`- ${e.filePath}: ${e.error}`);
    }
    if (parseErrors.length > 20) console.log(`  ...and more`);
  }

  console.log(`\n=== Missing keys (used in code, not in en.js): ${missing.length} ===`);
  if (missing.length) {
    for (const k of missing) console.log(k);
  } else {
    console.log("(none)");
  }

  console.log(
    `\n=== Indirectly referenced keys (spelled out as a string literal, but not a direct t() call — e.g. via an array/object consumed generically): ${indirectOnly.length} ===`
  );
  if (indirectOnly.length) {
    for (const k of indirectOnly) console.log(k);
  } else {
    console.log("(none)");
  }

  console.log(`\n=== Unused keys (in en.js, no reference found anywhere in source): ${unused.length} ===`);
  if (unused.length) {
    for (const k of unused) console.log(k);
  } else {
    console.log("(none)");
  }

  // Non-zero exit if missing keys exist (useful for CI)
  process.exit(missing.length ? 1 : 0);
}

main();