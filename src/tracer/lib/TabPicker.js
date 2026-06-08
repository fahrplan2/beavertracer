// @ts-check

import { SimControl } from "../../SimControl.js";
import { t } from "../../i18n/index.js";

export class TabPicker {
  /** @type {HTMLElement|null} */ #el = null;
  /** @type {AbortController|null} */ #abort = null;

  close() {
    this.#abort?.abort();
    this.#abort = null;
    this.#el?.remove();
    this.#el = null;
  }

  /**
   * @param {HTMLElement} anchorEl
   * @param {{
   *   sessions: {name:string, hidden:boolean}[];
   *   activeName: string|null;
   *   pickerDevice: string|null;
   *   setPickerDevice: (dev:string|null)=>void;
   *   simControl: SimControl;
   *   onPick: (name:string)=>void;
   *   onClose: ()=>void;
   * }} ctx
   */
  open(anchorEl, ctx) {
    this.close();

    // ---- build devMap ----
    /** @type {Map<string, {port:string, name:string, hidden:boolean}[]>} */
    const devMap = new Map();

    /** @param {string} name */
    const split = (name) => {
      const s = String(name ?? "");
      const i = s.indexOf(":");
      if (i === -1) return { device: s.trim(), port: "" };
      return { device: s.slice(0, i).trim() || s.trim(), port: s.slice(i + 1).trim() };
    };

    for (const s of ctx.sessions) {
      const { device, port } = split(s.name);
      const dev = device || t("pcap.picker.unknown");
      if (!devMap.has(dev)) devMap.set(dev, []);
      devMap.get(dev)?.push({ port, name: s.name, hidden: !!s.hidden });
    }

    /** @param {string} dev */
    const getDevName = (dev) =>
      ctx.simControl.simobjects.find(elem => elem.id == parseInt(dev))?.name ?? dev;
    const devices = Array.from(devMap.keys()).sort((a, b) => getDevName(a).localeCompare(getDevName(b)));

    // default device
    let pickerDevice = ctx.pickerDevice;
    if (!pickerDevice || !devMap.has(pickerDevice)) {
      const activeDev = ctx.activeName ? split(ctx.activeName).device : null;
      pickerDevice = (activeDev && devMap.has(activeDev)) ? activeDev : (devices[0] ?? null);
      ctx.setPickerDevice(pickerDevice);
    }

    // ---- menu element ----
    const menu = document.createElement("div");
    menu.className = "pcapviewer-tabpicker2";
    menu.style.position = "fixed";
    menu.style.zIndex = "10000";

    const MENU_W = 520, MENU_H = 360, margin = 6;
    menu.style.width = `${MENU_W}px`;
    menu.style.maxHeight = `${MENU_H}px`;

    const rect = anchorEl.getBoundingClientRect();
    let left = rect.right - MENU_W;
    left = Math.min(left, window.innerWidth - MENU_W - margin);
    left = Math.max(margin, left);

    let top = rect.bottom + margin;
    top = Math.min(top, window.innerHeight - MENU_H - margin);
    top = Math.max(margin, top);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    menu.addEventListener("click", (e) => e.stopPropagation());

    const leftPane = document.createElement("div");
    leftPane.className = "pcapviewer-picker-left";
    const rightPane = document.createElement("div");
    rightPane.className = "pcapviewer-picker-right";

    /** @param {string} txt */
    const mkHeader = (txt) => {
      const h = document.createElement("div");
      h.className = "pcapviewer-picker-header";
      h.textContent = txt;
      return h;
    };
    leftPane.appendChild(mkHeader(t("pcap.picker.device")));
    rightPane.appendChild(mkHeader(t("pcap.picker.port")));

    // devices
    for (const dev of devices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pcapviewer-tabpicker-item";
      btn.textContent = getDevName(dev);
      if (dev === pickerDevice) btn.classList.add("pcapviewer-tabpicker-item--active");
      btn.addEventListener("click", () => {
        ctx.setPickerDevice(dev);
        // reopen to refresh right pane quickly (simple)
        this.open(anchorEl, { ...ctx, pickerDevice: dev });
      });
      leftPane.appendChild(btn);
    }

    // ports for selected device
    const ports = pickerDevice ? (devMap.get(pickerDevice) ?? []) : [];
    ports.sort((a,b)=>a.port.localeCompare(b.port) || a.name.localeCompare(b.name));

    for (const p of ports) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pcapviewer-tabpicker-item";
      const label = p.port ? p.port : t("pcap.picker.noport");
      btn.textContent = label + (p.hidden ? "" : " ✓");
      if (p.name === ctx.activeName) btn.classList.add("pcapviewer-tabpicker-item--active");
      btn.addEventListener("click", () => {
        ctx.onPick(p.name);
        ctx.onClose();
      });
      rightPane.appendChild(btn);
    }

    menu.appendChild(leftPane);
    menu.appendChild(rightPane);
    document.body.appendChild(menu);
    this.#el = menu;

    // outside click closes
    this.#abort = new AbortController();
    window.addEventListener("click", () => ctx.onClose(), { signal: this.#abort.signal });
  }
}
