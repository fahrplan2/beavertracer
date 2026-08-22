//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";
import { simTimer, SimTimer } from "../../../../lib/SimTimer.js";

import { NTPPacket } from "../../../../net/pdu/NTPPacket.js";
import { IPAddress } from "../../../../net/models/IPAddress.js";

/** @type {import("../types.js").Command} */
export const ntpdate = {
  name: "ntpdate",
  category: "net",
  tldr: {
    descKey: "app.terminal.commands.ntpdate.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.ntpdate.tldr.ex.basic", cmd: "ntpdate 10.0.0.1" },
    ],
  },
  run: async (ctx, args) => {
    const argv = [...args];
    const usage = () => t("app.terminal.commands.ntpdate.usage");

    let port = 123;
    let timeoutMs = SimTimer.NTP_TIMEOUT_MS;
    let host = "";

    while (argv.length) {
      const a = argv[0];

      if (a === "-h" || a === "--help") return usage();

      if (a === "-p") {
        argv.shift();
        const v = Number(argv.shift());
        if (!Number.isFinite(v) || v < 1 || v > 65535) throw new CommandError(t("app.terminal.commands.ntpdate.err.invalidPort"));
        port = v | 0;
        continue;
      }

      host = String(argv.shift() ?? "").trim();
      break;
    }

    if (!host) throw new CommandError(usage());

    const net = ctx.os?.net;
    if (!net?.openUDPSocket || !net?.sendUDPSocket || !net?.recvUDPSocket || !net?.closeUDPSocket) {
      throw new CommandError(t("app.terminal.commands.ntpdate.err.noUdp"));
    }

    const clock = ctx.os?.clock;
    if (!clock) throw new CommandError(t("app.terminal.commands.ntpdate.err.noClock"));

    /** @type {IPAddress|null} */
    let serverIp = null;
    try {
      serverIp = IPAddress.fromString(host);
    } catch {
      const dns = ctx.os?.dns;
      if (dns?.resolve) {
        const r = await dns.resolve(host);
        if (r instanceof IPAddress) serverIp = r;
        else if (typeof r === "string") { try { serverIp = IPAddress.fromString(r); } catch {} }
      }
    }
    if (!serverIp) throw new CommandError(t("app.terminal.commands.ntpdate.err.cannotResolve", { host }));

    if (!serverIp.isV4()) throw new CommandError(t("app.terminal.commands.ntpdate.err.ipv4Only"));
    const serverV4Num = /** @type {number} */ (serverIp.getNumber()) >>> 0;

    const anyV4 = new IPAddress(4, 0);
    const openEphemeral = () => {
      for (let p = 49152; p <= 65535; p++) {
        try { return net.openUDPSocket(anyV4, p); } catch { /* keep trying */ }
      }
      throw new Error("cannot open udp socket");
    };

    const sock = openEphemeral();

    /**
     * Race exactly one outstanding recv() at a time against a single timeout
     * deadline (both created once, not re-created every poll tick) — UdpEngine
     * resolves waiters FIFO, so recreating the recv() call on every tick would
     * abandon still-pending waiters that only get resolved once the reply
     * finally arrives, i.e. too late for whichever call is current by then.
     * @param {number} simMs
     */
    const recvWithTimeout = async (simMs) => {
      if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

      const timedOut = Symbol("timeout");
      const deadline = simTimer.sleep(simMs).then(() => timedOut);
      let pending = net.recvUDPSocket(sock);

      while (true) {
        const res = await Promise.race([pending, deadline]);

        if (res === timedOut) return null;
        if (res == null) return null;

        const srcNum = typeof res.src === "number" ? (res.src >>> 0)
          : (res.src instanceof IPAddress && res.src.isV4() ? (/** @type {number} */(res.src.getNumber()) >>> 0) : null);
        if (srcNum != null && srcNum !== serverV4Num) { pending = net.recvUDPSocket(sock); continue; }

        const data = res.payload instanceof Uint8Array ? res.payload : (res.data instanceof Uint8Array ? res.data : null);
        if (!data) { pending = net.recvUDPSocket(sock); continue; }

        try {
          return NTPPacket.fromBytes(data);
        } catch { pending = net.recvUDPSocket(sock); continue; }
      }
    };

    try {
      // T1 — this host's own (possibly wrong) virtual clock at send time.
      const t1 = clock.nowMs();

      const query = new NTPPacket({
        li: 0,
        vn: 4,
        mode: NTPPacket.MODE_CLIENT,
        transmitTimestampMs: t1,
      });

      net.sendUDPSocket(sock, serverIp, port, query.pack());

      const resp = await recvWithTimeout(timeoutMs);

      // T4 — this host's clock at receive time (still running on the old offset).
      const t4 = clock.nowMs();

      if (!resp) {
        ctx.println(t("app.terminal.commands.ntpdate.out.timeout", { server: serverIp.toString(), port }));
        return;
      }

      const t2 = resp.receiveTimestampMs;
      const t3 = resp.transmitTimestampMs;

      const offsetMs = ((t2 - t1) + (t3 - t4)) / 2;
      const delayMs = (t4 - t1) - (t3 - t2);

      const before = clock.now().toString();
      clock.adjust(offsetMs);
      const after = clock.now().toString();

      ctx.println(t("app.terminal.commands.ntpdate.out.server", { server: serverIp.toString(), port, stratum: resp.stratum, refid: resp.referenceIdText }));
      ctx.println(t("app.terminal.commands.ntpdate.out.timestamps", {
        t1: Math.round(t1), t2: Math.round(t2), t3: Math.round(t3), t4: Math.round(t4),
      }));
      ctx.println(t("app.terminal.commands.ntpdate.out.result", {
        offset: offsetMs.toFixed(1), delay: delayMs.toFixed(1),
      }));
      ctx.println(t("app.terminal.commands.ntpdate.out.stepped", { before, after }));
    } finally {
      try { net.closeUDPSocket(sock); } catch {}
    }
  },
};
