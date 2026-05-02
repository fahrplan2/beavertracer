//@ts-check
import { SimulatedObject } from "./SimulatedObject.js";
import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { OS } from "../apps/OS.js";
import { IPStack } from "../net/IPStack.js";
import { WirelessPort } from "../net/WirelessPort.js";
import { t } from "../i18n/index.js";

export class Laptop extends SimulatedObject {

    kind = "Laptop";
    icon = "fa-laptop";

    /** @type {OS} */
    os;

    /** @type {WirelessPort} wlan0 — shared reference used by WifiMedium */
    _wPort;

    /** @type {string} SSID; empty string means not configured */
    _ssid = "";

    get net() { return this.os.net; }
    get fs()  { return this.os.fs;  }
    get dns() { return this.os.dns; }

    /** @param {string} name */
    constructor(name = t("laptop.title")) {
        super(name);
        this.root.classList.add("laptop");

        const fs  = new VirtualFileSystem();
        const net = new IPStack(1, name);

        // Swap the EthernetPort on the first NIC for a WirelessPort.
        this._wPort = Laptop._installWirelessPort(net);

        this.os = new OS(this, fs, net);

        this.onPanelCreated = (/** @type {HTMLElement} */ body) => {
            this.os.mount(body);
        };
        this.onPanelOpen = () => {
            this.os.refocus();
        };
    }

    /**
     * Replaces the EthernetPort of the first NIC with a WirelessPort.
     * Returns the new WirelessPort.
     * Called in both the constructor and fromJSON (after IPStack.fromJSON creates fresh NICs).
     * @param {IPStack} net
     * @returns {WirelessPort}
     */
    static _installWirelessPort(net) {
        const nic = net.interfaces[0];
        if (!nic) throw new Error("Laptop: IPStack has no interfaces");

        nic.port.unsubscribe(nic);
        const wPort = new WirelessPort("wlan0");
        nic.port = wPort;
        wPort.subscribe(nic);
        nic.name = "wlan0";
        return wPort;
    }

    // --- Port API (no wired ports — Laptop cannot be cabled) ---

    /** @returns {never[]} */
    listPorts()      { return []; }
    /** @param {*} _k @returns {null} */
    getPortByKey(_k) { return null; }

    // --- Persistence ---

    toJSON() {
        return {
            ...super.toJSON(),
            kind: "Laptop",
            net:  this.net.toJSON(),
            fs:   this.fs.toJSON(),
            dns:  this.dns.serverIp,
            ssid: this._ssid,
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Laptop(String(n.name ?? t("laptop.title")));
        obj._applyBaseJSON(n);

        if (n.net) {
            const net = IPStack.fromJSON(n.net);
            obj._wPort = Laptop._installWirelessPort(net);
            obj.os.net = net;
        }
        if (n.fs)  obj.os.fs = VirtualFileSystem.fromJSON(n.fs);
        if (n.dns) obj.os.dns.setServer(n.dns);
        obj._ssid = String(n.ssid ?? "");

        return obj;
    }
}
