//@ts-check

import { t } from "../../../../i18n/index.js";
import { ipStringToNumber, ipNumberToString } from "../lib/ip.js";
import { IPAddress } from "../../../../net/models/IPAddress.js";

/** @param {number} n */
function u32(n) { return (n >>> 0); }

/** @param {number} prefix */
function prefixToNetmask32(prefix) {
  const p = Math.max(0, Math.min(32, prefix | 0));
  if (p === 0) return 0 >>> 0;
  return u32((0xffffffff << (32 - p)));
}

/**
 * netmask number -> prefix (contiguous only; best effort)
 * @param {number} maskNum
 * @returns {number|null}
 */
function netmaskToPrefix32(maskNum) {
  let m = u32(maskNum);
  let seenZero = false;
  let c = 0;
  for (let i = 31; i >= 0; i--) {
    const bit = (m >>> i) & 1;
    if (bit === 1) {
      if (seenZero) return null;
      c++;
    } else {
      seenZero = true;
    }
  }
  return c;
}

/**
 * Parse "address/len" — supports both IPv4 and IPv6.
 * @param {string} s
 * @returns {{ dstIp: IPAddress, prefix: number } | null}
 */
function parseCidr(s) {
  const m = /^(.+?)\/(\d+)$/.exec(String(s ?? "").trim());
  if (!m) return null;

  let dstIp;
  try {
    dstIp = IPAddress.fromString(m[1].trim());
  } catch {
    // fallback: try legacy ipStringToNumber for plain dotted-quad without constructor
    const ipNum = ipStringToNumber(m[1]);
    if (ipNum == null) return null;
    dstIp = new IPAddress(4, u32(ipNum));
  }

  const prefix = Number(m[2]);
  if (!Number.isFinite(prefix)) return null;

  const maxPfx = dstIp.isV4() ? 32 : 128;
  const p = Math.max(0, Math.min(maxPfx, prefix | 0));
  return { dstIp, prefix: p };
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

/**
 * Parse interface selector: "lo" | "0" | "eth0" | "<name>"
 * @param {any} ipf
 * @param {string} ifSel
 * @returns {number|null} interface index, -1 for lo, or null if invalid
 */
function parseIfSel(ipf, ifSel) {
  const s = String(ifSel ?? "").trim();
  if (!s) return null;

  if (s === "lo") return -1;

  if (/^\d+$/.test(s)) {
    const idx = Number(s);
    if (!Number.isFinite(idx)) return null;
    if (idx < 0 || idx >= (ipf.interfaces?.length ?? 0)) return null;
    return idx;
  }

  const ifaces = ipf.interfaces ?? [];
  for (let i = 0; i < ifaces.length; i++) {
    const name = ifaces[i]?.name ?? `eth${i}`;
    if (name === s) return i;
  }
  return null;
}

/**
 * Parse an IP address string (IPv4 or IPv6).
 * @param {string} s
 * @returns {IPAddress|null}
 */
function parseIpAddress(s) {
  const txt = String(s ?? "").trim();
  // try dotted-quad fast path first
  const n = ipStringToNumber(txt);
  if (n != null) return new IPAddress(4, u32(n));
  try {
    return IPAddress.fromString(txt);
  } catch {
    return null;
  }
}

/**
 * Make a v4 IPAddress from "a.b.c.d" (kept for legacy callers).
 * @param {string} s
 * @returns {IPAddress|null}
 */
function parseV4IpAddress(s) {
  const ip = parseIpAddress(s);
  return (ip && ip.isV4()) ? ip : null;
}

/** @type {import("../types.js").Command} */
export const route = {
  name: "route",
  category: "net",
  tldr: {
    descKey: "app.terminal.commands.route.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.route.tldr.ex.show", cmd: "route show" },
      { labelKey: "app.terminal.commands.route.tldr.ex.add",  cmd: "route add 10.0.0.0/8 via 192.168.1.1" },
      { labelKey: "app.terminal.commands.route.tldr.ex.del",  cmd: "route del 10.0.0.0/8" },
    ],
  },
  run: (ctx, args) => {
    const ipf = ctx.os.net;
    if (!ipf) return t("app.terminal.commands.route.err.noNetworkDriver");

    const rt = ipf.routingTable ?? [];
    const sub = args[0] ?? "show";

    // ---------------- show ----------------
    if (sub === "show" || sub === "list" || sub === "-n") {
      if (rt.length === 0) return t("app.terminal.commands.route.err.emptyTable");

      ctx.println(t("app.terminal.commands.route.out.tableHeader"));

      for (const r of rt) {
        const dst = (r?.dst instanceof IPAddress) ? r.dst : parseIpAddress(String(r?.dst ?? "0.0.0.0"));
        const nh  = (r?.nexthop instanceof IPAddress) ? r.nexthop : parseIpAddress(String(r?.nexthop ?? "0.0.0.0"));

        const dstStr = dst ? dst.toString() : "?";
        // Use prefixLength directly (new model) — fall back to netmask for legacy data
        let pfx;
        if (typeof r?.prefixLength === "number") {
          pfx = r.prefixLength;
        } else if (r?.netmask instanceof IPAddress && r.netmask.isV4()) {
          pfx = netmaskToPrefix32(/** @type {number} */ (r.netmask.getNumber()) >>> 0);
        } else {
          pfx = null;
        }
        const dstCidr = `${dstStr}/${pfx == null ? "?" : String(pfx)}`;

        const nhDefault = dst?.isV6?.() ? "::" : "0.0.0.0";
        const gwStr = nh ? nh.toString() : nhDefault;
        const ifn = ifaceName(ipf, Number(r?.interf ?? 0));
        const auto = (r?.auto ? t("app.terminal.commands.route.out.autoYes") : t("app.terminal.commands.route.out.autoNo"));

        ctx.println(
          `${dstCidr.padEnd(26)} ${gwStr.padEnd(22)} ${ifn.padEnd(6)} ${auto}`
        );
      }
      return;
    }

    // ---------------- add ----------------
    // route add <dst>/<prefix> via <gw> dev <if>
    if (sub === "add") {
      const cidr = args[1];
      const via = args[2];
      const gwStr = args[3];
      const dev = args[4];
      const ifSel = args[5];

      if (!(cidr && via === "via" && gwStr && dev === "dev" && ifSel)) {
        return t("app.terminal.commands.route.usage.add");
      }

      const parsed = parseCidr(cidr);
      if (!parsed) return t("app.terminal.commands.route.err.invalidDestinationCidr");

      const gwIp = parseIpAddress(gwStr);
      if (!gwIp) return t("app.terminal.commands.route.err.invalidGatewayIp");

      const ifIndex = parseIfSel(ipf, ifSel);
      if (ifIndex == null) return t("app.terminal.commands.route.err.invalidInterface", { iface: ifSel });

      // IPStack.addRoute(dst, prefixLength, interf, nexthop)
      ipf.addRoute(parsed.dstIp, parsed.prefix, ifIndex, gwIp);

      ctx.println(t("app.terminal.commands.route.out.okAdded"));
      return;
    }

    // ---------------- del ----------------
    // route del <dst>/<prefix> [via <gw>] [dev <if>]
    if (sub === "del" || sub === "delete") {
      const cidr = args[1];
      if (!cidr) return t("app.terminal.commands.route.usage.del");

      const parsed = parseCidr(cidr);
      if (!parsed) return t("app.terminal.commands.route.err.invalidDestinationCidr");

      // optional qualifiers
      let gwIp = null;
      let ifIndex = null;

      for (let i = 2; i < args.length; i++) {
        const a = args[i];
        if (a === "via" && args[i + 1]) {
          gwIp = parseIpAddress(args[i + 1]);
          i++;
          continue;
        }
        if (a === "dev" && args[i + 1]) {
          ifIndex = parseIfSel(ipf, args[i + 1]);
          i++;
          continue;
        }
      }

      if (gwIp === null && args.includes("via")) {
        return t("app.terminal.commands.route.err.invalidGatewayIp");
      }
      if (ifIndex === null && args.includes("dev")) {
        const v = args[args.indexOf("dev") + 1];
        return t("app.terminal.commands.route.err.invalidInterface", { iface: String(v ?? "") });
      }

      let removed = 0;

      if (gwIp != null && ifIndex != null) {
        // exact removal: IPStack.delRoute(dst, prefixLength, interf, nexthop)
        ipf.delRoute(parsed.dstIp, parsed.prefix, ifIndex, gwIp);
        removed = 1;
      } else {
        const routes = ipf.routingTable ?? [];
        for (const r of routes) {
          if (r?.auto) continue;
          if (!(r?.dst instanceof IPAddress) || !(r?.nexthop instanceof IPAddress)) continue;
          if (r.dst.toString() !== parsed.dstIp.toString()) continue;
          if ((r.prefixLength | 0) !== parsed.prefix) continue;
          if (gwIp != null && r.nexthop.toString() !== gwIp.toString()) continue;
          if (ifIndex != null && (r.interf | 0) !== (ifIndex | 0)) continue;
          ipf.delRoute(r.dst, r.prefixLength, r.interf, r.nexthop);
          removed++;
        }
      }

      ctx.println(t("app.terminal.commands.route.out.okRemoved", { count: removed }));
      return;
    }

    return t("app.terminal.commands.route.usage.main");
  },
};
