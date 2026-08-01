//@ts-check

import { initLocale } from "./i18n/index.js";
import { SimControl } from "./SimControl.js";
import { WelcomeDialog } from "./lib/WelcomeDialog.js";
import { readBootParams } from "./lib/AppUrl.js";

// Read every recognized query param in one pass, before anything else
// (StaticPageRouter's initial mount, i18n's own URL handling) touches
// location.search — see AppUrl.js for why that ordering used to matter.
const bootParams = readBootParams();

/**
 * If ?sim=<url> is present, fetch that JSON.
 * Accepts https:// (external) and /-paths (same-origin, e.g. /sims/foo.btsim).
 * Returns null on any error or unsupported URL format.
 * @returns {Promise<object|null>}
 */
async function resolveStartupSim() {
    const simUrl = bootParams.sim;
    if (!simUrl) return null;

    const isSameOrigin = simUrl.startsWith("/");
    const isExternal   = simUrl.startsWith("https://");
    if (!isSameOrigin && !isExternal) return null;

    try {
        const res = await fetch(simUrl);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

//******************* MAIN ENTRY POINT ************************/

initLocale(bootParams.lang).then(async () => {
    const simRoot = /** @type {HTMLElement} */ (document.getElementById("simcontrol"));
    const { embed: embedded, editable, debug, sim: simParam, lesson } = bootParams;
    const sim = new SimControl(simRoot, { embedded, editable, debug });

    if (simParam) {
        const scene = await resolveStartupSim();
        if (scene) sim.restore(scene); else sim.new();
    } else {
        sim.new();
    }

    const splash = document.getElementById("splash");
    if (splash) {
        splash.classList.add("is-hiding");
        splash.addEventListener("transitionend", () => splash.remove(), { once: true });
    }

    // ?lesson=<href> deep link — jump straight to that lesson instead of
    // showing the welcome dialog. Load it *before* opening the panel: that
    // way toggleLessonsPanel()'s own "load the first lesson if nothing is
    // shown yet" (ensureLoaded()) sees _currentHref already set and skips,
    // instead of racing this fetch for what ends up in the panel.
    if (lesson && !embedded) {
        await sim.lessonsPanel?.load(lesson);
        sim.toggleLessonsPanel(true);
    } else if (!simParam && !embedded) {
        WelcomeDialog.show(sim);
    }

    // Start loading + compiling the Wiregasm WASM module in idle time so the
    // trace tab opens without delay on first use.
    const preload = () => sim.pcapViewer.preloadWiregasm();
    if ("requestIdleCallback" in window) {
        requestIdleCallback(preload, { timeout: 10_000 });
    } else {
        setTimeout(preload, 5_000);
    }

});
