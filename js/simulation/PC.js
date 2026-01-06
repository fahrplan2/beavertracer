//@ts-check

import { VirtualFileSystem } from "../apps/lib/VirtualFileSystem.js";
import { OS } from "../apps/OS.js";
import { IPStack } from "../devices/IPStack.js";
import { SimulatedObject } from "./SimulatedObject.js";


/**
 * @typedef {Object} PortDescriptor
 * @property {string} key
 * @property {string} label
 * @property {import("../devices/EthernetPort.js").EthernetPort} port
 */


export class PC extends SimulatedObject {

    /** @type {IPStack} */
    get net() {
        return this.os.net;
    }

    get fs() {
        return this.os.fs;
    }

    /** @type {OS} */
    os;

    constructor(name = "PC") {
        super(name);
        this.root.classList.add("pc");

        const fs = new VirtualFileSystem();
        const net = new IPStack(1, name);
        this.os = new OS(name, fs, net);

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
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new PC(n.name ?? "PC");
        obj._applyBaseJSON(n);

        if (n.net) obj.os.net = IPStack.fromJSON(n.net);
        if (n.fs) obj.os.fs = VirtualFileSystem.fromJSON(n.fs);

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
}