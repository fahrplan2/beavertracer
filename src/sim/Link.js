// Link.js
//@ts-check
import { EthernetLink } from "../net/EthernetLink.js";
import { SimControl } from "../SimControl.js";
import { SimulatedObject } from "./SimulatedObject.js";


/** @typedef {import("../net/EthernetPort.js").EthernetPort} EthernetPort */

/**
 * @typedef {Object} PortProvider
 * @property {(key: string) => EthernetPort|null} getPortByKey
 * @property {() => Array<{key:string,label:string,port:EthernetPort}>} listPorts
 */


export class Link extends SimulatedObject {

  kind="Link";

  /** @type {EthernetLink} */
  link;

  /** @type {SimulatedObject} */
  A;
  /** @type {SimulatedObject} */
  B;

  /** @type {string} */
  portAKey;
  /** @type {string} */
  portBKey;

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

  /**
   * @param {SimulatedObject} A
   * @param {any} portA
   * @param {string} portAKey
   * @param {SimulatedObject} B
   * @param {any} portB
   * @param {string} portBKey
   * @param {SimControl} simcontrol
   */
  constructor(A, portA, portAKey, B, portB, portBKey, simcontrol) {
    super("Link");

    if (!portA || !portB) throw new Error("Missing ports");

    this.A = A;
    this.B = B;
    this.portAKey = portAKey;
    this.portBKey = portBKey;

    this.link = new EthernetLink(portA, portB);
    this.link.link = this;

    this.simcontrol = simcontrol;

    this.simcontrol.pcapController.addIf(this.A.id + ": "+this.link.portA.name);
    this.simcontrol.pcapController.addIf(this.B.id + ": "+this.link.portB.name);
  }

  render() {
    this.root.className = "sim-link";
    this.root.textContent = "";
    this.root.style.transformOrigin = "0 0";
    this.root.dataset.objid = String(this.id);

    // clear & rebuild children
    this.root.replaceChildren();

    const hit = document.createElement("div");
    hit.className = "sim-link-hit";

    const line = document.createElement("div");
    line.className = "sim-link-line";

    // hit catches clicks, line is only visual
    this.root.appendChild(hit);
    this.root.appendChild(line);

    return this.root;
  }

  destroy() {
    for (const p of this._packets) p.el.remove();
    this._packets = [];
    this.link.destroy();
    this.simcontrol.pcapController.removeIf(this.A.id + ": "+this.link.portA.name);
    this.simcontrol.pcapController.removeIf(this.B.id + ": "+this.link.portB.name);
  }

  setPaused(paused) { this._paused = paused; }
  setStepMs(stepMs) { this._stepMs = stepMs; }

  step1() {
    this.link.step1();
    const a = this.link.AtoB ?? null;
    const b = this.link.BtoA ?? null;
    if (a) {
      this._startInFlight("AtoB", a);
      this.simcontrol.pcapController.updateIf(this.A.id + ": "+this.link.portA.name, this.link.portA.loggedFrames);
    }
    if (b) {
      this._startInFlight("BtoA", b);
      this.simcontrol.pcapController.updateIf(this.B.id + ": "+this.link.portB.name, this.link.portB.loggedFrames);
    }
  }

  step2() {
    //Update Traces
    const a = this.link.AtoB ?? null;
    const b = this.link.BtoA ?? null;

    this.link.step2();

    if (a) {
      this.simcontrol.pcapController.updateIf(this.B.id + ": "+this.link.portB.name, this.link.portB.loggedFrames);
    }
    if (b) {
      this.simcontrol.pcapController.updateIf(this.A.id + ": "+this.link.portA.name, this.link.portA.loggedFrames);
    }
    for (const p of this._packets) p.el.remove();
    this._packets = [];
  }

  _startInFlight(dir, data) {
    for (const p of this._packets) {
      if (p.dir === dir) p.el.remove();
    }
    this._packets = this._packets.filter(p => p.dir !== dir);

    if (!this.root) return;

    const el = document.createElement("div");
    el.className = "sim-packet";
    el.style.display = "";
    el.innerHTML = `<i class="fas fa-envelope"></i>`;
    el.title = "Click to log frame bytes";
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      console.log(`[Packet ${dir}]`, data);
    });

    SimControl.packetsLayer.appendChild(el);
    this._packets.push({ el, dir, data, progress: 0 });
  }

  advance(dtMs) {
    if (this._paused) return;
    const dp = dtMs / this._stepMs;
    for (const p of this._packets) p.progress = Math.min(1, p.progress + dp);
  }

  renderPacket() {
    if (!SimControl.packetsLayer) return;

    const x1 = this.A.getX();
    const y1 = this.A.getY();
    const x2 = this.B.getX();
    const y2 = this.B.getY();

    for (const p of this._packets) {
      const t = p.dir === "AtoB" ? p.progress : 1 - p.progress;

      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;

      p.el.style.left = `${x}px`;
      p.el.style.top = `${y}px`;
      p.el.style.transform = "translate(-50%, -50%)";
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

  toJSON() {
    return {
      kind: "Link",
      id: this.id,
      a: this.A.id,
      b: this.B.id,
      portA: this.portAKey,
      portB: this.portBKey,
    };
  }

  /**
   * @param {any} n
   * @param {Map<number, SimulatedObject>} byId
   * @param {SimControl} simcontrol
   */
  static fromJSON(n, byId, simcontrol) {
    const A0 = byId.get(Number(n.a));
    const B0 = byId.get(Number(n.b));
    if (!A0 || !B0) throw new Error("Link endpoints missing");

    /** @type {SimulatedObject & PortProvider} */
    const A = /** @type {any} */ (A0);
    /** @type {SimulatedObject & PortProvider} */
    const B = /** @type {any} */ (B0);

    if (typeof A.getPortByKey !== "function" || typeof B.getPortByKey !== "function") {
      throw new Error("Endpoint does not implement Port API");
    }

    const portAKey = String(n.portA ?? "");
    const portBKey = String(n.portB ?? "");
    const portA = A.getPortByKey(portAKey);
    const portB = B.getPortByKey(portBKey);

    if (!portA || !portB) throw new Error("Ports missing for link");

    const obj = new Link(A, portA, portAKey, B, portB, portBKey, simcontrol);
    obj.id = Number(n.id);
    return obj;
  }
}
