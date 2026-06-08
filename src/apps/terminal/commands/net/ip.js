//@ts-check

import { t } from "../../../../i18n/index.js";
import { IPAddress } from "../../../../net/models/IPAddress.js";

/**
 * Parse "address/len" — supports both IPv4 and IPv6.
 * @param {string} s
 * @returns {{ ip: IPAddress, prefix: number } | null}
 */
function parseCidr(s) {
  const m = /^(.+?)\/(\d+)$/.exec(String(s).trim());
  if (!m) return null;

  let ip;
  try {
    ip = IPAddress.fromString(m[1].trim());
  } catch {
    return null;
  }

  const prefix = Number(m[2]);
  if (!Number.isFinite(prefix)) return null;

  const maxPfx = ip.isV4() ? 32 : 128;
  const p = Math.max(0, Math.min(maxPfx, prefix | 0));
  return { ip, prefix: p };
}

/**
 * @param {any} itf
 * @param {number} idx
 */
function ifaceLabel(itf, idx) {
  const n = itf?.name ?? itf?.ifname ?? itf?.label;
  return (typeof n === "string" && n) ? n : `eth${idx}`;
}

/**
 * Find interface by index or name.
 * @param {any[]} ifaces
 * @param {string} sel
 * @returns {{ idx:number, itf:any } | null}
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

/**
 * Read ip/prefix from interface in a tolerant way.
 * @param {any} itf
 * @returns {{ ip: IPAddress, prefix: number }}
 */
function readIfaceAddr(itf) {
  const ip = (itf?.ip instanceof IPAddress) ? itf.ip : IPAddress.fromString("0.0.0.0");

  let prefix = 0;
  if (typeof itf?.prefixLength === "number" && Number.isFinite(itf.prefixLength)) {
    prefix = itf.prefixLength | 0;
  } else if (itf?.netmask instanceof IPAddress && itf.netmask.isV4()) {
    // legacy fallback: derive prefix from v4 netmask if still present
    // Count leading 1 bits
    let m = (/** @type {number} */ (itf.netmask.getNumber()) >>> 0);
    let bits = 0;
    while (bits < 32 && (m & 0x80000000) !== 0) {
      bits++;
      m = (m << 1) >>> 0;
    }
    prefix = bits;
  }

  // clamp for v4/v6
  if (ip.isV4()) prefix = Math.max(0, Math.min(32, prefix | 0));
  else prefix = Math.max(0, Math.min(128, prefix | 0));

  return { ip, prefix };
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

        const { ip: addr, prefix } = readIfaceAddr(itf);

        const up = (typeof itf?.up === "boolean")
          ? (itf.up ? t("app.terminal.commands.ip.state.up") : t("app.terminal.commands.ip.state.down"))
          : t("app.terminal.commands.ip.state.unknown");

        ctx.println(t("app.terminal.commands.ip.out.ifaceLine", { idx: i, name, state: up }));

        // inet (IPv4)
        ctx.println(t("app.terminal.commands.ip.out.inetLine", {
          ip: `${addr.toString()}/${prefix}`,
          inetLabel: t("app.terminal.commands.ip.out.inetLabel"),
          netmaskLabel: t("app.terminal.commands.ip.out.netmaskLabel"),
          netmask: `/${prefix}`,
        }));

        // inet6 link-local (always shown when available)
        if (itf?.ip6LL instanceof IPAddress) {
          ctx.println(t("app.terminal.commands.ip.out.inet6Line", {
            ip: `${itf.ip6LL.toString()}/64`,
            scope: "link",
          }));
        }

        // inet6 global (when configured)
        if (itf?.ip6 instanceof IPAddress && !itf.ip6.toUInt8().every((/** @type {number} */ b) => b === 0)) {
          const pfx6 = (typeof itf.prefixLength6 === "number") ? itf.prefixLength6 : 64;
          ctx.println(t("app.terminal.commands.ip.out.inet6Line", {
            ip: `${itf.ip6.toString()}/${pfx6}`,
            scope: "global",
          }));
        }
      }
      return;
    }

    // ip link show | ip link set <iface> mtu <value>
    if (sub === "link") {
      const linkSub = args[1] ?? "show";

      if (linkSub === "show" || linkSub === "ls") {
        if (ifaces.length === 0) return t("app.terminal.commands.ip.err.noInterfaces");
        for (let i = 0; i < ifaces.length; i++) {
          const itf = ifaces[i];
          const name = ifaceLabel(itf, i);
          const mtu = typeof itf?.getMtu === "function" ? itf.getMtu() : 1500;
          const state = (typeof itf?.up === "boolean")
            ? (itf.up ? t("app.terminal.commands.ip.state.up") : t("app.terminal.commands.ip.state.down"))
            : t("app.terminal.commands.ip.state.unknown");
          ctx.println(t("app.terminal.commands.ip.out.linkLine", { idx: i, name, state, mtu }));
        }
        return;
      }

      if (linkSub === "set") {
        // ip link set <iface> mtu <value>
        const sel   = args[2];
        const prop  = args[3];
        const value = args[4];
        if (!sel || prop !== "mtu" || !value) return t("app.terminal.commands.ip.usage.linkSet");

        const hit = findIface(ifaces, sel);
        if (!hit) return t("app.terminal.commands.ip.err.unknownInterface", { iface: sel });

        const mtu = Number(value);
        if (!Number.isInteger(mtu) || mtu < 68 || mtu > 65535)
          return t("app.terminal.commands.ip.err.invalidMtu");

        hit.itf.mtuOverride = mtu;
        ctx.println(t("app.terminal.commands.ip.out.okMtu", {
          iface: ifaceLabel(hit.itf, hit.idx),
          mtu,
        }));
        return;
      }

      return t("app.terminal.commands.ip.usage.link");
    }

    // Set: ip set <iface> <ip>/<prefix>
    // IMPORTANT: go through ipf.configureInterface() to update auto routes
    if (sub === "set") {
      const sel = args[1];
      const cidr = args[2];
      if (!sel || !cidr) return t("app.terminal.commands.ip.usage.set");

      const hit = findIface(ifaces, sel);
      if (!hit) return t("app.terminal.commands.ip.err.unknownInterface", { iface: sel });

      const parsed = parseCidr(cidr);
      if (!parsed) return t("app.terminal.commands.ip.err.invalidCidr");

      if (parsed.ip.isV4()) {
        ipf.configureInterface(hit.idx, {
          ip: parsed.ip,
          prefixLength: parsed.prefix,
          name: ifaceLabel(hit.itf, hit.idx),
        });
        const itf = ipf.interfaces[hit.idx];
        const { ip: addr, prefix } = readIfaceAddr(itf);
        ctx.println(t("app.terminal.commands.ip.out.okSet", {
          iface: ifaceLabel(itf, hit.idx),
          ip: addr.toString(),
          prefix,
        }));
      } else {
        ipf.configureInterface(hit.idx, {
          ip6: parsed.ip,
          prefixLength6: parsed.prefix,
        });
        ctx.println(t("app.terminal.commands.ip.out.okSet", {
          iface: ifaceLabel(hit.itf, hit.idx),
          ip: parsed.ip.toString(),
          prefix: parsed.prefix,
        }));
      }
      return;
    }

    return t("app.terminal.commands.ip.usage.main");
  },
};
