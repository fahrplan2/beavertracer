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

  /** @type {number} perpendicular offset in px for parallel links */
  _parallelOffset = 0;

  /** @type {HTMLDivElement|null} */
  _labelA = null;
  /** @type {HTMLDivElement|null} */
  _labelB = null;


  /**
   * @type {Array<{
   *   el: HTMLDivElement,
   *   dir: "AtoB"|"BtoA",
   *   data: Uint8Array,
   *   progress: number,
   *   positioned: boolean
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

    if (SimControl.portLabelsLayer) {
      this._labelA = document.createElement("div");
      this._labelA.className = "sim-link-port-label";
      this._labelA.textContent = this._portLabel(this.A, this.portAKey);
      SimControl.portLabelsLayer.appendChild(this._labelA);

      this._labelB = document.createElement("div");
      this._labelB.className = "sim-link-port-label";
      this._labelB.textContent = this._portLabel(this.B, this.portBKey);
      SimControl.portLabelsLayer.appendChild(this._labelB);
    }

    return this.root;
  }

  /**
   * Resolve the human-readable port label via listPorts(), falling back to the key.
   * @param {any} node @param {string} key @returns {string}
   */
  _portLabel(node, key) {
    if (typeof node.listPorts === "function") {
      const entry = node.listPorts().find(/** @param {{key:string}} p */ p => p.key === key);
      if (entry) return entry.label;
    }
    return key;
  }

  /**
   * @param {SimulatedObject} node
   * @param {boolean} hovered
   */
  setNodeHovered(node, hovered) {
    if (node === this.A) this._labelA?.classList.toggle("is-visible", hovered);
    else if (node === this.B) this._labelB?.classList.toggle("is-visible", hovered);
  }

  destroy() {
    for (const p of this._packets) p.el.remove();
    this._packets = [];
    this._labelA?.remove();
    this._labelA = null;
    this._labelB?.remove();
    this._labelB = null;
    this.link.destroy();
    this.simcontrol.pcapController.removeIf(this.A.id + ": "+this.link.portA.name);
    this.simcontrol.pcapController.removeIf(this.B.id + ": "+this.link.portB.name);
  }

  /** @param {boolean} paused */
  setPaused(paused) {
    this._paused = paused; 
  }

  /** @param {number} stepMs */
  setStepMs(stepMs) {
    this._stepMs = stepMs; 
  }

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

  /** @param {"AtoB"|"BtoA"} dir @param {*} data */
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

    // Bug 1: hide until renderPacket() sets correct position (avoids flash at 0,0)
    el.style.visibility = "hidden";
    SimControl.packetsLayer.appendChild(el);
    this._packets.push({ el, dir, data, progress: 0, positioned: false });
  }

  /** @param {number} dtMs */
  advance(dtMs) {
    if (this._paused) return;
    // Bug 2: at very high speeds (stepMs < ~2 frames), animation is physically
    // impossible to be smooth – packets stay at start position and just flash briefly
    if (this._stepMs < 35) return;
    const dp = dtMs / this._stepMs;
    for (const p of this._packets) p.progress = Math.min(1, p.progress + dp);
  }

  renderPacket() {
    if (!SimControl.packetsLayer) return;

    const x1 = this.A.getX();
    const y1 = this.A.getY();
    const x2 = this.B.getX();
    const y2 = this.B.getY();

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    const normX = length > 0 ? -dy / length : 0;
    const normY = length > 0 ?  dx / length : 0;
    const off = this._parallelOffset;

    for (const p of this._packets) {
      const t = p.dir === "AtoB" ? p.progress : 1 - p.progress;

      const x = x1 + dx * t + normX * off;
      const y = y1 + dy * t + normY * off;

      p.el.style.left = `${x}px`;
      p.el.style.top = `${y}px`;
      p.el.style.transform = "translate(-50%, -50%)";
      if (!p.positioned) {
        p.el.style.visibility = "";
        p.positioned = true;
      }
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
    this.root.style.transform = `rotate(${angle}deg) translateY(${this._parallelOffset}px)`;

    if (this._labelA && this._labelB) {
      const ux = length > 0 ? dx / length : 1;
      const uy = length > 0 ? dy / length : 0;
      // perpendicular unit vector (for parallel-link offset)
      const perpX = -uy;
      const perpY =  ux;
      const off = this._parallelOffset;

      // distance from node center to its bounding-box edge along link direction
      // node icons are 110×70 px → half-dims 55×35
      const NODE_W = 55;
      const NODE_H = 35;
      const tEdge = Math.min(
        Math.abs(ux) > 0.001 ? NODE_W / Math.abs(ux) : Infinity,
        Math.abs(uy) > 0.001 ? NODE_H / Math.abs(uy) : Infinity
      );
      // Label is centered on `dist`; its inner half-extent in link direction
      // must not reach back into the node.  ~30 px wide, ~16 px tall (with border/padding).
      const LABEL_HW = 15; // half label width estimate
      const LABEL_HH = 8;  // half label height estimate
      const MARGIN   = 4;  // extra gap beyond label edge
      const dist = tEdge
        + LABEL_HW * Math.abs(ux)
        + LABEL_HH * Math.abs(uy)
        + MARGIN;

      const show = dist * 2 < length;
      this._labelA.style.display = show ? "" : "none";
      this._labelB.style.display = show ? "" : "none";

      if (show) {
        this._labelA.style.left = `${x1 + ux * dist + perpX * off}px`;
        this._labelA.style.top  = `${y1 + uy * dist + perpY * off}px`;
        this._labelB.style.left = `${x2 - ux * dist + perpX * off}px`;
        this._labelB.style.top  = `${y2 - uy * dist + perpY * off}px`;
      }
    }
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
