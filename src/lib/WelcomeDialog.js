//@ts-check
import { t, getLocale } from "../i18n/index.js";
import { MiniMarkdown } from "./MiniMarkdown.js";
import { isTauri } from "../tauri.js";
import { defaultSimulation } from "../defaultsim.js";
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
        ver.textContent = version(true);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "welcome-close-btn";
        closeBtn.setAttribute("aria-label", t("sim.close") || "Close");
        closeBtn.innerHTML = "&times;";
        closeBtn.addEventListener("click", () => close());

        const alpha = document.createElement("span");
        alpha.className = "welcome-alpha";
        alpha.textContent = "ALPHA";

        const verBlock = document.createElement("div");
        verBlock.className = "welcome-ver-block";
        verBlock.appendChild(ver);
        verBlock.appendChild(alpha);

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
        actions.appendChild(WelcomeDialog._actionBtn(
            "fa-network-wired", t("welcome.example"), t("welcome.example.desc"),
            async () => {
                if (sim._isDirty && !await SimDialog.confirm(t("sim.discardandnewwarning"))) return;
                close(() => sim.restore(defaultSimulation));
            }
        ));
        const tourBtn = WelcomeDialog._actionBtn(
            "fa-route", t("tour.welcome.title"), t("tour.welcome.desc"),
            () => close(() => Tour.start(sim))
        );
        tourBtn.classList.add("welcome-action-btn--tour");
        actions.appendChild(tourBtn);

        const news = document.createElement("div");
        news.className = "welcome-news";

        const newsHeading = document.createElement("p");
        newsHeading.className = "welcome-news-heading";
        newsHeading.innerHTML = `<i class="fa-solid fa-newspaper" aria-hidden="true"></i> ${t("welcome.news")}`;
        news.appendChild(newsHeading);

        const newsContent = document.createElement("div");
        newsContent.className = "welcome-news-content minimarkdown";
        newsContent.textContent = "…";
        news.appendChild(newsContent);

        fetch("/news.md")
            .then((r) => (r.ok ? r.text() : ""))
            .then((md) => { newsContent.innerHTML = md ? MiniMarkdown.render(md) : "—"; })
            .catch(() => { newsContent.textContent = "—"; });

        body.appendChild(actions);
        body.appendChild(news);
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
            right.appendChild(WelcomeDialog._footerBtn(
                "fa-book-open", t("sim.lessons"),
                () => { window.open(`/lessons/${getLocale()}/`, "_blank"); }
            ));
        }

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
