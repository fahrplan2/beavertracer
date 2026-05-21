#!/usr/bin/env node
/**
 * One-off script: translate about/help HTML pages for missing locales.
 * Usage: ANTHROPIC_API_KEY=... node scripts/translate-pages-via-claude.mjs
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { LOCALES } from "./locales.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Usage: ANTHROPIC_API_KEY=... node scripts/translate-pages-via-claude.mjs

Translates about/help HTML pages into all configured locales.
Skips locale files that already exist (add manually to force re-run).

Options:
  --help  Show this help
  `.trim());
  process.exit(0);
}

const ROOT = path.resolve(import.meta.dirname, "..");


// For "about", only translate the part before this marker — Credits/License stay English.
const ABOUT_STOP_MARKER = "<h3>Credits</h3>";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Strip markdown code fences the model sometimes adds despite instructions. */
function stripFences(text) {
  return text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

async function translateHtml(html, targetLanguage) {
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content:
          `Translate the following HTML fragment to ${targetLanguage}.\n\n` +
          `Rules:\n` +
          `- Preserve ALL HTML tags, attributes, and structure exactly as-is\n` +
          `- Only translate visible text content\n` +
          `- Do NOT translate proper nouns: BeaverTracer, Wireshark, Wiregasm, Font Awesome, Hack, Claude, Anthropic\n` +
          `- Keep {VERSION} placeholder unchanged\n` +
          `- Return ONLY the raw HTML — no explanation, no markdown code fences, no \`\`\`html\n\n` +
          `HTML:\n${html}`,
      },
      // Prefill assistant turn to force raw HTML output
      { role: "assistant", content: "<" },
    ],
  });
  const raw = "<" + (msg.content[0]?.text ?? "");
  return stripFences(raw).trim();
}

for (const page of ["about", "help"]) {
  const srcPath = path.join(ROOT, "pages", page, "index.html");
  const src = fs.readFileSync(srcPath, "utf8");

  // For "about": split at Credits heading so it stays in English
  const stopIdx = page === "about" ? src.indexOf(ABOUT_STOP_MARKER) : -1;
  const translatePart = stopIdx > -1 ? src.slice(0, stopIdx).trimEnd() : src;
  const keepPart      = stopIdx > -1 ? "\n\n" + src.slice(stopIdx) : "";

  for (const locale of LOCALES) {
    const outPath = path.join(ROOT, "pages", page, `index.${locale.code}.html`);
    if (fs.existsSync(outPath)) {
      console.log(`  skip  ${page}/index.${locale.code}.html (exists)`);
      continue;
    }

    process.stdout.write(`  …     ${page} → ${locale.name} `);
    try {
      let translated = await translateHtml(translatePart, locale.name);
      if (locale.rtl) {
        translated = `<div dir="rtl">\n${translated}\n</div>`;
      }
      fs.writeFileSync(outPath, translated + keepPart + "\n", "utf8");
      console.log(`✓`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
}

console.log("\nDone.");
