//@ts-check

import { initLocale } from "./i18n/index.js";
import { SimControl } from "./SimControl.js";
import { defaultSimulation } from "./defaultsim.js";



/**
 * @returns {string}
 */
export function version() {
  try {
    // @ts-ignore
    return import.meta.env?.VITE_APP_VERSION || "development";
  } catch {
    return "development";
  }
}

console.log("[Beaver Tracer] Version:", version());

initLocale();

const simRoot = /** @type {HTMLElement} */ (document.getElementById("simcontrol"));
const sim = new SimControl(simRoot);
sim.restore(defaultSimulation);
sim.tabControler.gotoTab("sim");

