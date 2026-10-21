//@ts-check
// A helpdesk ticket: shown in the lessons panel next to its simulation.
// The student repairs the network, lets the checks verify it, answers one
// question about the cause and gets a score.
//
// Scoring: start at 100; each hint −10, each failed check run −5 (at most
// −20), a wrong answer to the cause question −10. Solving always gives at
// least 40.

import { t } from "../i18n/index.js";
import { TICKETS, actText, ticketText } from "./GameCatalog.js";
import { gameState } from "./GameState.js";
import { button, el, esc, icon, renderOutcome } from "./ui.js";

/** @typedef {import("./GameCatalog.js").Ticket} Ticket */

const HINT_COST = 10;
const FAIL_COST = 5;
const FAIL_CAP = 20;
const WRONG_COST = 10;
const FLOOR = 40;

/** Ticket number as shown on the ticket — looks like a real helpdesk. @param {Ticket} tk */
export function ticketLabel(tk) {
    return `#${1000 + tk.no * 37}`;
}

/**
 * @param {import("../SimControl.js").SimControl} sim
 * @param {Ticket} ticket
 * @param {{ openHub: () => void }} nav
 * @returns {Promise<void>}
 */
export async function runTicket(sim, ticket, nav) {
    const panel = sim.lessonsPanel;
    if (!panel) return;
    const tx = ticketText(ticket.id);
    const act = actText(ticket.act);

    let hintsUsed = 0;
    let failedRuns = 0;
    let solved = false;

    const root = el("div", "game-ticket");

    const head = el("div", "game-ticket-head");
    head.innerHTML = `
        <div class="game-ticket-meta">
            <span class="game-ticket-no">${t("game.ticket.label", { no: ticketLabel(ticket) })}</span>
            <span class="game-prio game-prio--${ticket.prio}">${t("game.ticket.prio", { prio: t(`game.prio.${ticket.prio}`) })}</span>
        </div>
        <h2 class="game-ticket-title">${esc(tx.title)}</h2>
        <p class="game-ticket-from">${icon("fa-user")} ${t("game.ticket.from", { from: esc(tx.from) })}
            <span class="game-muted"> · ${t("game.ticket.act", { no: ticket.act, title: esc(act.title) })}</span></p>`;
    root.append(head);

    /** @param {number} extra */
    const currentScore = (extra) => Math.max(FLOOR, 100 - hintsUsed * HINT_COST - Math.min(FAIL_CAP, failedRuns * FAIL_COST) - extra);
    const score = el("p", "game-ticket-score");
    const updateScore = () => {
        score.innerHTML = `${icon("fa-bolt")} ${t("game.ticket.remaining", { n: `<strong>${currentScore(0)}</strong>` })}`;
    };
    root.append(score);

    root.append(el("div", "game-ticket-story", `<p>${tx.story}</p>`));
    if ("plan" in tx && tx.plan) {
        const table = el("table", "game-ticket-plan");
        table.innerHTML = `<thead><tr>${tx.plan.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
            <tbody>${tx.plan.rows.map((r) => `<tr>${r.map((c, i) => i === 0 ? `<td>${esc(c)}</td>` : `<td><code>${esc(c)}</code></td>`).join("")}</tr>`).join("")}</tbody>`;
        root.append(el("p", "game-ticket-plan-cap", t("game.ticket.planCaption")), table);
    }

    // ── Goals (also the check results) ──
    root.append(el("h3", "game-ticket-h", `${icon("fa-list-check")} ${t("game.ticket.goals")}`));
    const goals = el("ul", "game-ticket-goals");
    const goalItems = ticket.checks.map((_, i) => {
        const li = el("li", "game-goal", `${icon("fa-square", "fa-regular")} ${esc(tx.checks[i] ?? "")}`);
        goals.append(li);
        return li;
    });
    root.append(goals);

    // ── Hints ──
    const hintBox = el("div", "game-ticket-hints");
    const renderHints = () => {
        hintBox.replaceChildren();
        tx.hints.forEach((h, i) => {
            if (i < hintsUsed) hintBox.append(el("p", "game-hint", `${t("game.ticket.hint", { n: i + 1 })} ${esc(h)}`));
        });
        if (hintsUsed < tx.hints.length && !solved) {
            const b = button("game-btn game-btn-small", `${icon("fa-lightbulb", "fa-regular")} ${t("game.ticket.revealHint", { n: hintsUsed + 1, cost: HINT_COST })}`);
            b.addEventListener("click", () => {
                hintsUsed++;
                renderHints();
                updateScore();
            });
            hintBox.append(b);
        }
    };
    root.append(hintBox);

    // ── Check ──
    const checkRow = el("div", "game-ticket-check");
    const checkBtn = button("game-btn game-btn-primary", `${icon("fa-stethoscope")} ${t("game.ticket.check")}`);
    const checkMsg = el("span", "game-ticket-check-msg");
    checkMsg.setAttribute("aria-live", "polite");
    checkRow.append(checkBtn, checkMsg);
    root.append(checkRow);
    root.append(el("p", "game-muted game-small", t("game.ticket.checkNote", { icon: icon("fa-play") })));

    const after = el("div", "game-ticket-after");
    root.append(after);

    checkBtn.addEventListener("click", async () => {
        if (checkBtn.disabled) return;
        checkBtn.disabled = true;
        checkMsg.textContent = t("game.ticket.checking");
        checkMsg.className = "game-ticket-check-msg";
        try {
            const results = await panel.checkApi.runChecks(ticket.checks);
            results.forEach((r, i) => {
                const li = goalItems[i];
                li.classList.toggle("is-ok", r.ok);
                li.classList.toggle("is-err", !r.ok);
                li.innerHTML = `${r.ok ? icon("fa-square-check") : icon("fa-square", "fa-regular")} ${esc(tx.checks[i] ?? "")}`;
            });
            const okCount = results.filter((r) => r.ok).length;
            if (okCount === results.length && results.length > 0) {
                solved = true;
                checkMsg.textContent = t("game.ticket.allDone");
                checkMsg.className = "game-ticket-check-msg is-ok";
                renderHints();
                showQuestion();
            } else {
                failedRuns++;
                updateScore();
                checkMsg.textContent = t("game.ticket.partial", { ok: okCount, total: results.length });
                checkMsg.className = "game-ticket-check-msg is-err";
                checkBtn.disabled = false;
            }
        } catch (err) {
            console.error("[Game] ticket check failed", err);
            checkMsg.textContent = t("game.ticket.checkFailed");
            checkBtn.disabled = false;
        }
    });

    const showQuestion = () => {
        checkBtn.hidden = true;
        const q = el("div", "game-ticket-question");
        q.append(el("h3", "game-ticket-h", `${icon("fa-circle-question")} ${t("game.ticket.close", { question: esc(tx.question.text) })}`));
        const opts = el("div", "game-choices game-choices--list");
        tx.question.options.forEach((text, i) => {
            const b = button("game-choice", esc(text));
            b.addEventListener("click", () => {
                opts.querySelectorAll("button").forEach((x) => { /** @type {HTMLButtonElement} */ (x).disabled = true; });
                const ok = i === ticket.answer;
                b.classList.add(ok ? "is-correct" : "is-wrong");
                opts.children[ticket.answer]?.classList.add("is-correct");
                finish(ok);
            });
            opts.append(b);
        });
        q.append(opts);
        after.append(q);
        q.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    /** @param {boolean} answeredRight */
    const finish = (answeredRight) => {
        const final = currentScore(answeredRight ? 0 : WRONG_COST);
        updateScore();
        after.append(el("div", "game-ticket-learned", `<p>${icon("fa-graduation-cap")} ${t("game.ticket.learned", { text: tx.lessonLearned })}</p>`));
        const outcome = gameState.record(ticket.id, final, { noHints: hintsUsed === 0 });
        const result = renderOutcome({
            title: t("game.ticket.closed", { no: ticketLabel(ticket) }),
            score: final,
            detail: t("game.ticket.detail", { hints: hintsUsed, fails: failedRuns }) + (answeredRight ? "" : t("game.ticket.detailWrong")),
            outcome,
        });
        const actions = el("div", "game-actions");
        const next = TICKETS[TICKETS.indexOf(ticket) + 1];
        if (next) {
            const b = button("game-btn", `${t("game.ticket.next", { title: esc(ticketText(next.id).title) })} ${icon("fa-arrow-right")}`);
            b.addEventListener("click", () => void runTicket(sim, next, nav));
            actions.append(b);
        }
        const hub = button("game-btn game-btn-primary", `${icon("fa-gamepad")} ${t("game.play.toHub")}`);
        hub.addEventListener("click", () => nav.openHub());
        actions.append(hub);
        result.append(actions);
        after.append(result);
        result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    const back = button("game-btn game-btn-ghost game-ticket-back", `${icon("fa-gamepad")} ${t("game.ticket.hubShort")}`);
    back.addEventListener("click", () => nav.openHub());
    head.prepend(back);

    renderHints();
    updateScore();
    await panel.showExternal({ label: `${t("game.ticket.label", { no: ticketLabel(ticket) })}: ${tx.title}`, content: root, simUrl: ticket.sim });
}
