//@ts-check

import { initLocale } from "./i18n/index.js";
import { SimControl } from "./SimControl.js";
import { defaultSimulation } from "./defaultsim.js";





initLocale();

const simRoot = /** @type {HTMLElement} */ (document.getElementById("simcontrol"));
const sim = new SimControl(simRoot);
sim.restore(defaultSimulation);
sim.tabControler.gotoTab("sim");

