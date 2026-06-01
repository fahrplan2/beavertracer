//@ts-check
import { SimControl } from "../SimControl.js";

const RIPPLE_RINGS   = 3;
const RIPPLE_STEP_MS = 200; // delay between rings

/**
 * Wireless broadcast medium.
 * step1/step2 follow the same two-phase pattern as EthernetLink / SimControl.step().
 * Any SimulatedObject that exposes _wPort (WirelessPort) and _ssid (non-empty string)
 * participates automatically — no registration needed.
 */
export class WifiMedium {
    /** @type {Array<{src: any, data: Uint8Array, ssid: string}>} */
    _inFlight = [];

    /** @type {import('../tracer/PCapControler.js').PCapController|null} */
    _pcap = null;

    /** @param {import('../tracer/PCapControler.js').PCapController} ctrl */
    setPcapController(ctrl) {
        this._pcap = ctrl;
    }

    /** @param {any} obj @returns {string} */
    _ifName(obj) {
        return `${obj.id}: ${obj._wPort.name}`;
    }

    /**
     * Phase 1: extract one outgoing frame from every wireless-capable object.
     * @param {any[]} simobjects
     */
    step1(simobjects) {
        this._inFlight = [];
        for (const obj of simobjects) {
            if (!obj._wPort || !obj._ssid) continue;
            const data = obj._wPort.getNextOutgoingFrame();
            if (data) {
                this._inFlight.push({ src: obj, data, ssid: obj._ssid });
            }
        }
    }

    /**
     * Phase 2: deliver collected frames to all other objects on the same SSID.
     * @param {any[]} simobjects
     */
    step2(simobjects) {
        for (const { src, data, ssid } of this._inFlight) {
            let delivered = false;
            for (const obj of simobjects) {
                if (obj === src || !obj._wPort || obj._ssid !== ssid) continue;
                obj._wPort.recieve(data);
                delivered = true;
            }
            if (delivered) this._spawnRipple(src.getX(), src.getY());
        }
        this._inFlight = [];
    }

    /**
     * Creates a CSS-animated ripple at (x, y).
     * The element removes itself when the last ring's animation ends.
     * @param {number} x
     * @param {number} y
     */
    _spawnRipple(x, y) {
        const layer = SimControl.packetsLayer;
        if (!layer) return;

        const container = document.createElement("div");
        container.className = "sim-wifi-ripple-container";
        container.style.left = `${x}px`;
        container.style.top  = `${y}px`;

        for (let i = 0; i < RIPPLE_RINGS; i++) {
            const ring = document.createElement("div");
            ring.className = "sim-wifi-ripple";
            ring.style.animationDelay = `${i * RIPPLE_STEP_MS}ms`;
            container.appendChild(ring);
        }

        container.lastElementChild?.addEventListener(
            "animationend",
            () => container.remove(),
            { once: true }
        );

        layer.appendChild(container);
    }
}
