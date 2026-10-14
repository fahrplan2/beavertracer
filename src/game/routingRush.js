//@ts-check
// Routing Rush — the rules, without any DOM: levels with their routing
// tables, the packets that arrive, longest prefix match and scoring.
// RoutingRushView.js draws and animates it.

import { intToIp, ipToInt, maskInt, prefixToMask } from "../lib/quizGenerators.js";
import { randInt, shuffled } from "./minigames.js";

/**
 * @typedef {() => number} Rng
 * @typedef {{ net: string, prefix: number, room: number }} Route  room: index into content rooms, -1 = internet (default route)
 * @typedef {{ ip: string, exit: number }} Packet  exit = index of the correct route (longest prefix match)
 * @typedef {{ routes: Route[], packets: Packet[], travelMs: number, spawnMs: number, showMask: boolean }} Level
 */

export const LIVES = 3;

/** @param {string} ip @param {Route} r */
export function routeMatches(ip, r) {
    return ((ipToInt(ip) & maskInt(r.prefix)) >>> 0) === ipToInt(r.net);
}

/**
 * Index of the route a router would pick: the longest matching prefix.
 * @param {string} ip @param {Route[]} routes
 * @returns {number} -1 if nothing matches
 */
export function longestPrefixMatch(ip, routes) {
    let best = -1;
    routes.forEach((r, i) => {
        if (routeMatches(ip, r) && (best < 0 || r.prefix > routes[best].prefix)) best = i;
    });
    return best;
}

/** All routes that match, longest first — for explaining a mistake. @param {string} ip @param {Route[]} routes */
export function matchingRoutes(ip, routes) {
    return routes.map((r, i) => ({ r, i })).filter(({ r }) => routeMatches(ip, r)).sort((a, b) => b.r.prefix - a.r.prefix).map(({ i }) => i);
}

/** "192.168.5.64/26" or, with masks shown, "192.168.5.64 255.255.255.192" @param {Route} r @param {boolean} showMask */
export function routeLabel(r, showMask) {
    return showMask && r.prefix > 0 ? `${r.net} ${prefixToMask(r.prefix)}` : `${r.net}/${r.prefix}`;
}

/**
 * Consecutive, correctly aligned blocks inside `baseInt`, biggest first
 * (so every block starts on a multiple of its size).
 * @param {number} baseInt @param {number[]} prefixes
 * @returns {{ net: string, prefix: number }[]}
 */
function pack(baseInt, prefixes) {
    let cursor = baseInt;
    return [...prefixes].sort((a, b) => a - b).map((p) => {
        const net = intToIp(cursor >>> 0);
        cursor += 2 ** (32 - p);
        return { net, prefix: p };
    });
}

/** @param {Rng} rng */
function publicIp(rng) {
    for (;;) {
        const a = randInt(rng, 11, 223);
        if (a === 127 || a === 172 || a === 192 || a === 100 || a === 169) continue;
        return `${a}.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`;
    }
}

/**
 * @typedef {{ packets: number, travelMs: number, spawnMs: number, showMask?: boolean, routes: (rng: Rng) => { net: string, prefix: number }[] }} LevelSpec
 */

/** @type {LevelSpec[]} */
export const LEVELS = [
    { packets: 6, travelMs: 10000, spawnMs: 3600, routes: (rng) => pack(ipToInt(`192.168.${randInt(rng, 0, 254)}.0`), [25, 25]) },
    { packets: 8, travelMs: 9500, spawnMs: 3300, routes: (rng) => pack(ipToInt(`192.168.${randInt(rng, 0, 254)}.0`), [26, 26, 26, 26]) },
    { packets: 8, travelMs: 9000, spawnMs: 3100, routes: (rng) => pack(ipToInt(`192.168.${randInt(rng, 0, 254)}.0`), [25, 26, 26]) },
    { packets: 10, travelMs: 8500, spawnMs: 2900, routes: (rng) => pack(ipToInt(`10.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}.0`), [25, 26, 27, 27]) },
    { packets: 10, travelMs: 8000, spawnMs: 2800, showMask: true, routes: (rng) => pack(ipToInt(`172.${randInt(rng, 16, 31)}.${randInt(rng, 0, 255)}.0`), [26, 26, 27, 27]) },
    { packets: 10, travelMs: 8000, spawnMs: 2700, routes: (rng) => pack(ipToInt(`10.${randInt(rng, 0, 255)}.${4 * randInt(rng, 0, 63)}.0`), [23, 24, 24]) },
    {
        packets: 10, travelMs: 7500, spawnMs: 2600,
        routes: (rng) => {
            const [c1, c2] = shuffled(rng, [10, 20, 30, 40, 50, 60]);
            return [
                { net: `192.168.${c1}.0`, prefix: 24 },
                { net: `192.168.${c2}.0`, prefix: 24 },
                { net: `10.${randInt(rng, 0, 255)}.0.0`, prefix: 16 },
                { net: "0.0.0.0", prefix: 0 },
            ];
        },
    },
    {
        packets: 12, travelMs: 7000, spawnMs: 2400,
        routes: (rng) => {
            const a = randInt(rng, 0, 255);
            const b = randInt(rng, 0, 255);
            return [
                { net: `10.${a}.0.0`, prefix: 16 },
                { net: `10.${a}.${b}.0`, prefix: 24 },
                { net: `10.${a}.${b}.128`, prefix: 25 },
                { net: "0.0.0.0", prefix: 0 },
            ];
        },
    },
];

export const TOTAL_PACKETS = LEVELS.reduce((n, l) => n + l.packets, 0);

/**
 * A destination IP whose longest prefix match is route `exit`.
 * @param {Rng} rng @param {Route[]} routes @param {number} exit
 */
function ipFor(rng, routes, exit) {
    const r = routes[exit];
    for (let tries = 0; tries < 200; tries++) {
        const ip = r.prefix === 0
            ? publicIp(rng)
            : intToIp((ipToInt(r.net) + randInt(rng, 1, 2 ** (32 - r.prefix) - 2)) >>> 0);
        if (longestPrefixMatch(ip, routes) === exit) return ip;
    }
    throw new Error(`no address for route ${r.net}/${r.prefix}`);
}

/**
 * Exits in ascending numerical order of their network address (same
 * address: shorter prefix first). The default route goes last — it is the
 * catch-all, not "the smallest network".
 * @template {{ net: string, prefix: number }} R
 * @param {R[]} routes
 * @returns {R[]}
 */
export function sortRoutes(routes) {
    return [...routes].sort((a, b) =>
        (a.prefix === 0 ? 1 : 0) - (b.prefix === 0 ? 1 : 0) || ipToInt(a.net) - ipToInt(b.net) || a.prefix - b.prefix);
}

/**
 * @param {number} index 0-based
 * @param {Rng} rng
 * @param {number} roomCount how many room names the content offers
 * @returns {Level}
 */
export function buildLevel(index, rng, roomCount) {
    const spec = LEVELS[index];
    const rooms = shuffled(rng, [...Array(roomCount).keys()]);
    /** @type {Route[]} */
    const routes = sortRoutes(spec.routes(rng)).map((r, i) => ({ ...r, room: r.prefix === 0 ? -1 : rooms[i] }));
    // Every exit gets used: deal exits round-robin, then shuffle.
    const exits = shuffled(rng, [...Array(spec.packets).keys()].map((i) => i % routes.length));
    const packets = exits.map((exit) => ({ ip: ipFor(rng, routes, exit), exit }));
    return { routes, packets, travelMs: spec.travelMs, spawnMs: spec.spawnMs, showMask: !!spec.showMask };
}

/** Score multiplier for a streak of right decisions. @param {number} combo */
export function multiplier(combo) {
    return Math.min(4, 1 + Math.floor(combo / 4));
}

/**
 * Arcade points for one correctly routed packet.
 * @param {number} levelIndex @param {number} progress 0 (just arrived) … 1 (at the router) @param {number} combo streak before this packet
 */
export function packetPoints(levelIndex, progress, combo) {
    const base = 10 * (levelIndex + 1);
    const speed = Math.round(base * Math.max(0, 1 - progress));
    return (base + speed) * multiplier(combo);
}

/** Bonus for finishing a level, per life left. */
export const LEVEL_BONUS_PER_LIFE = 50;

/**
 * The 0–100 score for XP and the completion code: share of all packets of
 * the whole game that were routed correctly.
 * @param {number} correct
 */
export function rushScore(correct) {
    return Math.round((100 * correct) / TOTAL_PACKETS);
}

