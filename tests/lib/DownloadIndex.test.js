import { describe, it, expect } from "vitest";
import {
  compareVersions,
  parseReleaseIndex,
  pickInitialVersion,
  releaseIndexUrl,
} from "../../src/lib/DownloadIndex.js";

/** @param {string} v */
const allFiles = (v) => [
  `beavertracer_${v}_x64-setup.exe`,
  `beavertracer_${v}_amd64.AppImage`,
  `beavertracer_${v}_amd64.deb`,
  `beavertracer_${v}_universal.dmg`,
].map((name) => ({ name, size: 1 }));

describe("compareVersions", () => {
  it("orders by SemVer incl. pre-releases", () => {
    const sorted = ["0.1.17", "0.1.9", "0.1.17-rc.1", "0.1.17-rc.10", "0.1.17-rc.2", "0.1.16", "1.0.0-beta.1"]
      .sort(compareVersions);
    expect(sorted).toEqual(["0.1.9", "0.1.16", "0.1.17-rc.1", "0.1.17-rc.2", "0.1.17-rc.10", "0.1.17", "1.0.0-beta.1"]);
  });

  it("treats a leading v and equal versions alike", () => {
    expect(compareVersions("v0.1.2", "0.1.2")).toBe(0);
  });
});

describe("parseReleaseIndex", () => {
  it("groups files by version, newest first", () => {
    const r = parseReleaseIndex({ files: [...allFiles("0.1.15"), ...allFiles("0.1.17-rc.1"), ...allFiles("0.1.16")] });
    expect(r.map((e) => e.version)).toEqual(["0.1.17-rc.1", "0.1.16", "0.1.15"]);
    expect(r[0].prerelease).toBe(true);
    expect(r[1].prerelease).toBe(false);
    expect(r[1].files).toEqual({
      exe: "beavertracer_0.1.16_x64-setup.exe",
      appimage: "beavertracer_0.1.16_amd64.AppImage",
      deb: "beavertracer_0.1.16_amd64.deb",
      dmg: "beavertracer_0.1.16_universal.dmg",
    });
  });

  it("keeps partially arrived versions with only their files", () => {
    const r = parseReleaseIndex({ files: [{ name: "beavertracer_0.1.17_amd64.deb" }] });
    expect(r).toEqual([{ version: "0.1.17", prerelease: false, files: { deb: "beavertracer_0.1.17_amd64.deb" } }]);
  });

  it("ignores foreign, temp and malformed entries", () => {
    const r = parseReleaseIndex({ files: [
      { name: ".download.abc123" }, { name: "index.json" }, { name: "beavertracer_latest_amd64.deb" },
      { name: "beavertracer_0.1.17_arm64.deb" }, null, 42, {},
    ] });
    expect(r).toEqual([]);
  });

  it("returns [] for anything that is not an index", () => {
    expect(parseReleaseIndex(null)).toEqual([]);
    expect(parseReleaseIndex({})).toEqual([]);
    expect(parseReleaseIndex("<html>")).toEqual([]);
  });
});

describe("pickInitialVersion", () => {
  const index = parseReleaseIndex({ files: [...allFiles("0.1.15"), ...allFiles("0.1.16")] });

  it("shows the current version when its files are there", () => {
    expect(pickInitialVersion(index, "0.1.16")).toEqual({ selected: "0.1.16", pending: false, fallback: null });
  });

  it("falls back to the newest older version while the current one is being built", () => {
    expect(pickInitialVersion(index, "0.1.17")).toEqual({ selected: "0.1.16", pending: true, fallback: "0.1.16" });
  });

  it("does not fall back to a newer pre-release", () => {
    const r = parseReleaseIndex({ files: [...allFiles("0.2.0-rc.1"), ...allFiles("0.1.15")] });
    expect(pickInitialVersion(r, "0.1.16")).toEqual({ selected: "0.1.15", pending: true, fallback: "0.1.15" });
  });

  it("counts a partially arrived current version as available", () => {
    const r = parseReleaseIndex({ files: [...allFiles("0.1.16"), { name: "beavertracer_0.1.17_amd64.deb" }] });
    expect(pickInitialVersion(r, "0.1.17")).toEqual({ selected: "0.1.17", pending: false, fallback: null });
  });

  it("stays on the current version when nothing older exists", () => {
    expect(pickInitialVersion([], "0.1.0")).toEqual({ selected: "0.1.0", pending: true, fallback: null });
  });
});

describe("releaseIndexUrl", () => {
  const base = "https://www.beavertracer.eu/releases";

  it("stays same-origin on the download host, with or without www", () => {
    expect(releaseIndexUrl(base, new URL("https://beavertracer.eu/downloads"))).toBe("https://beavertracer.eu/releases/index.json");
    expect(releaseIndexUrl(base + "/", new URL("https://www.beavertracer.eu/"))).toBe("https://www.beavertracer.eu/releases/index.json");
  });

  it("uses the absolute URL from elsewhere", () => {
    expect(releaseIndexUrl(base, new URL("http://localhost:5173/"))).toBe("https://www.beavertracer.eu/releases/index.json");
  });

  it("resolves a relative base against the page", () => {
    expect(releaseIndexUrl("/releases", new URL("http://localhost:5173/downloads"))).toBe("http://localhost:5173/releases/index.json");
  });
});
