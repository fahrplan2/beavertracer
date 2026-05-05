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

// ── URL parser ────────────────────────────────────────────────────────────────

/**
 * @param {string} url
 * @returns {{ ok: true, host: string, port: number, path: string } | { ok: false, error: string }}
 */
function parseUrl(url) {
    const s = url.trim();
    if (!s.toLowerCase().startsWith("http://"))
        return { ok: false, error: t("app.terminal.commands.curl.err.onlyHttp") };

    const rest = s.slice(7);
    const slash = rest.indexOf("/");
    const authority = slash >= 0 ? rest.slice(0, slash) : rest;
    const path = slash >= 0 ? rest.slice(slash) : "/";
    if (!authority) return { ok: false, error: t("app.terminal.commands.curl.err.noHost") };

    let host = authority, port = 80;
    if (authority.startsWith("[")) {
        const close = authority.indexOf("]");
        if (close < 0) return { ok: false, error: t("app.terminal.commands.curl.err.noHost") };
        host = authority.slice(1, close);
        const after = authority.slice(close + 1);
        if (after.startsWith(":")) { const p = Number(after.slice(1)); if (p > 0 && p <= 65535) port = p; }
    } else {
        const colon = authority.lastIndexOf(":");
        if (colon > 0) {
            const p = Number(authority.slice(colon + 1));
            if (Number.isInteger(p) && p > 0 && p <= 65535) { host = authority.slice(0, colon); port = p; }
        }
    }
    return { ok: true, host, port, path };
}

// ── buffered TCP reader ────────────────────────────────────────────────────────

class BufReader {
    /**
     * @param {(key: string) => Promise<Uint8Array|null>} recvFn
     * @param {string} key
     */
    constructor(recvFn, key) {
        this._recv = recvFn;
        this._key  = key;
        this.buf   = new Uint8Array(0);
        this.eof   = false;
    }

    async _fill() {
        if (this.eof) return;
        const chunk = await this._recv(this._key);
        if (chunk == null) { this.eof = true; return; }
        const m = new Uint8Array(this.buf.length + chunk.length);
        m.set(this.buf); m.set(chunk, this.buf.length);
        this.buf = m;
    }

    /** @param {Uint8Array} needle */
    _indexOf(needle) {
        outer: for (let i = 0; i <= this.buf.length - needle.length; i++) {
            for (let j = 0; j < needle.length; j++) if (this.buf[i + j] !== needle[j]) continue outer;
            return i;
        }
        return -1;
    }

    /** @param {Uint8Array} needle @param {number} [max] */
    async readUntil(needle, max = 1 << 20) {
        while (true) {
            const idx = this._indexOf(needle);
            if (idx >= 0) {
                const end = idx + needle.length;
                const out = this.buf.slice(0, end);
                this.buf = this.buf.slice(end);
                return out;
            }
            if (this.buf.length > max) throw new Error("response too large");
            if (this.eof) throw new Error("unexpected EOF in headers");
            await this._fill();
        }
    }

    /** @param {number} n */
    async readExact(n) {
        while (this.buf.length < n) {
            if (this.eof) throw new Error("unexpected EOF");
            await this._fill();
        }
        const out = this.buf.slice(0, n);
        this.buf = this.buf.slice(n);
        return out;
    }

    /** @param {number} [max] */
    async readToClose(max = 2 << 20) {
        while (!this.eof) {
            if (this.buf.length > max) throw new Error("body too large");
            await this._fill();
        }
        const out = this.buf;
        this.buf = new Uint8Array(0);
        return out;
    }
}

// ── command ───────────────────────────────────────────────────────────────────

/** @type {import("../types.js").Command} */
export const curl = {
    name: "curl",
    run: async (ctx, args) => {
        // ── parse flags ────────────────────────────────────────────────────
        let headOnly = false, verbose = false;
        let method = /** @type {string|null} */ (null);
        let data   = /** @type {string|null} */ (null);
        const extraHeaders = /** @type {string[]} */ ([]);
        let url    = /** @type {string|null} */ (null);

        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === "-I") headOnly = true;
            else if (a === "-v") verbose = true;
            else if (a === "-s") { /* silent — no-op */ }
            else if ((a === "-X" || a === "--request") && i + 1 < args.length) method = args[++i];
            else if ((a === "-d" || a === "--data")    && i + 1 < args.length) data   = args[++i];
            else if ((a === "-H" || a === "--header")  && i + 1 < args.length) extraHeaders.push(args[++i]);
            else if (!a.startsWith("-")) url = a;
        }

        if (!url) return t("app.terminal.commands.curl.usage");

        // normalize: bare IPv6 → wrap, no scheme → add http://
        if (!url.toLowerCase().startsWith("http://")) {
            if ((url.match(/:/g)?.length ?? 0) >= 2 && !url.startsWith("[")) {
                const sl = url.indexOf("/");
                url = sl < 0 ? `http://[${url}]` : `http://[${url.slice(0, sl)}]${url.slice(sl)}`;
            } else {
                url = "http://" + url;
            }
        }

        const parsed = parseUrl(url);
        if (!parsed.ok) return /** @type {any} */ (parsed).error;
        const { host, port, path } = parsed;

        if (!method) method = headOnly ? "HEAD" : data != null ? "POST" : "GET";
        if (headOnly) method = "HEAD";

        // ── DNS resolve ────────────────────────────────────────────────────
        /** @type {IPAddress|null} */
        let ip = null;
        try { ip = IPAddress.fromString(host); } catch {}
        if (!ip) try { ip = await ctx.os.dns.resolveIP(host); } catch {}
        if (!ip) return t("app.terminal.commands.curl.err.resolve", { host });

        // ── TCP connect ────────────────────────────────────────────────────
        let key = /** @type {string|null} */ (null);
        try {
            const conn = await ctx.os.net.connectTCPConn(ip, port);
            key = conn?.key ?? null;
        } catch (e) {
            return t("app.terminal.commands.curl.err.connect", { reason: e instanceof Error ? e.message : String(e) });
        }
        if (!key) return t("app.terminal.commands.curl.err.connect", { reason: "no key" });

        ctx.onInterrupt(() => { try { ctx.os.net.closeTCPConn(key); } catch {} });

        // ── build request ──────────────────────────────────────────────────
        const hostHdr = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
        const hostFull = port !== 80 ? `${hostHdr}:${port}` : hostHdr;
        const bodyBytes = data != null ? enc(data) : null;

        const reqLines = [
            `${method} ${path} HTTP/1.1`,
            `Host: ${hostFull}`,
            `User-Agent: curl/1.0`,
            `Accept: */*`,
            ...(bodyBytes
                ? [`Content-Type: application/x-www-form-urlencoded`, `Content-Length: ${bodyBytes.length}`]
                : []),
            ...extraHeaders,
            `Connection: close`,
            ``,
        ];
        const reqHead = enc(reqLines.join("\r\n") + "\r\n");
        const reqBytes = bodyBytes
            ? (() => { const b = new Uint8Array(reqHead.length + bodyBytes.length); b.set(reqHead); b.set(bodyBytes, reqHead.length); return b; })()
            : reqHead;

        if (verbose) {
            ctx.println(`* Connecting to ${ip}:${port}…`);
            for (const line of reqLines.slice(0, -1)) ctx.println(`> ${line}`);
            ctx.println(">");
        }

        try {
            ctx.os.net.sendTCPConn(key, reqBytes);
        } catch (e) {
            try { ctx.os.net.closeTCPConn(key); } catch {}
            return t("app.terminal.commands.curl.err.send", { reason: e instanceof Error ? e.message : String(e) });
        }

        // ── read response ──────────────────────────────────────────────────
        let headerText = "", statusLine = "";
        let responseBody = new Uint8Array(0);

        try {
            const r = new BufReader((k) => ctx.os.net.recvTCPConn(k), key);
            const CRLFCRLF = enc("\r\n\r\n");

            const headerBlock = await r.readUntil(CRLFCRLF);
            headerText = dec(headerBlock.slice(0, headerBlock.length - 4));
            statusLine = headerText.split("\r\n")[0] ?? "";

            if (verbose || headOnly) {
                ctx.println(`< ${statusLine}`);
                for (const line of headerText.split("\r\n").slice(1)) ctx.println(`< ${line}`);
                ctx.println("<");
            }

            if (!headOnly) {
                // parse headers for body framing
                /** @type {Record<string,string>} */ const hdrs = {};
                for (const line of headerText.split("\r\n").slice(1)) {
                    const k = line.indexOf(":");
                    if (k > 0) hdrs[line.slice(0, k).toLowerCase().trim()] = line.slice(k + 1).trim();
                }

                const te = (hdrs["transfer-encoding"] ?? "").toLowerCase();
                const cl = hdrs["content-length"];

                if (te.includes("chunked")) {
                    const chunks = /** @type {Uint8Array[]} */ ([]);
                    while (true) {
                        const sizeLine = dec(await r.readUntil(enc("\r\n"))).replace(/;.*/, "").trim();
                        const size = parseInt(sizeLine, 16);
                        if (!Number.isFinite(size) || size <= 0) break;
                        const chunk = await r.readExact(size + 2); // chunk + CRLF
                        chunks.push(chunk.slice(0, size));
                    }
                    let total = 0; for (const c of chunks) total += c.length;
                    responseBody = new Uint8Array(total);
                    let off = 0; for (const c of chunks) { responseBody.set(c, off); off += c.length; }
                } else if (cl) {
                    const n = parseInt(cl);
                    if (Number.isFinite(n) && n > 0) responseBody = await r.readExact(n);
                } else {
                    responseBody = await r.readToClose();
                }
            }
        } catch { /* partial response — show what we have */ }

        try { ctx.os.net.closeTCPConn(key); } catch {}

        if (headOnly) return; // headers already printed above

        if (responseBody.length > 0) {
            ctx.println(dec(responseBody));
        } else if (!verbose) {
            // show status at minimum so the user knows something happened
            ctx.println(statusLine);
        }
    },
};
