import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function computeVersion() {
  try {
    const raw = execSync("git describe --tags --long --dirty", { encoding: "utf8" }).trim();

    const m = raw.match(/^v?(\d+\.\d+\.\d+)(?:-(\d+)-g([0-9a-f]+))?(?:-dirty)?$/);
    if (!m) return raw.replace(/^v/, "");

    const [, base, commits, hash] = m;

    if (!commits || commits === "0") return base;

    let v = `${base}+dev.${commits}.${hash}`;
    if (raw.endsWith("-dirty")) v += ".dirty";
    return v;
  } catch {
    return "0.0.0";
  }
}

const version = computeVersion();

// Pfade anpassen, falls dein Script woanders liegt
const cargoTomlPath = path.resolve("src-tauri", "Cargo.toml");
let cargoToml = readFileSync(cargoTomlPath, "utf8");

// Ersetzt version = "..." nur im [package]-Abschnitt
cargoToml = cargoToml.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]*)(")/,
  `$1${version}$3`
);

writeFileSync(cargoTomlPath, cargoToml);
console.log(`[tauri] set Cargo.toml version -> ${version}`);