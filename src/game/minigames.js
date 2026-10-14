//@ts-check
// Round generators for the quiz-style intermezzos. Pure functions (no DOM):
// each takes a random source and the language's texts (content/<lang>.js,
// games.<id>) and returns the rounds of one run, easy to hard. RoundGame
// renders them; the unit tests check the answers.

import { intToIp, ipToInt, prefixToMask, hostCount, networkOf, broadcastOf, toBin8 } from "../lib/quizGenerators.js";
import { fmt } from "./content.js";

/**
 * @typedef {() => number} Rng
 * @typedef {import("./content.js").GameContent["games"]} GameTexts
 * @typedef {{ kind: "choice", prompt: string, options: string[], answer: number, explain: string }} ChoiceRound
 * @typedef {{ kind: "input", prompt: string, answer: string, type: "num"|"ip"|"bin", unit?: string, explain: string }} InputRound
 * @typedef {{ kind: "bits", prompt: string, target: number, showSum: boolean, explain: string }} BitsRound
 * @typedef {ChoiceRound|InputRound|BitsRound} Round
 * @typedef {{ id: string, rounds: (rng: Rng, tx: GameTexts) => Round[] }} MiniGame
 */

// ── Helpers ──────────────────────────────────────────────────────────────

/** @param {Rng} rng @param {number} lo @param {number} hi inclusive */
export function randInt(rng, lo, hi) {
    return lo + Math.floor(rng() * (hi - lo + 1));
}

/** @template T @param {Rng} rng @param {T[]} arr @returns {T} */
export function pick(rng, arr) {
    return arr[randInt(rng, 0, arr.length - 1)];
}

/** @template T @param {Rng} rng @param {T[]} arr @returns {T[]} a shuffled copy */
export function shuffled(rng, arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * A choice round with the correct option shuffled in among the others.
 * @param {Rng} rng @param {string} prompt @param {string} correct @param {string[]} wrong @param {string} explain
 * @returns {ChoiceRound}
 */
function choice(rng, prompt, correct, wrong, explain) {
    const options = shuffled(rng, [correct, ...wrong.filter((w) => w !== correct)]);
    return { kind: "choice", prompt, options, answer: options.indexOf(correct), explain };
}

/**
 * Same as choice(), but the options keep their order (a fixed set of
 * categories the student sorts into).
 * @param {string} prompt @param {string[]} options @param {number} answer @param {string} explain
 * @returns {ChoiceRound}
 */
function categorize(prompt, options, answer, explain) {
    return { kind: "choice", prompt, options, answer, explain };
}

/** "178 = 128 + 32 + 16 + 2" @param {number} n @param {string} [allOff] */
export function binarySum(n, allOff = "0") {
    const parts = [128, 64, 32, 16, 8, 4, 2, 1].filter((v) => n & v);
    return parts.length ? `${n} = ${parts.join(" + ")}` : `0 = ${allOff}`;
}

/** "1011 0010" @param {number} n */
function bin8Spaced(n) {
    const b = toBin8(n);
    return `${b.slice(0, 4)} ${b.slice(4)}`;
}

/**
 * Compares an answer the student typed with the expected one.
 * Numbers may carry thousands separators, units or a decimal comma.
 * @param {"num"|"ip"|"bin"} type @param {string} given @param {string} expected
 */
export function answersMatch(type, given, expected) {
    const g = String(given ?? "").trim().toLowerCase();
    if (type === "num") {
        const num = (/** @type {string} */ s) => Number(s.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
        return g !== "" && /\d/.test(g) && Math.abs(num(g) - num(expected)) < 1e-9;
    }
    if (type === "bin") {
        const b = g.replace(/\s+/g, "");
        return /^[01]{1,8}$/.test(b) && b.padStart(8, "0") === expected;
    }
    const parts = g.split(".");
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
    return parts.map(Number).join(".") === expected;
}

// ── Binär-Blitz ──────────────────────────────────────────────────────────

/** @type {MiniGame} */
export const binaryGame = {
    id: "binary",
    rounds(rng, { binary: tx }) {
        /** @type {Round[]} */
        const rounds = [];
        for (const [lo, hi] of [[3, 15], [17, 63], [65, 254]]) {
            const target = randInt(rng, lo, hi);
            rounds.push({ kind: "bits", prompt: fmt(tx.set, { n: target }), target, showSum: true, explain: binarySum(target, tx.allOff) });
        }
        for (let i = 0; i < 3; i++) {
            const target = randInt(rng, 33, 254);
            rounds.push({ kind: "bits", prompt: fmt(tx.setBlind, { n: target }), target, showSum: false, explain: binarySum(target, tx.allOff) });
        }
        for (let i = 0; i < 2; i++) {
            const n = randInt(rng, 20, 250);
            rounds.push({ kind: "input", type: "num", prompt: fmt(tx.toDec, { bin: bin8Spaced(n) }), answer: String(n), explain: binarySum(n, tx.allOff) });
        }
        const n = pick(rng, [192, 168, 224, 240, 248, 252, 255, 172, 10, 127]);
        rounds.push({ kind: "input", type: "bin", prompt: fmt(tx.toBin, { n }), answer: toBin8(n), explain: `${binarySum(n, tx.allOff)} → <code>${bin8Spaced(n)}</code>` });
        const f = pick(rng, tx.facts);
        rounds.push(choice(rng, f.q, f.a, f.wrong, f.why));
        return rounds;
    },
};

// ── Masken-Training ──────────────────────────────────────────────────────

/** @param {Rng} rng */
function randomHost(rng) {
    return pick(rng, [
        () => `192.168.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`,
        () => `10.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`,
        () => `172.${randInt(rng, 16, 31)}.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`,
    ])();
}

/** @type {MiniGame} */
export const maskGame = {
    id: "mask",
    rounds(rng, { mask: tx }) {
        /** @type {Round[]} */
        const rounds = [];

        const p1 = randInt(rng, 25, 30);
        rounds.push(choice(rng, fmt(tx.qMask, { p: p1 }), prefixToMask(p1),
            [prefixToMask(p1 - 1), prefixToMask(p1 + 1 > 30 ? p1 - 2 : p1 + 1), prefixToMask(p1 - 8)],
            fmt(tx.eMask, { p: p1, mask: prefixToMask(p1) })));

        const p2 = randInt(rng, 17, 23);
        rounds.push({ kind: "input", type: "num", prompt: fmt(tx.qPrefix, { mask: prefixToMask(p2) }), answer: String(p2),
            explain: fmt(tx.ePrefix, { mask: prefixToMask(p2), p: p2 }) });

        const p3 = randInt(rng, 24, 29);
        rounds.push({ kind: "input", type: "num", prompt: fmt(tx.qHosts, { p: p3 }), answer: String(hostCount(p3)),
            explain: fmt(tx.eHosts, { p: p3, h: 32 - p3, n: hostCount(p3) }) });

        const need = randInt(rng, 5, 120);
        let fit = 30;
        while (hostCount(fit) < need) fit--;
        rounds.push(choice(rng, fmt(tx.qFit, { need }),
            `/${fit}`, [`/${fit + 1}`, `/${fit - 1}`, `/${fit + 2 > 30 ? fit - 2 : fit + 2}`],
            fmt(tx.eFit, { p: fit, n: hostCount(fit), p2: fit + 1, n2: hostCount(fit + 1) })));

        for (const what of ["net", "bc"]) {
            const ip = randomHost(rng);
            const p = randInt(rng, 25, 28);
            const net = networkOf(ip, p);
            const bc = broadcastOf(ip, p);
            const block = 2 ** (32 - p);
            rounds.push(what === "net"
                ? { kind: "input", type: "ip", prompt: fmt(tx.qNet, { cidr: `${ip}/${p}` }), answer: net,
                    explain: fmt(tx.eNet, { block, octet: ip.split(".")[3], start: net.split(".")[3], net }) }
                : { kind: "input", type: "ip", prompt: fmt(tx.qBc, { cidr: `${ip}/${p}` }), answer: bc,
                    explain: fmt(tx.eBc, { net, block, bc }) });
        }

        const pS = randInt(rng, 25, 28);
        const a = randomHost(rng);
        const size = 2 ** (32 - pS);
        const sameNet = rng() < 0.5;
        const base = ipToInt(networkOf(a, pS));
        const other = sameNet
            ? intToIp(base + randInt(rng, 1, size - 2))
            : intToIp((base + size + randInt(rng, 1, size - 2)) >>> 0);
        rounds.push(categorize(fmt(tx.qSame, { a: `${a}/${pS}`, b: `${other}/${pS}` }), [tx.yes, tx.no], sameNet ? 0 : 1,
            fmt(tx.eSame, { a, na: networkOf(a, pS), b: other, nb: networkOf(other, pS) })));

        const from = pick(rng, [16, 24]);
        const to = from + randInt(rng, 2, 4);
        rounds.push({ kind: "input", type: "num", prompt: fmt(tx.qCount, { to, from }), answer: String(2 ** (to - from)),
            explain: fmt(tx.eCount, { d: to - from, n: 2 ** (to - from) }) });

        const ipH = `${pick(rng, [10, 172])}.${randInt(rng, 16, 31)}.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`;
        const pH = randInt(rng, 18, 22);
        rounds.push({ kind: "input", type: "ip", prompt: fmt(tx.qProNet, { cidr: `${ipH}/${pH}` }), answer: networkOf(ipH, pH),
            explain: fmt(tx.eProNet, { block: 2 ** (24 - pH), net: networkOf(ipH, pH) }) });

        const ipB = ipH.replace(/\.\d+$/, ".9");
        const maskP = randInt(rng, 19, 22);
        rounds.push({ kind: "input", type: "ip", prompt: fmt(tx.qProBc, { cidr: `${ipB}/${maskP}` }), answer: broadcastOf(ipB, maskP),
            explain: fmt(tx.eProBc, { net: networkOf(ipB, maskP), mask: prefixToMask(maskP), bc: broadcastOf(ipB, maskP) }) });
        return rounds;
    },
};

// ── Wer darf rein? ───────────────────────────────────────────────────────

/** @type {MiniGame} */
export const accessGame = {
    id: "access",
    rounds(rng, { access: tx }) {
        return shuffled(rng, tx.items).slice(0, 10).map((it) =>
            categorize(it.text, tx.cats, it.cat, fmt(tx.explain, { cat: tx.cats[it.cat], why: it.why })));
    },
};

// ── Kabel oder Funk? ─────────────────────────────────────────────────────

/** @type {MiniGame} */
export const mediaGame = {
    id: "media",
    rounds(rng, { media: tx }) {
        return shuffled(rng, tx.items).slice(0, 10).map((it) => {
            if (it.set === "custom" && it.options) {
                const correct = it.options[it.answer];
                return choice(rng, it.text, correct, it.options.filter((_, i) => i !== it.answer), it.why);
            }
            return categorize(it.text, tx.sets[/** @type {"media"|"net"|"cabling"} */ (it.set)], it.answer, it.why);
        });
    },
};

// ── Leitungs-Labor ───────────────────────────────────────────────────────

/** @type {MiniGame} */
export const lineGame = {
    id: "line",
    rounds(rng, { line: tx }) {
        /** @type {Round[]} */
        const rounds = [];

        const m1 = pick(rng, [4, 8, 16, 64, 256]);
        const b1 = Math.log2(m1);
        rounds.push({ kind: "input", type: "num", unit: tx.units.bit, prompt: fmt(tx.qBits, { m: m1 }), answer: String(b1), explain: fmt(tx.eBits, { b: b1, m: m1 }) });

        for (let i = 0; i < 2; i++) {
            const baud = pick(rng, [1200, 2400, 4800, 9600]);
            const m = pick(rng, [2, 4, 8, 16]);
            const b = Math.log2(m);
            rounds.push({ kind: "input", type: "num", unit: tx.units.bps, prompt: fmt(tx.qRate, { baud, m }), answer: String(baud * b),
                explain: fmt(tx.eRate, { baud, b, rate: baud * b }) });
        }

        const rate = pick(rng, [9600, 19200, 38400]);
        const mR = pick(rng, [4, 16]);
        rounds.push({ kind: "input", type: "num", unit: tx.units.baud, prompt: fmt(tx.qBaud, { rate, m: mR }), answer: String(rate / Math.log2(mR)),
            explain: fmt(tx.eBaud, { rate, b: Math.log2(mR), baud: rate / Math.log2(mR) }) });

        for (let i = 0; i < 2; i++) {
            const [mb, r] = pick(rng, /** @type {[number, number][]} */ ([[50, 100], [25, 50], [100, 400], [250, 1000], [60, 16], [10, 16], [500, 1000], [30, 40]]));
            const secs = (mb * 8) / r;
            rounds.push({ kind: "input", type: "num", unit: tx.units.s, prompt: fmt(tx.qTime, { mb, rate: r }), answer: String(secs),
                explain: fmt(tx.eTime, { mb, mbit: mb * 8, rate: r, secs: String(secs).replace(".", tx.decimalSep) }) });
        }

        for (const it of shuffled(rng, tx.modeItems).slice(0, 2)) rounds.push(categorize(it.text, tx.modes, it.answer, it.why));
        for (const it of shuffled(rng, tx.nisItems).slice(0, 2)) rounds.push(categorize(it.text, tx.nis, it.answer, it.why));

        rounds.push(choice(rng, tx.bandwidth.q, tx.bandwidth.a, tx.bandwidth.wrong, tx.bandwidth.why));
        return rounds;
    },
};

/** @type {Record<string, MiniGame>} */
export const MINIGAMES = {
    binary: binaryGame,
    mask: maskGame,
    access: accessGame,
    media: mediaGame,
    line: lineGame,
};
