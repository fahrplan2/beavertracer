//@ts-check
import { t, getLocale } from "../i18n/index.js";
import { SimDialog } from "./SimDialog.js";
import { initQuizBlocks } from "./QuizInteractions.js";
import { CheckApi } from "../lessons/CheckApi.js";
import { setParam, clearParams } from "./AppUrl.js";

const WIDTH_STORAGE_KEY = "bt.lessonsPanelWidth";
const MIN_WIDTH = 280;
const DEFAULT_WIDTH = 380;

/** Thrown for a 404 — distinguished from other failures so the panel can
 *  show "not available in your language" instead of a generic load error. */
class LessonNotFoundError extends Error {}

/** @typedef {{url: string}|{empty: true}} LessonSim a page's ":::sim" declaration */
/** @typedef {{href: string, title: string, num: number[]|null, draft?: boolean, sim?: LessonSim|null}} LessonPage */
/** @typedef {{first: string, pages: LessonPage[]}} LessonManifest */

/**
 * Fetches lesson content (built by vite-plugin-lessons.mjs as per-page .json
 * files alongside the standalone HTML) and renders it into the docked
 * lessons panel of a live SimControl instance, with a chapter overview as
 * its start page and prev/overview/next buttons above and below each
 * lesson. Each page's simulation (its own ":::sim" or the nearest preceding
 * page's) is loaded into that same SimControl automatically on every page
 * change, so every page starts from a known state. Also intercepts in-lesson navigation links so browsing lessons
 * never leaves/reloads the app, and makes the panel's width draggable.
 */
export class LessonsPanel {
    /** @param {import("../SimControl.js").SimControl} simControl */
    constructor(simControl) {
        this.simControl = simControl;
        this.checkApi = new CheckApi(simControl);

        /** @type {string|null} href of the currently displayed lesson, e.g. "01-einfuehrung.html" */
        this._currentHref = null;

        /** @type {"overview"|"lesson"|null} what the panel currently shows, null = nothing yet */
        this._view = null;

        /** @type {LessonManifest|null} */
        this._manifest = null;

        /** @type {HTMLButtonElement|null} */
        this._homeBtn = null;

        /** @type {HTMLSpanElement|null} */
        this._currentLabel = null;

        /** @type {HTMLButtonElement|null} */
        this._resetBtn = null;


        // _quiz.js reads its "N of M points" i18n templates off document.body's
        // dataset. Those keys (lessons.quiz.result.*) live in the same locale
        // files the app's own t() already reads, so no separate lookup is needed.
        document.body.dataset.quizResultOne = t("lessons.quiz.result.one");
        document.body.dataset.quizResultOther = t("lessons.quiz.result.other");
        document.body.dataset.quizRetry = t("lessons.quiz.retry");

        const mount = this.simControl.lessonsMount;
        mount?.addEventListener("click", (ev) => this._onClick(/** @type {MouseEvent} */ (ev)));

        this._buildHeader();
        this._restorePanelWidth();
        this._wireResizeHandle();
    }

    /** Applies the last saved panel width (or the CSS default) up front, before the panel is ever opened. */
    _restorePanelWidth() {
        const root = this.simControl.root;
        if (!root) return;
        const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
        if (Number.isFinite(saved) && saved >= MIN_WIDTH) {
            root.style.setProperty("--lessons-width", `${saved}px`);
        }
    }

    /** Wires drag-to-resize on the panel's left-edge handle. */
    _wireResizeHandle() {
        const root = this.simControl.root;
        const handle = this.simControl.lessonsResizeHandle;
        if (!root || !handle) return;

        handle.addEventListener("pointerdown", (/** @type {PointerEvent} */ ev) => {
            ev.preventDefault();
            const startX = ev.clientX;
            const startWidth = this.simControl.lessonsPanelEl?.getBoundingClientRect().width ?? DEFAULT_WIDTH;
            const maxWidth = Math.min(1400, root.getBoundingClientRect().width * 0.7);

            root.classList.add("lessons-resizing");
            handle.setPointerCapture?.(ev.pointerId);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";

            /** @param {PointerEvent} moveEv */
            const onMove = (moveEv) => {
                // Handle sits on the panel's LEFT edge, panel is anchored to
                // the right — dragging left (negative delta) must widen it.
                const delta = moveEv.clientX - startX;
                const width = Math.max(MIN_WIDTH, Math.min(maxWidth, startWidth - delta));
                root.style.setProperty("--lessons-width", `${Math.round(width)}px`);
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onUp, true);
                root.classList.remove("lessons-resizing");
                document.body.style.cursor = "";
                document.body.style.userSelect = "";

                const finalWidth = parseFloat(root.style.getPropertyValue("--lessons-width")) || DEFAULT_WIDTH;
                localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(finalWidth)));
            };
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onUp, true);
        });
    }

    /**
     * Shows the chapter overview the first time the panel opens; on reopen
     * the current page is shown again — with its simulation freshly loaded.
     */
    async ensureLoaded() {
        if (this._view === "lesson" && this._currentHref) await this.load(this._currentHref);
        else if (!this._view) await this.showOverview();
    }

    /**
     * Fetches (and caches) the language's chapter list.
     * @returns {Promise<LessonManifest>}
     */
    async _loadManifest() {
        if (this._manifest) return this._manifest;
        const manifest = await this._fetchLessonJson(`/lessons/${getLocale()}/index.json`);
        this._manifest = manifest;
        return manifest;
    }

    /**
     * Fetches and parses a lesson .json file. A missing file (404) or a
     * non-JSON response (some dev/prod server configs fall back to serving
     * index.html with a 200 for any unmatched path) both mean the same
     * thing here — this lesson isn't available in the current language —
     * so both surface as LessonNotFoundError rather than a generic error.
     * @param {string} url
     */
    async _fetchLessonJson(url) {
        const res = await fetch(url);
        if (!res.ok || !res.headers.get("content-type")?.includes("json")) {
            throw new LessonNotFoundError();
        }
        try {
            return await res.json();
        } catch {
            throw new LessonNotFoundError();
        }
    }

    /** @param {unknown} err @returns {string} */
    _errorMessage(err) {
        return err instanceof LessonNotFoundError ? t("lessons.notAvailableInLanguage") : t("lessons.loadError");
    }

    /**
     * Pages that show up in the overview and prev/next — drafts (":::draft"
     * in the source) are skipped unless ?debug=1. `keepHref` stays in even
     * if it's a draft, so a deep-linked draft page still gets neighbours.
     * @param {string|null} [keepHref]
     * @returns {LessonPage[]}
     */
    _visiblePages(keepHref = null) {
        const pages = this._manifest?.pages ?? [];
        return pages.filter((p) => !p.draft || this.simControl.debug || p.href === keepHref);
    }

    /** @param {LessonPage} page e.g. "1.2 Erste Simulation" */
    _pageLabel(page) {
        return (page.num?.length ? page.num.join(".") + " " : "") + page.title;
    }

    /** Builds the panel's header strip (overview button + current page title) once. */
    _buildHeader() {
        const navMount = this.simControl.lessonsNavMount;
        if (!navMount) return;
        navMount.innerHTML = "";

        const homeBtn = document.createElement("button");
        homeBtn.type = "button";
        homeBtn.className = "sim-lessons-home";
        homeBtn.title = t("lessons.overview.title");
        homeBtn.innerHTML = `<i class="fa-solid fa-list" aria-hidden="true"></i>`;
        homeBtn.addEventListener("click", () => this.showOverview());

        const current = document.createElement("span");
        current.className = "sim-lessons-current";

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "sim-lessons-reset";
        resetBtn.title = t("lessons.sim.reset");
        resetBtn.innerHTML = `<i class="fa-solid fa-rotate-left" aria-hidden="true"></i>`;
        resetBtn.disabled = true;
        resetBtn.addEventListener("click", () => this.resetSim());

        navMount.append(homeBtn, current, resetBtn);
        this._homeBtn = homeBtn;
        this._currentLabel = current;
        this._resetBtn = resetBtn;
    }

    /** @param {string|null} href currently shown page, null = overview */
    _updateHeader(href) {
        const page = href ? this._manifest?.pages.find((p) => p.href === href) : null;
        if (this._currentLabel) {
            this._currentLabel.textContent = page ? this._pageLabel(page) : t("lessons.overview.title");
        }
        if (this._homeBtn) this._homeBtn.disabled = !href;
    }

    // ── Lesson simulations ────────────────────────────────────────────────────

    /**
     * Takes over the SimControl's scene for lessons mode. The user's own
     * simulation is discarded — after asking to save it first if it has
     * unsaved changes. A scene the lessons panel loaded itself is kept.
     * @returns {Promise<boolean>} false if the user cancelled
     */
    async claimScene() {
        const sim = this.simControl;
        if (sim.lessonScene) return true;

        if (sim._isDirty) {
            const choice = await SimDialog.choose(t("lessons.sim.unsavedPrompt"), [
                { value: "discard", label: t("lessons.sim.discard") },
                { value: "save", label: t("sim.save") },
            ]);
            if (choice === null) return false;
            if (choice === "save") {
                await sim.download();
                if (sim._isDirty) return false; // filename prompt cancelled
            }
        }

        sim.new();
        sim.lessonScene = true;
        this._updateResetBtn();
        return true;
    }

    /**
     * The page a lesson's simulation comes from: the page itself if it has
     * a ":::sim", else the nearest preceding page (in reading order) that
     * has one. Drafts count too, so the result doesn't depend on ?debug=1.
     * @param {string} href
     * @returns {{source: string, sim: LessonSim|null}} source "" = none
     */
    _simSourceFor(href) {
        /** @type {{source: string, sim: LessonSim|null}} */
        let found = { source: "", sim: null };
        for (const page of this._manifest?.pages ?? []) {
            if (page.sim) found = { source: page.href, sim: page.sim };
            if (page.href === href) break;
        }
        return found;
    }

    /**
     * Loads `href`'s start simulation — on every page change, so each page
     * starts from a known state. Work worth keeping is taken over with the
     * toolbar's "adopt" button (SimControl.adoptLessonScene) first.
     * @param {string} href
     */
    async _syncSim(href) {
        if (!await this.claimScene()) return;
        await this._loadLessonSim(this._simSourceFor(href));
    }

    /** @param {{source: string, sim: LessonSim|null}} target */
    async _loadLessonSim(target) {
        const sim = this.simControl;
        try {
            if (target.sim && "url" in target.sim) {
                const res = await fetch(target.sim.url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                await sim.restore(await res.json());
            } else {
                sim.new();
            }
        } catch (err) {
            console.error("[LessonsPanel] failed to load scenario", target.sim, err);
            sim.new();
        }
        sim.lessonScene = true;
        this._updateResetBtn();
    }

    /** Restores the current page's simulation to its start state. @returns {Promise<void>} */
    async resetSim() {
        if (!this._currentHref || !this.simControl.lessonScene) return;
        if (!await SimDialog.confirm(t("lessons.sim.resetConfirm"))) return;
        await this._loadLessonSim(this._simSourceFor(this._currentHref));
    }

    _updateResetBtn() {
        if (this._resetBtn) this._resetBtn.disabled = this._view !== "lesson" || !this.simControl.lessonScene;
    }

    /** Renders the chapter overview (main menu) into the panel. @returns {Promise<void>} */
    async showOverview() {
        const mount = this.simControl.lessonsMount;
        if (!mount) return;

        try {
            await this._loadManifest();
        } catch (err) {
            mount.innerHTML = `<p class="lesson-load-error">${this._errorMessage(err)}</p>`;
            console.error("[LessonsPanel] failed to load lesson index", err);
            return;
        }

        this._view = "overview";
        mount.replaceChildren(this._buildOverview());
        mount.scrollTop = 0;
        this._updateHeader(null);
        this._updateResetBtn();
        clearParams(["lesson"]);
    }

    /**
     * Chapter list: top-level chapters with their direct sub-chapters below.
     * Deeper pages (e.g. "1.1.3") would make it unwieldy and stay reachable
     * via prev/next and in-text links instead. The chapter containing the
     * last opened page is highlighted.
     * @returns {HTMLElement}
     */
    _buildOverview() {
        const wrap = document.createElement("div");
        wrap.className = "lesson-overview";

        const currentNum = this._manifest?.pages.find((p) => p.href === this._currentHref)?.num ?? null;
        /** @param {LessonPage} page */
        const containsCurrent = (page) =>
            !!page.num?.length && !!currentNum && page.num.every((n, i) => n === currentNum[i]);

        const list = document.createElement("ol");
        list.className = "lesson-overview-list";

        /** @type {HTMLOListElement|null} */
        let subList = null;
        for (const page of this._visiblePages()) {
            const depth = page.num?.length ?? 1;
            if (depth > 2) continue;

            const link = document.createElement("a");
            link.href = page.href;
            link.className = "lesson-overview-link";
            if (containsCurrent(page)) link.classList.add("is-current");
            const num = document.createElement("span");
            num.className = "lesson-overview-num";
            num.textContent = page.num?.join(".") ?? "";
            const title = document.createElement("span");
            title.className = "lesson-overview-title";
            title.textContent = page.title;
            link.append(num, title);

            const li = document.createElement("li");
            li.appendChild(link);
            if (depth === 2 && subList) {
                subList.appendChild(li);
                continue;
            }
            li.className = "lesson-overview-chapter";
            subList = document.createElement("ol");
            subList.className = "lesson-overview-sub";
            li.appendChild(subList);
            list.appendChild(li);
        }
        list.querySelectorAll(".lesson-overview-sub:empty").forEach((el) => el.remove());

        wrap.appendChild(list);
        return wrap;
    }

    /**
     * "← Zurück | Übersicht | Weiter →" — shown above and below every page.
     * At either end of the course the outer buttons lead back to the
     * overview instead of being dead.
     * @param {string} href
     * @returns {HTMLElement}
     */
    _buildNavRow(href) {
        const pages = this._visiblePages(href);
        const idx = pages.findIndex((p) => p.href === href);
        const prev = idx > 0 ? pages[idx - 1] : null;
        const next = idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null;

        /**
         * @param {string} className
         * @param {string} html
         * @param {LessonPage|null} target null = overview
         */
        const button = (className, html, target) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `lesson-nav-btn ${className}`;
            btn.innerHTML = html;
            btn.dataset.lessonTarget = target?.href ?? "";
            btn.title = target ? this._pageLabel(target) : t("lessons.overview.title");
            return btn;
        };

        const row = document.createElement("nav");
        row.className = "lesson-nav-row";
        row.setAttribute("aria-label", t("lessons.pageNav"));
        row.append(
            button("lesson-nav-btn-prev", `<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> ${t("lessons.nav.prev")}`, prev),
            button("lesson-nav-btn-overview", `<i class="fa-solid fa-list" aria-hidden="true"></i> ${t("lessons.nav.overview")}`, null),
            next
                ? button("lesson-nav-btn-next", `${t("lessons.nav.next")} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>`, next)
                : button("lesson-nav-btn-next", `${t("lessons.nav.toOverview")} <i class="fa-solid fa-list" aria-hidden="true"></i>`, null),
        );
        return row;
    }

    /** @param {string} href e.g. "01-einfuehrung.html" @returns {Promise<void>} */
    async load(href) {
        const mount = this.simControl.lessonsMount;
        if (!mount) return;

        try {
            if (!this._manifest) await this._loadManifest();

            const jsonHref = href.replace(/\.html$/, ".json");
            const data = await this._fetchLessonJson(`/lessons/${getLocale()}/${jsonHref}`);

            this._currentHref = href;
            this._view = "lesson";
            mount.innerHTML = data.bodyHtml;
            // The body's own text-link prev/next (built for the standalone
            // site) is replaced by the button rows above and below.
            mount.querySelector(":scope > .lesson-nav")?.remove();
            // ":::sim" launch links are for the standalone site — here the
            // page's simulation is loaded automatically (_syncSim below).
            mount.querySelectorAll(".lesson-sim-launch").forEach((el) => el.remove());
            mount.prepend(this._buildNavRow(href));
            mount.append(this._buildNavRow(href));
            mount.scrollTop = 0;
            initQuizBlocks(mount);
            this._updateHeader(href);
            // Keeps the URL sharable/deep-linkable to whatever's currently
            // shown, however the student got there (overview, prev/next,
            // an in-text link, or the initial ?lesson= deep link itself).
            setParam("lesson", href);
            await this._syncSim(href);
            this._updateResetBtn();
        } catch (err) {
            // This specific page doesn't exist in the current language (e.g.
            // right after a language switch — window.location.reload() re-runs
            // the ?lesson= deep link in the new locale) but the language does
            // have lessons — fall back to its overview instead of a dead end.
            if (err instanceof LessonNotFoundError && this._manifest) {
                return this.showOverview();
            }
            mount.innerHTML = `<p class="lesson-load-error">${this._errorMessage(err)}</p>`;
            console.error("[LessonsPanel] failed to load lesson", href, err);
        }
    }

    /** @param {MouseEvent} ev */
    _onClick(ev) {
        const target = /** @type {HTMLElement|null} */ (ev.target instanceof HTMLElement ? ev.target : null);
        if (!target) return;

        // Prev/next/overview buttons (see _buildNavRow).
        const navBtn = target.closest("[data-lesson-target]");
        if (navBtn instanceof HTMLElement) {
            ev.preventDefault();
            const targetHref = navBtn.dataset.lessonTarget;
            if (targetHref) this.load(targetHref);
            else this.showOverview();
            return;
        }

        // ":::task" check button — run the block's checks against the live
        // simulation and report pass/fail.
        const taskBtn = target.closest(".task-check-btn");
        if (taskBtn instanceof HTMLButtonElement) {
            ev.preventDefault();
            this._runTaskChecks(taskBtn);
            return;
        }

        // In-panel navigation: intercept same-directory lesson links (prev/next
        // nav, in-text cross-references) instead of leaving/reloading the app.
        const link = target.closest("a[href]");
        if (link instanceof HTMLAnchorElement) {
            const href = link.getAttribute("href") || "";
            if (/^[\w.-]+\.html$/.test(href)) {
                ev.preventDefault();
                this.load(href);
            }
        }
    }

    /** @param {HTMLButtonElement} btn */
    async _runTaskChecks(btn) {
        if (btn.disabled) return;
        const block = btn.closest(".task-block");
        if (!(block instanceof HTMLElement)) return;

        /** @type {{fn: string, args: (string|number)[]}[]} */
        const checks = JSON.parse(block.dataset.checks || "[]");
        btn.disabled = true;
        try {
            const results = await this.checkApi.runChecks(checks);
            const allOk = results.length > 0 && results.every((r) => r.ok);

            const summary = btn.nextElementSibling;
            if (summary instanceof HTMLElement) {
                summary.textContent = allOk ? t("lessons.task.pass") : t("lessons.task.fail");
                summary.className = "task-check-summary " + (allOk ? "task-summary-ok" : "task-summary-err");
            }
            this._renderTaskResults(block, results);
        } finally {
            btn.disabled = false;
        }
    }

    /**
     * @param {HTMLElement} block
     * @param {{fn: string, args: (string|number)[], ok: boolean}[]} results
     */
    _renderTaskResults(block, results) {
        let list = block.querySelector(".task-check-list");
        if (!(list instanceof HTMLElement)) {
            list = document.createElement("ul");
            list.className = "task-check-list";
            block.querySelector(".task-check-wrap")?.after(list);
        }
        list.innerHTML = "";
        for (const r of results) {
            const li = document.createElement("li");
            li.className = "task-check-item " + (r.ok ? "task-check-ok" : "task-check-err");
            const args = r.args.map((a) => JSON.stringify(a)).join(", ");
            li.textContent = `${r.ok ? "✓" : "✗"} ${r.fn}(${args})`;
            list.appendChild(li);
        }
    }
}
