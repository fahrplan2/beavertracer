//@ts-check

import { SwitchBackplane } from "../devices/SwitchBackplane.js";
import { SimulatedObject } from "./SimulatedObject.js";

export class Switch extends SimulatedObject {

    /** @type { SwitchBackplane } */
    device;

    /**
     * 
     * @param {String} name 
     */
    constructor(name) {
        super(name);
        this.device = new SwitchBackplane(16);
    }

    toJSON() {
        return { ...super.toJSON(), kind: "Switch" };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Switch(n.name ?? "Switch");
        obj._applyBaseJSON(n);
        return obj;
    }

    listPorts() {
        const ports = this.device?.ports ?? [];
        return ports.map((p, i) => ({
            key: `sw${i}`,
            label: `port ${i + 1}`,
            port: p,
        }));
    }

    /** @param {string} key */
    getPortByKey(key) {
        const m = /^sw(\d+)$/.exec(key);
        if (!m) return null;
        const i = Number(m[1]);
        return (this.device?.ports ?? [])[i] ?? null;
    }

}