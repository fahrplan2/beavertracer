import { describe, it, expect } from "vitest";
import { BELT_LEVELS, MASK_OCTETS, TOTAL_BELT_PACKETS, beltMultiplier, beltPoints, beltScore, bin8, buildBeltLevel } from "../../src/game/binaryBelt.js";

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

describe("packet belt rules", () => {
    it("formats octets", () => {
        expect(bin8(178)).toBe("1011 0010");
        expect(bin8(5)).toBe("0000 0101");
    });

    it("scoring", () => {
        expect(beltMultiplier(0)).toBe(1);
        expect(beltMultiplier(5)).toBe(2);
        expect(beltMultiplier(99)).toBe(4);
        expect(beltPoints(0, 0, 0)).toBe(20);
        expect(beltScore(TOTAL_BELT_PACKETS)).toBe(100);
    });

    it("levels are well-formed", () => {
        for (let seed = 1; seed <= 200; seed++) {
            BELT_LEVELS.forEach((spec, i) => {
                const lv = buildBeltLevel(i, rng(seed * 13 + i));
                expect(lv.packets).toHaveLength(spec.count);
                for (const p of lv.packets) {
                    expect(p.value).toBeGreaterThanOrEqual(1);
                    expect(p.value).toBeLessThanOrEqual(255);
                }
                if (i === 0) expect(lv.packets.every((p) => p.value <= 15 && p.mode === "set")).toBe(true);
                if (i === 3) expect(lv.packets.every((p) => p.mode === "read")).toBe(true);
                if (i === 4) expect(lv.packets.every((p) => MASK_OCTETS.includes(p.value))).toBe(true);
                if (i === 5) expect(lv.packets.filter((p) => p.mode === "read")).toHaveLength(4);
                expect(lv.spawnMs / lv.travelMs).toBeGreaterThan(0.3);
            });
        }
    });
});
