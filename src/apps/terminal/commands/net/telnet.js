//@ts-check

import { IPAddress } from "../../../../net/models/IPAddress.js";
import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";

/** @param {string} s */
function encodeUTF8(s) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

/** @param {Uint8Array} b */
function decodeUTF8(b) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
  let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s;
}

/**
 * Read lines from a TCP connection. Returns null on EOF.
 * @param {any} net
 * @param {string} ck
 * @param {{buf: Uint8Array}} st
 */
async function readLine(net, ck, st) {
  while (true) {
    const b = st.buf;
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 10) {
        const end = (i > 0 && b[i - 1] === 13) ? i - 1 : i;
        const line = decodeUTF8(b.slice(0, end));
        st.buf = b.slice(i + 1);
        return line;
      }
    }
    const part = await net.recvTCPConn(ck);
    if (part == null) return null;
    const m = new Uint8Array(b.length + part.length);
    m.set(b); m.set(part, b.length); st.buf = m;
    if (st.buf.length > 256 * 1024) return null;
  }
}

/** @type {import("../types.js").Command} */
export const telnet = {
  name: "telnet",
  category: "net",
  tldr: {
    descKey: "app.terminal.commands.telnet.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.telnet.tldr.ex.connect", cmd: "telnet 192.168.1.1 23" },
      { labelKey: "app.terminal.commands.telnet.tldr.ex.http",    cmd: "telnet 192.168.1.1 80" },
    ],
  },
  run: async (ctx, args) => {
    if (args.length < 2) throw new CommandError(t("app.terminal.commands.telnet.usage"));

    const host = args[0];
    const port = Number(args[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new CommandError(t("app.terminal.commands.telnet.err.invalidPort"));

    // resolve host → IPAddress
    let ip = null;
    try { ip = IPAddress.fromString(host); } catch { /* not a literal */ }
    if (!ip) {
      try { ip = await ctx.os.dns.resolveIP(host); } catch { /* ignore */ }
    }
    if (!ip) throw new CommandError(t("app.terminal.commands.telnet.err.resolve", { host }));

    // connect
    let ck;
    try {
      const conn = await ctx.os.net.connectTCPConn(ip, port);
      ck = conn?.key ?? null;
    } catch (e) {
      throw new CommandError(t("app.terminal.commands.telnet.err.connect", { reason: e instanceof Error ? e.message : String(e) }));
    }
    if (!ck) throw new CommandError(t("app.terminal.commands.telnet.err.connect", { reason: "no connection key" }));

    ctx.println(t("app.terminal.commands.telnet.connected", { host, port }));

    let closed = false;
    /** @type {(() => void) | null} */ let resolveDone = null;
    const done = new Promise(r => { resolveDone = /** @type {any} */ (r); });

    const close = () => {
      if (closed) return;
      closed = true;
      ctx.app.rawInputHandler = null;
      try { ctx.os.net.closeTCPConn(ck); } catch { /* ignore */ }
      ctx.println(t("app.terminal.commands.telnet.closed"));
      resolveDone?.();
    };

    // Ctrl+C → disconnect
    ctx.onInterrupt(close);

    // Typed lines → send over TCP
    ctx.app.rawInputHandler = (line) => {
      if (closed) return;
      try { ctx.os.net.sendTCPConn(ck, encodeUTF8(line + "\r\n")); }
      catch { close(); }
    };

    // Receive loop
    (async () => {
      const st = { buf: new Uint8Array(0) };
      while (!closed) {
        let line;
        try { line = await readLine(ctx.os.net, ck, st); }
        catch { break; }
        if (line == null) break;
        ctx.println(line);
      }
      close();
    })();

    await done;
  },
};
