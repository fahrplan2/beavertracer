//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { CleanupBag } from "./lib/CleanupBag.js";
import { Pcap } from "../pcap/pcap.js";

// import { Pcap } from "./net/Pcap.js"; // falls nicht global

/**
 * @param {any} iface
 */
function ifacePort(iface) {
  const p = iface?.port;
  if (typeof p === "number") return p;
  if (typeof p?.port === "number") return p.port;
  if (typeof p?.id === "number") return p.id;
  return null;
}

/**
 * @param {any} iface
 * @returns {any[]}
 */
function ifaceLoggedFrames(iface) {
  return Array.isArray(iface?.port?.loggedFrames)
    ? iface.port.loggedFrames
    : [];
}

export class PcapDownloaderApp extends GenericProcess {
  /** @type {CleanupBag} */
  bag = new CleanupBag();

  /** @type {HTMLElement|null} */
  listEl = null;

  run() {
    this.title = "PCAP Downloader";
    this.root.classList.add("app", "app-pcap-downloader");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.bag.dispose();

    const refreshBtn = UI.button("Refresh", () => this._render(), { primary: true });
    this.listEl = UI.el("div");

    const panel = UI.panel([
      UI.buttonRow([refreshBtn]),
      this.listEl,
    ]);

    this.root.replaceChildren(panel);

    this._render();
  }

  onUnmount() {
    this.bag.dispose();
    this.listEl = null;
    super.onUnmount();
  }

  _render() {
    if (!this.listEl) return;

    const ifaces = Array.isArray(this.os?.ipforwarder?.interfaces)
      ? this.os.ipforwarder.interfaces
      : [];

    if (!ifaces.length) {
      this.listEl.textContent = "(no interfaces)";
      return;
    }

    const buttons = [];

    for (let i = 0; i < ifaces.length; i++) {
      const iface = ifaces[i];
      const name = typeof iface?.name === "string" ? iface.name : "(unnamed)";
      const port = ifacePort(iface);
      const frames = ifaceLoggedFrames(iface);

      const filename =
        `iface-${i}-${name.replaceAll(/[^a-zA-Z0-9_\-\.]/g, "_")}-port-${port ?? "unknown"}.pcap`;

      const btn = UI.button(
        `Download PCAP – ${name}${port != null ? ` :${port}` : ""}`,
        () => {
          // @ts-ignore
          const pcap = new Pcap(frames, filename);
          pcap.downloadFile();
        },
        { primary: true }
      );

      buttons.push(btn);
    }

    this.listEl.replaceChildren(...buttons);
  }
}
