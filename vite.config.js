import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import pkg from "./package.json";

function wiregasmAssets() {
  const files = ["wiregasm.wasm", "wiregasm.data"];

  /**
   * @param {string} root
   */
  function copyAssets(root) {
    const srcDir = path.join(root, "node_modules", "@goodtools", "wiregasm", "dist");
    const dstDir = path.join(root, "public", "wiregasm");

    if (!fs.existsSync(srcDir)) {
      throw new Error("[wiregasm] @goodtools/wiregasm not installed (missing dist folder)");
    }
    fs.mkdirSync(dstDir, { recursive: true });

    for (const f of files) {
      const src = path.join(srcDir, f);
      const dst = path.join(dstDir, f);

      if (!fs.existsSync(src)) {
        throw new Error(`[wiregasm] Missing asset in package: ${src}`);
      }
      // immer kopieren (auch wenn vorhanden), damit Updates sicher durchgehen
      fs.copyFileSync(src, dst);
    }
  }
  return {
    name: "wiregasm-assets",
    apply: "serve", // dev
    /**
     * @param {{ root: string; }} config
     */
    configResolved(config) {
      const root = config.root ?? process.cwd();
      copyAssets(root);
    },
    // zweites Plugin-Lifecycle für build
    // (Vite erlaubt mehrere Hooks im selben Plugin)
    buildStart() {
      // buildStart hat kein config-Argument -> nimm cwd oder derive aus env
      const root = process.cwd();
      copyAssets(root);
    },
  };
}

function sh(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

function computeVersion() {
  const base = (pkg.version ?? "0.0.0").replace(/^v/, "");

  // Falls Git nicht verfügbar ist oder .git fehlt: fallback auf package.json
  try {
    // Exakt auf Tag?
    try {
      const exactTag = sh("git describe --tags --exact-match");
      return exactTag.replace(/^v/, "");
    } catch {
      /* not on tag */
    }

    // Letzter Tag (oder 0.0.0 wenn keiner existiert)
    let tag = "0.0.0";
    try {
      tag = sh("git describe --tags --abbrev=0").replace(/^v/, "");
    } catch {
      /* no tags */
    }

    const commits = sh(`git rev-list ${tag}..HEAD --count`);
    const hash = sh("git rev-parse --short HEAD");
    let v = `${tag}+dev.${commits}.${hash}`;

    // dirty?
    try {
      sh("git diff --quiet"); // exits non-zero if dirty
    } catch {
      v += ".dirty";
    }

    return v;
  } catch {
    return base;
  }

}

  


export default defineConfig({
  base: "./",

  plugins: [wiregasmAssets()],

  resolve: {
    alias: {
      ws: path.resolve(__dirname, "shimws.js"),
    },
  },

  /**
   * optimizeDeps wirkt nur im Dev-Server, aber schadet hier nicht.
   * Wenn du wiregasm in Dev nicht sauber geladen bekommst, hilft include/exclude.
   */
  optimizeDeps: {
    exclude: ["ws"],
    // Wenn das Paket ESM ist, kann include helfen. Wenn es Probleme macht: rausnehmen.
    include: ["@goodtools/wiregasm"],
  },
  define: {
    __APP_VERSION__: JSON.stringify(computeVersion()),
  },
});
