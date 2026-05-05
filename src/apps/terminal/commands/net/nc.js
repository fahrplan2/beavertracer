//@ts-check

import { IPAddress } from "../../../../net/models/IPAddress.js";
import { t } from "../../../../i18n/index.js";

// ── encoding helpers ──────────────────────────────────────────────────────────

/** @param {string} s */
function enc(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
}

/** @param {Uint8Array} b */
function dec(b) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
    let s = ""; for (const byte of b) s += String.fromCharCode(byte); return s;
}

// ── bidirectional passthrough ─────────────────────────────────────────────────

/**
 * @param {import("../types.js").ShellContext} ctx
 * @param {{
 *   send: (data: Uint8Array) => void,
 *   recv: () => Promise<Uint8Array|null>,
 *   close: () => void,
 * }} io
 */
async function bidir(ctx, { send, recv, close }) {
    let closed = false;
    /** @type {(() => void)|null} */ let resolveDone = null;
    const done = new Promise(r => { resolveDone = /** @type {any} */ (r); });

    const doClose = () => {
        if (closed) return;
        closed = true;
        ctx.app.rawInputHandler = null;
        close();
        ctx.println(t("app.terminal.commands.nc.closed"));
        resolveDone?.();
    };

    ctx.onInterrupt(doClose);

    ctx.app.rawInputHandler = (line) => {
        if (closed) return;
        try { send(enc(line + "\n")); } catch { doClose(); }
    };

    // receive loop
    (async () => {
        while (!closed) {
            let chunk;
            try { chunk = await recv(); } catch { break; }
            if (chunk == null) break;
            // strip trailing CRLF/LF per line for clean display
            const text = dec(chunk);
            const lines = text.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].replace(/\r$/, "");
                if (i < lines.length - 1 || line.length > 0) ctx.println(line);
            }
        }
        doClose();
    })();

    await done;
}

// ── TCP connect ───────────────────────────────────────────────────────────────

/**
 * @param {import("../types.js").ShellContext} ctx
 * @param {string} host
 * @param {number} port
 */
async function ncTcpConnect(ctx, host, port) {
    let ip = /** @type {IPAddress|null} */ (null);
    try { ip = IPAddress.fromString(host); } catch {}
    if (!ip) try { ip = await ctx.os.dns.resolveIP(host); } catch {}
    if (!ip) return t("app.terminal.commands.nc.err.resolve", { host });

    let key = /** @type {string|null} */ (null);
    try {
        const conn = await ctx.os.net.connectTCPConn(ip, port);
        key = conn?.key ?? null;
    } catch (e) {
        return t("app.terminal.commands.nc.err.connect", { reason: e instanceof Error ? e.message : String(e) });
    }
    if (!key) return t("app.terminal.commands.nc.err.nokey");

    await bidir(ctx, {
        send:  (d) => ctx.os.net.sendTCPConn(key, d),
        recv:  ()  => ctx.os.net.recvTCPConn(key),
        close: ()  => { try { ctx.os.net.closeTCPConn(key); } catch {} },
    });
}

// ── TCP listen ────────────────────────────────────────────────────────────────

/**
 * @param {import("../types.js").ShellContext} ctx
 * @param {number} port
 */
async function ncTcpListen(ctx, port) {
    let ref = /** @type {any} */ (null);
    let key = /** @type {string|null} */ (null);
    let accepted = false;

    const cleanup = () => {
        try { if (ref != null && !accepted) ctx.os.net.closeTCPServerSocket(ref); } catch {}
        try { if (key != null) ctx.os.net.closeTCPConn(key); } catch {}
    };

    try {
        ref = ctx.os.net.openTCPServerSocket(new IPAddress(4, 0), port);
    } catch (e) {
        return t("app.terminal.commands.nc.err.listen", { port, reason: e instanceof Error ? e.message : String(e) });
    }

    ctx.println(t("app.terminal.commands.nc.listening", { port }));
    ctx.onInterrupt(cleanup);

    try {
        key = await ctx.os.net.acceptTCPConn(ref);
        accepted = true;
        ctx.os.net.closeTCPServerSocket(ref); ref = null;
    } catch (e) {
        cleanup();
        return t("app.terminal.commands.nc.err.accept", { reason: e instanceof Error ? e.message : String(e) });
    }

    ctx.println(t("app.terminal.commands.nc.connected"));

    await bidir(ctx, {
        send:  (d) => ctx.os.net.sendTCPConn(key, d),
        recv:  ()  => ctx.os.net.recvTCPConn(key),
        close: ()  => { try { ctx.os.net.closeTCPConn(key); } catch {} },
    });
}

// ── UDP connect ───────────────────────────────────────────────────────────────

/**
 * @param {import("../types.js").ShellContext} ctx
 * @param {string} host
 * @param {number} port
 */
async function ncUdpConnect(ctx, host, port) {
    let ip = /** @type {IPAddress|null} */ (null);
    try { ip = IPAddress.fromString(host); } catch {}
    if (!ip) try { ip = await ctx.os.dns.resolveIP(host); } catch {}
    if (!ip) return t("app.terminal.commands.nc.err.resolve", { host });

    const localPort = 10000 + Math.floor(Math.random() * 40000);
    let sock = /** @type {any} */ (null);
    try {
        sock = ctx.os.net.openUDPSocket(new IPAddress(4, 0), localPort);
    } catch (e) {
        return t("app.terminal.commands.nc.err.udpopen", { reason: e instanceof Error ? e.message : String(e) });
    }

    ctx.println(t("app.terminal.commands.nc.udp.ready", { host: ip.toString(), port }));

    let closed = false;
    /** @type {(() => void)|null} */ let resolveDone = null;
    const done = new Promise(r => { resolveDone = /** @type {any} */ (r); });

    const doClose = () => {
        if (closed) return;
        closed = true;
        ctx.app.rawInputHandler = null;
        try { ctx.os.net.closeUDPSocket(sock); } catch {}
        ctx.println(t("app.terminal.commands.nc.closed"));
        resolveDone?.();
    };

    ctx.onInterrupt(doClose);

    ctx.app.rawInputHandler = (line) => {
        if (closed) return;
        try { ctx.os.net.sendUDPSocket(sock, ip, port, enc(line + "\n")); } catch { doClose(); }
    };

    (async () => {
        while (!closed) {
            let pkt;
            try { pkt = await ctx.os.net.recvUDPSocket(sock); } catch { break; }
            if (!pkt) break;
            const data = pkt.payload instanceof Uint8Array ? pkt.payload : (pkt.data instanceof Uint8Array ? pkt.data : null);
            if (data) ctx.println(dec(data).trimEnd());
        }
        doClose();
    })();

    await done;
}

// ── UDP listen ────────────────────────────────────────────────────────────────

/**
 * @param {import("../types.js").ShellContext} ctx
 * @param {number} port
 */
async function ncUdpListen(ctx, port) {
    let sock = /** @type {any} */ (null);
    try {
        sock = ctx.os.net.openUDPSocket(new IPAddress(4, 0), port);
    } catch (e) {
        return t("app.terminal.commands.nc.err.udpopen", { reason: e instanceof Error ? e.message : String(e) });
    }

    ctx.println(t("app.terminal.commands.nc.udp.listening", { port }));

    let closed = false;
    /** @type {IPAddress|null} */ let remoteIp = null;
    let remotePort = 0;
    /** @type {(() => void)|null} */ let resolveDone = null;
    const done = new Promise(r => { resolveDone = /** @type {any} */ (r); });

    const doClose = () => {
        if (closed) return;
        closed = true;
        ctx.app.rawInputHandler = null;
        try { ctx.os.net.closeUDPSocket(sock); } catch {}
        ctx.println(t("app.terminal.commands.nc.closed"));
        resolveDone?.();
    };

    ctx.onInterrupt(doClose);

    ctx.app.rawInputHandler = (line) => {
        if (closed || !remoteIp) return;
        try { ctx.os.net.sendUDPSocket(sock, remoteIp, remotePort, enc(line + "\n")); } catch { doClose(); }
    };

    (async () => {
        while (!closed) {
            let pkt;
            try { pkt = await ctx.os.net.recvUDPSocket(sock); } catch { break; }
            if (!pkt) break;

            // learn sender on first packet
            if (!remoteIp) {
                const src = pkt.src ?? pkt.srcIp ?? null;
                try { remoteIp = src instanceof IPAddress ? src : IPAddress.fromString(String(src)); } catch {}
                remotePort = typeof pkt.srcPort === "number" ? pkt.srcPort : 0;
                ctx.println(t("app.terminal.commands.nc.udp.from", {
                    ip: remoteIp?.toString() ?? "?", port: remotePort,
                }));
            }

            const data = pkt.payload instanceof Uint8Array ? pkt.payload : (pkt.data instanceof Uint8Array ? pkt.data : null);
            if (data) ctx.println(dec(data).trimEnd());
        }
        doClose();
    })();

    await done;
}

// ── command ───────────────────────────────────────────────────────────────────

/** @type {import("../types.js").Command} */
export const nc = {
    name: "nc",
    run: async (ctx, args) => {
        let listen = false, udp = false;
        const positional = /** @type {string[]} */ ([]);

        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === "-l") listen = true;
            else if (a === "-u") udp = true;
            else if (a === "-lu" || a === "-ul") { listen = true; udp = true; }
            else if (a === "-n") { /* no DNS — ignored; we try literal IP first */ }
            else if (a === "-v") { /* verbose — ignored; we're always verbose */ }
            else if (!a.startsWith("-")) positional.push(a);
        }

        if (listen) {
            if (positional.length < 1) return t("app.terminal.commands.nc.usage");
            const port = Number(positional[0]);
            if (!Number.isInteger(port) || port < 1 || port > 65535)
                return t("app.terminal.commands.nc.err.invalidPort");
            return udp ? await ncUdpListen(ctx, port) : await ncTcpListen(ctx, port);
        } else {
            if (positional.length < 2) return t("app.terminal.commands.nc.usage");
            const host = positional[0];
            const port = Number(positional[1]);
            if (!Number.isInteger(port) || port < 1 || port > 65535)
                return t("app.terminal.commands.nc.err.invalidPort");
            return udp ? await ncUdpConnect(ctx, host, port) : await ncTcpConnect(ctx, host, port);
        }
    },
};
