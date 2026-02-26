//@ts-check

import { t } from "../../../../i18n/index.js";

/**
 * @param {any} itf
 * @param {number} idx
 */
function ifaceName(itf, idx) {
  const n = itf?.name;
  return (typeof n === "string" && n) ? n : `eth${idx}`;
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
    if (ifaceName(itf, i) === sel) return { idx: i, itf };
  }
  return null;
}

/** @param {Uint8Array} mac */
function macToString(mac) {
  const parts = [];
  for (let i = 0; i < mac.length; i++) {
    parts.push(mac[i].toString(16).padStart(2, "0"));
  }
  return parts.join(":");
}

/**
 * Try to compare two IP strings in a "nice" way:
 * - If both are IPv4 dotted quads, sort by numeric value
 * - Otherwise fallback to locale string compare (IPv6-ready)
 * @param {string} a
 * @param {string} b
 */
function compareIpStrings(a, b) {
  const av4 = ipv4ToU32OrNull(a);
  const bv4 = ipv4ToU32OrNull(b);
  if (av4 != null && bv4 != null) return (av4 - bv4);
  // fallback: stable lexicographic
  return a.localeCompare(b, "en");
}

/**
 * @param {string} s
 * @returns {number|null}
 */
function ipv4ToU32OrNull(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
  if (!m) return null;
  const a = [m[1], m[2], m[3], m[4]].map(Number);
  if (a.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((a[0] << 24) >>> 0) + (a[1] << 16) + (a[2] << 8) + a[3]) >>> 0;
}

/** @type {import("../types.js").Command} */
export const arp = {
  name: "arp",
  run: (ctx, args) => {
    const net = ctx.os.net;
    if (!net) return t("app.terminal.commands.arp.err.noNetDriver");

    const ifaces = net.interfaces;
    if (!Array.isArray(ifaces) || ifaces.length === 0) return t("app.terminal.commands.arp.err.noInterfaces");

    const sub = args[0] ?? "show";

    /** @type {string|null} */
    let sel = null;
    if (sub === "show" || sub === "a" || sub === "-a") {
      sel = args[1] ?? null;
    } else if (sub) {
      sel = sub; // treat first arg as iface selector
    }

    /** @type {Array<{idx:number,itf:any}>} */
    const targets = [];
    if (sel) {
      const hit = findIface(ifaces, sel);
      if (!hit) return t("app.terminal.commands.arp.err.unknownInterface", { iface: sel });
      targets.push(hit);
    } else {
      for (let i = 0; i < ifaces.length; i++) targets.push({ idx: i, itf: ifaces[i] });
    }

    let anyPrintedRow = false;

    for (const { idx, itf } of targets) {
      const name = ifaceName(itf, idx);

      /** @type {Map<string, Uint8Array>|null} */
      const table = itf?.arpTable ?? null;

      if (!(table instanceof Map)) {
        ctx.println(t("app.terminal.commands.arp.msg.noArpTable", { iface: name }));
        continue;
      }

      // entries: [ipString, mac]
      const entries = [...table.entries()]
        .filter(([k]) => typeof k === "string" && k.length > 0)
        .sort((a, b) => compareIpStrings(a[0], b[0]));

      ctx.println(t("app.terminal.commands.arp.msg.header", { iface: name }));
      if (entries.length === 0) {
        ctx.println(t("app.terminal.commands.arp.msg.empty"));
        continue;
      }

      for (const [ipStrRaw, mac] of entries) {
        const ipStr = String(ipStrRaw);
        const macStr = (mac instanceof Uint8Array) ? macToString(mac) : String(mac);
        ctx.println(`  ${ipStr}  ${macStr}`);
        anyPrintedRow = true;
      }
    }

    // If only headers/empty were printed, returning undefined is fine
    if (!anyPrintedRow && targets.length > 0) return;
    return;
  },
};
