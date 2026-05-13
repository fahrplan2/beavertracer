#!/usr/bin/env node
/**
 * translate-i18n-via-claude.mjs
 * Translates i18n locale files using the Anthropic Claude API.
 * Drop-in replacement for translate-i18n-via-openai.mjs.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node scripts/translate-i18n-via-claude.mjs \
 *     --in locales/en.js --out locales/de.js --target German
 *
 * Options:
 *   --source   English (default)
 *   --model    claude-haiku-4-5-20251001 (default, fast & cheap)
 *   --batch    40 (default)
 *   --update   true|false (default: true — only translate missing keys)
 */

import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import recast from "recast";
import * as babelParser from "@babel/parser";

const { builders: b } = recast.types;

const SYSTEM_PROMPT =
  "You are a professional software localization translator. " +
  "Translate UI strings naturally and consistently. " +
  "You are translating a network simulation application (routers, switches, PCs, TCP/IP protocols). " +
  "Keep TCP/IP and networking terms accurate and consistent. " +
  "KEEP placeholders unchanged exactly (e.g. {name}, {ip}, {port}, %s, %d, ${name}). " +
  "Keep intentional whitespace in strings unchanged. " +
  "Do not translate keys. " +
  "Return ONLY a valid JSON object mapping keys to translated strings. " +
  "No explanations, no markdown fences, just the raw JSON object. " +
  'For the key "lang.name", return the native language name with its flag emoji (e.g. "🇩🇪 Deutsch").';

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
          plugins: ["jsx", "typescript", "classProperties", "decorators-legacy", "dynamicImport"],
          allowReturnOutsideFunction: true,
          tokens: true,
        });
      },
    },
  });
}

function getPropKeyName(prop) {
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
      if (decl?.type === "ObjectExpression") found = decl;
      return false;
    },
  });
  return found;
}

function indexDirectStringProps(objExpr) {
  const map = new Map();
  if (!objExpr || objExpr.type !== "ObjectExpression") return map;
  for (const prop of objExpr.properties) {
    if (prop.type !== "ObjectProperty") continue;
    const k = getPropKeyName(prop);
    if (!k) continue;
    if (isPlainStringLiteral(prop.value)) map.set(k, { prop, nodeRef: prop.value });
  }
  return map;
}

function buildKeyFromSourceProp(sourceProp) {
  const k = sourceProp.key;
  if (!sourceProp.computed) {
    if (k?.type === "Identifier") return { keyNode: b.identifier(k.name), computed: false };
    if (k?.type === "StringLiteral") return { keyNode: b.stringLiteral(k.value), computed: false };
    if (k?.type === "NumericLiteral") return { keyNode: b.numericLiteral(k.value), computed: false };
  } else {
    if (k?.type === "StringLiteral") return { keyNode: b.stringLiteral(k.value), computed: true };
  }
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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in response");
  return JSON.parse(match[0]);
}

async function translateBatch({ client, model, maxTokens, sourceLang, targetLang, pairs }) {
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
          strings: Object.fromEntries(pairs.map((p) => [p.key, p.value])),
        }),
      },
    ],
  });

  const content = msg.content[0]?.text?.trim();
  if (!content) throw new Error("Empty response from Claude");
  return extractJson(content);
}

function renderProgress({ doneBatches, totalBatches, doneStrings, totalStrings }) {
  const width = 30;
  const ratio = totalBatches === 0 ? 1 : doneBatches / totalBatches;
  const filled = Math.round(ratio * width);
  const bar = "#".repeat(filled) + "-".repeat(width - filled);
  const pct = Math.round(ratio * 100);
  process.stdout.write(
    `\rTranslating [${bar}] ${pct}% (${doneBatches}/${totalBatches} batches, ${doneStrings}/${totalStrings} strings)`
  );
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function updateExistingLocale({ client, model, maxTokens, sourceLang, targetLang, inCode, outFile, batchSize }) {
  const sourceAst = babelParse(inCode);
  const sourceObj = findExportDefaultObjectExpression(sourceAst);
  if (!sourceObj) throw new Error("Could not find `export default { ... }` in input file.");

  const destExists = await fileExists(outFile);
  let destAst, destObj, destCode;

  if (destExists) {
    destCode = await fs.readFile(outFile, "utf8");
    if (destCode.trim().length === 0) destCode = null;
  }

  if (destCode) {
    destAst = babelParse(destCode);
    destObj = findExportDefaultObjectExpression(destAst);
    if (!destObj) throw new Error(`Could not find \`export default { ... }\` in destination: ${outFile}`);
  } else {
    const skeleton = "export default {\n};\n";
    destAst = babelParse(skeleton);
    destObj = findExportDefaultObjectExpression(destAst);
  }

  const sourceIndex = indexDirectStringProps(sourceObj);
  const destIndex = indexDirectStringProps(destObj);

  const missing = [];
  for (const [key, { prop: sourceProp, nodeRef: sourceValueNode }] of sourceIndex.entries()) {
    if (!destIndex.has(key)) {
      missing.push({ key, value: sourceValueNode.value, sourceProp });
    }
  }

  if (missing.length === 0) {
    console.log(destExists ? "No new strings. Destination is up to date." : "No strings found.");
    if (!destExists) {
      await fs.writeFile(outFile, recast.print(destAst).code, "utf8");
      console.log(`Wrote ${outFile}`);
    }
    return;
  }

  const chunksArr = chunk(missing, batchSize);
  let doneBatches = 0, doneStrings = 0;
  renderProgress({ doneBatches, totalBatches: chunksArr.length, doneStrings, totalStrings: missing.length });

  const translations = {};
  for (const c of chunksArr) {
    const t = await translateBatch({ client, model, maxTokens, sourceLang, targetLang, pairs: c.map(({ key, value }) => ({ key, value })) });
    Object.assign(translations, t);
    doneBatches++;
    doneStrings += c.length;
    renderProgress({ doneBatches, totalBatches: chunksArr.length, doneStrings, totalStrings: missing.length });
  }
  process.stdout.write("\n");

  for (const item of missing) {
    const translated = translations[item.key];
    if (typeof translated !== "string" || translated.length === 0) continue;
    destObj.properties.push(makeObjectPropertyFromSourceKey(item.sourceProp, translated));
  }

  await fs.writeFile(outFile, recast.print(destAst).code, "utf8");
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
      "Missing required args.\n" +
        "Usage: ANTHROPIC_API_KEY=... node translate-i18n-via-claude.mjs \\\n" +
        "         --in locales/en.js --out locales/de.js --target German\n" +
        "Options:\n" +
        "  --source      English\n" +
        "  --model       claude-haiku-4-5-20251001\n" +
        "  --batch       40\n" +
        "  --max-tokens  8192\n" +
        "  --update      true|false (default: true)"
    );
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Missing ANTHROPIC_API_KEY environment variable.");
    process.exit(1);
  }

  const model = args.model || "claude-haiku-4-5-20251001";
  const batchSize = Number(args.batch || 40);
  const maxTokens = Number(args["max-tokens"] || 8192);
  const updateMode = asBool(args.update, true);
  const client = new Anthropic({ apiKey });
  const inCode = await fs.readFile(inFile, "utf8");

  if (updateMode) {
    await updateExistingLocale({ client, model, maxTokens, sourceLang, targetLang, inCode, outFile, batchSize });
    return;
  }

  // Full re-translate mode
  const ast = babelParse(inCode);
  const objExpr = findExportDefaultObjectExpression(ast);
  if (!objExpr) throw new Error("Could not find `export default { ... }` in input file.");

  const toTranslate = [];
  for (const prop of objExpr.properties) {
    if (prop.type !== "ObjectProperty") continue;
    const k = getPropKeyName(prop);
    if (!k || !isPlainStringLiteral(prop.value)) continue;
    toTranslate.push({ key: k, value: prop.value.value, nodeRef: prop.value });
  }

  if (toTranslate.length === 0) {
    console.log("No string literal values found.");
    await fs.writeFile(outFile, inCode, "utf8");
    return;
  }

  const chunksArr = chunk(toTranslate, batchSize);
  let doneBatches = 0, doneStrings = 0;
  renderProgress({ doneBatches, totalBatches: chunksArr.length, doneStrings, totalStrings: toTranslate.length });

  const translations = {};
  for (const c of chunksArr) {
    const t = await translateBatch({ client, model, maxTokens, sourceLang, targetLang, pairs: c.map(({ key, value }) => ({ key, value })) });
    Object.assign(translations, t);
    doneBatches++;
    doneStrings += c.length;
    renderProgress({ doneBatches, totalBatches: chunksArr.length, doneStrings, totalStrings: toTranslate.length });
  }
  process.stdout.write("\n");

  for (const item of toTranslate) {
    const translated = translations[item.key];
    if (typeof translated === "string" && translated.length > 0) item.nodeRef.value = translated;
  }

  await fs.writeFile(outFile, recast.print(ast).code, "utf8");
  console.log(`Translated ${toTranslate.length} strings -> ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
