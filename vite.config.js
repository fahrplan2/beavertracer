import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

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

export default defineConfig({
  base: "./",

  plugins: [wiregasmAssets()],

  resolve: {
    alias: {
      ws: path.resolve(__dirname, "shimws.js"),
      fs: false,
      path: false,
      crypto: false,
      child_process: false
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
});
