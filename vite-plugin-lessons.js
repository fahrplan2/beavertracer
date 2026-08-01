// vite-plugin-lessons.js
// Processes lessons/{lang}/*.md → public/lessons/{lang}/*.html
// Auto-generates index pages for root and each language.

import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import markdownItContainer from "markdown-it-container";

const SRC_DIR = "lessons";
const OUT_DIR = "public/lessons";

// ── Quiz pre-processing ────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeAttr(jsonStr) {
  return jsonStr.replace(/'/g, "&#39;");
}

function renderQuizShort(id, content) {
  const lines = content.split("\n");
  const questionLines = [], answers = [];
  for (const line of lines) {
    if (line.startsWith("= ")) answers.push(line.slice(2).trim().toLowerCase());
    else if (line.trim()) questionLines.push(line);
  }
  const answersAttr = safeAttr(JSON.stringify(answers));
  return [
    `<div class="quiz-block quiz-short" data-quiz-id="${id}" data-type="short" data-answers='${answersAttr}'>`,
    `<p class="quiz-question">${escHtml(questionLines.join(" ").trim())}</p>`,
    `<div class="quiz-input-row">`,
    `<input type="text" class="quiz-input" placeholder="{{quiz.placeholder}}" autocomplete="off" spellcheck="false">`,
    `<span class="quiz-feedback" aria-hidden="true"></span>`,
    `</div></div>`,
  ].join("\n");
}

function renderQuizMC(id, content) {
  const lines = content.split("\n");
  const questionLines = [], options = [];
  for (const line of lines) {
    const mC = line.match(/^-\s+\[x\]\s+(.*)/i);
    const mW = line.match(/^-\s+\[ \]\s+(.*)/);
    if (mC) options.push({ text: mC[1].trim(), correct: true });
    else if (mW) options.push({ text: mW[1].trim(), correct: false });
    else if (line.trim()) questionLines.push(line);
  }
  const optHtml = options
    .map(o => `<li><button class="quiz-option" data-correct="${o.correct}">${escHtml(o.text)}</button></li>`)
    .join("\n");
  return [
    `<div class="quiz-block quiz-mc" data-quiz-id="${id}" data-type="mc">`,
    `<p class="quiz-question">${escHtml(questionLines.join(" ").trim())}</p>`,
    `<ul class="quiz-options">${optHtml}</ul>`,
    `</div>`,
  ].join("\n");
}

function renderQuizFill(id, content) {
  const parts = content.split(/(\{[^}]+\})/g);
  let fillHtml = "";
  for (const part of parts) {
    if (part.startsWith("{") && part.endsWith("}")) {
      const variants = part.slice(1, -1).split("|").map(v => v.trim().toLowerCase());
      const answersAttr = safeAttr(JSON.stringify(variants));
      const size = Math.max(...variants.map(v => v.length), 4) + 2;
      fillHtml += `<span class="quiz-gap"><input type="text" class="quiz-gap-input" data-answers='${answersAttr}' placeholder="…" size="${size}" autocomplete="off" spellcheck="false"><span class="quiz-feedback" aria-hidden="true"></span></span>`;
    } else {
      fillHtml += escHtml(part).replace(/\n/g, " ");
    }
  }
  return [
    `<div class="quiz-block quiz-fill" data-quiz-id="${id}" data-type="fill">`,
    `<p class="quiz-fill-text">${fillHtml}</p>`,
    `</div>`,
  ].join("\n");
}

function renderQuizMatch(id, content) {
  const pairs = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^(.+?)\s*->\s*(.+)$/);
    if (m) pairs.push({ term: m[1].trim(), explanation: m[2].trim() });
  }
  const explanationsAttr = safeAttr(JSON.stringify(pairs.map(p => p.explanation)));
  const termRows = pairs
    .map((p, i) =>
      `<div class="quiz-match-row"><span class="quiz-match-term">${escHtml(p.term)}</span><div class="quiz-match-dropzone" data-correct-idx="${i}"></div></div>`
    )
    .join("\n");
  return [
    `<div class="quiz-block quiz-match" data-quiz-id="${id}" data-type="match" data-explanations='${explanationsAttr}'>`,
    `<div class="quiz-match-layout">`,
    `<div class="quiz-match-terms">${termRows}</div>`,
    `<div class="quiz-match-pool"></div>`,
    `</div></div>`,
  ].join("\n");
}

function renderEvaluateButton(ids, label) {
  return [
    `<div class="quiz-evaluate-wrap">`,
    `<button class="quiz-evaluate-btn" data-quiz-ids="${ids.join(",")}">${escHtml(label)}</button>`,
    `<span class="quiz-evaluate-summary"></span>`,
    `</div>`,
  ].join("\n");
}

function processQuizBlocks(src) {
  let counter = 0;
  const pending = [];
  return src.replace(
    /:::quiz\s+(\w+)\s*\n([\s\S]*?):::|:::evaluate\s*\n([\s\S]*?):::/gm,
    (match, subtype, quizContent, evalContent) => {
      if (subtype !== undefined) {
        const id = `q${++counter}`;
        pending.push(id);
        const content = (quizContent || "").trim();
        switch (subtype) {
          case "short": return renderQuizShort(id, content);
          case "mc":    return renderQuizMC(id, content);
          case "fill":  return renderQuizFill(id, content);
          case "match": return renderQuizMatch(id, content);
          default:      return match;
        }
      } else {
        const ids = pending.splice(0);
        const label = (evalContent || "").trim() || "{{quiz.evaluate}}";
        return renderEvaluateButton(ids, label);
      }
    }
  );
}

// ── Task/check pre-processing ───────────────────────────────────

/**
 * Parses a simple comma-separated argument list of quoted strings and
 * numbers only — no nested parens/objects. Keeps the ":::task" check
 * vocabulary purely declarative (see CheckApi.js for the runtime side).
 * @param {string} argStr
 * @returns {(string|number)[]}
 */
function parseCheckArgs(argStr) {
  const tokenRe = /"((?:[^"\\]|\\.)*)"|([^,\s][^,]*)/g;
  /** @type {(string|number)[]} */
  const args = [];
  let m;
  while ((m = tokenRe.exec(argStr))) {
    if (m[1] !== undefined) {
      args.push(m[1].replace(/\\"/g, '"'));
    } else {
      const raw = m[2].trim();
      if (!raw) continue;
      const num = Number(raw);
      args.push(raw !== "" && !Number.isNaN(num) ? num : raw);
    }
  }
  return args;
}

/**
 * @param {string} id
 * @param {string} content
 * @param {Record<string, string>} chrome
 */
function renderTaskBlock(id, content, chrome) {
  let title = "";
  const descLines = [];
  const checks = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const titleM = trimmed.match(/^title:\s*(.+)$/i);
    const checkM = trimmed.match(/^check:\s*(\w+)\((.*)\)\s*$/i);
    if (titleM) {
      title = titleM[1].trim();
    } else if (checkM) {
      checks.push({ fn: checkM[1], args: parseCheckArgs(checkM[2]) });
    } else {
      descLines.push(line);
    }
  }
  const checksAttr = safeAttr(JSON.stringify(checks));
  const descHtml = descLines.length
    ? `<p class="task-description">${escHtml(descLines.join(" ").trim())}</p>`
    : "";
  return [
    `<div class="task-block" data-task-id="${id}" data-checks='${checksAttr}'>`,
    title ? `<p class="task-title">${escHtml(title)}</p>` : "",
    descHtml,
    `<div class="task-check-wrap">`,
    `<button class="task-check-btn" data-task-id="${id}">${escHtml(chrome["lessons.task.check"])}</button>`,
    `<span class="task-check-summary"></span>`,
    `</div>`,
    `</div>`,
  ].filter(Boolean).join("\n");
}

/**
 * @param {string} src
 * @param {Record<string, string>} chrome
 */
function processTaskBlocks(src, chrome) {
  let counter = 0;
  return src.replace(/:::task\s*\n([\s\S]*?):::/gm, (_, content) => {
    const id = `task${++counter}`;
    return renderTaskBlock(id, (content || "").trim(), chrome);
  });
}

/**
 * Read display name and lessons.noLessons message from all locale files.
 * Returns a map of locale code → { name, noLessons, quiz }.
 * @param {string} localesDir
 * @returns {Record<string, { name: string, noLessons: string | null, quiz: { placeholder: string, evaluate: string, resultOne: string, resultOther: string } }>}
 */
const OSI_LAYER_KEYS = [
  "lessons.osi.l1", "lessons.osi.l2", "lessons.osi.l3", "lessons.osi.l4",
  "lessons.osi.l5", "lessons.osi.l6", "lessons.osi.l7",
];
const OSI_LAYER_FALLBACK = {
  "lessons.osi.l1": "Physical", "lessons.osi.l2": "Data Link", "lessons.osi.l3": "Network",
  "lessons.osi.l4": "Transport", "lessons.osi.l5": "Session", "lessons.osi.l6": "Presentation",
  "lessons.osi.l7": "Application",
};

/** Static template chrome strings (sidebar, theme toggle, footer, WIP banner, ...), keyed like the locale files. */
const CHROME_KEYS = {
  "lessons.toc": "Table of contents",
  "lessons.themeToggle": "Toggle light/dark mode",
  "lessons.footer": "BeaverTracer – Network simulation for the classroom",
  "lessons.wip.title": "🚧 Lessons in progress",
  "lessons.wip.text": "These pages are not yet complete. Content may be missing, incomplete, or not yet proofread.",
  "lessons.pageNav": "Page navigation",
  "lessons.simLaunch": "Load simulation",
  "lessons.task.check": "Check task",
  "lessons.task.pass": "Correct!",
  "lessons.task.fail": "Not quite — try again.",
};

function loadLocaleInfo(localesDir) {
  /** @type {Record<string, { name: string, noLessons: string | null, quiz: { placeholder: string, evaluate: string, resultOne: string, resultOther: string }, osiLabels: string[] }>} */
  const info = {};
  if (!fs.existsSync(localesDir)) return info;

  /** @param {string} src @param {string} key @returns {string | null} */
  function extractKey(src, key) {
    const escaped = key.replace(/\./g, "\\.").replace(/"/g, '\\"');
    const mat = src.match(new RegExp(`"${escaped}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    return mat ? mat[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
  }

  for (const file of fs.readdirSync(localesDir)) {
    if (!file.endsWith(".js")) continue;
    const code = file.slice(0, -3);
    try {
      const src = fs.readFileSync(path.join(localesDir, file), "utf8");

      const nameMat = src.match(/meta\s*=\s*\{[^}]*name\s*:\s*"([^"]+)"/);
      const rawName = nameMat ? nameMat[1] : code;
      const name = rawName.replace(/\s*\(translated by AI\)\s*/i, "").trim();

      const noLessons = extractKey(src, "lessons.noLessons");

      info[code] = {
        name,
        noLessons,
        quiz: {
          placeholder: extractKey(src, "lessons.quiz.placeholder") ?? "…",
          evaluate:    extractKey(src, "lessons.quiz.evaluate")    ?? "Check answers",
          resultOne:   extractKey(src, "lessons.quiz.result.one")  ?? "{correct}/{total}",
          resultOther: extractKey(src, "lessons.quiz.result.other") ?? "{correct}/{total}",
        },
        osiLabels: OSI_LAYER_KEYS.map((key) => extractKey(src, key) ?? OSI_LAYER_FALLBACK[key]),
        chrome: Object.fromEntries(
          Object.entries(CHROME_KEYS).map(([key, fallback]) => [key, extractKey(src, key) ?? fallback])
        ),
      };
    } catch {
      info[code] = {
        name: code.toUpperCase(),
        noLessons: null,
        quiz: { placeholder: "…", evaluate: "Check answers", resultOne: "{correct}/{total}", resultOther: "{correct}/{total}" },
        osiLabels: OSI_LAYER_KEYS.map((key) => OSI_LAYER_FALLBACK[key]),
        chrome: { ...CHROME_KEYS },
      };
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
  return s;
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
 * Render a single .md file to HTML using the lesson template.
 * @param {string} srcFile
 * @param {string} templateHtml
 * @param {LessonNode} node
 * @param {{ prev?: {href:string,title:string}, next?: {href:string,title:string} }} nav
 * @param {string} sidebar
 * @param {{ placeholder: string, evaluate: string, resultOne: string, resultOther: string }} quizI18n
 * @param {string[]} osiLabels
 * @param {string} lang
 * @param {Record<string, string>} chrome
 */
function renderLesson(srcFile, templateHtml, node, nav = {}, sidebar = "", quizI18n = { placeholder: "…", evaluate: "Check answers", resultOne: "{correct}/{total}", resultOther: "{correct}/{total}" }, osiLabels = OSI_LAYER_KEYS.map((key) => OSI_LAYER_FALLBACK[key]), lang = "en", chrome = CHROME_KEYS) {
  let src = fs.readFileSync(srcFile, "utf8");

  // ── Pre-process :::quiz / :::evaluate blocks ──────────────────
  src = processQuizBlocks(src);

  // ── Pre-process :::task blocks ─────────────────────────────────
  src = processTaskBlocks(src, chrome);

  // ── Pre-process :::sim blocks ──────────────────────────────────
  // Syntax:
  //   :::sim
  //   url=https://example.com/sim.btsim
  //   :::
  //
  // Renders a launch button, not an iframe: the in-app lessons panel
  // intercepts the click and loads the scenario directly into the already-
  // running SimControl (see LessonsPanel.js). On the standalone lessons
  // site (no live SimControl to attach to) the plain href fallback opens
  // the scenario in the full embedded app view instead.
  src = src.replace(/:::sim\s*\n([\s\S]*?):::/gm, (_, content) => {
    /** @type {Record<string, string>} */
    const params = {};
    for (const line of content.trim().split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) params[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    const simUrl = params.url ?? "";
    const openHref = simUrl
      ? `../../?embed=1&sim=${encodeURIComponent(simUrl)}`
      : `../../?embed=1`;
    return [
      `<div class="lesson-sim-launch">`,
      `<a class="lesson-sim-btn" href="${openHref}" data-sim-url="${escHtml(simUrl)}"><i class="fa-solid fa-play"></i> ${escHtml(chrome["lessons.simLaunch"])}</a>`,
      `</div>`,
    ].join("\n");
  });

  // ── Pre-process :fa-icon: shortcuts ───────────────────────────
  // :fa-house:   → fa-solid   :far-house:  → fa-regular   :fab-github: → fa-brands
  src = src.replace(/:fab-([a-z0-9-]+):/g, '<i class="fa-brands fa-$1"></i>');
  src = src.replace(/:far-([a-z0-9-]+):/g, '<i class="fa-regular fa-$1"></i>');
  src = src.replace(/:fa-([a-z0-9-]+):/g, '<i class="fa-solid fa-$1"></i>');

  // ── Pre-process custom sim icon shortcuts ─────────────────────
  // :router:  :switch:
  src = src.replace(/:router:/g, '<span class="my-icon-router lesson-icon" aria-label="Router"></span>');
  src = src.replace(/:switch:/g, '<span class="my-icon-switch lesson-icon" aria-label="Switch"></span>');

  // ── Set up markdown-it with heading ID collection ──────────────
  /** @type {{level:number, text:string, id:string}[]} */
  const headings = [];
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

  for (const type of ["note", "tip", "warning", "danger", "draft"]) {
    md.use(markdownItContainer, type, {
      render(tokens, idx) {
        if (tokens[idx].nesting !== 1) return `</div>\n`;
        const open = `<div class="callout callout-${type}">\n`;
        // ":::draft" (author opt-in, replaces the old always-on wip-banner
        // in _template.html) always shows the same "page not finished yet"
        // notice, using the existing lessons.wip.* chrome strings — any
        // markdown content the author puts inside the block is appended
        // below it.
        if (type !== "draft") return open;
        return open + `<p><strong>${escHtml(chrome["lessons.wip.title"])}</strong> — ${escHtml(chrome["lessons.wip.text"])}</p>\n`;
      },
    });
  }

  // ── :::osi N — 7er-Ampel des ISO/OSI-Modells, Layer N farbig ───
  // Layer-Namen kommen aus locales/{lang}.js (lessons.osi.l1 … l7), siehe osiLabels-Param.
  md.use(markdownItContainer, "osi", {
    render(tokens, idx) {
      if (tokens[idx].nesting !== 1) return "";
      const m = tokens[idx].info.trim().match(/^osi\s+(\d)/);
      const active = m ? parseInt(m[1], 10) : 0;
      let html = `<div class="osi-ampel">\n`;
      for (let l = 7; l >= 1; l--) {
        const cls = l === active ? `osi-ampel-box osi-l${l} active` : `osi-ampel-box`;
        html += `<div class="${cls}"><span class="osi-ampel-num">${l}</span><span class="osi-ampel-label">${escHtml(osiLabels[l - 1])}</span></div>\n`;
      }
      html += `</div>\n`;
      return html;
    },
  });

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
    const tocHtml = `<nav class="lesson-toc" aria-label="${escHtml(chrome["lessons.toc"])}">\n<ul>\n${items}\n</ul>\n</nav>`;
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

  // ── Prev / Next navigation ─────────────────────────────────────
  const navParts = [];
  if (nav.prev) {
    const prevNum = nav.prev.num ? `${numLabel(nav.prev.num)} ` : "";
    navParts.push(`<a href="${nav.prev.href}" class="lesson-nav-prev">← ${prevNum}${nav.prev.title}</a>`);
  }
  if (nav.next) {
    const nextNum = nav.next.num ? `${numLabel(nav.next.num)} ` : "";
    navParts.push(`<a href="${nav.next.href}" class="lesson-nav-next">${nextNum}${nav.next.title} →</a>`);
  }
  if (navParts.length) {
    body += `\n<nav class="lesson-nav" aria-label="${escHtml(chrome["lessons.pageNav"])}">${navParts.join("")}</nav>`;
  }

  const rawTitle = headings.find((h) => h.level === 1)?.text ?? path.basename(srcFile, ".md");
  const title = node.num ? `${numLabel(node.num)} ${rawTitle}` : rawTitle;

  /** Resolves the {{quiz.*}} / {{lessons.*}} tokens quiz/task blocks embed
   *  as literals (they're built by helpers that don't receive quizI18n/chrome).
   *  @param {string} str */
  const resolveChromeTokens = (str) => str
    .replace(/\{\{quiz\.placeholder\}\}/g, escHtml(quizI18n.placeholder))
    .replace(/\{\{quiz\.evaluate\}\}/g, escHtml(quizI18n.evaluate))
    .replace(/\{\{quiz\.result\.one\}\}/g, escHtml(quizI18n.resultOne))
    .replace(/\{\{quiz\.result\.other\}\}/g, escHtml(quizI18n.resultOther))
    .replace(/\{\{lessons\.toc\}\}/g, escHtml(chrome["lessons.toc"]))
    .replace(/\{\{lessons\.themeToggle\}\}/g, escHtml(chrome["lessons.themeToggle"]))
    .replace(/\{\{lessons\.footer\}\}/g, escHtml(chrome["lessons.footer"]))
    .replace(/\{\{lessons\.wip\.title\}\}/g, escHtml(chrome["lessons.wip.title"]))
    .replace(/\{\{lessons\.wip\.text\}\}/g, escHtml(chrome["lessons.wip.text"]))
    .replace(/\{\{lessons\.pageNav\}\}/g, escHtml(chrome["lessons.pageNav"]))
    .replace(/\{\{lessons\.simLaunch\}\}/g, escHtml(chrome["lessons.simLaunch"]));

  // Resolve tokens in `body` itself first: it is handed back as-is (raw HTML
  // fragment, no chrome/sidebar) so the in-app lessons panel can fetch just
  // the per-page .json and inject it directly, without ever seeing the
  // standalone template — so it needs to be self-contained.
  body = resolveChromeTokens(body);

  const html = resolveChromeTokens(
    templateHtml
      .replace(/\{\{title\}\}/g, title)
      .replace(/\{\{body\}\}/g, body)
      .replace(/\{\{sidebar\}\}/g, sidebar)
      .replace(/\{\{lang\}\}/g, lang)
  );

  return { html, title, bodyHtml: body };
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
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=../"><script>location.replace("../")<\/script></head><body></body></html>`;
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

  const body = `<h1>Lektionen</h1>\n\n<ul class="lesson-index-list">\n  ${items}\n</ul>`;
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
  // Canonical source lives in src/lib/ (so it's TS-checked and importable by
  // the in-app lessons panel); copied here verbatim for the standalone site.
  const quizJsPath = path.join(root, "src", "lib", "QuizInteractions.js");
  if (fs.existsSync(quizJsPath)) fs.copyFileSync(quizJsPath, path.join(outDir, "_quiz.js"));

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

    // Remove stale HTML/JSON files that no longer have a source .md
    const expectedHtml = new Set(ordered.map((n) => n.href));
    expectedHtml.add("index.html");
    const expectedJson = new Set(ordered.map((n) => n.href.replace(/\.html$/, ".json")));
    expectedJson.add("index.json");
    for (const existing of fs.readdirSync(langOut)) {
      if (existing.endsWith(".html") && !expectedHtml.has(existing)) {
        fs.rmSync(path.join(langOut, existing));
        console.log(`[lessons] ✗ removed stale ${lang}/${existing}`);
      } else if (existing.endsWith(".json") && !expectedJson.has(existing)) {
        fs.rmSync(path.join(langOut, existing));
        console.log(`[lessons] ✗ removed stale ${lang}/${existing}`);
      }
    }

    // Render each lesson
    for (let i = 0; i < ordered.length; i++) {
      const node = ordered[i];
      const nav = {
        prev: i > 0 ? { href: ordered[i - 1].href, title: ordered[i - 1].title, num: ordered[i - 1].num } : undefined,
        next: i < ordered.length - 1 ? { href: ordered[i + 1].href, title: ordered[i + 1].title, num: ordered[i + 1].num } : undefined,
      };
      const sidebar = renderSidebar(tree, node.href);
      const outFile = path.join(langOut, node.href);
      try {
        const rendered = renderLesson(
          path.join(langDir, node.file),
          templateHtml,
          node,
          nav,
          sidebar,
          (localeInfo[lang] ?? localeInfo["en"])?.quiz,
          (localeInfo[lang] ?? localeInfo["en"])?.osiLabels,
          lang,
          (localeInfo[lang] ?? localeInfo["en"])?.chrome
        );
        fs.writeFileSync(outFile, rendered.html, "utf8");

        // Per-page JSON alongside the standalone HTML, for the in-app lessons
        // panel to fetch (same bodyHtml, no chrome/sidebar/template wrapper).
        const jsonFile = outFile.replace(/\.html$/, ".json");
        fs.writeFileSync(jsonFile, JSON.stringify({
          href: node.href,
          title: rendered.title,
          bodyHtml: rendered.bodyHtml,
          chapterNum: node.num,
          prev: nav.prev ? { href: nav.prev.href, title: nav.prev.title } : null,
          next: nav.next ? { href: nav.next.href, title: nav.next.title } : null,
        }), "utf8");

        console.log(`[lessons] ✓ ${lang}/${node.file}`);
      } catch (/** @type {*} */ e) {
        console.error(`[lessons] ✗ ${lang}/${node.file}: ${e.message}`);
      }
    }

    // Language index → redirect to first lesson (+ JSON manifest for the
    // in-app lessons panel: which page to open first, and the full ordered
    // list/titles for a future table-of-contents view).
    if (ordered.length > 0) {
      fs.writeFileSync(
        path.join(langOut, "index.html"),
        generateLangRedirect(ordered[0].href),
        "utf8"
      );
      fs.writeFileSync(
        path.join(langOut, "index.json"),
        JSON.stringify({
          first: ordered[0].href,
          pages: ordered.map((n) => ({ href: n.href, title: n.title, num: n.num })),
        }),
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
