//@ts-check

import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { OS } from "../apps/OS.js";
import { IPStack } from "../net/IPStack.js";
import { t } from "../i18n/index.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { IPv4ConfigApp } from "../apps/IPv4ConfigApp.js";


/**
 * @typedef {Object} PortDescriptor
 * @property {string} key
 * @property {string} label
 * @property {import("../net/EthernetPort.js").EthernetPort} port
 */


export class Computer extends SimulatedObject {

    kind="Computer";
    icon="fa-desktop";

    /** @type {IPStack} */
    get net() {
        return this.os.net;
    }

    get fs() {
        return this.os.fs;
    }

    get dns() {
        return this.os.dns;
    }

    /** @type {OS} */
    os;

    /**
     * @param {string} name
     */

    constructor(name = t("computer.title")) {
        super(name);
        this.root.classList.add("computer");

        const fs = new VirtualFileSystem();
        const net = new IPStack(1, name);
        this.os = new OS(this, fs, net, { mandatoryOnly: true });

        this.onPanelCreated = (/** @type {HTMLElement} */ body) => {
            this.os.mount(body);
        };
        this.onPanelOpen = () => {
            this.os.refocus();
        };
    }

    toJSON() {
        const ipConfig = /** @type {IPv4ConfigApp|undefined} */ (this.os.runningApps.find(a => a instanceof IPv4ConfigApp));
        const installedApps = this.os.getInstalledAppIds();
        return {
            ...super.toJSON(),
            kind: "Computer",
            net: this.net.toJSON(),
            fs: this.fs.toJSON(),
            dns: this.dns.serverIp?.toString() ?? null,
            dhcpMode: { ...(ipConfig?.persisted?.modeByIface ?? {}) },
            ...(installedApps.length > 0 && { installedApps }),
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Computer(n.name ?? t("computer.title"));
        obj._applyBaseJSON(n);

        if (n.net) obj.os.net = IPStack.fromJSON(n.net);
        if (n.fs) obj.os.fs = VirtualFileSystem.fromJSON(n.fs);
        if (n.dns) obj.os.dns.setServer(n.dns);

        if (n.installedApps?.length) obj.os._applyInstalledApps(n.installedApps);
        else obj.os._installAllApps(); // old file without installedApps → restore all

        const dhcpMode = n.dhcpMode ?? {};
        if (Object.values(dhcpMode).some(v => v === "dhcp")) {
            const ipConfig = /** @type {IPv4ConfigApp|undefined} */ (obj.os.runningApps.find(a => a instanceof IPv4ConfigApp));
            if (ipConfig) void ipConfig._autoDhcpStartFromMode(dhcpMode);
        }

        return obj;
    }


    /** @returns {PortDescriptor[]} */
    listPorts()           { return SimulatedObject.listEthPorts(this.net?.interfaces); }
    /** @param {string} key */
    getPortByKey(key)     { return SimulatedObject.getEthPortByKey(this.net?.interfaces, key); }

    /**
     *
     * @param {boolean} open
     */
    setPanelOpen(open) {
        super.setPanelOpen(open);

    }
}
