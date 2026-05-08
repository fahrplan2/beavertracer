//@ts-check

import { initLocale } from "./i18n/index.js";
import { SimControl } from "./SimControl.js";
import { defaultSimulation } from "./defaultsim.js";

/**
 * If ?sim=<url> is present, fetch that JSON.
 * Accepts https:// (external) and /-paths (same-origin, e.g. /sims/foo.btsim).
 * Falls back to defaultSimulation on any error or missing param.
 * @returns {Promise<object>}
 */
async function resolveStartupSim() {
    const simUrl = new URLSearchParams(window.location.search).get("sim");
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
    const sim = new SimControl(simRoot, { embedded: params.get("embed") === "1" });
    sim.restore(await resolveStartupSim());

    const splash = document.getElementById("splash");
    if (splash) {
        splash.classList.add("is-hiding");
        splash.addEventListener("transitionend", () => splash.remove(), { once: true });
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

