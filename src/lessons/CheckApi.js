//@ts-check
import { Computer } from "../sim/Computer.js";
import { Tablet } from "../sim/Tablet.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { TerminalApp } from "../apps/TerminalApp.js";
import { setTrafficSuppressed } from "../lib/CheckState.js";
import { SimTimer, simTimer } from "../lib/SimTimer.js";
import { parseHttpUrl, resolveHost, openTlsTransport, httpRequest } from "../net/HttpClient.js";

/** Step interval (real ms) while checks run — faster than any speed preset, so a
 *  failing ping's simulated timeout passes in seconds rather than a minute. */
const CHECK_TICK_MS = 20;

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
        // SimControl.tick is static; reached via the instance's class to
        // avoid a circular import (SimControl → LessonsPanel → CheckApi).
        const simClass = /** @type {any} */ (this.simControl.constructor);
        const prevTick = typeof simClass.tick === "number" ? simClass.tick : null;
        if (prevTick !== null) simClass.tick = Math.min(prevTick, CHECK_TICK_MS);
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
            if (prevTick !== null) simClass.tick = prevTick;
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

    /**
     * Any device with an IP stack (PCs, tablets, routers, …) — enough for
     * the passive checks that only read addresses or routes.
     * @param {number} id
     * @returns {{ net: any }}
     */
    _netDevice(id) {
        const obj = /** @type {any} */ (this._find(id));
        if (!obj?.net?.interfaces || !obj?.net?.routingTable) throw new Error(`Device ${id} has no IP stack`);
        return obj;
    }

    /**
     * End devices with their own IP stack and OS — PCs and tablets alike.
     * @param {number} id
     */
    _computer(id) {
        const obj = this._find(id);
        if (!(obj instanceof Computer) && !(obj instanceof Tablet)) throw new Error(`Device ${id} is not a computer or tablet`);
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
        const computer = this._netDevice(deviceId);
        const { network, prefix } = parseCidr(cidr);
        return computer.net.interfaces.some((/** @type {any} */ iface) => iface.ip && iface.ip.isV4() && matchesPrefix(iface.ip, network, prefix));
    }

    /**
     * Does `deviceId`'s routing table contain an entry for exactly `cidr`
     * (e.g. hasRoute(20, "0.0.0.0/0") for a default route)?
     * @param {number} deviceId @param {string} cidr
     */
    async hasRoute(deviceId, cidr) {
        const computer = this._netDevice(deviceId);
        const { network, prefix } = parseCidr(cidr);
        return computer.net.routingTable.some((/** @type {any} */ r) => r.prefixLength === prefix && matchesPrefix(r.dst, network, prefix));
    }

    /**
     * Does `path` exist in `deviceId`'s filesystem?
     * @param {number} deviceId @param {string} path
     */
    async fileExists(deviceId, path) {
        const computer = this._computer(deviceId);
        return computer.fs.exists(path);
    }

    /**
     * Does `deviceId` trust a certificate with common name `cn` (it sits in
     * the device's trust store, /etc/certs/trusted)?
     * @param {number} deviceId @param {string} cn
     */
    async trusts(deviceId, cn) {
        const store = this._computer(deviceId).os?.tls?.certStore;
        return !!store?.trustedCAs.some((/** @type {any} */ c) => c.subject === `CN=${cn}`);
    }

    /**
     * Is there a certificate for `cn` with its private key in `deviceId`'s
     * /etc/certs — optionally issued (signed) by the CA `issuerCn`?
     * @param {number} deviceId @param {string} cn @param {string} [issuerCn]
     */
    async hasCert(deviceId, cn, issuerCn) {
        const fs = this._computer(deviceId).fs;
        let names = [];
        try { names = fs.readdir("/etc/certs"); } catch { return false; }
        return names.filter((/** @type {string} */ n) => n.endsWith(".json")).some((/** @type {string} */ n) => {
            try {
                const c = JSON.parse(fs.readFile(`/etc/certs/${n}`));
                return c.subject === `CN=${cn}` && c.hasPrivateKey
                    && (!issuerCn || c.issuer === `CN=${issuerCn}`);
            } catch { return false; }
        });
    }

    // ── Active checks (real simulated traffic) ──────────────────────────

    /**
     * Sends a real ICMP echo from `fromId` to `to` (a device id or literal
     * IP) and waits for a reply — twice as long as a terminal ping would,
     * which leaves room for a first ARP round trip.
     * @param {number} fromId @param {number|string} to
     */
    async pingOk(fromId, to) {
        const from = this._computer(fromId);
        const dstIp = this._resolveIp(to);
        // Another device whose address is one of our own (duplicate IP, e.g.
        // two fresh PCs on the default address) would "answer" from inside
        // this very stack — that proves nothing about reachability.
        if (to !== fromId && from.net.interfaces.some((i) => i.ip && i.ip.toString() === dstIp.toString())) return false;
        try {
            await from.net.icmpEcho(dstIp, { timeoutMs: 2 * SimTimer.PING_TIMEOUT_MS });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * The opposite of pingOk(): true if `to` does NOT answer — for tasks
     * where traffic must be blocked (VLAN separation, firewall rules).
     * @param {number} fromId @param {number|string} to
     */
    async pingFails(fromId, to) {
        return !(await this.pingOk(fromId, to));
    }

    /**
     * True if `deviceId`, asking its configured DNS server, resolves `name`
     * to `expectedIp` (IPv4) — for DNS tasks (records, resolver settings).
     * @param {number} deviceId @param {string} name @param {string} expectedIp
     */
    async resolves(deviceId, name, expectedIp) {
        const dns = this._computer(deviceId).os?.dns;
        if (!dns?.resolveA_IP) return false;
        const lookup = dns.resolveA_IP(String(name)).catch(() => []);
        const timeout = new Promise((resolve) => simTimer.schedule(() => resolve([]), 2 * SimTimer.DNS_RESOLVE_TIMEOUT_MS));
        const ips = /** @type {IPAddress[]} */ (await Promise.race([lookup, timeout]));
        return ips.some((ip) => ip.toString() === String(expectedIp));
    }

    /**
     * True if a TCP connection from `fromId` to `to`:`port` can be opened
     * (a server listens there) — closed again right away. False on RST
     * (port closed), no answer, or no route.
     * @param {number} fromId @param {number|string} to @param {number} port
     */
    async tcpOpen(fromId, to, port) {
        const from = this._computer(fromId);
        const dstIp = this._resolveIp(to);
        const timeout = new Promise((resolve) => simTimer.schedule(() => resolve(null), 2 * SimTimer.PING_TIMEOUT_MS));
        try {
            const conn = await Promise.race([from.net.connectTCPConn(dstIp, Number(port)), timeout]);
            if (!conn) return false;
            try { from.net.closeTCPConn(conn.key); } catch { /* already gone */ }
            return true;
        } catch {
            return false;
        }
    }

    /**
     * True if `fromId` can fetch `url` over HTTPS like a browser would: the
     * TLS handshake succeeds with full certificate checks (trusted, valid,
     * issued for the host name) and the server answers with a status < 400.
     * @param {number} fromId @param {string} url
     */
    async httpsOk(fromId, url) {
        const os = this._computer(fromId).os;
        const u = parseHttpUrl(String(url));
        if (!u.ok || u.scheme !== "https") return false;
        const attempt = (async () => {
            const ip = await resolveHost(os, u.host);
            const conn = await openTlsTransport(os, ip, u.port, u.host);
            try {
                const res = await httpRequest({ transport: conn.transport, method: "GET", hostHeader: u.host, path: u.path });
                return res.statusCode < 400;
            } finally { conn.close(); }
        })().catch(() => false);
        const timeout = new Promise((resolve) => simTimer.schedule(() => resolve(false), SimTimer.HTTP_CLIENT_TIMEOUT_MS));
        return /** @type {boolean} */ (await Promise.race([attempt, timeout]));
    }

    /**
     * The opposite of tcpOpen(): true if NO TCP connection from `fromId` to
     * `to`:`port` comes about — for firewall tasks (blocked = dropped or
     * rejected, or simply nothing listening).
     * @param {number} fromId @param {number|string} to @param {number} port
     */
    async tcpFails(fromId, to, port) {
        return !(await this.tcpOpen(fromId, to, port));
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
