//@ts-check
import { Observable } from "../lib/Observeable.js";
import { EthernetPort } from "../net/EthernetPort.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { IPv4Packet } from "../net/pdu/IPv4Packet.js";
import { IPv6Packet } from "../net/pdu/IPv6Packet.js";
import { TCPPacket } from "../net/pdu/TCPPacket.js";
import { UDPPacket } from "../net/pdu/UDPPacket.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { SimulatedObject } from "./SimulatedObject.js";
import { UILib } from "../lib/UILib.js";
import { t } from "../i18n/index.js";

// ── helpers ────────────────────────────────────────────────────────────────

class PortObserver extends Observable {
    #fn;
    /** @param {()=>void} fn */
    constructor(fn) { super(); this.#fn = fn; }
    update() { this.#fn(); }
}

/**
 * @typedef {{
 *   version: 4|6,
 *   proto: number,
 *   srcIp: string,
 *   dstIp: string,
 *   srcPort: number|null,
 *   dstPort: number|null,
 * }} PacketInfo
 */

/** @param {EthernetFrame} frame @returns {PacketInfo|null} */
function parsePacketInfo(frame) {
    try {
        if (frame.etherType === 0x0800) {
            const ip = IPv4Packet.fromBytes(frame.payload);
            let srcPort = null, dstPort = null;
            if (ip.protocol === 6 || ip.protocol === 17) {
                const s = ip.protocol === 6
                    ? TCPPacket.fromBytes(ip.payload)
                    : UDPPacket.fromBytes(ip.payload);
                srcPort = s.srcPort;
                dstPort = s.dstPort;
            }
            return { version: 4, proto: ip.protocol, srcIp: ip.src.toString(), dstIp: ip.dst.toString(), srcPort, dstPort };
        }
        if (frame.etherType === 0x86DD) {
            const ip = IPv6Packet.fromBytes(frame.payload);
            let srcPort = null, dstPort = null;
            if (ip.nextHeader === 6 || ip.nextHeader === 17) {
                const s = ip.nextHeader === 6
                    ? TCPPacket.fromBytes(ip.payload)
                    : UDPPacket.fromBytes(ip.payload);
                srcPort = s.srcPort;
                dstPort = s.dstPort;
            }
            return { version: 6, proto: ip.nextHeader, srcIp: ip.src.toString(), dstIp: ip.dst.toString(), srcPort, dstPort };
        }
    } catch { /* malformed packet */ }
    return null; // non-IP (ARP, etc.) — always pass through
}

/** @param {number} n32 @param {number} prefix @returns {number} */
function applyMask32(n32, prefix) {
    if (prefix <= 0) return 0;
    if (prefix >= 32) return n32 >>> 0;
    return (n32 & ((0xffffffff << (32 - prefix)) >>> 0)) >>> 0;
}

/** @param {IPAddress} ip @returns {number} */
function v4n(ip) { return /** @type {number} */ (ip.getNumber()) >>> 0; }

/**
 * Match an IP string against a CIDR spec.  Empty spec = any.
 * @param {string} ipStr  @param {string} spec  @param {4|6} version
 * @returns {boolean}
 */
function matchCIDR(ipStr, spec, version) {
    if (!spec || spec.trim() === "" || spec.trim().toLowerCase() === "any") return true;
    try {
        const [netStr, prefixStr] = spec.split("/");
        const prefix = prefixStr !== undefined ? Number(prefixStr) : (version === 4 ? 32 : 128);
        const addr = IPAddress.fromString(ipStr.trim());
        const net  = IPAddress.fromString(netStr.trim());
        if (!addr || !net) return false;

        if (version === 4) {
            const mask = applyMask32(0xffffffff, prefix);
            return applyMask32(v4n(addr), prefix) === applyMask32(v4n(net), prefix);
        }
        // IPv6: compare byte by byte up to prefix bits
        const ab = addr.toUInt8();
        const nb = net.toUInt8();
        let rem = prefix;
        for (let i = 0; i < 16 && rem > 0; i++) {
            const bits = Math.min(rem, 8);
            const mask = (0xff << (8 - bits)) & 0xff;
            if ((ab[i] & mask) !== (nb[i] & mask)) return false;
            rem -= bits;
        }
        return true;
    } catch { return false; }
}

/** @param {string} s @returns {boolean} */
function isValidCidr(s) {
    if (!s || s.trim() === "" || s.trim().toLowerCase() === "any") return true;
    try {
        const [addrStr, prefixStr] = s.split("/");
        const addr = IPAddress.fromString(addrStr.trim());
        if (!addr) return false;
        if (prefixStr !== undefined) {
            const p = Number(prefixStr);
            if (!Number.isInteger(p)) return false;
            const max = addr.isV4() ? 32 : 128;
            if (p < 0 || p > max) return false;
        }
        return true;
    } catch { return false; }
}

/** @param {string} s @returns {boolean} */
function isValidPort(s) {
    if (!s || s.trim() === "" || s.trim().toLowerCase() === "any") return true;
    const v = s.trim();
    if (v.includes("-")) {
        const [lo, hi] = v.split("-").map(Number);
        return Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && hi <= 65535 && lo <= hi;
    }
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 65535;
}

/**
 * Match a port number against a spec string.  Empty = any.
 * Supports "80", "1024-65535".
 * @param {number|null} port @param {string} spec
 */
function matchPort(port, spec) {
    if (!spec || spec.trim() === "" || spec.trim().toLowerCase() === "any") return true;
    if (port == null) return true; // protocol has no ports
    const s = spec.trim();
    if (s.includes("-")) {
        const [lo, hi] = s.split("-").map(Number);
        return port >= lo && port <= hi;
    }
    return port === Number(s);
}

// ── Rule ──────────────────────────────────────────────────────────────────

let _ruleIdCtr = 1;

/**
 * @typedef {{
 *   id: number,
 *   enabled: boolean,
 *   direction: "both"|"AtoB"|"BtoA",
 *   ipVersion: "any"|4|6,
 *   protocol: "any"|"tcp"|"udp"|"icmp"|"icmpv6",
 *   srcIp: string,
 *   srcPort: string,
 *   dstIp: string,
 *   dstPort: string,
 *   action: "allow"|"deny",
 * }} FWRule
 */

/** @returns {FWRule} */
function defaultRule() {
    return { id: _ruleIdCtr++, enabled: true, direction: "both", ipVersion: "any",
             protocol: "any", srcIp: "", srcPort: "", dstIp: "", dstPort: "", action: "allow" };
}

// ── Firewall ──────────────────────────────────────────────────────────────

export class Firewall extends SimulatedObject {

    kind = "Firewall";
    icon = "fa-shield-halved";

    /** @type {EthernetPort} */
    _port0 = new EthernetPort("A");
    /** @type {EthernetPort} */
    _port1 = new EthernetPort("B");

    /** @type {FWRule[]} */
    rules = [defaultRule()];

    /** @type {"allow"|"deny"} */
    defaultPolicy = "allow";

    _stats = { passed: 0, dropped: 0 };

    /** @type {string[]} */
    _fwLog = [];

    /** @type {HTMLElement|null} */
    _panelBody = null;
    /** @type {HTMLTextAreaElement|null} */
    _logEl = null;
    /** @type {HTMLElement|null} */
    _statsEl = null;
    /** @type {HTMLElement|null} */
    _rulesHost = null;

    constructor(name = t("firewall.title")) {
        super(name);

        // subscribe to both ports so we get notified when frames arrive
        this._port0.subscribe(new PortObserver(() => this._processPort(0)));
        this._port1.subscribe(new PortObserver(() => this._processPort(1)));

        this.onPanelCreated = (/** @type {HTMLElement} */ body) => {
            this._panelBody = body;
            this._mountPanel(body);
        };
    }

    // ── Port API ──────────────────────────────────────────────────────────

    listPorts() {
        return [
            { key: "port0", label: t("firewall.port.a"), port: this._port0 },
            { key: "port1", label: t("firewall.port.b"), port: this._port1 },
        ];
    }

    /** @param {string} key */
    getPortByKey(key) {
        if (key === "port0") return this._port0;
        if (key === "port1") return this._port1;
        return null;
    }

    // ── Frame forwarding ──────────────────────────────────────────────────

    /** @param {0|1} fromIndex */
    _processPort(fromIndex) {
        const fromPort = fromIndex === 0 ? this._port0 : this._port1;
        const toPort   = fromIndex === 0 ? this._port1 : this._port0;
        if (!toPort.linkref) return; // nowhere to forward

        let frame;
        while ((frame = fromPort.getNextIncomingFrame()) != null) {
            const info = parsePacketInfo(frame);
            const dir  = /** @type {"AtoB"|"BtoA"} */ (fromIndex === 0 ? "AtoB" : "BtoA");

            if (info === null || this._shouldAllow(info, dir)) {
                this._stats.passed++;
                toPort.send(frame);
            } else {
                this._stats.dropped++;
                this._appendLog(
                    `DROP ${dir} ${info.srcIp}${info.srcPort != null ? `:${info.srcPort}` : ""} → ` +
                    `${info.dstIp}${info.dstPort != null ? `:${info.dstPort}` : ""} ` +
                    `proto=${info.proto}`
                );
            }
        }

        this._renderStats();
    }

    /**
     * @param {PacketInfo} info
     * @param {"AtoB"|"BtoA"} direction
     * @returns {boolean}
     */
    _shouldAllow(info, direction) {
        for (const rule of this.rules) {
            if (!rule.enabled) continue;
            if (this._matchRule(rule, info, direction)) {
                return rule.action === "allow";
            }
        }
        return this.defaultPolicy === "allow";
    }

    /**
     * @param {FWRule} rule
     * @param {PacketInfo} info
     * @param {"AtoB"|"BtoA"} direction
     * @returns {boolean}
     */
    _matchRule(rule, info, direction) {
        // direction
        if (rule.direction !== "both" && rule.direction !== direction) return false;

        // IP version
        if (rule.ipVersion !== "any" && rule.ipVersion !== info.version) return false;

        // protocol
        if (rule.protocol !== "any") {
            const protoNum = { tcp: 6, udp: 17, icmp: 1, icmpv6: 58 }[rule.protocol];
            if (protoNum !== info.proto) return false;
        }

        // IPs
        if (!matchCIDR(info.srcIp, rule.srcIp, info.version)) return false;
        if (!matchCIDR(info.dstIp, rule.dstIp, info.version)) return false;

        // ports (only for TCP/UDP)
        if (info.proto === 6 || info.proto === 17) {
            if (!matchPort(info.srcPort, rule.srcPort)) return false;
            if (!matchPort(info.dstPort, rule.dstPort)) return false;
        }

        return true;
    }

    // ── Panel ─────────────────────────────────────────────────────────────

    /** @param {HTMLElement} body */
    _mountPanel(body) {
        body.innerHTML = "";

        const statsEl = UILib.div("fw-stats");
        this._statsEl = statsEl;

        // default policy row
        const policyRow = UILib.div("router-name-row");
        policyRow.style.gap = "6px";
        policyRow.style.marginBottom = "6px";
        const policyLabel = UILib.label(t("firewall.defaultpolicy"));
        const policySel = /** @type {HTMLSelectElement} */ (UILib.el("select", { className: "fw-select" }));
        for (const [val, lbl] of [["allow", t("firewall.policy.allow")], ["deny", t("firewall.policy.deny")]]) {
            const o = UILib.el("option", { text: lbl, attrs: { value: val } });
            policySel.appendChild(o);
        }
        policySel.value = this.defaultPolicy;
        policySel.addEventListener("change", () => {
            this.defaultPolicy = /** @type {"allow"|"deny"} */ (policySel.value);
        });
        policyRow.append(policyLabel, policySel);

        // rules host
        const rulesHost = UILib.div("fw-rules-host");
        this._rulesHost = rulesHost;

        const addBtn = UILib.button(t("firewall.addrule"), null, { className: "fw-add-rule" });
        addBtn.addEventListener("click", () => {
            this.rules.push(defaultRule());
            this._renderRules();
        });

        // log tab
        const logEl = /** @type {HTMLTextAreaElement} */ (UILib.el("textarea", {
            className: "log router-log-fw",
            attrs: { readonly: "true", spellcheck: "false" },
        }));
        this._logEl = logEl;

        const clearBtn = UILib.button(t("firewall.log.clear"), null, {});
        clearBtn.addEventListener("click", () => { this._fwLog = []; this._renderLog(); });

        const { bar: tabBar, setActive: setTab } = UILib.tabGroup([
            { id: "rules", label: t("firewall.tab.rules") },
            { id: "log",   label: t("firewall.tab.log")   },
        ], (id) => {
            rulesPane.classList.toggle("hidden", id !== "rules");
            logPane.classList.toggle("hidden",   id !== "log");
        });

        const rulesPane = UILib.div("");
        rulesPane.append(policyRow, statsEl, rulesHost, addBtn);

        const logPane = UILib.div("hidden");
        logPane.append(UILib.div("fw-log-controls", [clearBtn]), logEl);

        body.append(tabBar, rulesPane, logPane);
        setTab("rules");

        this._renderRules();
        this._renderStats();
        this._renderLog();
    }

    _renderRules() {
        const host = this._rulesHost;
        if (!host) return;
        host.innerHTML = "";

        const table = document.createElement("table");
        table.className = "fw-rules-table";

        const thead = document.createElement("thead");
        const htr   = document.createElement("tr");
        for (const key of ["","firewall.col.enabled","firewall.col.direction","firewall.col.ipversion",
                            "firewall.col.protocol","firewall.col.srcip","firewall.col.srcport",
                            "firewall.col.dstip","firewall.col.dstport","firewall.col.action",""]) {
            const th = document.createElement("th");
            th.textContent = key ? t(key) : "";
            htr.appendChild(th);
        }
        thead.appendChild(htr);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        for (const rule of this.rules) {
            tbody.appendChild(this._buildRuleRow(rule));
        }
        table.appendChild(tbody);
        host.appendChild(table);
    }

    /** @param {FWRule} rule */
    _buildRuleRow(rule) {
        const tr = document.createElement("tr");

        // order buttons
        const idx = () => this.rules.indexOf(rule);
        const upBtn   = UILib.button("▲", null, { className: "fw-order-btn" });
        const downBtn = UILib.button("▼", null, { className: "fw-order-btn" });
        upBtn.title   = t("firewall.move.up");
        downBtn.title = t("firewall.move.down");
        upBtn.disabled   = idx() === 0;
        downBtn.disabled = idx() === this.rules.length - 1;
        upBtn.addEventListener("click", () => {
            const i = idx(); if (i <= 0) return;
            [this.rules[i - 1], this.rules[i]] = [this.rules[i], this.rules[i - 1]];
            this._renderRules();
        });
        downBtn.addEventListener("click", () => {
            const i = idx(); if (i >= this.rules.length - 1) return;
            [this.rules[i], this.rules[i + 1]] = [this.rules[i + 1], this.rules[i]];
            this._renderRules();
        });
        const orderTd = this._td(upBtn);
        orderTd.appendChild(downBtn);
        orderTd.className = "fw-order-cell";
        tr.appendChild(orderTd);

        // enabled
        const cbEn = UILib.input({ type: "checkbox" });
        cbEn.checked = rule.enabled;
        cbEn.addEventListener("change", () => { rule.enabled = cbEn.checked; });
        tr.appendChild(this._td(cbEn));

        // direction
        const dirSel = this._select([
            ["both",  t("firewall.dir.both")],
            ["AtoB",  t("firewall.dir.atob")],
            ["BtoA",  t("firewall.dir.btoa")],
        ], rule.direction, v => { rule.direction = /** @type {any} */ (v); });
        tr.appendChild(this._td(dirSel));

        // ip version
        const ipvSel = this._select([
            ["any", t("firewall.any")],
            ["4",   "IPv4"],
            ["6",   "IPv6"],
        ], String(rule.ipVersion), v => { rule.ipVersion = v === "4" ? 4 : v === "6" ? 6 : "any"; });
        tr.appendChild(this._td(ipvSel));

        // protocol
        const protoSel = this._select([
            ["any",    t("firewall.any")],
            ["tcp",    "TCP"],
            ["udp",    "UDP"],
            ["icmp",   "ICMP"],
            ["icmpv6", "ICMPv6"],
        ], rule.protocol, v => { rule.protocol = /** @type {any} */ (v); });
        tr.appendChild(this._td(protoSel));

        // src ip / port / dst ip / port
        for (const [field, placeholder, validator, cls] of /** @type {[keyof FWRule, string, (s:string)=>boolean, string][]} */ ([
            ["srcIp",   "0.0.0.0/0",       isValidCidr, "fw-input"],
            ["srcPort", t("firewall.any"), isValidPort, "fw-input fw-port-input"],
            ["dstIp",   "0.0.0.0/0",       isValidCidr, "fw-input"],
            ["dstPort", t("firewall.any"), isValidPort, "fw-input fw-port-input"],
        ])) {
            const inp = UILib.input({ placeholder, className: cls });
            inp.value = /** @type {string} */ (rule[field]);
            const validate = () => inp.classList.toggle("is-invalid", !validator(inp.value));
            inp.addEventListener("input", () => { /** @type {any} */ (rule)[field] = inp.value; validate(); });
            validate();
            tr.appendChild(this._td(inp));
        }

        // action
        const actSel = this._select([
            ["allow", t("firewall.action.allow")],
            ["deny",  t("firewall.action.deny")],
        ], rule.action, v => { rule.action = /** @type {any} */ (v); tr.dataset.action = v; });
        tr.dataset.action = rule.action;
        tr.appendChild(this._td(actSel));

        // delete
        const delBtn = UILib.button("✕", null, { className: "fw-del-rule" });
        delBtn.title = t("firewall.delrule");
        delBtn.addEventListener("click", () => {
            this.rules = this.rules.filter(r => r.id !== rule.id);
            this._renderRules();
        });
        tr.appendChild(this._td(delBtn));

        return tr;
    }

    /**
     * @param {Array<[string,string]>} options
     * @param {string} value
     * @param {(v:string)=>void} onChange
     * @returns {HTMLSelectElement}
     */
    _select(options, value, onChange) {
        const sel = /** @type {HTMLSelectElement} */ (UILib.el("select", { className: "fw-select" }));
        for (const [val, lbl] of options) {
            const o = UILib.el("option", { text: lbl, attrs: { value: val } });
            sel.appendChild(o);
        }
        sel.value = value;
        sel.addEventListener("change", () => onChange(sel.value));
        return sel;
    }

    /** @param {HTMLElement} child */
    _td(child) {
        const td = document.createElement("td");
        td.appendChild(child);
        return td;
    }

    _renderStats() {
        if (!this._statsEl) return;
        this._statsEl.textContent =
            `${t("firewall.stats.passed")}: ${this._stats.passed}  |  ${t("firewall.stats.dropped")}: ${this._stats.dropped}`;
    }

    /** @param {string} line */
    _appendLog(line) {
        const now = new Date().toLocaleTimeString();
        this._fwLog.push(`[${now}] ${line}`);
        if (this._fwLog.length > 500) this._fwLog.splice(0, this._fwLog.length - 500);
        this._renderLog();
    }

    _renderLog() {
        if (!this._logEl) return;
        const lines = this._fwLog;
        const max   = 200;
        this._logEl.value = (lines.length > max ? lines.slice(-max) : lines).join("\n");
        this._logEl.scrollTop = this._logEl.scrollHeight;
    }

    // ── Persistence ───────────────────────────────────────────────────────

    toJSON() {
        return {
            ...super.toJSON(),
            kind: "Firewall",
            defaultPolicy: this.defaultPolicy,
            rules: this.rules.map(r => ({ ...r })),
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Firewall(n.name ?? t("firewall.title"));
        obj._applyBaseJSON(n);
        obj.defaultPolicy = n.defaultPolicy === "deny" ? "deny" : "allow";
        if (Array.isArray(n.rules)) {
            obj.rules = n.rules.map(/** @param {any} r */ r => ({ ...defaultRule(), ...r, id: _ruleIdCtr++ }));
        }
        return obj;
    }
}
