//@ts-check
import { Computer } from "../sim/Computer.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { TerminalApp } from "../apps/TerminalApp.js";
import { setTrafficSuppressed } from "../lib/CheckState.js";

/**
 * @param {IPAddress} addr
 * @param {IPAddress} network
 * @param {number} prefixLength
 */
function matchesPrefix(addr, network, prefixLength) {
    const a = addr.toUInt8();
    const n = network.toUInt8();
    if (a.length !== n.length) return false;
    let rem = prefixLength | 0;
    for (let i = 0; i < a.length && rem > 0; i++) {
        if (rem >= 8) {
            if (a[i] !== n[i]) return false;
            rem -= 8;
        } else {
            const mask = (0xff << (8 - rem)) & 0xff;
            if ((a[i] & mask) !== (n[i] & mask)) return false;
            rem = 0;
        }
    }
    return true;
}

/** @param {string} cidr @returns {{ network: IPAddress, prefix: number }} */
function parseCidr(cidr) {
    const [netStr, prefixStr] = cidr.split("/");
    return { network: IPAddress.fromString(netStr), prefix: Number(prefixStr) };
}

/**
 * Curated, declarative check vocabulary used by ":::task" blocks in
 * lessons. Each method resolves device ids against the live SimControl's
 * object graph, then either reads state (passive) or triggers a real
 * interaction and awaits its outcome (active — pings/shell commands
 * produce real simulated traffic, so the simulation must actually be
 * running; runChecks() takes care of that).
 */
export class CheckApi {
    /** @param {import("../SimControl.js").SimControl} simControl */
    constructor(simControl) {
        this.simControl = simControl;
    }

    /**
     * Runs a list of {fn, args} checks (as parsed from a ":::task" block's
     * data-checks attribute) against the live simulation, temporarily
     * un-pausing it if needed so active checks' simulated traffic can
     * actually be exchanged, then restoring the previous pause state.
     * Real traffic an active check causes (e.g. a scripted ping) is still
     * delivered normally, but kept out of the student-visible packet
     * capture log and animation for the duration (see CheckState.js).
     * @param {{fn: string, args: (string|number)[]}[]} checks
     * @returns {Promise<{fn: string, args: (string|number)[], ok: boolean, error?: string}[]>}
     */
    async runChecks(checks) {
        const wasPaused = this.simControl.isPaused;
        if (wasPaused) {
            this.simControl.isPaused = false;
            this.simControl.scheduleNextStep();
        }
        setTrafficSuppressed(true);
        try {
            const results = [];
            for (const { fn, args } of checks) {
                try {
                    const impl = /** @type {any} */ (this)[fn];
                    if (typeof impl !== "function") throw new Error(`Unknown check: ${fn}`);
                    const ok = await impl.apply(this, args);
                    results.push({ fn, args, ok: !!ok });
                } catch (/** @type {any} */ err) {
                    results.push({ fn, args, ok: false, error: String(err?.message ?? err) });
                }
            }
            return results;
        } finally {
            setTrafficSuppressed(false);
            if (wasPaused) {
                this.simControl.isPaused = true;
                this.simControl.scheduleNextStep();
            }
            this.simControl._invalidateUI();
        }
    }

    /** @param {number} id */
    _find(id) {
        return this.simControl.simobjects.find((o) => o.id === id);
    }

    /** @param {number} id */
    _computer(id) {
        const obj = this._find(id);
        if (!(obj instanceof Computer)) throw new Error(`Device ${id} is not a computer`);
        return obj;
    }

    /**
     * Resolves a check argument that names a destination: either a device
     * id (its first configured IPv4 address is used) or a literal IP string.
     * @param {number|string} to
     */
    _resolveIp(to) {
        if (typeof to === "number") {
            const target = this._computer(to);
            const iface = target.net.interfaces.find((i) => i.ip && i.ip.isV4() && i.ip.getNumber() !== 0);
            if (!iface) throw new Error(`Device ${to} has no IPv4 address`);
            return iface.ip;
        }
        return IPAddress.fromString(String(to));
    }

    // ── Passive checks ──────────────────────────────────────────────────

    /**
     * Does `deviceId` have an IPv4 address inside `cidr` on any interface?
     * @param {number} deviceId @param {string} cidr
     */
    async ip(deviceId, cidr) {
        const computer = this._computer(deviceId);
        const { network, prefix } = parseCidr(cidr);
        return computer.net.interfaces.some((iface) => iface.ip && iface.ip.isV4() && matchesPrefix(iface.ip, network, prefix));
    }

    /**
     * Does `deviceId`'s routing table contain an entry for exactly `cidr`
     * (e.g. hasRoute(20, "0.0.0.0/0") for a default route)?
     * @param {number} deviceId @param {string} cidr
     */
    async hasRoute(deviceId, cidr) {
        const computer = this._computer(deviceId);
        const { network, prefix } = parseCidr(cidr);
        return computer.net.routingTable.some((r) => r.prefixLength === prefix && matchesPrefix(r.dst, network, prefix));
    }

    /**
     * Does `path` exist in `deviceId`'s filesystem?
     * @param {number} deviceId @param {string} path
     */
    async fileExists(deviceId, path) {
        const computer = this._computer(deviceId);
        return computer.fs.exists(path);
    }

    // ── Active checks (real simulated traffic) ──────────────────────────

    /**
     * Sends a real ICMP echo from `fromId` to `to` (a device id or literal
     * IP) and waits for a reply.
     * @param {number} fromId @param {number|string} to
     */
    async pingOk(fromId, to) {
        const from = this._computer(fromId);
        const dstIp = this._resolveIp(to);
        try {
            await from.net.icmpEcho(dstIp, { timeoutMs: 3000 });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Runs `cmd` in a headless shell on `deviceId` (no terminal window is
     * ever opened) and checks whether it succeeded/failed as expected.
     * `expectOk` is 1 (default, command should succeed) or 0 (should fail).
     * @param {number} deviceId @param {string} cmd @param {number} [expectOk]
     */
    async shellCommand(deviceId, cmd, expectOk = 1) {
        const computer = this._computer(deviceId);
        const term = new TerminalApp(computer.os);
        term._registerBuiltins();
        const { ok } = await term.runHeadless(cmd);
        return ok === !!expectOk;
    }
}
