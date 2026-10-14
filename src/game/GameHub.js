//@ts-check
// The game's hub: a modal opened from the toolbar. Shows the player's rank
// and XP, the tickets (missions in the simulation), the intermezzos
// (mini-games), badges, the player's completion codes, and a teacher view
// to check handed-in codes. Everything stays in this browser.

import { t } from "../i18n/index.js";
import { SimDialog } from "../lib/SimDialog.js";
import {
    ACTS, ALL_INTERMEZZOS, BADGES, INTERMEZZOS, TICKETS,
    actText, badgeText, gameTitle, intermezzoText, rankFor, rankTitle, ticketText,
} from "./GameCatalog.js";
import { gameState } from "./GameState.js";
import { verifyCode } from "./CompletionCode.js";
import { gameContent } from "./content.js";
import { MINIGAMES } from "./minigames.js";
import { RoundGame } from "./RoundGame.js";
import { RoutingRushView } from "./RoutingRushView.js";
import { VlsmView } from "./VlsmView.js";
import { BinaryBeltView } from "./BinaryBeltView.js";
import { GuardView } from "./GuardView.js";
import { runTicket, ticketLabel } from "./TicketRunner.js";
import { button, codeChip, copyText, el, esc, icon, starsFor, starsHtml } from "./ui.js";

/** @typedef {"tickets"|"intermezzos"|"badges"|"codes"|"more"|"teacher"} HubTab */

const TABS = /** @type {{ id: HubTab, icon: string }[]} */ ([
    { id: "tickets", icon: "fa-ticket" },
    { id: "intermezzos", icon: "fa-puzzle-piece" },
    { id: "badges", icon: "fa-medal" },
    { id: "codes", icon: "fa-key" },
    { id: "more", icon: "fa-ellipsis" },
]);

/** @param {Date} d */
function fmtDate(d) {
    return d.toLocaleDateString(document.documentElement.lang || undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** @type {GameHub|null} */
let openHub = null;

export class GameHub {
    /**
     * @param {import("../SimControl.js").SimControl} sim
     * @param {{ tab?: HubTab }} [opts]
     */
    static show(sim, { tab } = {}) {
        if (openHub) {
            if (tab) openHub._showTab(tab);
            return openHub;
        }
        openHub = new GameHub(sim);
        openHub._open(tab);
        return openHub;
    }

    /** @param {import("../SimControl.js").SimControl} sim */
    constructor(sim) {
        this.sim = sim;
        /** @type {HubTab} */
        this.tab = "tickets";
        /** @type {{ dispose: () => void }|null} the intermezzo being played */
        this.activeGame = null;
        this.backdrop = el("div", "game-backdrop");
        this.dlg = el("div", "game-dlg");
        this.dlg.setAttribute("role", "dialog");
        this.dlg.setAttribute("aria-modal", "true");
        this.dlg.setAttribute("aria-label", t("game.title"));
        this.header = el("header", "game-header");
        this.nav = el("nav", "game-tabs");
        this.nav.setAttribute("aria-label", t("game.tabs.label"));
        this.body = el("div", "game-body");
        this.dlg.append(this.header, this.nav, this.body);
        this.backdrop.append(this.dlg);
        this._onKey = (/** @type {KeyboardEvent} */ ev) => { if (ev.key === "Escape") this.close(); };
        this.backdrop.addEventListener("click", (ev) => { if (ev.target === this.backdrop) this.close(); });
        this._unsub = gameState.onChange(() => this._renderHeader());
    }

    /** @param {HubTab} [tab] */
    _open(tab) {
        document.body.append(this.backdrop);
        document.addEventListener("keydown", this._onKey);
        this._renderHeader();
        if (!gameState.hasPlayer && tab !== "teacher") this._showWelcome();
        else this._showTab(tab ?? "tickets");
    }

    close() {
        this._stopGame();
        this.backdrop.remove();
        document.removeEventListener("keydown", this._onKey);
        this._unsub();
        if (openHub === this) openHub = null;
    }

    _stopGame() {
        this.activeGame?.dispose();
        this.activeGame = null;
    }

    // ── Header ───────────────────────────────────────────────────────

    _renderHeader() {
        const xp = gameState.xp;
        const rank = rankFor(xp);
        const pct = rank.next ? Math.round((100 * (xp - rank.xp)) / (rank.next - rank.xp)) : 100;
        this.header.innerHTML = `
            <div class="game-brand">
                ${icon("fa-gamepad")}
                <div><p class="game-brand-title">${t("game.title")}</p>
                <p class="game-brand-sub">${t("game.subtitle")}</p></div>
            </div>
            ${gameState.hasPlayer ? `
            <div class="game-player">
                <p class="game-player-name">${icon("fa-id-badge")} ${esc(gameState.name)} · <strong>${esc(rankTitle(rank.index))}</strong></p>
                <div class="game-xpbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(t("game.player.progress"))}">
                    <span style="width:${pct}%"></span>
                </div>
                <p class="game-player-xp">${rank.next !== null
                    ? t("game.player.xpNext", { xp, n: rank.next - xp, rank: esc(rankTitle(rank.index + 1)) })
                    : t("game.player.xpTop", { xp })}</p>
            </div>` : ""}`;
        const close = button("game-close", "×");
        close.title = t("game.close");
        close.setAttribute("aria-label", close.title);
        close.addEventListener("click", () => this.close());
        this.header.append(close);
    }

    _renderNav() {
        this.nav.replaceChildren();
        this.nav.hidden = !gameState.hasPlayer;
        for (const tab of TABS) {
            const b = button("game-tab" + (this.tab === tab.id ? " is-active" : ""), `${icon(tab.icon)} <span>${t(`game.tab.${tab.id}`)}</span>`);
            if (this.tab === tab.id) b.setAttribute("aria-current", "page");
            b.addEventListener("click", () => this._showTab(tab.id));
            this.nav.append(b);
        }
    }

    /** @param {HubTab} tab */
    _showTab(tab) {
        this._stopGame();
        this.tab = tab;
        this._renderNav();
        this.body.scrollTop = 0;
        switch (tab) {
            case "tickets": return this._renderTickets();
            case "intermezzos": return this._renderIntermezzos();
            case "badges": return this._renderBadges();
            case "codes": return this._renderCodes();
            case "more": return this._renderMore();
            case "teacher": return this._renderTeacher();
        }
    }

    // ── Welcome / name ───────────────────────────────────────────────

    _showWelcome() {
        this._renderNav();
        const box = el("div", "game-welcome");
        box.innerHTML = `
            <h2>${t("game.welcome.title")}</h2>
            <p>${t("game.welcome.intro")}</p>
            <ul class="game-welcome-list">
                <li>${icon("fa-bolt")}<span>${t("game.welcome.xp")}</span></li>
                <li>${icon("fa-book-open")}<span>${t("game.welcome.course")}</span></li>
                <li>${icon("fa-key")}<span>${t("game.welcome.codes")}</span></li>
            </ul>`;
        const form = /** @type {HTMLFormElement} */ (el("form", "game-name-form"));
        form.innerHTML = `
            <label for="game-name-input">${t("game.welcome.nameLabel")}</label>
            <div class="game-input-row">
                <input id="game-name-input" class="game-input" type="text" maxlength="60" autocomplete="off" placeholder="${esc(t("game.welcome.namePlaceholder"))}" required>
                <button type="submit" class="game-btn game-btn-primary">${t("game.play.start")}</button>
            </div>
            <p class="game-muted game-small">${icon("fa-lock")} ${t("game.welcome.privacy")}</p>`;
        form.addEventListener("submit", (ev) => {
            ev.preventDefault();
            const input = /** @type {HTMLInputElement} */ (form.querySelector("input"));
            const name = input.value.trim();
            if (!name) return;
            gameState.setName(name);
            this._showTab("tickets");
        });
        box.append(form);
        const teacher = button("game-link", `${icon("fa-chalkboard-user")} ${t("game.welcome.teacher")}`);
        teacher.addEventListener("click", () => this._showTab("teacher"));
        box.append(teacher);
        this.body.replaceChildren(box);
        /** @type {HTMLInputElement|null} */ (form.querySelector("input"))?.focus();
    }

    // ── Tickets ──────────────────────────────────────────────────────

    _renderTickets() {
        const wrap = el("div", "game-section");
        wrap.append(el("p", "game-lead", t("game.tickets.lead")));
        for (const no of ACTS) {
            const act = actText(no);
            const tickets = TICKETS.filter((tk) => tk.act === no);
            const solved = tickets.filter((tk) => gameState.data.results[tk.id]).length;
            const sec = el("section", "game-act");
            sec.append(el("h3", "game-act-title", `${t("game.tickets.act", { no, title: esc(act.title) })} <span class="game-muted">${solved}/${tickets.length}</span>`));
            sec.append(el("p", "game-act-intro", esc(act.intro)));
            const grid = el("div", "game-cards");
            for (const tk of tickets) {
                const tx = ticketText(tk.id);
                const r = gameState.data.results[tk.id];
                const card = button("game-card game-card--ticket" + (r ? " is-done" : ""), `
                    <span class="game-card-top"><span class="game-ticket-no">${ticketLabel(tk)}</span><span class="game-prio game-prio--${tk.prio}">${t(`game.prio.${tk.prio}`)}</span></span>
                    <span class="game-card-title">${esc(tx.title)}</span>
                    <span class="game-card-desc">${t("game.ticket.from", { from: esc(tx.from) })}</span>
                    <span class="game-card-kc">${icon("fa-bookmark")} ${esc(tx.kc)} · ${t("game.tickets.lesson", { lesson: tk.lesson })}</span>
                    <span class="game-card-status">${r ? `<span class="game-stars">${starsHtml(starsFor(r.best))}</span> ${t("game.status.points", { n: r.best })}` : `${icon("fa-circle", "fa-regular")} ${t("game.status.open")}`}</span>`);
                card.addEventListener("click", () => {
                    this.close();
                    void runTicket(this.sim, tk, { openHub: () => GameHub.show(this.sim, { tab: "tickets" }) });
                });
                grid.append(card);
            }
            sec.append(grid);
            wrap.append(sec);
        }
        this.body.replaceChildren(wrap);
    }

    // ── Intermezzos ──────────────────────────────────────────────────

    _renderIntermezzos() {
        const wrap = el("div", "game-section");
        wrap.append(el("p", "game-lead", t("game.intermezzos.lead")));
        const grid = el("div", "game-cards");
        for (const g of INTERMEZZOS) {
            const tx = intermezzoText(g.id);
            const r = gameState.data.results[g.id];
            const high = gameState.data.high[g.id];
            const arcade = g.kind !== "rounds";
            const card = button("game-card game-card--intermezzo" + (r ? " is-done" : "") + (arcade ? " game-card--arcade" : ""), `
                <span class="game-card-top"><span class="game-card-icon">${icon(g.icon)}</span>${arcade ? `<span class="game-tag">${t("game.intermezzos.arcade")}</span>` : ""}</span>
                <span class="game-card-title">${esc(tx.title)}</span>
                <span class="game-card-desc">${esc(tx.desc)}</span>
                <span class="game-card-kc">${icon("fa-bookmark")} ${esc(tx.kc)}</span>
                <span class="game-card-status">${r
                    ? `<span class="game-stars">${starsHtml(starsFor(r.best))}</span> ${t("game.status.best", { n: r.best })}${high ? ` · ${t("game.status.highscore", { points: high })}` : ""}`
                    : `${icon("fa-circle", "fa-regular")} ${t("game.status.notPlayed")}`}</span>`);
            card.addEventListener("click", () => this._playIntermezzo(g.id));
            grid.append(card);
        }
        wrap.append(grid);
        this.body.replaceChildren(wrap);
    }

    /** @param {string} id */
    _playIntermezzo(id) {
        const meta = ALL_INTERMEZZOS.find((g) => g.id === id);
        if (!meta) return;
        const tx = intermezzoText(id);
        this._stopGame();
        this.nav.hidden = true;
        const host = el("div", "game-section");
        this.body.replaceChildren(host);
        const onExit = () => this._showTab("intermezzos");
        if (meta.kind !== "rounds") {
            const arcadeOpts = {
                title: tx.title,
                onFinish: (/** @type {number} */ score) => gameState.record(id, score),
                onHighscore: (/** @type {number} */ points) => gameState.recordHighscore(id, points),
                onExit,
            };
            const view = meta.kind === "vlsm" ? new VlsmView(host, arcadeOpts)
                : meta.kind === "belt" ? new BinaryBeltView(host, arcadeOpts)
                : meta.kind === "guard" ? new GuardView(host, arcadeOpts)
                : new RoutingRushView(host, arcadeOpts);
            this.activeGame = view;
            view.start();
            return;
        }
        const game = MINIGAMES[id];
        if (!game) return;
        const round = new RoundGame(host, {
            title: tx.title,
            icon: meta.icon,
            intro: gameContent().games[/** @type {"binary"} */ (id)].intro,
            game,
            onFinish: (score) => gameState.record(id, score),
            onExit,
        });
        this.activeGame = round;
        round.start();
    }

    // ── Badges ───────────────────────────────────────────────────────

    _renderBadges() {
        const earned = new Set(gameState.earnedBadges().map((b) => b.id));
        const wrap = el("div", "game-section");
        wrap.append(el("p", "game-lead", t("game.badges.lead", { n: earned.size, total: BADGES.length })));
        const grid = el("div", "game-badges");
        for (const b of BADGES) {
            const has = earned.has(b.id);
            const tx = badgeText(b);
            grid.append(el("div", "game-badge" + (has ? " is-earned" : ""), `<span class="game-badge-icon">${icon(has ? b.icon : "fa-lock")}</span>
                <span class="game-badge-title">${esc(tx.title)}</span><span class="game-badge-desc">${esc(tx.desc)}</span>`));
        }
        wrap.append(grid);
        this.body.replaceChildren(wrap);
    }

    // ── Codes ────────────────────────────────────────────────────────

    _renderCodes() {
        const wrap = el("div", "game-section");
        const done = [
            ...ALL_INTERMEZZOS.map((g) => ({ id: g.id, title: intermezzoText(g.id).title })),
            ...TICKETS.map((tk) => ({ id: tk.id, title: `${t("game.ticket.label", { no: ticketLabel(tk) })}: ${ticketText(tk.id).title}` })),
        ].filter((g) => gameState.data.results[g.id]);
        if (done.length === 0) {
            wrap.append(el("p", "game-lead", t("game.codes.empty")));
            this.body.replaceChildren(wrap);
            return;
        }
        wrap.append(el("p", "game-lead", t("game.codes.lead", { name: `<strong>${esc(gameState.name)}</strong>` })));
        const table = el("table", "game-table");
        table.innerHTML = `<thead><tr><th>${t("game.codes.task")}</th><th>${t("game.codes.points")}</th><th>${t("game.codes.date")}</th><th>${t("game.codes.code")}</th></tr></thead>`;
        const tbody = el("tbody");
        /** @type {string[]} */
        const lines = [t("game.codes.nameLine", { name: gameState.name })];
        for (const g of done) {
            const r = gameState.data.results[g.id];
            const code = gameState.codeFor(g.id) ?? "";
            lines.push(t("game.codes.line", { title: g.title, points: r.best, code }));
            const tr = el("tr", "", `<td>${esc(g.title)}</td><td>${r.best}</td><td>${fmtDate(new Date(r.day))}</td><td></td>`);
            /** @type {HTMLElement} */ (tr.lastElementChild).append(codeChip(code));
            tbody.append(tr);
        }
        table.append(tbody);
        wrap.append(table);
        const all = button("game-btn", `${icon("fa-copy", "fa-regular")} ${t("game.codes.copyAll")}`);
        const pre = el("pre", "game-codes-text");
        pre.textContent = lines.join("\n");
        all.addEventListener("click", async () => {
            const ok = await copyText(pre.textContent ?? "", pre);
            all.innerHTML = ok ? `${icon("fa-check")} ${t("game.copied")}` : t("game.selected");
        });
        wrap.append(all, pre);
        this.body.replaceChildren(wrap);
    }

    // ── More: save transfer, new player, teacher ─────────────────────

    _renderMore() {
        const wrap = el("div", "game-section");

        const move = el("section", "game-more-block");
        move.append(el("h3", "", `${icon("fa-right-left")} ${t("game.more.move.title")}`));
        move.append(el("p", "game-muted", t("game.more.move.text")));
        const exp = /** @type {HTMLTextAreaElement} */ (el("textarea", "game-textarea"));
        exp.readOnly = true;
        exp.rows = 3;
        exp.value = gameState.exportSave();
        const copy = button("game-btn game-btn-small", `${icon("fa-copy", "fa-regular")} ${t("game.copy")}`);
        copy.addEventListener("click", async () => {
            exp.select();
            const ok = await copyText(exp.value);
            copy.innerHTML = ok ? `${icon("fa-check")} ${t("game.copied")}` : t("game.selected");
        });
        move.append(exp, copy);

        const imp = /** @type {HTMLTextAreaElement} */ (el("textarea", "game-textarea"));
        imp.rows = 3;
        imp.placeholder = t("game.more.move.placeholder");
        const impBtn = button("game-btn game-btn-small", `${icon("fa-file-import")} ${t("game.more.move.load")}`);
        impBtn.addEventListener("click", async () => {
            if (!imp.value.trim()) return;
            if (gameState.hasPlayer && !await SimDialog.confirm(t("game.more.move.replaceConfirm"))) return;
            if (gameState.importSave(imp.value)) this._showTab("tickets");
            else await SimDialog.alert(t("game.more.move.invalid"));
        });
        move.append(el("p", "game-muted game-small", t("game.more.move.loadIntro")), imp, impBtn);
        wrap.append(move);

        const reset = el("section", "game-more-block");
        reset.append(el("h3", "", `${icon("fa-user-plus")} ${t("game.more.reset.title")}`));
        reset.append(el("p", "game-muted", t("game.more.reset.text")));
        const resetBtn = button("game-btn game-btn-small game-btn-danger", `${icon("fa-trash-can")} ${t("game.more.reset.button")}`);
        resetBtn.addEventListener("click", async () => {
            if (!await SimDialog.confirm(t("game.more.reset.confirm", { name: gameState.name }))) return;
            gameState.reset();
            this._showWelcome();
        });
        reset.append(resetBtn);
        wrap.append(reset);

        const teacher = el("section", "game-more-block");
        teacher.append(el("h3", "", `${icon("fa-chalkboard-user")} ${t("game.more.teacher.title")}`));
        teacher.append(el("p", "game-muted", t("game.more.teacher.text")));
        const tBtn = button("game-btn game-btn-small", `${t("game.more.teacher.button")} ${icon("fa-arrow-right")}`);
        tBtn.addEventListener("click", () => this._showTab("teacher"));
        teacher.append(tBtn);
        wrap.append(teacher);

        this.body.replaceChildren(wrap);
    }

    _renderTeacher() {
        this.nav.hidden = !gameState.hasPlayer;
        const wrap = el("div", "game-section");
        wrap.append(el("h3", "", `${icon("fa-chalkboard-user")} ${t("game.teacher.title")}`));
        wrap.append(el("p", "game-lead", t("game.teacher.lead")));
        const ta = /** @type {HTMLTextAreaElement} */ (el("textarea", "game-textarea game-textarea--tall"));
        ta.rows = 6;
        ta.placeholder = t("game.teacher.placeholder");
        const btn = button("game-btn game-btn-primary", `${icon("fa-magnifying-glass")} ${t("game.teacher.check")}`);
        const out = el("div", "game-teacher-out");
        btn.addEventListener("click", () => {
            out.replaceChildren();
            const rows = ta.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            if (rows.length === 0) return;
            const table = el("table", "game-table");
            table.innerHTML = `<thead><tr><th>${t("game.teacher.name")}</th><th>${t("game.codes.task")}</th><th>${t("game.codes.points")}</th><th>${t("game.codes.date")}</th><th>${t("game.teacher.result")}</th></tr></thead>`;
            const tbody = el("tbody");
            for (const line of rows) {
                const m = line.match(/^(.*?)[\s;,:|\t]+([0-9A-Za-z]{4}-?[0-9A-Za-z]{4}-?[0-9A-Za-z]{4})\s*$/);
                const tr = el("tr");
                if (!m) {
                    tr.innerHTML = `<td colspan="4">${esc(line)}</td><td class="is-err">${t("game.teacher.unparsed")}</td>`;
                } else {
                    const name = m[1].trim();
                    const res = verifyCode(m[2], name);
                    const title = res.valid ? gameTitle(res.gameNo ?? 0) ?? t("game.teacher.unknownGame", { no: res.gameNo ?? 0 }) : "";
                    tr.innerHTML = res.valid
                        ? `<td>${esc(name)}</td><td>${esc(title)}</td><td>${res.score}</td><td>${res.date ? fmtDate(res.date) : ""}</td><td class="is-ok">${icon("fa-circle-check")} ${t("game.teacher.valid")}</td>`
                        : `<td>${esc(name)}</td><td colspan="3" class="game-muted">${esc(m[2])}</td><td class="is-err">${icon("fa-circle-xmark")} ${t("game.teacher.invalid")}</td>`;
                }
                tbody.append(tr);
            }
            table.append(tbody);
            out.append(table);
        });
        wrap.append(ta, btn, out);
        wrap.append(el("p", "game-muted game-small", `${icon("fa-circle-info")} ${t("game.teacher.note")}`));
        if (!gameState.hasPlayer) {
            const back = button("game-link", `${icon("fa-arrow-left")} ${t("game.teacher.back")}`);
            back.addEventListener("click", () => this._showWelcome());
            wrap.append(back);
        }
        this.body.replaceChildren(wrap);
        ta.focus();
    }
}
