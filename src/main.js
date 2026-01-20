//@ts-check

import { initLocale } from "./i18n/index.js";
import { SimControl } from "./SimControl.js";
import { defaultSimulation } from "./defaultsim.js";



//******************* MAIN ENTRY POINT ************************/

initLocale().then(() => {
    const simRoot = /** @type {HTMLElement} */ (document.getElementById("simcontrol"));
    const sim = new SimControl(simRoot);
    sim.restore(defaultSimulation);  
});

