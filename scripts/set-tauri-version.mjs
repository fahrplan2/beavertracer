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
    const raw = execSync("git describe --tags --long --dirty", { encoding: "utf8" }).trim();

    const m = raw.match(/^v?(\d+\.\d+\.\d+)(?:-(\d+)-g([0-9a-f]+))?(?:-dirty)?$/);
    if (!m) return raw.replace(/^v/, "");

    const [, base, commits, hash] = m;

    if (!commits || commits === "0") return base;

    let v = `${base}+dev.${commits}.${hash}`;
    return v;
  } catch {
    return "0.0.0";
  }
}

const version = computeVersion();

// Pfade anpassen, falls dein Script woanders liegt
const cargoTomlPath = path.resolve(ROOT, "src-tauri", "Cargo.toml");
let cargoToml = readFileSync(cargoTomlPath, "utf8");

// Ersetzt version = "..." nur im [package]-Abschnitt
cargoToml = cargoToml.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]*)(")/,
  `$1${version}$3`
);

writeFileSync(cargoTomlPath, cargoToml);
console.log(`[tauri] set Cargo.toml version -> ${version}`);

// Also keep package.json in sync
const pkgPath = path.resolve(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`[tauri] set package.json version -> ${version}`);