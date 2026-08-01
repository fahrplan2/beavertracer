#!/usr/bin/env node
/**
 * translate-lessons-via-claude.mjs
 * Translates lesson markdown files from lessons/<source>/*.md into lessons/<target>/*.md
 * using the Anthropic Claude API.
 *
 * Filenames are kept identical across locales (cross-lesson links reference
 * bare filenames like `01-einfuehrung.html`), so only the file content is translated.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node scripts/translate-lessons-via-claude.mjs
 *   ANTHROPIC_API_KEY=... node scripts/translate-lessons-via-claude.mjs --source de --target en --target-name English
 *   ANTHROPIC_API_KEY=... node scripts/translate-lessons-via-claude.mjs --force
 *
 * Options:
 *   --source <code>      Source locale directory under lessons/ (default: de)
 *   --target <code>      Target locale directory under lessons/ (default: en)
 *   --target-name <name> Target language name for the prompt (default: English)
 *   --exclude <nums>     Comma-separated leading lesson numbers to skip (default: 98,99)
 *   --model <id>         Claude model ID (default: claude-sonnet-5)
 *   --force              Re-translate files even if the target already exists
 *   --help               Show this help
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const HELP_TEXT = `
Usage: ANTHROPIC_API_KEY=... node scripts/translate-lessons-via-claude.mjs [options]

Translates lesson markdown files from lessons/<source>/*.md into lessons/<target>/*.md.
Filenames are preserved so cross-lesson links keep working.

Options:
  --source <code>      Source locale directory under lessons/ (default: de)
  --target <code>      Target locale directory under lessons/ (default: en)
  --target-name <name> Target language name for the prompt (default: English)
  --exclude <nums>     Comma-separated leading lesson numbers to skip (default: 98,99)
  --model <id>         Claude model ID (default: claude-sonnet-5)
  --force              Re-translate files even if the target already exists
  --help                Show this help
`.trim();

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

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = args.source || "de";
const TARGET = args.target || "en";
const TARGET_NAME = args["target-name"] || "English";
const MODEL = args.model || "claude-sonnet-5";
const FORCE = Boolean(args.force);
const EXCLUDE = new Set(
  String(args.exclude ?? "98,99")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY environment variable.");
  process.exit(1);
}

const client = new Anthropic({ apiKey });

const srcDir = path.join(ROOT, "lessons", SOURCE);
const outDir = path.join(ROOT, "lessons", TARGET);

if (!fs.existsSync(srcDir)) {
  console.error(`Source lesson directory not found: ${srcDir}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

/** Matches "01.2.3-ping.md" -> ["01.2.3-ping.md", "01.2.3", "ping"]. */
const NUM_RE = /^(\d+(?:\.\d+)*)-(.+)\.md$/;

/** Strip markdown code fences the model sometimes adds despite instructions. */
function stripFences(text) {
  return text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

function slugify(s) {
  const noDiacritics = s
    .toLowerCase()
    .normalize("NFKD")
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x0300 || code > 0x036f; // drop combining diacritical marks
    })
    .join("");
  return (
    noDiacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "lesson"
  );
}

/** numPart -> filename, for non-empty translated lesson files already in outDir. */
function scanExistingByNum(dir) {
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(NUM_RE);
    if (!m) continue;
    if (fs.readFileSync(path.join(dir, f), "utf8").trim().length === 0) continue;
    map.set(m[1], f);
  }
  return map;
}

const SYSTEM_PROMPT = `
You are a professional translator localizing lesson content for BeaverTracer, an interactive
browser-based network simulator used as a secondary-school teaching tool.

You will receive one lesson file written in a custom Markdown dialect. Translate it to ${TARGET_NAME}.

Rules — CONTENT:
- Translate all prose, headings, list items, table cell text, and callout text naturally and accurately.
- Keep TCP/IP and networking terminology accurate and consistent with how it is normally taught in ${TARGET_NAME}.
- Use informal/neutral address forms appropriate for a student audience (this is a learning tool, not a legal document).
- Use sentence case for headings (capitalize only the first word and proper nouns) — do not use English title case conventions if that would look wrong in ${TARGET_NAME}.
- Do NOT translate proper nouns/product names: BeaverTracer, Wireshark, Wiregasm, Font Awesome.

Rules — SYNTAX (preserve exactly, do not translate or alter):
- Markdown structure: headings (#), lists, tables, emphasis (**bold**, *italic*, ~~strike~~), horizontal rules (---).
- The line "[[toc]]" — leave verbatim.
- Container directives like ":::note", ":::tip", ":::warning", ":::danger", ":::goal", ":::task", ":::draft",
  ":::sim", ":::osi", ":::quiz", ":::evaluate" and their closing ":::" — the directive keyword and any
  modifier on the same line (e.g. ":::osi 3", ":::quiz mc", ":::quiz short", ":::quiz fill", ":::quiz match")
  must stay exactly as written, only translate free-text content INSIDE the block.
- Icon tokens like ":fa-gear:", ":fa-play:", ":far-file:", ":router:", ":switch:" — leave verbatim.
- Inline code (\`like this\`) and fenced code blocks (\`\`\`...\`\`\`) — leave verbatim, including any German
  words inside them, UNLESS the code block is clearly natural-language prose mixed with a command; when in
  doubt, leave code spans and code blocks unchanged since they represent literal commands/output/config.
- Links to other lessons, e.g. "[text](01-einfuehrung.html)" — translate the link TEXT but keep the
  filename/URL inside the parentheses unchanged (filenames are identical across all locales).
- Raw HTML tags and attributes (e.g. "<table class=\\"osi-table\\">", "<tr class=\\"osi-l3\\">") — keep tags
  and attributes unchanged, translate only visible text inside them.
- Inside ":::task" blocks: the "title:" line is translatable free text, but "check:" lines contain literal
  function-call syntax (e.g. "check: ip(9, \\"192.168.0.0/24\\")", "check: pingOk(9, 11)") and must be left
  completely unchanged.
- Inside ":::sim" blocks: lines like "url=/sims/demo.btsim" are literal and must be left unchanged.
- Inside ":::quiz mc" blocks: checkbox markers "- [ ]" and "- [x]" must stay exactly as written; translate
  only the answer text after the marker.
- Inside ":::quiz fill" blocks: curly-brace blanks like "{Subnetzmaske}" contain the expected answer word —
  translate the word itself into ${TARGET_NAME} but keep the curly braces.
- Inside ":::quiz match" blocks: pairs are written as "Left -> Right" — translate both sides, keep the "->" arrow.
- Inside ":::quiz short" blocks: lines starting with "=" give accepted answers — translate them if they are
  words, but leave alone if they are numbers/technical values that don't change between languages.
- Do not add, remove, or reorder lines, and do not add a trailing/leading code fence around your output.

Rules — FILENAME SLUG:
- Lesson filenames encode a chapter number followed by a short descriptive slug, e.g.
  "01.2.2-ip-adressen.md". The app only reads the leading number to determine order — the slug
  after the dash is just for human readability, so it should be translated too.
- After the translated Markdown content, on a new final line, output exactly one line of the form:
  <!-- lesson-slug: short-kebab-case-slug -->
  where short-kebab-case-slug is a concise (1-4 words) ASCII kebab-case slug in ${TARGET_NAME}
  (transliterated to plain a-z0-9- if ${TARGET_NAME} doesn't use the Latin alphabet) summarizing
  this lesson's topic, in the same terse style as the original filename slug (e.g. "ip-addresses",
  "spanning-tree", "first-steps"). This marker line is metadata, not part of the lesson content.

Return the translated Markdown file content followed by the lesson-slug marker line described
above — no explanation, no markdown code fences.
`.trim();

/** Concatenate all text blocks — content[0] may be a thinking block, not text. */
function extractText(msg) {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Pull the trailing `<!-- lesson-slug: xxx -->` marker off the translated content. */
function extractSlugMarker(text) {
  const m = text.match(/\n?<!--\s*lesson-slug:\s*([a-z0-9-]+)\s*-->\s*$/i);
  if (!m) return { content: text.trim(), slug: null };
  return { content: text.slice(0, m.index).trim(), slug: m[1].toLowerCase() };
}

async function translateFile(markdown, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: markdown }],
    });
    if (msg.stop_reason === "max_tokens") {
      lastErr = new Error("Response truncated (max_tokens reached)");
    } else {
      const raw = extractText(msg);
      const stripped = stripFences(raw).trim();
      if (stripped.length > 0) {
        const { content, slug } = extractSlugMarker(stripped);
        const h1 = content.match(/^#\s+(.+)$/m)?.[1] ?? "lesson";
        return { content, slug: slug || slugify(h1) };
      }
      lastErr = new Error(`Empty response (stop_reason=${msg.stop_reason})`);
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw lastErr;
}

async function main() {
  const files = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (FORCE) {
    for (const f of fs.readdirSync(outDir)) {
      if (f.endsWith(".md")) fs.unlinkSync(path.join(outDir, f));
    }
  }

  // numPart -> current filename in outDir; seeds link-rewriting and resume-skip logic.
  const mapping = scanExistingByNum(outDir);

  let translated = 0;
  let skipped = 0;
  let failed = 0;

  for (const filename of files) {
    const m = filename.match(NUM_RE);
    if (!m) {
      console.log(`  skip  ${filename} (no numeric prefix)`);
      continue;
    }
    const [, numPart] = m;
    const topLevel = numPart.split(".")[0];
    if (EXCLUDE.has(topLevel)) {
      console.log(`  skip  ${filename} (excluded)`);
      continue;
    }

    if (!FORCE && mapping.has(numPart)) {
      console.log(`  skip  ${filename} (exists as ${mapping.get(numPart)})`);
      skipped++;
      continue;
    }

    const srcPath = path.join(srcDir, filename);
    const src = fs.readFileSync(srcPath, "utf8");

    process.stdout.write(`  …     ${filename} `);
    try {
      const { content, slug } = await translateFile(src);
      const newFilename = `${numPart}-${slug}.md`;

      // Remove any stale file for this lesson number (old slug, or an empty stub
      // left behind by a previous failed run) before writing the new one.
      for (const existing of fs.readdirSync(outDir)) {
        const em = existing.match(NUM_RE);
        if (em && em[1] === numPart) fs.unlinkSync(path.join(outDir, existing));
      }

      fs.writeFileSync(path.join(outDir, newFilename), content + "\n", "utf8");
      mapping.set(numPart, newFilename);
      console.log(`✓  -> ${newFilename}`);
      translated++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      failed++;
    }
  }

  // Rewrite cross-lesson links (e.g. "01.2.2-ip-adressen.html") to point at
  // whatever this locale's lesson ended up being named.
  let relinked = 0;
  for (const f of fs.readdirSync(outDir)) {
    if (!f.endsWith(".md")) continue;
    const p = path.join(outDir, f);
    const content = fs.readFileSync(p, "utf8");
    const updated = content.replace(
      /\]\((\d+(?:\.\d+)*)-[\w.-]+\.html(#[^)]*)?\)/g,
      (full, num, anchor) => {
        const target = mapping.get(num);
        if (!target) return full;
        return `](${target.replace(/\.md$/, ".html")}${anchor || ""})`;
      }
    );
    if (updated !== content) {
      fs.writeFileSync(p, updated, "utf8");
      relinked++;
    }
  }

  console.log(
    `\nDone. Translated ${translated}, skipped ${skipped}, failed ${failed}, relinked ${relinked} file(s).`
  );
  if (failed > 0) process.exit(1);
}

main();
