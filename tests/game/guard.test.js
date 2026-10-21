import { describe, it, expect } from "vitest";
import { GUARD_LEVELS, TOTAL_GUARD_REQUESTS, buildGuardLevel, guardScore, verdict } from "../../src/game/guard.js";
import { username } from "../../src/game/GuardView.js";

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

const ALL = GUARD_LEVELS[4].rules;
const person = (role, extra = {}) => ({ name: 0, role, expiresInDays: 30, ...extra });

describe("gatekeeper house rules", () => {
    it("entry (physical access)", () => {
        expect(verdict({ kind: "entry", person: person("it"), room: "server", hour: 10, minute: 0, escort: null }, ALL)).toEqual({ allow: true, rule: "server" });
        expect(verdict({ kind: "entry", person: person("teacher"), room: "server", hour: 10, minute: 0, escort: null }, ALL).allow).toBe(false);
        expect(verdict({ kind: "entry", person: person("visitor"), room: "office", hour: 10, minute: 0, escort: 3 }, ALL).allow).toBe(true);
        expect(verdict({ kind: "entry", person: person("visitor"), room: "office", hour: 10, minute: 0, escort: null }, ALL).allow).toBe(false);
        expect(verdict({ kind: "entry", person: person("teacher", { expiresInDays: -2 }), room: "office", hour: 10, minute: 0, escort: null }, ALL)).toEqual({ allow: false, rule: "expired" });
        expect(verdict({ kind: "entry", person: person("teacher"), room: "office", hour: 21, minute: 0, escort: null }, ALL)).toEqual({ allow: false, rule: "night" });
        expect(verdict({ kind: "entry", person: person("caretaker"), room: "office", hour: 21, minute: 0, escort: null }, ALL).allow).toBe(true);
        // before the expiry rule is in force, an old badge doesn't matter
        expect(verdict({ kind: "entry", person: person("teacher", { expiresInDays: -2 }), room: "office", hour: 10, minute: 0, escort: null }, ["server", "office"]).allow).toBe(true);
    });

    it("login (system access)", () => {
        const base = { kind: "login", person: person("it"), system: "admin", account: 0, failed: 0, twofa: true };
        expect(verdict(base, ALL)).toEqual({ allow: true, rule: "admin" });
        expect(verdict({ ...base, twofa: false }, ALL).allow).toBe(false);
        expect(verdict({ ...base, person: person("teacher") }, ALL).allow).toBe(false);
        expect(verdict({ ...base, account: 4 }, ALL)).toEqual({ allow: false, rule: "own" });
        expect(verdict({ ...base, failed: 3 }, ALL)).toEqual({ allow: false, rule: "lockout" });
        expect(verdict({ ...base, system: "pc", person: person("student"), twofa: false }, ALL).allow).toBe(true);
    });

    it("data (data access)", () => {
        const d = (role, folder, action) => verdict({ kind: "data", person: person(role), folder, action }, ALL).allow;
        expect(d("teacher", "grades", "write")).toBe(true);
        expect(d("student", "grades", "read")).toBe(false);
        expect(d("office", "files", "write")).toBe(true);
        expect(d("teacher", "files", "read")).toBe(false);
        expect(d("teacher", "exams", "read")).toBe(true);
        expect(d("teacher", "exams", "write")).toBe(false);
        expect(d("head", "exams", "write")).toBe(true);
    });

    it("levels: every kind shows up, decisions are mixed, tricky details only once their rule is in force", () => {
        let allowed = 0, total = 0;
        for (let seed = 1; seed <= 300; seed++) {
            GUARD_LEVELS.forEach((spec, i) => {
                const lv = buildGuardLevel(i, rng(seed * 7 + i), 16);
                expect(lv.requests).toHaveLength(spec.count);
                for (const k of spec.kinds) expect(lv.requests.some((r) => r.kind === k)).toBe(true);
                for (const r of lv.requests) {
                    expect(spec.kinds).toContain(r.kind);
                    if (!spec.rules.includes("expired")) expect(r.person.expiresInDays).toBeGreaterThan(0);
                    if (r.kind === "entry" && !spec.rules.includes("night")) expect(r.hour).toBeLessThan(20);
                    if (r.kind === "entry" && r.escort !== null) expect(r.escort).not.toBe(r.person.name);
                    if (verdict(r, spec.rules).allow) allowed++;
                    total++;
                }
            });
        }
        expect(allowed / total).toBeGreaterThan(0.3);
        expect(allowed / total).toBeLessThan(0.7);
    });

    it("score and usernames", () => {
        expect(guardScore(TOTAL_GUARD_REQUESTS)).toBe(100);
        expect(username("Ben Yılmaz")).toBe("b.yilmaz");
        expect(username("Lena Schäfer")).toBe("l.schafer");
    });
});
