//@ts-check
import { t } from "../i18n/index.js";
import { LessonsPanel } from "./LessonsPanel.js";
import { addScrollHints } from "./scrollHints.js";

/**
 * Course chapter overview, shown as a sub-view of the welcome dialog:
 * left the chapters (no read/unread tracking), right the pages of the
 * selected chapter (initially the current or last read one). Laid out like
 * the start page: two open columns with a divider, start-page headings. Chapters
 * still being written are listed quietly below ("coming soon", clickable
 * with ?debug=1); appendix pages (90+) are linked at the bottom.
 * Requires the panel's manifest to be loaded.
 * @param {LessonsPanel} panel
 * @param {(href: string) => void} onPick called with the chosen page
 * @returns {HTMLElement}
 */
export function buildChapterOverview(panel, onPick) {
    const pages = panel.manifest?.pages ?? [];
    const debug = !!panel.simControl.debug;
    const resume = panel.resumePage();
    const focusHref = panel.currentHref ?? resume?.href ?? null;
    const focusTop = pages.find((p) => p.href === focusHref)?.num?.[0];

    const root = document.createElement("div");
    root.className = "chapter-overview";

    const left = document.createElement("div");
    left.className = "chapter-overview-list";
    const right = document.createElement("div");
    right.className = "chapter-overview-pages";
    root.append(left, right);
    addScrollHints(left);
    addScrollHints(right);

    // ── Chapters ── (column heading in the start page's style; "start /
    // continue the course" lives on the start page itself)
    const leftTitle = document.createElement("h3");
    leftTitle.className = "welcome-path-title chapter-overview-col-title";
    leftTitle.innerHTML = `<i class="fa-solid fa-list-ol" aria-hidden="true"></i> `;
    leftTitle.appendChild(document.createTextNode(t("lessons.overview.chapters")));
    left.appendChild(leftTitle);

    const chapters = document.createElement("div");
    chapters.className = "chapter-overview-chapters";
    left.appendChild(chapters);

    const soonList = document.createElement("ol");
    soonList.className = "chapter-overview-soon-list";

    /** @type {{ item: HTMLButtonElement, show: () => void }[]} */
    const entries = [];

    for (const { chapter, pages: chapterPages } of LessonsPanel.chaptersOf(pages)) {
        if (chapter.draft && !debug) {
            const li = document.createElement("li");
            const n = document.createElement("span");
            n.className = "chapter-overview-soon-num";
            n.textContent = String(chapter.num?.[0] ?? "");
            li.append(n, document.createTextNode(chapter.title));
            soonList.appendChild(li);
            continue;
        }
        const shown = chapterPages.filter((p) => !p.draft || debug);
        const countText = t(shown.length === 1 ? "lessons.overview.pages.one" : "lessons.overview.pages.other", { count: shown.length });

        const item = document.createElement("button");
        item.type = "button";
        item.className = "chapter-overview-chapter";
        if (chapter.draft) item.classList.add("is-draft");
        if (chapter.num?.[0] === focusTop) item.classList.add("is-current");

        const num = document.createElement("span");
        num.className = "chapter-overview-num";
        num.textContent = String(chapter.num?.[0] ?? "");
        const body = document.createElement("span");
        body.className = "chapter-overview-chapter-body";
        const title = document.createElement("span");
        title.className = "chapter-overview-chapter-title";
        title.textContent = chapter.title;
        const desc = document.createElement("span");
        desc.className = "chapter-overview-chapter-desc";
        desc.textContent = countText;
        body.append(title, desc);
        item.append(num, body);
        chapters.appendChild(item);

        const show = () => {
            for (const e of entries) e.item.classList.toggle("is-selected", e.item === item);
            right.replaceChildren(pageList(chapter, shown));
            right.scrollTop = 0;
        };
        item.addEventListener("click", show);
        // Double click: straight into the chapter's first page
        item.addEventListener("dblclick", () => onPick(chapter.href));
        entries.push({ item, show });
    }

    if (soonList.childElementCount) {
        const soon = document.createElement("section");
        soon.className = "chapter-overview-soon";
        const h = document.createElement("h3");
        h.className = "chapter-overview-soon-title";
        h.textContent = t("lessons.overview.soon");
        soon.append(h, soonList);
        left.appendChild(soon);
    }

    // ── Appendix pages (90+) ──
    const extras = pages.filter((p) => {
        const top = p.num?.[0];
        return top !== undefined && top >= 90 && (p.num?.length ?? 0) <= 2 && (!p.draft || debug);
    });
    if (extras.length) {
        const more = document.createElement("nav");
        more.className = "chapter-overview-more";
        more.setAttribute("aria-label", t("lessons.overview.more"));
        for (const page of extras) {
            const link = document.createElement("button");
            link.type = "button";
            link.className = "chapter-overview-more-link";
            link.innerHTML = `<i class="fa-regular fa-file-lines" aria-hidden="true"></i> `;
            link.appendChild(document.createTextNode(page.title));
            link.addEventListener("click", () => onPick(page.href));
            more.appendChild(link);
        }
        left.appendChild(more);
    }

    (entries.find((e) => e.item.classList.contains("is-current")) ?? entries[0])?.show();
    return root;

    /**
     * Right column: the chapter's pages, sections bold, sub-pages indented.
     * @param {import("./LessonsPanel.js").LessonPage} chapter
     * @param {import("./LessonsPanel.js").LessonPage[]} shown
     */
    function pageList(chapter, shown) {
        const wrap = document.createElement("div");
        const head = document.createElement("div");
        head.className = "chapter-overview-pages-head";
        const title = document.createElement("h3");
        title.className = "welcome-path-title chapter-overview-col-title";
        title.textContent = LessonsPanel.pageLabel(chapter);
        const titleRow = document.createElement("div");
        titleRow.className = "chapter-overview-pages-title-row";
        // Second way in besides the page list: makes clear the chapter can
        // be entered right from here
        const start = document.createElement("button");
        start.type = "button";
        start.className = "chapter-overview-start";
        start.innerHTML = `<i class="fa-solid fa-play" aria-hidden="true"></i> `;
        start.appendChild(document.createTextNode(t("lessons.overview.startChapter")));
        start.addEventListener("click", () => onPick(chapter.href));
        titleRow.append(title, start);
        head.append(titleRow);

        const list = document.createElement("ol");
        list.className = "chapter-overview-page-list";
        for (const page of shown) {
            const li = document.createElement("li");
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "chapter-overview-page";
            btn.dataset.depth = String(page.num?.length ?? 1);
            if (page.href === focusHref) btn.classList.add("is-current");
            const n = document.createElement("span");
            n.className = "chapter-overview-page-num";
            n.textContent = page.num?.join(".") ?? "";
            const pt = document.createElement("span");
            pt.className = "chapter-overview-page-title";
            pt.textContent = page.title;
            const go = document.createElement("i");
            go.className = "fa-solid fa-play chapter-overview-page-go";
            go.setAttribute("aria-hidden", "true");
            btn.append(n, pt, go);
            btn.addEventListener("click", () => onPick(page.href));
            li.appendChild(btn);
            list.appendChild(li);
        }
        wrap.append(head, list);
        return wrap;
    }
}
