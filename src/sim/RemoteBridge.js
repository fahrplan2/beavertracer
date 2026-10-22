//@ts-check

import { SimulatedObject } from "./SimulatedObject.js";
import { EthernetPort } from "../net/EthernetPort.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { RemoteSession } from "../lib/RemoteSession.js";
import { UILib } from "../lib/UILib.js";
import { isTauri } from "../tauri.js";
import { t } from "../i18n/index.js";

/**
 * Connects this simulation to another BeaverTracer instance over WebRTC.
 *
 * Works like a long cable: every Ethernet frame arriving on eth0 is sent to
 * the peer's RemoteBridge, which puts it on its own eth0 — so whatever both
 * bridges are plugged into (switch, router, computer) forms one network.
 * Layer 2 only, no ARP/IP of its own.
 *
 * Speed and pause are kept in sync with the peer (the host's state wins on
 * connect), since protocol timeouts count in ticks — a peer running at a
 * different speed would look far too slow or too fast.
 *
 * Web version only (www.beavertracer.eu) — the signaling service lives there.
 * In Tauri the node still loads (files stay compatible), but only shows a hint.
 */
export class RemoteBridge extends SimulatedObject {

    kind = "RemoteBridge";
    icon = "fa-tower-broadcast";

    /** @type {EthernetPort} */
    port = new EthernetPort("eth0");

    /** @type {RemoteSession|null} */
    session = null;

    /** Last speed/pause state sent to (or applied from) the peer. @type {{ paused: boolean, tick: number }|null} */
    _lastSync = null;
    /** @type {ReturnType<typeof setInterval>|null} */
    _syncTimer = null;

    /** @type {HTMLElement|null} */
    _bodyEl = null;

    /** Frame size bounds: Ethernet header … max frame incl. 802.1Q tag. */
    static MIN_FRAME = 14;
    static MAX_FRAME = 1522;

    /** Session error codes with their own message; anything else is "webrtc". */
    static ERRORS = ["unknown_room", "taken", "rate_limited", "full", "network", "ice_failed", "timeout"];

    /** @param {string} [name] */
    constructor(name = "Remote Bridge") {
        super(name);
        this.root.classList.add("remote-bridge");
        this.port.subscribe(this);
        this.onPanelCreated = (/** @type {HTMLElement} */ body) => {
            this._bodyEl = body;
            this._renderPanel();
        };
    }

    // ── Frames ────────────────────────────────────────────────────────────────

    /** EthernetPort observer: frames from the local network go to the peer. */
    update() {
        let frame;
        while ((frame = this.port.getNextIncomingFrame()) != null) {
            // Not connected = cable to nowhere; the frame is lost like on a real one.
            if (this.session?.connected) this.session.sendFrame(frame.pack());
        }
    }

    /** @param {Uint8Array} bytes frame from the peer */
    _onRemoteFrame(bytes) {
        if (bytes.length < RemoteBridge.MIN_FRAME || bytes.length > RemoteBridge.MAX_FRAME) return;
        let frame;
        try { frame = EthernetFrame.fromBytes(bytes); } catch { return; }
        this.port.send(frame);
    }

    // ── Session ───────────────────────────────────────────────────────────────

    /** @param {"host"|"join"} how @param {string} [code] */
    _start(how, code = "") {
        this.session?.close();
        const session = new RemoteSession({
            onFrame: (b) => this._onRemoteFrame(b),
            onControl: (m) => this._onControl(m),
            onState: (s) => this._onSessionState(s),
        });
        this.session = session;
        if (how === "host") session.host();
        else session.join(code);
        this._renderPanel();
    }

    _stop() {
        this.session?.close();
        this.session = null;
        this._renderPanel();
    }

    /** @param {RemoteSession} s */
    _onSessionState(s) {
        if (s !== this.session) return;
        if (s.state === "connected") {
            // Host's speed/pause wins: it sends right away (no _lastSync yet);
            // the guest only reports its own later changes.
            this._lastSync = s.role === "guest" ? this._localSync() : null;
            this._syncTimer ??= setInterval(() => this._pushSync(), 200);
            this._pushSync();
        } else {
            this._stopSync();
        }
        this._renderPanel();
    }

    // ── Speed/pause sync ──────────────────────────────────────────────────────

    _localSync() {
        // SimControl.tick is static; reached via the instance to avoid an import cycle
        const sc = /** @type {any} */ (this.simcontrol);
        return {
            paused: !sc || sc.isPaused || sc.mode !== "run",
            tick: Number(sc?.constructor?.tick ?? 0),
        };
    }

    _pushSync() {
        if (!this.session?.connected) return;
        const now = this._localSync();
        const last = this._lastSync;
        if (last && last.paused === now.paused && (now.paused || last.tick === now.tick)) return;
        this._lastSync = now;
        this.session.sendControl({ t: "sim", paused: now.paused, tick: now.tick });
    }

    /** @param {any} msg */
    _onControl(msg) {
        if (msg.t !== "sim") return;
        // SimControl.tick is static; reached via the instance to avoid an import cycle
        const sc = /** @type {any} */ (this.simcontrol);
        if (!sc) return;
        const tick = Number(msg.tick);
        if (msg.paused) {
            sc.pause();
        } else if (sc.mode === "run" && Number.isFinite(tick) && tick > 0
                   && (sc.isPaused || sc.constructor.tick !== tick)) {
            sc.setTick(tick); // also unpauses
        }
        // Whatever we ended up with is now in sync — don't echo it back.
        this._lastSync = this._localSync();
    }

    _stopSync() {
        if (this._syncTimer) clearInterval(this._syncTimer);
        this._syncTimer = null;
        this._lastSync = null;
    }

    // ── Panel UI ──────────────────────────────────────────────────────────────

    _renderPanel() {
        const body = this._bodyEl;
        if (!body) return;
        body.replaceChildren();
        body.classList.add("remote-bridge-body");

        if (isTauri()) {
            body.appendChild(UILib.el("p", { className: "remote-bridge-hint", text: t("sim.remotebridge.offline") }));
            return;
        }
        if (!RemoteSession.isSupported()) {
            body.appendChild(UILib.el("p", { className: "remote-bridge-hint", text: t("sim.remotebridge.unsupported") }));
            return;
        }

        const s = this.session;
        const state = s?.state ?? "idle";

        if (state === "idle" || state === "closed" || state === "failed") {
            if (state === "closed") body.appendChild(this._status(t("sim.remotebridge.state.closed"), "off"));
            if (state === "failed") {
                const err = RemoteBridge.ERRORS.includes(s?.error ?? "") ? s?.error : "webrtc";
                body.appendChild(this._status(t(`sim.remotebridge.error.${err}`), "error"));
            }
            body.appendChild(UILib.el("p", { className: "remote-bridge-hint", text: t("sim.remotebridge.intro") }));

            const hostBtn = UILib.button(t("sim.remotebridge.host"), () => this._start("host"), { primary: true, icon: "fa-door-open" });

            const codeInput = UILib.input({ placeholder: "123456", className: ["input", "remote-bridge-code-input"] });
            codeInput.inputMode = "numeric";
            codeInput.maxLength = 7;
            const joinBtn = UILib.button(t("sim.remotebridge.join"), null, { icon: "fa-right-to-bracket", disabled: true });
            const code = () => codeInput.value.replace(/\D/g, "");
            codeInput.addEventListener("input", () => { joinBtn.disabled = code().length !== 6; });
            codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && code().length === 6) this._start("join", code()); });
            joinBtn.addEventListener("click", () => this._start("join", code()));

            body.appendChild(UILib.buttonRow([hostBtn]));
            body.appendChild(UILib.row(t("sim.remotebridge.code"), UILib.el("div", {
                className: "remote-bridge-join",
                children: [codeInput, joinBtn],
            })));
            return;
        }

        if (state === "waiting" && s?.code) {
            body.appendChild(this._status(t("sim.remotebridge.state.waiting"), "busy"));
            body.appendChild(UILib.el("div", {
                className: "remote-bridge-code",
                text: `${s.code.slice(0, 3)} ${s.code.slice(3)}`,
            }));
            body.appendChild(UILib.el("p", { className: "remote-bridge-hint", text: t("sim.remotebridge.waitingHint") }));
        } else if (state === "connecting" || state === "waiting") {
            body.appendChild(this._status(t("sim.remotebridge.state.connecting"), "busy"));
        } else {
            body.appendChild(this._status(t("sim.remotebridge.state.connected"), "on"));
            body.appendChild(UILib.el("p", { className: "remote-bridge-hint", text: t("sim.remotebridge.connectedHint") }));
        }
        const label = state === "connected" ? t("sim.remotebridge.disconnect") : t("sim.remotebridge.cancel");
        body.appendChild(UILib.buttonRow([UILib.button(label, () => this._stop(), { icon: "fa-xmark" })]));
    }

    /** @param {string} text @param {"on"|"off"|"busy"|"error"} kind */
    _status(text, kind) {
        return UILib.el("div", { className: `remote-bridge-status remote-bridge-status--${kind}`, text });
    }

    // ── Port API ──────────────────────────────────────────────────────────────

    listPorts() {
        return [{ key: "eth0", label: "eth0", port: this.port }];
    }

    /** @param {string} key */
    getPortByKey(key) {
        return key === "eth0" ? this.port : null;
    }

    // ── Serialization ─────────────────────────────────────────────────────────
    // The connection itself isn't saved — a loaded bridge is always disconnected.

    toJSON() {
        return {
            ...super.toJSON(),
            kind: "RemoteBridge",
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new RemoteBridge(n.name ?? "Remote Bridge");
        obj._applyBaseJSON(n);
        return obj;
    }

    destroy() {
        this._stopSync();
        this.session?.close();
        this.session = null;
        this._bodyEl = null;
        this.port.unsubscribe(this);
        super.destroy();
    }
}
