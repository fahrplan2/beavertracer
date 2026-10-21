import { describe, it, expect } from "vitest";
import { LEVEL_CHOICES, MISSIONS, baudRange, bitRate, maxBaud, missionScore, sendProblems, solution, textBits } from "../../src/game/radio.js";
import { gameContent } from "../../src/game/content.js";

describe("radio tuner rules", () => {
    const m = { bandwidthKhz: 4, maxLevels: 16, targetKbit: 12, mode: "full" };

    it("bit rate and limits", () => {
        expect(bitRate({ mode: "simplex", baud: 4800, levels: 8 })).toBe(14400);
        expect(maxBaud(m, "simplex")).toBe(8000);
        expect(maxBaud(m, "half")).toBe(8000);
        expect(maxBaud(m, "full")).toBe(4000); // bandwidth split between both directions
    });

    it("send problems", () => {
        expect(sendProblems(m, { mode: "full", baud: 4000, levels: 8 })).toEqual([]);
        expect(sendProblems(m, { mode: "half", baud: 4000, levels: 8 })).toEqual(["mode"]);
        expect(sendProblems(m, { mode: "full", baud: 6000, levels: 8 })).toEqual(["bandwidth"]);
        expect(sendProblems(m, { mode: "full", baud: 4000, levels: 32 })).toEqual(["noise"]);
        expect(sendProblems(m, { mode: "full", baud: 4000, levels: 4 })).toEqual(["slow"]);
    });

    it("every mission has a solution the slider can reach, and needs more than the default", () => {
        for (const mission of MISSIONS) {
            const s = solution(mission);
            expect(sendProblems(mission, s)).toEqual([]);
            const r = baudRange(mission);
            expect(s.baud % r.step).toBe(0);
            expect(s.baud).toBeLessThanOrEqual(r.max);
            expect(LEVEL_CHOICES).toContain(s.levels);
            // 2 levels at the channel limit isn't enough everywhere — levels matter
        }
        expect(MISSIONS.some((x) => sendProblems(x, { mode: x.mode, baud: maxBaud(x, x.mode), levels: 2 }).includes("slow"))).toBe(true);
        expect(new Set(MISSIONS.map((x) => x.mode))).toEqual(new Set(["simplex", "half", "full"]));
    });

    it("score, bits and content", () => {
        expect(missionScore(0)).toBe(100);
        expect(missionScore(1)).toBe(80);
        expect(missionScore(9)).toBe(40);
        expect(textBits("Hi", 2)).toBe("0100 1000  0110 1001");
        for (const lang of ["de", "en"]) expect(gameContent(lang).games.radio.missions).toHaveLength(MISSIONS.length);
    });
});
