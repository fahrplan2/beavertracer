//@ts-check
import { t } from "../i18n/index.js";

/**
 * Downloads page, live part: the desktop builds take ~30 minutes in CI, but
 * the web code goes live right away (scripts/deploy.sh). deploy.sh therefore
 * writes releases/index.json with the files that have actually arrived; this
 * module reads it to
 *  - mark buttons whose file is not there yet,
 *  - point to the newest complete older version in the meantime,
 *  - offer older versions in a drop-down at the version number.
 * Without an index (local dev, offline, fetch blocked) the page stays as is.
 */

/** File name suffix per button (data-download="…" in pages/downloads/*.html). */
export const DOWNLOAD_KINDS = /** @type {const} */ ({
  exe: "_x64-setup.exe",
  appimage: "_amd64.AppImage",
  deb: "_amd64.deb",
  dmg: "_universal.dmg",
});

/** @typedef {keyof typeof DOWNLOAD_KINDS} DownloadKind */
/** @typedef {{ version: string, prerelease: boolean, files: Partial<Record<DownloadKind, string>> }} ReleaseEntry */

const FILE_RE = /^beavertracer_(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(_x64-setup\.exe|_amd64\.AppImage|_amd64\.deb|_universal\.dmg)$/;

/**
 * SemVer order: 0.1.16 < 0.1.17-rc.1 < 0.1.17-rc.2 < 0.1.17.
 * @param {string} a
 * @param {string} b
 * @returns {number} <0, 0, >0
 */
export function compareVersions(a, b) {
  const [coreA, preA = ""] = splitVersion(a);
  const [coreB, preB = ""] = splitVersion(b);
  for (let i = 0; i < 3; i++) {
    const d = (coreA[i] ?? 0) - (coreB[i] ?? 0);
    if (d) return d;
  }
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  const pa = preA.split(".");
  const pb = preB.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : NaN;
    const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else if (pa[i] !== pb[i]) {
      if (!Number.isNaN(na)) return -1;
      if (!Number.isNaN(nb)) return 1;
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * @param {string} v
 * @returns {[number[], string|undefined]}
 */
function splitVersion(v) {
  const s = String(v).replace(/^v/, "");
  const dash = s.indexOf("-");
  const core = dash < 0 ? s : s.slice(0, dash);
  return [core.split(".").map((n) => Number(n) || 0), dash < 0 ? undefined : s.slice(dash + 1)];
}

/**
 * Groups the file list of releases/index.json by version, newest first.
 * Unknown or malformed entries are skipped.
 * @param {unknown} json { files: [{ name: "beavertracer_0.1.17_amd64.deb", … }] }
 * @returns {ReleaseEntry[]}
 */
export function parseReleaseIndex(json) {
  const files = /** @type {any} */ (json)?.files;
  if (!Array.isArray(files)) return [];
  /** @type {Map<string, ReleaseEntry>} */
  const byVersion = new Map();
  for (const f of files) {
    const name = typeof f === "string" ? f : f?.name;
    const m = typeof name === "string" ? name.match(FILE_RE) : null;
    if (!m) continue;
    const [, version, suffix] = m;
    const kind = /** @type {DownloadKind} */ (
      Object.keys(DOWNLOAD_KINDS).find((k) => DOWNLOAD_KINDS[/** @type {DownloadKind} */ (k)] === suffix)
    );
    let entry = byVersion.get(version);
    if (!entry) {
      entry = { version, prerelease: version.includes("-"), files: {} };
      byVersion.set(version, entry);
    }
    entry.files[kind] = name;
  }
  return [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Which version the page should show first, and whether the current one is
 * still being built.
 * - Current version has files → current (missing ones are marked per button).
 * - Current version has none yet → newest older version with files.
 * @param {ReleaseEntry[]} releases from parseReleaseIndex
 * @param {string} current version this web build belongs to (VITE_LAST_RELEASE)
 * @returns {{ selected: string, pending: boolean, fallback: string|null }}
 */
export function pickInitialVersion(releases, current) {
  const entry = releases.find((r) => r.version === current);
  if (entry && Object.keys(entry.files).length > 0) {
    return { selected: current, pending: false, fallback: null };
  }
  const older = releases.find((r) => compareVersions(r.version, current) < 0 && Object.keys(r.files).length > 0);
  return { selected: older?.version ?? current, pending: true, fallback: older?.version ?? null };
}

/**
 * URL of releases/index.json. When the page itself runs on the download
 * host (with or without "www."), the request stays same-origin so no CORS
 * header is needed.
 * @param {string} downloadBase e.g. "https://www.beavertracer.eu/releases"
 * @param {Location|URL} [here]
 */
export function releaseIndexUrl(downloadBase, here = window.location) {
  const base = new URL(downloadBase.replace(/\/+$/, "") + "/index.json", here.href);
  const strip = (/** @type {string} */ h) => h.replace(/^www\./, "");
  if (strip(base.hostname) === strip(here.hostname)) return here.origin + base.pathname;
  return base.href;
}

/**
 * @param {string} downloadBase
 * @returns {Promise<ReleaseEntry[]|null>} null when there is no usable index
 */
export async function fetchReleaseIndex(downloadBase) {
  try {
    const res = await fetch(releaseIndexUrl(downloadBase), { cache: "no-store" });
    if (!res.ok) return null;
    return parseReleaseIndex(await res.json());
  } catch {
    return null;
  }
}

/**
 * Wires the rendered downloads page (see StaticPages.js) to the release index.
 * @param {HTMLElement} root container holding the page HTML
 * @param {{ downloadBase: string, current: string }} opts
 */
export async function initDownloadsPage(root, { downloadBase, current }) {
  const releases = await fetchReleaseIndex(downloadBase);
  if (!releases || !root.isConnected) return;

  const { selected, pending, fallback } = pickInitialVersion(releases, current);
  // The current version always appears in the list, even before its files exist.
  const versions = releases.some((r) => r.version === current)
    ? releases
    : [{ version: current, prerelease: current.includes("-"), files: {} }, ...releases]
        .sort((a, b) => compareVersions(b.version, a.version));

  if (pending) {
    const note = document.createElement("p");
    note.className = "download-note download-note--pending";
    note.setAttribute("role", "status");
    note.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> ';
    note.append(t("downloads.pending", { version: current })
      + (fallback ? " " + t("downloads.pendingFallback", { version: fallback }) : ""));
    root.querySelector(".subtitle")?.after(note);
  }

  /** @param {string} version */
  const apply = (version) => {
    const entry = versions.find((r) => r.version === version);
    root.querySelectorAll("a[data-download]").forEach((a) => {
      const kind = /** @type {DownloadKind} */ (a.getAttribute("data-download"));
      const file = entry?.files[kind];
      setButtonState(/** @type {HTMLAnchorElement} */ (a), file ? `${downloadBase.replace(/\/+$/, "")}/${file}` : null);
    });
  };

  const label = root.querySelector(".download-version");
  if (label && versions.length > 1) {
    const select = document.createElement("select");
    select.className = "download-version-select";
    select.setAttribute("aria-label", t("downloads.versionSelect"));
    for (const r of versions) {
      const opt = document.createElement("option");
      opt.value = r.version;
      const tags = [];
      if (r.version === current) tags.push(pending ? t("downloads.tag.building") : t("downloads.tag.latest"));
      if (r.prerelease) tags.push(t("downloads.tag.prerelease"));
      opt.textContent = r.version + (tags.length ? ` (${tags.join(", ")})` : "");
      select.append(opt);
    }
    select.value = selected;
    select.addEventListener("change", () => apply(select.value));
    label.replaceWith(select);
  } else if (label) {
    label.textContent = selected;
  }

  apply(selected);
}

/**
 * Enables a download button for href, or marks it "not available yet".
 * @param {HTMLAnchorElement} a
 * @param {string|null} href
 */
function setButtonState(a, href) {
  const icon = a.querySelector("i");
  let hint = a.querySelector(".download-btn-hint");
  if (href) {
    a.href = href;
    a.removeAttribute("aria-disabled");
    a.removeAttribute("tabindex");
    a.classList.remove("download-btn--missing");
    icon?.classList.replace("fa-hourglass-half", "fa-download");
    hint?.remove();
  } else {
    a.removeAttribute("href");
    a.setAttribute("aria-disabled", "true");
    a.setAttribute("tabindex", "-1");
    a.classList.add("download-btn--missing");
    icon?.classList.replace("fa-download", "fa-hourglass-half");
    if (!hint) {
      hint = document.createElement("span");
      hint.className = "download-btn-hint";
      a.append(hint);
    }
    hint.textContent = t("downloads.notYet");
  }
}
