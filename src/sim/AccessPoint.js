//@ts-check
import { SimulatedObject } from "./SimulatedObject.js";
import { EthernetPort } from "../net/EthernetPort.js";
import { WirelessPort } from "../net/WirelessPort.js";
import { Observable } from "../lib/Observeable.js";
import { DOMBuilder } from "../lib/DomBuilder.js";
import { t } from "../i18n/index.js";

/** Bridges eth0 ↔ wlan0 at L2 (transparent, no MAC learning). */
class APBridge extends Observable {
    /**
     * @param {EthernetPort} eth0
     * @param {WirelessPort} wlan0
     */
    constructor(eth0, wlan0) {
        super();
        this._eth0  = eth0;
        this._wlan0 = wlan0;
        eth0.subscribe(this);
        wlan0.subscribe(this);
    }

    update() {
        let f;
        while ((f = this._eth0.getNextIncomingFrame())  != null) this._wlan0.send(f);
        while ((f = this._wlan0.getNextIncomingFrame()) != null) this._eth0.send(f);
    }
}

export class AccessPoint extends SimulatedObject {

    kind = "AccessPoint";
    icon = "fa-wifi";

    /** @type {EthernetPort} */
    _eth0;

    /** @type {WirelessPort} */
    _wPort;

    /** @type {string} SSID; empty string means not configured */
    _ssid = "";

    /** @param {string} name */
    constructor(name = t("ap.title")) {
        super(name);
        this.root.classList.add("ap");

        this._eth0  = new EthernetPort("eth0");
        this._wPort = new WirelessPort("wlan0");

        // eslint-disable-next-line no-new
        new APBridge(this._eth0, this._wPort);

        this.onPanelCreated = (/** @type {HTMLElement} */ body) => this._buildPanel(body);
    }

    /** @param {HTMLElement} body */
    _buildPanel(body) {
        const host = DOMBuilder.div("router-ui");
        host.style.cssText = "display:flex;flex-direction:column;gap:12px;";
        body.appendChild(host);

        host.appendChild(DOMBuilder.h4("WiFi"));

        const ssidRow = DOMBuilder.div("router-name-row");
        const label   = DOMBuilder.label(t("wifi.ssid"));
        const input   = DOMBuilder.input({ type: "text", placeholder: "SSID", value: this._ssid });
        const btn     = DOMBuilder.button(t("wifi.apply"));
        const msg     = DOMBuilder.div("");
        msg.style.cssText = "font-size:12px;color:var(--muted);";

        btn.addEventListener("click", () => {
            this._ssid = input.value.trim();
            msg.textContent = t("wifi.ssid.applied");
        });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });

        ssidRow.append(label, input, btn);
        host.append(ssidRow, msg);
    }

    // --- Port API (only eth0 is linkable via cable) ---

    listPorts() {
        return [{ key: "eth0", label: "eth0", port: this._eth0 }];
    }

    /** @param {string} key */
    getPortByKey(key) {
        return key === "eth0" ? this._eth0 : null;
    }

    // --- Persistence ---

    toJSON() {
        return {
            ...super.toJSON(),
            kind: "AccessPoint",
            ssid: this._ssid,
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new AccessPoint(String(n.name ?? t("ap.title")));
        obj._applyBaseJSON(n);
        obj._ssid = String(n.ssid ?? "");
        return obj;
    }
}
