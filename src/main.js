//@ts-check

import { initLocale } from "./i18n/index.js";
import { SimControl } from "./SimControl.js";
import { defaultSimulation } from "./defaultsim.js";

/**
 * If ?sim=https://... is present, fetch that JSON.
 * Falls back to defaultSimulation on any error or missing param.
 * Only https:// URLs are accepted to prevent abuse.
 * @returns {Promise<object>}
 */
async function resolveStartupSim() {
    const simUrl = new URLSearchParams(window.location.search).get("sim");
    if (!simUrl || !simUrl.startsWith("https://")) return defaultSimulation;

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
});

