//@ts-check
// Radio Tuner — the rules, without any DOM: radio missions with a channel
// (bandwidth, noise), a target bit rate and a scenario that needs a
// certain transmission mode. RadioView.js draws it.
//
// Simplified on purpose (school level):
//   bit rate        = symbol rate × log2(levels)
//   max symbol rate = 2 × bandwidth (Nyquist) — with full duplex on one
//                     channel the bandwidth is split, so only 1 × bandwidth
//                     per direction
//   noise           allows at most a certain number of levels; more and
//                     symbols flip (bit errors)

/**
 * @typedef {"simplex"|"half"|"full"} Mode
 * @typedef {"mode"|"bandwidth"|"noise"|"slow"} RadioProblem
 * @typedef {{ bandwidthKhz: number, maxLevels: number, targetKbit: number, mode: Mode }} Mission
 * @typedef {{ mode: Mode|null, baud: number, levels: number }} Setting
 */

export const MODES = /** @type {Mode[]} */ (["simplex", "half", "full"]);
export const LEVEL_CHOICES = [2, 4, 8, 16, 32, 64];

/** @type {Mission[]} */
export const MISSIONS = [
    { bandwidthKhz: 2, maxLevels: 4, targetKbit: 6, mode: "simplex" },     // weather station → office
    { bandwidthKhz: 3, maxLevels: 8, targetKbit: 15, mode: "half" },       // caretakers' walkie-talkies
    { bandwidthKhz: 4, maxLevels: 16, targetKbit: 12, mode: "full" },      // school phone
    { bandwidthKhz: 1, maxLevels: 2, targetKbit: 2, mode: "simplex" },     // sensor in the noisy basement
    { bandwidthKhz: 20, maxLevels: 64, targetKbit: 200, mode: "simplex" }, // video link to the sports hall
    { bandwidthKhz: 10, maxLevels: 16, targetKbit: 36, mode: "full" },     // intercom at the entrance
];

/** Symbol-rate slider: 0 … 3 × bandwidth (kBd), in 1/20 of the bandwidth. @param {Mission} m */
export function baudRange(m) {
    const step = (m.bandwidthKhz * 1000) / 20;
    return { min: step, max: m.bandwidthKhz * 3000, step };
}

/** @param {number} levels */
export function bitsPerSymbol(levels) {
    return Math.log2(levels);
}

/** bit/s @param {Setting} s */
export function bitRate(s) {
    return s.baud * bitsPerSymbol(s.levels);
}

/** Highest symbol rate the channel carries in this mode. @param {Mission} m @param {Mode|null} mode */
export function maxBaud(m, mode) {
    return (mode === "full" ? 1 : 2) * m.bandwidthKhz * 1000;
}

/**
 * What goes wrong when sending with this setting — empty if it works.
 * @param {Mission} m @param {Setting} s
 * @returns {RadioProblem[]}
 */
export function sendProblems(m, s) {
    /** @type {RadioProblem[]} */
    const out = [];
    if (s.mode !== m.mode) out.push("mode");
    if (s.baud > maxBaud(m, s.mode)) out.push("bandwidth");
    if (s.levels > m.maxLevels) out.push("noise");
    if (bitRate(s) < m.targetKbit * 1000) out.push("slow");
    return out;
}

/**
 * A setting that works (for tests and the solution shown after giving up):
 * the fewest levels that reach the target at the highest allowed symbol rate.
 * @param {Mission} m @returns {Setting}
 */
export function solution(m) {
    const baud = maxBaud(m, m.mode);
    const levels = LEVEL_CHOICES.find((l) => l <= m.maxLevels && baud * bitsPerSymbol(l) >= m.targetKbit * 1000) ?? m.maxLevels;
    return { mode: m.mode, baud, levels };
}

/** 0–100 for one mission. @param {number} failedSends */
export function missionScore(failedSends) {
    return Math.max(40, 100 - 20 * failedSends);
}

/** The first bytes of a text as bits, "0101 0100 0111 …". @param {string} text @param {number} [bytes] */
export function textBits(text, bytes = 3) {
    return [...new TextEncoder().encode(text)].slice(0, bytes).map((b) => {
        const s = b.toString(2).padStart(8, "0");
        return `${s.slice(0, 4)} ${s.slice(4)}`;
    }).join("  ");
}
