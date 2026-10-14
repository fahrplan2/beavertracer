//@ts-check
// Packet Belt (binary) — the rules, without any DOM: levels and their
// packets, scoring. BinaryBeltView.js draws it.
//
// "set" packets carry a decimal number; the student sets the 8 bit
// switches until the pattern matches — the packet is delivered at once.
// "read" packets carry a binary number; the student types it in decimal.

import { randInt, shuffled } from "./minigames.js";

/**
 * @typedef {() => number} Rng
 * @typedef {{ value: number, mode: "set"|"read" }} BeltPacket
 * @typedef {{ packets: BeltPacket[], travelMs: number, spawnMs: number, showSum: boolean }} BeltLevel
 * @typedef {{ count: number, travelMs: number, spawnMs: number, showSum: boolean, gen: (rng: Rng, i: number) => BeltPacket }} BeltLevelSpec
 */

export const BUFFER_SLOTS = 3;

/** The values a netmask octet can have. */
export const MASK_OCTETS = [128, 192, 224, 240, 248, 252, 254, 255];

/** @type {BeltLevelSpec[]} */
export const BELT_LEVELS = [
    { count: 8, travelMs: 14000, spawnMs: 5000, showSum: true, gen: (rng) => ({ value: randInt(rng, 3, 15), mode: "set" }) },
    { count: 8, travelMs: 13000, spawnMs: 4600, showSum: true, gen: (rng) => ({ value: randInt(rng, 16, 255), mode: "set" }) },
    { count: 10, travelMs: 12000, spawnMs: 4200, showSum: false, gen: (rng) => ({ value: randInt(rng, 1, 255), mode: "set" }) },
    { count: 8, travelMs: 15000, spawnMs: 5000, showSum: false, gen: (rng) => ({ value: randInt(rng, 1, 255), mode: "read" }) },
    { count: 10, travelMs: 11000, spawnMs: 3800, showSum: false, gen: (rng) => ({ value: MASK_OCTETS[randInt(rng, 0, MASK_OCTETS.length - 1)], mode: "set" }) },
    { count: 12, travelMs: 10000, spawnMs: 3500, showSum: false, gen: (rng, i) => ({ value: randInt(rng, 1, 255), mode: i % 3 === 2 ? "read" : "set" }) },
];

export const TOTAL_BELT_PACKETS = BELT_LEVELS.reduce((n, l) => n + l.count, 0);

/**
 * @param {number} index @param {Rng} rng
 * @returns {BeltLevel}
 */
export function buildBeltLevel(index, rng) {
    const spec = BELT_LEVELS[index];
    // The mixed level shuffles which packets are "read" ones.
    const packets = shuffled(rng, Array.from({ length: spec.count }, (_, i) => spec.gen(rng, i)));
    return { packets, travelMs: spec.travelMs, spawnMs: spec.spawnMs, showSum: spec.showSum };
}

/** "1011 0010" @param {number} n */
export function bin8(n) {
    const b = n.toString(2).padStart(8, "0");
    return `${b.slice(0, 4)} ${b.slice(4)}`;
}

/** Combo multiplier. @param {number} combo */
export function beltMultiplier(combo) {
    return Math.min(4, 1 + Math.floor(combo / 5));
}

/**
 * Points for a delivered packet.
 * @param {number} levelIndex @param {number} progress 0…1 along the belt @param {number} combo
 */
export function beltPoints(levelIndex, progress, combo) {
    const base = 10 * (levelIndex + 1);
    return (base + Math.round(base * Math.max(0, 1 - progress))) * beltMultiplier(combo);
}

/** 0–100 for XP and the completion code. @param {number} delivered */
export function beltScore(delivered) {
    return Math.round((100 * delivered) / TOTAL_BELT_PACKETS);
}
