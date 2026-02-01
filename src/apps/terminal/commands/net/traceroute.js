//@ts-check

import { t } from "../../../../i18n/index.js";
import { ipNumberToString, ipStringToNumber } from "../lib/ip.js";
import { nowMs } from "../lib/time.js";
import { sleepAbortable } from "../lib/abort.js";
import { IPAddress } from "../../../../net/models/IPAddress.js";

/**
 * Format an IP that may be:
 * - IPAddress
 * - number (legacy v4 uint32)
 * - string
 * - null/undefined
 * @param {any} ip
 */
function fmtIP(ip) {
  if (!ip) return "*";
  if (ip instanceof IPAddress) return ip.toString();
  if (typeof ip === "string") return ip;
  if (typeof ip === "number" && Number.isFinite(ip)) return ipNumberToString((ip >>> 0));
  return "*";
}

/**
 * Resolve host -> IPAddress (IPv4 for now)
 * @param {any} ctx
 * @param {string} host
 * @returns {Promise<IPAddress|null>}
 */
async function resolveHostToIp(ctx, host) {
  // direct v4 literal?
  const n = ipStringToNumber(host);
  if (n != null) return IPAddress.fromString(ipNumberToString(n >>> 0));

  // DNS
  const dns = ctx.os?.dns;
  if (dns?.resolve) {
    const resolved = await dns.resolve(host);
    if (resolved instanceof IPAddress) return resolved;
    if (typeof resolved === "number") return IPAddress.fromString(ipNumberToString(resolved >>> 0));
    if (typeof resolved === "string") {
      const n2 = ipStringToNumber(resolved);
      if (n2 != null) return IPAddress.fromString(ipNumberToString(n2 >>> 0));
      // if it's already an ip-like string, just try:
      try { return IPAddress.fromString(resolved); } catch { /* ignore */ }
    }
  }

  return null;
}

/** @type {import("../types.js").Command} */
export const traceroute = {
  name: "traceroute",
  run: async (ctx, args) => {
    const argv = [...args];

    let maxTtl = 30;
    let probes = 3;
    let timeoutMs = 1000;
    let host = "";

    const usage = () => t("app.terminal.commands.traceroute.usage");
    const take = () => argv.shift();

    while (argv.length) {
      const a = argv[0];

      if (a === "-m") {
        argv.shift();
        const v = Number(take());
        if (!Number.isFinite(v) || v <= 0) return t("app.terminal.commands.traceroute.err.invalidMaxTtl");
        maxTtl = Math.min(255, Math.floor(v));
        continue;
      }

      if (a === "-q") {
        argv.shift();
        const v = Number(take());
        if (!Number.isFinite(v) || v <= 0) return t("app.terminal.commands.traceroute.err.invalidProbes");
        probes = Math.min(10, Math.floor(v));
        continue;
      }

      if (a === "-w") {
        argv.shift();
        const v = Number(take());
        if (!Number.isFinite(v) || v <= 0) return t("app.terminal.commands.traceroute.err.invalidTimeout");
        timeoutMs = Math.max(1, Math.floor(v * 1000));
        continue;
      }

      host = take() ?? "";
      break;
    }

    if (!host) return usage();

    const ipf = ctx.os.net;
    if (!ipf?.icmpEcho) return t("app.terminal.commands.traceroute.err.noNetworkDriver");

    const dstIp = await resolveHostToIp(ctx, host);
    if (!dstIp) return t("app.terminal.commands.traceroute.err.cannotResolve", { host });

    const dstStr = dstIp.toString();

    ctx.println(
      t("app.terminal.commands.traceroute.out.banner", {
        host,
        dst: dstStr,
        maxTtl,
        probes,
      })
    );

    const identifier = (Math.random() * 0xffff) | 0;

    for (let ttl = 1; ttl <= maxTtl; ttl++) {
      if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

      /** @type {(number|null)[]} */
      const times = [];

      /** @type {any} */
      let hop = null;

      let reached = false;

      for (let p = 1; p <= probes; p++) {
        if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

        const t0 = nowMs();
        try {
          const payload = new Uint8Array(56);

          // Works now; later your stack may additionally return {from, reached}
          const res = await ipf.icmpEcho(dstIp, {
            timeoutMs,
            identifier,
            sequence: ((ttl << 8) | p) & 0xffff,
            payload,
            ttl, // may be ignored until you implement it in IPStack.send/route
          });

          const dt = Math.max(0, Math.round(res.timeMs ?? (nowMs() - t0)));
          times.push(dt);

          // Optional future fields:
          if (res && typeof res === "object") {
            if ("from" in res) hop = /** @type {any} */(res).from;
            if (/** @type {any} */(res).reached === true) reached = true;
          }

          // Fallback: if hop equals destination (various representations)
          const hopStr = fmtIP(hop);
          if (hopStr !== "*" && hopStr === dstStr) reached = true;

        } catch (e) {
          if (ctx.signal.aborted) throw e;

          // Optional: errors might carry {from}
          const any = /** @type {any} */ (e);
          if (any && typeof any === "object" && "from" in any) hop = any.from;

          times.push(null);
        }

        await sleepAbortable(10, ctx.signal);
      }

      const hopStr = hop ? fmtIP(hop) : "*";
      const parts = times.map((v) => (v == null ? "*" : `${v} ms`));
      ctx.println(`${ttl.toString().padStart(2, " ")}  ${hopStr}  ${parts.join("  ")}`);

      if (reached) break;
    }
  },
};
