//@ts-check

import { SimulatedObject } from "./SimulatedObject.js";
import { EthernetPort } from "../net/EthernetPort.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { ArpPacket } from "../net/pdu/ArpPacket.js";
import { UILib } from "../lib/UILib.js";

/**
 * Virtual gateway that forwards IP packets to a local companion process via WebSocket.
 * Only available in debug mode (?debug=1).
 *
 * Architecture:
 *   Simulated host → (eth) → CompanionBridge → (WebSocket) → companion → real network
 *
 * The bridge handles ARP for its own IP so simulated hosts can use it as a gateway.
 * IP packets are forwarded as raw bytes; the companion does SNAT before sending them out.
 */
export class CompanionBridge extends SimulatedObject {

    kind = "CompanionBridge";
    icon = "fa-network-wired";

    /** @type {EthernetPort} */
    port = new EthernetPort("eth0");

    /** Bridge MAC address (AA:xx:xx:xx:xx:xx) */
    mac = _randomMac();

    /** Bridge IP as 4-byte array, e.g. [10, 0, 0, 254] */
    ip = new Uint8Array([10, 0, 0, 254]);

    /** ARP cache: "a.b.c.d" → Uint8Array(6) MAC */
    _arpCache = new Map();

    /** @type {WebSocket|null} */
    _ws = null;

    _wsUrl = "ws://127.0.0.1:12345";

    /** @type {"disconnected"|"connecting"|"connected"|"error"} */
    _wsStatus = "disconnected";

    /** @type {HTMLElement|null} */
    _statusEl = null;

    /** @type {HTMLButtonElement|null} */
    _connectBtn = null;

    /**
     * @param {string} [name]
     */
    constructor(name = "Companion Bridge") {
        super(name);
        this.root.classList.add("companion-bridge");
        this.port.subscribe(this);
        this.onPanelCreated = (/** @type {HTMLElement} */ body) => this._buildPanelBody(body);
    }

    // ── Observable callback — called by EthernetPort when frames arrive ──────

    update() {
        let frame;
        while ((frame = this.port.getNextIncomingFrame()) != null) {
            this._handleFrame(frame);
        }
    }

    // ── Frame handling ────────────────────────────────────────────────────────

    /** @param {EthernetFrame} frame */
    _handleFrame(frame) {
        if (frame.etherType === 0x0806) {
            this._handleARP(frame);
        } else if (frame.etherType === 0x0800) {
            this._forwardToCompanion(frame.payload);
        }
    }

    /** @param {EthernetFrame} frame */
    _handleARP(frame) {
        let arp;
        try { arp = ArpPacket.fromBytes(frame.payload); } catch { return; }
        if (arp.oper !== 1) return; // only handle requests

        // Learn sender
        const senderIp = _ipStr(arp.spa);
        this._arpCache.set(senderIp, new Uint8Array(arp.sha));

        // Reply only if we are the target
        if (!_ipEq(arp.tpa, this.ip)) return;

        const reply = new ArpPacket({
            oper: 2,
            sha: this.mac,
            spa: this.ip,
            tha: arp.sha,
            tpa: arp.spa,
        });
        this.port.send(new EthernetFrame({
            dstMac: arp.sha,
            srcMac: this.mac,
            etherType: 0x0806,
            payload: reply.pack(),
        }));
    }

    /** @param {Uint8Array} ipBytes raw IPv4 packet bytes */
    _forwardToCompanion(ipBytes) {
        if (this._ws?.readyState !== WebSocket.OPEN) return;
        this._ws.send(ipBytes.slice());
    }

    /** Called when companion sends a response IP packet back */
    /** @param {Uint8Array} bytes */
    _onCompanionMessage(bytes) {
        if (bytes.length < 20) return;

        // Destination IP is at offset 16
        const dstIp = _ipStr(bytes.subarray(16, 20));
        const dstMac = this._arpCache.get(dstIp);
        if (!dstMac) {
            console.warn("[CompanionBridge] no ARP entry for", dstIp, "— dropping response");
            return;
        }

        this.port.send(new EthernetFrame({
            dstMac,
            srcMac: this.mac,
            etherType: 0x0800,
            payload: bytes,
        }));
    }

    // ── WebSocket management ──────────────────────────────────────────────────

    _connect() {
        this._ws?.close();
        this._ws = null;
        this._setStatus("connecting");
        try {
            const ws = new WebSocket(this._wsUrl);
            ws.binaryType = "arraybuffer";
            ws.onopen    = () => this._setStatus("connected");
            ws.onclose   = () => this._setStatus("disconnected");
            ws.onerror   = () => this._setStatus("error");
            ws.onmessage = (e) => this._onCompanionMessage(new Uint8Array(/** @type {ArrayBuffer} */ (e.data)));
            this._ws = ws;
        } catch {
            this._setStatus("error");
        }
    }

    _disconnect() {
        this._ws?.close();
        this._ws = null;
        this._setStatus("disconnected");
    }

    /** @param {"disconnected"|"connecting"|"connected"|"error"} status */
    _setStatus(status) {
        this._wsStatus = status;
        if (this._statusEl) {
            this._statusEl.textContent = status;
            this._statusEl.className = `companion-bridge-status companion-bridge-status--${status}`;
        }
        if (this._connectBtn) {
            this._connectBtn.textContent = status === "connected" ? "Disconnect" : "Connect";
            this._connectBtn.disabled = status === "connecting";
        }
    }

    // ── Panel UI ──────────────────────────────────────────────────────────────

    /** @param {HTMLElement} body */
    _buildPanelBody(body) {
        const ipInput = UILib.input({
            value: _ipStr(this.ip),
            placeholder: "10.0.0.254",
        });
        ipInput.addEventListener("change", () => {
            const parts = ipInput.value.trim().split(".").map(Number);
            if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
                this.ip = new Uint8Array(parts);
            } else {
                ipInput.value = _ipStr(this.ip);
            }
        });

        const urlInput = UILib.input({
            value: this._wsUrl,
            placeholder: "ws://127.0.0.1:12345",
        });
        urlInput.addEventListener("change", () => {
            this._wsUrl = urlInput.value.trim();
        });

        const statusEl = UILib.el("span", {
            className: `companion-bridge-status companion-bridge-status--${this._wsStatus}`,
            text: this._wsStatus,
        });
        this._statusEl = statusEl;

        const connectBtn = /** @type {HTMLButtonElement} */ (UILib.button(
            this._wsStatus === "connected" ? "Disconnect" : "Connect",
            () => {
                if (this._ws?.readyState === WebSocket.OPEN) {
                    this._disconnect();
                } else {
                    this._wsUrl = urlInput.value.trim();
                    this.ip = (() => {
                        const parts = ipInput.value.trim().split(".").map(Number);
                        return (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255))
                            ? new Uint8Array(parts)
                            : this.ip;
                    })();
                    this._connect();
                }
            },
            { primary: true },
        ));
        this._connectBtn = connectBtn;

        const hint = UILib.el("p", {
            className: "companion-bridge-hint",
            text: "Start: cd companion && cargo run",
        });

        body.appendChild(UILib.row("Bridge IP", ipInput));
        body.appendChild(UILib.row("Companion WS", urlInput));
        body.appendChild(UILib.row("Status", statusEl));
        body.appendChild(UILib.buttonRow([connectBtn]));
        body.appendChild(hint);
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

    toJSON() {
        return {
            ...super.toJSON(),
            kind: "CompanionBridge",
            ip: _ipStr(this.ip),
            wsUrl: this._wsUrl,
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new CompanionBridge(n.name ?? "Companion Bridge");
        obj._applyBaseJSON(n);
        if (typeof n.ip === "string") {
            const parts = n.ip.split(".").map(Number);
            if (parts.length === 4 && parts.every((/** @type {number} */ x) => Number.isInteger(x) && x >= 0 && x <= 255)) {
                obj.ip = new Uint8Array(parts);
            }
        }
        if (typeof n.wsUrl === "string") obj._wsUrl = n.wsUrl;
        return obj;
    }

    destroy() {
        this._ws?.close();
        this._ws = null;
        this.port.unsubscribe(this);
        super.destroy();
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @param {Uint8Array} a @param {Uint8Array} b */
function _ipEq(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** @param {Uint8Array} ip */
function _ipStr(ip) {
    return `${ip[0]}.${ip[1]}.${ip[2]}.${ip[3]}`;
}

function _randomMac() {
    const mac = new Uint8Array(6);
    mac[0] = 0xAA;
    for (let i = 1; i < 6; i++) mac[i] = Math.floor(Math.random() * 256);
    return mac;
}
