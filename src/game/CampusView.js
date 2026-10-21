//@ts-check
// Campus Planner — the playable view. A plan with sites and the links
// between them; for each link the student picks a medium (and, from
// project 3 on, the area of structured cabling for cables). Commissioning
// shows which links work; three attempts per project, and the result has
// to fit the budget. No clock — a calm planning game. Rules: campus.js.

import { t } from "../i18n/index.js";
import { simAudio } from "../lib/SimAudio.js";
import { gameContent } from "./content.js";
import {
    AREAS, BUILD_ATTEMPTS, CAMPUS_LEVELS, COST, MEDIA, WIRED,
    bestMedium, budget, commission, optimalCost, projectScore,
} from "./campus.js";
import { button, el, esc, icon, renderOutcome } from "./ui.js";

/**
 * @typedef {import("./campus.js").CampusLevel} CampusLevel
 * @typedef {import("./campus.js").Choice} Choice
 * @typedef {import("./campus.js").Medium} Medium
 * @typedef {import("./campus.js").Area} Area
 * @typedef {{ level: number, link: string, reason: string }} CampusMistake
 */

const SOUND_KEY = "bt.game.sound";
const MAX_REVIEW = 10;
const TEST_STEP_MS = 280;

/** @type {Record<Medium, string>} */
export const MEDIUM_ICONS = { tp: "fa-ethernet", fiber: "fa-lightbulb", wlan: "fa-wifi", lora: "fa-tower-broadcast", wan: "fa-globe" };

/** "1.250 €" in the page language. @param {number} n */
function euros(n) {
    return `${n.toLocaleString(document.documentElement.lang || undefined)} €`;
}

/** "12 km" / "450 m" @param {number} m */
function distance(m) {
    return m >= 1000 ? `${(m / 1000).toLocaleString(document.documentElement.lang || undefined)} km` : `${m} m`;
}

/** "100 Gbit/s" / "300 Mbit/s" / "1 kbit/s" @param {number} mbit */
function rate(mbit) {
    if (mbit >= 1000) return `${mbit / 1000} Gbit/s`;
    if (mbit >= 1) return `${mbit} Mbit/s`;
    return `${Math.round(mbit * 1000)} kbit/s`;
}

export class CampusView {
    /**
     * @param {HTMLElement} host
     * @param {{ title: string, onFinish: (score: number) => import("./GameState.js").RecordOutcome, onHighscore: (points: number) => { best: number, isNew: boolean }, onExit: () => void }} opts
     */
    constructor(host, opts) {
        this.host = host;
        this.opts = opts;
        this.tx = gameContent().games.campus;
        this.practice = false;
        /** @type {"intro"|"briefing"|"play"|"testing"|"cleared"|"over"} */
        this.state = "intro";
        this.levelIndex = 0;
        /** @type {CampusLevel|null} */
        this.level = null;
        /** @type {Choice[]} */
        this.choices = [];
        this.selected = 0;
        this.attempts = 0;
        /** @type {Set<number>} links that failed the last commissioning */
        this.failed = new Set();
        /** @type {number[]} */
        this.scores = [];
        this.points = 0;
        /** @type {CampusMistake[]} */
        this.mistakes = [];
        /** @type {(() => void)|null} */
        this._overlayAction = null;
        /** @type {HTMLElement|null} */ this.hud = null;
        /** @type {HTMLElement|null} */ this.map = null;
        /** @type {HTMLElement|null} */ this.panel = null;
        /** @type {HTMLElement|null} */ this.footer = null;
        /** @type {HTMLElement|null} */ this.overlay = null;
        /** @type {HTMLElement|null} */ this.msg = null;
        this.sound = false;
        try { this.sound = localStorage.getItem(SOUND_KEY) === "1"; } catch { /* storage blocked */ }
        this._onKey = (/** @type {KeyboardEvent} */ ev) => this._key(ev);
        window.addEventListener("keydown", this._onKey, true);
    }

    dispose() {
        window.removeEventListener("keydown", this._onKey, true);
        if (this.state === "testing") this.state = "over"; // stops a running commissioning
    }

    _rearm() {
        this.dispose();
        window.addEventListener("keydown", this._onKey, true);
    }

    get ltx() {
        return this.tx.levels[this.levelIndex];
    }

    // ── Screens ──────────────────────────────────────────────────────

    start() {
        this.state = "intro";
        const box = el("div", "game-play cp-intro");
        box.append(this._backBar());
        box.append(el("h3", "game-play-title", `${icon("fa-map-location-dot")} ${esc(this.opts.title)}`));
        box.append(el("div", "game-intro-text", this.tx.intro));
        const actions = el("div", "game-actions game-actions--start");
        const play = button("game-btn game-btn-primary", `${icon("fa-play")} ${t("game.rr.play")}`);
        play.addEventListener("click", () => this._newGame(false));
        const practice = button("game-btn", `${icon("fa-person-chalkboard")} ${t("game.rr.practice")}`);
        practice.title = t("game.cp.practiceTitle");
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
        this.scores = [];
        this.points = 0;
        this.mistakes = [];
        const root = el("div", "cp");
        this.hud = el("div", "rr-hud");
        const board = el("div", "cp-board");
        this.map = el("div", "cp-map");
        this.panel = el("div", "cp-panel");
        this.overlay = el("div", "rr-overlay");
        board.append(this.map, this.panel, this.overlay);
        this.footer = el("div", "cp-footer");
        this.msg = el("div", "rr-msg cp-msg");
        this.msg.setAttribute("aria-live", "polite");
        root.append(this._backBar(), this.hud, board, this.footer, this.msg);
        this.host.replaceChildren(root);
        this._briefing();
    }

    _briefing() {
        this.state = "briefing";
        this.level = CAMPUS_LEVELS[this.levelIndex];
        this.choices = this.level.links.map(() => ({ medium: null, area: null }));
        this.selected = 0;
        this.attempts = 0;
        this.failed = new Set();
        this._renderAll();
        this._setMsg("");
        this._showOverlay(`
            <p class="rr-overlay-kicker">${t("game.cp.project", { n: this.levelIndex + 1, total: CAMPUS_LEVELS.length })}</p>
            <p class="rr-overlay-title">${esc(this.ltx.title)}</p>
            <p>${esc(this.ltx.desc)}</p>
            <p class="game-muted">${t("game.cp.briefing", { budget: euros(budget(this.level)), n: this.level.links.length })}</p>`,
            t("game.cp.startPlanning"), () => this._play());
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

    _hideOverlay() {
        if (this.overlay) this.overlay.hidden = true;
        this._overlayAction = null;
    }

    _play() {
        this.state = "play";
        this._hideOverlay();
        this._renderAll();
    }

    // ── Choosing ─────────────────────────────────────────────────────

    /** @param {number} i */
    _select(i) {
        if (!this.level) return;
        this.selected = (i + this.level.links.length) % this.level.links.length;
        this._renderMap();
        this._renderPanel();
    }

    /** @param {Medium} m */
    _setMedium(m) {
        if (this.state !== "play") return;
        const c = this.choices[this.selected];
        c.medium = m;
        if (!WIRED.includes(m)) c.area = null;
        this.failed.delete(this.selected);
        this._renderAll();
    }

    /** @param {Area} a */
    _setArea(a) {
        if (this.state !== "play") return;
        this.choices[this.selected].area = a;
        this.failed.delete(this.selected);
        this._renderAll();
    }

    // ── Commissioning ────────────────────────────────────────────────

    async _commission() {
        const lv = this.level;
        if (this.state !== "play" || !lv) return;
        if (this.choices.some((c) => !c.medium)) {
            this._setMsg(`${icon("fa-circle-info")} ${t("game.cp.chooseAll")}`, "is-bad");
            const firstOpen = this.choices.findIndex((c) => !c.medium);
            this._select(firstOpen);
            return;
        }
        this.state = "testing";
        this._renderFooter();
        const result = commission(lv, this.choices);
        this._setMsg(`${icon("fa-plug")} ${t("game.cp.testing")}`);
        // Light up the links one by one.
        for (let i = 0; i < lv.links.length; i++) {
            this.map?.querySelector(`[data-link="${i}"]`)?.classList.add("is-testing");
            await new Promise((r) => setTimeout(r, TEST_STEP_MS));
            const ok = result.problems[i] === null;
            for (const e of this.map?.querySelectorAll(`[data-link="${i}"]`) ?? []) {
                e.classList.remove("is-testing");
                e.classList.add(ok ? "is-ok" : "is-failed");
            }
            this._tone(ok);
        }
        await new Promise((r) => setTimeout(r, TEST_STEP_MS));
        if (this.state !== "testing") return; // left the game meanwhile

        if (result.ok) {
            this._projectDone(result.cost);
            return;
        }
        this.attempts++;
        this.failed = new Set(result.problems.map((p, i) => (p ? i : -1)).filter((i) => i >= 0));
        for (const i of this.failed) {
            this.mistakes.push({ level: this.levelIndex, link: this.ltx.links[i], reason: this.tx.reasons[/** @type {"area"} */ (result.problems[i])] });
        }
        if (result.overBudget && this.failed.size === 0) {
            this.mistakes.push({ level: this.levelIndex, link: "—", reason: t("game.cp.overBudget", { cost: euros(result.cost), budget: euros(budget(lv)) }) });
        }
        const lines = [...this.failed].map((i) => `<li><strong>${esc(this.ltx.links[i])}:</strong> ${esc(this.tx.reasons[/** @type {"area"} */ (result.problems[i])])}</li>`);
        if (result.overBudget) lines.push(`<li><strong>${t("game.cp.budget")}:</strong> ${t("game.cp.overBudget", { cost: euros(result.cost), budget: euros(budget(lv)) })}</li>`);
        const left = BUILD_ATTEMPTS - this.attempts;
        if (!this.practice && left <= 0) {
            this._projectFailed(lines);
            return;
        }
        this.state = "play";
        this._setMsg(`${icon("fa-triangle-exclamation")} ${t("game.cp.failed")}${this.practice ? "" : ` ${t("game.cp.attemptsLeft", { n: left })}`}<ul class="cp-problems">${lines.join("")}</ul>`, "is-bad");
        this._renderAll();
        const first = [...this.failed][0];
        if (first !== undefined) this._select(first);
    }

    /** @param {number} cost */
    _projectDone(cost) {
        const lv = /** @type {CampusLevel} */ (this.level);
        const opt = optimalCost(lv);
        const score = projectScore(cost, opt, this.attempts);
        this.scores.push(score);
        const saved = Math.max(0, budget(lv) - cost);
        const gained = this.practice ? 0 : score * 10 + saved;
        this.points += gained;
        this.state = "cleared";
        this._setMsg("");
        this._renderHud();
        const last = this.levelIndex === CAMPUS_LEVELS.length - 1;
        this._showOverlay(`
            <p class="rr-overlay-title">${icon("fa-circle-check")} ${t("game.cp.works")}</p>
            <p>${t("game.cp.costSummary", { cost: euros(cost), budget: euros(budget(lv)) })}</p>
            <p class="game-muted">${cost <= opt ? t("game.cp.cheapest") : t("game.cp.couldBeCheaper", { opt: euros(opt) })}</p>
            <p><strong>${t("game.cp.projectScore", { score })}</strong></p>`,
            last ? t("game.round.finish") : t("game.cp.nextProject"),
            () => (last ? this._finish() : (this.levelIndex++, this._briefing())));
    }

    /** @param {string[]} lines */
    _projectFailed(lines) {
        const lv = /** @type {CampusLevel} */ (this.level);
        this.scores.push(0);
        // Show the solution on the plan.
        this.choices = lv.links.map((l) => ({ medium: bestMedium(l), area: WIRED.includes(bestMedium(l)) ? l.area : null }));
        this.failed = new Set();
        this.state = "cleared";
        this._renderAll();
        const last = this.levelIndex === CAMPUS_LEVELS.length - 1;
        this._setMsg(`<ul class="cp-problems">${lines.join("")}</ul>`, "is-bad");
        this._showOverlay(`
            <p class="rr-overlay-title">${icon("fa-helmet-safety")} ${t("game.cp.noMoreAttempts")}</p>
            <p>${t("game.cp.solutionShown")}</p>`,
            last ? t("game.round.finish") : t("game.cp.nextProject"),
            () => (last ? this._finish() : (this.levelIndex++, this._briefing())));
        // Keep the solution visible: the overlay only covers the plan.
        this.overlay?.classList.add("cp-overlay--side");
    }

    // ── Rendering ────────────────────────────────────────────────────

    _renderAll() {
        this.overlay?.classList.remove("cp-overlay--side");
        this._renderHud();
        this._renderMap();
        this._renderPanel();
        this._renderFooter();
    }

    _renderHud() {
        if (!this.hud) return;
        const attempts = this.practice
            ? `<span class="rr-practice">${icon("fa-person-chalkboard")} ${t("game.rr.practiceBadge")}</span>`
            : `<span class="cp-attempts" title="${esc(t("game.cp.attemptsTitle", { n: BUILD_ATTEMPTS }))}">${Array.from({ length: BUILD_ATTEMPTS }, (_, i) => icon("fa-plug", i < BUILD_ATTEMPTS - this.attempts ? "fa-solid" : "fa-regular cp-used")).join("")}</span>`;
        this.hud.innerHTML = `
            <span class="rr-level">${t("game.cp.project", { n: this.levelIndex + 1, total: CAMPUS_LEVELS.length })}</span>
            ${attempts}
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
        this.hud.append(sound);
    }

    _renderMap() {
        const lv = this.level;
        const map = this.map;
        if (!lv || !map) return;
        const lines = lv.links.map((l, i) => {
            const a = lv.nodes[l.from], b = lv.nodes[l.to];
            const m = this.choices[i].medium ?? "none";
            const cls = `cp-line cp-line--${m}${i === this.selected ? " is-selected" : ""}${this.failed.has(i) ? " is-failed" : ""}`;
            const wan = m === "wan" ? `<line class="${cls} cp-line--wan2" data-link="${i}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />` : "";
            return `<line class="cp-line-hit" data-link-hit="${i}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />${wan}<line class="${cls}" data-link="${i}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
        }).join("");
        map.innerHTML = `<svg class="cp-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`;
        lv.nodes.forEach((n, i) => {
            const node = el("div", "cp-node", `<span class="cp-node-icon">${icon(n.icon)}</span><span class="cp-node-label">${esc(this.ltx.nodes[i] ?? "")}</span>`);
            node.style.left = `${n.x}%`;
            node.style.top = `${n.y}%`;
            map.append(node);
        });
        lv.links.forEach((l, i) => {
            const a = lv.nodes[l.from], b = lv.nodes[l.to];
            const m = this.choices[i].medium;
            const tag = button(`cp-tag${i === this.selected ? " is-selected" : ""}${this.failed.has(i) ? " is-failed" : ""}${m ? "" : " is-open"}`,
                `<span class="cp-tag-no">${i + 1}</span>${m ? icon(MEDIUM_ICONS[m]) : icon("fa-question")}`);
            tag.dataset.link = String(i);
            tag.style.left = `${(a.x + b.x) / 2}%`;
            tag.style.top = `${(a.y + b.y) / 2}%`;
            tag.title = `${this.ltx.links[i]} — ${distance(l.dist)}`;
            tag.addEventListener("click", () => this._select(i));
            map.append(tag);
        });
        map.querySelectorAll("[data-link-hit]").forEach((e) => e.addEventListener("click", () => this._select(Number(/** @type {HTMLElement} */ (e).dataset.linkHit))));
    }

    _renderPanel() {
        const lv = this.level;
        const panel = this.panel;
        if (!lv || !panel) return;
        const i = this.selected;
        const link = lv.links[i];
        const c = this.choices[i];
        panel.replaceChildren();

        // The selected link: its properties and the media to choose from.
        const card = el("div", "cp-card" + (this.failed.has(i) ? " is-failed" : ""));
        /** @type {string[]} */
        const chips = [`${icon("fa-ruler-horizontal")} ${distance(link.dist)}`, `${icon("fa-gauge-high")} ${rate(link.mbit)}`];
        if (link.mobile) chips.push(`${icon("fa-mobile-screen")} ${t("game.cp.attr.mobile")}`);
        if (link.battery) chips.push(`${icon("fa-battery-half")} ${t("game.cp.attr.battery")}`);
        if (link.emv) chips.push(`${icon("fa-bolt-lightning")} ${t("game.cp.attr.emv")}`);
        if (link.public) chips.push(`${icon("fa-road")} ${t("game.cp.attr.public")}`);
        card.innerHTML = `
            <p class="cp-card-title"><span class="cp-tag-no">${i + 1}</span> ${esc(this.ltx.links[i])}</p>
            <ul class="cp-chips">${chips.map((ch) => `<li>${ch}</li>`).join("")}</ul>`;
        const media = el("div", "cp-media");
        media.setAttribute("role", "group");
        media.setAttribute("aria-label", t("game.cp.medium"));
        MEDIA.forEach((m, k) => {
            const b = button("cp-medium" + (c.medium === m ? " is-active" : ""), `${icon(MEDIUM_ICONS[m])}<span>${esc(this.tx.media[m].name)}</span><small>${euros(COST[m](link.dist))}</small><kbd>${k + 1}</kbd>`);
            b.setAttribute("aria-pressed", String(c.medium === m));
            b.disabled = this.state !== "play";
            b.addEventListener("click", () => this._setMedium(m));
            media.append(b);
        });
        card.append(media);
        if (lv.areas && c.medium && WIRED.includes(c.medium)) {
            const areas = el("div", "cp-areas");
            areas.append(el("span", "cp-areas-label", t("game.cp.area")));
            for (const a of AREAS) {
                const b = button("cp-area" + (c.area === a ? " is-active" : ""), esc(this.tx.areas[a]));
                b.setAttribute("aria-pressed", String(c.area === a));
                b.disabled = this.state !== "play";
                b.addEventListener("click", () => this._setArea(a));
                areas.append(b);
            }
            card.append(areas, el("p", "game-muted game-small", esc(this.tx.areaHelp)));
        }
        panel.append(card);

        // All links at a glance.
        const list = el("ol", "cp-list");
        lv.links.forEach((l, k) => {
            const ck = this.choices[k];
            const row = button("cp-row" + (k === i ? " is-selected" : "") + (this.failed.has(k) ? " is-failed" : ""),
                `<span class="cp-tag-no">${k + 1}</span><span class="cp-row-name">${esc(this.ltx.links[k])}</span>
                <span class="cp-row-medium">${ck.medium ? `${icon(MEDIUM_ICONS[ck.medium])} ${euros(COST[ck.medium](l.dist))}` : `<span class="game-muted">${t("game.cp.open")}</span>`}</span>`);
            row.addEventListener("click", () => this._select(k));
            const li = el("li");
            li.append(row);
            list.append(li);
        });
        panel.append(list);

        // The data sheet.
        const sheet = /** @type {HTMLDetailsElement} */ (el("details", "cp-sheet"));
        sheet.innerHTML = `<summary>${icon("fa-file-lines")} ${t("game.cp.datasheet")}</summary>
            <dl>${MEDIA.map((m) => `<dt>${icon(MEDIUM_ICONS[m])} ${esc(this.tx.media[m].name)}</dt><dd>${esc(this.tx.media[m].spec)}</dd>`).join("")}</dl>
            ${lv.areas ? `<p class="game-small">${esc(this.tx.areaHelp)}</p>` : ""}`;
        // Closed by default so plan and "Commission" fit on screen; the choice is remembered.
        try { sheet.open = localStorage.getItem("bt.game.cp.sheet") === "1"; } catch { sheet.open = false; }
        sheet.addEventListener("toggle", () => { try { localStorage.setItem("bt.game.cp.sheet", sheet.open ? "1" : "0"); } catch { /* storage blocked */ } });
        panel.append(sheet);
    }

    _renderFooter() {
        const lv = this.level;
        const footer = this.footer;
        if (!lv || !footer) return;
        const cost = this.choices.reduce((sum, c, i) => sum + (c.medium ? COST[c.medium](lv.links[i].dist) : 0), 0);
        const max = budget(lv);
        const pct = Math.min(100, (100 * cost) / max);
        footer.innerHTML = `
            <div class="cp-budget">
                <span>${t("game.cp.budget")}: <strong>${euros(cost)}</strong> / ${euros(max)}</span>
                <span class="cp-budget-bar${cost > max ? " is-over" : ""}"><span style="width:${pct}%"></span></span>
            </div>`;
        const go = button("game-btn game-btn-primary", `${icon("fa-plug-circle-bolt")} ${t("game.cp.commission")} <kbd>↵</kbd>`);
        go.disabled = this.state !== "play";
        go.addEventListener("click", () => void this._commission());
        footer.append(go);
    }

    /** @param {boolean} ok */
    _tone(ok) {
        if (!this.sound) return;
        simAudio.tone(ok ? { freqs: [660, 990], durationS: 0.06, level: 0.1, type: "triangle" } : { freqs: [180], durationS: 0.15, level: 0.13, type: "square" });
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
        const score = Math.round(this.scores.reduce((a, b) => a + b, 0) / CAMPUS_LEVELS.length);
        const outcome = this.practice ? null : this.opts.onFinish(score);
        const high = this.practice ? null : this.opts.onHighscore(this.points);
        const box = el("div", "game-play rr-result");
        box.append(this._backBar());
        const result = renderOutcome({
            title: esc(this.opts.title),
            score,
            detail: t("game.cp.detail", { scores: this.scores.join(" · ") }),
            outcome,
            headline: t("game.cp.victory"),
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
            list.append(el("li", "", `<strong>${esc(this.tx.levels[m.level].title)}</strong> — ${esc(m.link)}<br><span class="game-muted">${m.reason}</span>`));
        }
        sec.append(list);
        if (this.mistakes.length > MAX_REVIEW) sec.append(el("p", "game-muted", t("game.rr.reviewMore", { n: this.mistakes.length - MAX_REVIEW })));
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
            let handled = true;
            if (n >= 1 && n <= MEDIA.length) this._setMedium(MEDIA[n - 1]);
            else if (ev.key === "ArrowDown" || ev.key === "ArrowRight") this._select(this.selected + 1);
            else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") this._select(this.selected - 1);
            else if (ev.key === "Enter" && !(target instanceof HTMLButtonElement)) void this._commission();
            else handled = false;
            if (handled) { ev.preventDefault(); ev.stopPropagation(); }
            return;
        }
        if ((this.state === "briefing" || this.state === "cleared") && this._overlayAction && (ev.key === "Enter" || ev.key === " ")) {
            ev.preventDefault();
            ev.stopPropagation();
            this._overlayAction();
        }
    }
}
