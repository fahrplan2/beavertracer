//@ts-check
// Gatekeeper — the playable view. One person at a time at the front desk;
// the house rules on the side grow from shift to shift. Six stamps:
// physical / system / data access × allow / deny (keys 1–6). A stamp only
// counts when both the kind of control and the decision are right. Three
// wrong stamps end the game; when the shift clock runs out, whoever is
// still waiting has to leave. Rules: guard.js.

import { t } from "../i18n/index.js";
import { simAudio } from "../lib/SimAudio.js";
import { gameContent } from "./content.js";
import { GUARD_LEVELS, KINDS, STRIKES, TOTAL_GUARD_REQUESTS, buildGuardLevel, guardScore, stampPoints, verdict } from "./guard.js";
import { button, el, esc, icon, renderOutcome } from "./ui.js";

/**
 * @typedef {import("./guard.js").GuardReq} GuardReq
 * @typedef {import("./guard.js").Kind} Kind
 * @typedef {import("./guard.js").RuleId} RuleId
 * @typedef {import("./guard.js").Role} Role
 * @typedef {{ req: GuardReq, rules: RuleId[], chosen: { kind: Kind, allow: boolean }|null }} GuardMistake  chosen null = had to leave (shift over)
 */

const SOUND_KEY = "bt.game.sound";
const MAX_REVIEW = 10;
const LEVEL_BONUS_PER_SECOND = 3;

/** @type {Record<Role, string>} */
const ROLE_ICONS = {
    it: "fa-laptop-code",
    teacher: "fa-chalkboard-user",
    student: "fa-user-graduate",
    office: "fa-user-tie",
    head: "fa-user-shield",
    caretaker: "fa-screwdriver-wrench",
    visitor: "fa-person-walking-luggage",
};

/** "a.becker" from "Anna Becker". @param {string} name */
export function username(name) {
    const [first, ...rest] = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase().split(/\s+/);
    return `${first[0]}.${rest.join("")}`.replace(/[^a-z.]/g, "");
}

export class GuardView {
    /**
     * @param {HTMLElement} host
     * @param {{ title: string, onFinish: (score: number) => import("./GameState.js").RecordOutcome, onHighscore: (points: number) => { best: number, isNew: boolean }, onExit: () => void }} opts
     */
    constructor(host, opts) {
        this.host = host;
        this.opts = opts;
        this.tx = gameContent().games.guard;
        this.practice = false;
        /** @type {"intro"|"briefing"|"play"|"paused"|"cleared"|"over"} */
        this.state = "intro";
        this.levelIndex = 0;
        /** @type {ReturnType<typeof buildGuardLevel>|null} */
        this.level = null;
        this.reqIndex = 0;
        this.strikes = 0;
        this.points = 0;
        this.combo = 0;
        this.correct = 0;
        this.shiftLeftMs = 0;
        this.reqElapsedMs = 0;
        /** @type {GuardMistake[]} */
        this.mistakes = [];
        this.rafId = 0;
        this.lastTs = 0;
        this.today = new Date();
        /** @type {(() => void)|null} */
        this._overlayAction = null;
        /** @type {HTMLElement|null} */ this.hud = null;
        /** @type {HTMLElement|null} */ this.caseBox = null;
        /** @type {HTMLElement|null} */ this.rulesBox = null;
        /** @type {HTMLElement|null} */ this.stamps = null;
        /** @type {HTMLElement|null} */ this.overlay = null;
        /** @type {HTMLElement|null} */ this.msg = null;
        /** @type {HTMLElement|null} */ this.clock = null;
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

    /** @param {number} i */
    _name(i) {
        return this.tx.names[i % this.tx.names.length];
    }

    // ── Words for a request ──────────────────────────────────────────

    /** The request as a sentence: "Anna Becker möchte in den Serverraum." @param {GuardReq} req */
    _sentence(req) {
        const who = `<strong>${esc(this._name(req.person.name))}</strong>`;
        if (req.kind === "entry") return `${who} ${this.tx.entry[req.room]}`;
        if (req.kind === "login") return `${who} ${this.tx.login[req.system]}`;
        return `${who} ${this.tx.data[req.action].replace("{folder}", esc(this.tx.folders[req.folder]))}`;
    }

    /** @param {Kind} kind @param {boolean} allow */
    _stampLabel(kind, allow) {
        return t("game.gd.stamp", { kind: t(`game.gd.kind.${kind}`), decision: t(allow ? "game.gd.allow" : "game.gd.deny") });
    }

    /** @param {number} daysFromToday */
    _date(daysFromToday) {
        const d = new Date(this.today);
        d.setDate(d.getDate() + daysFromToday);
        return d.toLocaleDateString(document.documentElement.lang || undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
    }

    // ── Screens ──────────────────────────────────────────────────────

    start() {
        this.state = "intro";
        const box = el("div", "game-play gd-intro");
        box.append(this._backBar());
        box.append(el("h3", "game-play-title", `${icon("fa-user-shield")} ${esc(this.opts.title)}`));
        box.append(el("div", "game-intro-text", this.tx.intro));
        const actions = el("div", "game-actions game-actions--start");
        const play = button("game-btn game-btn-primary", `${icon("fa-play")} ${t("game.rr.play")}`);
        play.addEventListener("click", () => this._newGame(false));
        const practice = button("game-btn", `${icon("fa-person-chalkboard")} ${t("game.rr.practice")}`);
        practice.title = t("game.gd.practiceTitle");
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
        this.strikes = 0;
        this.points = 0;
        this.combo = 0;
        this.correct = 0;
        this.mistakes = [];
        const root = el("div", "gd");
        this.hud = el("div", "rr-hud");
        const desk = el("div", "gd-desk");
        this.caseBox = el("div", "gd-case");
        this.caseBox.setAttribute("aria-live", "polite");
        this.rulesBox = el("aside", "gd-rules");
        this.overlay = el("div", "rr-overlay");
        this.stamps = el("div", "gd-stamps");
        this.msg = el("div", "rr-msg");
        this.msg.setAttribute("aria-live", "polite");
        // Person, stamps and feedback on the left, the (growing) house rules on the right.
        const main = el("div", "gd-main");
        main.append(this.caseBox, this.stamps, this.msg);
        desk.append(main, this.rulesBox, this.overlay);
        root.append(this._backBar(), this.hud, desk);
        this.host.replaceChildren(root);
        this._renderStamps();
        this._briefing();
    }

    _briefing() {
        this.state = "briefing";
        this.level = buildGuardLevel(this.levelIndex, Math.random, this.tx.names.length);
        this.reqIndex = 0;
        this.shiftLeftMs = this.level.shiftMs;
        this.reqElapsedMs = 0;
        this._renderHud();
        this._renderRules();
        this._renderCase();
        this._setMsg("");
        this._showOverlay(`
            <p class="rr-overlay-kicker">${t("game.gd.shift", { n: this.levelIndex + 1, total: GUARD_LEVELS.length })}</p>
            <p class="rr-overlay-title">${esc(this.tx.levels[this.levelIndex] ?? "")}</p>
            <p class="game-muted">${t("game.gd.briefing", { n: this.level.requests.length })}</p>`,
            t("game.gd.open"), () => this._play());
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
        this._renderCase();
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

    /** @param {number} ts */
    _frame(ts) {
        if (this.state !== "play") return;
        const dt = Math.min(100, ts - this.lastTs);
        this.lastTs = ts;
        this.reqElapsedMs += dt;
        if (!this.practice) {
            this.shiftLeftMs -= dt;
            this._renderClock();
            if (this.shiftLeftMs <= 0) {
                this._shiftOver();
                return;
            }
        }
        this.rafId = requestAnimationFrame((t2) => this._frame(t2));
    }

    // ── Stamping ─────────────────────────────────────────────────────

    /** @param {Kind} kind @param {boolean} allow */
    _stamp(kind, allow) {
        const req = this.request;
        const lv = this.level;
        if (this.state !== "play" || !req || !lv) return;
        const v = verdict(req, lv.rules);
        const ok = kind === req.kind && allow === v.allow;
        const right = this._stampLabel(req.kind, v.allow);
        // The next person is already at the desk when the message shows — name who it was about.
        const who = `<strong>${esc(this._name(req.person.name))}</strong>:`;
        this._flashStamp(kind, allow, ok);
        if (ok) {
            const gained = this.practice ? 0 : stampPoints(this.levelIndex, this.reqElapsedMs / 1000, this.combo);
            this.points += gained;
            this.combo++;
            this.correct++;
            this._tone(true);
            this._setMsg(`${icon("fa-stamp")} ${who} ${right}${gained ? ` +${gained}` : ""}`, "is-ok");
        } else {
            this.combo = 0;
            if (!this.practice) this.strikes++;
            this.mistakes.push({ req, rules: lv.rules, chosen: { kind, allow } });
            this._tone(false);
            const why = kind !== req.kind ? t(`game.gd.whyKind.${req.kind}`) : esc(this.tx.rules[v.rule]);
            this._setMsg(`${icon("fa-triangle-exclamation")} ${who} ${t("game.gd.wrong", { right, why })}`, "is-bad");
            if (!this.practice && this.strikes >= STRIKES) {
                this._renderHud();
                this._gameOver();
                return;
            }
        }
        this.reqIndex++;
        this.reqElapsedMs = 0;
        this._renderHud();
        if (this.reqIndex >= lv.requests.length) this._levelCleared(false);
        else this._renderCase(true);
    }

    /** @param {Kind} kind @param {boolean} allow @param {boolean} ok */
    _flashStamp(kind, allow, ok) {
        const b = this.stamps?.querySelector(`[data-stamp="${kind}-${allow ? "allow" : "deny"}"]`);
        if (!b) return;
        const cls = ok ? "is-hit-ok" : "is-hit-bad";
        b.classList.remove(cls);
        void /** @type {HTMLElement} */ (b).offsetWidth;
        b.classList.add(cls);
        setTimeout(() => b.classList.remove(cls), 600);
    }

    _shiftOver() {
        const lv = this.level;
        if (!lv) return;
        const left = lv.requests.slice(this.reqIndex);
        for (const req of left) this.mistakes.push({ req, rules: lv.rules, chosen: null });
        this._setMsg(`${icon("fa-clock")} ${t("game.gd.timeUp", { n: left.length })}`, "is-bad");
        this.reqIndex = lv.requests.length;
        this._levelCleared(true);
    }

    /** @param {boolean} timeUp */
    _levelCleared(timeUp) {
        cancelAnimationFrame(this.rafId);
        const bonus = this.practice || timeUp ? 0 : Math.round((this.shiftLeftMs / 1000) * LEVEL_BONUS_PER_SECOND);
        this.points += bonus;
        this._renderHud();
        if (this.levelIndex === GUARD_LEVELS.length - 1) {
            this._finish(t("game.gd.victory"));
            return;
        }
        this.state = "cleared";
        this._showOverlay(`
            <p class="rr-overlay-title">${icon("fa-flag-checkered")} ${t("game.gd.cleared", { n: this.levelIndex + 1 })}</p>
            ${bonus ? `<p>${t("game.gd.bonus", { points: bonus })}</p>` : ""}`,
            t("game.gd.nextShift"), () => { this.levelIndex++; this._briefing(); });
    }

    _gameOver() {
        cancelAnimationFrame(this.rafId);
        this.state = "over";
        this._finish(t("game.gd.fired"));
    }

    // ── Rendering ────────────────────────────────────────────────────

    _renderHud() {
        if (!this.hud) return;
        const strikes = this.practice
            ? `<span class="rr-practice">${icon("fa-person-chalkboard")} ${t("game.rr.practiceBadge")}</span>`
            : Array.from({ length: STRIKES }, (_, i) => `<span class="gd-strike${i < this.strikes ? " is-on" : ""}">${icon("fa-triangle-exclamation")}</span>`).join("");
        this.hud.innerHTML = `
            <span class="rr-level">${t("game.gd.shift", { n: this.levelIndex + 1, total: GUARD_LEVELS.length })}</span>
            <span class="gd-strikes" title="${esc(t("game.gd.strikesTitle", { n: STRIKES }))}">${strikes}</span>
            <span class="rr-points">${icon("fa-bolt")} ${this.points}</span>
            ${this.practice ? "" : `<span class="gd-clock">${icon("fa-clock")} <span></span></span>`}`;
        this.clock = /** @type {HTMLElement|null} */ (this.hud.querySelector(".gd-clock > span"));
        this._renderClock();
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

    _renderClock() {
        if (!this.clock) return;
        const s = Math.max(0, Math.ceil(this.shiftLeftMs / 1000));
        this.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        this.clock.parentElement?.classList.toggle("is-low", s <= 15);
    }

    _renderRules() {
        const box = this.rulesBox;
        const lv = this.level;
        if (!box || !lv) return;
        box.innerHTML = `<h4>${icon("fa-scroll")} ${t("game.gd.rulesTitle")}</h4>
            <p class="gd-today">${t("game.gd.today", { date: this._date(0) })}</p>
            <ol class="gd-rule-list">${lv.rules.map((r) => `<li class="${lv.newRules.includes(r) && this.levelIndex > 0 ? "is-new" : ""}">${esc(this.tx.rules[r])}${lv.newRules.includes(r) && this.levelIndex > 0 ? ` <span class="gd-new">${t("game.gd.new")}</span>` : ""}</li>`).join("")}</ol>`;
    }

    /** @param {boolean} [animate] */
    _renderCase(animate = false) {
        const box = this.caseBox;
        const lv = this.level;
        const req = this.request;
        if (!box || !lv) return;
        if (!req || this.state === "briefing") {
            box.innerHTML = `<div class="gd-empty">${icon("fa-door-open")}</div>`;
            return;
        }
        const p = req.person;
        const name = this._name(p.name);
        /** @type {string[]} */
        const facts = [];
        if (req.kind === "entry") {
            facts.push(t("game.gd.time", { time: `${String(req.hour).padStart(2, "0")}:${String(req.minute).padStart(2, "0")}` }));
            if (p.role === "visitor") facts.push(req.escort !== null ? t("game.gd.escort", { name: esc(this._name(req.escort)) }) : t("game.gd.noEscort"));
        } else if (req.kind === "login") {
            facts.push(t("game.gd.account", { account: `<code>${username(this._name(req.account))}</code>` }));
            facts.push(t("game.gd.failed", { n: req.failed }));
            facts.push(t(req.twofa ? "game.gd.twofaYes" : "game.gd.twofaNo"));
        } else {
            facts.push(t("game.gd.loggedIn", { account: `<code>${username(name)}</code>` }));
        }
        const waiting = lv.requests.length - this.reqIndex - 1;
        box.innerHTML = `
            <div class="gd-card${animate ? " is-new" : ""}">
                <div class="gd-person">
                    <span class="gd-avatar">${icon(ROLE_ICONS[p.role])}</span>
                    <div class="gd-id">
                        <span class="gd-id-kicker">${icon("fa-id-card")} ${t("game.gd.badge")}</span>
                        <strong>${esc(name)}</strong>
                        <span>${esc(this.tx.roles[p.role])}</span>
                        <span class="gd-valid">${t("game.gd.validUntil", { date: this._date(p.expiresInDays) })}</span>
                    </div>
                </div>
                <p class="gd-sentence">${this._sentence(req)}</p>
                <ul class="gd-facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>
            </div>
            <p class="gd-queue">${icon("fa-people-line")} ${t("game.gd.queue", { n: Math.max(0, waiting) })}</p>`;
    }

    _renderStamps() {
        const box = this.stamps;
        if (!box) return;
        box.replaceChildren();
        KINDS.forEach((kind, k) => {
            const group = el("div", "gd-stamp-group");
            group.append(el("span", "gd-stamp-title", t(`game.gd.kind.${kind}`)));
            const row = el("div", "gd-stamp-row");
            for (const allow of [true, false]) {
                const key = k * 2 + (allow ? 1 : 2);
                const b = button(`gd-stamp ${allow ? "is-allow" : "is-deny"}`, `${icon(allow ? "fa-check" : "fa-xmark")} ${t(allow ? "game.gd.allow" : "game.gd.deny")} <kbd>${key}</kbd>`);
                b.dataset.stamp = `${kind}-${allow ? "allow" : "deny"}`;
                b.setAttribute("aria-label", `${this._stampLabel(kind, allow)} (${key})`);
                b.addEventListener("click", () => this._stamp(kind, allow));
                row.append(b);
            }
            group.append(row);
            box.append(group);
        });
    }

    /** @param {boolean} ok */
    _tone(ok) {
        if (!this.sound) return;
        simAudio.tone(ok ? { freqs: [520, 780], durationS: 0.09, level: 0.12, type: "triangle" } : { freqs: [180], durationS: 0.18, level: 0.15, type: "square" });
    }

    /** @param {string} html @param {string} [cls] */
    _setMsg(html, cls = "") {
        if (!this.msg) return;
        this.msg.className = "rr-msg " + cls;
        this.msg.innerHTML = html;
    }

    // ── Result & review ──────────────────────────────────────────────

    /** @param {string} headline */
    _finish(headline) {
        this.state = "over";
        this.dispose();
        const score = guardScore(this.correct);
        const outcome = this.practice ? null : this.opts.onFinish(score);
        const high = this.practice ? null : this.opts.onHighscore(this.points);
        const box = el("div", "game-play rr-result");
        box.append(this._backBar());
        const result = renderOutcome({
            title: esc(this.opts.title),
            score,
            detail: t("game.gd.detail", { correct: this.correct, total: TOTAL_GUARD_REQUESTS, level: this.levelIndex + 1 }),
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
            const v = verdict(m.req, m.rules);
            const yours = m.chosen ? t("game.gd.review.you", { stamp: this._stampLabel(m.chosen.kind, m.chosen.allow) }) : t("game.gd.review.missed");
            const right = t("game.gd.review.right", { stamp: this._stampLabel(m.req.kind, v.allow) });
            list.append(el("li", "", `${this._sentence(m.req)} — ${yours}<br>
                <span class="game-muted">${right} · ${t(`game.gd.whyKind.${m.req.kind}`)} ${esc(this.tx.rules[v.rule])}</span>`));
        }
        sec.append(list);
        if (this.mistakes.length > MAX_REVIEW) sec.append(el("p", "game-muted", t("game.rr.reviewMore", { n: this.mistakes.length - MAX_REVIEW })));
        sec.append(el("p", "game-muted game-small", t("game.gd.reviewTip")));
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
            if (n >= 1 && n <= 6) this._stamp(KINDS[Math.floor((n - 1) / 2)], n % 2 === 1);
            else if (ev.key === "Escape" || ev.key === "p" || ev.key === "P") this._pause();
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
