//@ts-check
// Address-space Tetris — the playable view. Requests ("Staff room: 50
// devices") arrive one at a time; the student picks a block size (prefix),
// moves the block along the address space — it only snaps to valid
// boundaries — and drops it. Rules: vlsm.js.
//
// Keys: ←/→ move, ↑/↓ bigger/smaller block, Space/Enter drop, P/Esc pause.
// Mouse: hover moves, click drops. Touch: tap moves, the drop button drops.

import { t } from "../i18n/index.js";
import { simAudio } from "../lib/SimAudio.js";
import { gameContent } from "./content.js";
import {
    LIVES, TOTAL_REQUESTS, VLSM_LEVELS,
    blockBroadcast, blockLabel, blockSize, buildVlsmLevel, canPlace, freeStarts, placePoints, requestCredit, vlsmScore,
} from "./vlsm.js";
import { button, el, esc, icon, renderOutcome } from "./ui.js";

/**
 * @typedef {import("./vlsm.js").VlsmLevel} VlsmLevel
 * @typedef {import("./vlsm.js").Placed} Placed
 * @typedef {import("./vlsm.js").Request} Request
 * @typedef {{ kind: "small"|"waste"|"timeout"|"full", room: string, hosts: number, min: number, used?: number }} VlMistake
 */

const SOUND_KEY = "bt.game.sound";
const MAX_REVIEW = 10;
const LEVEL_BONUS_PER_LIFE = 100;

export class VlsmView {
    /**
     * @param {HTMLElement} host
     * @param {{ title: string, onFinish: (score: number) => import("./GameState.js").RecordOutcome, onHighscore: (points: number) => { best: number, isNew: boolean }, onExit: () => void }} opts
     */
    constructor(host, opts) {
        this.host = host;
        this.opts = opts;
        this.tx = gameContent().games.vlsm;
        this.practice = false;
        /** @type {"intro"|"briefing"|"play"|"paused"|"cleared"|"over"} */
        this.state = "intro";
        this.levelIndex = 0;
        /** @type {VlsmLevel|null} */
        this.level = null;
        /** @type {Placed[]} */
        this.placed = [];
        this.reqIndex = 0;
        this.prefix = 25;
        this.pos = 0;
        this.lives = LIVES;
        this.points = 0;
        this.credit = 0;
        this.tooSmallTries = 0;
        this.timeLeftMs = 0;
        /** @type {VlMistake[]} */
        this.mistakes = [];
        this.rafId = 0;
        this.lastTs = 0;
        /** @type {(() => void)|null} */
        this._overlayAction = null;
        /** @type {HTMLElement|null} */ this.hud = null;
        /** @type {HTMLElement|null} */ this.reqBox = null;
        /** @type {HTMLElement|null} */ this.sizes = null;
        /** @type {HTMLElement|null} */ this.board = null;
        /** @type {HTMLElement|null} */ this.overlay = null;
        /** @type {HTMLElement|null} */ this.msg = null;
        /** @type {HTMLElement|null} */ this.timerBar = null;
        this.sound = false;
        try { this.sound = localStorage.getItem(SOUND_KEY) === "1"; } catch { /* storage blocked */ }

        this._onKey = (/** @type {KeyboardEvent} */ ev) => this._key(ev);
        this._onVisibility = () => { if (document.hidden && this.state === "play") this._pause(); };
        window.addEventListener("keydown", this._onKey, true);
        document.addEventListener("visibilitychange", this._onVisibility);
    }

    dispose() {
        cancelAnimationFrame(this.rafId);
        window.removeEventListener("keydown", this._onKey, true);
        document.removeEventListener("visibilitychange", this._onVisibility);
    }

    _rearm() {
        this.dispose();
        window.addEventListener("keydown", this._onKey, true);
        document.addEventListener("visibilitychange", this._onVisibility);
    }

    get request() {
        return this.level?.requests[this.reqIndex] ?? null;
    }

    /** @param {number} room */
    _room(room) {
        return this.tx.rooms[room] ?? "";
    }

    // ── Screens ──────────────────────────────────────────────────────

    start() {
        this.state = "intro";
        const box = el("div", "game-play vl-intro");
        box.append(this._backBar());
        box.append(el("h3", "game-play-title", `${icon("fa-cubes-stacked")} ${esc(this.opts.title)}`));
        box.append(el("div", "game-intro-text", this.tx.intro));
        const actions = el("div", "game-actions game-actions--start");
        const play = button("game-btn game-btn-primary", `${icon("fa-play")} ${t("game.rr.play")}`);
        play.addEventListener("click", () => this._newGame(false));
        const practice = button("game-btn", `${icon("fa-person-chalkboard")} ${t("game.rr.practice")}`);
        practice.title = t("game.vl.practiceTitle");
        practice.addEventListener("click", () => this._newGame(true));
        actions.append(play, practice);
        box.append(actions);
        this.host.replaceChildren(box);
        play.focus();
    }

    _backBar() {
        const bar = el("div", "game-play-top");
        const back = button("game-btn game-btn-ghost", `${icon("fa-arrow-left")} ${t("game.play.toHub")}`);
        back.addEventListener("click", () => { this.dispose(); this.opts.onExit(); });
        bar.append(back);
        return bar;
    }

    /** @param {boolean} practice */
    _newGame(practice) {
        this.practice = practice;
        this.levelIndex = 0;
        this.lives = LIVES;
        this.points = 0;
        this.credit = 0;
        this.mistakes = [];
        const root = el("div", "vl");
        this.hud = el("div", "rr-hud");
        const stage = el("div", "vl-stage");
        this.reqBox = el("div", "vl-request");
        this.sizes = el("div", "vl-sizes");
        this.sizes.setAttribute("role", "group");
        this.sizes.setAttribute("aria-label", t("game.vl.sizes"));
        this.board = el("div", "vl-board");
        this.overlay = el("div", "rr-overlay");
        this.msg = el("div", "rr-msg");
        this.msg.setAttribute("aria-live", "polite");
        stage.append(this.reqBox, this.sizes, this.board, this.overlay);
        root.append(this._backBar(), this.hud, stage, this.msg);
        this.host.replaceChildren(root);
        this._briefing();
    }

    _briefing() {
        this.state = "briefing";
        this.level = buildVlsmLevel(this.levelIndex, Math.random, this.tx.rooms.length);
        this.placed = [];
        this.reqIndex = 0;
        this.prefix = this.level.basePrefix + 1;
        this._startRequest(false);
        this._setMsg("");
        const lv = this.level;
        this._showOverlay(`
            <p class="rr-overlay-kicker">${t("game.rr.level", { n: this.levelIndex + 1, total: VLSM_LEVELS.length })}</p>
            <p class="rr-overlay-title">${esc(this.tx.levels[this.levelIndex] ?? "")}</p>
            <p class="game-muted">${t("game.vl.briefing", { net: `<code>${blockLabel(lv, 0, lv.capacity)}</code>`, n: lv.requests.length })}</p>`,
            t("game.rr.go"), () => this._play());
    }

    /** @param {string} html @param {string} [btnLabel] @param {() => void} [onBtn] */
    _showOverlay(html, btnLabel, onBtn) {
        if (!this.overlay) return;
        this.overlay.innerHTML = `<div class="rr-overlay-card">${html}</div>`;
        this.overlay.hidden = false;
        if (btnLabel && onBtn) {
            const b = button("game-btn game-btn-primary", `${btnLabel} <kbd>␣</kbd>`);
            b.addEventListener("click", onBtn);
            this.overlay.firstElementChild?.append(b);
            this._overlayAction = onBtn;
            b.focus();
        } else {
            this._overlayAction = null;
        }
    }

    _hideOverlay() {
        if (this.overlay) this.overlay.hidden = true;
        this._overlayAction = null;
    }

    _play() {
        this.state = "play";
        this._hideOverlay();
        this._renderAll();
        this.lastTs = performance.now();
        cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame((ts) => this._frame(ts));
    }

    _pause() {
        if (this.state !== "play") return;
        this.state = "paused";
        cancelAnimationFrame(this.rafId);
        this._renderHud();
        this._showOverlay(`<p class="rr-overlay-title">${t("game.rr.paused")}</p>`, t("game.rr.resume"), () => this._resume());
    }

    _resume() {
        if (this.state === "paused") this._play();
    }

    /**
     * Shows the current request; ends the game if its smallest block no
     * longer fits anywhere.
     * @param {boolean} checkFit
     */
    _startRequest(checkFit) {
        const req = this.request;
        const lv = this.level;
        if (!req || !lv) return;
        this.tooSmallTries = 0;
        this.timeLeftMs = lv.timeMs;
        // No room left for even the smallest fitting block: the room goes
        // without a network (costs a life) and the next request follows.
        if (checkFit && freeStarts(this.placed, blockSize(req.prefix), lv.capacity).length === 0) {
            this.mistakes.push({ kind: "full", room: this._room(req.room), hosts: req.hosts, min: req.prefix });
            if (!this.practice) this.lives--;
            this._tone(false);
            this._setMsg(`${icon("fa-ban")} ${t("game.vl.noRoom", { room: esc(this._room(req.room)), prefix: req.prefix })}`, "is-bad");
            this._renderHud();
            if (this.lives <= 0) { this._gameOver(t("game.vl.full")); return; }
            this._nextRequest();
            return;
        }
        this.prefix = Math.min(30, Math.max(lv.basePrefix + 1, this.prefix));
        this._snapPos(this.pos);
        this._renderAll();
    }

    // ── Loop (only the request timer) ────────────────────────────────

    /** @param {number} ts */
    _frame(ts) {
        if (this.state !== "play") return;
        const dt = Math.min(100, ts - this.lastTs);
        this.lastTs = ts;
        if (!this.practice) {
            this.timeLeftMs -= dt;
            this._renderTimer();
            if (this.timeLeftMs <= 0) {
                this._timeout();
                if (this.state !== "play") return;
            }
        }
        this.rafId = requestAnimationFrame((t2) => this._frame(t2));
    }

    _timeout() {
        const req = this.request;
        if (!req) return;
        this.mistakes.push({ kind: "timeout", room: this._room(req.room), hosts: req.hosts, min: req.prefix });
        this.lives--;
        this._tone(false);
        this._setMsg(`${icon("fa-hourglass-end")} ${t("game.vl.timeout", { room: esc(this._room(req.room)) })}`, "is-bad");
        if (this.lives <= 0) { this._gameOver(t("game.rr.gameOver")); return; }
        this._nextRequest();
    }

    _nextRequest() {
        this.reqIndex++;
        if (!this.level || this.reqIndex >= this.level.requests.length) {
            this._levelCleared();
            return;
        }
        this._startRequest(true);
    }

    // ── Moving & dropping ────────────────────────────────────────────

    /** Moves the block to the aligned start nearest `addr`, preferring free spots. @param {number} addr */
    _snapPos(addr) {
        const lv = this.level;
        if (!lv) return;
        const size = blockSize(this.prefix);
        this.pos = Math.max(0, Math.min(lv.capacity - size, Math.floor(addr / size) * size));
    }

    /** @param {number} dir -1 = left, +1 = right */
    _move(dir) {
        const size = blockSize(this.prefix);
        this._snapPos(this.pos + dir * size);
        this._renderBoard();
    }

    /** @param {number} dir -1 = bigger block (shorter prefix), +1 = smaller */
    _resize(dir) {
        const lv = this.level;
        if (!lv) return;
        this.prefix = Math.min(30, Math.max(lv.basePrefix + 1, this.prefix + dir));
        this._snapPos(this.pos);
        this._renderSizes();
        this._renderBoard();
    }

    _drop() {
        const lv = this.level;
        const req = this.request;
        if (this.state !== "play" || !lv || !req) return;
        const size = blockSize(this.prefix);
        if (!canPlace(this.placed, this.pos, size, lv.capacity)) {
            this._setMsg(`${icon("fa-ban")} ${t("game.vl.occupied")}`, "is-bad");
            this._shake();
            return;
        }
        if (size - 2 < req.hosts) {
            this.tooSmallTries++;
            this.mistakes.push({ kind: "small", room: this._room(req.room), hosts: req.hosts, min: req.prefix, used: this.prefix });
            if (!this.practice) this.lives--;
            this._tone(false);
            this._shake();
            this._setMsg(`${icon("fa-xmark")} ${t("game.vl.tooSmall", { prefix: this.prefix, hosts: size - 2, need: req.hosts })}`, "is-bad");
            this._renderHud();
            if (this.lives <= 0) this._gameOver(t("game.rr.gameOver"));
            return;
        }
        const exact = this.prefix === req.prefix;
        this.placed.push({ start: this.pos, size, request: req });
        this.credit += requestCredit({ placedPrefix: this.prefix, minPrefix: req.prefix, tooSmallTries: this.tooSmallTries });
        const gained = this.practice ? 0 : placePoints(this.levelIndex, this.timeLeftMs / lv.timeMs, exact);
        this.points += gained;
        this._tone(exact);
        if (exact) {
            this._setMsg(`${icon("fa-check")} ${t("game.vl.placed", { net: blockLabel(lv, this.pos, size), bc: blockBroadcast(lv, this.pos, size) })}${gained ? ` +${gained}` : ""}`, "is-ok");
        } else {
            this.mistakes.push({ kind: "waste", room: this._room(req.room), hosts: req.hosts, min: req.prefix, used: this.prefix });
            this._setMsg(`${icon("fa-triangle-exclamation")} ${t("game.vl.waste", { prefix: this.prefix, waste: size - 2 - req.hosts, min: req.prefix })}`, "is-warn");
        }
        this._nextRequest();
    }

    _shake() {
        const ghost = this.board?.querySelector(".vl-ghost");
        if (!ghost) return;
        ghost.classList.remove("is-shake");
        void /** @type {HTMLElement} */ (ghost).offsetWidth;
        ghost.classList.add("is-shake");
    }

    /** @param {boolean} ok */
    _tone(ok) {
        if (!this.sound) return;
        simAudio.tone(ok ? { freqs: [660, 990], durationS: 0.08, level: 0.12, type: "triangle" } : { freqs: [180], durationS: 0.18, level: 0.15, type: "square" });
    }

    /** @param {string} html @param {string} [cls] */
    _setMsg(html, cls = "") {
        if (!this.msg) return;
        this.msg.className = "rr-msg " + cls;
        this.msg.innerHTML = html;
    }

    // ── Rendering ────────────────────────────────────────────────────

    _renderAll() {
        this._renderHud();
        this._renderRequest();
        this._renderSizes();
        this._renderBoard();
        this._renderTimer();
    }

    _renderHud() {
        if (!this.hud) return;
        const hearts = this.practice
            ? `<span class="rr-practice">${icon("fa-person-chalkboard")} ${t("game.rr.practiceBadge")}</span>`
            : Array.from({ length: LIVES }, (_, i) => icon("fa-heart", i < this.lives ? "fa-solid" : "fa-regular")).join("");
        this.hud.innerHTML = `
            <span class="rr-level">${t("game.rr.level", { n: this.levelIndex + 1, total: VLSM_LEVELS.length })}</span>
            <span class="rr-lives" aria-label="${esc(t("game.rr.livesLabel", { n: this.lives }))}">${hearts}</span>
            <span class="rr-points">${icon("fa-bolt")} ${this.points}</span>`;
        const sound = button("rr-icon-btn", icon(this.sound ? "fa-volume-high" : "fa-volume-xmark"));
        sound.title = t(this.sound ? "game.rr.soundOff" : "game.rr.soundOn");
        sound.setAttribute("aria-label", sound.title);
        sound.addEventListener("click", () => {
            this.sound = !this.sound;
            try { localStorage.setItem(SOUND_KEY, this.sound ? "1" : "0"); } catch { /* storage blocked */ }
            if (this.sound) void simAudio.unlock();
            this._renderHud();
        });
        const pause = button("rr-icon-btn", icon(this.state === "paused" ? "fa-play" : "fa-pause"));
        pause.title = t("game.rr.pause");
        pause.setAttribute("aria-label", pause.title);
        pause.disabled = this.state !== "play" && this.state !== "paused";
        pause.addEventListener("click", () => (this.state === "paused" ? this._resume() : this._pause()));
        this.hud.append(sound, pause);
    }

    _renderRequest() {
        const box = this.reqBox;
        const lv = this.level;
        const req = this.request;
        if (!box || !lv || !req) return;
        const next = lv.requests.slice(this.reqIndex + 1, this.reqIndex + 3);
        box.innerHTML = `
            <div class="vl-request-main">
                <span class="vl-request-label">${t("game.vl.requestLabel", { n: this.reqIndex + 1, total: lv.requests.length })}</span>
                <span class="vl-request-text">${t("game.vl.request", { room: `<strong>${esc(this._room(req.room))}</strong>`, n: `<strong>${req.hosts}</strong>` })}</span>
                <span class="vl-timer"><span></span></span>
            </div>
            ${next.length ? `<div class="vl-request-next"><span class="game-muted">${t("game.vl.next")}</span>
                ${next.map((r) => `<span class="vl-next-item">${esc(this._room(r.room))}: ${r.hosts}</span>`).join("")}</div>` : ""}`;
        this.timerBar = /** @type {HTMLElement|null} */ (box.querySelector(".vl-timer > span"));
        if (this.practice) box.querySelector(".vl-timer")?.remove();
    }

    _renderTimer() {
        if (!this.timerBar || !this.level) return;
        const frac = Math.max(0, this.timeLeftMs / this.level.timeMs);
        this.timerBar.style.width = `${(frac * 100).toFixed(1)}%`;
        this.timerBar.classList.toggle("is-low", frac < 0.3);
    }

    _renderSizes() {
        const lv = this.level;
        if (!this.sizes || !lv) return;
        this.sizes.replaceChildren();
        this.sizes.append(el("span", "vl-sizes-label", t("game.vl.blockSize")));
        for (let p = lv.basePrefix + 1; p <= Math.min(30, lv.basePrefix + 8); p++) {
            const b = button("vl-size" + (p === this.prefix ? " is-active" : ""), `/${p}<small>${t("game.vl.addresses", { n: blockSize(p) })}</small>`);
            b.setAttribute("aria-pressed", String(p === this.prefix));
            b.addEventListener("click", () => {
                this.prefix = p;
                this._snapPos(this.pos);
                this._renderSizes();
                this._renderBoard();
            });
            this.sizes.append(b);
        }
        const drop = button("game-btn game-btn-primary game-btn-small vl-drop", `${icon("fa-arrow-down")} ${t("game.vl.drop")}`);
        drop.addEventListener("click", () => this._drop());
        this.sizes.append(drop);
    }

    _renderBoard() {
        const lv = this.level;
        const board = this.board;
        if (!lv || !board) return;
        const pct = (/** @type {number} */ n) => `${(100 * n) / lv.capacity}%`;
        const size = blockSize(this.prefix);
        const free = canPlace(this.placed, this.pos, size, lv.capacity);
        const req = this.request;

        board.replaceChildren();
        const ghostRow = el("div", "vl-ghost-row");
        if (req && (this.state === "play" || this.state === "briefing" || this.state === "paused")) {
            const ghost = el("div", "vl-ghost" + (free ? "" : " is-blocked"), `<span>/${this.prefix}</span>`);
            ghost.style.left = pct(this.pos);
            ghost.style.width = pct(size);
            ghostRow.append(ghost);
        }
        const strip = el("div", "vl-strip");
        strip.style.setProperty("--vl-unit", pct(lv.unit));
        // drop shadow of the block on the strip
        if (req && this.state === "play") {
            const shade = el("div", "vl-shade" + (free ? "" : " is-blocked"));
            shade.style.left = pct(this.pos);
            shade.style.width = pct(size);
            strip.append(shade);
        }
        for (const b of this.placed) {
            const exact = 32 - Math.log2(b.size) === b.request.prefix;
            const blk = el("div", "vl-block" + (exact ? "" : " is-waste"));
            blk.style.left = pct(b.start);
            blk.style.width = pct(b.size);
            blk.title = `${this._room(b.request.room)} — ${blockLabel(lv, b.start, b.size)} (${b.request.hosts}/${b.size - 2})`;
            const fill = el("span", "vl-fill");
            fill.style.width = `${(100 * (b.request.hosts + 2)) / b.size}%`;
            blk.append(fill, el("span", "vl-block-text", `<strong>${esc(this._room(b.request.room))}</strong><code>${blockLabel(lv, b.start, b.size)}</code>`));
            strip.append(blk);
        }
        strip.addEventListener("pointermove", (ev) => {
            if (this.state !== "play") return;
            const rect = strip.getBoundingClientRect();
            const addr = ((ev.clientX - rect.left) / rect.width) * lv.capacity;
            const before = this.pos;
            this._snapPos(addr);
            if (this.pos !== before) this._renderBoardKeepPointer();
        });
        strip.addEventListener("click", (ev) => {
            if (this.state !== "play") return;
            const rect = strip.getBoundingClientRect();
            this._snapPos(((ev.clientX - rect.left) / rect.width) * lv.capacity);
            // Mouse: click drops. Touch/pen: a tap only moves; the drop button drops.
            if (/** @type {PointerEvent} */ (ev).pointerType === "mouse" || /** @type {PointerEvent} */ (ev).pointerType === undefined) this._drop();
            else this._renderBoard();
        });
        const scale = el("div", "vl-scale");
        const step = Math.max(lv.unit, lv.capacity / 8);
        for (let a = 0; a <= lv.capacity; a += step) {
            const mark = el("span", "", a === lv.capacity ? "" : this._addrShort(lv, a));
            mark.style.left = pct(a);
            scale.append(mark);
        }
        board.append(ghostRow, strip, scale);
    }

    /** Re-renders on pointer moves without losing the strip's listeners mid-gesture. */
    _renderBoardKeepPointer() {
        const lv = this.level;
        if (!lv || !this.board) return;
        const size = blockSize(this.prefix);
        const free = canPlace(this.placed, this.pos, size, lv.capacity);
        const pct = (/** @type {number} */ n) => `${(100 * n) / lv.capacity}%`;
        for (const sel of [".vl-ghost", ".vl-shade"]) {
            const e = /** @type {HTMLElement|null} */ (this.board.querySelector(sel));
            if (!e) continue;
            e.style.left = pct(this.pos);
            e.style.width = pct(size);
            e.classList.toggle("is-blocked", !free);
        }
    }

    /** ".64" within a /24, "4.0" style for bigger blocks. @param {VlsmLevel} lv @param {number} a */
    _addrShort(lv, a) {
        const ip = blockLabel(lv, a, lv.unit).split("/")[0].split(".");
        return lv.basePrefix >= 24 ? `.${ip[3]}` : `.${ip[2]}.${ip[3]}`;
    }

    // ── Level end, game end ──────────────────────────────────────────

    _levelCleared() {
        cancelAnimationFrame(this.rafId);
        const bonus = this.practice ? 0 : this.lives * LEVEL_BONUS_PER_LIFE;
        this.points += bonus;
        this.state = "cleared";
        this._renderHud();
        this._renderBoard();
        if (this.levelIndex === VLSM_LEVELS.length - 1) {
            this._finish(t("game.vl.victory"));
            return;
        }
        const lv = /** @type {VlsmLevel} */ (this.level);
        const used = this.placed.reduce((n, b) => n + b.size, 0);
        this._showOverlay(`
            <p class="rr-overlay-title">${icon("fa-flag-checkered")} ${t("game.rr.cleared", { n: this.levelIndex + 1 })}</p>
            <p>${t("game.vl.usage", { used, total: lv.capacity })}</p>
            ${bonus ? `<p>${t("game.rr.bonus", { points: bonus })}</p>` : ""}`,
            t("game.rr.nextLevel"), () => { this.levelIndex++; this._briefing(); });
    }

    /** @param {string} headline */
    _gameOver(headline) {
        cancelAnimationFrame(this.rafId);
        this.state = "over";
        this._finish(headline);
    }

    /** @param {string} headline */
    _finish(headline) {
        this.state = "over";
        this.dispose();
        const score = vlsmScore(this.credit);
        const outcome = this.practice ? null : this.opts.onFinish(score);
        const high = this.practice ? null : this.opts.onHighscore(this.points);
        const box = el("div", "game-play rr-result");
        box.append(this._backBar());
        const result = renderOutcome({
            title: esc(this.opts.title),
            score,
            detail: t("game.vl.detail", { level: this.levelIndex + 1, total: VLSM_LEVELS.length }),
            outcome,
            headline,
        });
        result.append(el("p", "rr-arcade", `${icon("fa-bolt")} ${t("game.rr.points", { points: this.points })}${high
            ? ` · ${high.isNew ? `<strong>${t("game.rr.newHighscore")}</strong>` : t("game.rr.highscore", { points: high.best })}`
            : ""}`));
        const actions = el("div", "game-actions");
        const again = button("game-btn", `${icon("fa-rotate-right")} ${t("game.rr.again")}`);
        again.addEventListener("click", () => { this._rearm(); this._newGame(this.practice); });
        const hub = button("game-btn game-btn-primary", t("game.play.toHub"));
        hub.addEventListener("click", () => { this.dispose(); this.opts.onExit(); });
        actions.append(again, hub);
        result.append(actions);
        box.append(result, this._review());
        this.host.replaceChildren(box);
        hub.focus();
    }

    _review() {
        const sec = el("section", "rr-review");
        if (this.mistakes.length === 0) {
            sec.append(el("p", "game-muted", `${icon("fa-circle-check")} ${t("game.rr.noMistakes")}`));
            return sec;
        }
        sec.append(el("h4", "", `${icon("fa-magnifying-glass")} ${t("game.rr.reviewTitle")}`));
        const list = el("ol", "rr-review-list");
        for (const m of this.mistakes.slice(0, MAX_REVIEW)) {
            const what = t(`game.vl.review.${m.kind}`, { room: esc(m.room), hosts: m.hosts, used: m.used ?? "", min: m.min });
            const why = t("game.vl.review.why", { hosts: m.hosts, need: m.hosts + 2, size: blockSize(m.min), prefix: m.min });
            list.append(el("li", "", `${what}<br><span class="game-muted">${why}</span>`));
        }
        sec.append(list);
        if (this.mistakes.length > MAX_REVIEW) sec.append(el("p", "game-muted", t("game.rr.reviewMore", { n: this.mistakes.length - MAX_REVIEW })));
        sec.append(el("p", "game-muted game-small", t("game.vl.reviewTip")));
        return sec;
    }

    // ── Keyboard ─────────────────────────────────────────────────────

    /** @param {KeyboardEvent} ev */
    _key(ev) {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const target = /** @type {HTMLElement|null} */ (ev.target instanceof HTMLElement ? ev.target : null);
        if (target?.closest("input, textarea")) return;

        if (this.state === "play") {
            /** @type {Record<string, () => void>} */
            const actions = {
                ArrowLeft: () => this._move(-1),
                ArrowRight: () => this._move(1),
                ArrowUp: () => this._resize(-1),
                ArrowDown: () => this._resize(1),
                " ": () => this._drop(),
                Enter: () => this._drop(),
                Escape: () => this._pause(),
                p: () => this._pause(),
                P: () => this._pause(),
            };
            const fn = actions[ev.key];
            if (fn) {
                // Captured before the hub's own Escape handler: pause instead of closing.
                ev.preventDefault();
                ev.stopPropagation();
                fn();
            }
            return;
        }
        if ((this.state === "briefing" || this.state === "paused" || this.state === "cleared") && this._overlayAction) {
            if (ev.key === " " || ev.key === "Enter") {
                ev.preventDefault();
                ev.stopPropagation();
                this._overlayAction();
            } else if (ev.key === "Escape" && this.state === "paused") {
                this.dispose();
            }
        }
    }
}
