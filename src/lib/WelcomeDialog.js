//@ts-check
import { t } from "../i18n/index.js";
import { MiniMarkdown } from "./MiniMarkdown.js";
import { isTauri } from "../tauri.js";
import { version } from "./version.js";
import { SimDialog } from "./SimDialog.js";
import { Tour } from "./Tour.js";
import { LessonsPanel } from "./LessonsPanel.js";
import { buildChapterOverview } from "./ChapterOverview.js";
import { addScrollHints } from "./scrollHints.js";
import { downloadInfo, loadPage, pageRoute } from "./StaticPages.js";
import { initDownloadsPage } from "./DownloadIndex.js";

/**
 * Info pages shown as sub-views (see StaticPages.js); routes without an
 * entry here (e.g. /license) get a generic icon and their route as title.
 * @type {Record<string, { icon: string, title: () => string }>}
 */
const PAGE_VIEWS = {
    "/help":      { icon: "fa-circle-question", title: () => t("sim.help") },
    "/about":     { icon: "fa-circle-info",     title: () => t("sim.about") },
    "/downloads": { icon: "fa-download",        title: () => t("sim.downloads") },
};

export class WelcomeDialog {
    /**
     * @param {import("../SimControl.js").SimControl} sim
     * @param {{ view?: string }} [opts] open straight on a sub-view:
     *   "chapters" (the lessons panel's "overview" button) or a page route
     *   like "/help" (toolbar buttons); "Back" then leads to the start page
     * @returns {Promise<void>}
     */
    static show(sim, { view } = {}) {
        sim._activeTour?._finish();
        return new Promise((resolve) => {
            const backdrop = document.createElement("div");
            backdrop.className = "welcome-backdrop";

            const dlg = document.createElement("div");
            dlg.className = "welcome-dlg";
            dlg.setAttribute("role", "dialog");
            dlg.setAttribute("aria-modal", "true");
            dlg.setAttribute("aria-label", "Beaver Tracer");

            dlg.appendChild(WelcomeDialog._buildHeader(close));
            const { body, showNews, showChapters, showPage } = WelcomeDialog._buildBody(sim, close);
            dlg.appendChild(body);
            dlg.appendChild(WelcomeDialog._buildFooter(sim, showNews, showPage));

            backdrop.addEventListener("click", (ev) => {
                if (ev.target === backdrop) close();
            });

            backdrop.appendChild(dlg);
            document.body.appendChild(backdrop);

            /**
             * Choosing anything but "Lessons" here leaves lessons mode, so the
             * lessons panel closes (just dismissing the dialog keeps it open).
             * @param {() => void} [action]
             * @param {{ keepLessons?: boolean }} [opts]
             */
            function close(action, { keepLessons = false } = {}) {
                backdrop.remove();
                if (action && !keepLessons && sim.lessonsOpen) void sim.toggleLessonsPanel(false);
                action?.();
                resolve();
            }

            document.addEventListener("keydown", function onKey(ev) {
                if (ev.key === "Escape") {
                    document.removeEventListener("keydown", onKey);
                    close();
                }
            });

            const page = view ? pageRoute(view) : null;
            if (view === "chapters") showChapters(null);
            else if (page) showPage(page, null);
            else /** @type {HTMLElement|null} */ (dlg.querySelector(".welcome-learn-primary") ?? dlg.querySelector(".welcome-sim-item"))?.focus();
        });
    }

    /**
     * @param {(action?: () => void, opts?: { keepLessons?: boolean }) => void} close
     */
    static _buildHeader(close) {
        const header = document.createElement("div");
        header.className = "welcome-header";

        const logo = document.createElement("img");
        logo.src = "/beaver-icon.svg";
        logo.alt = "";
        logo.className = "welcome-logo";
        logo.width = 52;
        logo.height = 52;

        const titleBlock = document.createElement("div");
        titleBlock.className = "welcome-title-block";

        const title = document.createElement("h1");
        title.className = "welcome-title";
        title.textContent = "Beaver Tracer";

        const subtitle = document.createElement("p");
        subtitle.className = "welcome-subtitle";
        subtitle.textContent = t("welcome.subtitle");

        const ver = document.createElement("p");
        ver.className = "welcome-version";
        const verStr = version(true);
        ver.textContent = verStr;

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "welcome-close-btn";
        closeBtn.setAttribute("aria-label", t("sim.close") || "Close");
        closeBtn.innerHTML = "&times;";
        closeBtn.addEventListener("click", () => close());

        const verBlock = document.createElement("div");
        verBlock.className = "welcome-ver-block";
        verBlock.appendChild(ver);

        // Release-stage badge: "-dev" builds are Alpha, other 0.x versions Beta.
        const stage = verStr.endsWith("-dev") ? "alpha"
                    : verStr.startsWith("0.") ? "beta"
                    : null;
        if (stage) {
            const badge = document.createElement("span");
            badge.className = `welcome-stage welcome-stage--${stage}`;
            badge.textContent = stage.toUpperCase();
            verBlock.appendChild(badge);
        }

        const headerRight = document.createElement("div");
        headerRight.className = "welcome-header-right";
        headerRight.appendChild(closeBtn);
        headerRight.appendChild(verBlock);

        titleBlock.appendChild(title);
        titleBlock.appendChild(subtitle);
        // Sub-views put their "[←] Title" here instead of logo and title.
        const sub = document.createElement("div");
        sub.className = "welcome-header-sub";

        header.appendChild(logo);
        header.appendChild(titleBlock);
        header.appendChild(sub);
        header.appendChild(headerRight);
        return header;
    }

    /**
     * Two ways in — "Build freely" (own simulations, tour) and "Learn"
     * (the course, on the right like the lessons panel itself). News and
     * the chapter overview replace the two columns in place.
     * @param {import("../SimControl.js").SimControl} sim
     * @param {(action?: () => void, opts?: { keepLessons?: boolean }) => void} close
     * @returns {{ body: HTMLElement, showNews: (returnFocus: HTMLElement) => void, showChapters: (returnFocus: HTMLElement|null) => void, showPage: (route: string, returnFocus: HTMLElement|null) => void }}
     */
    static _buildBody(sim, close) {
        const body = document.createElement("div");
        body.className = "welcome-body";

        const home = document.createElement("div");
        home.className = "welcome-home";

        const paths = document.createElement("div");
        paths.className = "welcome-paths";
        paths.appendChild(WelcomeDialog._buildSimPath(sim, close));
        paths.appendChild(WelcomeDialog._buildLearnPath(sim, close, (btn) => showChapters(btn)));
        home.appendChild(paths);

        // Sub-views (news, chapters) replace the two columns in place, keep
        // the dialog's size and scroll their content.
        /** @type {HTMLElement|null} */
        let opener = null;
        /** @type {HTMLElement[]} */
        const views = [];
        /**
         * @param {string} icon
         * @param {string} title
         * @param {string} contentClass
         */
        const subView = (icon, title, contentClass) => {
            const view = document.createElement("div");
            view.className = "welcome-subview";
            view.hidden = true;
            const backBtn = document.createElement("button");
            backBtn.type = "button";
            backBtn.className = "welcome-back-btn";
            backBtn.innerHTML = `<i class="fa-solid fa-arrow-left" aria-hidden="true"></i>`;
            backBtn.title = t("welcome.back");
            backBtn.setAttribute("aria-label", t("welcome.back"));
            const back = () => {
                view.hidden = true;
                home.hidden = false;
                body.closest(".welcome-dlg")?.classList.remove("welcome-dlg--subview");
                // Opened straight on this view: no button to return to, so
                // focus lands where it would on a fresh start page.
                (opener ?? /** @type {HTMLElement|null} */ (home.querySelector(".welcome-learn-primary:not(:disabled)") ?? home.querySelector(".welcome-sim-item")))?.focus();
            };
            backBtn.addEventListener("click", back);
            const h = document.createElement("h2");
            h.className = "welcome-path-title";
            h.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i> `;
            h.appendChild(document.createTextNode(title));
            const head = document.createElement("div");
            head.className = "welcome-subview-head";
            head.append(backBtn, h);
            const content = document.createElement("div");
            content.className = `welcome-subview-content ${contentClass}`;
            view.append(content);
            addScrollHints(content);
            views.push(view);
            /** @param {HTMLElement|null} returnFocus null = opened directly @param {HTMLElement} [focus] */
            const show = (returnFocus, focus) => {
                opener = returnFocus;
                const dlg = body.closest(".welcome-dlg");
                const header = /** @type {HTMLElement|null} */ (dlg?.querySelector(".welcome-header"));
                const footer = /** @type {HTMLElement|null} */ (dlg?.querySelector(".welcome-footer"));
                // Switching between sub-views (a link from one info page to
                // another): keep the size of the one being replaced.
                const current = views.find((v) => !v.hidden);
                // Otherwise the footer (language, news, help …) and the
                // header's logo row only belong to the start page; their room
                // goes to the sub-view so the dialog keeps its size.
                const total = home.hidden ? 0
                    : (header?.offsetHeight ?? 0) + home.offsetHeight + (footer?.offsetHeight ?? 0);
                // "[←] Title" takes the logo row's place in the header.
                dlg?.querySelector(".welcome-header-sub")?.replaceChildren(head);
                dlg?.classList.add("welcome-dlg--subview");
                view.style.height = home.hidden && current
                    ? current.style.height
                    : `${total - (header?.offsetHeight ?? 0)}px`;
                for (const v of views) v.hidden = v !== view;
                home.hidden = true;
                (focus ?? backBtn).focus();
            };
            return { view, content, show, back };
        };

        const news = subView("fa-newspaper", t("welcome.news"), "welcome-news-content minimarkdown");
        news.content.textContent = "…";
        fetch("/news.md")
            .then((r) => (r.ok ? r.text() : ""))
            .then((md) => { news.content.innerHTML = md ? MiniMarkdown.render(md) : "—"; })
            .catch(() => { news.content.textContent = "—"; });

        // Chapter overview: built on first show (needs the chapter list);
        // picking a page opens the lessons panel there.
        // Titled just "Learn" (as on the start page): the columns below carry
        // their own headings ("Chapters" | chapter name).
        const chapters = subView("fa-graduation-cap", t("welcome.learn.title"), "welcome-chapters-content");
        let chaptersBuilt = false;
        /** @param {HTMLElement|null} returnFocus */
        const showChapters = (returnFocus) => {
            chapters.show(returnFocus);
            if (chaptersBuilt) return;
            chaptersBuilt = true;
            const panel = sim.lessonsPanel;
            chapters.content.textContent = "…";
            panel?.loadManifest().then(() => {
                chapters.content.replaceChildren(buildChapterOverview(panel,
                    (href) => close(() => void panel.open(href), { keepLessons: true })));
                /** @type {HTMLElement|null} */ (chapters.content.querySelector(".chapter-overview-chapter.is-selected"))?.focus();
            }).catch(() => {
                chapters.content.textContent = t("welcome.learn.unavailable");
            });
        };

        // Info pages (help, about, …): one sub-view each, loaded on first
        // show. Links between them switch views; in-page anchors (the help
        // page's table of contents) scroll the view instead of the URL.
        /** @type {Map<string, ReturnType<typeof subView> & { loaded?: boolean }>} */
        const pages = new Map();
        /** @param {string} route @param {HTMLElement|null} returnFocus */
        const showPage = (route, returnFocus) => {
            let page = pages.get(route);
            if (!page) {
                const meta = PAGE_VIEWS[route] ?? { icon: "fa-file-lines", title: () => route.slice(1) };
                page = subView(meta.icon, meta.title(), `welcome-page-content welcome-page--${route.slice(1)}`);
                pages.set(route, page);
                body.appendChild(page.view);
                page.content.addEventListener("click", (ev) => {
                    const a = ev.target instanceof Element ? ev.target.closest("a[href]") : null;
                    const href = a?.getAttribute("href");
                    if (!a || !href || a.getAttribute("target") === "_blank") return;
                    if (href.startsWith("#")) {
                        ev.preventDefault();
                        page?.content.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                        return;
                    }
                    const target = pageRoute(href);
                    if (target) {
                        ev.preventDefault();
                        showPage(target, opener);
                    }
                });
            }
            page.show(returnFocus);
            page.content.scrollTop = 0;
            if (page.loaded) return;
            page.loaded = true;
            page.content.textContent = "…";
            const content = page.content;
            loadPage(route)
                .then((html) => {
                    content.innerHTML = html ?? "—";
                    if (route === "/downloads") {
                        const { downloadBase, version } = downloadInfo();
                        initDownloadsPage(content, { downloadBase, current: version });
                    }
                })
                .catch(() => { content.textContent = "—"; });
        };

        body.append(home, ...views);
        /** @param {HTMLElement} returnFocus */
        const showNews = (returnFocus) => news.show(returnFocus);
        return { body, showNews, showChapters, showPage };
    }

    /**
     * "Learn" column: start or continue the course. Filled in once the
     * language's chapter list has loaded.
     * @param {import("../SimControl.js").SimControl} sim
     * @param {(action?: () => void, opts?: { keepLessons?: boolean }) => void} close
     * @param {(returnFocus: HTMLElement) => void} showChapters
     */
    static _buildLearnPath(sim, close, showChapters) {
        const col = WelcomeDialog._pathColumn("welcome-path--learn", "fa-graduation-cap", t("welcome.learn.title"), t("welcome.learn.desc"));

        // Same item style as "Build freely" — the two ways in are equals.
        const meta = document.createElement("p");
        meta.className = "welcome-path-meta";
        meta.hidden = true;

        const primary = WelcomeDialog._simItem("fa-play", t("welcome.learn.start"), "…", () => {});
        primary.classList.add("welcome-learn-primary");
        primary.disabled = true;
        const primaryLabel = /** @type {HTMLElement} */ (primary.querySelector(".welcome-item-label"));
        const primaryDesc = /** @type {HTMLElement} */ (primary.querySelector(".welcome-item-desc"));

        const overview = WelcomeDialog._simItem("fa-table-cells-large", t("lessons.overview.title"), "…", () => {});
        overview.classList.add("welcome-learn-secondary");
        overview.disabled = true;
        const overviewDesc = /** @type {HTMLElement} */ (overview.querySelector(".welcome-item-desc"));

        const list = document.createElement("div");
        list.className = "welcome-sim-list";
        list.append(primary, overview);
        col.append(list, meta);

        const panel = sim.lessonsPanel;
        /** @param {string} href */
        const openAt = (href) => close(() => void panel?.open(href), { keepLessons: true });

        panel?.loadManifest().then((manifest) => {
            const chapters = LessonsPanel.chaptersOf(manifest.pages).filter((c) => !c.chapter.draft);
            overviewDesc.textContent = t("welcome.learn.chapters", { count: chapters.length });
            const resume = panel.resumePage();
            if (resume) primaryLabel.textContent = t("welcome.learn.resume");
            const startPage = resume ?? manifest.pages.find((pg) => pg.href === manifest.first);
            primaryDesc.textContent = startPage ? LessonsPanel.pageLabel(startPage) : "";
            const target = resume?.href ?? manifest.first;
            primary.disabled = false;
            overview.disabled = false;
            primary.addEventListener("click", () => openAt(target));
            overview.addEventListener("click", () => showChapters(overview));
            // The initial focus (see show()) missed it while still disabled.
            if (!col.closest(".welcome-dlg")?.contains(document.activeElement)) primary.focus();
        }).catch(() => {
            meta.textContent = t("welcome.learn.unavailable");
            meta.hidden = false;
            list.remove();
        });
        return col;
    }

    /**
     * "Build freely" column: new, open, examples, tour.
     * @param {import("../SimControl.js").SimControl} sim
     * @param {(action?: () => void, opts?: { keepLessons?: boolean }) => void} close
     */
    static _buildSimPath(sim, close) {
        const col = WelcomeDialog._pathColumn("welcome-path--sim", "fa-screwdriver-wrench", t("welcome.sim.title"), t("welcome.sim.desc"));

        /** @param {string} warning */
        const mayDiscard = async (warning) =>
            !(sim._isDirty && !sim.lessonScene) || await SimDialog.confirm(t(warning));

        /** @param {string} url */
        const loadExample = async (url) => {
            if (!await mayDiscard("sim.discardandnewwarning")) return;
            const scene = await WelcomeDialog._fetchSim(url);
            if (scene) close(() => void sim.restore(scene));
        };

        const list = document.createElement("div");
        list.className = "welcome-sim-list";
        list.append(
            WelcomeDialog._simItem("fa-file", t("welcome.new"), t("welcome.new.desc"), async () => {
                if (await mayDiscard("sim.discardandnewwarning")) close(() => sim.new());
            }),
            WelcomeDialog._simItem("fa-file-arrow-up", t("welcome.open"), t("welcome.open.desc"), async () => {
                if (await mayDiscard("sim.discardandloadwarning")) close(() => sim.open());
            }),
            WelcomeDialog._simItem("fa-network-wired", t("welcome.example.simple"), t("welcome.example.simple.desc"),
                () => loadExample("/sims/demo.btsim")),
            WelcomeDialog._simItem("fa-diagram-project", t("welcome.example.complex"), t("welcome.example.complex.desc"),
                () => loadExample("/sims/demo-full.btsim")),
        );
        const tourBtn = WelcomeDialog._simItem("fa-route", t("tour.welcome.title"), t("tour.welcome.desc"),
            () => close(() => Tour.start(sim)));
        tourBtn.classList.add("welcome-sim-item--tour");
        list.appendChild(tourBtn);
        col.appendChild(list);
        return col;
    }

    /**
     * @param {string} modifier
     * @param {string} icon
     * @param {string} title
     * @param {string} desc
     */
    static _pathColumn(modifier, icon, title, desc) {
        const col = document.createElement("section");
        col.className = `welcome-path ${modifier}`;
        const h = document.createElement("h2");
        h.className = "welcome-path-title";
        h.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i> `;
        h.appendChild(document.createTextNode(title));
        const p = document.createElement("p");
        p.className = "welcome-path-desc";
        p.textContent = desc;
        col.append(h, p);
        return col;
    }

    /**
     * @param {import("../SimControl.js").SimControl} sim
     * @param {(returnFocus: HTMLElement) => void} showNews
     * @param {(route: string, returnFocus: HTMLElement) => void} showPage
     */
    static _buildFooter(sim, showNews, showPage) {
        const footer = document.createElement("div");
        footer.className = "welcome-footer";

        const left = document.createElement("div");
        left.className = "welcome-footer-left";
        const langLabel = t("sim.language");
        const langBtn = WelcomeDialog._footerBtn(
            "fa-language", langLabel === "Language" ? langLabel : `${langLabel} / Language`,
            // The app's language dialog, opened on top of this one (picking
            // a language reloads the page anyway).
            () => sim.openLanguageDialog()
        );
        langBtn.classList.add("welcome-footer-btn--lang");
        left.appendChild(langBtn);

        const right = document.createElement("div");
        right.className = "welcome-footer-right";

        const newsBtn = WelcomeDialog._footerBtn("fa-newspaper", t("welcome.news"), () => showNews(newsBtn));
        right.appendChild(newsBtn);

        for (const route of ["/downloads", "/help", "/about"]) {
            if (route === "/downloads" && isTauri()) continue;
            const { icon, title } = PAGE_VIEWS[route];
            const btn = WelcomeDialog._footerBtn(icon, title(), () => showPage(route, btn));
            right.appendChild(btn);
        }

        footer.appendChild(left);
        footer.appendChild(right);
        return footer;
    }

    /**
     * @param {string} icon
     * @param {string} label
     * @param {string} desc
     * @param {() => void} onClick
     */
    static _simItem(icon, label, desc, onClick) {
        const btn = WelcomeDialog._iconButton(icon, label, desc, onClick);
        btn.className = "welcome-sim-item";
        return btn;
    }

    /**
     * Icon + label + one-line description, laid out by the caller's class.
     * @param {string} icon
     * @param {string} label
     * @param {string} desc
     * @param {() => void} onClick
     */
    static _iconButton(icon, label, desc, onClick) {
        const btn = document.createElement("button");
        btn.type = "button";

        const ico = document.createElement("i");
        ico.className = `fa-solid ${icon} welcome-item-icon`;
        ico.setAttribute("aria-hidden", "true");

        const lbl = document.createElement("span");
        lbl.className = "welcome-item-label";
        lbl.textContent = label;

        const dsc = document.createElement("span");
        dsc.className = "welcome-item-desc";
        dsc.textContent = desc;

        btn.append(ico, lbl, dsc);
        btn.addEventListener("click", onClick);
        return btn;
    }

    /**
     * @param {string} url
     * @returns {Promise<object|null>}
     */
    static async _fetchSim(url) {
        try {
            const r = await fetch(url);
            if (!r.ok) throw new Error("not ok");
            return JSON.parse(await r.text());
        } catch {
            SimDialog.alert(t("sim.loadfailederror"));
            return null;
        }
    }

    /**
     * @param {string} icon
     * @param {string} label
     * @param {() => void} onClick
     */
    static _footerBtn(icon, label, onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "welcome-footer-btn";

        const ico = document.createElement("i");
        ico.className = `fa-solid ${icon}`;
        ico.setAttribute("aria-hidden", "true");

        btn.appendChild(ico);
        btn.appendChild(document.createTextNode(` ${label}`));
        btn.addEventListener("click", onClick);
        return btn;
    }
}
