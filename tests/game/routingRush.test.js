import { describe, it, expect } from "vitest";
import { LEVELS, TOTAL_PACKETS, buildLevel, sortRoutes, longestPrefixMatch, matchingRoutes, multiplier, packetPoints, routeLabel, rushScore } from "../../src/game/routingRush.js";

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

describe("routing rush rules", () => {
    const routes = [
        { net: "10.1.0.0", prefix: 16, room: 0 },
        { net: "10.1.5.0", prefix: 24, room: 1 },
        { net: "10.1.5.128", prefix: 25, room: 2 },
        { net: "0.0.0.0", prefix: 0, room: -1 },
    ];

    it("longest prefix match", () => {
        expect(longestPrefixMatch("10.1.5.200", routes)).toBe(2);
        expect(longestPrefixMatch("10.1.5.20", routes)).toBe(1);
        expect(longestPrefixMatch("10.1.9.9", routes)).toBe(0);
        expect(longestPrefixMatch("8.8.8.8", routes)).toBe(3);
        expect(longestPrefixMatch("8.8.8.8", routes.slice(0, 3))).toBe(-1);
        expect(matchingRoutes("10.1.5.200", routes)).toEqual([2, 1, 0, 3]);
    });

    it("sorts exits ascending, default route last", () => {
        const sorted = sortRoutes([routes[3], routes[2], routes[0], routes[1], { net: "10.0.0.0", prefix: 24, room: 5 }]);
        expect(sorted.map((r) => `${r.net}/${r.prefix}`)).toEqual(["10.0.0.0/24", "10.1.0.0/16", "10.1.5.0/24", "10.1.5.128/25", "0.0.0.0/0"]);
    });

    it("labels", () => {
        expect(routeLabel(routes[2], false)).toBe("10.1.5.128/25");
        expect(routeLabel(routes[2], true)).toBe("10.1.5.128 255.255.255.128");
        expect(routeLabel(routes[3], true)).toBe("0.0.0.0/0");
    });

    it("scoring", () => {
        expect(multiplier(0)).toBe(1);
        expect(multiplier(4)).toBe(2);
        expect(multiplier(100)).toBe(4);
        expect(packetPoints(0, 0, 0)).toBe(20);
        expect(packetPoints(0, 1, 0)).toBe(10);
        expect(rushScore(TOTAL_PACKETS)).toBe(100);
        expect(rushScore(0)).toBe(0);
    });

    it("every level is solvable: packets match their exit, every exit is used, blocks are aligned", () => {
        for (let seed = 1; seed <= 300; seed++) {
            LEVELS.forEach((spec, i) => {
                const level = buildLevel(i, rng(seed * 31 + i), 8);
                expect(level.routes.length).toBeLessThanOrEqual(4);
                expect(level.packets).toHaveLength(spec.packets);
                for (const p of level.packets) expect(longestPrefixMatch(p.ip, level.routes), `L${i + 1} ${p.ip}`).toBe(p.exit);
                expect(new Set(level.packets.map((p) => p.exit)).size).toBe(level.routes.length);
                for (const r of level.routes) {
                    const n = r.net.split(".").reduce((a, o) => a * 256 + Number(o), 0);
                    expect(n % 2 ** (32 - r.prefix), `${r.net}/${r.prefix}`).toBe(0);
                }
                expect(level.spawnMs / level.travelMs).toBeGreaterThan(0.3);
                expect(level.routes, `L${i + 1} sorted`).toEqual(sortRoutes(level.routes));
            });
        }
    });
});
