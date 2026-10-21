//@ts-check
// Routing Rush — the playable view. Packets slide along the line towards
// the router; the student sends the front packet to an exit (keys 1–4 or
// click). Rules and level data: routingRush.js.
//
// Flow: intro → briefing (the level's routing table, untimed) → play →
// level cleared → briefing … → result with a review of every mistake.
// Practice mode: packets wait at the router instead of timing out, no
// lives are lost and nothing is recorded.

import { t } from "../i18n/index.js";
import { simAudio } from "../lib/SimAudio.js";
import { gameContent } from "./content.js";
import {
    LEVELS, LIVES, LEVEL_BONUS_PER_LIFE, TOTAL_PACKETS,
    buildLevel, longestPrefixMatch, matchingRoutes, multiplier, packetPoints, routeLabel, rushScore,
} from "./routingRush.js";
import { button, el, esc, icon, renderOutcome } from "./ui.js";

/**
 * @typedef {import("./routingRush.js").Level} Level
 * @typedef {import("./routingRush.js").Route} Route
 * @typedef {{ ip: string, exit: number, progress: number, x: number, el: HTMLElement }} LivePacket
 * @typedef {{ ip: string, chosen: number|null, routes: Route[], showMask: boolean, level: number }} Mistake  chosen null = timed out
 * @typedef {{ score: number, points: number, practice: boolean }} RushFinish
 */

const SOUND_KEY = "bt.game.sound";
const MAX_REVIEW = 10;
const QUEUE_GAP = 8;

/** @param {Route} r @param {string[]} rooms @param {string} internet */
function roomName(r, rooms, internet) {
    return r.room < 0 ? internet : rooms[r.room] ?? "";
}

export class RoutingRushView {
    /**
     * @param {HTMLElement} host
     * @param {{ title: string, onFinish: (score: number) => import("./GameState.js").RecordOutcome, onHighscore: (points: number) => { best: number, isNew: boolean }, onExit: () => void }} opts
     */
    constructor(host, opts) {
        this.host = host;
        this.opts = opts;
        this.tx = gameContent().games.routing;
        this.practice = false;
        /** @type {"intro"|"briefing"|"play"|"paused"|"cleared"|"over"} */
        this.state = "intro";
        this.levelIndex = 0;
        /** @type {Level|null} */
        this.level = null;
        this.lives = LIVES;
        this.points = 0;
        this.combo = 0;
        this.correct = 0;
        /** @type {Mistake[]} */
        this.mistakes = [];
        /** @type {LivePacket[]} */
        this.live = [];
        this.spawned = 0;
        this.spawnTimer = 0;
        this.rafId = 0;
        this.lastTs = 0;
        this.sound = false;
        /** @type {HTMLElement|null} */ this.hud = null;
        /** @type {HTMLElement|null} */ this.field = null;
        /** @type {HTMLElement|null} */ this.lane = null;
        /** @type {HTMLElement|null} */ this.exits = null;
        /** @type {HTMLElement|null} */ this.overlay = null;
        /** @type {HTMLElement|null} */ this.msg = null;
        /** @type {(() => void)|null} what Space/Enter does on the current overlay */
        this._overlayAction = null;
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

    // ── Screens ──────────────────────────────────────────────────────

    start() {
        this.state = "intro";
        const box = el("div", "game-play rr-intro");
        box.append(this._backBar());
        box.append(el("h3", "game-play-title", `${icon("fa-route")} ${esc(this.opts.title)}`));
        box.append(el("div", "game-intro-text", this.tx.intro));
        const actions = el("div", "game-actions game-actions--start");
        const play = button("game-btn game-btn-primary", `${icon("fa-play")} ${t("game.rr.play")}`);
        play.addEventListener("click", () => this._newGame(false));
        const practice = button("game-btn", `${icon("fa-person-chalkboard")} ${t("game.rr.practice")}`);
        practice.title = t("game.rr.practiceTitle");
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
        this.combo = 0;
        this.correct = 0;
        this.mistakes = [];
        this._buildPlayfield();
        this._briefing();
    }

    _buildPlayfield() {
        const root = el("div", "rr");
        this.hud = el("div", "rr-hud");
        this.field = el("div", "rr-field");
        this.lane = el("div", "rr-lane");
        this.lane.setAttribute("aria-hidden", "true");
        const router = el("div", "rr-router", `${icon("fa-arrows-split-up-and-left")}<span>${t("game.rr.router")}</span>`);
        this.exits = el("div", "rr-exits");
        this.exits.setAttribute("role", "group");
        this.exits.setAttribute("aria-label", t("game.rr.exits"));
        this.overlay = el("div", "rr-overlay");
        this.msg = el("div", "rr-msg");
        this.msg.setAttribute("aria-live", "polite");
        // The overlay covers only the track — the routing table below stays readable.
        const track = el("div", "rr-track");
        track.append(this.lane, router, this.overlay);
        this.field.append(track, this.exits);
        root.append(this._backBar(), this.hud, this.field, this.msg);
        this.host.replaceChildren(root);
    }

    _renderHud() {
        if (!this.hud) return;
        const hearts = this.practice
            ? `<span class="rr-practice">${icon("fa-person-chalkboard")} ${t("game.rr.practiceBadge")}</span>`
            : Array.from({ length: LIVES }, (_, i) => icon("fa-heart", i < this.lives ? "fa-solid" : "fa-regular")).join("");
        const mult = multiplier(this.combo);
        this.hud.innerHTML = `
            <span class="rr-level">${t("game.rr.level", { n: this.levelIndex + 1, total: LEVELS.length })}</span>
            <span class="rr-lives" aria-label="${esc(t("game.rr.livesLabel", { n: this.lives }))}">${hearts}</span>
            <span class="rr-points">${icon("fa-bolt")} ${this.points}</span>
            <span class="rr-combo${mult > 1 ? " is-hot" : ""}" title="${esc(t("game.rr.comboTitle"))}">×${mult}</span>`;
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

    _renderExits() {
        if (!this.exits || !this.level) return;
        const { routes, showMask } = this.level;
        this.exits.replaceChildren();
        routes.forEach((r, i) => {
            const b = button("rr-exit", `
                <kbd class="rr-key">${i + 1}</kbd>
                <span class="rr-exit-net">${routeLabel(r, showMask)}${r.prefix === 0 ? ` <span class="rr-default">${t("game.rr.default")}</span>` : ""}</span>
                <span class="rr-exit-room">eth${i} · ${esc(roomName(r, this.tx.rooms, this.tx.internet))}</span>`);
            b.dataset.exit = String(i);
            b.setAttribute("aria-label", t("game.rr.exitLabel", { n: i + 1, net: routeLabel(r, showMask) }));
            b.addEventListener("click", () => this._route(i));
            /** @type {HTMLElement} */ (this.exits).append(b);
        });
    }

    _briefing() {
        this.state = "briefing";
        this.level = buildLevel(this.levelIndex, Math.random, this.tx.rooms.length);
        this.live = [];
        this.spawned = 0;
        this.spawnTimer = 0;
        this.lane?.replaceChildren();
        this._renderHud();
        this._renderExits();
        this._setMsg("");
        const desc = this.tx.levels[this.levelIndex] ?? "";
        this._showOverlay(`
            <p class="rr-overlay-kicker">${t("game.rr.level", { n: this.levelIndex + 1, total: LEVELS.length })}</p>
            <p class="rr-overlay-title">${esc(desc)}</p>
            <p class="game-muted">${t("game.rr.briefing", { n: this.level.packets.length })}</p>`,
            t("game.rr.go"), () => this._play());
    }

    /** @param {string} html @param {string} [btnLabel] @param {() => void} [onBtn] */
    _showOverlay(html, btnLabel, onBtn) {
        if (!this.overlay) return;
        this.overlay.innerHTML = `<div class="rr-overlay-card">${html}</div>`;
        this.overlay.hidden = false;
        // The overlay only covers the line and router — the routing table stays readable.
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
        this._renderHud();
        this.lastTs = performance.now();
        this.spawnTimer = this.level?.spawnMs ?? 0; // first packet right away
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
        if (this.state !== "paused") return;
        this._play();
    }

    // ── Game loop ────────────────────────────────────────────────────

    /** @param {number} ts */
    _frame(ts) {
        if (this.state !== "play" || !this.level || !this.lane) return;
        const dt = Math.min(100, ts - this.lastTs);
        this.lastTs = ts;
        const level = this.level;

        // Spawn: on the interval, or at once when the line is empty — but only
        // once the last packet has moved far enough to make room (narrow
        // screens; practice mode, where packets wait at the router).
        this.spawnTimer += dt;
        const last = this.live[this.live.length - 1];
        const room = !last || last.x >= last.el.offsetWidth + QUEUE_GAP;
        if (this.spawned < level.packets.length && room && (this.spawnTimer >= level.spawnMs || this.live.length === 0)) {
            this.spawnTimer = 0;
            this._spawn(level.packets[this.spawned++]);
        }

        const laneW = this.lane.clientWidth;
        // Packets queue up behind each other instead of overlapping.
        let prevX = Infinity;
        for (const p of [...this.live]) {
            if (this.state !== "play") break;
            const w = p.el.offsetWidth;
            const maxX = Math.max(1, laneW - w);
            p.progress = Math.min(1, p.progress + dt / level.travelMs);
            const x = Math.max(0, Math.min(p.progress * maxX, prevX - w - QUEUE_GAP));
            p.progress = x / maxX;
            p.x = x;
            p.el.style.transform = `translateX(${Math.round(x)}px)`;
            prevX = x;
            if (p.progress >= 1 && !this.practice) this._resolve(p, null);
        }
        this._markFront();

        if (this.state === "play" && this.spawned === level.packets.length && this.live.length === 0) {
            this._levelCleared();
            return;
        }
        if (this.state === "play") this.rafId = requestAnimationFrame((t2) => this._frame(t2));
    }

    /** @param {{ ip: string, exit: number }} packet */
    _spawn(packet) {
        const pel = el("div", "rr-packet", `${icon("fa-envelope")}<span>${packet.ip}</span>`);
        this.lane?.append(pel);
        this.live.push({ ...packet, progress: 0, x: 0, el: pel });
    }

    _markFront() {
        this.live.forEach((p, i) => p.el.classList.toggle("is-front", i === 0));
    }

    /** @param {number} exit */
    _route(exit) {
        if (this.state !== "play" || !this.level) return;
        const front = this.live[0];
        if (!front || exit >= this.level.routes.length) return;
        this._resolve(front, exit);
    }

    /**
     * @param {LivePacket} p
     * @param {number|null} chosen null = reached the router without a decision
     */
    _resolve(p, chosen) {
        if (!this.level || this.state !== "play") return;
        this.live.splice(this.live.indexOf(p), 1);
        const ok = chosen === p.exit;
        const exitBtn = chosen !== null ? this.exits?.querySelector(`[data-exit="${chosen}"]`) : null;
        const rightBtn = this.exits?.querySelector(`[data-exit="${p.exit}"]`);
        if (ok) {
            const gained = packetPoints(this.levelIndex, p.progress, this.combo);
            this.points += gained;
            this.combo++;
            this.correct++;
            this._flash(exitBtn, "is-hit-ok");
            this._tone(true);
            this._setMsg(`${icon("fa-check")} +${gained}`, "is-ok");
        } else {
            this.combo = 0;
            if (!this.practice) this.lives--;
            this.mistakes.push({ ip: p.ip, chosen, routes: this.level.routes, showMask: this.level.showMask, level: this.levelIndex });
            this._flash(exitBtn, "is-hit-bad");
            this._flash(rightBtn, "is-hint");
            this._tone(false);
            const r = this.level.routes[p.exit];
            this._setMsg(chosen === null
                ? `${icon("fa-hourglass-end")} ${t("game.rr.timeout", { ip: p.ip, exit: p.exit + 1, net: routeLabel(r, this.level.showMask) })}`
                : `${icon("fa-xmark")} ${t("game.rr.wrongExit", { ip: p.ip, exit: p.exit + 1, net: routeLabel(r, this.level.showMask) })}`, "is-bad");
        }
        p.el.classList.remove("is-front");
        p.el.classList.add(ok ? "is-ok" : "is-bad");
        setTimeout(() => p.el.remove(), 350);
        this._renderHud();
        if (this.lives <= 0) this._gameOver();
    }

    /** @param {Element|null|undefined} target @param {string} cls */
    _flash(target, cls) {
        if (!target) return;
        target.classList.remove(cls);
        void /** @type {HTMLElement} */ (target).offsetWidth;
        target.classList.add(cls);
        setTimeout(() => target.classList.remove(cls), 700);
    }

    /** @param {boolean} ok */
    _tone(ok) {
        if (!this.sound) return;
        simAudio.tone(ok ? { freqs: [880, 1320], durationS: 0.07, level: 0.12, type: "triangle" } : { freqs: [180], durationS: 0.18, level: 0.15, type: "square" });
    }

    /** @param {string} html @param {string} [cls] */
    _setMsg(html, cls = "") {
        if (!this.msg) return;
        this.msg.className = "rr-msg " + cls;
        this.msg.innerHTML = html;
    }

    _levelCleared() {
        cancelAnimationFrame(this.rafId);
        const bonus = this.practice ? 0 : this.lives * LEVEL_BONUS_PER_LIFE;
        this.points += bonus;
        this._renderHud();
        if (this.levelIndex === LEVELS.length - 1) {
            this._finish(true);
            return;
        }
        this.state = "cleared";
        this._showOverlay(`
            <p class="rr-overlay-title">${icon("fa-flag-checkered")} ${t("game.rr.cleared", { n: this.levelIndex + 1 })}</p>
            ${bonus ? `<p>${t("game.rr.bonus", { points: bonus })}</p>` : ""}`,
            t("game.rr.nextLevel"), () => { this.levelIndex++; this._briefing(); });
    }

    _gameOver() {
        cancelAnimationFrame(this.rafId);
        this.state = "over";
        for (const p of this.live) p.el.classList.add("is-bad");
        this._finish(false);
    }

    // ── Result & review ──────────────────────────────────────────────

    /** @param {boolean} allLevels */
    _finish(allLevels) {
        this.state = "over";
        this.dispose();
        const score = rushScore(this.correct);
        const outcome = this.practice ? null : this.opts.onFinish(score);
        const high = this.practice ? null : this.opts.onHighscore(this.points);

        const box = el("div", "game-play rr-result");
        box.append(this._backBar());
        const headline = allLevels ? t("game.rr.victory") : t("game.rr.gameOver");
        const result = renderOutcome({
            title: esc(this.opts.title),
            score,
            detail: t("game.rr.detail", { correct: this.correct, total: TOTAL_PACKETS, level: this.levelIndex + 1 }),
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
        box.append(result);
        box.append(this._review());
        this.host.replaceChildren(box);
        hub.focus();
    }

    /** Re-attaches the listeners dispose() removed (playing again from the result). */
    _rearm() {
        this.dispose();
        window.addEventListener("keydown", this._onKey, true);
        document.addEventListener("visibilitychange", this._onVisibility);
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
            const right = longestPrefixMatch(m.ip, m.routes);
            const matching = matchingRoutes(m.ip, m.routes).map((i) => `<code>${routeLabel(m.routes[i], m.showMask)}</code>`);
            const yours = m.chosen === null
                ? t("game.rr.reviewTimeout")
                : t("game.rr.reviewChosen", { exit: m.chosen + 1, net: `<code>${routeLabel(m.routes[m.chosen], m.showMask)}</code>` });
            const why = matching.length > 1
                ? t("game.rr.reviewLongest", { list: matching.join(", "), net: matching[0] })
                : t("game.rr.reviewOnly", { net: matching[0] ?? "—" });
            list.append(el("li", "", `<strong><code>${m.ip}</code></strong> — ${yours}<br>
                <span class="game-muted">${why} → ${t("game.rr.reviewRight", { exit: right + 1 })}</span>`));
        }
        sec.append(list);
        if (this.mistakes.length > MAX_REVIEW) sec.append(el("p", "game-muted", t("game.rr.reviewMore", { n: this.mistakes.length - MAX_REVIEW })));
        sec.append(el("p", "game-muted game-small", t("game.rr.reviewTip")));
        return sec;
    }

    // ── Keyboard ─────────────────────────────────────────────────────

    /** @param {KeyboardEvent} ev */
    _key(ev) {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const target = /** @type {HTMLElement|null} */ (ev.target instanceof HTMLElement ? ev.target : null);
        if (target?.closest("input, textarea")) return;

        if (this.state === "play") {
            const n = Number(ev.key);
            if (n >= 1 && n <= 4) {
                ev.preventDefault();
                this._route(n - 1);
                return;
            }
            if (ev.key === "Escape" || ev.key === "p" || ev.key === "P" || ev.key === " ") {
                // Captured before the hub's own Escape handler: pause instead of closing.
                ev.preventDefault();
                ev.stopPropagation();
                this._pause();
            }
            return;
        }
        if ((this.state === "briefing" || this.state === "paused" || this.state === "cleared") && this._overlayAction) {
            if (ev.key === " " || ev.key === "Enter") {
                ev.preventDefault();
                ev.stopPropagation();
                this._overlayAction();
            } else if (ev.key === "Escape" && this.state === "paused") {
                // Escape while paused: leave the game (the hub closes as usual).
                this.dispose();
            }
        }
    }
}
