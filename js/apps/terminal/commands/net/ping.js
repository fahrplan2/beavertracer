//@ts-check

import { ipNumberToString, ipStringToNumber } from "../lib/ip.js";
import { sleep, nowMs } from "../lib/time.js";
import { sleepAbortable } from "../lib/abort.js";
import { SimControl } from "../../../../SimControl.js";

/** @type {import("../types.js").Command} */
export const ping = {
    name: "ping",
    run: async (ctx, args) => {
        // parse args (same semantics you had)
        const argv = [...args];
        let count = 4;
        let intervalMs = 5*SimControl.tick;
        let timeoutMs = 50*SimControl.tick;
        let host = "";

        const usage = () => "usage: ping [-c count] [-i interval] [-W timeout] <host>";
        const take = () => argv.shift();

        while (argv.length) {
            const a = argv[0];

            if (a === "-c") {
                argv.shift();
                const v = Number(take());
                if (!Number.isFinite(v) || v <= 0) return "ping: invalid count";
                count = Math.min(4, Math.floor(v));
                continue;
            }

            if (a === "-i") {
                argv.shift();
                const v = Number(take());
                if (!Number.isFinite(v) || v <= 0) return "ping: invalid interval";
                intervalMs = Math.max(1, Math.floor(v * 1000));
                continue;
            }

            if (a === "-W") {
                argv.shift();
                const v = Number(take());
                if (!Number.isFinite(v) || v <= 0) return "ping: invalid timeout";
                timeoutMs = Math.max(1, Math.floor(v * 1000));
                continue;
            }

            host = take() ?? "";
            break;
        }

        if (!host) return usage();

        const ipf = ctx.os?.ipforwarder;
        if (!ipf?.icmpEcho) return "ping: no ipforwarder";

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
        if (dstNum == null) return `ping: cannot resolve ${host}`;

        const dstStr = ipNumberToString(dstNum);
        const identifier = (Math.random() * 0xffff) | 0;

        ctx.println(`PING ${host} (${dstStr}) 56(84) bytes of data.`);

        let transmitted = 0;
        let received = 0;
        let minMs = Infinity;
        let maxMs = 0;
        let sumMs = 0;

        const started = nowMs();

        for (let seq = 1; seq <= count; seq++) {
            if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

            transmitted++;

            try {
                const payload = new Uint8Array(56);

                const res = await ipf.icmpEcho(dstNum, {
                    timeoutMs,
                    identifier,
                    sequence: seq & 0xffff,
                    payload,
                    // optional: if your stack supports it
                    // signal: ctx.signal,
                });

                if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");


                received++;

                const t = Math.max(0, Math.round(res.timeMs ?? 0));
                minMs = Math.min(minMs, t);
                maxMs = Math.max(maxMs, t);
                sumMs += t;

                const ttl = res.ttl ?? 64;
                const bytes = res.bytes ?? (56 + 8);

                ctx.println(`${bytes} bytes from ${dstStr}: icmp_seq=${seq} ttl=${ttl} time=${t} ms`);
            } catch (e) {
                if (ctx.signal.aborted) throw e;
                ctx.println(`Request timeout for icmp_seq ${seq}`);
            }

            if (seq < count) await sleepAbortable(intervalMs, ctx.signal);
        }

        const elapsedMs = Math.max(1, Math.round(nowMs() - started));
        const lossPct = Math.round(((transmitted - received) / transmitted) * 100);
        const avgMs = received ? (sumMs / received) : 0;

        ctx.println("");
        ctx.println(`--- ${host} ping statistics ---`);
        ctx.println(`${transmitted} packets transmitted, ${received} received, ${lossPct}% packet loss, time ${elapsedMs}ms`);
        if (received) ctx.println(`rtt min/avg/max = ${Math.round(minMs)}/${Math.round(avgMs)}/${Math.round(maxMs)} ms`);
    },
};
