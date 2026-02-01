//@ts-check

import { t } from "../../../../i18n/index.js";
import { nowMs } from "../lib/time.js";
import { sleepAbortable } from "../lib/abort.js";
import { SimControl } from "../../../../SimControl.js";

import { DNSPacket } from "../../../../net/pdu/DNSPacket.js";
import { IPAddress } from "../../../../net/models/IPAddress.js";

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
      if (rr.type === DNSPacket.TYPE_A && rr.data instanceof Uint8Array) {
        const ip = ipv4U8ToString(rr.data);
        return ip || "<bad A>";
      }
      if (rr.type === DNSPacket.TYPE_NS && typeof rr.data === "string") {
        return rr.data;
      }
      if (rr.type === DNSPacket.TYPE_MX) {
        if (rr.data && typeof rr.data === "object") {
          const pref = rr.data.preference ?? rr.data.pref ?? 0;
          const ex = rr.data.exchange ?? rr.data.host ?? "";
          return `${pref} ${ex}`;
        }
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

    /**
     * @param {number} n
     */
    const v4NumToStr = (n) => {
      const x = (n >>> 0);
      return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
    };

    /**
     * Try parse host as IPAddress (IPv4/IPv6). Returns null if invalid.
     * @param {string} host
     * @returns {IPAddress|null}
     */
    const parseIp = (host) => {
      try {
        const ip = IPAddress.fromString(String(host).trim());
        return ip;
      } catch {
        return null;
      }
    };

    /**
     * We only support sending UDP via the IPv4 stack for now.
     * @param {IPAddress} ip
     * @returns {number|null} v4 u32
     */
    const toV4NumOrNull = (ip) => {
      try {
        if (ip && ip.isV4()) return (/** @type {number} */(ip.getNumber()) >>> 0);
      } catch {}
      return null;
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
        if (a.startsWith("+time=")) {
          const v = Number(a.slice("+time=".length));
          if (!Number.isFinite(v) || v <= 0) return t("app.terminal.commands.dig.err.invalidTime");
          timeoutMs = Math.max(1, Math.floor(v * 1000));
          continue;
        }
        if (a.startsWith("+tries=")) {
          const v = Number(a.slice("+tries=".length));
          if (!Number.isFinite(v) || v <= 0) return t("app.terminal.commands.dig.err.invalidTries");
          tries = Math.max(1, Math.min(10, Math.floor(v)));
          continue;
        }
        continue;
      }

      if (a.startsWith("@")) {
        argv.shift();
        serverStr = a.slice(1).trim();
        continue;
      }

      if (!qname) {
        qname = String(take() ?? "").trim();
        continue;
      }

      if (!qtypeStr) {
        qtypeStr = String(take() ?? "").trim();
        continue;
      }

      argv.shift();
    }

    if (!qname) return usage();

    // Determine qtype
    const qtype = typeMap.get(qtypeStr.toUpperCase()) ?? (qtypeStr ? Number(qtypeStr) : DNSPacket.TYPE_A);
    const finalType = Number.isInteger(qtype) ? (qtype & 0xffff) : DNSPacket.TYPE_A;

    const name = normalizeName(qname);

    const net = ctx.os?.net;
    if (!net?.openUDPSocket || !net?.sendUDPSocket || !net?.recvUDPSocket || !net?.closeUDPSocket) {
      return t("app.terminal.commands.dig.err.noUdp");
    }

    /**
     * Resolve host to server IPAddress. We accept:
     * - direct IP literal
     * - ctx.os.dns.resolve(host) -> string or number (legacy)
     *
     * Returns an IPAddress (may be v4/v6), BUT we require v4 for sending.
     * @param {string} host
     * @returns {Promise<IPAddress|null>}
     */
    const resolveHostToIp = async (host) => {
      const direct = parseIp(host);
      if (direct) return direct;

      const dns = ctx.os?.dns;
      if (dns?.resolve) {
        const r = await dns.resolve(host);

        if (r instanceof IPAddress) return r;

        if (typeof r === "string") {
          const ip = parseIp(r);
          if (ip) return ip;
        }

        if (typeof r === "number") {
          // legacy: v4 number
          const s = v4NumToStr(r >>> 0);
          const ip = parseIp(s);
          if (ip) return ip;
        }
      }

      return null;
    };

    // Determine server IP
    /** @type {IPAddress|null} */
    let serverIpObj = null;

    if (serverStr) {
      serverIpObj = await resolveHostToIp(serverStr);
      if (serverIpObj == null) {
        return t("app.terminal.commands.dig.err.cannotResolveServer", { host: serverStr });
      }
    } else {
      serverIpObj = IPAddress.fromString("127.0.0.1");
    }

    // For now the UDP/IP stack is IPv4-only
    const serverV4Num = toV4NumOrNull(serverIpObj);
    if (serverV4Num == null) {
      return t("app.terminal.commands.dig.err.cannotResolveServer", { host: serverStr || "127.0.0.1" });
    }

    const serverIpText = serverIpObj.toString();

    // Open an ephemeral UDP socket
    const openEphemeral = () => {
      try {
        return net.openUDPSocket(0, 0);
      } catch {
        for (let p = 49152; p <= 65535; p++) {
          try {
            return net.openUDPSocket(0, p);
          } catch { /* keep trying */ }
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

    /**
     * Send UDP either with IPAddress (new API) or number (legacy API).
     * @param {any} dstIpObj
     * @param {number} dstIpNum
     * @param {number} dstPort
     * @param {Uint8Array} data
     */
    const sendUdpCompat = (dstIpObj, dstIpNum, dstPort, data) => {
      try {
        // new style (IPAddress)
        net.sendUDPSocket(sock, dstIpObj, dstPort, data);
      } catch {
        // old style (number)
        net.sendUDPSocket(sock, dstIpNum >>> 0, dstPort, data);
      }
    };

    /**
     * Normalize res.src to v4 u32 if possible, else null.
     * @param {any} src
     * @returns {number|null}
     */
    const srcToV4NumOrNull = (src) => {
      if (typeof src === "number") return (src >>> 0);
      if (src instanceof IPAddress) {
        const n = toV4NumOrNull(src);
        return n == null ? null : n;
      }
      return null;
    };

    /** @param {number} ms */
    const recvWithTimeout = async (ms) => {
      const t0 = nowMs();

      while (true) {
        if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");

        const elapsed = nowMs() - t0;
        if (elapsed >= ms) return null;

        const slice = Math.max(1, Math.min(25 * SimControl.tick, ms - elapsed));
        const res = await Promise.race([
          net.recvUDPSocket(sock),
          (async () => { await sleepAbortable(slice, ctx.signal); return "__timeout__"; })(),
        ]);

        if (res === "__timeout__") continue;
        if (res == null) return null;

        const srcV4 = srcToV4NumOrNull(res.src);
        const srcPort = typeof res.srcPort === "number" ? (res.srcPort | 0) : null;

        const data =
          (res.payload instanceof Uint8Array) ? res.payload :
          (res.data instanceof Uint8Array) ? res.data :
          null;

        if (!data) continue;

        // accept only from chosen server if src info exists
        if (srcV4 != null && srcV4 !== (serverV4Num >>> 0)) continue;

        // Port check: keep it permissive (some stacks may not report exact port)
        if (srcPort != null && srcPort !== port) {
          // if this causes issues, comment out:
          // continue;
        }

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

        sendUdpCompat(serverIpObj, serverV4Num, port, payload);

        resp = await recvWithTimeout(timeoutMs);
        if (resp) break;
      }

      if (!resp) {
        ctx.println(t("app.terminal.commands.dig.out.timeout", { server: serverIpText, port }));
        return;
      }

      const elapsedMs = Math.max(0, Math.round(nowMs() - started));

      if (short) {
        for (const rr of resp.answers ?? []) ctx.println(formatRData(rr));
        return;
      }

      ctx.println(`; <<>> dig (sim) <<>> ${name} ${typeToString(finalType)}`);
      ctx.println(`;; SERVER: ${serverIpText}#${port}`);
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
          ctx.println(`${rr.name}\t${rr.ttl}\tIN\t${typeToString(rr.type)}\t${formatRData(rr)}`);
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
