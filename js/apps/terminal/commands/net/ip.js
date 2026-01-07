//@ts-check

import { t } from "../../../../i18n/index.js";
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
 * @param {any} itf
 * @param {number} idx
 */
function ifaceLabel(itf, idx) {
  return itf?.name ?? itf?.ifname ?? itf?.label ?? `eth${idx}`;
}

/**
 * Find interface by index or name.
 * @param {any[]} ifaces
 * @param {string} sel
 */
function findIface(ifaces, sel) {
  if (/^\d+$/.test(sel)) {
    const idx = Number(sel);
    if (idx >= 0 && idx < ifaces.length) return { idx, itf: ifaces[idx] };
  }
  for (let i = 0; i < ifaces.length; i++) {
    const itf = ifaces[i];
    if (ifaceLabel(itf, i) === sel) return { idx: i, itf };
  }
  return null;
}

/** @type {import("../types.js").Command} */
export const ip = {
  name: "ip",
  run: (ctx, args) => {
    const ipf = ctx.os.net;
    if (!ipf) return t("app.terminal.commands.ip.err.noNetDriver");

    const ifaces = ipf.interfaces ?? [];
    const sub = args[0] ?? "a";

    // Show (default)
    if (sub === "a" || sub === "addr" || sub === "address" || sub === "show" || sub === "-a") {
      if (ifaces.length === 0) return t("app.terminal.commands.ip.err.noInterfaces");

      for (let i = 0; i < ifaces.length; i++) {
        const itf = ifaces[i];
        const name = ifaceLabel(itf, i);

        const ipNum = (typeof itf?.ip === "number") ? u32(itf.ip) : 0;
        const maskNum = (typeof itf?.netmask === "number") ? u32(itf.netmask) : 0;

        const up = (typeof itf?.up === "boolean")
          ? (itf.up ? t("app.terminal.commands.ip.state.up") : t("app.terminal.commands.ip.state.down"))
          : t("app.terminal.commands.ip.state.unknown");

        ctx.println(t("app.terminal.commands.ip.out.ifaceLine", { idx: i, name, state: up }));
        ctx.println(t("app.terminal.commands.ip.out.inetLine", {
          ip: ipNumberToString(ipNum),
          netmask: ipNumberToString(maskNum),
          inetLabel: t("app.terminal.commands.ip.out.inetLabel"),
          netmaskLabel: t("app.terminal.commands.ip.out.netmaskLabel"),
        }));
      }
      return;
    }

    // Set: ip set <iface> <ip>/<prefix>
    // IMPORTANT: go through ipforwarder.configureInterface() to update auto routes
    if (sub === "set") {
      const sel = args[1];
      const cidr = args[2];
      if (!sel || !cidr) return t("app.terminal.commands.ip.usage.set");

      const hit = findIface(ifaces, sel);
      if (!hit) return t("app.terminal.commands.ip.err.unknownInterface", { iface: sel });

      const parsed = parseCidr(cidr);
      if (!parsed) return t("app.terminal.commands.ip.err.invalidCidr");

      const netmask = prefixToNetmask32(parsed.prefix);

      // 🔥 This is the important part: call the kernel API, not direct mutation
      ipf.configureInterface(hit.idx, {
        ip: parsed.ip,
        netmask,
        name: ifaceLabel(hit.itf, hit.idx),
      });

      const itf = ipf.interfaces[hit.idx];
      ctx.println(t("app.terminal.commands.ip.out.okSet", {
        iface: ifaceLabel(itf, hit.idx),
        ip: ipNumberToString(u32(itf.ip)),
        prefix: parsed.prefix,
      }));
      return;
    }

    // Optional: ip route show (delegates to route command later)
    return t("app.terminal.commands.ip.usage.main");
  },
};
