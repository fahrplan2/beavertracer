//@ts-check

import { t } from "../../../../i18n/index.js";
import { ipNumberToString } from "../lib/ip.js";
import { IPAddress } from "../../../../net/models/IPAddress.js";

/** @param {number} n */
function u32(n) { return (n >>> 0); }

/**
 * Format an IP that may be:
 * - IPAddress
 * - number (legacy v4 uint32)
 * - null/undefined
 * @param {any} ip
 */
function fmtIP(ip) {
  if (!ip) return "0.0.0.0";

  // New world: IPAddress
  if (ip instanceof IPAddress) {
    return ip.toString();
  }

  // Legacy: uint32 v4
  if (typeof ip === "number" && Number.isFinite(ip)) {
    const n = u32(ip);
    return ipNumberToString(n);
  }

  // Sometimes people store as string already
  if (typeof ip === "string") {
    return ip;
  }

  return "0.0.0.0";
}

/** @type {import("../types.js").Command} */
export const ss = {
  name: "ss",
  run: (ctx, args) => {
    const ipf = ctx.os.net;
    if (!ipf) return t("app.terminal.commands.ss.err.noNetworkDriver");

    const showTCP = !args.includes("-u");
    const showUDP = !args.includes("-t");

    ctx.println(t("app.terminal.commands.ss.out.header"));

    // ---------------- UDP ----------------
    if (showUDP) {
      const udp = ipf.udp;
      const sockets = udp?.sockets?.values?.() ?? [];

      for (const sock of sockets) {
        const local = `${fmtIP(sock.bindaddr)}:${sock.port ?? 0}`;
        const peer = "*:*";
        const q = (sock.in?.length ?? 0);

        ctx.println(
          t("app.terminal.commands.ss.out.udpLine", {
            local: local.padEnd(27),
            peer: peer.padEnd(27),
            rxq: q,
          })
        );
      }
    }

    // ---------------- TCP ----------------
    if (showTCP) {
      const tcp = ipf.tcp;

      // 1) LISTEN sockets (servers)
      const servers = tcp?.sockets?.values?.() ?? [];
      for (const sock of servers) {
        const state = String(sock.state ?? "UNKNOWN");
        if (state !== "LISTEN") continue;

        const local = `${fmtIP(sock.bindaddr)}:${sock.port ?? 0}`;
        const peer = "*:*";
        const rxq = (sock.in?.length ?? 0);
        const aq = (sock.acceptQueue?.length ?? 0);

        ctx.println(
          t("app.terminal.commands.ss.out.tcpListenLine", {
            state: state.padEnd(13),
            local: local.padEnd(27),
            peer: peer.padEnd(27),
            rxq,
            aq,
          })
        );
      }

      // 2) Established / other connections
      const conns = tcp?.conns?.values?.() ?? [];
      for (const sock of conns) {
        const state = String(sock.state ?? "UNKNOWN");
        if (state === "LISTEN") continue;

        const local = `${fmtIP(sock.bindaddr)}:${sock.port ?? 0}`;
        const peer = `${fmtIP(sock.peerIP)}:${sock.peerPort ?? 0}`;
        const rxq = (sock.in?.length ?? 0);

        ctx.println(
          t("app.terminal.commands.ss.out.tcpConnLine", {
            state: state.padEnd(13),
            local: local.padEnd(27),
            peer: peer.padEnd(27),
            rxq,
          })
        );
      }
    }
  },
};
