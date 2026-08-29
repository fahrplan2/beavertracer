//@ts-check

import { IPAddress } from "./models/IPAddress.js";

/**
 * Transport-agnostic HTTP/1.1 client for the simulated network.
 *
 * Deliberately knows nothing about `ctx.os.net`, TLS, i18n, or how output is
 * rendered. The caller supplies a `transport` ({ send, recv }) and gets back a
 * fully parsed response. `curl`/`wget` pair it with the plaintext-TCP helpers
 * below (`resolveHost` + `openTcpTransport`); Sparktail (a later step) will
 * hand it a TLS-wrapped transport instead and skip those helpers. Every error
 * is an {@link HttpError} carrying a machine-readable `kind` - each caller maps
 * that to its own localised message.
 */

// ── errors ───────────────────────────────────────────────────────────────────

export class HttpError extends Error {
    /**
     * @param {"url"|"resolve"|"connect"|"tls"|"send"|"headers"|"body"|"too-large"|"cancelled"} kind
     * @param {string} message
     */
    constructor(kind, message) {
        super(message);
        this.name = "HttpError";
        this.kind = kind;
    }
}

// ── encoding helpers ─────────────────────────────────────────────────────────

/** @param {string} s */
export function utf8Encode(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
}

/** @param {Uint8Array} b */
export function utf8Decode(b) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
    let s = "";
    for (const byte of b) s += String.fromCharCode(byte);
    return s;
}

// ── URL handling ─────────────────────────────────────────────────────────────

/**
 * CLI-style input normalisation shared by `curl` and `wget`: add a scheme when
 * the user typed a bare host, and bracket a bare IPv6 literal. Never upgrades
 * to https - an explicit `https://` is passed through untouched (the caller
 * then rejects it, since this client speaks plaintext only).
 * @param {string} input
 */
export function normalizeUrl(input) {
    const s = String(input ?? "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    // bare IPv6 literal: 2+ colons and not already bracketed
    if (!s.startsWith("[") && (s.match(/:/g)?.length ?? 0) >= 2) {
        const slash = s.indexOf("/");
        return slash < 0 ? `http://[${s}]` : `http://[${s.slice(0, slash)}]${s.slice(slash)}`;
    }
    return "http://" + s;
}

/**
 * @param {string} url
 * @returns {{ ok: true, scheme: "http"|"https", host: string, port: number, path: string }
 *          | { ok: false, kind: "url", hint: "scheme"|"host" }}
 */
export function parseHttpUrl(url) {
    const s = String(url ?? "").trim();
    const lower = s.toLowerCase();
    const isHttps = lower.startsWith("https://");
    const isHttp = lower.startsWith("http://");
    if (!isHttp && !isHttps) return { ok: false, kind: "url", hint: "scheme" };

    const scheme = isHttps ? "https" : "http";
    const rest = s.slice(scheme.length + 3);
    const slash = rest.indexOf("/");
    const authority = slash >= 0 ? rest.slice(0, slash) : rest;
    const path = slash >= 0 ? rest.slice(slash) : "/";
    if (!authority) return { ok: false, kind: "url", hint: "host" };

    let host = authority;
    let port = isHttps ? 443 : 80;

    if (authority.startsWith("[")) {
        const close = authority.indexOf("]");
        if (close < 0) return { ok: false, kind: "url", hint: "host" };
        host = authority.slice(1, close);
        const after = authority.slice(close + 1);
        if (after.startsWith(":")) {
            const p = Number(after.slice(1));
            if (Number.isInteger(p) && p > 0 && p <= 65535) port = p;
        }
    } else {
        const colon = authority.lastIndexOf(":");
        if (colon > 0) {
            const p = Number(authority.slice(colon + 1));
            if (Number.isInteger(p) && p > 0 && p <= 65535) {
                host = authority.slice(0, colon);
                port = p;
            }
        }
    }

    host = host.trim();
    if (!host) return { ok: false, kind: "url", hint: "host" };
    return { ok: true, scheme, host, port, path };
}

// ── plaintext-TCP helpers (curl/wget) ────────────────────────────────────────

/**
 * Resolve `host` to an IP: an IP literal is parsed directly, otherwise it goes
 * through the OS resolver. Throws {@link HttpError} `"resolve"` on failure.
 * @param {any} os `ctx.os`
 * @param {string} host
 * @returns {Promise<IPAddress>}
 */
export async function resolveHost(os, host) {
    try { return IPAddress.fromString(host); } catch { /* not a literal */ }
    try {
        const ip = await os?.dns?.resolveIP(host);
        if (ip) return ip;
    } catch { /* fall through */ }
    throw new HttpError("resolve", `could not resolve '${host}'`);
}

/**
 * Open a plaintext TCP connection and wrap it in the `{ send, recv }` transport
 * shape {@link httpRequest} expects. Throws {@link HttpError} `"connect"`.
 * @param {any} os `ctx.os`
 * @param {IPAddress} ip
 * @param {number} port
 * @returns {Promise<{ key: string, close: () => void, transport: { send: (b: Uint8Array) => any, recv: () => Promise<Uint8Array|null> } }>}
 */
export async function openTcpTransport(os, ip, port) {
    let conn;
    try {
        conn = await os.net.connectTCPConn(ip, port);
    } catch (e) {
        throw new HttpError("connect", e instanceof Error ? e.message : String(e));
    }
    const key = conn?.key;
    if (typeof key !== "string" || !key) throw new HttpError("connect", "no connection key");

    return {
        key,
        close: () => { try { os.net.closeTCPConn(key); } catch { /* already gone */ } },
        transport: {
            send: (b) => os.net.sendTCPConn(key, b),
            recv: () => os.net.recvTCPConn(key),
        },
    };
}

/**
 * Like {@link openTcpTransport}, but the returned transport carries encrypted
 * TLS 1.2 application data. The TLS implementation (and `SimTimer`) is imported
 * lazily so plain-HTTP callers never pull it into their bundle - only a real
 * `https://` request pays for it. Throws {@link HttpError} `"tls"` on a failed
 * handshake (untrusted/expired cert, MITM, timeout), `"connect"` on the
 * underlying TCP failure.
 *
 * @param {any} os `ctx.os`
 * @param {IPAddress} ip
 * @param {number} port
 * @param {string} _host  reserved for future SNI / hostname verification
 * @param {{ insecure?: boolean }} [opts]  `insecure` skips the cert trust check (curl -k)
 * @returns {Promise<{ close: () => void, peerCert: any, transport: { send: (b: Uint8Array) => any, recv: () => Promise<Uint8Array|null> } }>}
 */
export async function openTlsTransport(os, ip, port, _host, opts = {}) {
    const { TlsSession, TlsHandshakeError } = await import("./TlsSession.js");
    /** @type {any} */ let simTimer;
    /** @type {any} */ let SimTimer;
    try {
        ({ simTimer, SimTimer } = await import("../lib/SimTimer.js"));
    } catch { /* not in a sim runtime - real timers below */ }

    const tcp = await openTcpTransport(os, ip, port);
    const tls = new TlsSession({
        send: tcp.transport.send,
        recv: tcp.transport.recv,
        isServer: false,
        trustStore: opts.insecure ? undefined : (os?.tls?.certStore ?? undefined),
        timeoutMs: SimTimer?.HTTP_CLIENT_TIMEOUT_MS ?? 10_000,
        sleepFn: simTimer ? (ms) => simTimer.sleep(ms) : undefined,
        now: () => os?.clock?.nowMs?.() ?? Date.now(),
    });

    try {
        await tls.handshake();
    } catch (e) {
        tcp.close();
        throw new HttpError(
            e instanceof TlsHandshakeError ? "tls" : "connect",
            e instanceof Error ? e.message : String(e),
        );
    }

    return {
        peerCert: tls.peerCert,
        close: () => { try { tls.close(); } catch { /* ignore */ } tcp.close(); },
        transport: {
            send: (b) => tls.send(/** @type {Uint8Array<ArrayBuffer>} */ (b)),
            recv: () => tls.recv(),
        },
    };
}

// ── buffered byte reader over recv() ─────────────────────────────────────────

class ByteReader {
    /**
     * @param {() => Promise<Uint8Array|null>} recv
     * @param {(() => boolean) | undefined} isCancelled
     */
    constructor(recv, isCancelled) {
        this._recv = recv;
        this._isCancelled = isCancelled;
        this.buf = new Uint8Array(0);
        this.eof = false;
    }

    async _fill() {
        if (this.eof) return;
        if (this._isCancelled?.()) throw new HttpError("cancelled", "request cancelled");
        const chunk = await this._recv();
        if (chunk == null) { this.eof = true; return; }
        const merged = new Uint8Array(this.buf.length + chunk.length);
        merged.set(this.buf);
        merged.set(chunk, this.buf.length);
        this.buf = merged;
    }

    /** @param {Uint8Array} needle */
    _indexOf(needle) {
        outer: for (let i = 0; i <= this.buf.length - needle.length; i++) {
            for (let j = 0; j < needle.length; j++) if (this.buf[i + j] !== needle[j]) continue outer;
            return i;
        }
        return -1;
    }

    /** @param {Uint8Array} needle @param {number} max */
    async readUntil(needle, max) {
        while (true) {
            const idx = this._indexOf(needle);
            if (idx >= 0) {
                const end = idx + needle.length;
                const out = this.buf.slice(0, end);
                this.buf = this.buf.slice(end);
                return out;
            }
            if (this.buf.length > max) throw new HttpError("too-large", "response headers too large");
            if (this.eof) throw new HttpError("headers", "connection closed before end of headers");
            await this._fill();
        }
    }

    /** @param {number} n */
    async readExact(n) {
        while (this.buf.length < n) {
            if (this.eof) throw new HttpError("body", "connection closed before end of body");
            await this._fill();
        }
        const out = this.buf.slice(0, n);
        this.buf = this.buf.slice(n);
        return out;
    }

    /** @param {number} max */
    async readToClose(max) {
        while (!this.eof) {
            if (this.buf.length > max) throw new HttpError("too-large", "response body too large");
            await this._fill();
        }
        const out = this.buf;
        this.buf = new Uint8Array(0);
        return out;
    }

    /** Whatever bytes are buffered right now (used to salvage a truncated body). */
    drain() {
        const out = this.buf;
        this.buf = new Uint8Array(0);
        return out;
    }
}

// ── request / response ──────────────────────────────────────────────────────

/**
 * @typedef {{
 *   statusLine: string,
 *   statusCode: number,
 *   reason: string,
 *   headers: Record<string, string>,
 *   headerText: string,
 *   headerLines: string[],
 *   body: Uint8Array,
 *   truncated: boolean,
 * }} HttpResponse
 */

/**
 * Statuses that carry no message body regardless of headers (RFC 9112 §6).
 * @param {string} method @param {number} code
 */
function bodyForbidden(method, code) {
    return method === "HEAD" || code === 204 || code === 304 || (code >= 100 && code < 200);
}

/**
 * Send one HTTP/1.1 request over `transport` and read the whole response.
 * `Connection: close` is always sent, so the transport is single-use.
 *
 * @param {{
 *   transport: { send: (b: Uint8Array) => any, recv: () => Promise<Uint8Array|null> },
 *   method: string,
 *   hostHeader: string,        // value for the `Host:` header, already :port / [v6]-bracketed
 *   path: string,
 *   headers?: string[],        // extra raw "Key: Value" lines, verbatim
 *   body?: Uint8Array | null,
 *   contentType?: string | null,  // applied only when body is set and no Content-Type given in `headers`
 *   userAgent?: string,
 *   accept?: string,
 *   maxHeaderBytes?: number,
 *   maxBodyBytes?: number,
 *   isCancelled?: () => boolean,
 *   onRequestLine?: (line: string) => void,  // per request line incl. a final "" for the blank
 * }} opts
 * @returns {Promise<HttpResponse>}
 */
export async function httpRequest(opts) {
    const {
        transport,
        method,
        hostHeader,
        path,
        headers = [],
        body = null,
        contentType = null,
        userAgent = "sim-http/1.0",
        accept = "*/*",
        maxHeaderBytes = 1 << 20,
        maxBodyBytes = 4 << 20,
        isCancelled,
        onRequestLine,
    } = opts;

    const hasCT = headers.some((h) => /^content-type\s*:/i.test(h));
    const reqLines = [
        `${method} ${path} HTTP/1.1`,
        `Host: ${hostHeader}`,
        `User-Agent: ${userAgent}`,
        `Accept: ${accept}`,
        ...(body
            ? [
                ...(hasCT || !contentType ? [] : [`Content-Type: ${contentType}`]),
                `Content-Length: ${body.length}`,
            ]
            : []),
        ...headers,
        `Connection: close`,
    ];

    if (onRequestLine) {
        for (const line of reqLines) onRequestLine(line);
        onRequestLine("");
    }

    const head = utf8Encode(reqLines.join("\r\n") + "\r\n\r\n");
    const reqBytes = body
        ? (() => { const b = new Uint8Array(head.length + body.length); b.set(head); b.set(body, head.length); return b; })()
        : head;

    try {
        await transport.send(reqBytes);
    } catch (e) {
        throw new HttpError("send", e instanceof Error ? e.message : String(e));
    }

    const r = new ByteReader(transport.recv, isCancelled);
    const CRLF = utf8Encode("\r\n");
    const CRLFCRLF = utf8Encode("\r\n\r\n");

    // headers
    const headerBlock = await r.readUntil(CRLFCRLF, maxHeaderBytes);
    const headerText = utf8Decode(headerBlock.slice(0, headerBlock.length - 4));
    const allLines = headerText.split("\r\n");
    const statusLine = allLines[0] ?? "";
    const headerLines = allLines.slice(1);

    const m = /^HTTP\/\d+\.\d+\s+(\d{3})\s*(.*)$/.exec(statusLine);
    const statusCode = m ? Number(m[1]) : 0;
    const reason = m ? (m[2] || "").trim() : "";

    /** @type {Record<string, string>} */
    const hdrs = {};
    for (const line of headerLines) {
        const k = line.indexOf(":");
        if (k <= 0) continue;
        const key = line.slice(0, k).toLowerCase().trim();
        const val = line.slice(k + 1).trim();
        hdrs[key] = hdrs[key] ? `${hdrs[key]}, ${val}` : val;
    }

    /** @type {HttpResponse} */
    const res = {
        statusLine, statusCode, reason,
        headers: hdrs, headerText, headerLines,
        body: new Uint8Array(0), truncated: false,
    };

    if (bodyForbidden(method, statusCode)) return res;

    // body - a mid-body failure salvages what arrived rather than throwing,
    // so a caller still gets a (flagged) partial response.
    try {
        const te = (hdrs["transfer-encoding"] ?? "").toLowerCase();
        const cl = hdrs["content-length"];

        if (te.includes("chunked")) {
            /** @type {Uint8Array[]} */
            const chunks = [];
            let total = 0;
            while (true) {
                const sizeLine = utf8Decode(await r.readUntil(CRLF, 64 * 1024)).replace(/;.*/, "").trim();
                const size = parseInt(sizeLine, 16);
                if (!Number.isFinite(size) || size <= 0) {
                    // trailer headers, if any, up to the terminating blank line
                    if (size === 0) {
                        while ((await r.readUntil(CRLF, 64 * 1024)).length > 2) { /* skip trailer */ }
                    }
                    break;
                }
                const chunk = await r.readExact(size + 2); // data + CRLF
                chunks.push(chunk.slice(0, size));
                total += size;
                if (total > maxBodyBytes) throw new HttpError("too-large", "response body too large");
            }
            res.body = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) { res.body.set(c, off); off += c.length; }
        } else if (cl != null && /^\d+$/.test(cl.trim())) {
            const n = Number(cl.trim());
            if (n > maxBodyBytes) throw new HttpError("too-large", "response body too large");
            res.body = n > 0 ? await r.readExact(n) : new Uint8Array(0);
        } else {
            res.body = await r.readToClose(maxBodyBytes);
        }
    } catch (e) {
        if (e instanceof HttpError && e.kind === "too-large") throw e;
        res.body = r.drain();
        res.truncated = true;
    }

    return res;
}
