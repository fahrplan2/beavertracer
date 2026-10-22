//@ts-check

/**
 * Client for beavertracer-signal (server/signal/server.mjs), which passes the
 * WebRTC offer/answer between two browsers via a 6-digit room code. Served
 * same-origin under /signal/ (in dev via the Vite proxy).
 */

export class SignalError extends Error {
    /**
     * @param {string} code  server error code ("unknown_room", "taken", "rate_limited", "full", …) or "network"
     * @param {number} [status]
     */
    constructor(code, status = 0) {
        super(`signal: ${code}`);
        this.code = code;
        this.status = status;
    }
}

export class SignalClient {

    /**
     * @param {string} [base]
     * @param {typeof fetch} [fetchFn]
     */
    constructor(base = "/signal", fetchFn = (...a) => fetch(...a)) {
        this.base = base.replace(/\/+$/, "");
        this.fetch = fetchFn;
    }

    /**
     * @param {string} method
     * @param {string} path
     * @param {{ body?: any, token?: string, signal?: AbortSignal }} [o]
     * @returns {Promise<{ status: number, json: any }>}
     */
    async _req(method, path, o = {}) {
        /** @type {Record<string, string>} */
        const headers = {};
        if (o.body !== undefined) headers["Content-Type"] = "application/json";
        if (o.token) headers["X-Room-Token"] = o.token;
        let res;
        try {
            res = await this.fetch(this.base + path, {
                method,
                headers,
                body: o.body === undefined ? undefined : JSON.stringify(o.body),
                signal: o.signal,
            });
        } catch (e) {
            if (/** @type {any} */ (e)?.name === "AbortError") throw e;
            throw new SignalError("network");
        }
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* not JSON, e.g. proxy error page */ }
        if (res.status >= 400) throw new SignalError(json?.error ?? "http_" + res.status, res.status);
        return { status: res.status, json };
    }

    /** @returns {Promise<RTCIceServer[]>} */
    async iceServers() {
        const { json } = await this._req("GET", "/ice");
        return Array.isArray(json?.iceServers) ? json.iceServers : [];
    }

    /**
     * @param {string} offer
     * @returns {Promise<{ code: string, token: string }>}
     */
    async createRoom(offer) {
        const { json } = await this._req("POST", "/rooms", { body: { offer } });
        return { code: json.code, token: json.token };
    }

    /**
     * Long-polls until the guest's answer arrives.
     * @param {string} code @param {string} token @param {AbortSignal} [signal]
     * @returns {Promise<string>}
     */
    async waitForAnswer(code, token, signal) {
        for (;;) {
            const { status, json } = await this._req("GET", `/rooms/${code}/answer`, { token, signal });
            if (status === 200) return json.answer;
        }
    }

    /**
     * @param {string} code
     * @returns {Promise<{ offer: string, token: string }>}
     */
    async join(code) {
        const { json } = await this._req("POST", `/rooms/${code}/join`);
        return { offer: json.offer, token: json.token };
    }

    /** @param {string} code @param {string} token @param {string} answer */
    async sendAnswer(code, token, answer) {
        await this._req("POST", `/rooms/${code}/answer`, { body: { answer }, token });
    }

    /** @param {string} code @param {string} token */
    async cancel(code, token) {
        await this._req("DELETE", `/rooms/${code}`, { token }).catch(() => {});
    }

    /** Anonymous success/failure counter — tells us whether TURN is needed. */
    /** @param {"connected"|"failed"} result */
    report(result) {
        this._req("POST", "/report", { body: { result } }).catch(() => {});
    }
}
