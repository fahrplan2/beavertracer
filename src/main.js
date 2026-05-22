//@ts-check

import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
polyfillCountryFlagEmojis("TwemojiCountryFlags", "/fonts/TwemojiCountryFlags.woff2");

import { initLocale } from "./i18n/index.js";
import { SimControl } from "./SimControl.js";
import { defaultSimulation } from "./defaultsim.js";
import { WelcomeDialog } from "./lib/WelcomeDialog.js";

/**
 * If ?sim=<url> is present, fetch that JSON.
 * Accepts https:// (external) and /-paths (same-origin, e.g. /sims/foo.btsim).
 * Falls back to defaultSimulation on any error or missing param.
 * @returns {Promise<object>}
 */
// Capture before StaticPageRouter's navigate() strips query params via history.replaceState
const _simParam = new URLSearchParams(window.location.search).get("sim");

async function resolveStartupSim() {
    const simUrl = _simParam;
    if (!simUrl) return defaultSimulation;

    const isSameOrigin = simUrl.startsWith("/");
    const isExternal   = simUrl.startsWith("https://");
    if (!isSameOrigin && !isExternal) return defaultSimulation;

    try {
        const res = await fetch(simUrl);
        if (!res.ok) return defaultSimulation;
        return await res.json();
    } catch {
        return defaultSimulation;
    }
}

//******************* MAIN ENTRY POINT ************************/

initLocale().then(async () => {
    const simRoot = /** @type {HTMLElement} */ (document.getElementById("simcontrol"));
    const params = new URLSearchParams(window.location.search);
    const embedded = params.get("embed") === "1";
    const sim = new SimControl(simRoot, { embedded });

    if (_simParam) {
        sim.restore(await resolveStartupSim());
    } else if (!embedded) {
        sim.new();
    } else {
        sim.restore(defaultSimulation);
    }

    const splash = document.getElementById("splash");
    if (splash) {
        splash.classList.add("is-hiding");
        splash.addEventListener("transitionend", () => splash.remove(), { once: true });
    }

    if (!_simParam && !embedded) {
        WelcomeDialog.show(sim);
    }

    // Prefetch wiregasm assets in idle time so first trace use is faster
    const prefetch = () => {
        fetch("/wiregasm/wiregasm.wasm").catch(() => {});
        fetch("/wiregasm/wiregasm.data").catch(() => {});
    };
    if ("requestIdleCallback" in window) {
        requestIdleCallback(prefetch, { timeout: 10_000 });
    } else {
        setTimeout(prefetch, 5_000);
    }

});

