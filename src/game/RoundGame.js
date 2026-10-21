//@ts-check
// Plays one quiz-style intermezzo (see minigames.js) inside a host element:
// intro, rounds with instant feedback and an explanation after every
// answer, then the result with score and new badges.

import { t } from "../i18n/index.js";
import { answersMatch } from "./minigames.js";
import { gameContent } from "./content.js";
import { button, el, icon, renderOutcome } from "./ui.js";

/**
 * @typedef {import("./minigames.js").MiniGame} MiniGame
 * @typedef {import("./minigames.js").Round} Round
 * @typedef {import("./GameState.js").RecordOutcome} RecordOutcome
 */

const BITS = [128, 64, 32, 16, 8, 4, 2, 1];

export class RoundGame {
    /**
     * @param {HTMLElement} host
     * @param {{ title: string, icon: string, intro: string, game: MiniGame, onFinish: (score: number) => RecordOutcome, onExit: () => void }} opts
     */
    constructor(host, opts) {
        this.host = host;
        this.opts = opts;
        /** @type {Round[]} */
        this.rounds = [];
        this.index = 0;
        this.correct = 0;
        this.streak = 0;
    }

    start() {
        const { title, intro } = this.opts;
        const box = el("div", "game-play");
        box.append(this._topBar(false));
        const introBox = el("div", "game-intro");
        introBox.append(el("h3", "game-play-title", `${icon(this.opts.icon)} ${title}`));
        introBox.append(el("div", "game-intro-text", intro));
        const go = button("game-btn game-btn-primary", `${t("game.play.start")} ${icon("fa-arrow-right")}`);
        go.addEventListener("click", () => this._begin());
        introBox.append(go);
        box.append(introBox);
        this.host.replaceChildren(box);
        go.focus();
    }

    /** Nothing to clean up — the quiz has no timers. */
    dispose() {}

    _begin() {
        this.rounds = this.opts.game.rounds(Math.random, gameContent().games);
        this.index = 0;
        this.correct = 0;
        this.streak = 0;
        this._showRound();
    }

    /** @param {boolean} withProgress */
    _topBar(withProgress) {
        const bar = el("div", "game-play-top");
        const back = button("game-btn game-btn-ghost", `${icon("fa-arrow-left")} ${t("game.play.toHub")}`);
        back.addEventListener("click", () => this.opts.onExit());
        bar.append(back);
        if (withProgress) {
            const n = this.rounds.length;
            const progress = el("div", "game-progress");
            progress.setAttribute("role", "progressbar");
            progress.setAttribute("aria-valuemin", "0");
            progress.setAttribute("aria-valuemax", String(n));
            progress.setAttribute("aria-valuenow", String(this.index));
            for (let i = 0; i < n; i++) progress.append(el("span", "game-progress-dot" + (i < this.index ? " is-done" : i === this.index ? " is-current" : "")));
            bar.append(progress);
            bar.append(el("span", "game-round-label", t("game.round.label", { n: this.index + 1, total: n })));
            const streak = el("span", "game-streak" + (this.streak >= 2 ? " is-hot" : ""), `${icon("fa-fire")} ${this.streak}`);
            streak.title = t("game.round.streakTitle");
            bar.append(streak);
        }
        return bar;
    }

    _showRound() {
        const round = this.rounds[this.index];
        const box = el("div", "game-play");
        box.append(this._topBar(true));
        const card = el("div", "game-round");
        card.append(el("p", "game-prompt", round.prompt));
        const answer = el("div", "game-answer");
        card.append(answer);
        const feedback = el("div", "game-feedback");
        feedback.setAttribute("aria-live", "polite");
        card.append(feedback);
        box.append(card);
        this.host.replaceChildren(box);

        /** @param {boolean} ok @param {string} solution */
        const done = (ok, solution) => this._feedback(feedback, ok, solution, round.explain);

        if (round.kind === "choice") {
            const grid = el("div", "game-choices" + (round.options.length <= 3 ? " game-choices--few" : ""));
            round.options.forEach((opt, i) => {
                const b = button("game-choice", opt);
                b.addEventListener("click", () => {
                    grid.querySelectorAll("button").forEach((x) => { x.disabled = true; });
                    const ok = i === round.answer;
                    b.classList.add(ok ? "is-correct" : "is-wrong");
                    grid.children[round.answer]?.classList.add("is-correct");
                    done(ok, round.options[round.answer]);
                });
                grid.append(b);
            });
            answer.append(grid);
            /** @type {HTMLElement|null} */ (grid.querySelector("button"))?.focus();
        } else if (round.kind === "input") {
            const row = el("form", "game-input-row");
            const input = /** @type {HTMLInputElement} */ (el("input", "game-input"));
            input.type = "text";
            input.autocomplete = "off";
            input.spellcheck = false;
            input.inputMode = round.type === "ip" ? "decimal" : "numeric";
            input.placeholder = t(`game.round.placeholder.${round.type}`);
            input.setAttribute("aria-label", t("game.round.inputLabel"));
            row.append(input);
            if (round.unit) row.append(el("span", "game-unit", round.unit));
            const check = /** @type {HTMLButtonElement} */ (el("button", "game-btn game-btn-primary", t("game.round.check")));
            check.type = "submit";
            row.append(check);
            row.addEventListener("submit", (ev) => {
                ev.preventDefault();
                if (!input.value.trim()) return;
                input.disabled = true;
                check.disabled = true;
                const ok = answersMatch(round.type, input.value, round.answer);
                input.classList.add(ok ? "is-correct" : "is-wrong");
                done(ok, round.type === "bin" ? `${round.answer.slice(0, 4)} ${round.answer.slice(4)}` : round.answer + (round.unit ? ` ${round.unit}` : ""));
            });
            answer.append(row);
            input.focus();
        } else {
            let value = 0;
            const wrap = el("div", "game-bits");
            const sum = el("div", "game-bits-sum");
            const update = () => {
                sum.innerHTML = round.showSum
                    ? t("game.round.sum", { value: `<strong>${value}</strong>`, target: round.target })
                    : t("game.round.target", { target: `<strong>${round.target}</strong>` });
                sum.classList.toggle("is-match", round.showSum && value === round.target);
            };
            for (const v of BITS) {
                const b = button("game-bit", `<span class="game-bit-value">${v}</span><span class="game-bit-state">0</span>`);
                b.setAttribute("aria-pressed", "false");
                b.addEventListener("click", () => {
                    value ^= v;
                    const on = (value & v) !== 0;
                    b.classList.toggle("is-on", on);
                    b.setAttribute("aria-pressed", String(on));
                    /** @type {HTMLElement} */ (b.querySelector(".game-bit-state")).textContent = on ? "1" : "0";
                    update();
                });
                wrap.append(b);
            }
            update();
            const check = button("game-btn game-btn-primary", t("game.round.check"));
            check.addEventListener("click", () => {
                wrap.querySelectorAll("button").forEach((x) => { /** @type {HTMLButtonElement} */ (x).disabled = true; });
                check.disabled = true;
                const ok = value === round.target;
                wrap.classList.add(ok ? "is-correct" : "is-wrong");
                const bits = round.target.toString(2).padStart(8, "0");
                done(ok, `${bits.slice(0, 4)} ${bits.slice(4)}`);
            });
            answer.append(wrap, sum, check);
            /** @type {HTMLElement|null} */ (wrap.querySelector("button"))?.focus();
        }
    }

    /**
     * @param {HTMLElement} box @param {boolean} ok @param {string} solution @param {string} explain
     */
    _feedback(box, ok, solution, explain) {
        if (ok) { this.correct++; this.streak++; } else this.streak = 0;
        const streakText = ok && this.streak >= 3 ? ` <span class="game-streak-msg">${icon("fa-fire")} ${t("game.round.inARow", { n: this.streak })}</span>` : "";
        box.className = "game-feedback " + (ok ? "is-correct" : "is-wrong");
        box.innerHTML = ok
            ? `<p class="game-feedback-head">${icon("fa-circle-check")} ${t("game.round.correct")}${streakText}</p>`
            : `<p class="game-feedback-head">${icon("fa-circle-xmark")} ${t("game.round.wrong", { solution: `<strong>${solution}</strong>` })}</p>`;
        box.append(el("p", "game-explain", explain));
        const last = this.index === this.rounds.length - 1;
        const next = button("game-btn game-btn-primary", last
            ? `${t("game.round.finish")} ${icon("fa-flag-checkered")}`
            : `${t("game.round.next")} ${icon("fa-arrow-right")}`);
        next.addEventListener("click", () => {
            this.index++;
            if (last) this._finish();
            else this._showRound();
        });
        box.append(next);
        next.focus();
    }

    _finish() {
        const score = Math.round((100 * this.correct) / this.rounds.length);
        const outcome = this.opts.onFinish(score);
        const box = el("div", "game-play");
        box.append(this._topBar(false));
        const result = renderOutcome({
            title: this.opts.title,
            score,
            detail: t("game.round.detail", { correct: this.correct, total: this.rounds.length }),
            outcome,
        });
        const actions = el("div", "game-actions");
        const again = button("game-btn", `${icon("fa-rotate-right")} ${t("game.round.again")}`);
        again.addEventListener("click", () => this._begin());
        const hub = button("game-btn game-btn-primary", t("game.play.toHub"));
        hub.addEventListener("click", () => this.opts.onExit());
        actions.append(again, hub);
        result.append(actions);
        box.append(result);
        this.host.replaceChildren(box);
        hub.focus();
    }
}
