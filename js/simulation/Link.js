//@ts-check

import { EthernetPort } from "../devices/EthernetPort.js";
import { EthernetLink } from "../devices/EthernetLink.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { Router } from "./Router.js";
import { Switch } from "./Switch.js";
import { PC } from "./PC.js";

export class Link extends SimulatedObject {
  /** @type {EthernetLink} */
  link;

  /** @type {SimulatedObject} */
  A;

  /** @type {SimulatedObject} */
  B;

  // Packet-DOM (full duplex)
  /** @type {HTMLDivElement|null} */
  packetElAtoB = null;

  /** @type {HTMLDivElement|null} */
  packetElBtoA = null;

  /**
   * @param {SimulatedObject} A
   * @param {SimulatedObject} B
   */
  constructor(A, B) {
    super("Link");

    const portA = this._getNextFreePortFromObject(A);
    const portB = this._getNextFreePortFromObject(B);

    if (portA == null || portB == null) {
      throw new Error("No free ports available");
    }

    this.A = A;
    this.B = B;
    this.link = new EthernetLink(portA, portB);
  }

  /**
   * @param {SimulatedObject} obj
   * @return {EthernetPort|null}
   */
  _getNextFreePortFromObject(obj) {
    if (obj instanceof Switch) {
      return obj.device.getNextFreePort();
    }
    if (obj instanceof Router) {
      return obj.device.getNextFreeInterfacePort();
    }
    if (obj instanceof PC) {
      return obj.os.ipforwarder.getNextFreeInterfacePort();
    }
    return null;
  }

  step1() {
    this.link.step1();
  }

  step2() {
    this.link.step2();
  }

  destroy() {
    this.link.destroy();
  }

  /** @override */
  render() {
    this.root.className = "sim-link";
    this.root.textContent = "";

    // wichtig für Rotation der Linie
    this.root.style.transformOrigin = "0 0";

    // --- Packet A -> B ---
    const pAtoB = document.createElement("div");
    pAtoB.className = "sim-packet sim-packet-atob";
    pAtoB.style.display = "none";
    this.root.appendChild(pAtoB);
    this.packetElAtoB = pAtoB;

    // --- Packet B -> A ---
    const pBtoA = document.createElement("div");
    pBtoA.className = "sim-packet sim-packet-btoa";
    pBtoA.style.display = "none";
    this.root.appendChild(pBtoA);
    this.packetElBtoA = pBtoA;

    return this.root;
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

  /**
   * Startet pro Tick die CSS-Paketanimation.
   * Das Paket läuft in einem Step vollständig über den Link.
   *
   * @param {number} stepMs Dauer des Simulationsteps in ms
   */
  renderPacket(stepMs) {
    if (!this.root || !this.packetElAtoB || !this.packetElBtoA) return;

    // Wenn AtoB/BtoA Queues sind, ggf. auf .length > 0 ändern
    const hasAtoB = !!this.link.AtoB;
    const hasBtoA = !!this.link.BtoA;

    // Step-Dauer an CSS übergeben
    this.root.style.setProperty("--step-ms", `${stepMs}ms`);
    this.root.style.setProperty("--pad", `8px`);

    // --- A -> B ---
    this._togglePacketAnimation(
      this.packetElAtoB,
      hasAtoB,
      "sim-packet--run-atob"
    );

    // --- B -> A ---
    this._togglePacketAnimation(
      this.packetElBtoA,
      hasBtoA,
      "sim-packet--run-btoa"
    );
  }

  /**
   * Startet oder stoppt eine CSS-Animation zuverlässig.
   * @param {HTMLElement} el
   * @param {boolean} active
   * @param {string} runClass
   */
  _togglePacketAnimation(el, active, runClass) {
    if (!active) {
      el.classList.remove(runClass);
      el.style.display = "none";
      return;
    }

    el.style.display = "";

    // Animation pro Tick neu starten
    el.classList.remove(runClass);
    void el.offsetWidth; // reflow erzwingen
    el.classList.add(runClass);
  }
}
