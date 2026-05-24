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


export class PC extends SimulatedObject {

    kind="PC";
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

    constructor(name = t("pc.title")) {
        super(name);
        this.root.classList.add("pc");

        const fs = new VirtualFileSystem();
        const net = new IPStack(1, name);
        this.os = new OS(this, fs, net);

        this.onPanelCreated = (/** @type {HTMLElement} */ body) => {
            this.os.mount(body);
        };
        this.onPanelOpen = () => {
            this.os.refocus();
        };
    }

    toJSON() {
        const ipConfig = /** @type {IPv4ConfigApp|undefined} */ (this.os.runningApps.find(a => a instanceof IPv4ConfigApp));
        return {
            ...super.toJSON(),
            kind: "PC",
            net: this.net.toJSON(),
            fs: this.fs.toJSON(),
            dns: this.dns.serverIp?.toString() ?? null,
            dhcpMode: { ...(ipConfig?.persisted?.modeByIface ?? {}) },
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new PC(n.name ?? "PC");
        obj._applyBaseJSON(n);

        if (n.net) obj.os.net = IPStack.fromJSON(n.net);
        if (n.fs) obj.os.fs = VirtualFileSystem.fromJSON(n.fs);
        if (n.dns) obj.os.dns.setServer(n.dns);

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
