//@ts-check
import { IPAddress } from "./models/IPAddress.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";
import {
    BGP_PORT, BGP_MSG_OPEN, BGP_MSG_UPDATE, BGP_MSG_KEEPALIVE, BGP_MSG_NOTIFICATION,
    ERR_CEASE,
    buildOpen, buildKeepalive, buildUpdate, buildNotification,
    parseMessage, parseOpen, parseUpdate,
} from "./pdu/BGPPacket.js";

const BGP_DEFAULT_LP = 100;

// ── BGP session (one per configured peer) ─────────────────────────────────────

class BGPSession {
    /**
     * @param {BGPDaemon} daemon
     * @param {{ ip: string, remoteAS: number, description: string, passive: boolean }} cfg
     */
    constructor(daemon, cfg) {
        this._daemon = daemon;
        this.cfg = cfg;

        /** @type {"Idle"|"Connect"|"Active"|"OpenSent"|"OpenConfirm"|"Established"} */
        this.state = "Idle";
        /** @type {string|null} */
        this._connKey = null;
        /** @type {IPAddress|null} */
        this._localIP = null;
        /** @type {Uint8Array} */
        this._buf = new Uint8Array(0);

        this._running = false;
        /** @type {number|null} */
        this._keepaliveTimer = null;
        /** @type {number|null} */
        this._holdTimer = null;
        /** @type {number|null} */
        this._retryTimer = null;

        this._holdTime = SimTimer.BGP_HOLDTIME_MS;

        /** @type {number|null} timestamp (Date.now()) of Established */
        this.connectedAt = null;
        this.prefixesReceived = 0;

        /** Prefix keys (e.g. "10.6.0.0/24") announced to this peer as own connected routes. */
        /** @type {Set<string>} */
        this._announcedConnected = new Set();
    }

    start() {
        this._running = true;
        if (!this.cfg.passive) this._doConnect();
        else this.state = "Active"; // passive: wait for incoming connection
    }

    stop() {
        this._running = false;
        this._cancelTimers();
        if (this._connKey) {
            try { this._daemon._net.closeTCPConn(this._connKey); } catch {}
            this._connKey = null;
        }
        if (this.state === "Established") this._daemon._withdrawFromPeer(this.cfg.ip);
        this.state = "Idle";
        this.connectedAt = null;
        this._buf = new Uint8Array(0);
    }

    /**
     * Called by server accept loop when peer initiates the connection.
     * @param {string} key
     * @param {IPAddress} localIP
     */
    handleAccepted(key, localIP) {
        if (!this._running || (this.state !== "Idle" && this.state !== "Active")) {
            // Already busy or stopped — reject the incoming connection.
            try { this._daemon._net.closeTCPConn(key); } catch {}
            return;
        }
        this._connKey = key;
        this._localIP = localIP;
        void this._runSession();
    }

    // ── connect loop ───────────────────────────────────────────────────────

    async _doConnect() {
        // Only start if idle or waiting — never interrupt an active session.
        if (!this._running || (this.state !== "Idle" && this.state !== "Active")) return;
        this.state = "Connect";
        this._daemon._notify();
        try {
            const peerIP = IPAddress.fromString(this.cfg.ip);
            const sock   = await this._daemon._net.connectTCPConn(peerIP, BGP_PORT);
            // handleAccepted may have taken over while we were connecting.
            if (!this._running || this.state !== "Connect") {
                try { this._daemon._net.closeTCPConn(sock.key); } catch {}
                return;
            }
            this._connKey = sock.key;
            this._localIP = sock.localIP;
            await this._runSession();
        } catch {
            if (this._running && this.state === "Connect") this._scheduleRetry();
        }
    }

    _scheduleRetry() {
        if (!this._running) return;
        this.state = "Active";
        this._daemon._notify();
        this._retryTimer = simTimer.schedule(() => {
            this._retryTimer = null;
            if (this._running) this._doConnect();
        }, SimTimer.BGP_CONNECT_RETRY_MS);
    }

    // ── session ────────────────────────────────────────────────────────────

    async _runSession() {
        try {
            // ── OpenSent ──
            this.state = "OpenSent";
            this._daemon._notify();
            await this._sendOpen();

            let peerAS = 0;
            while (this.state === "OpenSent") {
                const msg = await this._readMsg();
                if (!msg) return;
                const parsed = parseMessage(msg);
                if (!parsed) return;
                if (parsed.type === BGP_MSG_OPEN) {
                    const od = parseOpen(parsed.body);
                    peerAS = od.myAS;
                    this._holdTime = Math.min(SimTimer.BGP_HOLDTIME_MS, od.holdTime > 0 ? od.holdTime : SimTimer.BGP_HOLDTIME_MS);
                    this.state = "OpenConfirm";
                } else if (parsed.type === BGP_MSG_NOTIFICATION) {
                    this._daemon._log(`[BGP] ${this.cfg.ip}: NOTIFICATION empfangen`);
                    return;
                }
            }

            // ── OpenConfirm ──
            this._daemon._notify();
            await this._sendKeepalive();

            while (this.state === "OpenConfirm") {
                const msg = await this._readMsg();
                if (!msg) return;
                const parsed = parseMessage(msg);
                if (!parsed) return;
                if (parsed.type === BGP_MSG_KEEPALIVE) {
                    this.state = "Established";
                } else if (parsed.type === BGP_MSG_NOTIFICATION) {
                    this._daemon._log(`[BGP] ${this.cfg.ip}: NOTIFICATION empfangen`);
                    return;
                }
            }

            // ── Established ──
            this.connectedAt = Date.now();
            this.prefixesReceived = 0;
            this._daemon._log(`[BGP] ${this.cfg.ip}: Established (Peer-AS ${peerAS})`);
            this._daemon._notify();

            this._scheduleKeepalive();
            if (this._holdTime > 0) this._resetHoldTimer();

            await this._sendInitialUpdate();
            this._daemon._sendLearnedRoutesToSession(this);

            while (this._running && this.state === "Established") {
                const msg = await this._readMsg();
                if (!msg) break;
                const parsed = parseMessage(msg);
                if (!parsed) break;
                if (parsed.type === BGP_MSG_UPDATE) {
                    this._handleUpdate(parsed.body);
                    if (this._holdTime > 0) this._resetHoldTimer();
                } else if (parsed.type === BGP_MSG_KEEPALIVE) {
                    if (this._holdTime > 0) this._resetHoldTimer();
                } else if (parsed.type === BGP_MSG_NOTIFICATION) {
                    this._handleNotification(parsed.body);
                    break;
                }
            }
        } finally {
            this._sessionEnd();
        }
    }

    _sessionEnd() {
        this._cancelTimers();
        if (this._connKey) {
            try { this._daemon._net.closeTCPConn(this._connKey); } catch {}
            this._connKey = null;
        }
        if (this.state === "Established") {
            this._daemon._log(`[BGP] ${this.cfg.ip}: Session beendet`);
            this._daemon._withdrawFromPeer(this.cfg.ip);
        }
        this.state = "Idle";
        this.connectedAt = null;
        this._buf = new Uint8Array(0);
        this._localIP = null;
        this._announcedConnected = new Set();
        this._daemon._notify();
        if (this._running && !this.cfg.passive) this._scheduleRetry();
    }

    // ── send helpers ───────────────────────────────────────────────────────

    async _sendOpen() {
        const rid = this._daemon._routerIdIP();
        const msg = buildOpen(this._daemon.localAS, SimTimer.BGP_HOLDTIME_MS, rid);
        this._daemon._net.sendTCPConn(this._connKey, msg);
    }

    async _sendKeepalive() {
        this._daemon._net.sendTCPConn(this._connKey, buildKeepalive());
    }

    async _sendInitialUpdate() {
        if (!this._localIP || !this._connKey) return;
        const prefixes = this._daemon._connectedPrefixes();
        this._announcedConnected = new Set(prefixes.map(p => `${p.dst}/${p.prefLen}`));
        if (prefixes.length === 0) return;
        const localIPv6 = this._daemon._localIPv6For(this._localIP);
        this._daemon._sendFamilyUpdate(
            this._connKey, this._localIP, localIPv6,
            [this._daemon.localAS], prefixes, [],
        );
        this._daemon._log(`[BGP] ${this.cfg.ip}: ${prefixes.length} Präfixe gesendet`);
    }

    _checkConnectedPrefixes() {
        if (this.state !== "Established" || !this._connKey || !this._localIP) return;

        const current = this._daemon._connectedPrefixes();
        const currentKeys = new Set(current.map(p => `${p.dst}/${p.prefLen}`));

        const toAnnounce = current.filter(p => !this._announcedConnected.has(`${p.dst}/${p.prefLen}`));
        const toWithdraw = [...this._announcedConnected]
            .filter(k => !currentKeys.has(k))
            .map(k => {
                const slash = k.lastIndexOf("/");
                return { dst: IPAddress.fromString(k.slice(0, slash)), prefLen: Number(k.slice(slash + 1)) };
            });

        if (toAnnounce.length === 0 && toWithdraw.length === 0) return;

        const localIPv6 = this._daemon._localIPv6For(this._localIP);
        this._daemon._sendFamilyUpdate(
            /** @type {string} */ (this._connKey), this._localIP, localIPv6,
            [this._daemon.localAS], toAnnounce, toWithdraw,
        );

        for (const p of toAnnounce) this._announcedConnected.add(`${p.dst}/${p.prefLen}`);
        for (const p of toWithdraw) this._announcedConnected.delete(`${p.dst}/${p.prefLen}`);

        if (toAnnounce.length) this._daemon._log(`[BGP] ${this.cfg.ip}: +${toAnnounce.length} neue Präfixe angekündigt`);
        if (toWithdraw.length) this._daemon._log(`[BGP] ${this.cfg.ip}: -${toWithdraw.length} Präfixe zurückgezogen`);
    }

    // ── receive helpers ────────────────────────────────────────────────────

    /** Accumulate TCP stream into _buf, return next complete BGP message. */
    async _readMsg() {
        while (this._running) {
            if (this._buf.length >= 19) {
                const totalLen = (this._buf[16] << 8) | this._buf[17];
                if (totalLen >= 19 && totalLen <= 4096 && this._buf.length >= totalLen) {
                    const msg = this._buf.slice(0, totalLen);
                    this._buf = this._buf.slice(totalLen);
                    return msg;
                }
            }
            let chunk = null;
            try { chunk = await this._daemon._net.recvTCPConn(/** @type {string} */(this._connKey)); } catch { break; }
            if (!chunk) break;
            const merged = new Uint8Array(this._buf.length + chunk.length);
            merged.set(this._buf);
            merged.set(chunk, this._buf.length);
            this._buf = merged;
        }
        return null;
    }

    // ── incoming message handlers ──────────────────────────────────────────

    /** @param {Uint8Array} body */
    _handleUpdate(body) {
        const { withdrawn, attrs, nlri } = parseUpdate(body);
        const fallbackIP = this._localIP ?? IPAddress.fromString("0.0.0.0");
        const ifIdx = this._daemon._ifIndexFor(fallbackIP);

        // IPv4 withdrawals (traditional withdrawn-routes field)
        if (withdrawn.length > 0) {
            this._daemon._withdrawPrefixes(withdrawn, this.cfg.ip);
        }

        // IPv4 NLRI (traditional path)
        if (nlri.length > 0 && attrs.nextHop) {
            if (!attrs.asPath.includes(this._daemon.localAS)) {
                this._daemon._learnPrefixes(nlri, attrs, this.cfg.ip, ifIdx);
                this.prefixesReceived += nlri.length;
                this._daemon._notify();
            }
        }

        // IPv6 withdrawals via MP_UNREACH_NLRI (RFC 4760 §4)
        if (attrs.mp6Unreach.length > 0) {
            this._daemon._withdrawPrefixes(attrs.mp6Unreach, this.cfg.ip);
        }

        // IPv6 NLRI via MP_REACH_NLRI (RFC 4760 §3)
        if (attrs.mp6Reach != null && attrs.mp6Reach.nlri.length > 0) {
            if (!attrs.asPath.includes(this._daemon.localAS)) {
                const attrs6 = { ...attrs, nextHop: attrs.mp6Reach.nextHop };
                this._daemon._learnPrefixes(attrs.mp6Reach.nlri, attrs6, this.cfg.ip, ifIdx);
                this.prefixesReceived += attrs.mp6Reach.nlri.length;
                this._daemon._notify();
            }
        }
    }

    /** @param {Uint8Array} body */
    _handleNotification(body) {
        const code    = body[0] ?? 0;
        const subcode = body[1] ?? 0;
        this._daemon._log(`[BGP] ${this.cfg.ip}: NOTIFICATION code=${code} sub=${subcode}`);
    }

    // ── timers ─────────────────────────────────────────────────────────────

    _scheduleKeepalive() {
        if (this._keepaliveTimer != null) simTimer.cancel(this._keepaliveTimer);
        this._keepaliveTimer = simTimer.schedule(() => {
            this._keepaliveTimer = null;
            if (this.state === "Established" && this._connKey) {
                try { this._daemon._net.sendTCPConn(this._connKey, buildKeepalive()); } catch {}
                this._checkConnectedPrefixes();
                this._scheduleKeepalive();
            }
        }, SimTimer.BGP_KEEPALIVE_MS);
    }

    _resetHoldTimer() {
        if (this._holdTimer != null) simTimer.cancel(this._holdTimer);
        this._holdTimer = simTimer.schedule(() => {
            this._holdTimer = null;
            this._daemon._log(`[BGP] ${this.cfg.ip}: Hold Timer abgelaufen — Session beendet`);
            if (this._connKey) {
                try { this._daemon._net.sendTCPConn(this._connKey, buildNotification(ERR_CEASE, 0)); } catch {}
            }
            this._sessionEnd();
        }, this._holdTime);
    }

    _cancelTimers() {
        if (this._keepaliveTimer != null) { simTimer.cancel(this._keepaliveTimer); this._keepaliveTimer = null; }
        if (this._holdTimer      != null) { simTimer.cancel(this._holdTimer);      this._holdTimer      = null; }
        if (this._retryTimer     != null) { simTimer.cancel(this._retryTimer);     this._retryTimer     = null; }
    }
}

// ── BGPDaemon ─────────────────────────────────────────────────────────────────

export class BGPDaemon {
    /**
     * @param {import("./IPStack.js").IPStack} net
     */
    constructor(net) {
        this._net = net;

        this.enabled  = false;
        this.localAS  = 0;
        /** @type {string} Router-ID as dotted-decimal string */
        this.routerId = "";

        /**
         * @type {Array<{ ip: string, remoteAS: number, description: string, passive: boolean }>}
         */
        this.peers = [];

        /** @type {Map<string, BGPSession>} keyed by peer IP string */
        this._sessions = new Map();

        /**
         * Adj-RIB-In: ALL received routes, key = "dst/prefLen|fromPeer".
         * Kept even when not the best path so failover works.
         * @type {Map<string, {
         *   dst: IPAddress, prefLen: number,
         *   nexthop: IPAddress, asPath: number[],
         *   localPref: number, med: number,
         *   fromPeer: string, ifIndex: number,
         * }>}
         */
        this._adjRibIn = new Map();

        /**
         * Loc-RIB (best routes only): key = "dst/prefLen"
         * @type {Map<string, {
         *   dst: IPAddress, prefLen: number,
         *   nexthop: IPAddress, asPath: number[],
         *   localPref: number, med: number,
         *   fromPeer: string, ifIndex: number,
         * }>}
         */
        this._learned = new Map();

        /** @type {number|null} */
        this._serverPort = null;

        this._running = false;

        /** @type {string[]} */
        this.log = [];

        /** @type {(() => void)|null} */
        this.onUpdate = null;
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    start() {
        if (this._running) return;
        if (!this.localAS) { this._log("[BGP] Kein AS konfiguriert — Start abgebrochen"); return; }
        this._running = true;

        try {
            this._serverPort = this._net.openTCPServerSocket(IPAddress.fromString("0.0.0.0"), BGP_PORT);
            void this._acceptLoop();
            this._log(`[BGP] gestartet (AS ${this.localAS}, Router-ID ${this._routerIdStr()})`);
        } catch (e) {
            this._log(`[BGP] Start fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
            this._running = false;
            return;
        }

        for (const cfg of this.peers) this._startSession(cfg);
    }

    stop() {
        if (!this._running && this._serverPort == null) return;
        this._running = false;

        for (const s of this._sessions.values()) s.stop();
        this._sessions.clear();

        if (this._serverPort != null) {
            try { this._net.closeTCPServerSocket(this._serverPort); } catch {}
            this._serverPort = null;
        }

        this._clearLearnedRoutes();
        this._log("[BGP] gestoppt");
        this._notify();
    }

    /** @param {boolean} v */
    setEnabled(v) {
        this.enabled = v;
        if (v) this.start(); else this.stop();
    }

    // ── peer management ────────────────────────────────────────────────────

    /**
     * @param {{ ip: string, remoteAS: number, description?: string, passive?: boolean }} cfg
     */
    addPeer(cfg) {
        const peer = { ip: cfg.ip, remoteAS: cfg.remoteAS, description: cfg.description ?? "", passive: cfg.passive ?? false };
        if (this.peers.some(p => p.ip === peer.ip)) return;
        this.peers.push(peer);
        if (this._running) this._startSession(peer);
        this._notify();
    }

    /** @param {string} ip */
    removePeer(ip) {
        this.peers = this.peers.filter(p => p.ip !== ip);
        const s = this._sessions.get(ip);
        if (s) { s.stop(); this._sessions.delete(ip); }
        this._withdrawFromPeer(ip);
        this._notify();
    }

    /** @param {string} ip @returns {BGPSession|undefined} */
    getSession(ip) { return this._sessions.get(ip); }

    // ── route management (called by sessions) ─────────────────────────────

    /**
     * @param {Array<{dst: IPAddress, prefLen: number}>} prefixes
     * @param {{ asPath: number[], nextHop: IPAddress|null, localPref: number, med: number }} attrs
     * @param {string} fromPeer
     * @param {number} ifIndex
     */
    _learnPrefixes(prefixes, attrs, fromPeer, ifIndex) {
        for (const { dst, prefLen } of prefixes) {
            const key = `${dst}/${prefLen}`;
            const nexthop = attrs.nextHop ?? (dst.isV6() ? IPAddress.fromString("::") : IPAddress.fromString("0.0.0.0"));
            const entry = { dst, prefLen, nexthop, asPath: attrs.asPath, localPref: attrs.localPref, med: attrs.med, fromPeer, ifIndex };
            this._adjRibIn.set(`${key}|${fromPeer}`, entry);
            this._updateBestRoute(key, dst, prefLen, fromPeer);
        }
    }

    /**
     * @param {Array<{dst: IPAddress, prefLen: number}>} prefixes
     * @param {string} fromPeer
     */
    _withdrawPrefixes(prefixes, fromPeer) {
        for (const { dst, prefLen } of prefixes) {
            const key = `${dst}/${prefLen}`;
            if (!this._adjRibIn.has(`${key}|${fromPeer}`)) continue;
            this._adjRibIn.delete(`${key}|${fromPeer}`);
            this._updateBestRoute(key, dst, prefLen, fromPeer);
        }
    }

    /** @param {string} peerIp */
    _withdrawFromPeer(peerIp) {
        const suffix = `|${peerIp}`;
        /** @type {Array<[string, IPAddress, number]>} [key, dst, prefLen] */
        const affected = [];
        for (const [ribKey, entry] of this._adjRibIn) {
            if (!ribKey.endsWith(suffix)) continue;
            affected.push([ribKey.slice(0, -suffix.length), entry.dst, entry.prefLen]);
        }
        for (const [key, dst, prefLen] of affected) {
            this._adjRibIn.delete(`${key}|${peerIp}`);
            this._updateBestRoute(key, dst, prefLen, peerIp);
        }
    }

    /**
     * Returns the best (shortest AS-PATH) route for a prefix key from adjRibIn,
     * or null if none exists.
     * @param {string} key  "dst/prefLen"
     */
    _bestForPrefix(key) {
        const prefix = `${key}|`;
        let best = null;
        for (const [ribKey, entry] of this._adjRibIn) {
            if (!ribKey.startsWith(prefix)) continue;
            if (!best || entry.asPath.length < best.asPath.length) best = entry;
        }
        return best;
    }

    /**
     * Recalculate and apply the best route for a prefix after adjRibIn changed.
     * Updates routing table and propagates changes to peers.
     * @param {string} key          "dst/prefLen"
     * @param {IPAddress} dst
     * @param {number} prefLen
     * @param {string} changedPeer  peer whose entry triggered this call
     */
    _updateBestRoute(key, dst, prefLen, changedPeer) {
        const oldBest = this._learned.get(key) ?? null;
        const newBest = this._bestForPrefix(key);

        if (!newBest) {
            // No routes left → withdraw
            if (oldBest) {
                try { this._net.delRoute(oldBest.dst, oldBest.prefLen, oldBest.ifIndex, oldBest.nexthop); } catch {}
                this._learned.delete(key);
                this._log(`[BGP] zurückgezogen ${key}`);
                this._propagateWithdrawal(dst, prefLen, changedPeer);
            }
            return;
        }

        if (!oldBest) {
            // Completely new prefix
            this._learned.set(key, newBest);
            try { this._net.addRoute(dst, prefLen, newBest.ifIndex, newBest.nexthop, "bgp"); } catch {}
            this._log(`[BGP] gelernt ${key} via ${newBest.nexthop} AS-Pfad [${newBest.asPath.join(" ")}]`);
            this._propagateLearnedRoute(newBest, newBest.fromPeer);
            return;
        }

        if (newBest.fromPeer !== oldBest.fromPeer) {
            // Failover: best path switched to a different peer
            try { this._net.delRoute(oldBest.dst, oldBest.prefLen, oldBest.ifIndex, oldBest.nexthop); } catch {}
            this._learned.set(key, newBest);
            try { this._net.addRoute(dst, prefLen, newBest.ifIndex, newBest.nexthop, "bgp"); } catch {}
            this._log(`[BGP] Pfadwechsel ${key} → via ${newBest.nexthop} [${newBest.asPath.join(" ")}]`);
            this._propagateLearnedRoute(newBest, newBest.fromPeer);
            return;
        }

        // Same best peer — re-propagate only if that peer sent the update
        if (changedPeer === oldBest.fromPeer) {
            this._learned.set(key, newBest);
            this._propagateLearnedRoute(newBest, newBest.fromPeer);
        }
        // else: non-best peer update, stored in adjRibIn as backup only
    }

    /**
     * Re-advertise a newly learned route to all other established peers.
     * @param {{ dst: IPAddress, prefLen: number, asPath: number[], localPref: number, med: number }} entry
     * @param {string} fromPeer
     */
    _propagateLearnedRoute(entry, fromPeer) {
        const asPath = [this.localAS, ...entry.asPath];
        const prefix = [{ dst: entry.dst, prefLen: entry.prefLen }];
        for (const [peerIp, session] of this._sessions) {
            if (peerIp === fromPeer) continue;
            if (session.state !== "Established" || !session._localIP || !session._connKey) continue;
            const localIPv6 = this._localIPv6For(session._localIP);
            this._sendFamilyUpdate(session._connKey, session._localIP, localIPv6, asPath, prefix, []);
            this._log(`[BGP] ${entry.dst}/${entry.prefLen} propagiert → ${peerIp}`);
        }
    }

    /**
     * Send withdrawal for a prefix to all other established peers.
     * @param {IPAddress} dst
     * @param {number} prefLen
     * @param {string} fromPeer
     */
    _propagateWithdrawal(dst, prefLen, fromPeer) {
        const prefix = [{ dst, prefLen }];
        for (const [peerIp, session] of this._sessions) {
            if (peerIp === fromPeer) continue;
            if (session.state !== "Established" || !session._localIP || !session._connKey) continue;
            const localIPv6 = this._localIPv6For(session._localIP);
            this._sendFamilyUpdate(session._connKey, session._localIP, localIPv6, [], [], prefix);
        }
    }

    /**
     * Send all currently learned routes (except those from this peer) to a
     * newly Established session.
     * @param {BGPSession} session
     */
    _sendLearnedRoutesToSession(session) {
        if (!session._localIP || !session._connKey) return;
        const localIPv6 = this._localIPv6For(session._localIP);
        let sent = 0;
        for (const entry of this._learned.values()) {
            if (entry.fromPeer === session.cfg.ip) continue;
            if (entry.asPath.includes(this.localAS)) continue;
            const asPath = [this.localAS, ...entry.asPath];
            this._sendFamilyUpdate(
                /** @type {string} */ (session._connKey), session._localIP, localIPv6,
                asPath, [{ dst: entry.dst, prefLen: entry.prefLen }], [],
            );
            sent++;
        }
        if (sent > 0) this._log(`[BGP] ${session.cfg.ip}: ${sent} gelernte Routen gesendet`);
    }

    /**
     * Partition prefixes by address family and send the appropriate UPDATE message(s).
     * IPv4 uses the traditional PA_NEXT_HOP + NLRI wire format.
     * IPv6 uses MP_REACH_NLRI / MP_UNREACH_NLRI (RFC 4760).
     * @param {string} connKey
     * @param {IPAddress} localIPv4
     * @param {IPAddress|null} localIPv6
     * @param {number[]} asPath
     * @param {Array<{dst: IPAddress, prefLen: number}>} toAnnounce
     * @param {Array<{dst: IPAddress, prefLen: number}>} toWithdraw
     */
    _sendFamilyUpdate(connKey, localIPv4, localIPv6, asPath, toAnnounce, toWithdraw) {
        const v4Ann = toAnnounce.filter(p => p.dst.isV4());
        const v6Ann = toAnnounce.filter(p => p.dst.isV6());
        const v4Wdr = toWithdraw.filter(p => p.dst.isV4());
        const v6Wdr = toWithdraw.filter(p => p.dst.isV6());

        if (v4Ann.length > 0 || v4Wdr.length > 0) {
            const msg = buildUpdate({
                withdrawn: v4Wdr,
                nextHop: localIPv4,
                asPath, localPref: BGP_DEFAULT_LP, med: 0,
                nlri: v4Ann,
            });
            try { this._net.sendTCPConn(connKey, msg); } catch {}
        }

        if ((v6Ann.length > 0 || v6Wdr.length > 0) && localIPv6) {
            const msg = buildUpdate({
                withdrawn: [],
                nextHop: localIPv4,
                asPath, localPref: BGP_DEFAULT_LP, med: 0,
                nlri: [],
                mp6Reach:   v6Ann.length > 0 ? { nextHop: localIPv6, nlri: v6Ann } : undefined,
                mp6Unreach: v6Wdr.length > 0 ? v6Wdr : undefined,
            });
            try { this._net.sendTCPConn(connKey, msg); } catch {}
        }
    }

    _clearLearnedRoutes() {
        for (const entry of this._learned.values()) {
            try { this._net.delRoute(entry.dst, entry.prefLen, entry.ifIndex, entry.nexthop); } catch {}
        }
        this._learned.clear();
        this._adjRibIn.clear();
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /** @returns {Array<{dst: IPAddress, prefLen: number}>} */
    _connectedPrefixes() {
        const result = [];
        for (const iface of this._net.interfaces) {
            // IPv4
            if (iface.ip?.isV4()) {
                const ip32 = iface.ip.toUInt8();
                if (ip32[0] !== 0 && ip32[0] !== 127) {
                    const prefLen = iface.prefixLength;
                    if (prefLen) {
                        const netBytes = new Uint8Array(4);
                        const octets = Math.ceil(prefLen / 8);
                        for (let i = 0; i < 4; i++) {
                            if (i < octets - 1) netBytes[i] = ip32[i];
                            else if (i === octets - 1) netBytes[i] = ip32[i] & ((0xff << (8 - (prefLen % 8 || 8))) & 0xff);
                        }
                        result.push({ dst: IPAddress.fromUInt8(netBytes), prefLen });
                    }
                }
            }
            // IPv6 — global unicast only (exclude loopback ::1 and link-local fe80::/10)
            if (iface.ip6?.isV6()) {
                const ip6 = iface.ip6.toUInt8();
                const isLoopback  = ip6.slice(0, 15).every(b => b === 0) && ip6[15] === 1;
                const isLinkLocal = ip6[0] === 0xfe && (ip6[1] & 0xc0) === 0x80;
                if (!isLoopback && !isLinkLocal) {
                    const prefLen = iface.prefixLength6;
                    if (prefLen) {
                        const netBytes = new Uint8Array(16);
                        let rem = prefLen;
                        for (let i = 0; i < 16; i++) {
                            if (rem >= 8)     { netBytes[i] = ip6[i]; rem -= 8; }
                            else if (rem > 0) { netBytes[i] = ip6[i] & ((0xff << (8 - rem)) & 0xff); rem = 0; }
                        }
                        result.push({ dst: IPAddress.fromUInt8(netBytes), prefLen });
                    }
                }
            }
        }
        return result;
    }

    /**
     * Returns the IPv6 global unicast address of the interface that holds the given IPv4 address,
     * or null if the interface has no IPv6 address. Used to find the MP_REACH_NLRI next-hop.
     * @param {IPAddress} localIPv4
     * @returns {IPAddress|null}
     */
    _localIPv6For(localIPv4) {
        const s = localIPv4.toString();
        for (const iface of this._net.interfaces) {
            if (iface.ip?.toString() === s) return iface.ip6 ?? null;
        }
        return null;
    }

    /** @param {IPAddress} localIP @returns {number} */
    _ifIndexFor(localIP) {
        const s = localIP.toString();
        for (let i = 0; i < this._net.interfaces.length; i++) {
            if (this._net.interfaces[i].ip?.toString() === s) return i;
        }
        return 0;
    }

    /** @returns {IPAddress} */
    _routerIdIP() {
        if (this.routerId) {
            try { return IPAddress.fromString(this.routerId); } catch {}
        }
        for (const iface of this._net.interfaces) {
            if (iface.ip?.isV4()) {
                const b = iface.ip.toUInt8();
                if (b[0] !== 0 && b[0] !== 127) return iface.ip;
            }
        }
        return IPAddress.fromString("0.0.0.1");
    }

    /** @returns {string} */
    _routerIdStr() {
        return this.routerId || this._routerIdIP().toString();
    }

    // ── server accept loop ─────────────────────────────────────────────────

    async _acceptLoop() {
        while (this._running && this._serverPort != null) {
            let key = null;
            try { key = await this._net.acceptTCPConn(this._serverPort); } catch { break; }
            if (!key) break;

            const info = this._net.getTCPConnInfo(key);
            if (!info) { try { this._net.closeTCPConn(key); } catch {} continue; }

            const peerStr = info.peerIP.toString();
            const session = this._sessions.get(peerStr);
            if (!session) {
                this._log(`[BGP] Unbekannter Peer ${peerStr} — abgewiesen`);
                try { this._net.closeTCPConn(key); } catch {}
                continue;
            }
            session.handleAccepted(key, info.localIP);
        }
    }

    // ── session management ─────────────────────────────────────────────────

    /** @param {{ ip: string, remoteAS: number, description: string, passive: boolean }} cfg */
    _startSession(cfg) {
        if (this._sessions.has(cfg.ip)) return;
        const s = new BGPSession(this, cfg);
        this._sessions.set(cfg.ip, s);
        s.start();
    }

    // ── log / notify ───────────────────────────────────────────────────────

    /** @param {string} line */
    _log(line) {
        const now = new Date().toLocaleTimeString();
        this.log.push(`[${now}] ${line}`);
        if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
        this.onUpdate?.();
    }

    _notify() { this.onUpdate?.(); }

    // ── persistence ────────────────────────────────────────────────────────

    toJSON() {
        return {
            enabled:  this.enabled,
            localAS:  this.localAS,
            routerId: this.routerId,
            peers:    this.peers.map(p => ({ ...p })),
        };
    }

    /** @param {any} d */
    applyJSON(d) {
        if (!d) return;
        this.localAS  = Number(d.localAS)  || 0;
        this.routerId = String(d.routerId  || "");
        this.peers    = Array.isArray(d.peers) ? d.peers.map((/** @type {any} */ p) => ({
            ip: String(p.ip || ""), remoteAS: Number(p.remoteAS) || 0,
            description: String(p.description || ""), passive: !!p.passive,
        })) : [];
        this.enabled  = !!d.enabled;
        if (this.enabled) this.start();
    }
}
