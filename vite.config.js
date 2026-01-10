import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// package.json robust lesen (statt import)
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));

function computeVersion() {
  try {
    const raw = execSync(
      "git describe --tags --long --dirty",
      { encoding: "utf8" }
    ).trim();

    //We are replacing the version string so that it gets SemVer-compatible
    // git will deliver:
    
    // v1.4.1-0-gab12cd
    // v1.4.1-7-gab12cd-dirty
    const m = raw.match(
      /^v?(\d+\.\d+\.\d+)(?:-(\d+)-g([0-9a-f]+))?(?:-dirty)?$/
    );

    if (!m) {
      return raw.replace(/^v/, "");
    }

    const [, base, commits, hash] = m;

    // exakt auf Tag → Release
    if (!commits || commits === "0") {
      return base;
    }

    let v = `${base}+dev.${commits}.${hash}`;

    if (raw.endsWith("-dirty")) {
      v += ".dirty";
    }

    return v;
  } catch {
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
