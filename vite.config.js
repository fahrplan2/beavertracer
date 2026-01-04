//@ts-check

import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

function wiregasmAssets() {
  return {
    name: "wiregasm-assets",
    /**
     * @param {{ root: string; }} config
     */
    configResolved(config) {
      const root = config.root ?? process.cwd();
      const srcDir = path.join(root, "node_modules", "@goodtools", "wiregasm", "dist");
      const dstDir = path.join(root, "public", "wiregasm");

      if (!fs.existsSync(srcDir)) throw new Error("[wiregasm] wiregasm not installed");
      fs.mkdirSync(dstDir, { recursive: true });

      for (const f of ["wiregasm.wasm", "wiregasm.data"]) {
        const src = path.join(srcDir, f);
        const dst = path.join(dstDir, f);
        if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [wiregasmAssets()],
  resolve: {
    alias: {
      ws: path.resolve(__dirname, "shimws.js"),
    },
  },

optimizeDeps: {
    exclude: ["ws"],
    include: ["@goodtools/wiregasm/dist/wiregasm"],
  },
});