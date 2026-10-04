//@ts-check
import { t, getLocale } from "../i18n/index.js";
import { SimDialog } from "./SimDialog.js";
import { addScrollHints } from "./scrollHints.js";
import { initQuizBlocks } from "./QuizInteractions.js";
import { CheckApi } from "../lessons/CheckApi.js";
import { setParam, clearParams } from "./AppUrl.js";

// Stored as a percentage of the app's width (not px), so the panel keeps
// its share of the screen across window sizes. Default: half (see sim.css).
const WIDTH_STORAGE_KEY = "bt.lessonsPanelWidthPct";
const MIN_WIDTH = 280;
const MAX_WIDTH_FRACTION = 0.7;
const PROGRESS_STORAGE_KEY = "bt.lessonsProgress";

/** Thrown for a 404 — distinguished from other failures so the panel can
 *  show "not available in your language" instead of a generic load error. */
class LessonNotFoundError extends Error {}

/** @typedef {{url: string}|{empty: true}} LessonSim a page's ":::sim" declaration */
/** @typedef {{href: string, title: string, num: number[]|null, draft?: boolean, sim?: LessonSim|null}} LessonPage */
/** @typedef {{first: string, pages: LessonPage[]}} LessonManifest */

/**
 * Fetches lesson content (built by vite-plugin-lessons.mjs as per-page .json
 * files alongside the standalone HTML) and renders it into the docked
 * lessons panel of a live SimControl instance, with prev/overview/next
 * buttons above and below each lesson. The chapter overview itself lives in
 * the welcome dialog (see ChapterOverview.js, SimControl.showChapterOverview). Each page's simulation (its own ":::sim" or the nearest preceding
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

        /** @type {LessonManifest|null} */
        this._manifest = null;

        /** @type {HTMLSpanElement|null} */
        this._currentLabel = null;

        /** @type {HTMLButtonElement|null} */
        this._resetBtn = null;

        /** @type {HTMLButtonElement|null} */
        this._prevBtn = null;

        /** @type {HTMLButtonElement|null} */
        this._nextBtn = null;


        // _quiz.js reads its "N of M points" i18n templates off document.body's
        // dataset. Those keys (lessons.quiz.result.*) live in the same locale
        // files the app's own t() already reads, so no separate lookup is needed.
        document.body.dataset.quizResultOne = t("lessons.quiz.result.one");
        document.body.dataset.quizResultOther = t("lessons.quiz.result.other");
        document.body.dataset.quizRetry = t("lessons.quiz.retry");

        const mount = this.simControl.lessonsMount;
        mount?.addEventListener("click", (ev) => this._onClick(/** @type {MouseEvent} */ (ev)));
        if (mount) addScrollHints(mount);

        this._buildHeader();
        this._restorePanelWidth();
        this._wireResizeHandle();
    }

    /** Applies the last saved panel width (or the CSS default) up front, before the panel is ever opened. */
    _restorePanelWidth() {
        const root = this.simControl.root;
        if (!root) return;
        let saved = NaN;
        try { saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY)); } catch { /* storage blocked */ }
        if (Number.isFinite(saved) && saved > 0 && saved <= MAX_WIDTH_FRACTION * 100) {
            root.style.setProperty("--lessons-width", `${saved}%`);
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
            const rootWidth = root.getBoundingClientRect().width;
            const startWidth = this.simControl.lessonsPanelEl?.getBoundingClientRect().width ?? rootWidth / 2;
            const maxWidth = rootWidth * MAX_WIDTH_FRACTION;

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

                // px while dragging (follows the pointer exactly), then
                // converted to a share of the app's width for storage.
                const finalPx = parseFloat(root.style.getPropertyValue("--lessons-width"));
                if (!finalPx || !rootWidth) return;
                const pct = Math.round((finalPx / rootWidth) * 1000) / 10;
                root.style.setProperty("--lessons-width", `${pct}%`);
                try { localStorage.setItem(WIDTH_STORAGE_KEY, String(pct)); } catch { /* storage blocked */ }
            };
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onUp, true);
        });
    }

    /**
     * Shows the current page (again) — with its simulation freshly loaded.
     * Without one, the course continues where the student left off.
     */
    async ensureLoaded() {
        if (!this._currentHref) {
            try {
                await this._loadManifest();
            } catch (err) {
                const mount = this.simControl.lessonsMount;
                if (mount) mount.innerHTML = `<p class="lesson-load-error">${this._errorMessage(err)}</p>`;
                return;
            }
            this._currentHref = this.resumePage()?.href ?? this._manifest?.first ?? null;
        }
        if (this._currentHref) await this.load(this._currentHref);
    }

    /**
     * Opens the lessons panel at `href` — for entry points outside the
     * panel (chapter overview, ?lesson= deep link). Sets the target up
     * front so toggleLessonsPanel()'s ensureLoaded() loads it exactly once.
     * @param {string} href
     * @returns {Promise<void>}
     */
    async open(href) {
        this._currentHref = href;
        await this.simControl.toggleLessonsPanel(true);
    }

    /** True once a page has been chosen (the panel can show something on its own). */
    get hasPage() { return this._currentHref !== null; }

    /** @returns {string|null} href of the page shown in the panel */
    get currentHref() { return this._currentHref; }

    /** @returns {LessonManifest|null} the loaded chapter list */
    get manifest() { return this._manifest; }

    /** Public access to the chapter list, e.g. for the welcome dialog. @returns {Promise<LessonManifest>} */
    loadManifest() {
        return this._loadManifest();
    }

    // ── Last opened page (per language — page hrefs differ between locales) ──
    // Only the last page is remembered, for "continue"; no read/unread
    // tracking (school PCs are shared, and it would need a "reset").

    /** @returns {string|null} */
    _readLast() {
        try {
            const last = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || "{}")?.[getLocale()]?.last;
            return typeof last === "string" ? last : null;
        } catch {
            return null;
        }
    }

    /** @param {string} href */
    _rememberLast(href) {
        try {
            const all = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || "{}") || {};
            all[getLocale()] = { last: href };
            localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(all));
        } catch { /* storage blocked — "continue" just isn't offered */ }
    }

    /**
     * The page to continue with — the last one opened, if it still exists.
     * Requires the manifest to be loaded.
     * @returns {LessonPage|null}
     */
    resumePage() {
        const last = this._readLast();
        return this._manifest?.pages.find((p) => p.href === last) ?? null;
    }

    /**
     * Course chapters (1…89) in the given page list, each with its pages.
     * 0 (course start) counts as a chapter; 90+ (appendix, test pages) don't.
     * @param {LessonPage[]} pages
     * @returns {{chapter: LessonPage, pages: LessonPage[]}[]}
     */
    static chaptersOf(pages) {
        /** @type {{chapter: LessonPage, pages: LessonPage[]}[]} */
        const chapters = [];
        for (const page of pages) {
            const top = page.num?.[0];
            if (top === undefined || top < 0 || top >= 90) continue;
            if (page.num?.length === 1) chapters.push({ chapter: page, pages: [page] });
            else if (chapters.at(-1)?.chapter.num?.[0] === top) chapters.at(-1)?.pages.push(page);
        }
        return chapters;
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

    /**
     * @param {LessonPage} page e.g. "1.2 Erste Simulation"
     */
    static pageLabel(page) {
        return (page.num?.length ? page.num.join(".") + " " : "") + page.title;
    }

    /** @param {LessonPage} page */
    _pageLabel(page) {
        return LessonsPanel.pageLabel(page);
    }

    /**
     * Builds the panel's header strip once: "← | chapters | page title | →",
     * then reset. Prev/next are icon-only here (the target page is in the
     * tooltip); the full-text row stays at the bottom of each page.
     */
    _buildHeader() {
        const navMount = this.simControl.lessonsNavMount;
        if (!navMount) return;
        navMount.innerHTML = "";

        /**
         * @param {string} className
         * @param {string} icon
         * @param {string} title
         */
        const iconBtn = (className, icon, title) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = className;
            btn.title = title;
            btn.setAttribute("aria-label", title);
            btn.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
            return btn;
        };

        const prevBtn = iconBtn("sim-lessons-prev", "fa-arrow-left", t("lessons.nav.prev"));
        const homeBtn = iconBtn("sim-lessons-home", "fa-list", t("lessons.overview.title"));
        homeBtn.addEventListener("click", () => this.simControl.showChapterOverview());
        const nextBtn = iconBtn("sim-lessons-next", "fa-arrow-right", t("lessons.nav.next"));
        for (const btn of [prevBtn, nextBtn]) {
            btn.disabled = true;
            btn.addEventListener("click", () => {
                const target = btn.dataset.lessonTarget;
                if (target) this.load(target);
                else this.simControl.showChapterOverview();
            });
        }

        const current = document.createElement("span");
        current.className = "sim-lessons-current";

        const resetBtn = iconBtn("sim-lessons-reset", "fa-rotate-left", t("lessons.sim.reset"));
        resetBtn.disabled = true;
        resetBtn.addEventListener("click", () => this.resetSim());

        navMount.append(prevBtn, homeBtn, current, nextBtn, resetBtn);
        this._prevBtn = prevBtn;
        this._nextBtn = nextBtn;
        this._currentLabel = current;
        this._resetBtn = resetBtn;
    }

    /** @param {string} href currently shown page */
    _updateHeader(href) {
        const page = this._manifest?.pages.find((p) => p.href === href);
        if (this._currentLabel) {
            this._currentLabel.textContent = page ? this._pageLabel(page) : "";
            this._currentLabel.title = this._currentLabel.textContent;
        }
        const { prev, next } = this._neighbours(href);
        if (this._prevBtn) {
            this._prevBtn.disabled = false;
            this._prevBtn.dataset.lessonTarget = prev?.href ?? "";
            this._prevBtn.title = prev ? `${t("lessons.nav.prev")}: ${this._pageLabel(prev)}` : t("lessons.overview.title");
        }
        if (this._nextBtn) {
            this._nextBtn.disabled = false;
            this._nextBtn.dataset.lessonTarget = next?.href ?? "";
            this._nextBtn.title = next ? `${t("lessons.nav.next")}: ${this._pageLabel(next)}` : t("lessons.nav.toOverview");
        }
    }

    /**
     * @param {string} href
     * @returns {{prev: LessonPage|null, next: LessonPage|null}}
     */
    _neighbours(href) {
        const pages = this._visiblePages(href);
        const idx = pages.findIndex((p) => p.href === href);
        return {
            prev: idx > 0 ? pages[idx - 1] : null,
            next: idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null,
        };
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
        if (this._resetBtn) this._resetBtn.disabled = !this._currentHref || !this.simControl.lessonScene;
    }

    /**
     * "← Zurück | Übersicht | Weiter →" — at the bottom of every page (the
     * header carries the same as icons).
     * At either end of the course the outer buttons lead to the chapter
     * overview (welcome dialog) instead of being dead.
     * @param {string} href
     * @returns {HTMLElement}
     */
    _buildNavRow(href) {
        const { prev, next } = this._neighbours(href);

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
            mount.innerHTML = data.bodyHtml;
            // The body's own text-link prev/next (built for the standalone
            // site) is replaced by the header buttons and the row below.
            mount.querySelector(":scope > .lesson-nav")?.remove();
            // ":::sim" launch links are for the standalone site — here the
            // page's simulation is loaded automatically (_syncSim below).
            mount.querySelectorAll(".lesson-sim-launch").forEach((el) => el.remove());
            mount.append(this._buildNavRow(href));
            mount.scrollTop = 0;
            initQuizBlocks(mount);
            this._updateHeader(href);
            // Keeps the URL sharable/deep-linkable to whatever's currently
            // shown, however the student got there (overview, prev/next,
            // an in-text link, or the initial ?lesson= deep link itself).
            setParam("lesson", href);
            this._rememberLast(href);
            await this._syncSim(href);
            this._updateResetBtn();
        } catch (err) {
            // This specific page doesn't exist in the current language (e.g.
            // right after a language switch — window.location.reload() re-runs
            // the ?lesson= deep link in the new locale) but the language does
            // have lessons — fall back to its first page instead of a dead end.
            const first = this._manifest?.first;
            if (err instanceof LessonNotFoundError && first && href !== first) {
                return this.load(first);
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
            else this.simControl.showChapterOverview();
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
