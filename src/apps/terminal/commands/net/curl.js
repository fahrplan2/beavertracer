//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";
import { abortable } from "../lib/abort.js";
import {
    normalizeUrl,
    parseHttpUrl,
    resolveHost,
    openTcpTransport,
    openTlsTransport,
    httpRequest,
    http2Request,
    http3Request,
    HttpError,
    utf8Encode,
    utf8Decode,
} from "../../../../net/HttpClient.js";
import { connectHttp3 } from "../../../../net/QuicTransport.js";

/** @type {import("../types.js").Command} */
export const curl = {
    name: "curl",
    category: "net",
    tldr: {
        descKey: "app.terminal.commands.curl.tldr.desc",
        examples: [
            { labelKey: "app.terminal.commands.curl.tldr.ex.get",     cmd: "curl http://192.168.1.1" },
            { labelKey: "app.terminal.commands.curl.tldr.ex.head",    cmd: "curl -I http://192.168.1.1" },
            { labelKey: "app.terminal.commands.curl.tldr.ex.verbose", cmd: "curl -v http://192.168.1.1" },
            { labelKey: "app.terminal.commands.curl.tldr.ex.http2",   cmd: "curl -v --http2 https://www.example.lan" },
        ],
    },
    run: async (ctx, args) => {
        // ── parse flags ────────────────────────────────────────────────────
        let headOnly = false, verbose = false, insecure = false;
        let method = /** @type {string|null} */ (null);
        let data   = /** @type {string|null} */ (null);
        const extraHeaders = /** @type {string[]} */ ([]);
        let url    = /** @type {string|null} */ (null);
        /** "auto" = like curl with nghttp2: offer h2 over TLS, HTTP/1.1 in clear text */
        let proto  = /** @type {"auto"|"http1.1"|"http2"|"prior"|"http3"|"http3only"} */ ("auto");
        /** TLS versions to offer: --tlsv1.3 sets the minimum, --tls-max the maximum */
        let tlsMin = "1.2", tlsMax = "1.3";

        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === "-I") headOnly = true;
            else if (a === "-v") verbose = true;
            else if (a === "-k" || a === "--insecure") insecure = true;
            else if (a === "-s") { /* silent — no-op */ }
            else if (a === "--http1.1") proto = "http1.1";
            else if (a === "--http2") proto = "http2";
            else if (a === "--http2-prior-knowledge") proto = "prior";
            else if (a === "--http3") proto = "http3";
            else if (a === "--http3-only") proto = "http3only";
            else if (a === "--tlsv1.2") tlsMin = "1.2";
            else if (a === "--tlsv1.3") tlsMin = "1.3";
            else if (a === "--tls-max" && i + 1 < args.length) tlsMax = args[++i];
            else if ((a === "-X" || a === "--request") && i + 1 < args.length) method = args[++i];
            else if ((a === "-d" || a === "--data")    && i + 1 < args.length) data   = args[++i];
            else if ((a === "-H" || a === "--header")  && i + 1 < args.length) extraHeaders.push(args[++i]);
            else if (!a.startsWith("-")) url = a;
        }

        if (!url) throw new CommandError(t("app.terminal.commands.curl.usage"));

        const parsed = parseHttpUrl(normalizeUrl(url));
        if (!parsed.ok) throw new CommandError(t("app.terminal.commands.curl.err.onlyHttp"));
        const { scheme, host, port, path } = parsed;

        if (!method) method = headOnly ? "HEAD" : data != null ? "POST" : "GET";
        if (headOnly) method = "HEAD";

        // ── DNS resolve ────────────────────────────────────────────────────
        let ip;
        try {
            ip = await abortable(resolveHost(ctx.os, host), ctx.signal);
        } catch {
            ctx.signal.throwIfAborted();
            throw new CommandError(t("app.terminal.commands.curl.err.resolve", { host }));
        }

        const defaultPort = scheme === "https" ? 443 : 80;
        const hostBare = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
        const hostHeader = port !== defaultPort ? `${hostBare}:${port}` : hostBare;
        const reqBody = data != null ? utf8Encode(data) : null;
        const contentType = data != null ? "application/x-www-form-urlencoded" : null;
        const onRequestLine = verbose ? (/** @type {string} */ line) => ctx.println(line ? `> ${line}` : ">") : undefined;

        /** @param {import("../../../../net/HttpClient.js").HttpResponse} res */
        const output = (res) => {
            if (verbose || headOnly) {
                ctx.println(`< ${res.statusLine}`);
                for (const line of res.headerLines) ctx.println(`< ${line}`);
                ctx.println("<");
            }
            if (headOnly) return;
            if (res.body.length > 0) ctx.println(utf8Decode(res.body));
            else if (!verbose) ctx.println(res.statusLine); // show status at minimum
        };

        // ── HTTP/3 over QUIC (UDP); --http3 falls back to TCP like real curl ──
        if (proto === "http3" || proto === "http3only") {
            if (scheme !== "https") throw new CommandError(t("app.terminal.commands.curl.err.h3NeedsHttps"));
            if (verbose) ctx.println(`* QUIC: connecting to ${ip}:${port} (UDP)…`);
            /** @type {Awaited<ReturnType<typeof connectHttp3>>|null} */
            let q = null;
            try {
                q = await abortable(connectHttp3(ctx.os, { ip, port, host, insecure }), ctx.signal, (late) => late.close());
            } catch (e) {
                ctx.signal.throwIfAborted();
                const reason = e instanceof Error ? e.message : String(e);
                if (proto === "http3only") throw new CommandError(t("app.terminal.commands.curl.err.quic", { reason }));
                if (verbose) ctx.println(`* QUIC failed (${reason}), falling back to TCP`);
            }
            if (q) {
                const quicConn = q;
                ctx.onInterrupt(() => quicConn.close());
                if (verbose) {
                    ctx.println(`* QUIC connection established: ${quicConn.quic.tls.version.replace("TLS ", "TLSv")} / ${quicConn.quic.tls.cipherSuite}`);
                    ctx.println("* using HTTP/3");
                }
                let res;
                try {
                    res = await http3Request({
                        h3: quicConn.h3, method, scheme, authority: hostHeader, path,
                        headers: extraHeaders, body: reqBody, contentType, userAgent: "curl/1.0", onRequestLine,
                    });
                } catch (e) {
                    throw new CommandError(t("app.terminal.err.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }));
                } finally {
                    quicConn.close();
                }
                output(res);
                return;
            }
        }

        // ── connect (TCP, or TLS for https) ───────────────────────────────
        if (verbose) ctx.println(`* Connecting to ${ip}:${port}…`);

        // ALPN offer (RFC 7301): --http1.1 offers only http/1.1,
        // --http2-prior-knowledge only h2, otherwise both with h2 preferred
        const alpn = proto === "http1.1" ? ["http/1.1"] : proto === "prior" ? ["h2"] : ["h2", "http/1.1"];
        if (verbose && scheme === "https") ctx.println(`* ALPN: curl offers ${alpn.join(",")}`);
        const versions = /** @type {Array<"1.2"|"1.3">} */ (["1.3", "1.2"].filter(v => v >= tlsMin && v <= tlsMax));
        if (versions.length === 0) throw new CommandError(t("app.terminal.commands.curl.err.tlsVersion"));

        let conn;
        try {
            conn = await abortable(
                /** @type {Promise<{ close: () => void, transport: any, alpn?: string, version?: string, cipherSuite?: string }>} */ (scheme === "https"
                    ? openTlsTransport(ctx.os, ip, port, host, { insecure, alpn, versions })
                    : openTcpTransport(ctx.os, ip, port)),
                ctx.signal,
                (late) => late.close(),
            );
        } catch (e) {
            ctx.signal.throwIfAborted();
            if (e instanceof HttpError && e.kind === "tls")
                throw new CommandError(t("app.terminal.commands.curl.err.tls", { reason: e.message }));
            throw new CommandError(t("app.terminal.commands.curl.err.connect", { reason: e instanceof Error ? e.message : String(e) }));
        }
        ctx.onInterrupt(() => conn.close());

        if (verbose && scheme === "https") {
            ctx.println(`* SSL connection using ${String(conn.version ?? "").replace("TLS ", "TLSv")} / ${conn.cipherSuite ?? ""}`);
        }

        // HTTP/2 when the server accepted h2, or h2c when the user knows the
        // server speaks it (curl --http2 would try an h2c Upgrade on http://,
        // which this simulation does not implement: it stays on HTTP/1.1)
        const useH2 = scheme === "https" ? conn.alpn === "h2" : proto === "prior";
        if (verbose) {
            if (scheme === "https") {
                ctx.println(conn.alpn
                    ? `* ALPN: server accepted ${conn.alpn}`
                    : "* ALPN: server did not agree on a protocol. Uses default.");
            }
            if (useH2) ctx.println("* using HTTP/2");
        }

        // ── request / response ─────────────────────────────────────────────
        let res;
        try {
            res = useH2 ? await http2Request({
                transport: conn.transport,
                method,
                scheme,
                authority: hostHeader,
                path,
                headers: extraHeaders,
                body: data != null ? utf8Encode(data) : null,
                contentType: data != null ? "application/x-www-form-urlencoded" : null,
                userAgent: "curl/1.0",
                onRequestLine: verbose ? (line) => ctx.println(line ? `> ${line}` : ">") : undefined,
            }) : await httpRequest({
                transport: conn.transport,
                method,
                hostHeader,
                path,
                headers: extraHeaders,
                body: data != null ? utf8Encode(data) : null,
                contentType: data != null ? "application/x-www-form-urlencoded" : null,
                userAgent: "curl/1.0",
                onRequestLine: verbose ? (line) => ctx.println(line ? `> ${line}` : ">") : undefined,
            });
        } catch (e) {
            conn.close();
            if (e instanceof HttpError && e.kind === "send")
                throw new CommandError(t("app.terminal.commands.curl.err.send", { reason: e.message }));
            throw new CommandError(t("app.terminal.err.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }));
        }
        conn.close();
        output(res);
    },
};
