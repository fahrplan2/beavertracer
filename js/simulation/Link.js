//@ts-check

import { EthernetLink } from "../devices/EthernetLink.js";
import { EthernetPort } from "../devices/EthernetPort.js";
import { PC } from "./PC.js";
import { Router } from "./Router.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { Switch } from "./Switch.js";

export class Link extends SimulatedObject {
  /** @type {EthernetLink} */
  link;

  /** @type {SimulatedObject} */
  A;
  /** @type {SimulatedObject} */
  B;

  /** @type {number} */
  _stepMs = 200;

  /** @type {number} */
  _pad = 8;

  /** @type {boolean} */
  _paused = false;

  /**
   * @type {Array<{
   *   el: HTMLDivElement,
   *   dir: "AtoB"|"BtoA",
   *   data: Uint8Array,
   *   progress: number
   * }>}
   */
  _packets = [];

  constructor(A, B) {
    super("Link");

    const portA = this._getNextFreePortFromObject(A);
    const portB = this._getNextFreePortFromObject(B);
    if (portA == null || portB == null) throw new Error("No free ports available");

    this.A = A;
    this.B = B;
    this.link = new EthernetLink(portA, portB);
  }

  render() {
    this.root.className = "sim-link";
    this.root.textContent = "";
    this.root.style.transformOrigin = "0 0";
    this.root.dataset.objid = String(this.id); 
    return this.root;
  }
  
  destroy() {
    for (const p of this._packets) p.el.remove();
    this._packets = [];
    this.link.destroy();
  }

  /** Wird vom Controller gesetzt */
  setPaused(paused) {
    this._paused = paused;
  }

  /** Wird vom Controller gesetzt */
  setStepMs(stepMs) {
    this._stepMs = stepMs;
  }

  /** Simulation: Phase 1 */
  step1() {
    this.link.step1();

    const a = this.link.AtoB ?? null;
    const b = this.link.BtoA ?? null;

    if (a) this._startInFlight("AtoB", a);
    if (b) this._startInFlight("BtoA", b);
  }

  /** Simulation: Phase 2 */
  step2() {
    this.link.step2();

    // in deinem Modell: nach step2 ist nix mehr "in-flight"
    for (const p of this._packets) p.el.remove();
    this._packets = [];
  }

  _startInFlight(dir, data) {
    // pro Richtung max 1 Packet (du kannst später auf multi erweitern)
    for (const p of this._packets) {
      if (p.dir === dir) p.el.remove();
    }
    this._packets = this._packets.filter(p => p.dir !== dir);

    if (!this.root) return;

    const el = document.createElement("div");
    el.className = "sim-packet";
    el.style.display = "";
    el.title = "Click to log frame bytes";
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      console.log(`[Packet ${dir}]`, data);
    });

    this.root.appendChild(el);
    this._packets.push({ el, dir, data, progress: 0 });
  }

  /** Subtick: Fortschritt (Simulation+Render) */
  advance(dtMs) {
    if (this._paused) return;

    const dp = dtMs / this._stepMs; // 1.0 pro stepMs
    for (const p of this._packets) {
      p.progress = Math.min(1, p.progress + dp);
    }
  }

  /** Render: nur Position setzen */
  renderPacket() {
    if (!this.root) return;

    const lengthPx = this.root.getBoundingClientRect().width;
    if (!Number.isFinite(lengthPx) || lengthPx <= 0) return;

    const from = this._pad;
    const to = Math.max(this._pad, lengthPx - this._pad);

    for (const p of this._packets) {
      const x = p.dir === "AtoB"
        ? (from + (to - from) * p.progress)
        : (to - (to - from) * p.progress);

      p.el.style.left = `${x}px`;
      p.el.style.display = "";
    }
  }

  redrawLinks() {
    if (!this.root || !(this.root instanceof HTMLElement)) return;

    const x1 = this.A.getX();
    const y1 = this.A.getY();
    const x2 = this.B.getX();
    const y2 = this.B.getY();

    const dx = x2 - x1;
    const dy = y2 - y1;

    const length = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    this.root.style.width = `${length}px`;
    this.root.style.left = `${x1}px`;
    this.root.style.top = `${y1}px`;
    this.root.style.transform = `rotate(${angle}deg)`;
  }

  /** @param {SimulatedObject} obj @return {EthernetPort|null} */
  _getNextFreePortFromObject(obj) {
    if (obj instanceof Switch) return obj.device.getNextFreePort();
    if (obj instanceof Router) return obj.device.getNextFreeInterfacePort();
    if (obj instanceof PC) return obj.os.net.getNextFreeInterfacePort();
    return null;
  }
}
