//@ts-check

import { ipNumberToString } from "../lib/ip.js";

/** @param {number} n */
function u32(n) { return (n >>> 0); }

/** @param {number} ip */
function fmtIP(ip) {
  // treat 0 as wildcard
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

    // header
    ctx.println("Netid  State         Local Address:Port          Peer Address:Port           Info");

    if (showUDP) {
      // udpSockets: Map<Number, UDPSocket>
      for (const sock of ipf.udpSockets?.values?.() ?? []) {
        const local = `${fmtIP(sock.bindaddr ?? 0)}:${sock.port ?? 0}`;
        const peer = "*:*";
        const q = (sock.in?.length ?? 0);
        ctx.println(`udp    UNCONN        ${local.padEnd(27)} ${peer.padEnd(27)} rxq=${q}`);
      }
    }

    if (showTCP) {
      // tcpSockets: Map<number, TCPSocket>  (listening or bound)
      for (const sock of ipf.tcpSockets?.values?.() ?? []) {
        const local = `${fmtIP(sock.bindaddr ?? 0)}:${sock.port ?? 0}`;
        const peer = (sock.peerIP || sock.peerPort)
          ? `${fmtIP(sock.peerIP ?? 0)}:${sock.peerPort ?? 0}`
          : "*:*";
        const st = String(sock.state ?? "UNKNOWN").padEnd(13);
        const rxq = (sock.in?.length ?? 0);
        const aq = (sock.acceptQueue?.length ?? 0);
        ctx.println(`tcp    ${st} ${local.padEnd(27)} ${peer.padEnd(27)} rxq=${rxq} aq=${aq}`);
      }

      // tcpConns: Map<String, TCPSocket> (established connections)
      for (const sock of ipf.tcpConns?.values?.() ?? []) {
        const local = `${fmtIP(sock.bindaddr ?? 0)}:${sock.port ?? 0}`;
        const peer = `${fmtIP(sock.peerIP ?? 0)}:${sock.peerPort ?? 0}`;
        const st = String(sock.state ?? "UNKNOWN").padEnd(13);
        const rxq = (sock.in?.length ?? 0);
        ctx.println(`tcp    ${st} ${local.padEnd(27)} ${peer.padEnd(27)} rxq=${rxq}`);
      }
    }
  },
};
