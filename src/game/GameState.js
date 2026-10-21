//@ts-check
// The player's game progress — kept only in this browser's localStorage,
// never sent anywhere. Teachers learn about results solely through the
// save file (.btgames) students download and hand in.

import { BADGES, totalXp } from "./GameCatalog.js";

const STORAGE_KEY = "bt.game";
const FILE_FORMAT = "beavertracer-game";

/**
 * @typedef {{ best: number, day: number, noHints?: boolean }} GameResult  day = Date.getTime() of the best run
 * @typedef {{ v: 1, name: string, results: Record<string, GameResult>, course: Record<string, number>, high: Record<string, number> }} GameData  high = arcade highscores (points, not 0–100)
 * @typedef {{ getItem(k: string): string|null, setItem(k: string, v: string): void, removeItem(k: string): void }} StorageLike
 */

/** @returns {GameData} */
export function emptyData() {
    return { v: 1, name: "", results: {}, course: {}, high: {} };
}

/** @param {any} raw @returns {GameData} */
function sanitize(raw) {
    const data = emptyData();
    if (!raw || typeof raw !== "object") return data;
    if (typeof raw.name === "string") data.name = raw.name.slice(0, 60);
    for (const [id, r] of Object.entries(raw.results ?? {})) {
        const best = Number(/** @type {any} */ (r)?.best);
        const day = Number(/** @type {any} */ (r)?.day);
        if (!Number.isFinite(best) || best < 0 || best > 100) continue;
        data.results[id] = { best: Math.round(best), day: Number.isFinite(day) ? day : Date.now() };
        if (/** @type {any} */ (r)?.noHints) data.results[id].noHints = true;
    }
    for (const [k, v] of Object.entries(raw.course ?? {})) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n <= 50) data.course[k] = n;
    }
    for (const [k, v] of Object.entries(raw.high ?? {})) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) data.high[k] = Math.round(n);
    }
    return data;
}

/**
 * Reads a save file (.btgames). Used for loading it on another PC and for
 * the teacher view.
 * @param {string} text
 * @returns {{ data: GameData, exported: Date|null }|null} null = not a save file
 */
export function parseSaveFile(text) {
    try {
        const raw = JSON.parse(text);
        if (raw?.format !== FILE_FORMAT) return null;
        const data = sanitize(raw.game);
        if (!data.name) return null;
        const exported = new Date(raw.exported);
        return { data, exported: Number.isNaN(exported.getTime()) ? null : exported };
    } catch {
        return null;
    }
}

/**
 * @typedef {{ xpBefore: number, xpAfter: number, newBest: boolean, newBadges: import("./GameCatalog.js").Badge[] }} RecordOutcome
 */

export class GameState {
    /** @param {StorageLike|null} [storage] */
    constructor(storage) {
        /** @type {StorageLike|null} */
        this.storage = storage === undefined ? GameState._defaultStorage() : storage;
        /** @type {GameData} */
        this.data = this._load();
        /** @type {Set<() => void>} */
        this._listeners = new Set();
    }

    /** @returns {StorageLike|null} */
    static _defaultStorage() {
        try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
    }

    /** @returns {GameData} */
    _load() {
        try {
            const raw = this.storage?.getItem(STORAGE_KEY);
            return raw ? sanitize(JSON.parse(raw)) : emptyData();
        } catch {
            return emptyData();
        }
    }

    _save() {
        try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch { /* storage blocked — progress lasts this session */ }
        for (const fn of this._listeners) fn();
    }

    /** @param {() => void} fn @returns {() => void} unsubscribe */
    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    get name() { return this.data.name; }
    get hasPlayer() { return this.data.name.trim() !== ""; }
    get xp() { return totalXp(this.data); }

    /** @param {string} name */
    setName(name) {
        this.data.name = name.trim().slice(0, 60);
        this._save();
    }

    /** Wipes everything — "new player" on a shared school PC. */
    reset() {
        this.data = emptyData();
        try { this.storage?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        this._save();
    }

    /** @returns {import("./GameCatalog.js").Badge[]} */
    earnedBadges() {
        return BADGES.filter((b) => b.earned(this.data));
    }

    /**
     * Records a finished intermezzo/ticket run. Only a better score replaces
     * the stored one (and its date, so the save file shows when it was reached).
     * @param {string} id
     * @param {number} score 0–100
     * @param {{ noHints?: boolean }} [extra]
     * @returns {RecordOutcome}
     */
    record(id, score, extra = {}) {
        const xpBefore = this.xp;
        const badgesBefore = new Set(this.earnedBadges().map((b) => b.id));
        const s = Math.max(0, Math.min(100, Math.round(score)));
        const prev = this.data.results[id];
        const newBest = !prev || s > prev.best;
        if (newBest) this.data.results[id] = { best: s, day: Date.now(), ...(prev?.noHints ? { noHints: true } : {}) };
        if (extra.noHints) this.data.results[id].noHints = true;
        this._save();
        return {
            xpBefore,
            xpAfter: this.xp,
            newBest,
            newBadges: this.earnedBadges().filter((b) => !badgesBefore.has(b.id)),
        };
    }

    /**
     * XP for the regular course (quizzes, tasks): only the first evaluation
     * of each block counts, so retrying until it's right gives nothing extra.
     * @param {string} key unique per page + block
     * @param {number} xp
     * @returns {{ gained: number, newBadges: import("./GameCatalog.js").Badge[] }}
     */
    awardCourse(key, xp) {
        if (key in this.data.course) return { gained: 0, newBadges: [] };
        const badgesBefore = new Set(this.earnedBadges().map((b) => b.id));
        const gained = Math.max(0, Math.min(50, Math.round(xp)));
        this.data.course[key] = gained;
        this._save();
        return { gained, newBadges: this.earnedBadges().filter((b) => !badgesBefore.has(b.id)) };
    }

    // ── Save file: hand in to the teacher, move to another PC ────────

    /** Contents of the .btgames file. @returns {string} */
    exportFile() {
        return JSON.stringify({
            _info: "Game progress from BeaverTracer (Mission School Network). Teachers can open it in the game under \"For teachers\": https://beavertracer.eu/",
            format: FILE_FORMAT,
            v: 1,
            exported: new Date().toISOString(),
            game: this.data,
        }, null, 2);
    }

    /** e.g. "lena-schmidt.btgames" */
    fileName() {
        const slug = this.data.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").toLowerCase()
            .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        return `${slug || "game"}.btgames`;
    }

    /**
     * @param {string} text contents of a .btgames file
     * @returns {boolean} false if it isn't a save file
     */
    importFile(text) {
        const parsed = parseSaveFile(text);
        if (!parsed) return false;
        this.data = parsed.data;
        this._save();
        return true;
    }

    /**
     * Arcade highscore (points) — separate from the 0–100 score that gives
     * XP.
     * @param {string} id @param {number} points
     * @returns {{ best: number, isNew: boolean }}
     */
    recordHighscore(id, points) {
        const prev = this.data.high[id] ?? 0;
        const isNew = points > prev;
        if (isNew) {
            this.data.high[id] = Math.round(points);
            this._save();
        }
        return { best: Math.max(prev, Math.round(points)), isNew };
    }
}

/** The one shared instance used by the UI. */
export const gameState = new GameState();
