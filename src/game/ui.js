//@ts-check
// Small UI pieces shared by the game views: the result card, the save file
// download, and toasts for XP/badges earned in the regular course.

import { t } from "../i18n/index.js";
import { badgeText, rankFor, rankTitle } from "./GameCatalog.js";

/** @param {string} tag @param {string} [className] @param {string} [html] */
export function el(tag, className, html) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (html !== undefined) e.innerHTML = html;
    return e;
}

/** A button with an optional Font Awesome icon in front of (or after) its label. @param {string} className @param {string} html */
export function button(className, html) {
    const b = /** @type {HTMLButtonElement} */ (el("button", className, html));
    b.type = "button";
    return b;
}

/** @param {string} name e.g. "fa-arrow-right" @param {string} [style] */
export function icon(name, style = "fa-solid") {
    return `<i class="${style} ${name}" aria-hidden="true"></i>`;
}

/** @param {string} s */
export function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** @param {number} score @returns {number} 0–3 */
export function starsFor(score) {
    return score >= 90 ? 3 : score >= 70 ? 2 : score >= 50 ? 1 : 0;
}

/**
 * @param {number} n
 * @param {{ solidEmpty?: boolean }} [opts] solidEmpty = missing stars filled but greyed (hub cards)
 */
export function starsHtml(n, { solidEmpty = false } = {}) {
    return [0, 1, 2].map((i) => icon("fa-star", i < n ? "fa-solid" : solidEmpty ? "fa-solid game-star-empty" : "fa-regular")).join("");
}

/**
 * Offers a text file for download (same way the simulation is saved).
 * @param {string} filename @param {string} text
 */
export function downloadText(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * The result card after an intermezzo or ticket.
 * @param {{ title: string, score: number, detail: string, outcome: import("./GameState.js").RecordOutcome|null, headline?: string }} opts
 *   outcome null = practice run, nothing recorded
 * @returns {HTMLElement}
 */
export function renderOutcome({ title, score, detail, outcome, headline }) {
    const box = el("div", "game-result");
    const stars = starsFor(score);
    const cheer = headline ?? t(score >= 90 ? "game.result.cheer.great" : score >= 70 ? "game.result.cheer.good" : score >= 50 ? "game.result.cheer.ok" : "game.result.cheer.low");

    box.innerHTML = `
        <p class="game-result-title">${title}</p>
        <p class="game-result-stars" aria-label="${esc(t("game.result.stars", { n: stars }))}">${starsHtml(stars)}</p>
        <p class="game-result-score">${t("game.result.score", { n: `<strong>${score}</strong>` })}</p>
        <p class="game-result-cheer">${cheer} <span class="game-muted">${detail}</span></p>`;
    if (!outcome) {
        box.append(el("p", "game-result-xp game-muted", t("game.result.practice")));
        return box;
    }
    const gained = outcome.xpAfter - outcome.xpBefore;
    box.append(el("p", "game-result-xp", outcome.newBest
        ? `${icon("fa-bolt")} ${t("game.result.xp", { xp: gained })}${gained > 0 ? t("game.result.newBest") : ""}`
        : `<span class="game-muted">${t("game.result.noBest")}</span>`));
    const rankBefore = rankFor(outcome.xpBefore);
    const rankAfter = rankFor(outcome.xpAfter);
    if (rankAfter.index > rankBefore.index) {
        box.append(el("p", "game-result-rankup", `${icon("fa-arrow-up-wide-short")} ${t("game.result.rankUp", { rank: `<strong>${esc(rankTitle(rankAfter.index))}</strong>` })}`));
    }
    for (const b of outcome.newBadges) {
        box.append(el("p", "game-result-badge", `${icon(b.icon)} ${t("game.result.badge", { title: `<strong>${esc(badgeText(b).title)}</strong>` })}`));
    }
    return box;
}

/** @type {HTMLElement|null} */
let toastHost = null;

/**
 * A short, unobtrusive message in the corner (XP from course quizzes).
 * @param {string} html
 */
export function toast(html) {
    if (!toastHost || !toastHost.isConnected) {
        toastHost = el("div", "game-toasts");
        toastHost.setAttribute("aria-live", "polite");
        document.body.append(toastHost);
    }
    const item = el("div", "game-toast", html);
    toastHost.append(item);
    setTimeout(() => item.classList.add("is-leaving"), 2600);
    setTimeout(() => item.remove(), 3100);
}
