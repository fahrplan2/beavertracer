//@ts-check

import { t } from "../../../../i18n/index.js";
import { IPAddress } from "../../../../net/models/IPAddress.js";
import { sleepAbortable } from "../lib/abort.js";

// ── limits ────────────────────────────────────────────────────────────────────

const MAX_PORTS = 1000;
const MAX_HOSTS = 256; // /24
const CONCURRENCY = 20;
const PROBE_TIMEOUT_MS = 1500;

// ── service name table ────────────────────────────────────────────────────────

/** @type {Record<number, string>} */
const SERVICE = {
    21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "domain",
    67: "dhcp", 68: "dhcp", 80: "http", 110: "pop3", 111: "rpcbind",
    143: "imap", 443: "https", 445: "smb", 465: "smtps", 587: "submission",
    993: "imaps", 995: "pop3s", 3306: "mysql", 3389: "rdp",
    5900: "vnc", 6667: "irc", 8080: "http-proxy", 8443: "https-alt",
};

// default top-20 ports (mirrors nmap's most common services)
const DEFAULT_PORTS = [
    21, 22, 23, 25, 53, 80, 110, 143, 443, 445,
    465, 587, 993, 995, 3306, 3389, 5900, 6667, 8080, 8443,
];

// ── port range parser ─────────────────────────────────────────────────────────

/**
 * Parse a port spec like "22", "80,443", "1-1024", "22,80-90,443".
 * Returns sorted, deduplicated port list.  Returns null on parse error.
 * @param {string} spec
 * @returns {number[]|null}
 */
function parsePorts(spec) {
    /** @type {Set<number>} */
    const out = new Set();
    for (const part of spec.split(",")) {
        const dash = part.indexOf("-");
        if (dash === -1) {
            const p = parseInt(part, 10);
            if (!Number.isInteger(p) || p < 1 || p > 65535) return null;
            out.add(p);
        } else {
            const lo = parseInt(part.slice(0, dash), 10);
            const hi = parseInt(part.slice(dash + 1), 10);
            if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi > 65535 || lo > hi) return null;
            for (let p = lo; p <= hi; p++) out.add(p);
        }
    }
    return [...out].sort((a, b) => a - b);
}

// ── CIDR / target parser ──────────────────────────────────────────────────────

/**
 * Expand a CIDR string (IPv4 only) into a list of host IPAddresses.
 * Returns null on parse error; returns error string if limit exceeded.
 * @param {string} cidr
 * @returns {IPAddress[]|null|string}
 */
function expandCIDR(cidr) {
    const slash = cidr.lastIndexOf("/");
    if (slash === -1) return null;
    const prefix = parseInt(cidr.slice(slash + 1), 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    if (prefix < 24) return t("app.terminal.commands.nmap.err.rangeTooBig");

    let base;
    try { base = IPAddress.fromString(cidr.slice(0, slash)); } catch { return null; }
    if (!base.isV4()) return t("app.terminal.commands.nmap.err.ipv4only");

    const baseNum = /** @type {number} */ (base.getNumber()) >>> 0;
    const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
    const network = (baseNum & mask) >>> 0;
    const count = 1 << (32 - prefix);

    /** @type {IPAddress[]} */
    const hosts = [];
    for (let i = 1; i < count - 1; i++) {
        hosts.push(new IPAddress(4, (network + i) >>> 0));
    }
    // for /32 or /31 include the base itself
    if (count <= 2) hosts.push(base);

    return hosts;
}

// ── single-port SYN probe ─────────────────────────────────────────────────────

/**
 * @typedef {"open"|"closed"|"filtered"} PortState
 */

/**
 * Attempt a TCP connect to determine port state.
 * @param {any} ctx
 * @param {IPAddress} ip
 * @param {number} port
 * @returns {Promise<PortState>}
 */
async function probePort(ctx, ip, port) {
    let key = /** @type {string|null} */ (null);
    const timeoutId = { id: /** @type {any} */ (null) };

    try {
        const connectPromise = ctx.os.net.connectTCPConn(ip, port);
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId.id = setTimeout(() => reject(new Error("filtered")), PROBE_TIMEOUT_MS);
        });

        const conn = await Promise.race([connectPromise, timeoutPromise]);
        clearTimeout(timeoutId.id);
        key = conn?.key ?? null;
        if (key) {
            try { ctx.os.net.closeTCPConn(key); } catch {}
        }
        return "open";
    } catch (e) {
        clearTimeout(timeoutId.id);
        if (key) { try { ctx.os.net.closeTCPConn(key); } catch {} }
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "filtered") return "filtered";
        // RST / connect failed → closed
        return "closed";
    }
}

// ── host scanner ──────────────────────────────────────────────────────────────

/**
 * @param {any} ctx
 * @param {IPAddress} ip
 * @param {number[]} ports
 * @param {boolean} openOnly
 * @returns {Promise<{port:number, state:PortState}[]>}
 */
async function scanHost(ctx, ip, ports, openOnly) {
    /** @type {{port:number, state:PortState}[]} */
    const results = [];

    for (let i = 0; i < ports.length; i += CONCURRENCY) {
        if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

        const batch = ports.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(batch.map(p => probePort(ctx, ip, p)));

        for (let j = 0; j < batch.length; j++) {
            const s = settled[j];
            const state = s.status === "fulfilled" ? s.value : "filtered";
            if (!openOnly || state === "open") {
                results.push({ port: batch[j], state });
            }
        }

        // brief yield between batches so the simulator stays responsive
        await sleepAbortable(10, ctx.signal);
    }

    return results;
}

// ── output helpers ────────────────────────────────────────────────────────────

/**
 * @param {{port:number, state:PortState}[]} results
 * @param {any} ctx
 */
function printHostReport(results, ctx) {
    const visible = results.filter(r => r.state !== "closed");
    if (visible.length === 0) {
        ctx.println(t("app.terminal.commands.nmap.out.allClosed"));
        return;
    }

    ctx.println(t("app.terminal.commands.nmap.out.tableHeader"));
    for (const { port, state } of visible) {
        const svc = SERVICE[port] ?? "";
        const portCol = `${port}/tcp`.padEnd(10);
        const stateCol = state.padEnd(9);
        ctx.println(`${portCol} ${stateCol} ${svc}`);
    }
}

// ── command ───────────────────────────────────────────────────────────────────

/** @type {import("../types.js").Command} */
export const nmap = {
    name: "nmap",
    run: async (ctx, args) => {
        const argv = [...args];
        let portSpec = /** @type {string|null} */ (null);
        let openOnly = false;
        /** @type {string[]} */
        const targets = [];

        while (argv.length) {
            const a = argv.shift() ?? "";

            if (a === "--help" || a === "-h") {
                return t("app.terminal.commands.nmap.help");
            }

            if (a === "-p") {
                portSpec = argv.shift() ?? null;
                if (!portSpec) return t("app.terminal.commands.nmap.err.missingPortSpec");
                continue;
            }

            if (a.startsWith("-p")) {
                portSpec = a.slice(2);
                continue;
            }

            if (a === "--open") {
                openOnly = true;
                continue;
            }

            // ignore common nmap flags silently
            if (a === "-sS" || a === "-sT" || a === "-v" || a === "-vv" || a === "-n") continue;

            if (!a.startsWith("-")) {
                targets.push(a);
            }
        }

        if (targets.length === 0) return t("app.terminal.commands.nmap.usage");

        // parse ports
        let ports = DEFAULT_PORTS;
        if (portSpec) {
            const parsed = parsePorts(portSpec);
            if (!parsed) return t("app.terminal.commands.nmap.err.invalidPortSpec", { spec: portSpec });
            if (parsed.length > MAX_PORTS)
                return t("app.terminal.commands.nmap.err.tooManyPorts", { max: MAX_PORTS });
            ports = parsed;
        }

        // expand targets to IP list
        /** @type {IPAddress[]} */
        const hosts = [];
        for (const target of targets) {
            if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

            if (target.includes("/")) {
                const result = expandCIDR(target);
                if (result === null) return t("app.terminal.commands.nmap.err.invalidTarget", { target });
                if (typeof result === "string") return result;
                if (hosts.length + result.length > MAX_HOSTS)
                    return t("app.terminal.commands.nmap.err.tooManyHosts", { max: MAX_HOSTS });
                hosts.push(...result);
            } else {
                let ip = /** @type {IPAddress|null} */ (null);
                try { ip = IPAddress.fromString(target); } catch {}
                if (!ip) {
                    try { ip = await ctx.os.dns.resolveIP(target); } catch {}
                }
                if (!ip) return t("app.terminal.commands.nmap.err.cannotResolve", { host: target });
                hosts.push(ip);
            }
        }

        ctx.println(t("app.terminal.commands.nmap.out.banner", {
            hosts: hosts.length,
            ports: ports.length,
        }));

        for (const ip of hosts) {
            if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

            const ipStr = ip.toString();
            ctx.println("");
            ctx.println(t("app.terminal.commands.nmap.out.scanReport", { ip: ipStr }));

            const results = await scanHost(ctx, ip, ports, openOnly);
            printHostReport(results, ctx);
        }

        ctx.println("");
        ctx.println(t("app.terminal.commands.nmap.out.done", { hosts: hosts.length }));
    },
};
