//@ts-check
import { SimulatedObject } from "./SimulatedObject.js";
import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { OS } from "../apps/OS.js";
import { IPStack } from "../net/IPStack.js";
import { WirelessPort } from "../net/WirelessPort.js";
import { t } from "../i18n/index.js";
import { IPv4ConfigApp } from "../apps/IPv4ConfigApp.js";

export class Tablet extends SimulatedObject {

    kind = "Tablet";
    icon = "fa-tablet-screen-button";

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
    constructor(name = t("tablet.title")) {
        super(name);
        this.root.classList.add("tablet");

        const fs  = new VirtualFileSystem();
        const net = new IPStack(1, name);

        // Swap the EthernetPort on the first NIC for a WirelessPort.
        this._wPort = Tablet._installWirelessPort(net);

        this.os = new OS(this, fs, net, { mandatoryOnly: true });

        // The OS screen scales to fit (see OS._attachScaler), so the panel may
        // be resized down well below its content's natural size — but only at
        // the screen's aspect ratio, so there is never any letterboxing.
        this.panelResizable = true;
        this.panelMinWidth = 320;
        this.panelMinHeight = 300;
        this.panelAspectRatio = OS.SCREEN_W / OS.SCREEN_H;

        this.onPanelCreated = (/** @type {HTMLElement} */ body) => {
            this.os.mount(body);
        };
        this.onPanelOpen = () => {
            this.os.refocus();
            this.os.relayoutScreen();
        };
        this.onPanelResize = () => this.os.relayoutScreen();
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
        if (!nic) throw new Error("Tablet: IPStack has no interfaces");

        nic.port.unsubscribe(nic);
        const wPort = new WirelessPort("wlan0");
        nic.port = wPort;
        wPort.subscribe(nic);
        nic.name = "wlan0";
        return wPort;
    }

    // --- Port API (no wired ports — Tablet cannot be cabled) ---

    /** @returns {never[]} */
    listPorts()      { return []; }
    /** @param {*} _k @returns {null} */
    getPortByKey(_k) { return null; }

    // --- Persistence ---

    toJSON() {
        const ipConfig = /** @type {IPv4ConfigApp|undefined} */ (this.os.runningApps.find(a => a instanceof IPv4ConfigApp));
        const installedApps = this.os.getInstalledAppIds();
        return {
            ...super.toJSON(),
            kind: "Tablet",
            net:  this.net.toJSON(),
            fs:   this.fs.toJSON(),
            dns:  this.dns.serverIp?.toString() ?? null,
            ssid: this._ssid,
            dhcpMode: { ...(ipConfig?.persisted?.modeByIface ?? {}) },
            ...(installedApps.length > 0 && { installedApps }),
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Tablet(String(n.name ?? t("tablet.title")));
        obj._applyBaseJSON(n);

        if (n.net) {
            const net = IPStack.fromJSON(n.net);
            obj._wPort = Tablet._installWirelessPort(net);
            obj.os.net = net;
        }
        if (n.fs)  obj.os.fs = VirtualFileSystem.fromJSON(n.fs);
        if (n.dns) obj.os.dns.setServer(n.dns);
        obj._ssid = String(n.ssid ?? "");

        if (n.installedApps?.length) obj.os._applyInstalledApps(n.installedApps);
        else obj.os._installAllApps(); // old file without installedApps → restore all

        const dhcpMode = n.dhcpMode ?? {};
        if (Object.values(dhcpMode).some(v => v === "dhcp")) {
            const ipConfig = /** @type {IPv4ConfigApp|undefined} */ (obj.os.runningApps.find(a => a instanceof IPv4ConfigApp));
            if (ipConfig) void ipConfig._autoDhcpStartFromMode(dhcpMode);
        }

        return obj;
    }
}
