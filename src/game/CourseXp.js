//@ts-check
// XP for the regular course: quizzes and ":::task" checks in the lessons
// panel feed into the game. Only the first evaluation of each quiz counts
// (so "try again until right" earns nothing extra); a task counts once it
// passes. Toasts only appear once the student has started the game.

import { t } from "../i18n/index.js";
import { badgeText } from "./GameCatalog.js";
import { gameState } from "./GameState.js";
import { esc, icon, toast } from "./ui.js";

const QUIZ_XP = 5;
const TASK_XP = 10;

/** @param {{ gained: number, newBadges: import("./GameCatalog.js").Badge[] }} res @param {string} what */
function announce(res, what) {
    if (!gameState.hasPlayer) return;
    if (res.gained > 0) toast(`${icon("fa-bolt")} ${t("game.result.xp", { xp: res.gained })} <span class="game-muted">${what}</span>`);
    for (const b of res.newBadges) toast(`${icon(b.icon)} ${t("game.result.badge", { title: `<strong>${esc(badgeText(b).title)}</strong>` })}`);
}

/** @param {import("../SimControl.js").SimControl} sim */
export function initCourseXp(sim) {
    const mount = sim.lessonsMount;
    if (!mount) return;

    mount.addEventListener("quiz-evaluated", (ev) => {
        const href = sim.lessonsPanel?.currentHref;
        if (!href || sim.lessonsPanel?.showsExternal) return;
        const { ids, correct, total } = /** @type {CustomEvent} */ (ev).detail ?? {};
        if (!Array.isArray(ids) || !total) return;
        const res = gameState.awardCourse(`q:${href}:${ids.join(",")}`, (QUIZ_XP * correct) / total);
        announce(res, t("game.toast.quiz"));
    });

    mount.addEventListener("lesson-task-checked", (ev) => {
        const { href, allOk } = /** @type {CustomEvent} */ (ev).detail ?? {};
        if (!href || !allOk) return;
        const blocks = [...mount.querySelectorAll(".task-block")];
        const idx = blocks.indexOf(/** @type {Element} */ (ev.target));
        const res = gameState.awardCourse(`t:${href}:${idx}`, TASK_XP);
        announce(res, t("game.toast.task"));
    });
}
