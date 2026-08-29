//@ts-check

import { t } from "../../../../i18n/index.js";
import { nowStamp } from "../../../../lib/helpers.js";
import { CommandError } from "../lib/errors.js";
import {
    normalizeUrl,
    parseHttpUrl,
    resolveHost,
    openTcpTransport,
    openTlsTransport,
    httpRequest,
    HttpError,
    utf8Decode,
} from "../../../../net/HttpClient.js";

const MAX_REDIRECTS = 20;

/**
 * Filename wget saves to when `-O` isn't given: the last path segment, minus
 * query/fragment; `/` (or an empty segment) becomes `index.html`.
 * @param {string} path
 */
function deriveFilename(path) {
    const clean = path.split("#")[0].split("?")[0];
    const slash = clean.lastIndexOf("/");
    let name = slash >= 0 ? clean.slice(slash + 1) : clean;
    try { name = decodeURIComponent(name); } catch { /* keep raw */ }
    return name || "index.html";
}

/**
 * wget never overwrites on the default path - it appends `.1`, `.2`, …
 * @param {any} fs @param {string} cwd @param {string} name
 */
function uniqueName(fs, cwd, name) {
    if (!fs.exists(fs.resolve(cwd, name))) return name;
    for (let i = 1; ; i++) {
        const cand = `${name}.${i}`;
        if (!fs.exists(fs.resolve(cwd, cand))) return cand;
    }
}

/** @type {import("../types.js").Command} */
export const wget = {
    name: "wget",
    category: "net",
    tldr: {
        descKey: "app.terminal.commands.wget.tldr.desc",
        examples: [
            { labelKey: "app.terminal.commands.wget.tldr.ex.basic",  cmd: "wget http://192.168.1.1/index.html" },
            { labelKey: "app.terminal.commands.wget.tldr.ex.output", cmd: "wget -O page.html http://192.168.1.1" },
            { labelKey: "app.terminal.commands.wget.tldr.ex.stdout", cmd: "wget -qO- http://192.168.1.1" },
        ],
    },
    run: async (ctx, args) => {
        // ── parse flags ────────────────────────────────────────────────────
        let quiet = false;
        let insecure = false;
        let outFile = /** @type {string|null} */ (null);
        let url = /** @type {string|null} */ (null);

        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === "-q" || a === "--quiet") quiet = true;
            else if (a === "--no-check-certificate") insecure = true;
            else if (a === "-O" && i + 1 < args.length) outFile = args[++i];
            else if (a === "-O-" || a === "-qO-") { outFile = "-"; if (a === "-qO-") quiet = true; }
            else if (a.startsWith("--output-document=")) outFile = a.slice("--output-document=".length);
            else if (a.startsWith("-O") && a.length > 2) outFile = a.slice(2);
            else if (!a.startsWith("-")) url = a;
        }

        if (!url) throw new CommandError(t("app.terminal.commands.wget.usage"));

        const fs = ctx.os.fs;
        if (!fs) throw new CommandError(t("app.terminal.commands.wget.err.noFilesystem"));

        const log = (/** @type {string} */ s) => {
            if (!quiet) (ctx.stderr?.println ?? ctx.println)(s);
        };

        // ── fetch, following redirects ─────────────────────────────────────
        let current = normalizeUrl(url);
        let finalUrl = current;
        /** @type {import("../../../../net/HttpClient.js").HttpResponse|null} */
        let res = null;

        for (let redirect = 0; ; redirect++) {
            if (redirect > MAX_REDIRECTS)
                throw new CommandError(t("app.terminal.commands.wget.err.tooManyRedirects", { max: MAX_REDIRECTS }));

            const parsed = parseHttpUrl(current);
            if (!parsed.ok) throw new CommandError(t("app.terminal.commands.wget.err.onlyHttp"));
            const { scheme, host, port, path } = parsed;

            log(`--${nowStamp(ctx.os.clock?.nowMs?.() ?? Date.now())}--  ${current}`);
            log(t("app.terminal.commands.wget.log.resolving", { host }));

            let ip;
            try {
                ip = await resolveHost(ctx.os, host);
            } catch {
                throw new CommandError(t("app.terminal.commands.wget.err.resolve", { host }));
            }
            log(t("app.terminal.commands.wget.log.connecting", { host, ip: ip.toString(), port }));

            let conn;
            try {
                conn = scheme === "https"
                    ? await openTlsTransport(ctx.os, ip, port, host, { insecure })
                    : await openTcpTransport(ctx.os, ip, port);
            } catch (e) {
                if (e instanceof HttpError && e.kind === "tls")
                    throw new CommandError(t("app.terminal.commands.wget.err.tls", { reason: e.message }));
                throw new CommandError(t("app.terminal.commands.wget.err.connect", { reason: e instanceof Error ? e.message : String(e) }));
            }
            ctx.onInterrupt(() => conn.close());

            const defaultPort = scheme === "https" ? 443 : 80;
            const hostBare = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
            const hostHeader = port !== defaultPort ? `${hostBare}:${port}` : hostBare;

            try {
                res = await httpRequest({
                    transport: conn.transport,
                    method: "GET",
                    hostHeader,
                    path,
                    userAgent: "Wget/1.0",
                });
            } catch (e) {
                conn.close();
                throw new CommandError(t("app.terminal.err.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }));
            }
            conn.close();

            log(t("app.terminal.commands.wget.log.responded", { code: res.statusCode, reason: res.reason }));

            const loc = res.headers["location"];
            if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
                let next;
                try { next = new URL(loc, current).href; } catch { next = loc; }
                log(t("app.terminal.commands.wget.log.location", { loc: next }));
                current = next;
                finalUrl = next;
                continue;
            }
            finalUrl = current;
            break;
        }

        if (!res) throw new CommandError(t("app.terminal.commands.wget.usage")); // unreachable

        if (res.statusCode >= 400) {
            log(t("app.terminal.commands.wget.log.httpError", { code: res.statusCode, reason: res.reason }));
            throw new CommandError(t("app.terminal.commands.wget.err.httpError", { code: res.statusCode, reason: res.reason }));
        }

        const bodyText = utf8Decode(res.body);
        const len = res.body.length;
        const ctype = res.headers["content-type"] || null;

        // ── stdout mode: -O - ──────────────────────────────────────────────
        if (outFile === "-") {
            if (ctx.stdout && bodyText.endsWith("\n")) ctx.stdout.print(bodyText);
            else ctx.println(bodyText);
            return;
        }

        // ── save to file ──────────────────────────────────────────────────
        let name = outFile;
        if (!name) {
            const fp = parseHttpUrl(finalUrl);
            name = uniqueName(fs, ctx.cwd, deriveFilename(fp.ok ? fp.path : "/"));
        }

        try {
            fs.writeFile(fs.resolve(ctx.cwd, name), bodyText);
        } catch (e) {
            throw new CommandError(t("app.terminal.err.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }));
        }

        log(ctype
            ? t("app.terminal.commands.wget.log.length", { len, type: ctype })
            : t("app.terminal.commands.wget.log.lengthUnknown"));
        log(t("app.terminal.commands.wget.log.savingTo", { file: name }));
        log("");
        log(t("app.terminal.commands.wget.log.saved", { file: name, len }));
    },
};
