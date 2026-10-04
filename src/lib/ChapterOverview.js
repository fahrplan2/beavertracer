//@ts-check
import { t } from "../i18n/index.js";
import { LessonsPanel } from "./LessonsPanel.js";
import { addScrollHints } from "./scrollHints.js";

/**
 * Course chapter overview, shown as a sub-view of the welcome dialog:
 * left the "continue" entry and the chapters (no read/unread tracking),
 * right the pages of the
 * selected chapter (initially the current or last read one). Chapters
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

    // ── Continue / start ──
    const first = pages.find((p) => p.href === panel.manifest?.first) ?? pages[0];
    const target = resume ?? first;
    if (target) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chapter-overview-resume";
        btn.innerHTML = `<i class="fa-solid fa-play" aria-hidden="true"></i>`;
        const text = document.createElement("span");
        text.className = "chapter-overview-resume-text";
        const label = document.createElement("span");
        label.className = "chapter-overview-resume-label";
        label.textContent = resume ? t("lessons.overview.resume") : t("lessons.overview.start");
        const page = document.createElement("span");
        page.className = "chapter-overview-resume-page";
        page.textContent = LessonsPanel.pageLabel(target);
        text.append(label, page);
        btn.appendChild(text);
        btn.addEventListener("click", () => onPick(target.href));
        left.appendChild(btn);
    }

    // ── Chapters ──
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
        body.append(title);
        item.append(num, body);
        chapters.appendChild(item);

        const show = () => {
            for (const e of entries) e.item.classList.toggle("is-selected", e.item === item);
            right.replaceChildren(pageList(chapter, shown, countText));
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
     * @param {string} countText
     */
    function pageList(chapter, shown, countText) {
        const wrap = document.createElement("div");
        const head = document.createElement("div");
        head.className = "chapter-overview-pages-head";
        const title = document.createElement("h3");
        title.className = "chapter-overview-pages-title";
        title.textContent = LessonsPanel.pageLabel(chapter);
        const meta = document.createElement("span");
        meta.className = "chapter-overview-meta";
        meta.textContent = countText;
        head.append(title, meta);

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
            btn.append(n, pt);
            btn.addEventListener("click", () => onPick(page.href));
            li.appendChild(btn);
            list.appendChild(li);
        }
        wrap.append(head, list);
        return wrap;
    }
}
