//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { Pcap } from "../tracer/Pcap.js";
import { SimControl } from "../SimControl.js";
import { t } from "../i18n/index.js";

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
  return Array.isArray(iface.port.loggedFrames)
    ? iface.port.loggedFrames
    : [];
}

export class PacketSnifferApp extends GenericProcess {
  get title() {
    return t("app.packetsniffer.title");
  }

  /** @type {Disposer} */
  disposer = new Disposer();

  /** @type {HTMLElement|null} */
  listEl = null;

  run() {
    this.root.classList.add("app", "app-packetsniffer");
  }

  /**
   * @param {HTMLElement} root
   */
  onMount(root) {
    super.onMount(root);
    this.disposer.dispose();

    this.listEl = UI.el("div");

    const panel = UI.panel([
      this.listEl,
    ]);

    this.root.replaceChildren(panel);

    this._render();
  }

  onUnmount() {
    this.disposer.dispose();
    this.listEl = null;
    super.onUnmount();
  }

  _render() {
    if (!this.listEl) return;

    const ifaces = Array.isArray(this.os?.net?.interfaces)
      ? this.os.net.interfaces
      : [];

    if (!ifaces.length) {
      this.listEl.textContent = t("app.packetsniffer.nointerface");
      return;
    }

    const buttons = [];

    for (let i = 0; i < ifaces.length; i++) {
      const iface = ifaces[i];
      const name = typeof iface?.name === "string" ? iface.name : t("app.packetsniffer.unnamed");
      const port = ifacePort(iface);
      const frames = ifaceLoggedFrames(iface);

      const filename =
        `iface-${i}-${name.replaceAll(/[^a-zA-Z0-9_\-\.]/g, "_")}-port-${port ?? "unknown"}.pcap`;

      const portSuffix = (port != null) ? `:${port}` : "";

      const btnShow = UI.button(
        t("app.packetsniffer.button.show", { name, port: portSuffix }),
        () => {
          const pcap = new Pcap(frames, filename);

          //SimControl.pcapViewer.loadBytes(pcap.generateBytes());
          //SimControl.tabControler.gotoTab("pcapviewer");
          
        },
        { primary: true }
      );

      buttons.push(btnShow);

      const btnDownload = UI.button(
        t("app.packetsniffer.button.download", { name, port: portSuffix }),
        () => {
          const pcap = new Pcap(frames, filename);
          pcap.downloadFile();
        },
        { primary: true }
      );

      buttons.push(btnDownload);
    }

    this.listEl.replaceChildren(...buttons);
  }
}
