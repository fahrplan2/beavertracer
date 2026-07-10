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
import { nowStamp } from "../lib/helpers.js";
import { t } from "../i18n/index.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";
import { PollTimer } from "../lib/PollTimer.js";

/** How long an idle tracked connection stays in the state table (~30s @ 1×, same convention as SimTimer's other *_MS constants). */
export const STATE_IDLE_TIMEOUT_MS = 1500;

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

/** Direction-independent key for a tracked connection (so return traffic finds the same entry). @param {PacketInfo} info */
function connKey(info) {
    const a = `${info.srcIp}:${info.srcPort ?? ""}`;
    const b = `${info.dstIp}:${info.dstPort ?? ""}`;
    const [x, y] = a <= b ? [a, b] : [b, a];
    return `${info.proto}|${x}|${y}`;
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

    /** Global stateful mode: allowed connections are tracked so return traffic passes without a matching rule. */
    statefulMode = false;

    /**
     * @typedef {{
     *   proto: number, version: 4|6,
     *   srcIp: string, srcPort: number|null,
     *   dstIp: string, dstPort: number|null,
     *   direction: "AtoB"|"BtoA",
     *   timerId: number,
     *   expiresAtTick: number,
     * }} StateEntry
     */

    /** @type {Map<string, StateEntry>} */
    _stateTable = new Map();

    _stats = { passed: 0, dropped: 0 };

    /** @type {string[]} */
    _fwLog = [];

    /** @type {string} */
    _activeTab = "rules";

    _pollTimer = new PollTimer();

    /** @type {HTMLElement|null} */
    _panelBody = null;
    /** @type {HTMLTextAreaElement|null} */
    _logEl = null;
    /** @type {HTMLElement|null} */
    _statsEl = null;
    /** @type {HTMLElement|null} */
    _rulesHost = null;
    /** @type {HTMLElement|null} */
    _stateHost = null;

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
        let stateChanged = false;
        while ((frame = fromPort.getNextIncomingFrame()) != null) {
            const info = parsePacketInfo(frame);
            const dir  = /** @type {"AtoB"|"BtoA"} */ (fromIndex === 0 ? "AtoB" : "BtoA");

            if (info === null) {
                this._stats.passed++;
                toPort.send(frame);
                continue;
            }

            let allow;
            if (this.statefulMode && this._isTrackable(info.proto) && this._touchState(info)) {
                allow = true;
                stateChanged = true;
            } else {
                allow = this._shouldAllow(info, dir);
                if (allow && this.statefulMode && this._isTrackable(info.proto)) {
                    this._createState(info, dir);
                    stateChanged = true;
                }
            }

            if (allow) {
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
        if (stateChanged) this._renderStateTable();
    }

    /** @param {number} proto */
    _isTrackable(proto) {
        return proto === 6 || proto === 17 || proto === 1 || proto === 58;
    }

    /** Refreshes an existing state entry's timeout. @param {PacketInfo} info @returns {boolean} true if a matching entry existed */
    _touchState(info) {
        const key = connKey(info);
        const entry = this._stateTable.get(key);
        if (!entry) return false;
        simTimer.cancel(entry.timerId);
        entry.timerId = simTimer.schedule(() => this._expireState(key), STATE_IDLE_TIMEOUT_MS);
        entry.expiresAtTick = simTimer.currentTick + simTimer.toTicks(STATE_IDLE_TIMEOUT_MS);
        return true;
    }

    /** @param {PacketInfo} info @param {"AtoB"|"BtoA"} direction */
    _createState(info, direction) {
        const key = connKey(info);
        if (this._touchState(info)) return;
        const timerId = simTimer.schedule(() => this._expireState(key), STATE_IDLE_TIMEOUT_MS);
        this._stateTable.set(key, {
            proto: info.proto, version: info.version,
            srcIp: info.srcIp, srcPort: info.srcPort,
            dstIp: info.dstIp, dstPort: info.dstPort,
            direction, timerId,
            expiresAtTick: simTimer.currentTick + simTimer.toTicks(STATE_IDLE_TIMEOUT_MS),
        });
    }

    /** @param {string} key */
    _expireState(key) {
        this._stateTable.delete(key);
        this._renderStateTable();
    }

    _clearStateTable() {
        for (const entry of this._stateTable.values()) simTimer.cancel(entry.timerId);
        this._stateTable.clear();
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
        this._stopPoll();
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

        // mode: stateless / stateful
        const modeLabel = UILib.label(t("firewall.mode"));
        const modeSel = this._select([
            ["stateless", t("firewall.mode.stateless")],
            ["stateful",  t("firewall.mode.stateful")],
        ], this.statefulMode ? "stateful" : "stateless", v => {
            this.statefulMode = v === "stateful";
            if (!this.statefulMode) this._clearStateTable();
            this._renderStateTable();
        });
        policyRow.append(modeLabel, modeSel);

        // rules host
        const rulesHost = UILib.div("fw-rules-host");
        this._rulesHost = rulesHost;

        const addBtn = UILib.button(t("firewall.addrule"), null, { className: "fw-add-rule" });
        addBtn.addEventListener("click", () => {
            this.rules.push(defaultRule());
            this._renderRules();
        });

        // state tab
        const stateHost = UILib.div("fw-state-host");
        this._stateHost = stateHost;

        const clearStateBtn = UILib.button(t("firewall.state.clear"), null, {});
        clearStateBtn.addEventListener("click", () => { this._clearStateTable(); this._renderStateTable(); });

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
            { id: "state", label: t("firewall.tab.state") },
            { id: "log",   label: t("firewall.tab.log")   },
        ], (id) => {
            this._activeTab = id;
            rulesPane.classList.toggle("hidden", id !== "rules");
            statePane.classList.toggle("hidden", id !== "state");
            logPane.classList.toggle("hidden",   id !== "log");
        });

        const rulesPane = UILib.div("");
        rulesPane.append(policyRow, statsEl, rulesHost, addBtn);

        const statePane = UILib.div("hidden");
        statePane.append(UILib.div("fw-state-controls", [clearStateBtn]), stateHost);

        const logPane = UILib.div("hidden");
        logPane.append(UILib.div("fw-log-controls", [clearBtn]), logEl);

        body.append(tabBar, rulesPane, statePane, logPane);
        setTab(this._activeTab);

        this._renderRules();
        this._renderStats();
        this._renderLog();
        this._renderStateTable();
        this._startPoll();
    }

    _startPoll() {
        this._pollTimer.start(() => this._renderStateTable(), 1000);
    }

    _stopPoll() {
        this._pollTimer.stop();
    }

    _renderStateTable() {
        const host = this._stateHost;
        if (!host || !this._panelBody?.contains(host)) return;
        host.innerHTML = "";

        if (!this.statefulMode) {
            host.appendChild(UILib.el("p", { text: t("firewall.state.disabled"), className: "router-empty-p" }));
            return;
        }
        if (this._stateTable.size === 0) {
            host.appendChild(UILib.el("p", { text: t("firewall.state.empty"), className: "router-empty-p" }));
            return;
        }

        const table = document.createElement("table");
        table.className = "fw-state-table";

        const thead = document.createElement("thead");
        const htr = document.createElement("tr");
        for (const key of ["firewall.col.protocol", "firewall.state.col.source", "firewall.state.col.dest",
                            "firewall.col.direction", "firewall.state.col.timeout"]) {
            const th = document.createElement("th");
            th.textContent = t(key);
            htr.appendChild(th);
        }
        thead.appendChild(htr);
        table.appendChild(thead);

        const protoNames = /** @type {Record<number, string>} */ ({ 6: "TCP", 17: "UDP", 1: "ICMP", 58: "ICMPv6" });
        const tbody = document.createElement("tbody");
        for (const entry of this._stateTable.values()) {
            const tr = document.createElement("tr");
            const src = `${entry.srcIp}${entry.srcPort != null ? `:${entry.srcPort}` : ""}`;
            const dst = `${entry.dstIp}${entry.dstPort != null ? `:${entry.dstPort}` : ""}`;
            const remainingTicks = Math.max(0, entry.expiresAtTick - simTimer.currentTick);
            const remainingSec = Math.ceil(remainingTicks * SimTimer.SIM_MS_PER_TICK / 1000);
            const dirLabel = entry.direction === "AtoB" ? t("firewall.dir.atob") : t("firewall.dir.btoa");
            for (const text of [protoNames[entry.proto] ?? String(entry.proto), src, dst, dirLabel, `${remainingSec}s`]) {
                const td = document.createElement("td");
                td.textContent = text;
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        const scrollWrap = UILib.div("sim-table-scroll");
        scrollWrap.appendChild(table);
        host.appendChild(UILib.wrapWithScrollHints(scrollWrap));
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

        const scrollWrap = UILib.div("sim-table-scroll");
        scrollWrap.appendChild(table);
        host.appendChild(UILib.wrapWithScrollHints(scrollWrap));
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
        this._fwLog.push(`[${nowStamp()}] ${line}`);
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
            statefulMode: this.statefulMode,
            rules: this.rules.map(r => ({ ...r })),
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Firewall(n.name ?? t("firewall.title"));
        obj._applyBaseJSON(n);
        obj.defaultPolicy = n.defaultPolicy === "deny" ? "deny" : "allow";
        obj.statefulMode = n.statefulMode === true;
        if (Array.isArray(n.rules)) {
            obj.rules = n.rules.map(/** @param {any} r */ r => ({ ...defaultRule(), ...r, id: _ruleIdCtr++ }));
        }
        return obj;
    }

    destroy() {
        this._stopPoll();
        this._clearStateTable();
        super.destroy();
    }
}
