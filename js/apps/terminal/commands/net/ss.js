//@ts-check

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
    const ipf = ctx.os?.ipforwarder;
    if (!ipf) return "ss: no ipforwarder";

    const showTCP = !args.includes("-u");
    const showUDP = !args.includes("-t");

    ctx.println("Netid  State         Local Address:Port          Peer Address:Port           Info");

    if (showUDP) {
      for (const sock of ipf.udpSockets?.values?.() ?? []) {
        const local = `${fmtIP(sock.bindaddr ?? 0)}:${sock.port ?? 0}`;
        const peer = "*:*";
        const q = (sock.in?.length ?? 0);
        ctx.println(`udp    UNCONN        ${local.padEnd(27)} ${peer.padEnd(27)} rxq=${q}`);
      }
    }

    if (showTCP) {
      // 1) LISTEN sockets only (avoid printing connected client sockets here)
      for (const sock of ipf.tcpSockets?.values?.() ?? []) {
        const state = String(sock.state ?? "UNKNOWN");
        if (state !== "LISTEN") continue;

        const local = `${fmtIP(sock.bindaddr ?? 0)}:${sock.port ?? 0}`;
        const peer = "*:*";
        const st = state.padEnd(13);
        const rxq = (sock.in?.length ?? 0);
        const aq = (sock.acceptQueue?.length ?? 0);
        ctx.println(`tcp    ${st} ${local.padEnd(27)} ${peer.padEnd(27)} rxq=${rxq} aq=${aq}`);
      }

      // 2) Connections (ESTABLISHED, SYN-*, FIN-*, etc.)
      //    If you only want established, filter state === "ESTABLISHED".
      for (const sock of ipf.tcpConns?.values?.() ?? []) {
        const state = String(sock.state ?? "UNKNOWN");
        if (state === "LISTEN") continue; // just in case

        // NOTE: bindaddr is 0 for client sockets in your hack; localIP is not stored.
        // If you want accurate local IP, add conn.localIP in connectTCPConn/_handleTCP.
        const local = `${fmtIP(sock.bindaddr ?? 0)}:${sock.port ?? 0}`;
        const peer = `${fmtIP(sock.peerIP ?? 0)}:${sock.peerPort ?? 0}`;
        const st = state.padEnd(13);
        const rxq = (sock.in?.length ?? 0);
        ctx.println(`tcp    ${st} ${local.padEnd(27)} ${peer.padEnd(27)} rxq=${rxq}`);
      }
    }
  },
};
