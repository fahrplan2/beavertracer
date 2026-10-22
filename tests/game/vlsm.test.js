import { describe, it, expect } from "vitest";
import { VLSM_LEVELS, TOTAL_REQUESTS, blockSize, buildVlsmLevel, canPlace, freeStarts, minPrefixFor, blockLabel, blockBroadcast, requestCredit, vlsmScore } from "../../src/game/vlsm.js";

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

/** Buddy-style: the free aligned spot inside the smallest free gap. */
function smartStart(placed, size, capacity) {
    const starts = freeStarts(placed, size, capacity);
    const gapSize = (s) => {
        let lo = s, hi = s + size;
        while (lo > 0 && canPlace(placed, lo - 1, 1, capacity)) lo--;
        while (hi < capacity && canPlace(placed, hi, 1, capacity)) hi++;
        return hi - lo;
    };
    return starts.sort((a, b) => gapSize(a) - gapSize(b) || a - b)[0];
}

describe("address space tetris rules", () => {
    it("smallest fitting prefix", () => {
        expect(minPrefixFor(62)).toBe(26);
        expect(minPrefixFor(63)).toBe(25);
        expect(minPrefixFor(2)).toBe(30);
        expect(minPrefixFor(200)).toBe(24);
    });

    it("placement needs alignment and free space", () => {
        const placed = [{ start: 64, size: 64, request: { hosts: 50, prefix: 26, room: 0 } }];
        expect(canPlace(placed, 0, 64, 256)).toBe(true);
        expect(canPlace(placed, 64, 32, 256)).toBe(false);
        expect(canPlace(placed, 32, 64, 256)).toBe(false); // not aligned
        expect(canPlace(placed, 128, 128, 256)).toBe(true);
        expect(canPlace(placed, 192, 128, 256)).toBe(false); // outside
        expect(freeStarts(placed, 64, 256)).toEqual([0, 128, 192]);
    });

    it("labels", () => {
        const lv = { base: (192 << 24 | 168 << 16 | 5 << 8) >>> 0, capacity: 256 };
        expect(blockLabel(lv, 64, 64)).toBe("192.168.5.64/26");
        expect(blockBroadcast(lv, 64, 64)).toBe("192.168.5.127");
    });

    it("scoring", () => {
        expect(requestCredit({ placedPrefix: 26, minPrefix: 26, tooSmallTries: 0 })).toBe(1);
        expect(requestCredit({ placedPrefix: 25, minPrefix: 26, tooSmallTries: 0 })).toBe(0.5);
        expect(requestCredit({ placedPrefix: 26, minPrefix: 26, tooSmallTries: 1 })).toBe(0.5);
        expect(requestCredit({ placedPrefix: null, minPrefix: 26, tooSmallTries: 0 })).toBe(0);
        expect(vlsmScore(TOTAL_REQUESTS)).toBe(100);
    });

    it("every level fits its address block and is solvable in any order", () => {
        for (let seed = 1; seed <= 300; seed++) {
            VLSM_LEVELS.forEach((spec, i) => {
                const lv = buildVlsmLevel(i, rng(seed * 17 + i), 14);
                expect(lv.base % lv.capacity, `L${i + 1} base aligned`).toBe(0);
                expect(lv.requests).toHaveLength(spec.prefixes.length);
                expect(lv.requests.reduce((n, r) => n + blockSize(r.prefix), 0)).toBeLessThanOrEqual(lv.capacity);
                const placed = [];
                for (const r of lv.requests) {
                    expect(minPrefixFor(r.hosts), `${r.hosts} hosts`).toBe(r.prefix);
                    const size = blockSize(r.prefix);
                    const start = smartStart(placed, size, lv.capacity);
                    expect(start, `L${i + 1}: no room for /${r.prefix}`).toBeDefined();
                    placed.push({ start, size, request: r });
                }
                expect(new Set(lv.requests.map((r) => r.room)).size).toBe(lv.requests.length);
            });
        }
    });
});
