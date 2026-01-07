//@ts-check

import { t } from "../../../../i18n/index.js";
import { ipNumberToString } from "../lib/ip.js";

/** @param {number} n */
function u32(n) { return (n >>> 0); }

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
  // expect 6 bytes, but tolerate other lengths
  const parts = [];
  for (let i = 0; i < mac.length; i++) {
    parts.push(mac[i].toString(16).padStart(2, "0"));
  }
  return parts.join(":");
}

/** @type {import("../types.js").Command} */
export const arp = {
  name: "arp",
  run: (ctx, args) => {
    const net = ctx.os.net;
    if (!net) return t("app.terminal.commands.arp.err.noNetDriver");

    const ifaces = net.interfaces;
    if (ifaces.length === 0) return t("app.terminal.commands.arp.err.noInterfaces");

    const sub = args[0] ?? "show";

    let sel = null;
    if (sub === "show" || sub === "a" || sub === "-a") {
      sel = args[1] ?? null;
    } else if (sub) {
      sel = sub; // treat first arg as iface selector
    }

    const targets = [];
    if (sel) {
      const hit = findIface(ifaces, sel);
      if (!hit) return t("app.terminal.commands.arp.err.unknownInterface", { iface: sel });
      targets.push(hit);
    } else {
      for (let i = 0; i < ifaces.length; i++) targets.push({ idx: i, itf: ifaces[i] });
    }

    let anyPrinted = false;

    for (const { idx, itf } of targets) {
      const name = ifaceName(itf, idx);
      /** @type {Map<number, Uint8Array>|null} */
      const table = itf?.arpTable ?? null;

      if (!(table instanceof Map)) {
        ctx.println(t("app.terminal.commands.arp.msg.noArpTable", { iface: name }));
        continue;
      }

      const entries = [...table.entries()].sort((a, b) => (u32(a[0]) - u32(b[0])));

      ctx.println(t("app.terminal.commands.arp.msg.header", { iface: name }));
      if (entries.length === 0) {
        ctx.println(t("app.terminal.commands.arp.msg.empty"));
        continue;
      }

      for (const [ipNumRaw, mac] of entries) {
        const ipNum = u32(ipNumRaw);
        const ipStr = ipNumberToString(ipNum);
        const macStr = (mac instanceof Uint8Array) ? macToString(mac) : String(mac);
        ctx.println(`  ${ipStr}  ${macStr}`);
        anyPrinted = true;
      }
    }

    if (!anyPrinted && targets.length > 0) return; // printed headers/empty lines already
    return;
  },
};
