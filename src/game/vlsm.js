//@ts-check
// Address-space Tetris (VLSM) — the rules, without any DOM: levels with
// their address block and requests, block placement (alignment, overlap),
// and scoring. VlsmView.js draws it.
//
// Every level is solvable: all blocks are powers of two and their total
// fits the address block, so placing each one in the smallest free aligned
// gap (like a buddy allocator) always works. Placing carelessly can leave
// the free space so fragmented that a later block doesn't fit anywhere —
// that's the Tetris part.

import { hostCount, intToIp, ipToInt } from "../lib/quizGenerators.js";
import { randInt, shuffled } from "./minigames.js";

/**
 * @typedef {() => number} Rng
 * @typedef {{ hosts: number, prefix: number, room: number }} Request  prefix = the smallest network that fits
 * @typedef {{ start: number, size: number, request: Request }} Placed  start/size in addresses, relative to the block
 * @typedef {{ base: number, basePrefix: number, capacity: number, unit: number, requests: Request[], timeMs: number }} VlsmLevel
 */

export const LIVES = 3;

/**
 * @typedef {{ basePrefix: number, prefixes: number[], order: "desc"|"random", timeMs: number }} VlsmLevelSpec
 */

/** @type {VlsmLevelSpec[]} */
export const VLSM_LEVELS = [
    { basePrefix: 24, prefixes: [25, 26, 27], order: "desc", timeMs: 30000 },
    { basePrefix: 24, prefixes: [26, 26, 27, 28, 28], order: "desc", timeMs: 26000 },
    { basePrefix: 24, prefixes: [25, 27, 26, 28], order: "random", timeMs: 24000 },
    { basePrefix: 24, prefixes: [26, 27, 27, 28, 28, 29, 29], order: "random", timeMs: 22000 },
    { basePrefix: 23, prefixes: [24, 25, 26, 27, 27], order: "random", timeMs: 22000 },
    { basePrefix: 22, prefixes: [23, 25, 25, 26, 27, 27, 28], order: "random", timeMs: 20000 },
];

export const TOTAL_REQUESTS = VLSM_LEVELS.reduce((n, l) => n + l.prefixes.length, 0);

/** Addresses in a /p block. @param {number} p */
export function blockSize(p) {
    return 2 ** (32 - p);
}

/**
 * Smallest prefix whose network holds `hosts` devices (plus network and
 * broadcast address).
 * @param {number} hosts
 */
export function minPrefixFor(hosts) {
    let p = 30;
    while (p > 0 && hostCount(p) < hosts) p--;
    return p;
}

/**
 * @param {number} index
 * @param {Rng} rng
 * @param {number} roomCount
 * @returns {VlsmLevel}
 */
export function buildVlsmLevel(index, rng, roomCount) {
    const spec = VLSM_LEVELS[index];
    const capacity = blockSize(spec.basePrefix);
    const third = spec.basePrefix === 24 ? randInt(rng, 0, 255) : (capacity / 256) * randInt(rng, 0, 256 / (capacity / 256) - 1);
    const base = ipToInt(pick3(rng) + `.${third}.0`);
    const rooms = shuffled(rng, [...Array(roomCount).keys()]);
    const prefixes = spec.order === "desc" ? [...spec.prefixes].sort((a, b) => a - b) : shuffled(rng, spec.prefixes);
    const requests = prefixes.map((p, i) => ({
        // more than the next smaller network holds, at most what /p holds
        hosts: randInt(rng, hostCount(p + 1) + 1, hostCount(p)),
        prefix: p,
        room: rooms[i % rooms.length],
    }));
    return { base, basePrefix: spec.basePrefix, capacity, unit: blockSize(Math.max(...spec.prefixes)), requests, timeMs: spec.timeMs };
}

/** First two octets of a private network. @param {Rng} rng */
function pick3(rng) {
    const kind = randInt(rng, 0, 2);
    if (kind === 0) return "192.168";
    if (kind === 1) return `10.${randInt(rng, 0, 255)}`;
    return `172.${randInt(rng, 16, 31)}`;
}

/**
 * Can a block of `size` go at `start`? It must sit on a multiple of its own
 * size, stay inside the address block and not overlap anything placed.
 * @param {Placed[]} placed @param {number} start @param {number} size @param {number} capacity
 */
export function canPlace(placed, start, size, capacity) {
    if (start < 0 || start + size > capacity || start % size !== 0) return false;
    return placed.every((b) => start + size <= b.start || b.start + b.size <= start);
}

/** Every start where a block of `size` would fit. @param {Placed[]} placed @param {number} size @param {number} capacity */
export function freeStarts(placed, size, capacity) {
    /** @type {number[]} */
    const out = [];
    for (let s = 0; s + size <= capacity; s += size) if (canPlace(placed, s, size, capacity)) out.push(s);
    return out;
}

/** "192.168.5.64/26" for a block inside the level's address block. @param {VlsmLevel} level @param {number} start @param {number} size */
export function blockLabel(level, start, size) {
    return `${intToIp((level.base + start) >>> 0)}/${32 - Math.log2(size)}`;
}

/** Last address of the block (broadcast). @param {VlsmLevel} level @param {number} start @param {number} size */
export function blockBroadcast(level, start, size) {
    return intToIp((level.base + start + size - 1) >>> 0);
}

/**
 * Credit for one request: 1 = smallest fitting block on the first try,
 * 0.5 = too big (wasted addresses) or right only after a too-small try,
 * 0 = never placed.
 * @param {{ placedPrefix: number|null, minPrefix: number, tooSmallTries: number }} r
 */
export function requestCredit({ placedPrefix, minPrefix, tooSmallTries }) {
    if (placedPrefix === null) return 0;
    if (placedPrefix === minPrefix && tooSmallTries === 0) return 1;
    return 0.5;
}

/** 0–100 for XP and the completion code. @param {number} credit sum of requestCredit() */
export function vlsmScore(credit) {
    return Math.round((100 * credit) / TOTAL_REQUESTS);
}

/**
 * Arcade points for one placed block.
 * @param {number} levelIndex @param {number} timeLeft 0…1 @param {boolean} exact smallest fitting block
 */
export function placePoints(levelIndex, timeLeft, exact) {
    const base = 50 * (levelIndex + 1);
    return Math.round((exact ? base : base / 4) * (1 + Math.max(0, timeLeft)));
}
