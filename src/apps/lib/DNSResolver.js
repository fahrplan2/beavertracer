//@ts-check

import { DNSPacket } from "../../net/pdu/DNSPacket.js";
import { SimControl } from "../../SimControl.js";
import { IPAddress } from "../../net/models/IPAddress.js";

/**
 * System DNS resolver (UDP) with NS-fallback recursion.
 * Timing is REAL-TIME, but scaled by SimControl.tick.
 *
 * Special:
 *   serverIp == null or 0.0.0.0 => disabled resolver => resolve returns null/[] immediately.
 *
 * IPStack-ready:
 *   - stores server as IPAddress
 *   - uses openUDPSocket(IPAddress, port)
 *   - uses sendUDPSocket(sock, IPAddress, port, payload)
 */
export class DNSResolver {
  /**
   * @param {any} os
   * @param {IPAddress|number|string|null} serverIp IPv4/IPv6 server address (legacy number allowed)
   * @param {object} [opts]
   * @param {number} [opts.port]
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.tries]
   * @param {boolean} [opts.cache]
   * @param {number} [opts.maxDepth]
   * @param {number} [opts.negativeCacheSec]
   * @param {number} [opts.maxCacheSec]
   */
  constructor(os, serverIp, opts = {}) {
    this.os = os;

    this.serverIp = this._toIPAddressOrNull(serverIp);
    // treat 0.0.0.0 as disabled
    if (this.serverIp && this.serverIp.isV4()) {
      const n = this.serverIp.getNumber();
      if (typeof n === "number" && (n >>> 0) === 0) this.serverIp = null;
    }

    this.port = Number.isFinite(opts.port) ? (opts.port | 0) : 53;

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

  /** @type {IPAddress|null} */ serverIp;
  /** @type {number} */ port;

  /** @type {number} */ timeoutMs;
  /** @type {number} */ tries;
  /** @type {boolean} */ cacheEnabled;
  /** @type {number} */ maxDepth;

  /** @type {number} */ negativeCacheSec;
  /** @type {number} */ maxCacheSec;

  /** @type {Map<string, {expiresAt:number, value:any}>} */
  _cache;

  /**
   * Backward-compatible: accept number/string/IPAddress.
   * Passing 0 / "0.0.0.0" / null disables resolver.
   * @param {IPAddress|number|string|null} server
   * @param {number} [port]
   */
  setServer(server, port) {
    const ip = this._toIPAddressOrNull(server);
    if (ip && ip.isV4()) {
      const n = ip.getNumber();
      if (typeof n === "number" && (n >>> 0) === 0) this.serverIp = null;
      else this.serverIp = ip;
    } else {
      this.serverIp = ip; // could be v6
    }

    if (port != null) this.port = port | 0;
    this._cache.clear();
  }

  // ---------------- public API ----------------

  /**
   * Convenience: resolve host to ONE IPv4 (legacy number). Returns null if not resolvable.
   * (Keeps your old API stable.)
   * @param {string} name
   * @returns {Promise<number|null>}
   */
  async resolve(name) {
    if (!this._isConfigured()) return null;
    const ips = await this.resolveA(name);
    return ips.length ? (ips[0] >>> 0) : null;
  }

  /**
   * Resolve A records as IPv4 numbers (legacy).
   * @param {string} name
   * @returns {Promise<number[]>}
   */
  async resolveA(name) {
    if (!this._isConfigured()) return [];
    const resp = await this._query(name, DNSPacket.TYPE_A);
    return this._extractAasNumbers(resp);
  }

  /**
   * NEW: resolve A records as IPAddress objects.
   * Useful once you migrate callers.
   * @param {string} name
   * @returns {Promise<IPAddress[]>}
   */
  async resolveA_IP(name) {
    const nums = await this.resolveA(name);
    return nums.map((n) => new IPAddress(4, n >>> 0));
  }

  /**
   * Resolve MX records.
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
    return this.serverIp instanceof IPAddress;
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
   * Convert legacy inputs into IPAddress (IPv4 only for numbers).
   * @param {any} v
   * @returns {IPAddress|null}
   */
  _toIPAddressOrNull(v) {
    try {
      if (v == null) return null;
      if (v instanceof IPAddress) return v;

      if (typeof v === "number" && Number.isFinite(v)) {
        return new IPAddress(4, (v >>> 0));
      }

      const s = String(v).trim();
      if (!s) return null;

      // allow "0" as disabled
      if (s === "0") return new IPAddress(4, 0);

      // IPAddress.fromString should accept v4/v6
      return IPAddress.fromString(s);
    } catch {
      return null;
    }
  }

  /**
   * Cache key includes target server+port.
   * @param {string} nameNorm
   * @param {number} qtype
   * @param {IPAddress} serverIp
   * @param {number} port
   */
  _cacheKey(nameNorm, qtype, serverIp, port) {
    // IMPORTANT: do NOT depend on legacy numbers anymore
    return `${nameNorm}|${qtype & 0xffff}|${serverIp.toString()}|${port | 0}`;
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

    // serverIp is guaranteed non-null here
    return this._queryRecursive(n, qtype & 0xffff, /** @type {IPAddress} */ (this.serverIp), this.port | 0, this.maxDepth, visited);
  }

  /**
   * NS-fallback recursion.
   * @param {string} nameNorm
   * @param {number} qtype
   * @param {IPAddress} serverIp
   * @param {number} port
   * @param {number} depth
   * @param {Set<string>} visited
   * @returns {Promise<DNSPacket|null>}
   */
  async _queryRecursive(nameNorm, qtype, serverIp, port, depth, visited) {
    if (depth <= 0) return null;

    const visitKey = `${nameNorm}|${qtype}|${serverIp.toString()}|${port}`;
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
        const sub = await this._queryRecursive(nameNorm, qtype, new IPAddress(4, nsIp >>> 0), port, depth - 1, visited);
        if (sub && ((sub.answers?.length ?? 0) > 0)) return sub;
      }
    }

    return resp;
  }

  /**
   * One UDP DNS request to specific server.
   * @param {string} nameNorm
   * @param {number} qtype
   * @param {IPAddress} serverIp
   * @param {number} port
   * @returns {Promise<DNSPacket|null>}
   */
  async _queryOnce(nameNorm, qtype, serverIp, port) {
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

    // bind 0.0.0.0 (v4) on ephemeral port
    const bindAny = IPAddress.fromString("0.0.0.0");

    const openEphemeral = () => {
      try {
        // let port 0 mean ephemeral if supported
        return net.openUDPSocket(bindAny, 0);
      } catch {
        for (let p = 49152; p <= 65535; p++) {
          try { return net.openUDPSocket(bindAny, p); } catch {}
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
      /** @type {{p: Promise<any>}} */
      const st = { p: net.recvUDPSocket(sock) };

      for (let attempt = 1; attempt <= this.tries; attempt++) {
        // IMPORTANT: sendUDPSocket expects IPAddress now
        net.sendUDPSocket(sock, serverIp, port | 0, payload);

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
   * @param {number} sock
   * @param {number} id
   * @param {number} deadlineMsReal
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

  _extractNSHosts(resp) {
    /** @type {string[]} */
    const out = [];
    for (const rr of (resp.authorities ?? [])) {
      if ((rr.type & 0xffff) !== DNSPacket.TYPE_NS) continue;
      if (typeof rr.data === "string" && rr.data.trim()) out.push(rr.data.trim());
    }
    return Array.from(new Set(out));
  }

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
