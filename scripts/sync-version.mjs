import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function computeVersion() {
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
