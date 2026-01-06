//@ts-check

import { ipNumberToString, ipStringToNumber } from "../lib/ip.js";

/** @param {number} n */
function u32(n) { return (n >>> 0); }

/** @param {number} prefix */
function prefixToNetmask32(prefix) {
  const p = Math.max(0, Math.min(32, prefix | 0));
  if (p === 0) return 0 >>> 0;
  return u32((0xffffffff << (32 - p)));
}

/**
 * Parse "A.B.C.D/len"
 * @param {string} s
 */
function parseCidr(s) {
  const m = /^(.+?)\/(\d+)$/.exec(s);
  if (!m) return null;
  const ip = ipStringToNumber(m[1]);
  const prefix = Number(m[2]);
  if (ip == null || !Number.isFinite(prefix)) return null;
  return { ip: u32(ip), prefix: Math.max(0, Math.min(32, prefix | 0)) };
}

/**
 * Try to get an interface name.
 * @param {any} ipf
 * @param {number} idx
 */
function ifaceName(ipf, idx) {
  if (idx === -1) return "lo";
  const itf = ipf?.interfaces?.[idx];
  return itf?.name ?? itf?.ifname ?? itf?.label ?? `eth${idx}`;
}

/** @type {import("../types.js").Command} */
export const route = {
  name: "route",
  run: (ctx, args) => {
    const ipf = ctx.os.net;
    if (!ipf) return "route: no network driver";

    const rt = ipf.routingTable ?? [];
    const sub = args[0] ?? "show";

    if (sub === "show" || sub === "list" || sub === "-n") {
      if (rt.length === 0) return "route: routing table empty";

      ctx.println("Destination        Netmask            Gateway            Iface  Auto");
      for (const r of rt) {
        const dst = ipNumberToString(u32(r.dst ?? 0));
        const mask = ipNumberToString(u32(r.netmask ?? 0));
        const gw = ipNumberToString(u32(r.nexthop ?? 0));

        const ifn = ifaceName(ipf, Number(r.interf ?? 0));
        const auto = (r.auto ? "yes" : "no");

        ctx.println(
          `${dst.padEnd(18)} ${mask.padEnd(18)} ${gw.padEnd(18)} ${ifn.padEnd(6)} ${auto}`
        );
      }
      return;
    }

    // route add <dst>/<prefix> via <gw> dev <if>
    // if can be "eth0" or "0" or "lo"
    if (sub === "add") {
      const cidr = args[1];
      const via = args[2];
      const gwStr = args[3];
      const dev = args[4];
      const ifSel = args[5];

      if (!(cidr && via === "via" && gwStr && dev === "dev" && ifSel)) {
        return "usage: route add <dst>/<prefix> via <gateway> dev <ifIndex|ifName|lo>";
      }

      const parsed = parseCidr(cidr);
      if (!parsed) return "route: invalid destination cidr";

      const gw = ipStringToNumber(gwStr);
      if (gw == null) return "route: invalid gateway ip";

      let ifIndex = -999;

      if (ifSel === "lo") {
        ifIndex = -1;
      } else if (/^\d+$/.test(ifSel)) {
        ifIndex = Number(ifSel);
      } else {
        // name lookup
        const ifaces = ipf.interfaces ?? [];
        for (let i = 0; i < ifaces.length; i++) {
          const name = ifaces[i].name ?? `eth${i}`;
          if (name === ifSel) { ifIndex = i; break; }
        }
      }

      if (ifIndex !== -1) {
        if (!Number.isFinite(ifIndex) || ifIndex < 0 || ifIndex >= (ipf.interfaces?.length ?? 0)) {
          return `route: invalid interface: ${ifSel}`;
        }
      }

      const netmask = prefixToNetmask32(parsed.prefix);

      //use the kernel API
      ipf.addRoute(parsed.ip, netmask, ifIndex, u32(gw));

      ctx.println("ok: route added");
      return;
    }

    // route del <dst>/<prefix>
    // (simple removal from table; your IPForwarder doesn't have delRoute)
    if (sub === "del" || sub === "delete") {
      const cidr = args[1];
      if (!cidr) return "usage: route del <dst>/<prefix>";

      const parsed = parseCidr(cidr);
      if (!parsed) return "route: invalid destination cidr";

      const mask = prefixToNetmask32(parsed.prefix);

      const before = ipf.routingTable.length;
      ipf.routingTable = ipf.routingTable.filter(
        (r) => ((r.dst >>> 0) !== parsed.ip) || ((r.netmask >>> 0) !== mask) || (r.auto === true)
      );
      const removed = before - ipf.routingTable.length;

      ctx.println(`ok: removed ${removed}`);
      return;
    }

    return "usage: route [show] | route add ... | route del ...";
  },
};
