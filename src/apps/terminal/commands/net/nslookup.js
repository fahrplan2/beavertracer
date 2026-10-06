//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";
import { abortable } from "../lib/abort.js";
import { IPAddress } from "../../../../net/models/IPAddress.js";

const SUPPORTED_TYPES = new Set(["A", "AAAA", "MX", "NS"]);

/** @type {import("../types.js").Command} */
export const nslookup = {
  name: "nslookup",
  category: "net",
  tldr: {
    descKey: "app.terminal.commands.nslookup.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.nslookup.tldr.ex.basic", cmd: "nslookup example.com" },
      { labelKey: "app.terminal.commands.nslookup.tldr.ex.type",  cmd: "nslookup -type=MX example.com" },
    ],
  },
  run: async (ctx, args) => {
    const usage = () => t("app.terminal.commands.nslookup.usage");

    let typeStr = "A";
    let name = "";

    for (const a of args) {
      if (a === "-h" || a === "--help") return usage();

      if (a.startsWith("-type=") || a.startsWith("-q=")) {
        typeStr = a.slice(a.indexOf("=") + 1).trim().toUpperCase() || "A";
        continue;
      }

      if (a.startsWith("-")) continue; // ignore unknown flags, stay forgiving

      if (!name) { name = a; continue; }

      // A second positional argument would normally select a custom server —
      // this simplified client only ever queries the host's configured resolver.
      throw new CommandError(t("app.terminal.commands.nslookup.err.customServer"));
    }

    if (!name) throw new CommandError(usage());
    if (!SUPPORTED_TYPES.has(typeStr)) {
      throw new CommandError(t("app.terminal.commands.nslookup.err.unsupportedType", { type: typeStr }));
    }

    let isLiteral = true;
    try { IPAddress.fromString(name); } catch { isLiteral = false; }
    if (isLiteral) throw new CommandError(t("app.terminal.commands.nslookup.err.noReverse"));

    const dns = ctx.os?.dns;
    const serverIp = dns?.serverIp;
    if (!dns || !(serverIp instanceof IPAddress)) {
      ctx.println(t("app.terminal.commands.nslookup.err.noServer"));
      return;
    }

    ctx.println(t("app.terminal.commands.nslookup.out.server", { server: serverIp.toString() }));
    ctx.println(t("app.terminal.commands.nslookup.out.address", { address: `${serverIp.toString()}#53` }));
    ctx.println("");

    if (typeStr === "MX") {
      const rrs = await abortable(dns.resolveMX(name), ctx.signal);
      if (!rrs.length) { ctx.println(t("app.terminal.commands.nslookup.err.notFound", { name })); return; }
      for (const rr of rrs) ctx.println(t("app.terminal.commands.nslookup.out.mx", { name, pref: rr.preference, exchange: rr.exchange }));
      return;
    }

    if (typeStr === "NS") {
      const rrs = await abortable(dns.resolveNS(name), ctx.signal);
      if (!rrs.length) { ctx.println(t("app.terminal.commands.nslookup.err.notFound", { name })); return; }
      for (const rr of rrs) ctx.println(t("app.terminal.commands.nslookup.out.ns", { name, host: rr.host }));
      return;
    }

    const ips = await abortable(typeStr === "AAAA" ? dns.resolveAAAA(name) : dns.resolveA_IP(name), ctx.signal);
    if (!ips.length) {
      // No answer at all is not the same as "name doesn't exist" (NXDOMAIN)
      if (dns.lastQueryTimedOut) throw new CommandError(t("app.terminal.commands.nslookup.err.timeout"));
      ctx.println(t("app.terminal.commands.nslookup.err.notFound", { name }));
      return;
    }

    ctx.println(t("app.terminal.commands.nslookup.out.nonAuth"));
    ctx.println(t("app.terminal.commands.nslookup.out.name", { name }));
    for (const ip of ips) ctx.println(t("app.terminal.commands.nslookup.out.addr", { address: ip.toString() }));
  },
};
