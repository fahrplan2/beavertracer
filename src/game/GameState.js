//@ts-check
// The player's game progress — kept only in this browser's localStorage,
// never sent anywhere. Teachers learn about results solely through the
// completion codes students hand in (CompletionCode.js).

import { checksum, makeCode } from "./CompletionCode.js";
import { ALL_INTERMEZZOS, BADGES, TICKETS, totalXp } from "./GameCatalog.js";

const STORAGE_KEY = "bt.game";

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

/** All numbers a game id can have in a code. @param {string} id */
export function gameNo(id) {
    return ALL_INTERMEZZOS.find((g) => g.id === id)?.no ?? TICKETS.find((t) => t.id === id)?.no ?? 0;
}

/**
 * @typedef {{ xpBefore: number, xpAfter: number, newBest: boolean, code: string, newBadges: import("./GameCatalog.js").Badge[] }} RecordOutcome
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
     * Completion code for a finished game, from its best run.
     * @param {string} id
     * @returns {string|null}
     */
    codeFor(id) {
        const r = this.data.results[id];
        if (!r || !this.hasPlayer) return null;
        return makeCode({ gameNo: gameNo(id), score: r.best, name: this.data.name, date: new Date(r.day) });
    }

    /**
     * Records a finished intermezzo/ticket run. Only a better score replaces
     * the stored one (and its date, so the code shows when it was reached).
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
            code: this.codeFor(id) ?? "",
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

    // ── Moving to another PC ─────────────────────────────────────────

    /** A text block the student can paste on another PC. @returns {string} */
    exportSave() {
        const json = JSON.stringify(this.data);
        const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
        return `BTGAME1:${checksum(b64)}:${b64}`;
    }

    /**
     * @param {string} text from exportSave()
     * @returns {boolean} false if it isn't a save
     */
    importSave(text) {
        const m = String(text).replace(/\s/g, "").match(/^BTGAME1:([0-9a-f]{8}):([A-Za-z0-9+/=]+)$/);
        if (!m || checksum(m[2]) !== m[1]) return false;
        try {
            const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
            const data = sanitize(JSON.parse(new TextDecoder().decode(bytes)));
            if (!data.name) return false;
            this.data = data;
            this._save();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Arcade highscore (points) — separate from the 0–100 score that gives
     * XP and the completion code.
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
