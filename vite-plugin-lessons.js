// vite-plugin-lessons.js
// Processes lessons/{lang}/*.md → public/lessons/{lang}/*.html
// Auto-generates index pages for root and each language.

import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import markdownItContainer from "markdown-it-container";

const SRC_DIR = "lessons";
const OUT_DIR = "public/lessons";

/**
 * Read display name and lessons.noLessons message from all locale files.
 * Returns a map of locale code → { name, noLessons }.
 * @param {string} localesDir
 * @returns {Record<string, { name: string, noLessons: string | null }>}
 */
function loadLocaleInfo(localesDir) {
  /** @type {Record<string, { name: string, noLessons: string | null }>} */
  const info = {};
  if (!fs.existsSync(localesDir)) return info;

  for (const file of fs.readdirSync(localesDir)) {
    if (!file.endsWith(".js")) continue;
    const code = file.slice(0, -3);
    try {
      const src = fs.readFileSync(path.join(localesDir, file), "utf8");

      const nameMat = src.match(/meta\s*=\s*\{[^}]*name\s*:\s*"([^"]+)"/);
      const rawName = nameMat ? nameMat[1] : code;
      const name = rawName.replace(/\s*\(translated by AI\)\s*/i, "").trim();

      const msgMat = src.match(/"lessons\.noLessons"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const noLessons = msgMat
        ? msgMat[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        : null;

      info[code] = { name, noLessons };
    } catch {
      info[code] = { name: code.toUpperCase(), noLessons: null };
    }
  }
  return info;
}

/**
 * @typedef {{ num: number[]|null, file: string, href: string, title: string, children: LessonNode[] }} LessonNode
 */

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

/**
 * Parse numeric prefix from filename, e.g. "01.2.1-foo.md" → [1, 2, 1].
 * Returns null if no numeric prefix.
 * @param {string} filename
 * @returns {number[]|null}
 */
function parseNum(filename) {
  const m = filename.match(/^([\d]+(?:\.[\d]+)*)-/);
  if (!m) return null;
  return m[1].split(".").map(Number);
}

/**
 * Compare two num arrays for sorting.
 * @param {number[]|null} a
 * @param {number[]|null} b
 * @returns {number}
 */
function compareNums(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Returns true if childNum is a direct child of parentNum.
 * Direct child: childNum.length === parentNum.length + 1 and all parent entries match.
 * @param {number[]|null} parentNum
 * @param {number[]|null} childNum
 * @returns {boolean}
 */
function isDirectChild(parentNum, childNum) {
  if (!parentNum || !childNum) return false;
  if (childNum.length !== parentNum.length + 1) return false;
  for (let i = 0; i < parentNum.length; i++) {
    if (childNum[i] !== parentNum[i]) return false;
  }
  return true;
}

/**
 * Build a tree from a flat sorted list of LessonNodes.
 * @param {{ num: number[]|null, file: string, href: string, title: string }[]} flat
 * @returns {LessonNode[]}
 */
function buildTree(flat) {
  // Sort by numeric prefix
  const sorted = [...flat].sort((a, b) => compareNums(a.num, b.num));

  /** @type {LessonNode[]} */
  const roots = [];

  /** @type {LessonNode[]} */
  const allNodes = sorted.map((item) => ({ ...item, children: [] }));

  for (const node of allNodes) {
    if (!node.num) {
      // No number → top-level, no children
      roots.push(node);
      continue;
    }
    // Find direct parent: a node whose num is a direct parent prefix
    let placed = false;
    // Walk allNodes in reverse to find closest parent
    for (let i = allNodes.length - 1; i >= 0; i--) {
      const candidate = allNodes[i];
      if (candidate === node) continue;
      if (isDirectChild(candidate.num, node.num)) {
        candidate.children.push(node);
        placed = true;
        break;
      }
    }
    if (!placed) {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Depth-First Pre-Order traversal, returns flat array of all nodes.
 * @param {LessonNode[]} tree
 * @returns {LessonNode[]}
 */
function flatOrder(tree) {
  /** @type {LessonNode[]} */
  const result = [];
  function visit(/** @type {LessonNode[]} */ nodes) {
    for (const node of nodes) {
      result.push(node);
      if (node.children.length) visit(node.children);
    }
  }
  visit(tree);
  return result;
}

/**
 * Format a num array as a chapter label prefix, e.g. [1] → "1.", [1,2] → "1.2".
 * @param {number[]|null} num
 * @returns {string}
 */
function numLabel(num) {
  if (!num || num.length === 0) return "";
  const s = num.join(".");
  return num.length === 1 ? s + "." : s;
}

/**
 * Returns true if the node or any descendant has the given href.
 * @param {LessonNode} node
 * @param {string} href
 * @returns {boolean}
 */
function isActiveSubtree(node, href) {
  if (node.href === href) return true;
  return node.children.some((c) => isActiveSubtree(c, href));
}

/**
 * Render sidebar HTML for a tree.
 * Top-level nodes with children get a <details>/<summary> toggle.
 * All entries get an automatic number prefix from their num array.
 * @param {LessonNode[]} tree
 * @param {string} currentHref — href of current page (empty string = none active)
 * @returns {string}
 */
function renderSidebar(tree, currentHref) {
  function renderItems(/** @type {LessonNode[]} */ nodes, /** @type {boolean} */ isRoot) {
    const items = nodes.map((node) => {
      const isActive = node.href === currentHref;
      const activeClass = isActive ? ' class="active"' : "";
      const prefix = node.num ? numLabel(node.num) + " " : "";
      const label = `${prefix}${node.title}`;

      if (node.children.length) {
        const open = isActiveSubtree(node, currentHref) ? " open" : "";
        return (
          `<li><details${open}>\n` +
          `<summary><a href="${node.href}"${activeClass}>${label}</a></summary>\n` +
          renderItems(node.children, false) +
          `</details></li>`
        );
      }

      return `<li><a href="${node.href}"${activeClass}>${label}</a></li>`;
    }).join("\n");

    const classAttr = isRoot ? ' class="lesson-sidebar-tree"' : ' class="lesson-sidebar-subtree"';
    return `<ul${classAttr}>\n${items}\n</ul>`;
  }
  return renderItems(tree, true);
}

/**
 * Render the "Unterseiten" section for a node that has children.
 * @param {LessonNode} node
 * @returns {string}
 */
function renderChildrenSection(node) {
  if (!node.children.length) return "";
  const items = node.children
    .map((child) => `<li><a href="${child.href}">${child.title}</a></li>`)
    .join("\n");
  return `\n<section class="lesson-children">\n<h2>Unterseiten</h2>\n<ul class="lesson-index-list">\n${items}\n</ul>\n</section>`;
}

/**
 * Render a single .md file to HTML using the lesson template.
 * @param {string} srcFile
 * @param {string} templateHtml
 * @param {LessonNode} node
 * @param {{ prev?: {href:string,title:string}, next?: {href:string,title:string} }} nav
 * @param {string} sidebar
 */
function renderLesson(srcFile, templateHtml, node, nav = {}, sidebar = "") {
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
    return [
      `<div class="lesson-sim">`,
      `<iframe src="${embedHref}" class="lesson-sim-frame" style="height:${height}" loading="lazy" allowfullscreen></iframe>`,
      `</div>`,
    ].join("\n");
  });

  // ── Pre-process :fa-icon: shortcuts ───────────────────────────
  // :fa-house:   → fa-solid   :far-house:  → fa-regular   :fab-github: → fa-brands
  src = src.replace(/:fab-([a-z0-9-]+):/g, '<i class="fa-brands fa-$1"></i>');
  src = src.replace(/:far-([a-z0-9-]+):/g, '<i class="fa-regular fa-$1"></i>');
  src = src.replace(/:fa-([a-z0-9-]+):/g, '<i class="fa-solid fa-$1"></i>');

  // ── Set up markdown-it with heading ID collection ──────────────
  /** @type {{level:number, text:string, id:string}[]} */
  const headings = [];
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

  for (const type of ["note", "tip", "warning", "danger"]) {
    md.use(markdownItContainer, type, {
      render(tokens, idx) {
        return tokens[idx].nesting === 1
          ? `<div class="callout callout-${type}">\n`
          : `</div>\n`;
      },
    });
  }

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

  // ── Number prefix in H1 ───────────────────────────────────────
  if (node.num) {
    const prefix = numLabel(node.num);
    // Inject <span class="lesson-num"> after the opening <h1 ...> tag
    body = body.replace(/(<h1[^>]*>)/, `$1<span class="lesson-num">${prefix}</span> `);
  }

  // ── Children section ───────────────────────────────────────────
  body += renderChildrenSection(node);

  // ── Prev / Next navigation ─────────────────────────────────────
  const navParts = [];
  if (nav.prev) navParts.push(`<a href="${nav.prev.href}" class="lesson-nav-prev">← ${nav.prev.title}</a>`);
  if (nav.next) navParts.push(`<a href="${nav.next.href}" class="lesson-nav-next">${nav.next.title} →</a>`);
  if (navParts.length) {
    body += `\n<nav class="lesson-nav" aria-label="Seitennavigation">${navParts.join("")}</nav>`;
  }

  const rawTitle = headings.find((h) => h.level === 1)?.text ?? path.basename(srcFile, ".md");
  const title = node.num ? `${numLabel(node.num)} ${rawTitle}` : rawTitle;

  return templateHtml
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{body\}\}/g, body)
    .replace(/\{\{sidebar\}\}/g, sidebar);
}

/**
 * Generate index.html for one language folder.
 * @param {string} lang
 * @param {LessonNode[]} tree
 * @param {string} templateHtml
 * @param {string} sidebar
 */
/**
 * Generate a redirect index.html for a language folder → first lesson.
 * @param {string} firstHref
 */
function generateLangRedirect(firstHref) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=./${firstHref}"><script>location.replace("./${firstHref}")<\/script></head><body></body></html>`;
}

/**
 * Generate a stub index.html for a language without lessons yet.
 * Reuses rootTemplateHtml but fixes relative paths for the lang/ subdirectory.
 * @param {string} lang
 * @param {string} rootTemplateHtml
 * @param {{ name: string, noLessons: string | null }} info
 * @param {string} fallbackMsg
 */
function generateLangStub(lang, rootTemplateHtml, info, fallbackMsg) {
  const langName = info.name;
  const msg = info.noLessons ?? fallbackMsg;
  const body = `<h1>${langName} – Lektionen</h1>\n<p>${msg}</p>\n<p><a href="../">← Zurück</a></p>`;
  return rootTemplateHtml
    .replace(/\{\{body\}\}/g, body)
    .replace(/href="\.\/(_style\.css)"/g, 'href="../$1"')
    .replace(/href="\.\.\/"/g, 'href="../../"')
    .replace(/src="\.\.\/beaver\.svg"/g, 'src="../../beaver.svg"');
}

/**
 * Generate root lessons/index.html with language picker.
 * @param {string[]} langs
 * @param {string} rootTemplateHtml
 */
/**
 * @param {string[]} langs
 * @param {string} rootTemplateHtml
 * @param {Record<string, { name: string, noLessons: string | null }>} localeInfo
 */
function generateRootIndex(langs, rootTemplateHtml, localeInfo) {
  const items = langs
    .map((l) => {
      const name = localeInfo[l]?.name ?? l.toUpperCase();
      return `<li><a href="${l}/">${name}</a></li>`;
    })
    .join("\n");

  const body = `<h1>Lektionen</h1>\n<p>Wähle eine Sprache:</p>\n<ul class="lesson-index-list">\n  ${items}\n</ul>`;
  return rootTemplateHtml.replace(/\{\{body\}\}/g, body);
}

/**
 * Copy Font Awesome CSS + webfonts into outDir/fa/ so lesson pages can use them.
 * @param {string} outDir
 */
function copyFontAwesome(outDir) {
  const faSrc = path.resolve("node_modules/@fortawesome/fontawesome-free");
  const faDest = path.join(outDir, "fa");
  if (!fs.existsSync(faSrc)) return;
  // Preserve the original css/ + webfonts/ structure so relative url() paths work
  fs.mkdirSync(path.join(faDest, "css"), { recursive: true });
  fs.mkdirSync(path.join(faDest, "webfonts"), { recursive: true });
  fs.copyFileSync(path.join(faSrc, "css", "all.min.css"), path.join(faDest, "css", "all.min.css"));
  for (const f of fs.readdirSync(path.join(faSrc, "webfonts"))) {
    fs.copyFileSync(path.join(faSrc, "webfonts", f), path.join(faDest, "webfonts", f));
  }
}

/** @param {string} root */
function buildLessons(root) {
  const srcDir = path.join(root, SRC_DIR);
  const outDir = path.join(root, OUT_DIR);

  if (!fs.existsSync(srcDir)) return;

  copyFontAwesome(outDir);

  const templatePath = path.join(srcDir, "_template.html");
  const rootTemplatePath = path.join(srcDir, "_template.root.html");
  const cssPath = path.join(srcDir, "_style.css");

  if (!fs.existsSync(templatePath)) {
    console.warn("[lessons] _template.html not found, skipping.");
    return;
  }
  if (!fs.existsSync(rootTemplatePath)) {
    console.warn("[lessons] _template.root.html not found, skipping.");
    return;
  }

  const templateHtml = fs.readFileSync(templatePath, "utf8");
  const rootTemplateHtml = fs.readFileSync(rootTemplatePath, "utf8");
  const localeInfo = loadLocaleInfo(path.join(root, "locales"));
  const fallbackMsg = localeInfo["en"]?.noLessons ?? "No lessons available yet. 😔";
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

    // Collect flat lesson info
    /** @type {{ num: number[]|null, file: string, href: string, title: string }[]} */
    const flatLessons = mdFiles.map((file) => {
      const src = fs.readFileSync(path.join(langDir, file), "utf8");
      const href = file.replace(/\.md$/, ".html");
      return {
        num: parseNum(file),
        file,
        href,
        title: extractTitle(src) ?? file.replace(/\.md$/, ""),
      };
    });

    // Build tree and flat ordered list
    const tree = buildTree(flatLessons);
    const ordered = flatOrder(tree);

    // Remove stale HTML files that no longer have a source .md
    const expectedHtml = new Set(ordered.map((n) => n.href));
    expectedHtml.add("index.html");
    for (const existing of fs.readdirSync(langOut)) {
      if (existing.endsWith(".html") && !expectedHtml.has(existing)) {
        fs.rmSync(path.join(langOut, existing));
        console.log(`[lessons] ✗ removed stale ${lang}/${existing}`);
      }
    }

    // Render each lesson
    for (let i = 0; i < ordered.length; i++) {
      const node = ordered[i];
      const nav = {
        prev: i > 0 ? { href: ordered[i - 1].href, title: ordered[i - 1].title } : undefined,
        next: i < ordered.length - 1 ? { href: ordered[i + 1].href, title: ordered[i + 1].title } : undefined,
      };
      const sidebar = renderSidebar(tree, node.href);
      const outFile = path.join(langOut, node.href);
      try {
        fs.writeFileSync(
          outFile,
          renderLesson(path.join(langDir, node.file), templateHtml, node, nav, sidebar),
          "utf8"
        );
        console.log(`[lessons] ✓ ${lang}/${node.file}`);
      } catch (/** @type {*} */ e) {
        console.error(`[lessons] ✗ ${lang}/${node.file}: ${e.message}`);
      }
    }

    // Language index → redirect to first lesson
    if (ordered.length > 0) {
      fs.writeFileSync(
        path.join(langOut, "index.html"),
        generateLangRedirect(ordered[0].href),
        "utf8"
      );
      console.log(`[lessons] ✓ ${lang}/index.html → ${ordered[0].href}`);
    }
    builtLangs.push(lang);
  }

  // Stub pages for all known languages without lessons
  for (const [lang, info] of Object.entries(localeInfo)) {
    if (builtLangs.includes(lang)) continue;
    const langOut = path.join(outDir, lang);
    fs.mkdirSync(langOut, { recursive: true });
    fs.writeFileSync(path.join(langOut, "index.html"), generateLangStub(lang, rootTemplateHtml, info, fallbackMsg), "utf8");
    console.log(`[lessons] ✓ ${lang}/index.html (stub)`);
  }

  // Root index
  fs.writeFileSync(path.join(outDir, "index.html"), generateRootIndex(builtLangs, rootTemplateHtml, localeInfo), "utf8");
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
          // No matching file → 404
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found</title><style>body{font-family:sans-serif;padding:2rem;color:#ccc;background:#1a1a1a}a{color:#5b9bd5}</style></head><body><h1>404 – Not Found</h1><p>No lessons found for this path.</p><p><a href="/lessons/">← Lessons</a></p></body></html>`);
          return;
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
