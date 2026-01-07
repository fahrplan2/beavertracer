//@ts-check

import { initLocale } from "./i18n/index.js";
import { TabController } from "./TabController.js";
import { SimControl } from "./SimControl.js";
import { PCapViewer } from "./pcap/PCapViewer.js";
import { defaultSimulation } from "./defaultsim.js";
import { StaticPageLoader } from "./StaticPageLoader.js";
import { t } from "./i18n/index.js";

/**
 * Applies translations to elements inside root that have data-i18n attributes.
 * it is needed, since index.html can not call t() directly. It is a bit dirty.
 * @param {ParentNode} [root=document]
 */
function applyI18n(root = document) {
  /** @type {NodeListOf<HTMLElement>} */
  const nodes = root.querySelectorAll("[data-i18n]");

  nodes.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;

    // Optional: translate attribute instead of text
    const attr = el.getAttribute("data-i18n-attr");
    const value = t(key);

    if (attr) el.setAttribute(attr, value);
    else el.textContent = value;
  });
}

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
applyI18n(document); //Translate the String on index.html

const simRoot = /** @type {HTMLElement} */ (document.getElementById("simcontrol"));
const pcapRoot = /** @type {HTMLElement} */ (document.getElementById("pcapviewer"));
const learnRoot = /** @type {HTMLElement} */ (document.getElementById("learn"));
const aboutRoot = /** @type {HTMLElement} */ (document.getElementById("about"));


const sim = new SimControl(simRoot);
sim.restore(defaultSimulation);

const viewer = new PCapViewer(pcapRoot, { autoSelectFirst: true });
SimControl.pcapViewer = viewer;

const staticPages = new StaticPageLoader({ fallbackLocale: "en" });

SimControl.tabControler = new TabController({
  onTabActivated: async (id) => {
    if (id === "about") {
      await staticPages.load(aboutRoot, "/pages/about/index.html", {
        onLoaded: (root) => {
          root.querySelector("[data-version]")?.replaceWith(version());
        },
      });
    } else if (id === "learn") {
      await staticPages.load(learnRoot, "/pages/learn/index.html");
    }
  },
});


