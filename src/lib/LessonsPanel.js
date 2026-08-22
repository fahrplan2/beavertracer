//@ts-check
import { t, getLocale } from "../i18n/index.js";
import { SimDialog } from "./SimDialog.js";
import { initQuizBlocks } from "./QuizInteractions.js";
import { CheckApi } from "../lessons/CheckApi.js";
import { setParam } from "./AppUrl.js";

const WIDTH_STORAGE_KEY = "bt.lessonsPanelWidth";
const MIN_WIDTH = 280;
const DEFAULT_WIDTH = 380;

/** Thrown for a 404 — distinguished from other failures so the panel can
 *  show "not available in your language" instead of a generic load error. */
class LessonNotFoundError extends Error {}

/**
 * Fetches lesson content (built by vite-plugin-lessons.mjs as per-page .json
 * files alongside the standalone HTML) and renders it into the docked
 * lessons panel of a live SimControl instance. Also wires "::: sim" launch
 * buttons to load the referenced scenario directly into that same
 * SimControl, intercepts in-lesson navigation links so browsing lessons
 * never leaves/reloads the app, and makes the panel's width draggable.
 */
export class LessonsPanel {
    /** @param {import("../SimControl.js").SimControl} simControl */
    constructor(simControl) {
        this.simControl = simControl;
        this.checkApi = new CheckApi(simControl);

        /** @type {string|null} href of the currently displayed lesson, e.g. "01-einfuehrung.html" */
        this._currentHref = null;

        /** @type {{first: string, pages: {href: string, title: string, num: number[]|null}[]}|null} */
        this._manifest = null;

        /** @type {HTMLSelectElement|null} */
        this._navSelect = null;

        // _quiz.js reads its "N of M points" i18n templates off document.body's
        // dataset. Those keys (lessons.quiz.result.*) live in the same locale
        // files the app's own t() already reads, so no separate lookup is needed.
        document.body.dataset.quizResultOne = t("lessons.quiz.result.one");
        document.body.dataset.quizResultOther = t("lessons.quiz.result.other");
        document.body.dataset.quizRetry = t("lessons.quiz.retry");

        const mount = this.simControl.lessonsMount;
        mount?.addEventListener("click", (ev) => this._onClick(/** @type {MouseEvent} */ (ev)));

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
            const maxWidth = Math.min(800, root.getBoundingClientRect().width * 0.7);

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

    /** Loads the first lesson if nothing has been shown yet; no-op on reopen. */
    async ensureLoaded() {
        if (this._currentHref) return;
        try {
            const manifest = await this._loadManifest();
            await this.load(manifest.first ?? "index.html");
        } catch (err) {
            const mount = this.simControl.lessonsMount;
            if (mount) mount.innerHTML = `<p class="lesson-load-error">${this._errorMessage(err)}</p>`;
            console.error("[LessonsPanel] failed to load lesson index", err);
        }
    }

    /**
     * Fetches (and caches) the language's chapter list, building the nav dropdown from it.
     * @returns {Promise<{first: string, pages: {href: string, title: string, num: number[]|null}[]}>}
     */
    async _loadManifest() {
        if (this._manifest) return this._manifest;
        const manifest = await this._fetchLessonJson(`/lessons/${getLocale()}/index.json`);
        this._manifest = manifest;
        this._buildNavSelect(manifest);
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
     * Builds the chapter dropdown — only first- and second-level chapters
     * (num.length <= 2) are listed; deeper sub-pages would make it
     * unwieldy and stay reachable via prev/next and in-text links instead.
     * Draft chapters (":::draft" in the source) are skipped unless ?debug=1.
     * @param {{pages: {href: string, title: string, num: number[]|null, draft?: boolean}[]}} manifest
     */
    _buildNavSelect(manifest) {
        const navMount = this.simControl.lessonsNavMount;
        if (!navMount) return;
        navMount.innerHTML = "";

        const select = document.createElement("select");
        select.className = "input";

        /** @type {HTMLOptGroupElement|null} */
        let currentGroup = null;
        for (const page of manifest.pages ?? []) {
            const depth = page.num?.length ?? 1;
            if (depth > 2) continue;
            if (page.draft && !this.simControl.debug) continue;

            const numLabel = page.num?.length ? page.num.join(".") + " " : "";
            const label = numLabel + page.title;

            const opt = document.createElement("option");
            opt.value = page.href;
            opt.textContent = label;

            if (depth <= 1) {
                currentGroup = document.createElement("optgroup");
                currentGroup.label = label;
                select.appendChild(currentGroup);
                currentGroup.appendChild(opt);
            } else {
                (currentGroup ?? select).appendChild(opt);
            }
        }

        select.addEventListener("change", () => this.load(select.value));
        navMount.appendChild(select);
        this._navSelect = select;
    }

    /**
     * Reflects `href` in the chapter dropdown. If `href` itself isn't listed
     * (depth > 2, e.g. "1.1.3" — see _buildNavSelect), falls back to its
     * nearest listed ancestor chapter (e.g. "1.1") instead of leaving
     * whatever was previously selected showing, now stale.
     * @param {string} href
     */
    _syncNavSelect(href) {
        const select = this._navSelect;
        if (!select) return;

        const hasOption = (/** @type {string} */ value) => [...select.options].some((o) => o.value === value);
        if (hasOption(href)) {
            select.value = href;
            return;
        }

        const pages = this._manifest?.pages ?? [];
        const num = pages.find((p) => p.href === href)?.num;
        if (!num || num.length === 0) return;

        const targetDepth = Math.min(num.length, 2);
        const ancestor = pages.find((p) => p.num?.length === targetDepth && p.num.every((n, i) => n === num[i]));
        if (ancestor && hasOption(ancestor.href)) select.value = ancestor.href;
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
            mount.scrollTop = 0;
            initQuizBlocks(mount);
            this._syncNavSelect(href);
            // Keeps the URL sharable/deep-linkable to whatever's currently
            // shown, however the student got there (dropdown, prev/next,
            // an in-text link, or the initial ?lesson= deep link itself).
            setParam("lesson", href);
        } catch (err) {
            // This specific page doesn't exist in the current language (e.g.
            // right after a language switch — window.location.reload() re-runs
            // the ?lesson= deep link in the new locale) but the language does
            // have lessons — fall back to its start page instead of a dead end.
            const fallbackHref = this._manifest?.first;
            if (err instanceof LessonNotFoundError && fallbackHref && fallbackHref !== href) {
                return this.load(fallbackHref);
            }
            mount.innerHTML = `<p class="lesson-load-error">${this._errorMessage(err)}</p>`;
            console.error("[LessonsPanel] failed to load lesson", href, err);
        }
    }

    /** @param {MouseEvent} ev */
    _onClick(ev) {
        const target = /** @type {HTMLElement|null} */ (ev.target instanceof HTMLElement ? ev.target : null);
        if (!target) return;

        // ":::sim" launch button — load the scenario into the live SimControl
        // instead of following its standalone-site href fallback.
        const simBtn = target.closest(".lesson-sim-btn");
        if (simBtn instanceof HTMLElement && simBtn.dataset.simUrl) {
            ev.preventDefault();
            this._loadSim(simBtn.dataset.simUrl);
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

    /** @param {string} simUrl */
    async _loadSim(simUrl) {
        if (this.simControl._isDirty && !await SimDialog.confirm(t("sim.discardandloadwarning"))) return;
        try {
            const res = await fetch(simUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const scene = await res.json();
            await this.simControl.restore(scene);
        } catch (err) {
            console.error("[LessonsPanel] failed to load scenario", simUrl, err);
        }
    }
}
