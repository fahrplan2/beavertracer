//@ts-check
import { t } from "../i18n/index.js";
import { MiniMarkdown } from "./MiniMarkdown.js";
import { isTauri } from "../tauri.js";
import { version } from "./version.js";
import { SimDialog } from "./SimDialog.js";
import { Tour } from "./Tour.js";

export class WelcomeDialog {
    /**
     * @param {import("../SimControl.js").SimControl} sim
     * @returns {Promise<void>}
     */
    static show(sim) {
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
            dlg.appendChild(WelcomeDialog._buildBody(sim, close));
            dlg.appendChild(WelcomeDialog._buildFooter(sim, close));

            backdrop.addEventListener("click", (ev) => {
                if (ev.target === backdrop) close();
            });

            backdrop.appendChild(dlg);
            document.body.appendChild(backdrop);

            /** @param {() => void} [action] */
            function close(action) {
                backdrop.remove();
                action?.();
                resolve();
            }

            document.addEventListener("keydown", function onKey(ev) {
                if (ev.key === "Escape") {
                    document.removeEventListener("keydown", onKey);
                    close();
                }
            });

            /** @type {HTMLElement|null} */ (dlg.querySelector(".welcome-action-btn"))?.focus();
        });
    }

    /**
     * @param {(action?: () => void) => void} close
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
        header.appendChild(logo);
        header.appendChild(titleBlock);
        header.appendChild(headerRight);
        return header;
    }

    /**
     * @param {import("../SimControl.js").SimControl} sim
     * @param {(action?: () => void) => void} close
     */
    static _buildBody(sim, close) {
        const body = document.createElement("div");
        body.className = "welcome-body";

        // Tab bar
        const tabs = document.createElement("div");
        tabs.className = "welcome-tabs";
        tabs.setAttribute("role", "tablist");

        const tabStart = document.createElement("button");
        tabStart.type = "button";
        tabStart.className = "welcome-tab welcome-tab--active";
        tabStart.setAttribute("role", "tab");
        tabStart.setAttribute("aria-selected", "true");
        tabStart.innerHTML = `<i class="fa-solid fa-house" aria-hidden="true"></i> ${t("sim.welcome")}`;

        const tabNews = document.createElement("button");
        tabNews.type = "button";
        tabNews.className = "welcome-tab";
        tabNews.setAttribute("role", "tab");
        tabNews.setAttribute("aria-selected", "false");
        tabNews.innerHTML = `<i class="fa-solid fa-newspaper" aria-hidden="true"></i> ${t("welcome.news")}`;

        tabs.appendChild(tabStart);
        tabs.appendChild(tabNews);

        // Pages
        const pages = document.createElement("div");
        pages.className = "welcome-pages";

        const pageStart = document.createElement("div");
        pageStart.className = "welcome-page welcome-page--active";
        pageStart.setAttribute("role", "tabpanel");

        const actions = document.createElement("div");
        actions.className = "welcome-actions";
        actions.appendChild(WelcomeDialog._actionBtn(
            "fa-file", t("welcome.new"), t("welcome.new.desc"),
            async () => {
                if (sim._isDirty && !await SimDialog.confirm(t("sim.discardandnewwarning"))) return;
                close(() => sim.new());
            }
        ));
        actions.appendChild(WelcomeDialog._actionBtn(
            "fa-file-arrow-up", t("welcome.open"), t("welcome.open.desc"),
            async () => {
                if (sim._isDirty && !await SimDialog.confirm(t("sim.discardandloadwarning"))) return;
                close(() => sim.open());
            }
        ));
        actions.appendChild(WelcomeDialog._exampleBtn(sim, close));
        const tourBtn = WelcomeDialog._actionBtn(
            "fa-route", t("tour.welcome.title"), t("tour.welcome.desc"),
            () => close(() => Tour.start(sim))
        );
        tourBtn.classList.add("welcome-action-btn--tour");
        actions.appendChild(tourBtn);
        pageStart.appendChild(actions);

        const pageNews = document.createElement("div");
        pageNews.className = "welcome-page";
        pageNews.setAttribute("role", "tabpanel");

        const news = document.createElement("div");
        news.className = "welcome-news";
        const newsContent = document.createElement("div");
        newsContent.className = "welcome-news-content minimarkdown";
        newsContent.textContent = "…";
        news.appendChild(newsContent);
        fetch("/news.md")
            .then((r) => (r.ok ? r.text() : ""))
            .then((md) => { newsContent.innerHTML = md ? MiniMarkdown.render(md) : "—"; })
            .catch(() => { newsContent.textContent = "—"; });
        pageNews.appendChild(news);

        // Tab switching
        tabStart.addEventListener("click", () => {
            tabStart.classList.add("welcome-tab--active");
            tabStart.setAttribute("aria-selected", "true");
            tabNews.classList.remove("welcome-tab--active");
            tabNews.setAttribute("aria-selected", "false");
            pageStart.classList.add("welcome-page--active");
            pageNews.classList.remove("welcome-page--active");
        });
        tabNews.addEventListener("click", () => {
            tabNews.classList.add("welcome-tab--active");
            tabNews.setAttribute("aria-selected", "true");
            tabStart.classList.remove("welcome-tab--active");
            tabStart.setAttribute("aria-selected", "false");
            pageNews.classList.add("welcome-page--active");
            pageStart.classList.remove("welcome-page--active");
        });

        pages.appendChild(pageStart);
        pages.appendChild(pageNews);

        body.appendChild(tabs);
        body.appendChild(pages);
        return body;
    }

    /**
     * @param {import("../SimControl.js").SimControl} sim
     * @param {(action?: () => void) => void} close
     */
    static _buildFooter(sim, close) {
        const footer = document.createElement("div");
        footer.className = "welcome-footer";

        const left = document.createElement("div");
        left.className = "welcome-footer-left";
        const langLabel = t("sim.language");
        const langBtn = WelcomeDialog._footerBtn(
            "fa-language", langLabel === "Language" ? langLabel : `${langLabel} / Language`,
            () => close(() => sim.openLanguageDialog())
        );
        langBtn.classList.add("welcome-footer-btn--lang");
        left.appendChild(langBtn);

        const right = document.createElement("div");
        right.className = "welcome-footer-right";

        if (!isTauri()) {
            right.appendChild(WelcomeDialog._footerBtn(
                "fa-download", t("sim.downloads"),
                () => close(() => sim.navigateTo("/downloads"))
            ));
        }
        right.appendChild(WelcomeDialog._footerBtn(
            "fa-book-open", t("sim.lessons"),
            () => close(() => sim.toggleLessonsPanel(true))
        ));

        right.appendChild(WelcomeDialog._footerBtn(
            "fa-circle-question", t("sim.help"),
            () => close(() => sim.navigateTo("/help"))
        ));
        right.appendChild(WelcomeDialog._footerBtn(
            "fa-circle-info", t("sim.about"),
            () => close(() => sim.navigateTo("/about"))
        ));

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
    static _actionBtn(icon, label, desc, onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "welcome-action-btn";

        const ico = document.createElement("i");
        ico.className = `fa-solid ${icon} welcome-action-icon`;
        ico.setAttribute("aria-hidden", "true");

        const lbl = document.createElement("span");
        lbl.className = "welcome-action-label";
        lbl.textContent = label;

        const dsc = document.createElement("span");
        dsc.className = "welcome-action-desc";
        dsc.textContent = desc;

        btn.appendChild(ico);
        btn.appendChild(lbl);
        btn.appendChild(dsc);
        btn.addEventListener("click", onClick);
        return btn;
    }

    /**
     * @param {import("../SimControl.js").SimControl} sim
     * @param {(action?: () => void) => void} close
     */
    static _exampleBtn(sim, close) {
        const wrapper = document.createElement("div");
        wrapper.className = "welcome-example-wrapper";

        const btn = WelcomeDialog._actionBtn(
            "fa-network-wired", t("welcome.example"), t("welcome.example.desc"),
            () => {
                const open = wrapper.classList.toggle("welcome-example-wrapper--open");
                chevron.style.transform = open ? "translateY(-50%) rotate(180deg)" : "translateY(-50%)";
            }
        );

        const chevron = document.createElement("i");
        chevron.className = "fa-solid fa-chevron-down welcome-example-chevron";
        chevron.setAttribute("aria-hidden", "true");
        btn.appendChild(chevron);

        const sub = document.createElement("div");
        sub.className = "welcome-example-sub";

        sub.appendChild(WelcomeDialog._exampleSubItem(
            t("welcome.example.simple"), t("welcome.example.simple.desc"),
            async () => {
                if (sim._isDirty && !await SimDialog.confirm(t("sim.discardandnewwarning"))) return;
                const scene = await WelcomeDialog._fetchSim("/sims/demo.btsim");
                if (scene) close(() => void sim.restore(scene));
            }
        ));
        sub.appendChild(WelcomeDialog._exampleSubItem(
            t("welcome.example.complex"), t("welcome.example.complex.desc"),
            async () => {
                if (sim._isDirty && !await SimDialog.confirm(t("sim.discardandnewwarning"))) return;
                const scene = await WelcomeDialog._fetchSim("/sims/demo-full.btsim");
                if (scene) close(() => void sim.restore(scene));
            }
        ));

        wrapper.appendChild(btn);
        wrapper.appendChild(sub);
        return wrapper;
    }

    /**
     * @param {string} label
     * @param {string} desc
     * @param {() => void} onClick
     */
    static _exampleSubItem(label, desc, onClick) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "welcome-example-sub-item";

        const lbl = document.createElement("span");
        lbl.className = "welcome-example-sub-label";
        lbl.textContent = label;

        const dsc = document.createElement("span");
        dsc.className = "welcome-example-sub-desc";
        dsc.textContent = desc;

        item.appendChild(lbl);
        item.appendChild(dsc);
        item.addEventListener("click", onClick);
        return item;
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
