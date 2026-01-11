//@ts-check

import { t } from "../../../../i18n/index.js";
import { ipNumberToString } from "../lib/ip.js";

/** @param {number} n */
function u32(n) { return (n >>> 0); }

/** @param {number} ip */
function fmtIP(ip) {
  if (!ip) return "0.0.0.0";
  return ipNumberToString(u32(ip));
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

    if (showUDP) {
      for (const sock of ipf.udp.sockets.values?.() ?? []) {
        const local = `${fmtIP(sock.bindaddr ?? 0)}:${sock.port ?? 0}`;
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

    if (showTCP) {
      // 1) LISTEN sockets only
      for (const sock of ipf.sockets.values?.() ?? []) {
        const state = String(sock.state ?? "UNKNOWN");
        if (state !== "LISTEN") continue;

        const local = `${fmtIP(sock.bindaddr ?? 0)}:${sock.port ?? 0}`;
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

      // 2) Connections
      for (const sock of ipf.tcp.conns.values?.() ?? []) {
        const state = String(sock.state ?? "UNKNOWN");
        if (state === "LISTEN") continue;

        const local = `${fmtIP(sock.bindaddr ?? 0)}:${sock.port ?? 0}`;
        const peer = `${fmtIP(sock.peerIP ?? 0)}:${sock.peerPort ?? 0}`;
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
