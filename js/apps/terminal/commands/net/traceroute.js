//@ts-check

import { ipNumberToString, ipStringToNumber } from "../lib/ip.js";
import { sleep, nowMs } from "../lib/time.js";
import { sleepAbortable } from "../lib/abort.js";


/** @type {import("../types.js").Command} */
export const traceroute = {
    name: "traceroute",
    run: async (ctx, args) => {
        const argv = [...args];

        let maxTtl = 30;
        let probes = 3;
        let timeoutMs = 1000;
        let host = "";

        const usage = () => "usage: traceroute [-m max_ttl] [-q probes] [-w timeout] <host>";
        const take = () => argv.shift();

        while (argv.length) {
            const a = argv[0];

            if (a === "-m") {
                argv.shift();
                const v = Number(take());
                if (!Number.isFinite(v) || v <= 0) return "traceroute: invalid max_ttl";
                maxTtl = Math.min(255, Math.floor(v));
                continue;
            }

            if (a === "-q") {
                argv.shift();
                const v = Number(take());
                if (!Number.isFinite(v) || v <= 0) return "traceroute: invalid probes";
                probes = Math.min(10, Math.floor(v));
                continue;
            }

            if (a === "-w") {
                argv.shift();
                const v = Number(take());
                if (!Number.isFinite(v) || v <= 0) return "traceroute: invalid timeout";
                timeoutMs = Math.max(1, Math.floor(v * 1000));
                continue;
            }

            host = take() ?? "";
            break;
        }

        if (!host) return usage();

        const ipf = ctx.os?.ipforwarder;
        if (!ipf?.icmpEcho) return "traceroute: no ipforwarder";

        // resolve
        let dstNum = ipStringToNumber(host);
        if (dstNum == null) {
            const dns = ctx.os?.dns;
            if (dns?.resolve) {
                const resolved = await dns.resolve(host);
                if (typeof resolved === "number") dstNum = resolved >>> 0;
                else if (typeof resolved === "string") dstNum = ipStringToNumber(resolved);
            }
        }
        if (dstNum == null) return `traceroute: cannot resolve ${host}`;

        const dstStr = ipNumberToString(dstNum);
        ctx.println(`traceroute to ${host} (${dstStr}), ${maxTtl} hops max, ${probes} probes`);

        const identifier = (Math.random() * 0xffff) | 0;

        for (let ttl = 1; ttl <= maxTtl; ttl++) {
            if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");
            /** @type {(number|null)[]} */
            const times = [];
            /** @type {number|null} */
            let hopIpNum = null;
            let reached = false;

            for (let p = 1; p <= probes; p++) {
                if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const t0 = nowMs();
                try {
                    const payload = new Uint8Array(56);

                    // NOTE: this requires your ipforwarder.icmpEcho to accept `ttl`
                    // and ideally return `from` (router ip) and/or `reached`.
                    const res = await ipf.icmpEcho(dstNum, {
                        timeoutMs,
                        identifier,
                        sequence: ((ttl << 8) | p) & 0xffff,
                        payload,
                        ttl,
                    });

                    const dt = Math.max(0, Math.round(res.timeMs ?? (nowMs() - t0)));
                    if (typeof res.from === "number") hopIpNum = res.from >>> 0;
                    times.push(dt);

                    if (res.reached === true) reached = true;
                    if (hopIpNum != null && hopIpNum === dstNum) reached = true;
                } catch (e) {
                    if (ctx.signal.aborted) throw e;

                    const any = /** @type {any} */ (e);
                    if (any && typeof any.from === "number") hopIpNum = any.from >>> 0;
                    times.push(null);
                }

                await sleepAbortable(10, ctx.signal);
            }

            const hopIpStr = hopIpNum != null ? ipNumberToString(hopIpNum) : "*";
            const parts = times.map((v) => (v == null ? "*" : `${v} ms`));
            ctx.println(`${ttl.toString().padStart(2, " ")}  ${hopIpStr}  ${parts.join("  ")}`);

            if (reached) break;
        }
    },
};
