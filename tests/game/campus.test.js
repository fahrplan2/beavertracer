import { describe, it, expect } from "vitest";
import { AREAS, CAMPUS_LEVELS, MEDIA, WIRED, bestMedium, budget, commission, mediumProblem, optimalCost, projectScore } from "../../src/game/campus.js";
import { gameContent } from "../../src/game/content.js";

const solve = (lv) => lv.links.map((l) => ({ medium: bestMedium(l), area: WIRED.includes(bestMedium(l)) ? l.area : null }));

describe("campus planner rules", () => {
    it("media limits", () => {
        const link = (o) => ({ from: 0, to: 1, dist: 10, mbit: 100, area: null, ...o });
        expect(mediumProblem(link({ dist: 150 }), "tp")).toBe("tpLength");
        expect(mediumProblem(link({ emv: true }), "tp")).toBe("emv");
        expect(mediumProblem(link({ mbit: 100000 }), "tp")).toBe("tpSpeed");
        expect(mediumProblem(link({ mobile: true }), "fiber")).toBe("mobile");
        expect(mediumProblem(link({ battery: true, mbit: 0.001 }), "wlan")).toBe("wlanPower");
        expect(mediumProblem(link({ battery: true, mbit: 0.001 }), "lora")).toBeNull();
        expect(mediumProblem(link({}), "lora")).toBe("loraData");
        expect(mediumProblem(link({ public: true, dist: 12000 }), "fiber")).toBe("public");
        expect(mediumProblem(link({}), "wan")).toBe("wanLocal");
        expect(mediumProblem(link({ dist: 60 }), "wlan")).toBe("wlanRange");
    });

    it("every link can be built, every medium is the best choice somewhere", () => {
        const used = new Set();
        for (const lv of CAMPUS_LEVELS) {
            for (const l of lv.links) {
                expect(MEDIA.some((m) => mediumProblem(l, m) === null)).toBe(true);
                used.add(bestMedium(l));
                if (lv.areas && WIRED.includes(bestMedium(l))) expect(AREAS).toContain(l.area);
            }
        }
        expect([...used].sort()).toEqual([...MEDIA].sort());
    });

    it("the cheapest plan passes commissioning within budget; a wrong area or medium fails", () => {
        for (const lv of CAMPUS_LEVELS) {
            const plan = solve(lv);
            const res = commission(lv, plan);
            expect(res.ok).toBe(true);
            expect(res.cost).toBe(optimalCost(lv));
            expect(budget(lv)).toBeGreaterThan(optimalCost(lv));
        }
        const lv = CAMPUS_LEVELS[2];
        const wrongArea = solve(lv).map((c, i) => (i === 0 ? { ...c, area: "tertiary" } : c));
        expect(commission(lv, wrongArea).problems[0]).toBe("area");
        const wrongMedium = solve(lv).map((c, i) => (i === 0 ? { medium: "tp", area: "primary" } : c));
        expect(commission(lv, wrongMedium).problems[0]).toBe("tpLength");
    });

    it("scoring", () => {
        expect(projectScore(1000, 1000, 0)).toBe(100);
        expect(projectScore(1100, 1000, 0)).toBe(85);
        expect(projectScore(1000, 1000, 1)).toBe(85);
        expect(projectScore(5000, 1000, 2)).toBe(40);
    });

    it("content matches the levels", () => {
        for (const lang of ["de", "en"]) {
            const tx = gameContent(lang).games.campus;
            CAMPUS_LEVELS.forEach((lv, i) => {
                expect(tx.levels[i].nodes).toHaveLength(lv.nodes.length);
                expect(tx.levels[i].links).toHaveLength(lv.links.length);
            });
        }
    });
});
