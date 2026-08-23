// Link.js
//@ts-check
import { EthernetLink } from "../net/EthernetLink.js";
import { SimControl } from "../SimControl.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { t } from "../i18n/index.js";
import { isTrafficSuppressed } from "../lib/CheckState.js";


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

  /** Cached endpoint canvas-coordinates; updated by redrawLinks(), read by renderPacket(). */
  _cx1 = 0; _cy1 = 0; _cx2 = 0; _cy2 = 0;

  /** True when this cable is simulated as broken. */
  _fault = false;

  /** Fraction (0..1) of frames dropped per direction, simulating a lossy link. */
  _lossRate = 0;

  /** @type {HTMLDivElement|null} */
  _faultPanel = null;

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

    // Notify both ends if this is a direct router-to-router (P2P) link
    const aAny = /** @type {any} */ (A);
    const bAny = /** @type {any} */ (B);
    if (aAny.ospf && bAny.ospf) {
      aAny.ospf.setP2P(portAKey, true);
      bAny.ospf.setP2P(portBKey, true);
    }

    this.simcontrol.pcapController.addIf(this.A.id + ": " + this.link.portA.name, this.link.portA);
    this.simcontrol.pcapController.addIf(this.B.id + ": " + this.link.portB.name, this.link.portB);
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

    hit.addEventListener("mouseenter", () => {
      this._labelA?.classList.add("is-visible");
      this._labelB?.classList.add("is-visible");
    });
    hit.addEventListener("mouseleave", () => {
      this._labelA?.classList.remove("is-visible");
      this._labelB?.classList.remove("is-visible");
    });
    hit.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._toggleFaultPanel(ev.clientX, ev.clientY);
    });

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

  /**
   * Set or clear the cable fault state.
   * @param {boolean} fault
   */
  setFault(fault) {
    this._fault = fault;
    this.link.broken = fault;
    this.root?.classList.toggle("is-faulted", fault);
    // Flush any in-flight packets so they don't visually cross a broken link
    if (fault) {
      for (const p of this._packets) p.el.remove();
      this._packets = [];
    }
  }

  /**
   * Set the link's packet-loss rate. Independent of setFault(): a link can
   * be simultaneously lossy and, once broken, drop everything regardless.
   * @param {number} rate 0..1 fraction of frames dropped per direction
   */
  setLossRate(rate) {
    this._lossRate = rate;
    this.link.lossRate = rate;
    this.root?.classList.toggle("is-lossy", rate > 0);
  }

  /** @param {number} clientX @param {number} clientY */
  _toggleFaultPanel(clientX, clientY) {
    if (this._faultPanel) {
      this._closeFaultPanel();
      return;
    }

    const labelA = this._portLabel(this.A, this.portAKey);
    const labelB = this._portLabel(this.B, this.portBKey);

    // ── header ───────────────────────────────────────────────────
    const titleEl = document.createElement("div");
    titleEl.className = "sim-panel-title";
    titleEl.textContent = t("link.fault.title");

    const titleGroup = document.createElement("div");
    titleGroup.className = "sim-panel-title-group";
    titleGroup.appendChild(titleEl);

    const icon = document.createElement("i");
    icon.className = "fas fa-ethernet sim-panel-icon";

    const closeBtn = document.createElement("button");
    closeBtn.className = "sim-panel-close";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.title = t("link.fault.close");
    closeBtn.addEventListener("click", () => this._closeFaultPanel());

    const header = document.createElement("div");
    header.className = "sim-panel-header";
    header.style.cursor = "default";
    header.append(icon, titleGroup, closeBtn);

    // ── body ─────────────────────────────────────────────────────
    const endpoints = document.createElement("div");
    endpoints.className = "sim-link-fault-endpoints";

    const ep = (node = /** @type {any} */ ({}), label = "") => {
      const s = document.createElement("span");
      s.textContent = `${node.name ?? node.id} › ${label}`;
      return s;
    };
    endpoints.append(ep(this.A, labelA), ep(this.B, labelB));

    const statusRow = document.createElement("div");

    const actionBtn = document.createElement("button");
    actionBtn.className = "btn sim-link-fault-action";
    actionBtn.type = "button";

    const refresh = () => {
      statusRow.textContent = this._fault
        ? ("✕ " + t("link.fault.status.down"))
        : ("● " + t("link.fault.status.up"));
      statusRow.className = "sim-link-fault-status " + (this._fault ? "is-down" : "is-up");
      actionBtn.textContent = this._fault
        ? t("link.fault.action.restore")
        : t("link.fault.action.break");
    };
    refresh();

    actionBtn.addEventListener("click", () => { this.setFault(!this._fault); refresh(); });

    // ── packet-loss control ─────────────────────────────────────
    const lossRow = document.createElement("div");
    lossRow.className = "sim-link-loss-row";

    const lossLabel = document.createElement("span");
    lossLabel.textContent = t("link.fault.loss.label");

    const lossSelect = /** @type {HTMLSelectElement} */ (document.createElement("select"));
    lossSelect.innerHTML = `
      <option value="0">${t("link.fault.loss.off")}</option>
      <option value="0.1">10%</option>
      <option value="0.25">25%</option>
      <option value="0.5">50%</option>
    `;
    lossSelect.value = String(this._lossRate);
    lossSelect.addEventListener("change", () => this.setLossRate(Number(lossSelect.value)));

    lossRow.append(lossLabel, lossSelect);

    const body = document.createElement("div");
    body.className = "sim-link-fault-body";
    body.append(endpoints, statusRow, actionBtn, lossRow);

    // ── assemble panel ───────────────────────────────────────────
    const panel = document.createElement("div");
    panel.className = "sim-panel sim-link-fault-panel";
    panel.append(header, body);
    document.body.appendChild(panel);
    this._faultPanel = panel;

    // Position near click, keep within viewport
    requestAnimationFrame(() => {
      const pw = panel.offsetWidth  || 270;
      const ph = panel.offsetHeight || 160;
      const vw = window.innerWidth, vh = window.innerHeight;
      panel.style.left = `${Math.min(clientX + 8, vw - pw - 8)}px`;
      panel.style.top  = `${Math.min(clientY + 8, vh - ph - 8)}px`;
    });

    // Dismiss on outside click
    const onOutside = (/** @type {MouseEvent} */ e) => {
      if (!panel.contains(/** @type {Node} */ (e.target))) {
        this._closeFaultPanel();
        document.removeEventListener("mousedown", onOutside, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  }

  _closeFaultPanel() {
    this._faultPanel?.remove();
    this._faultPanel = null;
  }

  destroy() {
    this._closeFaultPanel();
    for (const p of this._packets) p.el.remove();
    this._packets = [];
    this._labelA?.remove();
    this._labelA = null;
    this._labelB?.remove();
    this._labelB = null;
    const aAny = /** @type {any} */ (this.A);
    const bAny = /** @type {any} */ (this.B);
    if (aAny.ospf && bAny.ospf) {
      aAny.ospf.setP2P(this.portAKey, false);
      bAny.ospf.setP2P(this.portBKey, false);
    }
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
    }
    if (b) {
      this._startInFlight("BtoA", b);
    }
  }

  step2() {
    this.link.step2();
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
    // Keep synthetic ":::task" check traffic out of the visible animation —
    // the packet is still actually delivered (see EthernetPort.send/recieve),
    // only this visual representation is skipped.
    if (isTrafficSuppressed()) return;

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
    SimControl.packetsLayer?.appendChild(el);
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
    if (!SimControl.packetsLayer || this._packets.length === 0) return;

    const x1 = this._cx1, y1 = this._cy1;
    const x2 = this._cx2, y2 = this._cy2;

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

      p.el.style.transform = `translate(${x - 27}px, ${y - 27}px)`;
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

    this._cx1 = x1; this._cy1 = y1;
    this._cx2 = x2; this._cy2 = y2;

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
      ...(this._fault ? { fault: true } : {}),
      ...(this._lossRate > 0 ? { lossRate: this._lossRate } : {}),
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
    if (n.fault) obj.setFault(true);
    if (n.lossRate) obj.setLossRate(Number(n.lossRate));
    return obj;
  }
}
