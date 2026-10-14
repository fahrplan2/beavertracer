//@ts-check
// Radio Tuner — the playable view. Per radio job: pick the transmission
// mode, set symbol rate and levels per symbol, watch the signal on the
// oscilloscope, then send. Too many levels for the noise make the levels
// overlap on screen; a symbol rate above what the bandwidth carries smears
// the steps — you can see what goes wrong before sending. Rules: radio.js.

import { t } from "../i18n/index.js";
import { simAudio } from "../lib/SimAudio.js";
import { gameContent } from "./content.js";
import { LEVEL_CHOICES, MISSIONS, MODES, baudRange, bitRate, bitsPerSymbol, maxBaud, missionScore, sendProblems, solution, textBits } from "./radio.js";
import { button, el, esc, icon, renderOutcome } from "./ui.js";

/**
 * @typedef {import("./radio.js").Mission} Mission
 * @typedef {import("./radio.js").Setting} Setting
 * @typedef {import("./radio.js").Mode} Mode
 * @typedef {{ mission: number, reasons: string[] }} RadioMistake
 */

const SOUND_KEY = "bt.game.sound";
const SCOPE_W = 400;
const SCOPE_H = 140;
const PAD = 12;
const FRAME_MS = 160;

/** @type {Record<Mode, string>} */
const MODE_ICONS = { simplex: "fa-arrow-right", half: "fa-right-left", full: "fa-arrows-left-right" };

/** "1.200" @param {number} n */
function num(n) {
    return n.toLocaleString(document.documentElement.lang || undefined);
}

/** "14,4 kbit/s" @param {number} bps */
function kbit(bps) {
    return `${(bps / 1000).toLocaleString(document.documentElement.lang || undefined, { maximumFractionDigits: 1 })} kbit/s`;
}

export class RadioView {
    /**
     * @param {HTMLElement} host
     * @param {{ title: string, onFinish: (score: number) => import("./GameState.js").RecordOutcome, onHighscore: (points: number) => { best: number, isNew: boolean }, onExit: () => void }} opts
     */
    constructor(host, opts) {
        this.host = host;
        this.opts = opts;
        this.tx = gameContent().games.radio;
        this.practice = false;
        /** @type {"intro"|"briefing"|"play"|"cleared"|"over"} */
        this.state = "intro";
        this.index = 0;
        /** @type {Setting} */
        this.setting = { mode: null, baud: 1000, levels: 2 };
        this.fails = 0;
        /** @type {number[]} */
        this.scores = [];
        this.points = 0;
        /** @type {RadioMistake[]} */
        this.mistakes = [];
        this.timer = 0;
        /** @type {(() => void)|null} */
        this._overlayAction = null;
        /** @type {HTMLElement|null} */ this.hud = null;
        /** @type {HTMLElement|null} */ this.chain = null;
        /** @type {HTMLElement|null} */ this.left = null;
        /** @type {HTMLElement|null} */ this.scope = null;
        /** @type {HTMLElement|null} */ this.footer = null;
        /** @type {HTMLElement|null} */ this.overlay = null;
        /** @type {HTMLElement|null} */ this.msg = null;
        this.sound = false;
        try { this.sound = localStorage.getItem(SOUND_KEY) === "1"; } catch { /* storage blocked */ }
        this.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
        this._onKey = (/** @type {KeyboardEvent} */ ev) => this._key(ev);
        window.addEventListener("keydown", this._onKey, true);
    }

    dispose() {
        clearInterval(this.timer);
        window.removeEventListener("keydown", this._onKey, true);
    }

    _rearm() {
        this.dispose();
        window.addEventListener("keydown", this._onKey, true);
    }

    get mission() {
        return MISSIONS[this.index];
    }

    get mtx() {
        return this.tx.missions[this.index];
    }

    // ── Screens ──────────────────────────────────────────────────────

    start() {
        this.state = "intro";
        const box = el("div", "game-play ft-intro");
        box.append(this._backBar());
        box.append(el("h3", "game-play-title", `${icon("fa-satellite-dish")} ${esc(this.opts.title)}`));
        box.append(el("div", "game-intro-text", this.tx.intro));
        const actions = el("div", "game-actions game-actions--start");
        const play = button("game-btn game-btn-primary", `${icon("fa-play")} ${t("game.rr.play")}`);
        play.addEventListener("click", () => this._newGame(false));
        const practice = button("game-btn", `${icon("fa-person-chalkboard")} ${t("game.rr.practice")}`);
        practice.title = t("game.ft.practiceTitle");
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
        this.index = 0;
        this.scores = [];
        this.points = 0;
        this.mistakes = [];
        const root = el("div", "ft");
        this.hud = el("div", "rr-hud");
        const board = el("div", "ft-board");
        this.chain = el("div", "ft-chain");
        this.left = el("div", "ft-left");
        const right = el("div", "ft-right");
        this.scope = el("div", "ft-scope");
        const sheet = el("details", "cp-sheet ft-sheet");
        sheet.innerHTML = `<summary>${icon("fa-file-lines")} ${t("game.cp.datasheet")}</summary><ul>${this.tx.sheet.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`;
        right.append(this.chain, this.scope, sheet);
        this.overlay = el("div", "rr-overlay");
        board.append(this.left, right, this.overlay);
        this.footer = el("div", "cp-footer");
        this.msg = el("div", "rr-msg cp-msg");
        this.msg.setAttribute("aria-live", "polite");
        root.append(this._backBar(), this.hud, board, this.footer, this.msg);
        this.host.replaceChildren(root);
        clearInterval(this.timer);
        if (!this.reducedMotion) this.timer = window.setInterval(() => this._drawScope(), FRAME_MS);
        this._briefing();
    }

    _briefing() {
        this.state = "briefing";
        const m = this.mission;
        const r = baudRange(m);
        this.setting = { mode: null, baud: Math.round(r.max / 3 / r.step) * r.step, levels: 2 };
        this.fails = 0;
        this._renderAll();
        this._setMsg("");
        this._showOverlay(`
            <p class="rr-overlay-kicker">${t("game.ft.mission", { n: this.index + 1, total: MISSIONS.length })}</p>
            <p class="rr-overlay-title">${esc(this.mtx.title)}</p>
            <p>${esc(this.mtx.desc)}</p>`,
            t("game.ft.tune"), () => this._play());
    }

    /** @param {string} html @param {string} [btnLabel] @param {() => void} [onBtn] */
    _showOverlay(html, btnLabel, onBtn) {
        if (!this.overlay) return;
        this.overlay.innerHTML = `<div class="rr-overlay-card">${html}</div>`;
        this.overlay.hidden = false;
        if (btnLabel && onBtn) {
            const b = button("game-btn game-btn-primary", `${btnLabel} <kbd>↵</kbd>`);
            b.addEventListener("click", onBtn);
            this.overlay.firstElementChild?.append(b);
            this._overlayAction = onBtn;
            b.focus();
        } else {
            this._overlayAction = null;
        }
    }

    _play() {
        this.state = "play";
        if (this.overlay) this.overlay.hidden = true;
        this._overlayAction = null;
        this._renderAll();
    }

    // ── Settings ─────────────────────────────────────────────────────

    /** @param {Mode} mode */
    _setMode(mode) {
        if (this.state !== "play") return;
        this.setting.mode = mode;
        this._renderAll();
    }

    /** @param {number} baud */
    _setBaud(baud) {
        if (this.state !== "play") return;
        const r = baudRange(this.mission);
        this.setting.baud = Math.min(r.max, Math.max(r.min, Math.round(baud / r.step) * r.step));
        this._renderControls(true);
        this._renderFormula();
        this._drawScope();
        this._renderFooter();
    }

    /** @param {number} levels */
    _setLevels(levels) {
        if (this.state !== "play") return;
        this.setting.levels = levels;
        this._renderAll();
    }

    _send() {
        if (this.state !== "play") return;
        if (!this.setting.mode) {
            this._setMsg(`${icon("fa-circle-info")} ${t("game.ft.chooseMode")}`, "is-bad");
            return;
        }
        const problems = sendProblems(this.mission, this.setting);
        if (problems.length === 0) {
            this._tone(true);
            const score = missionScore(this.fails);
            this.scores.push(score);
            if (!this.practice) this.points += score * 10;
            this.state = "cleared";
            this._renderHud();
            this._setMsg("");
            const last = this.index === MISSIONS.length - 1;
            this._showOverlay(`
                <p class="rr-overlay-title">${icon("fa-circle-check")} ${t("game.ft.received", { text: esc(this.mtx.text) })}</p>
                <p>${t("game.ft.rateSummary", { rate: kbit(bitRate(this.setting)), target: kbit(this.mission.targetKbit * 1000) })}</p>
                <p><strong>${t("game.cp.projectScore", { score })}</strong></p>`,
                last ? t("game.round.finish") : t("game.ft.nextMission"),
                () => (last ? this._finish() : (this.index++, this._briefing())));
            return;
        }
        this._tone(false);
        this.fails++;
        const reasons = problems.map((p) => this.tx.reasons[p]);
        this.mistakes.push({ mission: this.index, reasons });
        // After three misses, the data sheet opens by itself.
        if (this.fails >= 3) this.host.querySelector(".ft-sheet")?.setAttribute("open", "");
        this._setMsg(`${icon("fa-triangle-exclamation")} ${t("game.ft.garbled")}<ul class="cp-problems">${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`, "is-bad");
        this._renderHud();
    }

    // ── Rendering ────────────────────────────────────────────────────

    _renderAll() {
        this._renderHud();
        this._renderChain();
        this._renderControls(false);
        this._renderFormula();
        this._drawScope();
        this._renderFooter();
    }

    _renderHud() {
        if (!this.hud) return;
        this.hud.innerHTML = `
            <span class="rr-level">${t("game.ft.mission", { n: this.index + 1, total: MISSIONS.length })}</span>
            ${this.practice ? `<span class="rr-practice">${icon("fa-person-chalkboard")} ${t("game.rr.practiceBadge")}</span>` : ""}
            <span class="rr-points">${icon("fa-bolt")} ${this.points}</span>
            ${this.fails ? `<span class="game-muted">${t("game.ft.fails", { n: this.fails })}</span>` : ""}`;
        const sound = button("rr-icon-btn", icon(this.sound ? "fa-volume-high" : "fa-volume-xmark"));
        sound.title = t(this.sound ? "game.rr.soundOff" : "game.rr.soundOn");
        sound.setAttribute("aria-label", sound.title);
        sound.addEventListener("click", () => {
            this.sound = !this.sound;
            try { localStorage.setItem(SOUND_KEY, this.sound ? "1" : "0"); } catch { /* storage blocked */ }
            if (this.sound) void simAudio.unlock();
            this._renderHud();
        });
        this.hud.append(sound);
    }

    /** Information → message → signal. */
    _renderChain() {
        if (!this.chain) return;
        this.chain.innerHTML = `
            <div class="ft-step"><span class="ft-step-label">${esc(this.tx.info)}</span><span class="ft-step-value">„${esc(this.mtx.text)}“</span></div>
            <span class="ft-arrow">${icon("fa-arrow-right")}</span>
            <div class="ft-step"><span class="ft-step-label">${esc(this.tx.message)}</span><code class="ft-step-value">${textBits(this.mtx.text)} …</code></div>
            <span class="ft-arrow">${icon("fa-arrow-right")}</span>
            <div class="ft-step"><span class="ft-step-label">${esc(this.tx.signal)}</span><span class="ft-step-value">${icon("fa-wave-square")}</span></div>`;
    }

    /** @param {boolean} keepSlider re-rendering while dragging would drop the slider */
    _renderControls(keepSlider) {
        const box = this.left;
        const m = this.mission;
        if (!box) return;
        if (keepSlider) {
            const out = box.querySelector(".ft-baud-value");
            if (out) out.textContent = `${num(this.setting.baud)} Bd`;
            return;
        }
        const noise = m.maxLevels >= 32 ? "low" : m.maxLevels >= 8 ? "medium" : "high";
        box.innerHTML = `
            <div class="cp-card ft-card">
                <p class="cp-card-title">${esc(this.mtx.title)}</p>
                <p class="ft-desc">${esc(this.mtx.desc)}</p>
                <ul class="cp-chips">
                    <li>${icon("fa-arrows-left-right-to-line")} ${t("game.ft.bandwidth", { khz: num(m.bandwidthKhz) })}</li>
                    <li>${icon("fa-cloud-bolt")} ${t("game.ft.noise", { level: esc(this.tx.noise[noise]) })}</li>
                    <li>${icon("fa-flag-checkered")} ${t("game.ft.target", { rate: kbit(m.targetKbit * 1000) })}</li>
                </ul>
            </div>`;
        const modes = el("div", "ft-group");
        modes.append(el("span", "ft-group-label", t("game.ft.mode")));
        const modeRow = el("div", "ft-modes");
        MODES.forEach((mode, k) => {
            const b = button("cp-medium ft-mode" + (this.setting.mode === mode ? " is-active" : ""), `${icon(MODE_ICONS[mode])}<span>${esc(this.tx.modes[mode])}</span><kbd>${k + 1}</kbd>`);
            b.setAttribute("aria-pressed", String(this.setting.mode === mode));
            b.disabled = this.state !== "play";
            b.addEventListener("click", () => this._setMode(mode));
            modeRow.append(b);
        });
        modes.append(modeRow);

        const r = baudRange(m);
        const baud = el("div", "ft-group");
        baud.innerHTML = `<label class="ft-group-label" for="ft-baud">${t("game.ft.symbolRate")} <strong class="ft-baud-value">${num(this.setting.baud)} Bd</strong></label>`;
        const slider = /** @type {HTMLInputElement} */ (el("input", "ft-slider"));
        slider.type = "range";
        slider.id = "ft-baud";
        slider.min = String(r.min);
        slider.max = String(r.max);
        slider.step = String(r.step);
        slider.value = String(this.setting.baud);
        slider.disabled = this.state !== "play";
        slider.addEventListener("input", () => this._setBaud(Number(slider.value)));
        baud.append(slider);

        const levels = el("div", "ft-group");
        levels.append(el("span", "ft-group-label", t("game.ft.levels")));
        const lvRow = el("div", "ft-levels");
        for (const l of LEVEL_CHOICES) {
            const b = button("cp-area" + (this.setting.levels === l ? " is-active" : ""), `${l} <small>(${bitsPerSymbol(l)} Bit)</small>`);
            b.setAttribute("aria-pressed", String(this.setting.levels === l));
            b.disabled = this.state !== "play";
            b.addEventListener("click", () => this._setLevels(l));
            lvRow.append(b);
        }
        levels.append(lvRow);
        box.append(modes, baud, levels, el("p", "ft-formula"));
    }

    _renderFormula() {
        const f = this.left?.querySelector(".ft-formula");
        if (!f) return;
        const s = this.setting;
        const ok = bitRate(s) >= this.mission.targetKbit * 1000;
        f.innerHTML = `${t("game.ft.formula", { baud: num(s.baud), bits: bitsPerSymbol(s.levels), rate: `<strong class="${ok ? "is-ok" : ""}">${kbit(bitRate(s))}</strong>` })}`;
    }

    /**
     * The oscilloscope: random symbols at the chosen levels, passed through
     * a channel that can only follow so fast (bandwidth) and adds noise.
     */
    _drawScope() {
        const box = this.scope;
        if (!box) return;
        const m = this.mission;
        const s = this.setting;
        const limit = maxBaud(m, s.mode ?? "simplex");
        // The window always spans 12 symbols at the channel's own limit.
        const windowSec = 12 / limit;
        const symbols = Math.max(2, Math.round(s.baud * windowSec));
        const pxPerSymbol = (SCOPE_W - 2 * PAD) / symbols;
        // Didactic channel model, not physics: within the limit the signal
        // settles cleanly on each level; beyond it the steps smear more and
        // more. Noise is tuned so the allowed number of levels stays clearly
        // apart and the next one up visibly overlaps.
        const limitPx = (SCOPE_W - 2 * PAD) / 12;
        const over = s.baud / limit;
        const tau = (limitPx / 5) * (over > 1 ? 2 * over ** 3 : 1);
        const noiseAmp = 0.3 / Math.max(1, m.maxLevels - 1);
        const levelY = (/** @type {number} */ lv) => PAD + (1 - lv / Math.max(1, s.levels - 1)) * (SCOPE_H - 2 * PAD);
        let y = levelY(Math.floor(Math.random() * s.levels));
        let target = y;
        let points = "";
        for (let x = 0; x <= SCOPE_W - 2 * PAD; x += 2) {
            if (Math.floor(x / pxPerSymbol) !== Math.floor((x - 2) / pxPerSymbol) || x === 0) {
                target = levelY(Math.floor(Math.random() * s.levels));
            }
            y += (target - y) * (1 - Math.exp(-2 / tau));
            const noisy = y + (Math.random() * 2 - 1) * noiseAmp * (SCOPE_H - 2 * PAD);
            points += `${(PAD + x).toFixed(1)},${noisy.toFixed(1)} `;
        }
        const levelLines = s.levels <= 16
            ? Array.from({ length: s.levels }, (_, i) => `<line class="ft-level" x1="${PAD}" x2="${SCOPE_W - PAD}" y1="${levelY(i).toFixed(1)}" y2="${levelY(i).toFixed(1)}" />`).join("")
            : "";
        box.innerHTML = `<svg viewBox="0 0 ${SCOPE_W} ${SCOPE_H}" class="ft-svg" role="img" aria-label="${esc(t("game.ft.scopeLabel"))}">
            <rect class="ft-bg" x="0" y="0" width="${SCOPE_W}" height="${SCOPE_H}" rx="6" />
            ${levelLines}
            <polyline class="ft-trace" points="${points}" />
        </svg>`;
    }

    _renderFooter() {
        const footer = this.footer;
        if (!footer) return;
        footer.innerHTML = `<p class="game-muted game-small ft-hint">${t("game.ft.hint")}</p>`;
        const go = button("game-btn game-btn-primary", `${icon("fa-tower-broadcast")} ${t("game.ft.send")} <kbd>↵</kbd>`);
        go.disabled = this.state !== "play";
        go.addEventListener("click", () => this._send());
        footer.append(go);
    }

    /** @param {boolean} ok */
    _tone(ok) {
        if (!this.sound) return;
        simAudio.tone(ok ? { freqs: [660, 880, 1100], durationS: 0.08, level: 0.1, type: "triangle" } : { freqs: [180], durationS: 0.18, level: 0.13, type: "square", warbleHz: 30 });
    }

    /** @param {string} html @param {string} [cls] */
    _setMsg(html, cls = "") {
        if (!this.msg) return;
        this.msg.className = "rr-msg cp-msg " + cls;
        this.msg.innerHTML = html;
    }

    // ── Result ───────────────────────────────────────────────────────

    _finish() {
        this.state = "over";
        this.dispose();
        const score = Math.round(this.scores.reduce((a, b) => a + b, 0) / MISSIONS.length);
        const outcome = this.practice ? null : this.opts.onFinish(score);
        const high = this.practice ? null : this.opts.onHighscore(this.points);
        const box = el("div", "game-play rr-result");
        box.append(this._backBar());
        const result = renderOutcome({
            title: esc(this.opts.title),
            score,
            detail: t("game.ft.detail", { scores: this.scores.join(" · ") }),
            outcome,
            headline: t("game.ft.victory"),
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
        for (const m of this.mistakes.slice(0, 10)) {
            const sol = solution(MISSIONS[m.mission]);
            list.append(el("li", "", `<strong>${esc(this.tx.missions[m.mission].title)}</strong>: ${m.reasons.map(esc).join(" ")}<br>
                <span class="game-muted">${t("game.ft.solution", { mode: esc(this.tx.modes[/** @type {Mode} */ (sol.mode)]), baud: num(sol.baud), levels: sol.levels, rate: kbit(bitRate(sol)) })}</span>`));
        }
        sec.append(list);
        return sec;
    }

    // ── Keyboard ─────────────────────────────────────────────────────

    /** @param {KeyboardEvent} ev */
    _key(ev) {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const target = /** @type {HTMLElement|null} */ (ev.target instanceof HTMLElement ? ev.target : null);
        if (target?.closest("textarea, input:not([type=range])")) return;
        if (this.state === "play") {
            const n = Number(ev.key);
            const r = baudRange(this.mission);
            const li = LEVEL_CHOICES.indexOf(this.setting.levels);
            let handled = true;
            if (n >= 1 && n <= 3) this._setMode(MODES[n - 1]);
            else if (ev.key === "ArrowRight") this._setBaud(this.setting.baud + r.step);
            else if (ev.key === "ArrowLeft") this._setBaud(this.setting.baud - r.step);
            else if (ev.key === "ArrowUp") this._setLevels(LEVEL_CHOICES[Math.min(LEVEL_CHOICES.length - 1, li + 1)]);
            else if (ev.key === "ArrowDown") this._setLevels(LEVEL_CHOICES[Math.max(0, li - 1)]);
            else if (ev.key === "Enter" && !(target instanceof HTMLButtonElement)) this._send();
            else handled = false;
            if (handled) {
                ev.preventDefault();
                ev.stopPropagation();
                // keep the slider in sync after arrow keys
                const slider = /** @type {HTMLInputElement|null} */ (this.left?.querySelector(".ft-slider") ?? null);
                if (slider) slider.value = String(this.setting.baud);
            }
            return;
        }
        if ((this.state === "briefing" || this.state === "cleared") && this._overlayAction && (ev.key === "Enter" || ev.key === " ")) {
            ev.preventDefault();
            ev.stopPropagation();
            this._overlayAction();
        }
    }
}
