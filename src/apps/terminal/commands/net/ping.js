//@ts-check

import { t } from "../../../../i18n/index.js";
import { nowMs } from "../lib/time.js";
import { CommandError } from "../lib/errors.js";
import { sleepAbortable } from "../lib/abort.js";
import { simTimer, SimTimer } from "../../../../lib/SimTimer.js";
import { IPAddress } from "../../../../net/models/IPAddress.js";

/**
 * Try to parse host as IPAddress.
 * For now: accept IPv4/IPv6 literals via IPAddress.fromString().
 * @param {string} host
 * @returns {IPAddress|null}
 */
function parseHostAsIp(host) {
  try {
    const ip = IPAddress.fromString(String(host).trim());
    return ip;
  } catch {
    return null;
  }
}

/**
 * Normalize resolver results into IPAddress (best effort, IPv4 only if number).
 * @param {any} resolved
 * @returns {IPAddress|null}
 */
function resolvedToIp(resolved) {
  if (resolved instanceof IPAddress) return resolved;

  if (typeof resolved === "string") {
    return parseHostAsIp(resolved);
  }

  // Legacy: some resolvers return uint32 for IPv4
  if (typeof resolved === "number" && Number.isFinite(resolved)) {
    const n = (resolved >>> 0);
    // IPAddress(4, number) is how you used it in IPStack already
    return new IPAddress(4, n);
  }

  return null;
}

/** @type {import("../types.js").Command} */
export const ping = {
  name: "ping",
  category: "net",
  tldr: {
    descKey: "app.terminal.commands.ping.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.ping.tldr.ex.basic",      cmd: "ping 192.168.1.1" },
      { labelKey: "app.terminal.commands.ping.tldr.ex.count",      cmd: "ping -c 3 192.168.1.1" },
      { labelKey: "app.terminal.commands.ping.tldr.ex.mtu",        cmd: "ping -s 1400 -D 192.168.1.1" },
      { labelKey: "app.terminal.commands.ping.tldr.ex.continuous", cmd: "ping -t 192.168.1.1" },
    ],
  },
  run: async (ctx, args) => {
    // parse args (same semantics you had)
    const argv = [...args];
    let count = 4;
    let intervalMs = 1000; // real ms between packets (independent of sim speed)
    let timeoutMs = SimTimer.PING_TIMEOUT_MS;
    let payloadSize = 56; // bytes of ICMP data (default matches real ping)
    let dontFragment = false;
    let infinite = false;
    let host = "";

    const usage = () => t("app.terminal.commands.ping.usage");
    const take = () => argv.shift();

    while (argv.length) {
      const a = argv[0];

      if (a === "-c") {
        argv.shift();
        const v = Number(take());
        if (!Number.isFinite(v) || v <= 0) throw new CommandError(t("app.terminal.commands.ping.err.invalidCount"));
        count = Math.max(1, Math.floor(v));
        continue;
      }

      if (a === "-i") {
        argv.shift();
        const v = Number(take());
        if (!Number.isFinite(v) || v <= 0) throw new CommandError(t("app.terminal.commands.ping.err.invalidInterval"));
        intervalMs = Math.max(1, Math.floor(v * 1000));
        continue;
      }

      if (a === "-W") {
        argv.shift();
        const v = Number(take());
        if (!Number.isFinite(v) || v <= 0) throw new CommandError(t("app.terminal.commands.ping.err.invalidTimeout"));
        timeoutMs = Math.max(1, Math.floor(v * 1000));
        continue;
      }

      if (a === "-s") {
        argv.shift();
        const v = Number(take());
        if (!Number.isFinite(v) || v < 0 || v > 65507) throw new CommandError(t("app.terminal.commands.ping.err.invalidSize"));
        payloadSize = Math.floor(v);
        continue;
      }

      if (a === "-D") {
        argv.shift();
        dontFragment = true;
        continue;
      }

      if (a === "-t") {
        argv.shift();
        infinite = true;
        continue;
      }

      host = String(take() ?? "");
      break;
    }

    if (!host) throw new CommandError(usage());

    const ipf = ctx.os.net;
    if (!ipf?.icmpEcho) throw new CommandError(t("app.terminal.commands.ping.err.noNetworkDriver"));

    // resolve host -> IPAddress
    let dstIp = parseHostAsIp(host);

    if (!dstIp) {
      const dns = ctx.os?.dns;
      if (dns?.resolveIP) {
        try { dstIp = await dns.resolveIP(host); } catch { /* ignore */ }
      } else if (dns?.resolve) {
        try { dstIp = resolvedToIp(await dns.resolve(host)); } catch { /* ignore */ }
      }
    }

    if (!dstIp) throw new CommandError(t("app.terminal.commands.ping.err.cannotResolve", { host }));

    const dstStr = dstIp.toString();
    const identifier = (Math.random() * 0xffff) | 0;
    // dataBytes = payload; totalBytes = payload + 8 ICMP header + 20 IP header
    const totalBytes = payloadSize + 28;

    ctx.println(t("app.terminal.commands.ping.out.banner", { host, dst: dstStr, dataBytes: payloadSize, totalBytes }));

    let transmitted = 0;
    let received = 0;
    let minMs = Infinity;
    let maxMs = 0;
    let sumMs = 0;

    const started = nowMs();

    let interrupted = false;

    for (let seq = 1; infinite || seq <= count; seq++) {
      if (ctx.signal.aborted) { interrupted = true; break; }

      transmitted++;

      try {
        const payload = new Uint8Array(payloadSize);

        const echoFn = dstIp.isV4() ? ipf.icmpEcho.bind(ipf) : ipf.icmpv6Echo?.bind(ipf);
        if (!echoFn) throw new Error("IPv6 not supported");

        const res = await echoFn(dstIp, {
          timeoutMs,
          identifier,
          sequence: seq & 0xffff,
          payload,
          flags: dontFragment ? 0x02 : 0,
        });

        if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

        received++;

        const timeMs = Math.max(0, Math.round(res.timeMs ?? 0));
        minMs = Math.min(minMs, timeMs);
        maxMs = Math.max(maxMs, timeMs);
        sumMs += timeMs;

        const ttl = res.ttl ?? 64;
        const bytes = res.bytes ?? (56 + 8);

        ctx.println(
          t("app.terminal.commands.ping.out.reply", {
            bytes,
            dst: dstStr,
            seq,
            ttl,
            timeMs,
          })
        );
      } catch (e) {
        if (ctx.signal.aborted) { interrupted = true; break; }
        ctx.println(t("app.terminal.commands.ping.out.timeout", { seq }));
      }

      if (infinite || seq < count) {
        try {
          await sleepAbortable(intervalMs, ctx.signal);
        } catch {
          interrupted = true;
          break;
        }
      }
    }

    const elapsedMs = Math.max(1, Math.round(nowMs() - started));
    const lossPct = transmitted ? Math.round(((transmitted - received) / transmitted) * 100) : 0;
    const avgMs = received ? (sumMs / received) : 0;

    ctx.println("");
    ctx.println(t("app.terminal.commands.ping.out.statsHeader", { host }));
    ctx.println(
      t("app.terminal.commands.ping.out.statsLine", {
        transmitted,
        received,
        lossPct,
        elapsedMs,
      })
    );
    if (received) {
      ctx.println(
        t("app.terminal.commands.ping.out.rttLine", {
          minMs: Math.round(minMs),
          avgMs: Math.round(avgMs),
          maxMs: Math.round(maxMs),
        })
      );
    }

    // Statistics are printed above like real ping does on SIGINT; re-throw
    // afterwards so Ctrl+C still cancels the rest of a script/pipeline
    // instead of letting it continue as if ping had finished normally.
    if (interrupted) throw new DOMException("Aborted", "AbortError");
  },
};
