#!/usr/bin/env node
/**
 * Translate "export default { ... }" i18n files:
 * - preserves comments/formatting via AST (recast)
 * - translates only string literal values
 * - supports --target and optional --source
 * - shows a simple progress bar while translating
 * - UPDATE MODE: if destination exists, only translate NEW keys and append them
 *
 * Usage:
 *   OPENAI_API_KEY=... node translate-i18n.mjs --in en.js --out de.js --target German
 *
 * Optional:
 *   --source English
 *   --model gpt-4.1-mini
 *   --batch 60
 *   --update true|false   (default: true)
 */

import fs from "node:fs/promises";
import recast from "recast";
import * as babelParser from "@babel/parser";

const { builders: b } = recast.types;

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

function buildKeyFromSourceProp(sourceProp) {
  // Recreate a safe key node (no cycles).
  // Supports:
  //   foo: "x"                 (Identifier)
  //   "foo.bar": "x"           (StringLiteral)
  //   ["foo"]: "x"             (computed StringLiteral)
  // Anything else -> fall back to string literal key (best effort)
  const k = sourceProp.key;

  if (!sourceProp.computed) {
    if (k?.type === "Identifier") return { keyNode: b.identifier(k.name), computed: false };
    if (k?.type === "StringLiteral") return { keyNode: b.stringLiteral(k.value), computed: false };
    if (k?.type === "NumericLiteral") return { keyNode: b.numericLiteral(k.value), computed: false };
  } else {
    // computed key: only safely preserve ["..."] style when it's a string literal
    if (k?.type === "StringLiteral") return { keyNode: b.stringLiteral(k.value), computed: true };
  }

  // Fallback: use a string key name derived from getPropKeyName
  const name = getPropKeyName(sourceProp) ?? "UNKNOWN_KEY";
  return { keyNode: b.stringLiteral(name), computed: false };
}

function makeObjectPropertyFromSourceKey(sourceProp, stringValue) {
  const { keyNode, computed } = buildKeyFromSourceProp(sourceProp);
  const newProp = b.objectProperty(keyNode, b.stringLiteral(stringValue));
  newProp.computed = computed;
  newProp.shorthand = false;
  return newProp;
}

function asBool(v, fallback = false) {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(s)) return true;
    if (["0", "false", "no", "n", "off"].includes(s)) return false;
  }
  return fallback;
}

function babelParse(code) {
  return recast.parse(code, {
    parser: {
      parse(source) {
        return babelParser.parse(source, {
          sourceType: "module",
          plugins: [
            "jsx",
            "typescript",
            "classProperties",
            "decorators-legacy",
            "dynamicImport",
            "optionalChaining",
            "nullishCoalescingOperator",
          ],
          allowReturnOutsideFunction: true,
          tokens: true,
        });
      },
    },
  });
}

function getPropKeyName(prop) {
  // Supports: "foo.bar": "x",  foo: "x",  ["foo"]: "x" (only literal)
  if (prop.computed) {
    if (prop.key?.type === "StringLiteral") return prop.key.value;
    return null;
  }
  if (prop.key?.type === "Identifier") return prop.key.name;
  if (prop.key?.type === "StringLiteral") return prop.key.value;
  return null;
}

function isPlainStringLiteral(node) {
  return node && node.type === "StringLiteral";
}

function findExportDefaultObjectExpression(ast) {
  const { visit } = recast.types;
  let found = null;

  visit(ast, {
    visitExportDefaultDeclaration(path) {
      const decl = path.node.declaration;
      if (decl && decl.type === "ObjectExpression") {
        found = decl;
      }
      return false; // first export default only
    },
  });

  return found;
}

function indexDirectStringProps(objExpr) {
  // returns Map key -> { prop, nodeRef }
  const map = new Map();
  if (!objExpr || objExpr.type !== "ObjectExpression") return map;

  for (const prop of objExpr.properties) {
    if (prop.type !== "ObjectProperty") continue;
    const k = getPropKeyName(prop);
    if (!k) continue;
    if (isPlainStringLiteral(prop.value)) {
      map.set(k, { prop, nodeRef: prop.value });
    }
  }
  return map;
}

async function translateBatch({ apiKey, model, sourceLang, targetLang, pairs }) {
  // pairs: [{key, value}]
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are a professional software localization translator. " +
          "Translate UI strings naturally and consistently " +
          "You are translating a simulation software for networks." +
          "Keep TCP/IP-terms consistent." +
          "KEEP placeholders unchanged exactly (e.g. {name}, {{name}}, %s, %d, :id). " +
          "Keep intentional spaces in the strings original. " +
          "Do not translate keys. " +
          "Return ONLY valid JSON object mapping keys to translated strings. " +
          "Do not add explanations." +
          "Special rule: For the key \"lang.name\", return ONLY the native language name (no parentheses). "
      },
      {
        role: "user",
        content: JSON.stringify({
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
          strings: Object.fromEntries(pairs.map((p) => [p.key, p.value])),
        }),
      },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty model response");
  return JSON.parse(content);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}


function applyLangNameRule(translations, targetLang) {
  const v = translations["lang.name"];
  if (typeof v !== "string" || v.trim().length === 0) return;

  // avoid double-appending if model didn't follow instructions
  const base = v.replace(/\s*\([^)]*\)\s*$/, "").trim();

  translations["lang.name"] = `${base} (${targetLang})`;
}

/** --- Progress bar helpers --- */
function renderProgress({ doneBatches, totalBatches, doneStrings, totalStrings }) {
  const width = 30;
  const ratio = totalBatches === 0 ? 1 : doneBatches / totalBatches;
  const filled = Math.round(ratio * width);
  const bar = "#".repeat(filled) + "-".repeat(width - filled);
  const pct = Math.round(ratio * 100);

  const line =
    `Translating [${bar}] ${pct}% ` +
    `(${doneBatches}/${totalBatches} batches, ${doneStrings}/${totalStrings} strings)`;

  process.stdout.write("\r" + line);
}

function finishProgressLine() {
  process.stdout.write("\n");
}
/** --- end progress bar helpers --- */

async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Update mode:
 * - if dest exists, parse it and only translate keys missing from dest
 * - append missing keys into dest export default object (as string literals)
 * - keep existing translations unchanged
 */
async function updateExistingLocale({
  apiKey,
  model,
  sourceLang,
  targetLang,
  inCode,
  outFile,
  batchSize,
}) {
  const sourceAst = babelParse(inCode);
  const sourceObj = findExportDefaultObjectExpression(sourceAst);
  if (!sourceObj) {
    throw new Error("Could not find `export default { ... }` in input file.");
  }

  const destExists = await fileExists(outFile);
  let destAst = null;
  let destObj = null;
  let destCode = null;

  // Treat empty file as non-existent
  if (destExists) {
    destCode = await fs.readFile(outFile, "utf8");
    if (destCode.trim().length === 0) {
      destCode = null;
    }
  }

  if (destCode) {
    // Normal update path: parse existing destination
    destAst = babelParse(destCode);
    destObj = findExportDefaultObjectExpression(destAst);
    if (!destObj) {
      throw new Error(`Could not find \`export default { ... }\` in destination file: ${outFile}`);
    }
  } else {
    // Fresh create path: start with an empty export default object
    const skeleton = "export default {\n};\n";
    destAst = babelParse(skeleton);
    destObj = findExportDefaultObjectExpression(destAst);
    if (!destObj) throw new Error("Internal error: failed to build destination AST skeleton.");
  }

  const sourceIndex = indexDirectStringProps(sourceObj);
  const destIndex = indexDirectStringProps(destObj);

  // Determine which keys are new (missing in dest) and need translation
  const missing = [];
  for (const [key, { prop: sourceProp, nodeRef: sourceValueNode }] of sourceIndex.entries()) {
    if (!destIndex.has(key)) {
      missing.push({
        key,
        value: sourceValueNode.value,
        sourceProp, // used to preserve key style when appending
      });
    }
  }

  if (missing.length === 0) {
    console.log(destExists ? "No new strings. Destination is up to date." : "No strings found.");
    // If dest didn't exist, still write the (unchanged) baseline
    if (!destExists) {
      const out = recast.print(destAst).code;
      await fs.writeFile(outFile, out, "utf8");
      console.log(`Wrote ${outFile}`);
    }
    return;
  }

  // Translate only the missing keys
  const chunksArr = chunk(missing, batchSize);
  const totalBatches = chunksArr.length;
  const totalStrings = missing.length;
  let doneBatches = 0;
  let doneStrings = 0;

  renderProgress({ doneBatches, totalBatches, doneStrings, totalStrings });

  const translations = {};
  for (const c of chunksArr) {
    const t = await translateBatch({
      apiKey,
      model,
      sourceLang,
      targetLang,
      pairs: c.map(({ key, value }) => ({ key, value })),
    });

    Object.assign(translations, t);

    doneBatches += 1;
    doneStrings += c.length;
    renderProgress({ doneBatches, totalBatches, doneStrings, totalStrings });
  }

  finishProgressLine();

  applyLangNameRule(translations, targetLang);

  // Append missing properties to destination object, in source order
  for (const item of missing) {
    const translated = translations[item.key];
    if (typeof translated !== "string" || translated.length === 0) continue;

    const newProp = makeObjectPropertyFromSourceKey(item.sourceProp, translated);
    destObj.properties.push(newProp);
  }

  const output = recast.print(destAst).code;
  await fs.writeFile(outFile, output, "utf8");

  console.log(
    destExists
      ? `Updated ${outFile}: added ${missing.length} new strings`
      : `Created ${outFile}: translated ${missing.length} strings`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const inFile = args.in || args.input;
  const outFile = args.out || args.output;
  const targetLang = args.target;
  const sourceLang = args.source || "English";

  if (!inFile || !outFile || !targetLang) {
    console.error(
      "Missing args.\n" +
        "Example:\n" +
        "  OPENAI_API_KEY=... node translate-i18n.mjs --in en.js --out de.js --target German\n" +
        "Optional:\n" +
        "  --source English\n" +
        "  --model gpt-4.1-mini\n" +
        "  --batch 60\n" +
        "  --update true|false (default true)"
    );
    process.exit(1);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY env var.");
    process.exit(1);
  }

  const model = args.model || "gpt-4.1-mini";
  const batchSize = Number(args.batch || 60);
  const updateMode = asBool(args.update, true);

  const inCode = await fs.readFile(inFile, "utf8");

  if (updateMode) {
    await updateExistingLocale({
      apiKey,
      model,
      sourceLang,
      targetLang,
      inCode,
      outFile,
      batchSize,
    });
    return;
  }

  // --- Non-update (original behavior): translate all direct string props in source and write to outFile ---
  const ast = babelParse(inCode);
  const objExpr = findExportDefaultObjectExpression(ast);
  if (!objExpr) throw new Error("Could not find `export default { ... }` in input file.");

  const toTranslate = []; // { key, value, nodeRef }
  for (const prop of objExpr.properties) {
    if (prop.type !== "ObjectProperty") continue;
    const k = getPropKeyName(prop);
    if (!k) continue;
    if (isPlainStringLiteral(prop.value)) {
      toTranslate.push({ key: k, value: prop.value.value, nodeRef: prop.value });
    }
  }

  if (toTranslate.length === 0) {
    console.log("No string literal values found to translate.");
    await fs.writeFile(outFile, inCode, "utf8");
    return;
  }

  const chunksArr = chunk(toTranslate, batchSize);
  const translations = {};

  const totalBatches = chunksArr.length;
  const totalStrings = toTranslate.length;
  let doneBatches = 0;
  let doneStrings = 0;

  renderProgress({ doneBatches, totalBatches, doneStrings, totalStrings });

  for (const c of chunksArr) {
    const t = await translateBatch({
      apiKey,
      model,
      sourceLang,
      targetLang,
      pairs: c.map(({ key, value }) => ({ key, value })),
    });

    Object.assign(translations, t);

    doneBatches += 1;
    doneStrings += c.length;
    renderProgress({ doneBatches, totalBatches, doneStrings, totalStrings });
  }

  finishProgressLine();

  applyLangNameRule(translations, targetLang);

  for (const item of toTranslate) {
    const translated = translations[item.key];
    if (typeof translated === "string" && translated.length > 0) {
      item.nodeRef.value = translated;
    }
  }

  const output = recast.print(ast).code;
  await fs.writeFile(outFile, output, "utf8");
  console.log(`Translated ${toTranslate.length} strings -> ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
