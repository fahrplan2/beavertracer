//@ts-check
// Packet Belt — the playable view. Packets ride the belt towards the
// sorter. "set" packets: switch the 8 bits (keys 1–8, 0 clears) until the
// pattern matches — delivered at once. "read" packets: type the decimal
// value, Enter. Packets that reach the end go into the buffer; a full
// buffer ends the game. Rules: binaryBelt.js.

import { t } from "../i18n/index.js";
import { simAudio } from "../lib/SimAudio.js";
import { gameContent } from "./content.js";
import {
    BELT_LEVELS, BUFFER_SLOTS, TOTAL_BELT_PACKETS,
    beltMultiplier, beltPoints, beltScore, bin8, buildBeltLevel,
} from "./binaryBelt.js";
import { binarySum } from "./minigames.js";
import { button, el, esc, icon, renderOutcome } from "./ui.js";

/**
 * @typedef {import("./binaryBelt.js").BeltLevel} BeltLevel
 * @typedef {import("./binaryBelt.js").BeltPacket} BeltPacket
 * @typedef {BeltPacket & { progress: number, x: number, el: HTMLElement }} LiveBeltPacket
 * @typedef {{ value: number, mode: "set"|"read", typed?: string }} BeltMistake  typed set = wrong reading, else timed out
 */

const SOUND_KEY = "bt.game.sound";
const MAX_REVIEW = 10;
const QUEUE_GAP = 8;
const BITS = [128, 64, 32, 16, 8, 4, 2, 1];
const LEVEL_BONUS_PER_SLOT = 60;

export class BinaryBeltView {
    /**
     * @param {HTMLElement} host
     * @param {{ title: string, onFinish: (score: number) => import("./GameState.js").RecordOutcome, onHighscore: (points: number) => { best: number, isNew: boolean }, onExit: () => void }} opts
     */
    constructor(host, opts) {
        this.host = host;
        this.opts = opts;
        this.tx = gameContent().games.belt;
        this.practice = false;
        /** @type {"intro"|"briefing"|"play"|"paused"|"cleared"|"over"} */
        this.state = "intro";
        this.levelIndex = 0;
        /** @type {BeltLevel|null} */
        this.level = null;
        /** @type {LiveBeltPacket[]} */
        this.live = [];
        this.spawned = 0;
        this.spawnTimer = 0;
        this.buffer = 0;
        this.bits = 0;
        this.typed = "";
        this.points = 0;
        this.combo = 0;
        this.delivered = 0;
        /** @type {BeltMistake[]} */
        this.mistakes = [];
        this.rafId = 0;
        this.lastTs = 0;
        /** @type {(() => void)|null} */
        this._overlayAction = null;
        /** @type {HTMLElement|null} */ this.hud = null;
        /** @type {HTMLElement|null} */ this.lane = null;
        /** @type {HTMLElement|null} */ this.bufferBox = null;
        /** @type {HTMLElement|null} */ this.controls = null;
        /** @type {HTMLElement|null} */ this.overlay = null;
        /** @type {HTMLElement|null} */ this.msg = null;
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

    /** The packet the controls act on. */
    get front() {
        return this.live[0] ?? null;
    }

    // ── Screens ──────────────────────────────────────────────────────

    start() {
        this.state = "intro";
        const box = el("div", "game-play bb-intro");
        box.append(this._backBar());
        box.append(el("h3", "game-play-title", `${icon("fa-dolly")} ${esc(this.opts.title)}`));
        box.append(el("div", "game-intro-text", this.tx.intro));
        const actions = el("div", "game-actions game-actions--start");
        const play = button("game-btn game-btn-primary", `${icon("fa-play")} ${t("game.rr.play")}`);
        play.addEventListener("click", () => this._newGame(false));
        const practice = button("game-btn", `${icon("fa-person-chalkboard")} ${t("game.rr.practice")}`);
        practice.title = t("game.bb.practiceTitle");
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
        this.points = 0;
        this.combo = 0;
        this.delivered = 0;
        this.mistakes = [];
        const root = el("div", "rr bb");
        this.hud = el("div", "rr-hud");
        const field = el("div", "rr-field");
        const track = el("div", "rr-track");
        this.lane = el("div", "rr-lane bb-belt");
        this.lane.setAttribute("aria-hidden", "true");
        this.bufferBox = el("div", "bb-buffer");
        this.overlay = el("div", "rr-overlay");
        track.append(this.lane, this.bufferBox, this.overlay);
        this.controls = el("div", "bb-controls");
        field.append(track, this.controls);
        this.msg = el("div", "rr-msg");
        this.msg.setAttribute("aria-live", "polite");
        root.append(this._backBar(), this.hud, field, this.msg);
        this.host.replaceChildren(root);
        this._briefing();
    }

    _briefing() {
        this.state = "briefing";
        this.level = buildBeltLevel(this.levelIndex, Math.random);
        this.live = [];
        this.spawned = 0;
        this.spawnTimer = 0;
        this.buffer = 0;
        this.bits = 0;
        this.typed = "";
        this.lane?.replaceChildren();
        this._renderHud();
        this._renderBuffer();
        this._renderControls();
        this._setMsg("");
        this._showOverlay(`
            <p class="rr-overlay-kicker">${t("game.rr.level", { n: this.levelIndex + 1, total: BELT_LEVELS.length })}</p>
            <p class="rr-overlay-title">${esc(this.tx.levels[this.levelIndex] ?? "")}</p>
            <p class="game-muted">${t("game.bb.briefing", { n: this.level.packets.length })}</p>`,
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
        this._renderHud();
        this.lastTs = performance.now();
        this.spawnTimer = this.level?.spawnMs ?? 0;
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

    // ── Loop ─────────────────────────────────────────────────────────

    /** @param {number} ts */
    _frame(ts) {
        if (this.state !== "play" || !this.level || !this.lane) return;
        const dt = Math.min(100, ts - this.lastTs);
        this.lastTs = ts;
        const level = this.level;

        this.spawnTimer += dt;
        const last = this.live[this.live.length - 1];
        const room = !last || last.x >= last.el.offsetWidth + QUEUE_GAP;
        if (this.spawned < level.packets.length && room && (this.spawnTimer >= level.spawnMs || this.live.length === 0)) {
            this.spawnTimer = 0;
            this._spawn(level.packets[this.spawned++]);
        }

        const laneW = this.lane.clientWidth;
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
            if (p.progress >= 1 && !this.practice) this._toBuffer(p);
        }
        this._markFront();

        if (this.state === "play" && this.spawned === level.packets.length && this.live.length === 0) {
            this._levelCleared();
            return;
        }
        if (this.state === "play") this.rafId = requestAnimationFrame((t2) => this._frame(t2));
    }

    /** @param {BeltPacket} packet */
    _spawn(packet) {
        const label = packet.mode === "set"
            ? `<span class="bb-dec">${packet.value}</span>`
            : `<span class="bb-bin">${bin8(packet.value)}</span>`;
        const pel = el("div", `rr-packet bb-packet bb-packet--${packet.mode}`, `${icon(packet.mode === "set" ? "fa-box" : "fa-box-open")}${label}`);
        this.lane?.append(pel);
        this.live.push({ ...packet, progress: 0, x: 0, el: pel });
    }

    _markFront() {
        const front = this.front;
        this.live.forEach((p) => p.el.classList.toggle("is-front", p === front));
        const mode = front?.mode ?? "set";
        if (this.controls && this.controls.dataset.mode !== mode) this._renderControls();
    }

    /** @param {LiveBeltPacket} p */
    _toBuffer(p) {
        this._remove(p, "is-bad");
        this.buffer++;
        this.combo = 0;
        this.mistakes.push({ value: p.value, mode: p.mode });
        this._tone(false);
        this._setMsg(`${icon("fa-inbox")} ${t("game.bb.buffered", { value: p.mode === "set" ? p.value : bin8(p.value), answer: p.mode === "set" ? bin8(p.value) : p.value })}`, "is-bad");
        this._renderBuffer();
        this._renderHud();
        if (this.buffer >= BUFFER_SLOTS) this._gameOver();
    }

    /** @param {LiveBeltPacket} p @param {string} cls */
    _remove(p, cls) {
        this.live.splice(this.live.indexOf(p), 1);
        p.el.classList.remove("is-front");
        p.el.classList.add(cls);
        setTimeout(() => p.el.remove(), 350);
        this.bits = 0;
        this.typed = "";
        this._renderControls();
    }

    /** @param {LiveBeltPacket} p */
    _deliver(p) {
        const gained = this.practice ? 0 : beltPoints(this.levelIndex, p.progress, this.combo);
        this.points += gained;
        this.combo++;
        this.delivered++;
        this._remove(p, "is-ok");
        this._tone(true);
        this._setMsg(`${icon("fa-check")} ${p.mode === "set" ? `${p.value} = <code>${bin8(p.value)}</code>` : `<code>${bin8(p.value)}</code> = ${p.value}`}${gained ? ` +${gained}` : ""}`, "is-ok");
        this._renderHud();
    }

    // ── Input ────────────────────────────────────────────────────────

    /** @param {number} bitValue */
    _toggle(bitValue) {
        const p = this.front;
        if (this.state !== "play" || !p || p.mode !== "set") return;
        this.bits ^= bitValue;
        if (this.bits === p.value) this._deliver(p);
        else this._renderControls();
    }

    _clearBits() {
        this.bits = 0;
        this._renderControls();
    }

    /** @param {string} digit */
    _type(digit) {
        const p = this.front;
        if (this.state !== "play" || !p || p.mode !== "read" || this.typed.length >= 3) return;
        this.typed += digit;
        this._renderControls();
    }

    _backspace() {
        this.typed = this.typed.slice(0, -1);
        this._renderControls();
    }

    _submit() {
        const p = this.front;
        if (this.state !== "play" || !p || p.mode !== "read" || !this.typed) return;
        if (Number(this.typed) === p.value) {
            this._deliver(p);
            return;
        }
        this.mistakes.push({ value: p.value, mode: "read", typed: this.typed });
        this.combo = 0;
        this._tone(false);
        this._setMsg(`${icon("fa-xmark")} ${t("game.bb.wrongRead", { typed: esc(this.typed) })}`, "is-bad");
        this.typed = "";
        this._renderControls();
        this._renderHud();
        const display = this.controls?.querySelector(".bb-display");
        display?.classList.add("is-shake");
    }

    // ── Rendering ────────────────────────────────────────────────────

    _renderHud() {
        if (!this.hud) return;
        const mult = beltMultiplier(this.combo);
        this.hud.innerHTML = `
            <span class="rr-level">${t("game.rr.level", { n: this.levelIndex + 1, total: BELT_LEVELS.length })}</span>
            ${this.practice ? `<span class="rr-practice">${icon("fa-person-chalkboard")} ${t("game.rr.practiceBadge")}</span>` : ""}
            <span class="rr-points">${icon("fa-bolt")} ${this.points}</span>
            <span class="rr-combo${mult > 1 ? " is-hot" : ""}" title="${esc(t("game.bb.comboTitle"))}">×${mult}</span>`;
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

    _renderBuffer() {
        if (!this.bufferBox) return;
        const slots = Array.from({ length: BUFFER_SLOTS }, (_, i) => `<span class="bb-slot${i < this.buffer ? " is-full" : ""}">${i < this.buffer ? icon("fa-box") : ""}</span>`).join("");
        this.bufferBox.innerHTML = `${this.practice ? "" : `<span class="bb-slots">${slots}</span>`}<span class="bb-buffer-label">${icon("fa-inbox")} ${t("game.bb.buffer")}</span>`;
        this.bufferBox.title = t("game.bb.bufferTitle", { n: BUFFER_SLOTS });
    }

    _renderControls() {
        const box = this.controls;
        if (!box) return;
        const mode = this.front?.mode ?? "set";
        box.dataset.mode = mode;
        box.replaceChildren();
        if (mode === "set") {
            const row = el("div", "game-bits bb-bits");
            BITS.forEach((v, i) => {
                const on = (this.bits & v) !== 0;
                const b = button("game-bit" + (on ? " is-on" : ""), `<span class="game-bit-value">${v}</span><span class="game-bit-state">${on ? 1 : 0}</span><kbd class="bb-key">${i + 1}</kbd>`);
                b.setAttribute("aria-pressed", String(on));
                b.setAttribute("aria-label", t("game.bb.bitLabel", { value: v, key: i + 1 }));
                b.addEventListener("click", () => this._toggle(v));
                row.append(b);
            });
            box.append(row);
            const info = el("div", "bb-info");
            info.innerHTML = this.level?.showSum
                ? `<span>${t("game.bb.sum", { value: `<strong>${this.bits}</strong>` })}</span>`
                : `<span class="game-muted">${t("game.bb.setHint")}</span>`;
            const clear = button("game-btn game-btn-small", `${icon("fa-eraser")} ${t("game.bb.clear")} <kbd>0</kbd>`);
            clear.addEventListener("click", () => this._clearBits());
            info.append(clear);
            box.append(info);
        } else {
            const display = el("div", "bb-display", this.typed ? esc(this.typed) : `<span class="game-muted">${t("game.bb.typeHint")}</span>`);
            const pad = el("div", "bb-pad");
            for (const d of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]) {
                const b = button("bb-pad-key", d);
                b.addEventListener("click", () => this._type(d));
                pad.append(b);
            }
            const back = button("bb-pad-key", icon("fa-delete-left"));
            back.setAttribute("aria-label", t("game.bb.backspace"));
            back.addEventListener("click", () => this._backspace());
            const ok = button("bb-pad-key bb-pad-ok", `${icon("fa-check")}`);
            ok.setAttribute("aria-label", t("game.bb.submit"));
            ok.addEventListener("click", () => this._submit());
            pad.append(back, ok);
            box.append(display, pad);
        }
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

    // ── Level end, game end ──────────────────────────────────────────

    _levelCleared() {
        cancelAnimationFrame(this.rafId);
        const bonus = this.practice ? 0 : (BUFFER_SLOTS - this.buffer) * LEVEL_BONUS_PER_SLOT;
        this.points += bonus;
        this._renderHud();
        if (this.levelIndex === BELT_LEVELS.length - 1) {
            this._finish(t("game.bb.victory"));
            return;
        }
        this.state = "cleared";
        this._showOverlay(`
            <p class="rr-overlay-title">${icon("fa-flag-checkered")} ${t("game.rr.cleared", { n: this.levelIndex + 1 })}</p>
            ${bonus ? `<p>${t("game.bb.bonus", { points: bonus })}</p>` : ""}`,
            t("game.rr.nextLevel"), () => { this.levelIndex++; this._briefing(); });
    }

    _gameOver() {
        cancelAnimationFrame(this.rafId);
        this.state = "over";
        this._finish(t("game.bb.overflow"));
    }

    /** @param {string} headline */
    _finish(headline) {
        this.state = "over";
        this.dispose();
        const score = beltScore(this.delivered);
        const outcome = this.practice ? null : this.opts.onFinish(score);
        const high = this.practice ? null : this.opts.onHighscore(this.points);
        const box = el("div", "game-play rr-result");
        box.append(this._backBar());
        const result = renderOutcome({
            title: esc(this.opts.title),
            score,
            detail: t("game.bb.detail", { delivered: this.delivered, total: TOTAL_BELT_PACKETS, level: this.levelIndex + 1 }),
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
        const allOff = gameContent().games.binary.allOff;
        for (const m of this.mistakes.slice(0, MAX_REVIEW)) {
            const head = m.typed !== undefined
                ? t("game.bb.review.wrong", { bin: `<code>${bin8(m.value)}</code>`, typed: esc(m.typed) })
                : t(`game.bb.review.${m.mode}`, { value: m.mode === "set" ? m.value : `<code>${bin8(m.value)}</code>` });
            list.append(el("li", "", `${head}<br><span class="game-muted">${binarySum(m.value, allOff)} → <code>${bin8(m.value)}</code></span>`));
        }
        sec.append(list);
        if (this.mistakes.length > MAX_REVIEW) sec.append(el("p", "game-muted", t("game.rr.reviewMore", { n: this.mistakes.length - MAX_REVIEW })));
        sec.append(el("p", "game-muted game-small", t("game.bb.reviewTip")));
        return sec;
    }

    // ── Keyboard ─────────────────────────────────────────────────────

    /** @param {KeyboardEvent} ev */
    _key(ev) {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const target = /** @type {HTMLElement|null} */ (ev.target instanceof HTMLElement ? ev.target : null);
        if (target?.closest("input, textarea")) return;

        if (this.state === "play") {
            const mode = this.front?.mode ?? "set";
            let handled = true;
            if (ev.key === "Escape" || ev.key === "p" || ev.key === "P") this._pause();
            else if (mode === "set" && /^[1-8]$/.test(ev.key)) this._toggle(BITS[Number(ev.key) - 1]);
            else if (mode === "set" && (ev.key === "0" || ev.key === "Backspace")) this._clearBits();
            else if (mode === "read" && /^[0-9]$/.test(ev.key)) this._type(ev.key);
            else if (mode === "read" && ev.key === "Backspace") this._backspace();
            else if (mode === "read" && ev.key === "Enter") this._submit();
            else handled = false;
            if (handled) {
                // Captured before the hub's own Escape handler: pause instead of closing.
                ev.preventDefault();
                ev.stopPropagation();
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
