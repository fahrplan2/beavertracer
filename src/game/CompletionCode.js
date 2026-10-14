//@ts-check
// Completion codes ("Abschlusscodes") for the game: a short code a student
// copies at the end of a mission or intermezzo and hands in. The teacher
// checks it together with the student's name — nothing is ever sent to a
// server.
//
// Layout (60 bits = 12 Crockford-Base32 chars, shown as XXXX-XXXX-XXXX):
//   game number  7 bit   (see GAME_NUMBERS in GameCatalog.js — never renumber)
//   score        7 bit   (0–100)
//   day         14 bit   (days since 2026-01-01, ~44 years)
//   signature   32 bit   (hash over secret, normalized name and the above)
//
// The signature binds the code to the name, so copying a classmate's code
// doesn't work. It is NOT tamper-proof: the secret ships with the app, so a
// student who reads the source can forge codes. Good enough for class.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U
const SECRET = "beavertracer-game-v1";
const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lowercase, without accents, spaces or punctuation — so "Jörg  Müller" and
 * "jorg muller" give the same code.
 * @param {string} name
 */
export function normalizeName(name) {
    return String(name)
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/ß/g, "ss")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

/**
 * 32-bit FNV-1a, run twice with different offsets and mixed — plenty for a
 * classroom checksum, and dependency-free.
 * @param {string} str
 * @returns {number}
 */
function hash32(str) {
    let a = 0x811c9dc5;
    let b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193) >>> 0;
        b = Math.imul(b ^ c ^ (a >>> 7), 0x5bd1e995) >>> 0;
    }
    return (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
}

/**
 * Checksum for other game data (e.g. the save export), with the same secret.
 * @param {string} str
 * @returns {string} 8 hex digits
 */
export function checksum(str) {
    return hash32(`${SECRET}|${str}`).toString(16).padStart(8, "0");
}

/** @param {number} gameNo @param {number} score @param {number} day @param {string} name */
function signature(gameNo, score, day, name) {
    return hash32(`${SECRET}|${normalizeName(name)}|${gameNo}|${score}|${day}`);
}

/** @param {Date} date @returns {number} */
export function dayNumber(date) {
    const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.max(0, Math.min(0x3fff, Math.round((utc - EPOCH_UTC) / DAY_MS)));
}

/** @param {number} day @returns {Date} */
function dateOfDay(day) {
    const d = new Date(EPOCH_UTC + day * DAY_MS);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * @param {{ gameNo: number, score: number, name: string, date?: Date }} opts
 * @returns {string} e.g. "7K2M-Q9XA-0B4T"
 */
export function makeCode({ gameNo, score, name, date = new Date() }) {
    const g = BigInt(gameNo & 0x7f);
    const s = BigInt(Math.max(0, Math.min(100, Math.round(score))));
    const d = dayNumber(date);
    const sig = BigInt(signature(Number(g), Number(s), d, name));
    let v = (g << 53n) | (s << 46n) | (BigInt(d) << 32n) | sig;
    let out = "";
    for (let i = 0; i < 12; i++) {
        out = ALPHABET[Number(v & 31n)] + out;
        v >>= 5n;
    }
    return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

/**
 * Reads a code back. Typing slips that Crockford Base32 forgives (O→0,
 * I/L→1, lowercase, missing dashes) are accepted.
 * @param {string} code
 * @returns {{ gameNo: number, score: number, day: number, date: Date, sig: number }|null} null = not a code at all
 */
export function decodeCode(code) {
    const clean = String(code).toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
    if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(clean)) return null;
    let v = 0n;
    for (const ch of clean) v = (v << 5n) | BigInt(ALPHABET.indexOf(ch));
    const gameNo = Number((v >> 53n) & 0x7fn);
    const score = Number((v >> 46n) & 0x7fn);
    const day = Number((v >> 32n) & 0x3fffn);
    const sig = Number(v & 0xffffffffn);
    return { gameNo, score, day, date: dateOfDay(day), sig };
}

/**
 * @param {string} code
 * @param {string} name the student's name as they entered it in the game
 * @returns {{ valid: boolean, gameNo?: number, score?: number, date?: Date }}
 */
export function verifyCode(code, name) {
    const decoded = decodeCode(code);
    if (!decoded || decoded.score > 100) return { valid: false };
    const ok = decoded.sig === signature(decoded.gameNo, decoded.score, decoded.day, name);
    return ok
        ? { valid: true, gameNo: decoded.gameNo, score: decoded.score, date: decoded.date }
        : { valid: false };
}
