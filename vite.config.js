import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// package.json robust lesen (statt import)
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));

function sh(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

function computeVersion() {
  try {
    return execSync("git describe --tags --always --dirty", { encoding: "utf8" })
      .trim()
      .replace(/^v/, "");
  } catch {
    // Fallback, falls ohne .git gebaut wird
    return "0.0.0";
  }
}


function wiregasmAssets() {
  const files = ["wiregasm.wasm", "wiregasm.data"];

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

      fs.copyFileSync(src, dst);
    }
  }

  return {
    name: "wiregasm-assets",
    // WICHTIG: nicht nur "serve", sonst läuft es NICHT im build!
    // apply: "serve",

    configResolved(config) {
      copyAssets(config.root ?? process.cwd());
    },

    buildStart() {
      copyAssets(process.cwd());
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
    include: ["@goodtools/wiregasm"],
  },

  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(computeVersion()),
  },

});
