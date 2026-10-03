//@ts-check
import { t, getLocale, setLocale, getLocales } from "../i18n/index.js";
import { SimDialog } from "./SimDialog.js";

const FEATURED = new Set(["de", "en"]);

/**
 * Language chooser: the main languages (de/en) as framed buttons, then all
 * AI-translated languages as a compact list under their own label. Used by
 * the toolbar's language dialog and inline in the welcome dialog. No filter
 * field: in four columns every language fits on one screen. Picking a language reloads the
 * page; picking the current one calls `onCancel`.
 * @param {import("../SimControl.js").SimControl} sim
 * @param {() => void} onCancel
 * @returns {Promise<{ active: HTMLElement|null, parts: HTMLElement[] }>}
 */
export async function buildLanguagePicker(sim, onCancel) {
    const locales = await getLocales();
    const current = getLocale();

    /** @param {{ key: string, label: string }} loc */
    const makeClickHandler = (loc) => async (/** @type {MouseEvent} */ ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (loc.key === getLocale()) { onCancel(); return; }
        if (sim._isDirty && !sim.lessonScene) {
            const ok = await SimDialog.confirm(t("sim.langswitch.confirmdiscard"));
            if (!ok) return;
        }
        await setLocale(loc.key);
        sim._isDirty = false;
        window.location.reload();
    };

    const featured = document.createElement("div");
    featured.className = "sim-langdialog-featured";

    const list = document.createElement("div");
    list.className = "sim-langlist";

    const entries = locales.map((loc) => {
        const parts = loc.label.split(" ");
        return {
            loc,
            flag: parts[0],
            isAI: loc.label.includes("(translated by AI)"),
            name: parts.slice(1).join(" ").replace(/\s*\(translated by AI\)\s*$/g, "").trim(),
        };
    });
    const others = entries.filter((e) => !FEATURED.has(e.loc.key));
    const allAI = others.length > 0 && others.every((e) => e.isAI);
    // Mark single entries with "*" only when the list mixes AI and human translations.
    const hasAI = others.some((e) => e.isAI);

    for (const { loc, flag, isAI, name } of entries) {
        const isCard = FEATURED.has(loc.key);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = isCard ? "sim-lang-card" : "sim-langlist-item";
        if (loc.key === current) btn.classList.add("active");

        const flagEl = document.createElement("span");
        flagEl.className = isCard ? "sim-lang-card-flag" : "sim-langlist-item-flag";
        flagEl.textContent = flag;

        const nameEl = document.createElement("span");
        nameEl.className = isCard ? "sim-lang-card-name" : "sim-langlist-item-name";
        nameEl.textContent = !isCard && isAI && !allAI ? `${name} *` : name;

        btn.append(flagEl, nameEl);
        btn.addEventListener("click", makeClickHandler(loc));
        (isCard ? featured : list).appendChild(btn);
    }

    /** @type {HTMLElement[]} */
    const parts = [featured];
    if (hasAI) {
        const label = document.createElement("p");
        label.className = "sim-langdialog-note";
        label.textContent = allAI ? "Translated by AI" : "* translated by AI";
        parts.push(label);
    }
    parts.push(list);
    /** @type {HTMLElement|null} */
    const active = featured.querySelector(".active") ?? list.querySelector(".active");
    return { active, parts };
}
