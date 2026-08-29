//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";
import {
    normalizeUrl,
    parseHttpUrl,
    resolveHost,
    openTcpTransport,
    openTlsTransport,
    httpRequest,
    HttpError,
    utf8Encode,
    utf8Decode,
} from "../../../../net/HttpClient.js";

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
        ],
    },
    run: async (ctx, args) => {
        // ── parse flags ────────────────────────────────────────────────────
        let headOnly = false, verbose = false, insecure = false;
        let method = /** @type {string|null} */ (null);
        let data   = /** @type {string|null} */ (null);
        const extraHeaders = /** @type {string[]} */ ([]);
        let url    = /** @type {string|null} */ (null);

        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === "-I") headOnly = true;
            else if (a === "-v") verbose = true;
            else if (a === "-k" || a === "--insecure") insecure = true;
            else if (a === "-s") { /* silent — no-op */ }
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
            ip = await resolveHost(ctx.os, host);
        } catch {
            throw new CommandError(t("app.terminal.commands.curl.err.resolve", { host }));
        }

        // ── connect (TCP, or TLS for https) ───────────────────────────────
        if (verbose) ctx.println(`* Connecting to ${ip}:${port}…`);

        let conn;
        try {
            conn = scheme === "https"
                ? await openTlsTransport(ctx.os, ip, port, host, { insecure })
                : await openTcpTransport(ctx.os, ip, port);
        } catch (e) {
            if (e instanceof HttpError && e.kind === "tls")
                throw new CommandError(t("app.terminal.commands.curl.err.tls", { reason: e.message }));
            throw new CommandError(t("app.terminal.commands.curl.err.connect", { reason: e instanceof Error ? e.message : String(e) }));
        }
        ctx.onInterrupt(() => conn.close());

        if (verbose && scheme === "https") ctx.println("* TLS connection established");

        const defaultPort = scheme === "https" ? 443 : 80;
        const hostBare = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
        const hostHeader = port !== defaultPort ? `${hostBare}:${port}` : hostBare;

        // ── request / response ─────────────────────────────────────────────
        let res;
        try {
            res = await httpRequest({
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

        if (verbose || headOnly) {
            ctx.println(`< ${res.statusLine}`);
            for (const line of res.headerLines) ctx.println(`< ${line}`);
            ctx.println("<");
        }

        if (headOnly) return;

        if (res.body.length > 0) {
            ctx.println(utf8Decode(res.body));
        } else if (!verbose) {
            // show status at minimum so the user knows something happened
            ctx.println(res.statusLine);
        }
    },
};
