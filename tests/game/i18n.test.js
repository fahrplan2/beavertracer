import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import de from "../../locales/de.js";
import en from "../../locales/en.js";
import { CONTENT_LANGS, gameContent } from "../../src/game/content.js";

// The game must stay translatable: every interface string it uses exists
// in the locale files, and every content file has the shape of the German
// one (same keys, same array lengths, same numbers, same placeholders).

const GAME_DIR = path.resolve(__dirname, "../../src/game");
const sources = fs.readdirSync(GAME_DIR).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(GAME_DIR, f), "utf8")).join("\n");

/** Keys built at run time from a fixed set of values. */
const DYNAMIC = {
    "game.prio.": ["low", "medium", "high"],
    "game.round.placeholder.": ["ip", "bin", "num"],
    "game.tab.": ["tickets", "intermezzos", "badges", "codes", "more"],
    "game.result.cheer.": ["great", "good", "ok", "low"],
    "game.vl.review.": ["small", "waste", "timeout", "full"],
    "game.bb.review.": ["set", "read"],
    "game.gd.kind.": ["entry", "login", "data"],
    "game.gd.whyKind.": ["entry", "login", "data"],
};

function usedKeys() {
    const keys = new Set([...sources.matchAll(/t\(\s*"(game\.[\w.]+)"/g)].map((m) => m[1]));
    for (const m of sources.matchAll(/"(game\.result\.cheer\.\w+)"/g)) keys.add(m[1]);
    for (const [prefix, values] of Object.entries(DYNAMIC)) for (const v of values) keys.add(prefix + v);
    keys.add("game.toolbar");
    keys.add("game.toolbarTitle");
    return keys;
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("game interface strings", () => {
    const keys = usedKeys();
    it("finds the keys in the source", () => {
        expect(keys.size).toBeGreaterThan(100);
    });
    for (const [lang, dict] of Object.entries({ de, en })) {
        it(`${lang} has every key the game uses, with the same placeholders as de`, () => {
            const missing = [...keys].filter((k) => !(k in dict));
            expect(missing).toEqual([]);
            for (const k of keys) expect(placeholders(dict[k]), `${lang}: ${k}`).toBe(placeholders(de[k]));
        });
    }
    it("de and en define the same game keys", () => {
        const g = (d) => Object.keys(d).filter((k) => k.startsWith("game.")).sort();
        expect(g(en)).toEqual(g(de));
    });
});

/**
 * Lists every difference in shape between two content trees.
 * @returns {string[]}
 */
function shapeDiff(a, b, at = "") {
    if (typeof a === "string") {
        if (typeof b !== "string") return [`${at}: string expected`];
        return placeholders(a) === placeholders(b) ? [] : [`${at}: placeholders {${placeholders(a)}} ≠ {${placeholders(b)}}`];
    }
    if (typeof a === "number") return a === b ? [] : [`${at}: ${a} ≠ ${b}`];
    if (Array.isArray(a)) {
        if (!Array.isArray(b)) return [`${at}: array expected`];
        if (a.length !== b.length) return [`${at}: ${a.length} items ≠ ${b.length}`];
        return a.flatMap((x, i) => shapeDiff(x, b[i], `${at}[${i}]`));
    }
    if (a && typeof a === "object") {
        if (!b || typeof b !== "object") return [`${at}: object expected`];
        const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
        if (ka.join() !== kb.join()) return [`${at}: keys ${ka} ≠ ${kb}`];
        return ka.flatMap((k) => shapeDiff(a[k], b[k], `${at}.${k}`));
    }
    return [];
}

describe("game content", () => {
    it("has German and English content", () => {
        expect(CONTENT_LANGS).toEqual(expect.arrayContaining(["de", "en"]));
    });
    for (const lang of CONTENT_LANGS.filter((l) => l !== "de")) {
        it(`${lang} has the same shape as de`, () => {
            expect(shapeDiff(gameContent("de"), gameContent(lang))).toEqual([]);
        });
    }
    it("falls back to English for languages without content", () => {
        expect(gameContent("fr")).toBe(gameContent("en"));
    });
});
