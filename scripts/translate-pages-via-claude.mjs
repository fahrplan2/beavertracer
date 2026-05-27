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

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Strip markdown code fences the model sometimes adds despite instructions. */
function stripFences(text) {
  return text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

async function translateChunk(html, targetLanguage) {
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content:
          `Translate the following HTML fragment to ${targetLanguage}.\n\n` +
          `Rules:\n` +
          `- Preserve ALL HTML tags, attributes, and structure exactly as-is\n` +
          `- Only translate visible text content\n` +
          `- Do NOT translate proper nouns: BeaverTracer, Wireshark, Wiregasm, Font Awesome, Hack, Claude, Anthropic\n` +
          `- Keep HTML comments (<!-- ... -->) exactly as-is — do not translate or remove them\n` +
          `- Keep {VERSION} placeholder unchanged\n` +
          `- Use informal address forms (e.g. "du" in German, "tu" in French) — this is a secondary school learning tool\n` +
          `- Use sentence case for headings (only capitalise the first word and proper nouns) — do NOT copy English title case\n` +
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

async function translateHtml(html, targetLanguage) {
  // Split at <hr> boundaries so each section stays well within token limits
  // regardless of how large the page grows in the future.
  const HR_RE = /\n{1,2}<hr>\n{1,2}/g;
  const sections = html.split(HR_RE);
  if (sections.length === 1) {
    return translateChunk(html, targetLanguage);
  }
  const translated = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed) translated.push(await translateChunk(trimmed, targetLanguage));
  }
  return translated.join("\n\n<hr>\n\n");
}

for (const page of ["about", "help", "downloads"]) {
  const srcPath = path.join(ROOT, "pages", page, "index.html");
  const src = fs.readFileSync(srcPath, "utf8");

  for (const locale of LOCALES) {
    const outPath = path.join(ROOT, "pages", page, `index.${locale.code}.html`);
    if (fs.existsSync(outPath)) {
      console.log(`  skip  ${page}/index.${locale.code}.html (exists)`);
      continue;
    }

    process.stdout.write(`  …     ${page} → ${locale.name} `);
    try {
      let translated = await translateHtml(src, locale.name);
      if (locale.rtl) {
        translated = `<div dir="rtl">\n${translated}\n</div>`;
      }
      fs.writeFileSync(outPath, translated + "\n", "utf8");
      console.log(`✓`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
}

console.log("\nDone.");
