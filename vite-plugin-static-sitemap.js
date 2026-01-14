// vite-plugin-static-sitemap.js
import fs from "node:fs";
import path from "node:path";

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * @param {{
 *   siteUrl: string,            // e.g. "https://www.beavertracer.eu"
 *   pagesDir?: string,          // default "pages"
 *   outFile?: string,           // default "sitemap.xml"
 *   basePath?: string,          // optional prefix e.g. "" or "/"
 *   includePagesPrefix?: boolean // if true: "/pages/about/index.html" instead of "/about"
 *   robots?: boolean            // default true
 * }} opts
 */
export function staticSitemap(opts) {
  const {
    siteUrl,
    pagesDir = "pages",
    outFile = "sitemap.xml",
    basePath = "",
    includePagesPrefix = false,
    robots = true,
  } = opts;

  if (!siteUrl) throw new Error("staticSitemap: opts.siteUrl is required");

  let root = process.cwd();

  /** "/pages/about/index.html" -> "/about" (or "/" for /pages/index.html) */
  function routeFromFile(relFromPages) {
    // relFromPages like "about/index.html" or "index.html"
    if (!relFromPages.endsWith("index.html")) return null;

    const dir = relFromPages.replace(/\/?index\.html$/i, ""); // "" or "about/"
    const slug = dir.replace(/\/+$/g, ""); // "" or "about"
    if (includePagesPrefix) {
      // public URL mirrors file path
      const p = `/pages/${slug ? slug + "/" : ""}index.html`;
      return p;
    }
    return slug ? `/${slug}` : "/";
  }

  function normBase(p) {
    if (!p) return "";
    if (!p.startsWith("/")) p = "/" + p;
    return p.replace(/\/+$/g, "");
  }

  const base = normBase(basePath);

  return {
    name: "static-sitemap",
    apply: "build",
    configResolved(cfg) {
      root = cfg.root || process.cwd();
    },
    closeBundle() {
      const absPages = path.resolve(root, pagesDir);
      if (!fs.existsSync(absPages)) return;

      const files = walk(absPages)
        .map((f) => path.relative(absPages, f).replaceAll(path.sep, "/"))
        // only page entrypoints
        .filter((f) => /(^|\/)index\.html$/i.test(f))
        // ignore localized variants (index.de.html etc) – sitemap should list canonical
        .filter((f) => !/index\.[a-z]{2}(-[A-Za-z0-9]+)?\.html$/i.test(f));

      const routes = new Set();
      for (const rel of files) {
        const route = routeFromFile(rel);
        if (route) routes.add(route);
      }

      const urls = Array.from(routes)
        .map((r) => (base ? base + (r === "/" ? "/" : r) : r))
        .map((r) => r.replace(/\/{2,}/g, "/"))
        .sort((a, b) => a.localeCompare(b));

      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls
          .map((p) => {
            const loc = `${siteUrl.replace(/\/+$/g, "")}${p}`;
            return `  <url><loc>${escapeXml(loc)}</loc></url>\n`;
          })
          .join("") +
        `</urlset>\n`;

      const outDir = path.resolve(root, "dist");
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, outFile), xml, "utf8");

      if (robots) {
        const robotsTxt =
          `User-agent: *\n` +
          `Allow: /\n` +
          `Sitemap: ${siteUrl.replace(/\/+$/g, "")}/${outFile}\n`;
        fs.writeFileSync(path.join(outDir, "robots.txt"), robotsTxt, "utf8");
      }
    },
  };
}
