//@ts-check

import { initLocale } from "./i18n/index.js";
import { SimControl } from "./SimControl.js";
import { WelcomeDialog } from "./lib/WelcomeDialog.js";

/**
 * If ?sim=<url> is present, fetch that JSON.
 * Accepts https:// (external) and /-paths (same-origin, e.g. /sims/foo.btsim).
 * Returns null on any error or unsupported URL format.
 * @returns {Promise<object|null>}
 */
// Capture before StaticPageRouter's navigate() strips query params via history.replaceState
const _simParam = new URLSearchParams(window.location.search).get("sim");

async function resolveStartupSim() {
    const simUrl = _simParam;
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

initLocale().then(async () => {
    const simRoot = /** @type {HTMLElement} */ (document.getElementById("simcontrol"));
    const params = new URLSearchParams(window.location.search);
    const embedded = params.get("embed") === "1";
    const editable = params.get("editable") === "1";
    const debug = params.get("debug") === "1";
    const sim = new SimControl(simRoot, { embedded, editable, debug });

    if (_simParam) {
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

    if (!_simParam && !embedded) {
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

