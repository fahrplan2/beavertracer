// vite-plugin-lessons.js
// Processes lessons/{lang}/*.md → public/lessons/{lang}/*.html
// Auto-generates index pages for root and each language.

import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";

const SRC_DIR = "lessons";
const OUT_DIR = "public/lessons";

const LANG_NAMES = {
  de: "Deutsch", en: "English", fr: "Français",
  es: "Español", it: "Italiano", pt: "Português",
};

/** @param {string} text */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[<>]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/** Extract first H1 title from markdown source. */
function extractTitle(src) {
  const m = src.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/** The theme-init script (prevents flash of wrong theme). */
const THEME_SCRIPT = `<script>
(function(){
  var s = localStorage.getItem('bt-lesson-theme');
  var sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = s || sys;
})();
</script>`;

/** The theme-toggle button markup. */
const THEME_TOGGLE_BTN = `<button class="theme-toggle" id="themeToggle" aria-label="Hell/Dunkel" title="Hell/Dunkel wechseln"><span class="theme-icon"></span></button>`;

/** The theme-toggle JS (inlined at bottom of body). */
const THEME_TOGGLE_JS = `<script>
(function(){
  var btn = document.getElementById('themeToggle');
  var icon = btn.querySelector('.theme-icon');
  function upd() { icon.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'; }
  upd();
  btn.addEventListener('click', function() {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('bt-lesson-theme', next);
    upd();
  });
})();
</script>`;

/**
 * Inject theme script into <head> and toggle button into header.
 * @param {string} html
 */
function injectTheme(html) {
  return html
    .replace("</head>", THEME_SCRIPT + "\n</head>")
    .replace('class="lesson-header-logo"', 'class="lesson-header-logo"')
    .replace("</header>", THEME_TOGGLE_BTN + "\n  </header>")
    .replace("</body>", THEME_TOGGLE_JS + "\n</body>");
}

/**
 * Render a single .md file to HTML using the lesson template.
 * @param {string} srcFile
 * @param {string} templateHtml
 * @param {{ prev?: {href:string,title:string}, next?: {href:string,title:string} }} nav
 */
function renderLesson(srcFile, templateHtml, nav = {}) {
  let src = fs.readFileSync(srcFile, "utf8");

  // ── Pre-process :::sim blocks ──────────────────────────────────
  // Syntax:
  //   :::sim
  //   url=https://example.com/sim.btsim
  //   height=520px
  //   :::
  src = src.replace(/:::sim\s*\n([\s\S]*?):::/gm, (_, content) => {
    /** @type {Record<string, string>} */
    const params = {};
    for (const line of content.trim().split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) params[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    const simUrl = params.url ?? "";
    const height = params.height ?? "520px";
    const base = "../../";
    const embedHref = simUrl
      ? `${base}?embed=1&sim=${encodeURIComponent(simUrl)}`
      : `${base}?embed=1`;
    const fullHref = simUrl ? `${base}?sim=${encodeURIComponent(simUrl)}` : base;
    return [
      `<div class="lesson-sim">`,
      `<iframe src="${embedHref}" class="lesson-sim-frame" style="height:${height}" loading="lazy" allowfullscreen></iframe>`,
      `<a href="${fullHref}" target="_blank" class="lesson-sim-open">Im BeaverTracer öffnen ↗</a>`,
      `</div>`,
    ].join("\n");
  });

  // ── Set up markdown-it with heading ID collection ──────────────
  /** @type {{level:number, text:string, id:string}[]} */
  const headings = [];
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

  md.renderer.rules.heading_open = (tokens, idx) => {
    const tag = tokens[idx].tag;
    const text = tokens[idx + 1].children?.map((t) => t.content).join("") ?? "";
    const id = slugify(text);
    headings.push({ level: parseInt(tag[1]), text, id });
    return `<${tag} id="${id}">`;
  };

  let body = md.render(src);

  // ── TOC ────────────────────────────────────────────────────────
  const tocHeadings = headings.filter((h) => h.level <= 3);
  if (tocHeadings.length > 0) {
    const minLevel = Math.min(...tocHeadings.map((h) => h.level));
    const items = tocHeadings
      .map((h) => `${"  ".repeat(h.level - minLevel)}<li><a href="#${h.id}">${h.text}</a></li>`)
      .join("\n");
    const tocHtml = `<nav class="lesson-toc" aria-label="Inhaltsverzeichnis">\n<ul>\n${items}\n</ul>\n</nav>`;
    body = body.replace(/\[\[toc\]\]/gi, tocHtml);
    body = body.replace(/<p>(\s*<nav class="lesson-toc"[\s\S]*?<\/nav>\s*)<\/p>/g, "$1");
  } else {
    body = body.replace(/\[\[toc\]\]/gi, "");
  }

  // ── Prev / Next navigation ─────────────────────────────────────
  const navParts = [];
  if (nav.prev) navParts.push(`<a href="${nav.prev.href}" class="lesson-nav-prev">← ${nav.prev.title}</a>`);
  if (nav.next) navParts.push(`<a href="${nav.next.href}" class="lesson-nav-next">${nav.next.title} →</a>`);
  if (navParts.length) {
    body += `\n<nav class="lesson-nav" aria-label="Seitennavigation">${navParts.join("")}</nav>`;
  }

  const title = headings.find((h) => h.level === 1)?.text ?? path.basename(srcFile, ".md");

  return injectTheme(
    templateHtml
      .replace(/\{\{title\}\}/g, title)
      .replace(/\{\{body\}\}/g, body)
      .replace(/\{\{back_href\}\}/g, "./index.html")
      .replace(/\{\{back_label\}\}/g, "Alle Lektionen")
  );
}

/**
 * Generate index.html for one language folder.
 * @param {string} lang
 * @param {{ file: string, title: string }[]} lessons
 * @param {string} templateHtml
 */
function generateLangIndex(lang, lessons, templateHtml) {
  const langName = LANG_NAMES[lang] ?? lang.toUpperCase();
  const items = lessons
    .map((l) => `<li><a href="${l.file.replace(/\.md$/, ".html")}">${l.title}</a></li>`)
    .join("\n");
  const body = `<h1>${langName} – Lektionen</h1>\n<ul class="lesson-index-list">\n${items}\n</ul>`;
  return templateHtml
    .replace(/\{\{title\}\}/g, `${langName} – Lektionen`)
    .replace(/\{\{body\}\}/g, body)
    .replace(/\{\{back_href\}\}/g, "../")
    .replace(/\{\{back_label\}\}/g, "Sprache wählen");
}

/**
 * Generate root lessons/index.html with language picker.
 * @param {string[]} langs
 */
function generateRootIndex(langs) {
  const items = langs
    .map((l) => {
      const name = LANG_NAMES[l] ?? l.toUpperCase();
      return `<li><a href="${l}/">${name}</a></li>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="de" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BeaverTracer – Lektionen</title>
  <link rel="stylesheet" href="./_style.css">
  ${THEME_SCRIPT}
</head>
<body>
  <header class="lesson-header">
    <a href="../" class="lesson-header-logo" target="_blank">
      <img src="../beaver.svg" alt="BeaverTracer" width="28" height="28">
      BeaverTracer
    </a>
    ${THEME_TOGGLE_BTN}
  </header>
  <main class="lesson-main">
    <article class="lesson-article">
      <h1>Lektionen</h1>
      <p>Wähle eine Sprache:</p>
      <ul class="lesson-index-list">
        ${items}
      </ul>
    </article>
  </main>
  <footer class="lesson-footer">BeaverTracer – Netzwerksimulation für den Unterricht</footer>
  ${THEME_TOGGLE_JS}
</body>
</html>`;
}

/** @param {string} root */
function buildLessons(root) {
  const srcDir = path.join(root, SRC_DIR);
  const outDir = path.join(root, OUT_DIR);

  if (!fs.existsSync(srcDir)) return;

  const templatePath = path.join(srcDir, "_template.html");
  const cssPath = path.join(srcDir, "_style.css");

  if (!fs.existsSync(templatePath)) {
    console.warn("[lessons] _template.html not found, skipping.");
    return;
  }

  const templateHtml = fs.readFileSync(templatePath, "utf8");
  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(cssPath)) fs.copyFileSync(cssPath, path.join(outDir, "_style.css"));

  const builtLangs = [];

  for (const lang of fs.readdirSync(srcDir).sort()) {
    if (lang.startsWith("_")) continue;
    const langDir = path.join(srcDir, lang);
    if (!fs.statSync(langDir).isDirectory()) continue;

    const langOut = path.join(outDir, lang);
    fs.mkdirSync(langOut, { recursive: true });

    const mdFiles = fs.readdirSync(langDir).filter((f) => f.endsWith(".md")).sort();

    // Collect titles for index + prev/next
    /** @type {{ file: string, title: string }[]} */
    const lessons = mdFiles.map((file) => {
      const src = fs.readFileSync(path.join(langDir, file), "utf8");
      return { file, title: extractTitle(src) ?? file.replace(/\.md$/, "") };
    });

    // Render each lesson
    for (let i = 0; i < mdFiles.length; i++) {
      const file = mdFiles[i];
      const toHref = (/** @type {string} */ f) => f.replace(/\.md$/, ".html");
      const nav = {
        prev: i > 0 ? { href: toHref(lessons[i - 1].file), title: lessons[i - 1].title } : undefined,
        next: i < lessons.length - 1 ? { href: toHref(lessons[i + 1].file), title: lessons[i + 1].title } : undefined,
      };
      const outFile = path.join(langOut, toHref(file));
      try {
        fs.writeFileSync(outFile, renderLesson(path.join(langDir, file), templateHtml, nav), "utf8");
        console.log(`[lessons] ✓ ${lang}/${file}`);
      } catch (/** @type {*} */ e) {
        console.error(`[lessons] ✗ ${lang}/${file}: ${e.message}`);
      }
    }

    // Language index
    fs.writeFileSync(
      path.join(langOut, "index.html"),
      injectTheme(generateLangIndex(lang, lessons, templateHtml)),
      "utf8"
    );
    console.log(`[lessons] ✓ ${lang}/index.html`);
    builtLangs.push(lang);
  }

  // Root index
  fs.writeFileSync(path.join(outDir, "index.html"), generateRootIndex(builtLangs), "utf8");
  console.log(`[lessons] ✓ index.html`);
}

export function lessonsPlugin() {
  return {
    name: "vite-plugin-lessons",

    /** @param {{ root: string }} config */
    configResolved(config) {
      buildLessons(config.root);
    },

    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
      // Serve /lessons and /lessons/* as directory indexes
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";

        // Redirect /lessons → /lessons/
        if (url === "/lessons") {
          res.writeHead(301, { Location: "/lessons/" });
          res.end();
          return;
        }

        // Serve index.html for any /lessons/.../ directory request
        if (url.startsWith("/lessons/") && (url.endsWith("/") || !url.includes(".", url.lastIndexOf("/")))) {
          const candidate = path.join(process.cwd(), "public", url.endsWith("/") ? url + "index.html" : url + "/index.html");
          if (fs.existsSync(candidate)) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(fs.readFileSync(candidate));
            return;
          }
        }

        next();
      });

      const watchDir = path.resolve(process.cwd(), SRC_DIR);
      server.watcher.add(watchDir);
      server.watcher.on("all", (_, file) => {
        if (file.startsWith(watchDir)) {
          buildLessons(process.cwd());
          server.ws.send({ type: "full-reload" });
        }
      });
    },
  };
}
