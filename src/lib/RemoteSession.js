//@ts-check

import { SignalClient, SignalError } from "./SignalClient.js";

/**
 * One WebRTC connection between two BeaverTracer instances.
 *
 * Two pre-negotiated data channels (no ondatachannel round trip needed):
 *   - "eth" (id 0): raw Ethernet frames, unordered and without retransmits,
 *     so it behaves like a cable — a lost frame is simply lost.
 *   - "ctl" (id 1): reliable JSON control messages (speed/pause sync).
 *
 * ICE candidates are gathered completely before the SDP goes through the
 * signaling server (no trickle), so exactly one message per direction.
 *
 * @typedef {"idle"|"waiting"|"connecting"|"connected"|"failed"|"closed"} SessionState
 */
export class RemoteSession {

    /** Wait at most this long for ICE gathering before sending what we have. */
    static GATHER_TIMEOUT_MS = 3000;
    /** Give up if the peer connection isn't up after this long. */
    static CONNECT_TIMEOUT_MS = 20000;

    /** @type {SessionState} */
    state = "idle";

    /** Room code while hosting (shown to the user). @type {string|null} */
    code = null;

    /** @type {"host"|"guest"|null} */
    role = null;

    /** Error code when state is "failed". @type {string|null} */
    error = null;

    /** @type {RTCPeerConnection|null} */
    _pc = null;
    /** @type {RTCDataChannel|null} */
    _eth = null;
    /** @type {RTCDataChannel|null} */
    _ctl = null;
    /** @type {AbortController|null} */
    _abort = null;
    /** @type {{ code: string, token: string }|null} */
    _room = null;
    _reported = false;
    /** @type {ReturnType<typeof setTimeout>|null} */
    _connectTimer = null;

    /**
     * @param {{
     *   signal?: SignalClient,
     *   RTC?: typeof RTCPeerConnection,
     *   onFrame?: (bytes: Uint8Array) => void,
     *   onControl?: (msg: any) => void,
     *   onState?: (s: RemoteSession) => void,
     * }} [opts]
     */
    constructor(opts = {}) {
        this.signal = opts.signal ?? new SignalClient();
        this.RTC = opts.RTC ?? globalThis.RTCPeerConnection;
        this.onFrame = opts.onFrame ?? (() => {});
        this.onControl = opts.onControl ?? (() => {});
        this.onState = opts.onState ?? (() => {});
    }

    static isSupported() {
        return typeof globalThis.RTCPeerConnection === "function";
    }

    get connected() {
        return this.state === "connected";
    }

    /** Opens a room; the code shows up in `code` once the server handed it out. */
    async host() {
        this.role = "host";
        await this._run(async (abort) => {
            const pc = await this._createPeer();
            await pc.setLocalDescription(await pc.createOffer());
            const offer = await this._gathered(pc);
            this._room = await this.signal.createRoom(offer);
            this.code = this._room.code;
            this._setState("waiting");
            const answer = await this.signal.waitForAnswer(this._room.code, this._room.token, abort.signal);
            this._room = null; // consumed — the server already dropped it
            this._setState("connecting");
            await pc.setRemoteDescription({ type: "answer", sdp: answer });
        });
    }

    /** @param {string} code six digits */
    async join(code) {
        this.role = "guest";
        await this._run(async () => {
            const room = await this.signal.join(code);
            this._setState("connecting");
            const pc = await this._createPeer();
            await pc.setRemoteDescription({ type: "offer", sdp: room.offer });
            await pc.setLocalDescription(await pc.createAnswer());
            await this.signal.sendAnswer(code, room.token, await this._gathered(pc));
        });
    }

    /** @param {(abort: AbortController) => Promise<void>} fn */
    async _run(fn) {
        if (this.state !== "idle") throw new Error("RemoteSession can only be used once");
        const abort = new AbortController();
        this._abort = abort;
        this._setState("connecting");
        try {
            await fn(abort);
        } catch (e) {
            if (abort.signal.aborted) return; // close() was called
            this._fail(e instanceof SignalError ? e.code : "webrtc");
        }
    }

    async _createPeer() {
        const iceServers = await this.signal.iceServers();
        const pc = new this.RTC({ iceServers });
        this._pc = pc;
        this._eth = pc.createDataChannel("eth", { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
        this._ctl = pc.createDataChannel("ctl", { negotiated: true, id: 1 });
        for (const ch of [this._eth, this._ctl]) {
            ch.binaryType = "arraybuffer";
            ch.onopen = () => this._checkOpen();
            ch.onclose = () => this._onClosed();
        }
        this._eth.onmessage = (e) => {
            if (e.data instanceof ArrayBuffer) this.onFrame(new Uint8Array(e.data));
        };
        this._ctl.onmessage = (e) => {
            if (typeof e.data !== "string") return;
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }
            if (msg && typeof msg === "object") this.onControl(msg);
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed") this._fail("ice_failed");
            else if (pc.connectionState === "disconnected" || pc.connectionState === "closed") this._onClosed();
        };
        this._connectTimer = setTimeout(() => {
            if (this.state === "connecting") this._fail("timeout");
        }, RemoteSession.CONNECT_TIMEOUT_MS);
        return pc;
    }

    /**
     * Resolves with the local SDP once ICE gathering is complete (or timed out).
     * @param {RTCPeerConnection} pc
     */
    _gathered(pc) {
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                pc.removeEventListener("icegatheringstatechange", check);
                resolve(pc.localDescription?.sdp ?? "");
            };
            const check = () => { if (pc.iceGatheringState === "complete") done(); };
            const timer = setTimeout(done, RemoteSession.GATHER_TIMEOUT_MS);
            pc.addEventListener("icegatheringstatechange", check);
            check();
        });
    }

    _checkOpen() {
        if (this._eth?.readyState !== "open" || this._ctl?.readyState !== "open") return;
        if (this._connectTimer) clearTimeout(this._connectTimer);
        this._report("connected");
        this._setState("connected");
    }

    _onClosed() {
        if (this.state === "connected") {
            this._teardown();
            this._setState("closed");
        }
    }

    /** @param {string} code */
    _fail(code) {
        if (this.state === "failed" || this.state === "closed") return;
        if (code === "ice_failed" || code === "timeout") this._report("failed");
        this.error = code;
        this._teardown();
        this._setState("failed");
    }

    /** @param {"connected"|"failed"} result */
    _report(result) {
        if (this._reported) return;
        this._reported = true;
        this.signal.report(result);
    }

    /** @param {Uint8Array} bytes */
    sendFrame(bytes) {
        if (this._eth?.readyState !== "open") return;
        // Same backpressure idea as EthernetPort's 100-frame cap: rather drop
        // than queue up seconds of traffic behind a slow link.
        if (this._eth.bufferedAmount > 256 * 1024) return;
        this._eth.send(/** @type {Uint8Array<ArrayBuffer>} */ (bytes));
    }

    /** @param {any} msg */
    sendControl(msg) {
        if (this._ctl?.readyState === "open") this._ctl.send(JSON.stringify(msg));
    }

    close() {
        if (this.state === "closed" || this.state === "failed") return;
        this._teardown();
        this._setState("closed");
    }

    _teardown() {
        this._abort?.abort();
        this._abort = null;
        if (this._connectTimer) clearTimeout(this._connectTimer);
        this._connectTimer = null;
        if (this._room) this.signal.cancel(this._room.code, this._room.token);
        this._room = null;
        for (const ch of [this._eth, this._ctl]) {
            if (!ch) continue;
            ch.onopen = ch.onclose = ch.onmessage = null;
            ch.close();
        }
        if (this._pc) {
            this._pc.onconnectionstatechange = null;
            this._pc.close();
        }
        this._eth = this._ctl = this._pc = null;
    }

    /** @param {SessionState} s */
    _setState(s) {
        this.state = s;
        this.onState(this);
    }
}
