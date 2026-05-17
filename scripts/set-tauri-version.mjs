import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function computeVersion() {
  // In GitLab CI tag pipelines CI_COMMIT_TAG is set reliably
  const ciTag = process.env.CI_COMMIT_TAG;
  if (ciTag) return ciTag.replace(/^v/, "");

  try {
    const raw = execSync("git describe --tags --long", { encoding: "utf8" }).trim();
    // Greedy capture of tag name, then -{N}-g{hash} suffix that git always appends
    const m = raw.match(/^v?(.+)-(\d+)-g([0-9a-f]+)$/);
    if (!m) return raw.replace(/^v/, "");
    const [, base, commits, hash] = m;
    if (commits === "0") return base;

    // Pre-release tag (e.g. 1.0.0-rc.1): extend its pre-release identifier
    if (/^\d+\.\d+\.\d+-/.test(base)) {
      return `${base}.dev.${commits}.${hash}`;
    }
    // Stable tag (e.g. 0.1.17): bump patch and mark as pre-release of next
    const parts = base.split(".");
    parts[2] = String(Number(parts[2]) + 1);
    return `${parts.join(".")}-dev.${commits}.${hash}`;
  } catch {
    return "0.0.0";
  }
}

const version = computeVersion();

const cargoTomlPath = path.resolve(ROOT, "src-tauri", "Cargo.toml");
let cargoToml = readFileSync(cargoTomlPath, "utf8");

// Replace version only in the [package] section
cargoToml = cargoToml.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]*)(")/,
  `$1${version}$3`
);

writeFileSync(cargoTomlPath, cargoToml);
console.log(`[tauri] set Cargo.toml version -> ${version}`);

const pkgPath = path.resolve(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`[tauri] set package.json version -> ${version}`);
