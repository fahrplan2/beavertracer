//@ts-check

/**
 * Signaling service for the WebRTC bridge between two BeaverTracer instances.
 *
 * It only passes on the two messages WebRTC needs (offer A→B, answer B→A),
 * keyed by a short room code; the simulation traffic itself never touches it.
 * Everything lives in memory, rooms vanish after use or after roomTtlMs, and
 * nothing is logged (no IPs, no SDP).
 *
 * Runs behind the nginx of www.beavertracer.eu at /signal/ (same origin as the
 * page, hence no CORS). No dependencies — plain node:http.
 *
 * API (all JSON, prefix /signal optional):
 *   GET    /health                 → { ok, rooms, reports }
 *   GET    /ice                    → { iceServers } (STUN, TURN with short-lived credentials)
 *   POST   /rooms   { offer }      → 201 { code, token, expiresIn }        (host)
 *   POST   /rooms/:code/join       → 200 { offer, token }                  (guest, only once)
 *   POST   /rooms/:code/answer { answer }  X-Room-Token: guest token → 204
 *   GET    /rooms/:code/answer     X-Room-Token: host token  → 200 { answer } | 204 (poll again)
 *   DELETE /rooms/:code            X-Room-Token: host token  → 204
 *   POST   /report  { result: "connected"|"failed" } → 204 (anonymous counter)
 */

import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{
 *   code: string,
 *   offer: string,
 *   hostToken: string,
 *   guestToken: string|null,
 *   answer: string|null,
 *   expiresAt: number,
 *   waiters: Set<http.ServerResponse>,
 * }} Room
 *
 * @typedef {{
 *   roomTtlMs: number,
 *   pollMs: number,
 *   maxRooms: number,
 *   maxBodyBytes: number,
 *   maxBlobChars: number,
 *   requestsPerMinute: number,
 *   joinMissesPerMinute: number,
 *   stunUrls: string[],
 *   turnUrls: string[],
 *   turnSecret: string,
 *   turnTtlSec: number,
 *   now: () => number,
 * }} SignalOptions
 */

/** @type {SignalOptions} */
export const DEFAULTS = {
    roomTtlMs: 5 * 60_000,
    pollMs: 25_000,
    maxRooms: 1000,
    maxBodyBytes: 7168,
    maxBlobChars: 6000,
    requestsPerMinute: 60,
    joinMissesPerMinute: 10,
    stunUrls: [],
    turnUrls: [],
    turnSecret: "",
    turnTtlSec: 3600,
    now: () => Date.now(),
};

/** SDP (full or reduced) is plain printable ASCII plus line breaks. */
const BLOB_RE = /^[\x20-\x7e\r\n]+$/;
const CODE_RE = /^\d{6}$/;

/**
 * @param {Partial<SignalOptions>} [opts]
 */
export function createSignalServer(opts = {}) {
    /** @type {SignalOptions} */
    const o = { ...DEFAULTS, ...opts };

    /** @type {Map<string, Room>} */
    const rooms = new Map();

    /** Per-IP fixed-window counters; kept at most one minute, never written anywhere. */
    /** @type {Map<string, { resetAt: number, requests: number, joinMisses: number }>} */
    const buckets = new Map();

    const reports = { connected: 0, failed: 0 };

    // ── helpers ──────────────────────────────────────────────────────────────

    /** @param {http.IncomingMessage} req */
    function clientIp(req) {
        const addr = req.socket.remoteAddress ?? "";
        // Behind NPM → local nginx, every connection comes from loopback; the
        // real address is in X-Real-IP. Only trust it from there.
        const loopback = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
        const hdr = req.headers["x-real-ip"];
        if (loopback && typeof hdr === "string" && hdr.trim()) return hdr.trim();
        return addr;
    }

    /** @param {string} ip */
    function bucket(ip) {
        const now = o.now();
        let b = buckets.get(ip);
        if (!b || b.resetAt <= now) {
            b = { resetAt: now + 60_000, requests: 0, joinMisses: 0 };
            buckets.set(ip, b);
        }
        return b;
    }

    /**
     * @param {http.ServerResponse} res
     * @param {number} status
     * @param {any} [body]
     */
    function send(res, status, body) {
        if (res.headersSent) return;
        const headers = {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        };
        if (body === undefined) {
            res.writeHead(status, headers);
            res.end();
        } else {
            res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(body));
        }
    }

    /**
     * @param {http.IncomingMessage} req
     * @returns {Promise<any>} parsed JSON, or a string error code
     */
    function readJson(req) {
        return new Promise((resolve) => {
            /** @type {Buffer[]} */
            const chunks = [];
            let size = 0;
            let done = false;
            req.on("data", (/** @type {Buffer} */ c) => {
                if (done) return;
                size += c.length;
                if (size > o.maxBodyBytes) {
                    done = true;
                    resolve("too_large");
                    req.resume();
                    return;
                }
                chunks.push(c);
            });
            req.on("end", () => {
                if (done) return;
                done = true;
                try {
                    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
                    resolve(v && typeof v === "object" ? v : "bad_json");
                } catch {
                    resolve("bad_json");
                }
            });
            req.on("error", () => { if (!done) { done = true; resolve("bad_json"); } });
        });
    }

    /** @param {unknown} s */
    function validBlob(s) {
        return typeof s === "string" && s.length <= o.maxBlobChars && BLOB_RE.test(s);
    }

    /** @param {string|null} expected @param {unknown} given */
    function tokenOk(expected, given) {
        if (!expected || typeof given !== "string") return false;
        const a = Buffer.from(expected);
        const b = Buffer.from(given);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    function newCode() {
        for (let i = 0; i < 50; i++) {
            const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
            if (!rooms.has(code)) return code;
        }
        return null;
    }

    /** @param {Room} room @param {number} status @param {any} [body] */
    function flushWaiters(room, status, body) {
        for (const w of room.waiters) send(w, status, body);
        room.waiters.clear();
    }

    /** @param {string} code */
    function liveRoom(code) {
        const room = rooms.get(code);
        if (!room) return null;
        if (room.expiresAt <= o.now()) {
            dropRoom(room);
            return null;
        }
        return room;
    }

    /** @param {Room} room */
    function dropRoom(room) {
        rooms.delete(room.code);
        flushWaiters(room, 404, { error: "gone" });
    }

    function iceServers() {
        /** @type {any[]} */
        const list = [];
        if (o.stunUrls.length) list.push({ urls: o.stunUrls });
        if (o.turnUrls.length && o.turnSecret) {
            // coturn "use-auth-secret" (TURN REST API): username = expiry, password = HMAC.
            const expiry = Math.floor(o.now() / 1000) + o.turnTtlSec;
            const username = `${expiry}:bt`;
            const credential = crypto.createHmac("sha1", o.turnSecret).update(username).digest("base64");
            list.push({ urls: o.turnUrls, username, credential });
        }
        return list;
    }

    // ── routes ───────────────────────────────────────────────────────────────

    /**
     * @param {http.IncomingMessage} req
     * @param {http.ServerResponse} res
     */
    async function handle(req, res) {
        const url = new URL(req.url ?? "/", "http://x");
        const path = url.pathname.replace(/^\/signal(?=\/|$)/, "").replace(/\/+$/, "") || "/";
        const method = req.method ?? "GET";

        if (method === "GET" && path === "/health") {
            return send(res, 200, { ok: true, rooms: rooms.size, reports });
        }

        const b = bucket(clientIp(req));
        if (++b.requests > o.requestsPerMinute) {
            res.setHeader("Retry-After", String(Math.ceil((b.resetAt - o.now()) / 1000)));
            return send(res, 429, { error: "rate_limited" });
        }

        if (method === "GET" && path === "/ice") {
            return send(res, 200, { iceServers: iceServers() });
        }

        if (method === "POST" && path === "/report") {
            const body = await readJson(req);
            if (typeof body === "string") return send(res, 400, { error: body });
            if (body.result === "connected" || body.result === "failed") reports[body.result]++;
            return send(res, 204);
        }

        if (method === "POST" && path === "/rooms") {
            const body = await readJson(req);
            if (body === "too_large") return send(res, 413, { error: body });
            if (typeof body === "string" || !validBlob(body.offer)) return send(res, 400, { error: "bad_offer" });
            if (rooms.size >= o.maxRooms) return send(res, 503, { error: "full" });
            const code = newCode();
            if (!code) return send(res, 503, { error: "full" });
            /** @type {Room} */
            const room = {
                code,
                offer: body.offer,
                hostToken: crypto.randomBytes(16).toString("base64url"),
                guestToken: null,
                answer: null,
                expiresAt: o.now() + o.roomTtlMs,
                waiters: new Set(),
            };
            rooms.set(code, room);
            return send(res, 201, { code, token: room.hostToken, expiresIn: Math.round(o.roomTtlMs / 1000) });
        }

        const m = path.match(/^\/rooms\/([^/]+)(\/join|\/answer)?$/);
        if (!m) return send(res, 404, { error: "not_found" });
        const code = m[1];
        const sub = m[2] ?? "";
        if (!CODE_RE.test(code)) return send(res, 404, { error: "unknown_room" });
        const token = req.headers["x-room-token"];

        if (method === "POST" && sub === "/join") {
            const room = liveRoom(code);
            if (!room) {
                // Separate, tighter budget for wrong codes — makes guessing pointless.
                if (++b.joinMisses > o.joinMissesPerMinute) return send(res, 429, { error: "rate_limited" });
                return send(res, 404, { error: "unknown_room" });
            }
            if (room.guestToken) return send(res, 409, { error: "taken" });
            room.guestToken = crypto.randomBytes(16).toString("base64url");
            return send(res, 200, { offer: room.offer, token: room.guestToken });
        }

        if (method === "POST" && sub === "/answer") {
            const room = liveRoom(code);
            if (!room) return send(res, 404, { error: "unknown_room" });
            if (!tokenOk(room.guestToken, token)) return send(res, 403, { error: "forbidden" });
            if (room.answer) return send(res, 409, { error: "answered" });
            const body = await readJson(req);
            if (body === "too_large") return send(res, 413, { error: body });
            if (typeof body === "string" || !validBlob(body.answer)) return send(res, 400, { error: "bad_answer" });
            room.answer = body.answer;
            if (room.waiters.size) {
                flushWaiters(room, 200, { answer: room.answer });
                rooms.delete(room.code);
            }
            return send(res, 204);
        }

        if (method === "GET" && sub === "/answer") {
            const room = liveRoom(code);
            if (!room) return send(res, 404, { error: "unknown_room" });
            if (!tokenOk(room.hostToken, token)) return send(res, 403, { error: "forbidden" });
            if (room.answer) {
                rooms.delete(room.code);
                return send(res, 200, { answer: room.answer });
            }
            // Long poll: hold the request until the answer arrives or pollMs passes.
            room.waiters.add(res);
            const timer = setTimeout(() => {
                room.waiters.delete(res);
                send(res, 204);
            }, Math.min(o.pollMs, Math.max(0, room.expiresAt - o.now())));
            res.on("close", () => {
                clearTimeout(timer);
                room.waiters.delete(res);
            });
            return;
        }

        if (method === "DELETE" && sub === "") {
            const room = liveRoom(code);
            if (!room) return send(res, 204);
            if (!tokenOk(room.hostToken, token)) return send(res, 403, { error: "forbidden" });
            dropRoom(room);
            return send(res, 204);
        }

        return send(res, 405, { error: "method_not_allowed" });
    }

    const server = http.createServer((req, res) => {
        handle(req, res).catch(() => send(res, 500, { error: "internal" }));
    });

    /** Removes expired rooms and stale rate-limit buckets. */
    function sweep() {
        const now = o.now();
        for (const room of rooms.values()) if (room.expiresAt <= now) dropRoom(room);
        for (const [ip, b] of buckets) if (b.resetAt <= now) buckets.delete(ip);
    }

    const sweeper = setInterval(sweep, 30_000);
    sweeper.unref();

    /** Answers pending long polls first — server.close() would wait for them. */
    function close(/** @type {() => void} */ cb = () => {}) {
        clearInterval(sweeper);
        for (const room of rooms.values()) flushWaiters(room, 503, { error: "shutdown" });
        server.close(() => cb());
        server.closeIdleConnections();
    }

    return { server, sweep, close, rooms };
}

/** @param {string|undefined} s */
function list(s) {
    return (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const env = process.env;
    const { server, close } = createSignalServer({
        stunUrls: list(env.STUN_URLS),
        turnUrls: list(env.TURN_URLS),
        turnSecret: env.TURN_SECRET ?? "",
        ...(env.TURN_TTL ? { turnTtlSec: Number(env.TURN_TTL) } : {}),
    });
    const port = Number(env.PORT ?? 8787);
    const host = env.HOST ?? "127.0.0.1";
    server.listen(port, host, () => console.log(`beavertracer-signal listening on ${host}:${port}`));
    const stop = () => close(() => process.exit(0));
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
}
