//@ts-check

import { DNSPacket } from "../../net/pdu/DNSPacket.js";
import { SimControl } from "../../SimControl.js";

/**
 * System DNS resolver (UDP) with NS-fallback recursion.
 * Timing is REAL-TIME, but scaled by SimControl.tick (like your ping command).
 *
 * Special: serverIp == 0 (0.0.0.0) => disabled resolver => resolve returns null/[] immediately.
 */
export class DNSResolver {
  /**
   * @param {any} os
   * @param {number} serverIpNum IPv4 as unsigned 32-bit number
   * @param {object} [opts]
   * @param {number} [opts.port] DNS port (default 53)
   * @param {number} [opts.timeoutMs] per try in REAL ms (default 50 * SimControl.tick)
   * @param {number} [opts.tries] number of tries (default 2)
   * @param {boolean} [opts.cache] enable TTL cache (default true)
   * @param {number} [opts.maxDepth] recursion depth (default 7)
   * @param {number} [opts.negativeCacheSec] fallback TTL for empty/NX answers (default 5)
   * @param {number} [opts.maxCacheSec] clamp TTL to avoid "forever" (default 3600)
   */
  constructor(os, serverIpNum, opts = {}) {
    this.os = os;
    this.serverIp = (serverIpNum >>> 0); // may be 0 => disabled
    this.port = Number.isFinite(opts.port) ? (opts.port | 0) : 53;

    // Defaults scaled by sim speed (real-time ms)
    const tick = this._tick();
    this.timeoutMs = Number.isFinite(opts.timeoutMs)
      ? (opts.timeoutMs | 0)
      : Math.max(1, Math.floor(50 * tick));

    this.tries = Number.isFinite(opts.tries)
      ? Math.max(1, Math.min(10, opts.tries | 0))
      : 2;

    this.cacheEnabled = (opts.cache ?? true) ? true : false;
    this.maxDepth = Number.isFinite(opts.maxDepth) ? Math.max(1, opts.maxDepth | 0) : 7;

    this.negativeCacheSec = Number.isFinite(opts.negativeCacheSec) ? Math.max(0, opts.negativeCacheSec | 0) : 5;
    this.maxCacheSec = Number.isFinite(opts.maxCacheSec) ? Math.max(1, opts.maxCacheSec | 0) : 3600;

    /** @type {Map<string, {expiresAt:number, value:any}>} */
    this._cache = new Map();
  }

  /** @type {any} */ os;

  /** @type {number} */ serverIp;
  /** @type {number} */ port;

  /** @type {number} */ timeoutMs; // REAL ms (already scaled by default)

  /** @type {number} */ tries;
  /** @type {boolean} */ cacheEnabled;
  /** @type {number} */ maxDepth;

  /** @type {number} */ negativeCacheSec;
  /** @type {number} */ maxCacheSec;

  /** @type {Map<string, {expiresAt:number, value:any}>} */
  _cache;

  /**
   * Change DNS server and flush cache. serverIpNum == 0 disables resolver.
   * @param {number} serverIpNum
   * @param {number} [port]
   */
  setServer(serverIpNum, port) {
    this.serverIp = (serverIpNum >>> 0); // 0 allowed => disabled
    if (port != null) this.port = port | 0;
    this._cache.clear();
  }

  // ---------------- public API ----------------

  /**
   * Convenience: resolve host to ONE IPv4 (number). Returns null if not resolvable.
   * @param {string} name
   * @returns {Promise<number|null>}
   */
  async resolve(name) {
    if (!this._isConfigured()) return null;
    const ips = await this.resolveA(name);
    return ips.length ? (ips[0] >>> 0) : null;
  }

  /**
   * Resolve A records as IPv4 numbers.
   * @param {string} name
   * @returns {Promise<number[]>}
   */
  async resolveA(name) {
    if (!this._isConfigured()) return [];
    const resp = await this._query(name, DNSPacket.TYPE_A);
    return this._extractAasNumbers(resp);
  }

  /**
   * Resolve MX records.
   * Expects rr.data as { preference, exchange } (your server uses that).
   * @param {string} name
   * @returns {Promise<Array<{preference:number, exchange:string, ttl:number}>>}
   */
  async resolveMX(name) {
    if (!this._isConfigured()) return [];
    const resp = await this._query(name, DNSPacket.TYPE_MX);
    if (!resp) return [];

    /** @type {Array<{preference:number, exchange:string, ttl:number}>} */
    const out = [];

    for (const rr of (resp.answers ?? [])) {
      if ((rr.cls & 0xffff) !== DNSPacket.CLASS_IN) continue;
      if ((rr.type & 0xffff) !== DNSPacket.TYPE_MX) continue;

      const ttl = (rr.ttl ?? 0) >>> 0;
      const d = rr.data;
      if (d && typeof d === "object") {
        const preference = Number(d.preference ?? d.pref ?? 0) | 0;
        const exchange = String(d.exchange ?? d.host ?? "").trim();
        if (exchange) out.push({ preference: Math.max(0, Math.min(65535, preference)), exchange, ttl });
      }
    }

    out.sort((a, b) => a.preference - b.preference);
    return out;
  }

  /**
   * Resolve NS records.
   * rr.data expected to be hostname string.
   * @param {string} name
   * @returns {Promise<Array<{host:string, ttl:number}>>}
   */
  async resolveNS(name) {
    if (!this._isConfigured()) return [];
    const resp = await this._query(name, DNSPacket.TYPE_NS);
    if (!resp) return [];

    /** @type {Array<{host:string, ttl:number}>} */
    const out = [];
    for (const rr of (resp.answers ?? [])) {
      if ((rr.cls & 0xffff) !== DNSPacket.CLASS_IN) continue;
      if ((rr.type & 0xffff) !== DNSPacket.TYPE_NS) continue;
      const ttl = (rr.ttl ?? 0) >>> 0;
      if (typeof rr.data === "string" && rr.data.trim()) out.push({ host: rr.data.trim(), ttl });
    }
    return out;
  }

  // ---------------- internal ----------------

  _isConfigured() {
    return (this.serverIp >>> 0) !== 0;
  }

  _tick() {
    const t = Number(SimControl?.tick ?? 1);
    return Number.isFinite(t) && t > 0 ? t : 1;
  }

  _nowRealMs() {
    return Date.now();
  }

  _sleepRealMs(ms) {
    const d = Math.max(0, ms | 0);
    return new Promise((resolve) => setTimeout(resolve, d));
  }

  /**
   * @param {string} name
   * @returns {string}
   */
  _normalizeName(name) {
    let s = String(name ?? "").trim().toLowerCase();
    if (s.endsWith(".")) s = s.slice(0, -1);
    return s;
  }

  /**
   * Cache key includes target server+port.
   * @param {string} nameNorm
   * @param {number} qtype
   * @param {number} serverIp
   * @param {number} port
   */
  _cacheKey(nameNorm, qtype, serverIp, port) {
    return `${nameNorm}|${qtype & 0xffff}|${serverIp >>> 0}|${port | 0}`;
  }

  /**
   * Query starting at configured server, with NS-fallback recursion.
   * @param {string} name
   * @param {number} qtype
   * @returns {Promise<DNSPacket|null>}
   */
  async _query(name, qtype) {
    if (!this._isConfigured()) return null;

    const n = this._normalizeName(name);
    if (!n) return null;

    /** @type {Set<string>} */
    const visited = new Set();
    return this._queryRecursive(n, qtype & 0xffff, this.serverIp >>> 0, this.port | 0, this.maxDepth, visited);
  }

  /**
   * NS-fallback recursion.
   * @param {string} nameNorm
   * @param {number} qtype
   * @param {number} serverIp
   * @param {number} port
   * @param {number} depth
   * @param {Set<string>} visited
   * @returns {Promise<DNSPacket|null>}
   */
  async _queryRecursive(nameNorm, qtype, serverIp, port, depth, visited) {
    if (depth <= 0) return null;
    if ((serverIp >>> 0) === 0) return null;

    const visitKey = `${nameNorm}|${qtype}|${serverIp}|${port}`;
    if (visited.has(visitKey)) return null;
    visited.add(visitKey);

    const resp = await this._queryOnce(nameNorm, qtype, serverIp, port);
    if (!resp) return null;

    if ((resp.answers?.length ?? 0) > 0) return resp;

    const nsHosts = this._extractNSHosts(resp);
    if (nsHosts.length === 0) return resp;

    for (const nsHost of nsHosts) {
      // resolve NS hostname to A using same server chain
      const nsAResp = await this._queryRecursive(
        this._normalizeName(nsHost),
        DNSPacket.TYPE_A,
        serverIp,
        port,
        depth - 1,
        visited
      );

      const nsIps = this._extractAasNumbers(nsAResp);
      for (const nsIp of nsIps) {
        const sub = await this._queryRecursive(nameNorm, qtype, nsIp >>> 0, port, depth - 1, visited);
        if (sub && ((sub.answers?.length ?? 0) > 0)) return sub;
      }
    }

    return resp;
  }

  /**
   * One UDP DNS request to specific server.
   * Uses safe receive logic: never more than ONE pending recvUDPSocket() at a time.
   *
   * @param {string} nameNorm
   * @param {number} qtype
   * @param {number} serverIp
   * @param {number} port
   * @returns {Promise<DNSPacket|null>}
   */
  async _queryOnce(nameNorm, qtype, serverIp, port) {
    if ((serverIp >>> 0) === 0) return null;

    const cacheKey = this._cacheKey(nameNorm, qtype, serverIp, port);
    if (this.cacheEnabled) {
      const hit = this._cache.get(cacheKey);
      if (hit && hit.expiresAt > this._nowRealMs()) return hit.value;
      if (hit) this._cache.delete(cacheKey);
    }

    const net = this.os?.net;
    if (!net?.openUDPSocket || !net?.sendUDPSocket || !net?.recvUDPSocket || !net?.closeUDPSocket) {
      return null;
    }

    // Open an ephemeral UDP socket (same approach as your dig)
    const openEphemeral = () => {
      try {
        return net.openUDPSocket(0, 0);
      } catch {
        for (let p = 49152; p <= 65535; p++) {
          try { return net.openUDPSocket(0, p); } catch {}
        }
        throw new Error("cannot open udp socket");
      }
    };

    const sock = openEphemeral();

    const id = (Math.random() * 0xffff) | 0;

    const req = new DNSPacket({
      id,
      qr: 0,
      opcode: 0,
      aa: 0,
      tc: 0,
      rd: 1,
      ra: 0,
      z: 0,
      rcode: 0,
      questions: [{ name: nameNorm, type: qtype & 0xffff, cls: DNSPacket.CLASS_IN }],
      answers: [],
      authorities: [],
      additionals: [],
    });

    const payload = req.pack();

    try {
      // IMPORTANT: keep exactly one pending recv promise per socket.
      /** @type {{p: Promise<any>}} */
      const st = { p: net.recvUDPSocket(sock) };

      for (let attempt = 1; attempt <= this.tries; attempt++) {
        net.sendUDPSocket(sock, serverIp >>> 0, port | 0, payload);

        const deadline = this._nowRealMs() + Math.max(1, this.timeoutMs | 0);
        const resp = await this._waitForId(sock, id, deadline, st);

        if (!resp) continue;

        if (this.cacheEnabled) {
          const ttlSec = this._pickCacheTTLSeconds(resp);
          const expiresAt = this._nowRealMs() + Math.floor(ttlSec * 1000 * this._tick());
          this._cache.set(cacheKey, { expiresAt, value: resp });
        }

        return resp;
      }

      return null;
    } finally {
      try { net.closeUDPSocket(sock); } catch {}
    }
  }

  /**
   * Wait for a DNS response with matching ID until deadline.
   * IMPORTANT: uses a shared recv state so only ONE recvUDPSocket() is pending.
   *
   * @param {number} sock
   * @param {number} id
   * @param {number} deadlineMsReal absolute Date.now() deadline
   * @param {{p: Promise<any>}} st
   * @returns {Promise<DNSPacket|null>}
   */
  async _waitForId(sock, id, deadlineMsReal, st) {
    const net = this.os.net;

    while (this._nowRealMs() < deadlineMsReal) {
      const remaining = deadlineMsReal - this._nowRealMs();
      const slice = Math.max(1, Math.min(Math.floor(25 * this._tick()), remaining));

      const res = await Promise.race([
        st.p,
        this._sleepRealMs(slice).then(() => "__timeout__"),
      ]);

      if (res === "__timeout__") continue;
      if (res == null) return null;

      // recv resolved -> arm next recv immediately
      st.p = net.recvUDPSocket(sock);

      const raw = res.payload ?? res.data ?? res.bytes ?? res.buf ?? null;

      /** @type {Uint8Array|null} */
      let data = null;
      if (raw instanceof Uint8Array) data = raw;
      else if (raw instanceof ArrayBuffer) data = new Uint8Array(raw);

      if (!data) continue;

      /** @type {DNSPacket|null} */
      let dns = null;
      try { dns = DNSPacket.fromBytes(data); } catch { continue; }

      if ((dns.id & 0xffff) !== (id & 0xffff)) continue;
      if ((dns.qr & 1) !== 1) continue;

      return dns;
    }

    return null;
  }

  /**
   * TTL selection for caching (seconds).
   * @param {DNSPacket} resp
   * @returns {number}
   */
  _pickCacheTTLSeconds(resp) {
    const all = []
      .concat(resp.answers ?? [])
      .concat(resp.authorities ?? [])
      .concat(resp.additionals ?? []);

    let min = Infinity;
    for (const rr of all) {
      const ttl = (rr.ttl ?? 0) >>> 0;
      if (ttl > 0) min = Math.min(min, ttl);
    }

    if (!Number.isFinite(min)) return this.negativeCacheSec;
    return Math.max(1, Math.min(this.maxCacheSec, min | 0));
  }

  /**
   * Extract NS hostnames from authorities section.
   * @param {DNSPacket} resp
   * @returns {string[]}
   */
  _extractNSHosts(resp) {
    /** @type {string[]} */
    const out = [];
    for (const rr of (resp.authorities ?? [])) {
      if ((rr.type & 0xffff) !== DNSPacket.TYPE_NS) continue;
      if (typeof rr.data === "string" && rr.data.trim()) out.push(rr.data.trim());
    }
    return Array.from(new Set(out));
  }

  /**
   * Extract A answers as IPv4 numbers from a response packet.
   * @param {DNSPacket|null} resp
   * @returns {number[]}
   */
  _extractAasNumbers(resp) {
    if (!resp) return [];
    /** @type {number[]} */
    const out = [];
    for (const rr of (resp.answers ?? [])) {
      if ((rr.type & 0xffff) !== DNSPacket.TYPE_A) continue;
      if (!(rr.data instanceof Uint8Array) || rr.data.length !== 4) continue;

      const ipNum =
        ((rr.data[0] << 24) | (rr.data[1] << 16) | (rr.data[2] << 8) | rr.data[3]) >>> 0;
      out.push(ipNum);
    }
    return out;
  }
}
