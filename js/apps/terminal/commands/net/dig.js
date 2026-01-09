//@ts-check

import { t } from "../../../../i18n/index.js";
import { ipNumberToString, ipStringToNumber } from "../lib/ip.js";
import { nowMs } from "../lib/time.js";
import { sleepAbortable } from "../lib/abort.js";
import { SimControl } from "../../../../SimControl.js";

import { DNSPacket } from "../../../../pdu/DNSPacket.js";

/** @type {import("../types.js").Command} */
export const dig = {
  name: "dig",
  run: async (ctx, args) => {
    const argv = [...args];

    const usage = () => t("app.terminal.commands.dig.usage");

    // defaults (roughly dig-like)
    let serverStr = "";       // "@x.x.x.x" optional
    let qname = "";
    let qtypeStr = "";        // A, MX, NS...
    let short = false;

    let timeoutMs = 50 * SimControl.tick; // default like your ping-ish scale
    let tries = 1;
    let port = 53;

    const take = () => argv.shift();

    const typeMap = new Map([
      ["A", 1],
      ["NS", 2],
      ["CNAME", 5],
      ["PTR", 12],
      ["MX", 15],
      ["TXT", 16],
      ["AAAA", 28],
      ["ANY", 255],
    ]);

    /** @param {Uint8Array} u8 */
    const ipv4U8ToString = (u8) => {
      if (!(u8 instanceof Uint8Array) || u8.length !== 4) return "";
      return `${u8[0]}.${u8[1]}.${u8[2]}.${u8[3]}`;
    };

    /** @param {any} rr */
    const formatRData = (rr) => {
      // rr.data comes from DNSPacket decoding
      if (rr.type === DNSPacket.TYPE_A && rr.data instanceof Uint8Array) {
        const ip = ipv4U8ToString(rr.data);
        return ip || "<bad A>";
      }
      if (rr.type === DNSPacket.TYPE_NS && typeof rr.data === "string") {
        return rr.data;
      }
      if (rr.type === DNSPacket.TYPE_MX) {
        // if you implemented MX decode as {preference, exchange}
        if (rr.data && typeof rr.data === "object") {
          const pref = rr.data.preference ?? rr.data.pref ?? 0;
          const ex = rr.data.exchange ?? rr.data.host ?? "";
          return `${pref} ${ex}`;
        }
        // fallback: raw
        return String(rr.data);
      }
      if (rr.type === DNSPacket.TYPE_CNAME && typeof rr.data === "string") return rr.data;
      if (rr.type === DNSPacket.TYPE_PTR && typeof rr.data === "string") return rr.data;
      if (rr.type === DNSPacket.TYPE_TXT && Array.isArray(rr.data)) return rr.data.map(String).join(" ");
      if (rr.data instanceof Uint8Array) return `0x${[...rr.data].map(b => b.toString(16).padStart(2, "0")).join("")}`;
      return String(rr.data);
    };

    /** @param {number} type */
    const typeToString = (type) => {
      for (const [k, v] of typeMap.entries()) if (v === type) return k;
      return String(type);
    };

    /** @param {string} s */
    const normalizeName = (s) => {
      s = String(s ?? "").trim();
      if (s.endsWith(".")) s = s.slice(0, -1);
      return s;
    };

    // parse args:
    // dig [@server] name [type]
    // options: -t TYPE, +short, +time=N, +tries=N, -p PORT
    while (argv.length) {
      const a = argv[0];

      if (a === "-h" || a === "--help") return usage();

      if (a === "-t") {
        argv.shift();
        qtypeStr = String(take() ?? "").trim();
        continue;
      }

      if (a === "-p") {
        argv.shift();
        const v = Number(take());
        if (!Number.isFinite(v) || v < 1 || v > 65535) {
          return t("app.terminal.commands.dig.err.invalidPort");
        }
        port = v | 0;
        continue;
      }

      if (a.startsWith("+")) {
        argv.shift();
        if (a === "+short") {
          short = true;
          continue;
        }
        // +time=2 (seconds)
        if (a.startsWith("+time=")) {
          const v = Number(a.slice("+time=".length));
          if (!Number.isFinite(v) || v <= 0) return t("app.terminal.commands.dig.err.invalidTime");
          timeoutMs = Math.max(1, Math.floor(v * 1000));
          continue;
        }
        // +tries=2
        if (a.startsWith("+tries=")) {
          const v = Number(a.slice("+tries=".length));
          if (!Number.isFinite(v) || v <= 0) return t("app.terminal.commands.dig.err.invalidTries");
          tries = Math.max(1, Math.min(10, Math.floor(v)));
          continue;
        }
        // unknown +option -> ignore
        continue;
      }

      if (a.startsWith("@")) {
        argv.shift();
        serverStr = a.slice(1).trim();
        continue;
      }

      // first non-option: name
      if (!qname) {
        qname = String(take() ?? "").trim();
        continue;
      }

      // second non-option: type
      if (!qtypeStr) {
        qtypeStr = String(take() ?? "").trim();
        continue;
      }

      // rest ignored
      argv.shift();
    }

    if (!qname) return usage();

    // Determine qtype
    const qtype = typeMap.get(qtypeStr.toUpperCase()) ?? (qtypeStr ? Number(qtypeStr) : DNSPacket.TYPE_A);
    const finalType = Number.isInteger(qtype) ? (qtype & 0xffff) : DNSPacket.TYPE_A;

    // Determine server IP
    // If no @server given: try ctx.os.dns?.server or fallback 127.0.0.1
    let serverNum = null;

    const resolveHostToIpNum = async (host) => {
      const direct = ipStringToNumber(host);
      if (direct != null) return direct >>> 0;

      // optional: use OS resolver if present (but note: may call your dnsd!)
      const dns = ctx.os?.dns;
      if (dns?.resolve) {
        const r = await dns.resolve(host);
        if (typeof r === "number") return r >>> 0;
        if (typeof r === "string") {
          const n = ipStringToNumber(r);
          if (n != null) return n >>> 0;
        }
      }
      return null;
    };

    if (serverStr) {
      serverNum = await resolveHostToIpNum(serverStr);
      if (serverNum == null) return t("app.terminal.commands.dig.err.cannotResolveServer", { host: serverStr });
    } else {
      // default: localhost
      serverNum = ipStringToNumber("127.0.0.1");
      if (serverNum == null) serverNum = 0x7f000001;
    }

    const serverIp = ipNumberToString(serverNum >>> 0);
    const name = normalizeName(qname);

    const net = ctx.os?.net;
    if (!net?.openUDPSocket || !net?.sendUDPSocket || !net?.recvUDPSocket || !net?.closeUDPSocket) {
      return t("app.terminal.commands.dig.err.noUdp");
    }

    // Open an ephemeral UDP socket (try port 0, else try a range)
    const openEphemeral = () => {
      try {
        return net.openUDPSocket(0, 0);
      } catch {
        // fallback: try random high ports
        for (let p = 49152; p <= 65535; p++) {
          try {
            return net.openUDPSocket(0, p);
          } catch {
            // keep trying
          }
        }
        throw new Error("cannot open udp socket");
      }
    };

    const sock = openEphemeral();

    const id = (Math.random() * 0xffff) | 0;

    const query = new DNSPacket({
      id,
      qr: 0,
      opcode: 0,
      aa: 0,
      tc: 0,
      rd: 1,
      ra: 0,
      z: 0,
      rcode: 0,
      questions: [{ name, type: finalType, cls: DNSPacket.CLASS_IN }],
      answers: [],
      authorities: [],
      additionals: [],
    });

    const payload = query.pack();

    const started = nowMs();

    /** @param {number} ms */
    const recvWithTimeout = async (ms) => {
      const t0 = nowMs();
      while (true) {
        if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

        const elapsed = nowMs() - t0;
        if (elapsed >= ms) return null;

        // race recv vs timeout slice (so we can remain abortable)
        const slice = Math.max(1, Math.min(25 * SimControl.tick, ms - elapsed));
        const res = await Promise.race([
          net.recvUDPSocket(sock),
          (async () => { await sleepAbortable(slice, ctx.signal); return "__timeout__"; })(),
        ]);

        if (res === "__timeout__") continue;
        if (res == null) return null;

        const src = typeof res.src === "number" ? res.src >>> 0 : null;
        const srcPort = typeof res.srcPort === "number" ? res.srcPort | 0 : null;
        const data = (res.payload instanceof Uint8Array) ? res.payload : (res.data instanceof Uint8Array ? res.data : null);
        if (!data) continue;

        // Only accept from our chosen server:port (if info exists)
        if (src != null && src !== (serverNum >>> 0)) continue;
        if (srcPort != null && srcPort !== port) {
          // some stacks may show server ephemeral; so don't be too strict
          // comment the next line if it causes drops
          // continue;
        }

        // Parse and match ID
        try {
          const pkt = DNSPacket.fromBytes(data);
          if ((pkt.id & 0xffff) !== (id & 0xffff)) continue;
          return pkt;
        } catch {
          continue;
        }
      }
    };

    try {
      let resp = null;

      for (let attempt = 1; attempt <= tries; attempt++) {
        if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

        net.sendUDPSocket(sock, serverNum >>> 0, port, payload);

        resp = await recvWithTimeout(timeoutMs);
        if (resp) break;
      }

      if (!resp) {
        ctx.println(t("app.terminal.commands.dig.out.timeout", { server: serverIp, port }));
        return;
      }

      const elapsedMs = Math.max(0, Math.round(nowMs() - started));

      if (short) {
        // print only answer RDATA lines (like dig +short)
        for (const rr of resp.answers ?? []) {
          ctx.println(formatRData(rr));
        }
        return;
      }

      // dig-like verbose output (simplified)
      ctx.println(`; <<>> dig (sim) <<>> ${name} ${typeToString(finalType)}`);
      ctx.println(`;; SERVER: ${serverIp}#${port}`);
      ctx.println(`;; QUERY ID: ${resp.id}  ;; rcode: ${resp.rcode}  ;; time: ${elapsedMs} ms`);
      ctx.println("");

      ctx.println(";; QUESTION SECTION:");
      for (const q of resp.questions ?? []) {
        ctx.println(`;${q.name}\t\tIN\t${typeToString(q.type)}`);
      }
      ctx.println("");

      const printRRSection = (title, arr) => {
        if (!arr || arr.length === 0) return;
        ctx.println(title);
        for (const rr of arr) {
          ctx.println(
            `${rr.name}\t${rr.ttl}\tIN\t${typeToString(rr.type)}\t${formatRData(rr)}`
          );
        }
        ctx.println("");
      };

      printRRSection(";; ANSWER SECTION:", resp.answers);
      printRRSection(";; AUTHORITY SECTION:", resp.authorities);
      printRRSection(";; ADDITIONAL SECTION:", resp.additionals);

    } finally {
      try { net.closeUDPSocket(sock); } catch {}
    }
  },
};
