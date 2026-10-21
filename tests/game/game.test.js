import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GameState, parseSaveFile } from "../../src/game/GameState.js";
import { ALL_INTERMEZZOS, INTERMEZZOS, TICKETS, BADGES, RANK_XP, rankFor, ticketText, badgeText } from "../../src/game/GameCatalog.js";
import { gameContent } from "../../src/game/content.js";
import { MINIGAMES, answersMatch, binarySum } from "../../src/game/minigames.js";

// CheckApi itself pulls in the whole simulation (circular imports) — read
// its method names from the source instead.
const CHECK_FNS = new Set([...fs.readFileSync("src/lessons/CheckApi.js", "utf8").matchAll(/^    (?:async )?(\w+)\(/gm)].map((m) => m[1]));

/** Deterministic RNG (mulberry32). @param {number} seed */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function memoryStorage() {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

describe("GameCatalog", () => {
    it("has unique game numbers", () => {
        const nos = [...ALL_INTERMEZZOS.map((g) => g.no), ...TICKETS.map((t) => t.no)];
        expect(new Set(nos).size).toBe(nos.length);
        expect(nos.every((n) => n > 0)).toBe(true);
    });

    it("has unique ids", () => {
        const ids = [...ALL_INTERMEZZOS.map((g) => g.id), ...TICKETS.map((t) => t.id), ...BADGES.map((b) => `badge:${b.id}`)];
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("tickets use existing simulations and check functions", () => {
        for (const t of TICKETS) {
            expect(fs.existsSync(path.join("public", t.sim)), t.sim).toBe(true);
            for (const c of t.checks) expect(CHECK_FNS.has(c.fn), `${t.id}: ${c.fn}`).toBe(true);
            const tx = ticketText(t.id);
            expect(tx.checks).toHaveLength(t.checks.length);
            expect(t.answer).toBeLessThan(tx.question.options.length);
            expect(tx.hints.length).toBeGreaterThan(0);
        }
    });

    it("every quiz-style intermezzo has a game, every badge a text", () => {
        for (const g of ALL_INTERMEZZOS.filter((x) => x.kind === "rounds")) expect(MINIGAMES[g.id], g.id).toBeDefined();
        for (const b of BADGES) expect(badgeText(b).title, b.id).not.toMatch(/\{/);
        expect(gameContent().ranks).toHaveLength(RANK_XP.length);
    });

    it("the hub only offers the arcade intermezzos for now", () => {
        expect(INTERMEZZOS.map((g) => g.id)).toEqual(["routing", "vlsm", "belt", "guard", "campus", "radio"]);
        expect(BADGES.map((b) => b.id)).not.toContain("bits");
    });

    it("ranks", () => {
        expect(rankFor(0).index).toBe(0);
        expect(rankFor(RANK_XP[1]).index).toBe(1);
        expect(rankFor(99999).next).toBeNull();
    });
});

describe("GameState", () => {
    it("keeps only the best score and computes XP and badges", () => {
        const s = new GameState(memoryStorage());
        s.setName("Ben");
        const first = s.record("binary", 60);
        expect(first.newBest).toBe(true);
        expect(first.xpAfter - first.xpBefore).toBe(60);
        expect(first.newBadges.map((b) => b.id)).toContain("first");
        const worse = s.record("binary", 40);
        expect(worse.newBest).toBe(false);
        expect(s.xp).toBe(60);
        const better = s.record("binary", 95);
        expect(better.xpAfter).toBe(95);
        const rush = s.record("routing", 92);
        expect(rush.newBadges.map((b) => b.id)).toContain("router");
        expect(s.data.results.binary.best).toBe(95);
    });

    it("course XP counts only once per block", () => {
        const s = new GameState(memoryStorage());
        expect(s.awardCourse("q:a.html:q1", 5).gained).toBe(5);
        expect(s.awardCourse("q:a.html:q1", 5).gained).toBe(0);
        expect(s.xp).toBe(5);
    });

    it("persists, exports and imports the save file", () => {
        const storage = memoryStorage();
        const s = new GameState(storage);
        s.setName("Clara");
        s.record("t-dns", 80, { noHints: true });
        expect(new GameState(storage).data.results["t-dns"].best).toBe(80);

        const file = s.exportFile();
        expect(s.fileName()).toBe("clara.btgames");
        const other = new GameState(memoryStorage());
        expect(other.importFile(file)).toBe(true);
        expect(other.name).toBe("Clara");
        expect(other.earnedBadges().map((b) => b.id)).toContain("nohints");
        expect(parseSaveFile(file)?.exported).toBeInstanceOf(Date);

        expect(new GameState(memoryStorage()).importFile("not a file")).toBe(false);
        expect(parseSaveFile(JSON.stringify({ format: "something-else", game: { name: "Clara" } }))).toBeNull();
    });
});

describe("minigames", () => {
    it("answersMatch", () => {
        expect(answersMatch("num", "9.600", "9600")).toBe(true);
        expect(answersMatch("num", "9600 bit/s", "9600")).toBe(true);
        expect(answersMatch("num", "2,5", "2.5")).toBe(true);
        expect(answersMatch("num", "", "0")).toBe(false);
        expect(answersMatch("ip", "192.168.001.0", "192.168.1.0")).toBe(true);
        expect(answersMatch("ip", "192.168.1", "192.168.1.0")).toBe(false);
        expect(answersMatch("bin", "1010 0001", "10100001")).toBe(true);
        expect(answersMatch("bin", "101", "00000101")).toBe(true);
    });

    it("binarySum", () => {
        expect(binarySum(178)).toBe("178 = 128 + 32 + 16 + 2");
        expect(binarySum(0, "alle Bits aus")).toBe("0 = alle Bits aus");
    });

    it("every run of every game is well-formed", () => {
        for (const [id, game] of Object.entries(MINIGAMES)) {
            for (let seed = 1; seed <= 200; seed++) {
                const rounds = game.rounds(rng(seed), gameContent("de").games);
                expect(rounds.length, id).toBeGreaterThanOrEqual(8);
                for (const r of rounds) {
                    expect(r.prompt).toBeTruthy();
                    expect(r.explain).toBeTruthy();
                    if (r.kind === "choice") {
                        expect(r.answer, `${id}: ${r.prompt}`).toBeGreaterThanOrEqual(0);
                        expect(new Set(r.options).size, `${id}: ${r.options}`).toBe(r.options.length);
                    } else if (r.kind === "input") {
                        expect(answersMatch(r.type, r.answer, r.answer), `${id}: ${r.prompt} → ${r.answer}`).toBe(true);
                        if (r.type === "num") expect(Number.isInteger(Number(r.answer)), r.answer).toBe(true);
                    } else {
                        expect(r.target).toBeGreaterThanOrEqual(0);
                        expect(r.target).toBeLessThanOrEqual(255);
                    }
                }
            }
        }
    });
});
