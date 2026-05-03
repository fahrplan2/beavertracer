import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function computeVersion() {
  try {
    const raw = execSync("git describe --tags --long", { encoding: "utf8" }).trim();
    const m = raw.match(/^v?(\d+\.\d+\.\d+)(?:-(\d+)-g([0-9a-f]+))?$/);
    if (!m) return raw.replace(/^v/, "");
    const [, base, commits, hash] = m;
    if (!commits || commits === "0") return base;
    return `${base}+dev.${commits}.${hash}`;
  } catch {
    return null;
  }
}

const version = computeVersion();
if (!version) process.exit(0);

const pkgPath = path.resolve("package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.version !== version) {
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`[version] package.json -> ${version}`);
}
