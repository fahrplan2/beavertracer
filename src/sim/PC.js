//@ts-check

import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { OS } from "../apps/OS.js";
import { IPStack } from "../net/IPStack.js";
import { t } from "../i18n/index.js";
import { SimulatedObject } from "./SimulatedObject.js";


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

        this.onPanelCreated = (body) => {
            this.os.mount(body);
        };
    }

    toJSON() {
        return {
            ...super.toJSON(),
            kind: "PC",
            net: this.net.toJSON(),
            fs: this.fs.toJSON(),
            dns: this.dns.serverIp,
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new PC(n.name ?? "PC");
        obj._applyBaseJSON(n);

        if (n.net) obj.os.net = IPStack.fromJSON(n.net);
        if (n.fs) obj.os.fs = VirtualFileSystem.fromJSON(n.fs);
        if (n.dns) { obj.os.dns.setServer(n.dns); };

        return obj;
    }


    /** @returns {PortDescriptor[]} */
    listPorts() {
        const ifs = this.net?.interfaces ?? [];
        return ifs.map((nic, i) => ({
            key: `eth${i}`,
            label: `eth${i}`,
            port: nic.port,
        }));
    }

    /** @param {string} key */
    getPortByKey(key) {
        const m = /^eth(\d+)$/.exec(key);
        if (!m) return null;
        const i = Number(m[1]);
        const nic = (this.net?.interfaces ?? [])[i];
        return nic?.port ?? null;
    }

    /**
     * 
     * @param {boolean} open 
     */
    setPanelOpen(open) {
        super.setPanelOpen(open);

        //Focus menu, when the panel was opend
        if(open==true) {
            this.os.unfocus();
        }
    }
}