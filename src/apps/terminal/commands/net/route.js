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
 * Parse "A.B.C.D/len" -> { dstIp: IPAddress(v4), prefix }
 * @param {string} s
 * @returns {{ dstIp: IPAddress, prefix: number } | null}
 */
function parseCidr(s) {
  const m = /^(.+?)\/(\d+)$/.exec(String(s ?? "").trim());
  if (!m) return null;

  const ipNum = ipStringToNumber(m[1]);
  const prefix = Number(m[2]);
  if (ipNum == null || !Number.isFinite(prefix)) return null;

  const p = Math.max(0, Math.min(32, prefix | 0));
  // Create v4 IPAddress
  const dstIp = new IPAddress(4, u32(ipNum));
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
 * Make a v4 IPAddress from "a.b.c.d" or from numeric string fallback.
 * @param {string} s
 * @returns {IPAddress|null}
 */
function parseV4IpAddress(s) {
  const txt = String(s ?? "").trim();
  // prefer dotted
  const n = ipStringToNumber(txt);
  if (n != null) return new IPAddress(4, u32(n));
  // allow already "IPAddress string" (in case you later accept IPv6)
  try {
    const ip = IPAddress.fromString(txt);
    if (!ip.isV4()) return null;
    return ip;
  } catch {
    return null;
  }
}

/** @type {import("../types.js").Command} */
export const route = {
  name: "route",
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
        const dst = (r?.dst instanceof IPAddress) ? r.dst : parseV4IpAddress(String(r?.dst ?? "0.0.0.0"));
        const nm  = (r?.netmask instanceof IPAddress) ? r.netmask : parseV4IpAddress(String(r?.netmask ?? "0.0.0.0"));
        const nh  = (r?.nexthop instanceof IPAddress) ? r.nexthop : parseV4IpAddress(String(r?.nexthop ?? "0.0.0.0"));

        const dstStr = dst ? dst.toString() : "0.0.0.0";
        const maskNum = nm && nm.isV4() ? (nm.getNumber() >>> 0) : 0;
        const pfx = netmaskToPrefix32(maskNum);
        const dstCidr = `${dstStr}/${pfx == null ? "?" : String(pfx)}`;

        const gwStr = nh ? nh.toString() : "0.0.0.0";
        const ifn = ifaceName(ipf, Number(r?.interf ?? 0));
        const auto = (r?.auto ? t("app.terminal.commands.route.out.autoYes") : t("app.terminal.commands.route.out.autoNo"));

        // padEnd: keep it simple even if strings longer
        ctx.println(
          `${dstCidr.padEnd(22)} ${gwStr.padEnd(18)} ${ifn.padEnd(6)} ${auto}`
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

      const gwIp = parseV4IpAddress(gwStr);
      if (!gwIp) return t("app.terminal.commands.route.err.invalidGatewayIp");

      const ifIndex = parseIfSel(ipf, ifSel);
      if (ifIndex == null) return t("app.terminal.commands.route.err.invalidInterface", { iface: ifSel });

      const netmaskNum = prefixToNetmask32(parsed.prefix);
      const netmaskIp = new IPAddress(4, netmaskNum);

      // use the kernel API (your IPStack.addRoute expects IPAddress)
      ipf.addRoute(parsed.dstIp, netmaskIp, ifIndex, gwIp);

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

      const netmaskNum = prefixToNetmask32(parsed.prefix);
      const netmaskIp = new IPAddress(4, netmaskNum);

      // optional qualifiers
      let gwIp = null;
      let ifIndex = null;

      // crude option parsing: scan remaining args for "via X" and "dev Y"
      for (let i = 2; i < args.length; i++) {
        const a = args[i];
        if (a === "via" && args[i + 1]) {
          gwIp = parseV4IpAddress(args[i + 1]);
          i++;
          continue;
        }
        if (a === "dev" && args[i + 1]) {
          ifIndex = parseIfSel(ipf, args[i + 1]);
          i++;
          continue;
        }
      }

      // if user gave invalid via/dev values -> error
      if (gwIp === null && args.includes("via")) {
        return t("app.terminal.commands.route.err.invalidGatewayIp");
      }
      if (ifIndex === null && args.includes("dev")) {
        const v = args[args.indexOf("dev") + 1];
        return t("app.terminal.commands.route.err.invalidInterface", { iface: String(v ?? "") });
      }

      let removed = 0;

      if (gwIp != null && ifIndex != null) {
        // exact removal
        ipf.delRoute(parsed.dstIp, netmaskIp, ifIndex, gwIp);
        removed = 1; // best effort (delRoute doesn't return count)
      } else {
        // remove all matching manual routes for that dst/prefix
        const routes = ipf.routingTable ?? [];
        for (const r of routes) {
          if (r?.auto) continue;
          if (!(r?.dst instanceof IPAddress) || !(r?.netmask instanceof IPAddress) || !(r?.nexthop instanceof IPAddress)) continue;

          if (r.dst.toString() !== parsed.dstIp.toString()) continue;
          if (r.netmask.toString() !== netmaskIp.toString()) continue;

          if (gwIp != null && r.nexthop.toString() !== gwIp.toString()) continue;
          if (ifIndex != null && (r.interf | 0) !== (ifIndex | 0)) continue;

          ipf.delRoute(r.dst, r.netmask, r.interf, r.nexthop);
          removed++;
        }
      }

      ctx.println(t("app.terminal.commands.route.out.okRemoved", { count: removed }));
      return;
    }

    return t("app.terminal.commands.route.usage.main");
  },
};
