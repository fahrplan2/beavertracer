//@ts-check

import { SimulatedObject } from "./SimulatedObject.js";
import { PollTimer } from "../lib/PollTimer.js";
import { EthernetPort } from "../net/EthernetPort.js";
import { WirelessPort } from "../net/WirelessPort.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { ArpPacket } from "../net/pdu/ArpPacket.js";
import { IPv4Packet } from "../net/pdu/IPv4Packet.js";
import { ICMPPacket } from "../net/pdu/ICMPPacket.js";
import { UDPPacket } from "../net/pdu/UDPPacket.js";
import { TCPPacket } from "../net/pdu/TCPPacket.js";
import { DHCPPacket } from "../net/pdu/DHCPPacket.js";
import { DHCPv6Packet } from "../net/pdu/DHCPv6Packet.js";
import { IPv6Packet } from "../net/pdu/IPv6Packet.js";
import { ICMPv6Packet } from "../net/pdu/ICMPv6Packet.js";
import { DNSPacket } from "../net/pdu/DNSPacket.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { NatEngine } from "../net/NatEngine.js";
import { IPStack } from "../net/IPStack.js";
import { NetworkInterface } from "../net/NetworkInterface.js";
import { simTimer, SimTimer } from "../lib/SimTimer.js";
import { UILib } from "../lib/UILib.js";
import { t } from "../i18n/index.js";
import { SimDialog } from "../lib/SimDialog.js";
import { isEqualUint8, IPNumberToUint8, IPUInt8ToNumber, ipToString, MACToNumber, prefixToNetmask } from "../lib/helpers.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** @param {IPAddress} ip @returns {number} uint32 */
const ipNum = (ip) => ip.isV4() ? /** @type {number} */ (ip.getNumber()) >>> 0 : 0;

/** @param {number} n @returns {IPAddress} */
const numToIp = (n) => new IPAddress(4, n >>> 0);

/** @param {string} s @returns {number} uint32 */
const strToNum = (s) => { try { const ip = IPAddress.fromString(s.trim()); return ip.isV4() ? ipNum(ip) : 0; } catch { return 0; } };

/** @param {Uint8Array} b @returns {string} */
const bytes6ToKey = (b) => Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");

/** @param {Uint8Array} m @returns {bigint} */
const macToBig = (m) => BigInt("0x" + Array.from(m).map(b => b.toString(16).padStart(2,"0")).join(""));

/** @param {Uint8Array} m @returns {string} */
const macToStr = (m) => Array.from(m).map(b => b.toString(16).padStart(2,"0")).join(":");

/** @param {string} s @returns {Uint8Array} */
const strToMac = (s) => new Uint8Array(s.split(":").map(h => parseInt(h,16)));

const BCAST_MAC = new Uint8Array([0xff,0xff,0xff,0xff,0xff,0xff]);

/** random locally-administered unicast MAC */
function randomMac() {
    const m = new Uint8Array(6);
    m[0] = 0xAA;
    for (let i = 1; i < 6; i++) m[i] = Math.floor(Math.random() * 256);
    return m;
}

// ── HomeRouter ─────────────────────────────────────────────────────────────

export class HomeRouter extends SimulatedObject {

    kind = "HomeRouter";
    icon = "fa-house-signal";

    // ── Ports ─────────────────────────────────────────────────────────────

    /** @type {EthernetPort} */ wan0;
    /** @type {EthernetPort} */ eth1;
    /** @type {EthernetPort} */ eth2;
    /** @type {EthernetPort} */ eth3;
    /** @type {EthernetPort} */ eth4;
    /** @type {WirelessPort} */ _wPort;

    // ── MACs ──────────────────────────────────────────────────────────────
    /** @type {Uint8Array} */ _wanMac;
    /** @type {Uint8Array} */ _lanMac;

    // ── Network config ────────────────────────────────────────────────────
    /** "static"|"dhcp" */ _wanMode = "static";
    /** uint32 */ _wanIp = 0;
    /** 0..32  */ _wanPrefix = 24;
    /** uint32 */ _wanGw = 0;
    /** uint32 */ _upstreamDns = 0;
    /** uint32 */ _lanIp = (192<<24|168<<16|1<<8|1) >>> 0;
    /** 0..32  */ _lanPrefix = 24;

    // ── SSID ──────────────────────────────────────────────────────────────
    /** @type {string} */ _ssid = "HomeNetwork";

    // ── DHCP server ───────────────────────────────────────────────────────
    _dhcpEnabled = true;
    /** uint32 */ _dhcpRangeStart = (192<<24|168<<16|1<<8|100) >>> 0;
    /** uint32 */ _dhcpRangeEnd   = (192<<24|168<<16|1<<8|200) >>> 0;
    _dhcpLeaseTime = 3600;
    /** @type {Map<string,{ipNum:number,ipBytes:Uint8Array,expiresAt:number}>} */
    _dhcpLeases = new Map();
    /** @type {Set<number>} */ _dhcpAllocated = new Set();

    // ── L2 bridge (LAN) ───────────────────────────────────────────────────
    /** port each MAC was last seen on @type {Map<bigint,EthernetPort>} */
    _lanMacTable = new Map();

    // ── ARP caches ────────────────────────────────────────────────────────
    /** @type {Map<number,Uint8Array>} ip→mac */
    _lanArpCache = new Map();

    // ── NAT ───────────────────────────────────────────────────────────────
    /** @type {NatEngine} */ _nat = new NatEngine();

    // ── Port Forwarding (DNAT) ────────────────────────────────────────────
    /** @type {Array<{proto:number, wanPort:number, lanIp:number, lanPort:number}>} */
    _portRules = [];

    // ── DNS relay ─────────────────────────────────────────────────────────
    /** @type {Map<number,{clientIpNum:number,clientPort:number,origId:number,expiresAt:number}>} */
    _dnsRelayTable = new Map();
    _nextDnsRelayId = 0x8000;

    // ── WAN DHCP client ───────────────────────────────────────────────────
    /** @type {((pkt:DHCPPacket)=>void)|null} */
    _wanDhcpCallback = null;
    _wanDhcpXid = 0;

    // ── WAN DHCPv6-PD client ──────────────────────────────────────────────
    /** @type {((pkt:DHCPv6Packet)=>void)|null} */
    _wanDhcpv6PdCallback = null;
    /** @type {Uint8Array} 3-byte transaction ID */ _wanDhcpv6TxId = new Uint8Array(3);
    /** @type {{prefix16bytes:Uint8Array,prefixLen:number}|null} */ _wanDhcpv6PdDelegated = null;

    // ── LAN IPv6 (from PD) ────────────────────────────────────────────────
    /** @type {Uint8Array|null} 16-byte router LAN IPv6 (prefix::1) */ _lanIp6 = null;
    /** @type {Uint8Array|null} 16-byte LAN RA prefix (host bits zeroed) */ _lanRaPrefix = null;
    _raTimer = new PollTimer();

    // ── Dual-Stack / IPv6 WAN ─────────────────────────────────────────────
    /** DHCPv6-PD enabled independently of IPv4 WAN mode */
    _wanIp6Enabled = false;
    /** @type {Uint8Array|null} WAN-side IPv6 default gateway (link-local, learned) */
    _wanGw6 = null;
    /** @type {Map<string,Uint8Array>} WAN NDP cache: hex-key → MAC */
    _wanNdpCache = new Map();
    /** @type {Map<string,Uint8Array>} LAN NDP cache: hex-key → MAC */
    _lanNdpCache = new Map();

    // ── WAN IPStack engine ────────────────────────────────────────────────
    /** @type {IPStack} */ _wanStack;
    /** Internal bridge port: IPStack egress → wan0 @type {EthernetPort} */ _wanBridgePort;

    // ── LAN IPStack engine ────────────────────────────────────────────────
    /** @type {IPStack} */ _lanStack;
    /** Internal bridge port: IPStack egress → physical LAN ports @type {EthernetPort} */ _lanBridgePort;

    // ── Panel ─────────────────────────────────────────────────────────────
    /** @type {HTMLElement|null} */ _panelBody = null;
    _pollTimer = new PollTimer();
    /** @type {HTMLElement|null} */ _statusEl = null;
    /** @type {HTMLElement|null} */ _natEl = null;
    /** @type {string} */ _activeTab = "status";

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(name = t("homerouter.title")) {
        super(name);

        this._wanMac = randomMac();
        this._lanMac = randomMac();

        this.wan0 = new EthernetPort("wan0");
        this.eth1 = new EthernetPort("eth1");
        this.eth2 = new EthernetPort("eth2");
        this.eth3 = new EthernetPort("eth3");
        this.eth4 = new EthernetPort("eth4");
        this._wPort = new WirelessPort("wlan0");

        for (const p of this._allPorts()) p.subscribe(/** @type {any} */ (this));

        // WAN IPStack: handles ARP resolution, TTL decrement, fragmentation for LAN→WAN routing
        this._wanBridgePort = new EthernetPort("wan-bridge");
        this._wanStack = new IPStack(0, "wan");
        const _wanIf = new NetworkInterface({ port: this._wanBridgePort, name: "wan0", mac: this._wanMac });
        this._wanStack.interfaces.push(_wanIf);
        _wanIf.subscribe(this._wanStack);
        this._wanStack.forwarding = true;
        this._wanBridgePort.subscribe(/** @type {any} */ (this));

        // LAN IPStack: handles ICMP echo, fragment reassembly, DHCP and DNS relay for router-destined LAN packets
        this._lanBridgePort = new EthernetPort("lan-bridge");
        this._lanStack = new IPStack(0, "lan");
        const _lanIf = new NetworkInterface({ port: this._lanBridgePort, name: "lan0", mac: this._lanMac });
        this._lanStack.interfaces.push(_lanIf);
        _lanIf.subscribe(this._lanStack);
        this._lanStack.configureInterface(0, { ip: numToIp(this._lanIp), prefixLength: this._lanPrefix });

        // DHCP server + DNS relay: registered as protocol handler so IPStack's accept() dispatches to them
        this._lanBridgePort.subscribe(/** @type {any} */ (this));

        this.onPanelCreated = (/** @type {HTMLElement} */ body) => {
            this._panelBody = body;
            this._mount(body);
        };
    }

    // ── Port API ──────────────────────────────────────────────────────────

    listPorts() {
        return [
            { key: "wan0", label: "WAN", port: this.wan0 },
            { key: "eth1", label: "LAN 1", port: this.eth1 },
            { key: "eth2", label: "LAN 2", port: this.eth2 },
            { key: "eth3", label: "LAN 3", port: this.eth3 },
            { key: "eth4", label: "LAN 4", port: this.eth4 },
        ];
    }

    /** @param {string} key */
    getPortByKey(key) {
        switch (key) {
            case "wan0": return this.wan0;
            case "eth1": return this.eth1;
            case "eth2": return this.eth2;
            case "eth3": return this.eth3;
            case "eth4": return this.eth4;
            default: return null;
        }
    }

    /** @returns {EthernetPort[]} all ports including WiFi */
    _allPorts() { return [this.wan0, this.eth1, this.eth2, this.eth3, this.eth4, this._wPort]; }
    /** @returns {(EthernetPort|WirelessPort)[]} LAN bridge members */
    _lanPorts() { return [this.eth1, this.eth2, this.eth3, this.eth4, this._wPort]; }

    // ── Observable update() ───────────────────────────────────────────────

    update() {
        // WAN ingress
        let f;
        while ((f = this.wan0.getNextIncomingFrame()) != null) {
            try { this._handleWanFrame(f); } catch {}
        }
        // Bridge WAN stack egress (ARP requests, routed IP packets) to the physical WAN port
        while ((f = this._wanBridgePort.outBuffer.shift()) != null) {
            this.wan0.send(f);
        }
        // LAN bridge
        for (const p of this._lanPorts()) {
            while ((f = /** @type {EthernetPort} */ (p).getNextIncomingFrame()) != null) {
                try { this._handleLanFrame(/** @type {EthernetPort} */ (p), f); } catch {}
            }
        }
        // Bridge LAN stack egress (ICMP replies, DHCP responses) to physical LAN ports
        this._lanStack.update();
        let ef;
        while ((ef = this._lanBridgePort.outBuffer.shift()) != null) {
            this._forwardEgressFrame(ef);
        }
    }

    // ── WAN frame processing ──────────────────────────────────────────────

    /** @param {EthernetFrame} frame */
    _handleWanFrame(frame) {
        if (frame.etherType === 0x86DD) {
            try {
                const ipv6 = IPv6Packet.fromBytes(frame.payload);
                this._handleWanIpv6(ipv6, frame);
            } catch {}
            return;
        }
        if (frame.etherType === 0x0806) {
            const arp = ArpPacket.fromBytes(frame.payload);
            const spaNum = IPUInt8ToNumber(arp.spa);
            if (spaNum) {
                // Keep WAN stack's neighbor cache in sync so resolveNeighbor() finds the MAC
                const wanIf = this._wanStack.interfaces[0];
                if (wanIf) wanIf.neighborCache.set(new IPAddress(4, spaNum >>> 0).toString(), arp.sha.slice());
            }

            if (arp.oper === 1 && this._wanIp && IPUInt8ToNumber(arp.tpa) === this._wanIp) {
                this._sendArpReply(this.wan0, this._wanMac, this._wanIp, arp);
            }
        } else if (frame.etherType === 0x0800) {
            const pkt = IPv4Packet.fromBytes(frame.payload);
            const dstNum = ipNum(pkt.dst);
            if (dstNum !== this._wanIp && dstNum !== 0xFFFFFFFF) return;

            const proto = pkt.protocol;
            if (proto === 17) {
                const udp = UDPPacket.fromBytes(pkt.payload);
                // WAN DHCP responses
                if (udp.srcPort === 67 && udp.dstPort === 68) {
                    this._handleWanDhcpResponse(udp.payload);
                    return;
                }
                // DNS relay response (our relay port = 5353)
                if (udp.srcPort === 53 && udp.dstPort === 5353) {
                    this._handleDnsRelayResponse(pkt, udp);
                    return;
                }
                // Port forwarding (DNAT) check before stateful un-NAT
                const pfRuleUdp = this._matchPortRule(17, udp.dstPort);
                if (pfRuleUdp) {
                    if (this._nat.dnat(pkt, pfRuleUdp.lanIp, pfRuleUdp.lanPort)) {
                        this._nat.installDnatSession(17, pfRuleUdp.wanPort, pfRuleUdp.lanIp, pfRuleUdp.lanPort);
                        void this._forwardToLan(pkt, pfRuleUdp.lanIp);
                    }
                    return;
                }
                // Regular inbound NAT (TCP/UDP response)
                const origSrc = this._nat.natInbound(pkt);
                if (origSrc) void this._forwardToLan(pkt, origSrc);
            } else if (proto === 6) {
                // Port forwarding (DNAT) check before stateful un-NAT
                try {
                    const tcp = TCPPacket.fromBytes(pkt.payload);
                    const pfRuleTcp = this._matchPortRule(6, tcp.dstPort);
                    if (pfRuleTcp) {
                        if (this._nat.dnat(pkt, pfRuleTcp.lanIp, pfRuleTcp.lanPort)) {
                            this._nat.installDnatSession(6, pfRuleTcp.wanPort, pfRuleTcp.lanIp, pfRuleTcp.lanPort);
                            void this._forwardToLan(pkt, pfRuleTcp.lanIp);
                        }
                        return;
                    }
                } catch {}
                const origSrc = this._nat.natInbound(pkt);
                if (origSrc) void this._forwardToLan(pkt, origSrc);
            } else if (proto === 1) {
                // ICMP: could be echo reply (NAT'd) or error
                const origSrc = this._nat.natInbound(pkt);
                if (origSrc) void this._forwardToLan(pkt, origSrc);
            }
        }
    }

    /**
     * Find the first port forwarding rule matching a given protocol and WAN destination port.
     * proto 0 matches both TCP and UDP.
     * @param {number} proto 6=TCP, 17=UDP
     * @param {number} dstPort
     * @returns {{proto:number, wanPort:number, lanIp:number, lanPort:number}|null}
     */
    _matchPortRule(proto, dstPort) {
        for (const r of this._portRules) {
            if ((r.proto === 0 || r.proto === proto) && r.wanPort === dstPort) return r;
        }
        return null;
    }

    // ── LAN frame processing ──────────────────────────────────────────────

    /**
     * @param {EthernetPort} srcPort
     * @param {EthernetFrame} frame
     */
    _handleLanFrame(srcPort, frame) {
        // L2 MAC learning
        this._lanMacTable.set(macToBig(frame.srcMac), srcPort);

        const forRouter    = isEqualUint8(frame.dstMac, this._lanMac);
        const isBcast      = isEqualUint8(frame.dstMac, BCAST_MAC);
        const isIpv6Mcast  = frame.dstMac[0] === 0x33 && frame.dstMac[1] === 0x33;

        if (forRouter || isBcast || isIpv6Mcast) {
            this._handleLanL3(frame, srcPort);
        }

        if (!forRouter) {
            if (isBcast || isIpv6Mcast) {
                this._lanFlood(srcPort, frame);
            } else {
                this._lanForward(srcPort, frame);
            }
        }
    }

    /**
     * @param {EthernetFrame} frame
     * @param {EthernetPort} srcPort
     */
    _handleLanL3(frame, srcPort) {
        if (frame.etherType === 0x0806) {
            const arp = ArpPacket.fromBytes(frame.payload);
            const spa = IPUInt8ToNumber(arp.spa);
            if (spa) {
                this._lanArpCache.set(spa, arp.sha.slice());
                this._lanMacTable.set(macToBig(arp.sha), srcPort);
                // Keep LAN stack's neighbor cache in sync so it can reply without ARP roundtrips
                const lanIf = this._lanStack?.interfaces[0];
                if (lanIf) lanIf.neighborCache.set(new IPAddress(4, spa >>> 0).toString(), arp.sha.slice());
            }
            if (arp.oper === 1 && IPUInt8ToNumber(arp.tpa) === this._lanIp) {
                this._sendArpReply(srcPort, this._lanMac, this._lanIp, arp);
            }
        } else if (frame.etherType === 0x0800) {
            const pkt = IPv4Packet.fromBytes(frame.payload);
            const srcIpN = ipNum(pkt.src);
            if (srcIpN) {
                this._lanArpCache.set(srcIpN, frame.srcMac.slice());
                this._lanMacTable.set(macToBig(frame.srcMac), srcPort);
                const lanIf = this._lanStack?.interfaces[0];
                if (lanIf) lanIf.neighborCache.set(pkt.src.toString(), frame.srcMac.slice());
            }
            this._handleLanIpv4(pkt, frame.srcMac, srcPort);
        } else if (frame.etherType === 0x86DD) {
            try {
                const ipv6 = IPv6Packet.fromBytes(frame.payload);
                const srcBytes = ipv6.src.toUInt8();
                if (!srcBytes.every(b => b === 0)) {
                    this._lanNdpCache.set(bytes6ToKey(srcBytes), frame.srcMac.slice());
                }
                this._handleLanIpv6(ipv6, frame.srcMac, srcPort);
            } catch {}
        }
    }

    /**
     * @param {IPv4Packet} pkt
     * @param {Uint8Array} srcMac
     * @param {EthernetPort} srcPort
     */
    _handleLanIpv4(pkt, srcMac, srcPort) {
        const dstNum = ipNum(pkt.dst);
        const forUs = (dstNum === this._lanIp) || (dstNum === 0xFFFFFFFF) ||
                      (this._lanIp && dstNum === ((this._lanIp | ~prefixToNetmask(this._lanPrefix)) >>> 0));

        if (forUs) {
            if (pkt.protocol === 1) {
                // ICMP: stack handles fragment reassembly + echo replies
                this._lanStack.route(pkt, false, 0).catch(() => {});
            } else if (pkt.protocol === 17) {
                // UDP: accept() dispatches proto 17 to UdpEngine, bypassing _rawProtoHandlers.
                // Handle DHCP/DNS explicitly; fragmented DHCP/DNS is not realistic.
                try {
                    const udp = UDPPacket.fromBytes(pkt.payload);
                    if (this._dhcpEnabled && udp.dstPort === 67) {
                        this._handleDhcpQuery(pkt, udp, srcMac, srcPort);
                    } else if (udp.dstPort === 53 && this._upstreamDns) {
                        this._handleDnsQuery(pkt, udp, srcMac);
                    }
                } catch {}
            }
        } else {
            if (this._wanIp && pkt.ttl > 1) {
                void this._routeLanToWan(pkt);
            }
        }
    }

    /**
     * Forward a frame generated by _lanStack to the correct LAN port.
     * @param {EthernetFrame} frame
     */
    _forwardEgressFrame(frame) {
        const key = macToBig(frame.dstMac);
        const port = this._lanMacTable.get(key);
        if (port) port.send(frame);
        else this._lanFlood(/** @type {any} */ (null), frame);
    }

    // ── LAN IPv6 processing ───────────────────────────────────────────────

    /**
     * @param {IPv6Packet} ipv6
     * @param {Uint8Array} srcMac
     * @param {EthernetPort} srcPort
     */
    _handleLanIpv6(ipv6, srcMac, srcPort) {
        const dst   = ipv6.dst.toUInt8();
        const myLl  = this._lanLinkLocalBytes();
        const myGlb = this._lanIp6;

        const isMyLl     = dst.every((b, i) => b === myLl[i]);
        const isMyGlb    = !!myGlb && dst.every((b, i) => b === myGlb[i]);
        const isSolNode  = dst[0] === 0xff && dst[1] === 0x02 &&
            dst[11] === 0x00 && dst[12] === 0x01 && dst[13] === 0xff &&
            dst[14] === myLl[14] && dst[15] === myLl[15];
        const isMcast    = dst[0] === 0xff;

        const forUs = isMyLl || isMyGlb || isSolNode || isMcast;

        if (forUs && ipv6.nextHeader === 58) {
            try {
                const icmp = ICMPv6Packet.fromBytes(ipv6.payload);
                if (icmp.type === 135) {
                    const targetB = icmp.ndpTarget?.toUInt8();
                    if (targetB) {
                        const isLl  = targetB.every((b, i) => b === myLl[i]);
                        const isGlb = !!myGlb && targetB.every((b, i) => b === myGlb[i]);
                        if (isLl || isGlb) {
                            const replyFrom = IPAddress.fromUInt8(isGlb ? myGlb : myLl);
                            const na = ICMPv6Packet.buildNA(replyFrom, this._lanMac, true);
                            const naBytes = na.pack(replyFrom, ipv6.src);
                            const rep6 = new IPv6Packet({ src: replyFrom, dst: ipv6.src, nextHeader: 58, hopLimit: 255, payload: naBytes });
                            srcPort.send(new EthernetFrame({ dstMac: srcMac, srcMac: this._lanMac, etherType: 0x86DD, payload: rep6.pack() }));
                        }
                    }
                } else if (icmp.type === 136) {
                    const targetB = icmp.ndpTarget?.toUInt8();
                    if (targetB) this._lanNdpCache.set(bytes6ToKey(targetB), srcMac.slice());
                }
            } catch {}
            return;
        }

        if (!forUs && this._wanDhcpv6PdDelegated && ipv6.hopLimit > 1) {
            void this._routeLanToWanIpv6(ipv6);
        }
    }

    // ── Routing: LAN → WAN ────────────────────────────────────────────────

    /** @param {IPv4Packet} pkt */
    async _routeLanToWan(pkt) {
        if (!this._wanIp) return;
        const ok = this._nat.natOutbound(this._wanIp, pkt);
        if (!ok) return;
        // IPStack handles TTL decrement, ARP resolution, fragmentation, and sending
        await this._wanStack.route(pkt, false, 0);
    }

    // ── WAN stack configuration ───────────────────────────────────────────

    /** Sync WAN IP/prefix/gateway into _wanStack after any WAN config change. */
    _applyLanConfig() {
        this._lanStack.configureInterface(0, { ip: numToIp(this._lanIp), prefixLength: this._lanPrefix });
    }

    _applyWanConfig() {
        const wanIf = this._wanStack.interfaces[0];
        if (!wanIf) return;

        if (this._wanIp) {
            this._wanStack.configureInterface(0, {
                ip: numToIp(this._wanIp),
                prefixLength: this._wanPrefix,
            });
            // Replace default route with current gateway
            this._wanStack.routingTable = this._wanStack.routingTable.filter(r => r.auto);
            if (this._wanGw) {
                this._wanStack.addRoute(
                    IPAddress.fromString("0.0.0.0"), 0, 0,
                    numToIp(this._wanGw), "static"
                );
            }
        } else {
            this._wanStack.configureInterface(0, {
                ip: IPAddress.fromString("0.0.0.0"),
                prefixLength: 24,
            });
            this._wanStack.routingTable = this._wanStack.routingTable.filter(r => r.auto);
        }
    }

    // ── Routing: WAN → LAN ───────────────────────────────────────────────

    /**
     * Forward an inbound (un-NAT'd) packet to a LAN host.
     * @param {IPv4Packet} pkt
     * @param {number} dstIpNum
     */
    async _forwardToLan(pkt, dstIpNum) {
        if (pkt.ttl <= 1) return;
        pkt.ttl--;
        pkt.headerChecksum = 0;

        const mac = await this._resolveArpLan(dstIpNum);
        if (!mac) return;

        const frame = new EthernetFrame({ dstMac: mac, srcMac: this._lanMac, etherType: 0x0800, payload: pkt.pack() });
        this._sendToLanHost(macToBig(mac), frame);
    }

    /** @param {IPv6Packet} ipv6 */
    async _routeLanToWanIpv6(ipv6) {
        if (!this._wanDhcpv6PdDelegated || !this._wanGw6) return;
        ipv6.hopLimit--;
        const mac = await this._resolveNdpWan(this._wanGw6);
        if (!mac) return;
        this.wan0.send(new EthernetFrame({ dstMac: mac, srcMac: this._wanMac, etherType: 0x86DD, payload: ipv6.pack() }));
    }

    /** @param {IPv6Packet} ipv6 */
    async _forwardToLanIpv6(ipv6) {
        if (ipv6.hopLimit <= 1) return;
        ipv6.hopLimit--;
        const dstBytes = ipv6.dst.toUInt8();
        const mac = await this._resolveNdpLan(dstBytes);
        if (!mac) return;
        const frame = new EthernetFrame({ dstMac: mac, srcMac: this._lanMac, etherType: 0x86DD, payload: ipv6.pack() });
        this._sendToLanHost(macToBig(mac), frame);
    }

    // ── ARP resolution ────────────────────────────────────────────────────

    /** @param {number} ipNum @returns {Promise<Uint8Array|null>} */
    async _resolveArpLan(ipNum) {
        const cached = this._lanArpCache.get(ipNum);
        if (cached) return cached;

        this._sendArpRequest(ipNum, this._lanIp, this._lanMac, "lan");

        for (let i = 0; i < SimTimer.ARP_WAIT_RETRIES; i++) {
            await simTimer.sleep(SimTimer.ARP_RETRY_DELAY_MS);
            const m = this._lanArpCache.get(ipNum);
            if (m) return m;
        }
        return null;
    }

/**
     * @param {number} targetIp
     * @param {number} senderIp
     * @param {Uint8Array} senderMac
     * @param {"lan"|"wan"} side
     */
    _sendArpRequest(targetIp, senderIp, senderMac, side) {
        const arp = new ArpPacket({ oper: 1, sha: senderMac, spa: IPNumberToUint8(senderIp), tha: new Uint8Array(6), tpa: IPNumberToUint8(targetIp) });
        const frame = new EthernetFrame({ dstMac: BCAST_MAC, srcMac: senderMac, etherType: 0x0806, payload: arp.pack() });
        if (side === "wan") {
            this.wan0.send(frame);
        } else {
            for (const p of this._lanPorts()) p.send(frame);
        }
    }

    /**
     * @param {EthernetPort} port
     * @param {Uint8Array} myMac
     * @param {number} myIp
     * @param {ArpPacket} req
     */
    _sendArpReply(port, myMac, myIp, req) {
        const reply = new ArpPacket({ oper: 2, sha: myMac, spa: IPNumberToUint8(myIp), tha: req.sha, tpa: req.spa });
        const frame = new EthernetFrame({ dstMac: req.sha, srcMac: myMac, etherType: 0x0806, payload: reply.pack() });
        port.send(frame);
    }

    // ── NDP resolution ───────────────────────────────────────────────────

    /** @param {Uint8Array} targetBytes @returns {Promise<Uint8Array|null>} */
    async _resolveNdpWan(targetBytes) {
        const key = bytes6ToKey(targetBytes);
        const cached = this._wanNdpCache.get(key);
        if (cached) return cached;
        this._sendNdpNs(targetBytes, this._wanLinkLocalBytes(), this._wanMac, "wan");
        for (let i = 0; i < SimTimer.ARP_WAIT_RETRIES; i++) {
            await simTimer.sleep(SimTimer.ARP_RETRY_DELAY_MS);
            const m = this._wanNdpCache.get(key);
            if (m) return m;
        }
        return null;
    }

    /** @param {Uint8Array} targetBytes @returns {Promise<Uint8Array|null>} */
    async _resolveNdpLan(targetBytes) {
        const key = bytes6ToKey(targetBytes);
        const cached = this._lanNdpCache.get(key);
        if (cached) return cached;
        const srcIp6 = this._lanIp6 ?? this._lanLinkLocalBytes();
        this._sendNdpNs(targetBytes, srcIp6, this._lanMac, "lan");
        for (let i = 0; i < SimTimer.ARP_WAIT_RETRIES; i++) {
            await simTimer.sleep(SimTimer.ARP_RETRY_DELAY_MS);
            const m = this._lanNdpCache.get(key);
            if (m) return m;
        }
        return null;
    }

    /**
     * @param {Uint8Array} targetBytes
     * @param {Uint8Array} srcIp6Bytes
     * @param {Uint8Array} srcMac
     * @param {"lan"|"wan"} side
     */
    _sendNdpNs(targetBytes, srcIp6Bytes, srcMac, side) {
        const srcIp = IPAddress.fromUInt8(srcIp6Bytes);
        const target = IPAddress.fromUInt8(targetBytes);
        if (!srcIp || !target) return;
        const snm = new Uint8Array([0xff,0x02,0,0,0,0,0,0,0,0,0,1,0xff,
            targetBytes[13], targetBytes[14], targetBytes[15]]);
        const dstIp  = IPAddress.fromUInt8(snm);
        const dstMac = new Uint8Array([0x33,0x33,0xff, targetBytes[13], targetBytes[14], targetBytes[15]]);
        if (!dstIp) return;
        const ns = ICMPv6Packet.buildNS(target, srcMac);
        const nsBytes = ns.pack(srcIp, dstIp);
        const ipv6 = new IPv6Packet({ src: srcIp, dst: dstIp, nextHeader: 58, hopLimit: 255, payload: nsBytes });
        const frame = new EthernetFrame({ dstMac, srcMac, etherType: 0x86DD, payload: ipv6.pack() });
        if (side === "wan") this.wan0.send(frame);
        else for (const p of this._lanPorts()) p.send(frame);
    }

    /** @param {Uint8Array} ip6bytes @returns {boolean} */
    _isInLanPrefix(ip6bytes) {
        if (!this._lanRaPrefix) return false;
        for (let i = 0; i < 8; i++) {
            if (ip6bytes[i] !== this._lanRaPrefix[i]) return false;
        }
        return true;
    }

    // ── L2 bridge helpers ─────────────────────────────────────────────────

    /**
     * @param {EthernetPort} srcPort
     * @param {EthernetFrame} frame
     */
    _lanFlood(srcPort, frame) {
        for (const p of this._lanPorts()) {
            if (p !== srcPort) p.send(frame);
        }
    }

    /**
     * Forward to known port or flood if unknown.
     * @param {EthernetPort} srcPort
     * @param {EthernetFrame} frame
     */
    _lanForward(srcPort, frame) {
        const dstKey = macToBig(frame.dstMac);
        const dstPort = this._lanMacTable.get(dstKey);
        if (dstPort && dstPort !== srcPort) {
            dstPort.send(frame);
        } else if (!dstPort) {
            this._lanFlood(srcPort, frame);
        }
    }

    /**
     * Send to known port via MAC, or flood.
     * @param {bigint} macBig
     * @param {EthernetFrame} frame
     */
    _sendToLanHost(macBig, frame) {
        const port = this._lanMacTable.get(macBig);
        if (port) {
            port.send(frame);
        } else {
            for (const p of this._lanPorts()) p.send(frame);
        }
    }

    // ── DHCP server ───────────────────────────────────────────────────────

    /**
     * @param {IPv4Packet} pkt
     * @param {UDPPacket} udp
     * @param {Uint8Array} srcMac
     * @param {EthernetPort} srcPort
     */
    _handleDhcpQuery(pkt, udp, srcMac, srcPort) {
        let dh;
        try { dh = DHCPPacket.fromBytes(udp.payload); } catch { return; }

        const mt = dh.getMessageType();
        if (!mt) return;

        const mac6 = dh.getClientMAC();
        const macKey = String(MACToNumber(mac6));

        this._dhcpCleanup();

        const serverIdU32 = this._lanIp;
        const gwU32 = this._lanIp;
        const maskU32 = prefixToNetmask(this._lanPrefix);
        // DNS: prefer upstream DNS; fallback to router itself (DNS relay)
        const dnsU32 = this._upstreamDns || this._lanIp;

        const bcastIp = numToIp(0xFFFFFFFF);

        if (mt === DHCPPacket.MT_DISCOVER) {
            const lease = this._dhcpAllocOrReuse(macKey);
            if (!lease) return;

            const offer = this._dhcpMakeReply(dh, lease.ipBytes, serverIdU32);
            offer.setMessageType(DHCPPacket.MT_OFFER);
            this._dhcpFillOpts(offer, maskU32, gwU32, dnsU32);
            this._dhcpSendLan(offer, bcastIp);
        } else if (mt === DHCPPacket.MT_REQUEST) {
            const opt50 = dh.getOption(DHCPPacket.OPT_REQUESTED_IP);
            const requestedNum = (opt50?.length === 4) ? IPUInt8ToNumber(opt50) : IPUInt8ToNumber(dh.ciaddr);
            const existing = this._dhcpLeases.get(macKey);
            const chosen = (existing ? existing.ipNum : requestedNum) >>> 0;

            const inRange = chosen >= this._dhcpRangeStart && chosen <= this._dhcpRangeEnd;
            const freeOrMine = !this._dhcpAllocated.has(chosen) || (!!existing && existing.ipNum === chosen);

            if (!inRange || !freeOrMine) {
                const nak = this._dhcpMakeReply(dh, IPNumberToUint8(0), serverIdU32);
                nak.setMessageType(DHCPPacket.MT_NAK);
                nak.setOption(DHCPPacket.OPT_SERVER_ID, IPNumberToUint8(serverIdU32));
                this._dhcpSendLan(nak, bcastIp);
                return;
            }

            const lease = this._dhcpCommit(macKey, chosen);
            const ack = this._dhcpMakeReply(dh, lease.ipBytes, serverIdU32);
            ack.setMessageType(DHCPPacket.MT_ACK);
            this._dhcpFillOpts(ack, maskU32, gwU32, dnsU32);
            this._dhcpSendLan(ack, bcastIp);
        } else if (mt === DHCPPacket.MT_RELEASE) {
            const l = this._dhcpLeases.get(macKey);
            if (l) { this._dhcpLeases.delete(macKey); this._dhcpAllocated.delete(l.ipNum); }
        }
    }

    /** @param {string} macKey @returns {{ipNum:number,ipBytes:Uint8Array,expiresAt:number}|null} */
    _dhcpAllocOrReuse(macKey) {
        const ex = this._dhcpLeases.get(macKey);
        if (ex && ex.expiresAt > Date.now()) return ex;

        for (let ip = this._dhcpRangeStart; ip <= this._dhcpRangeEnd; ip = (ip+1)>>>0) {
            if (!this._dhcpAllocated.has(ip)) {
                const tmp = { ipNum: ip, ipBytes: IPNumberToUint8(ip), expiresAt: Date.now() + 60_000 };
                this._dhcpLeases.set(macKey, tmp);
                this._dhcpAllocated.add(ip);
                return tmp;
            }
        }
        return null;
    }

    /** @param {string} macKey @param {number} ipNum */
    _dhcpCommit(macKey, ipNum) {
        const prev = this._dhcpLeases.get(macKey);
        if (prev && prev.ipNum !== ipNum) this._dhcpAllocated.delete(prev.ipNum);
        this._dhcpAllocated.add(ipNum);
        const lease = { ipNum, ipBytes: IPNumberToUint8(ipNum), expiresAt: Date.now() + this._dhcpLeaseTime * 1000 };
        this._dhcpLeases.set(macKey, lease);
        return lease;
    }

    _dhcpCleanup() {
        const now = Date.now();
        for (const [mac, lease] of this._dhcpLeases) {
            if (lease.expiresAt <= now) { this._dhcpLeases.delete(mac); this._dhcpAllocated.delete(lease.ipNum); }
        }
    }

    /** @param {DHCPPacket} req @param {Uint8Array} yiaddr @param {number} serverIdU32 */
    _dhcpMakeReply(req, yiaddr, serverIdU32) {
        const rep = new DHCPPacket({
            op: 2, htype: req.htype, hlen: req.hlen, hops: 0, xid: req.xid,
            secs: 0, flags: req.flags, ciaddr: IPNumberToUint8(0), yiaddr,
            siaddr: IPNumberToUint8(serverIdU32), giaddr: IPNumberToUint8(0),
            chaddr: req.chaddr.slice(0, 16), sname: new Uint8Array(64), file: new Uint8Array(128), options: [],
        });
        rep.setOption(DHCPPacket.OPT_SERVER_ID, IPNumberToUint8(serverIdU32));
        return rep;
    }

    /** @param {DHCPPacket} p @param {number} mask @param {number} gw @param {number} dns */
    _dhcpFillOpts(p, mask, gw, dns) {
        p.setOption(DHCPPacket.OPT_SUBNET_MASK, IPNumberToUint8(mask));
        p.setOption(DHCPPacket.OPT_ROUTER, IPNumberToUint8(gw));
        p.setOption(DHCPPacket.OPT_DNS, IPNumberToUint8(dns));
        p.setOption(DHCPPacket.OPT_LEASE_TIME, IPNumberToUint8(this._dhcpLeaseTime));
    }

    /** @param {DHCPPacket} pkt @param {IPAddress} dstIp */
    _dhcpSendLan(pkt, dstIp) {
        const udp = new UDPPacket({ srcPort: 67, dstPort: 68, payload: pkt.pack() });
        const ip = new IPv4Packet({ src: numToIp(this._lanIp), dst: dstIp, protocol: 17, ttl: 64, payload: udp.pack({ srcIp: numToIp(this._lanIp), dstIp }) });
        const frame = new EthernetFrame({ dstMac: BCAST_MAC, srcMac: this._lanMac, etherType: 0x0800, payload: ip.pack() });
        for (const p of this._lanPorts()) p.send(frame);
    }

    // ── WAN DHCP client ───────────────────────────────────────────────────

    /** @param {Uint8Array} payload */
    _handleWanDhcpResponse(payload) {
        try {
            const dh = DHCPPacket.fromBytes(payload);
            if (dh.xid !== this._wanDhcpXid) return;
            if (this._wanDhcpCallback) {
                this._wanDhcpCallback(dh);
                this._wanDhcpCallback = null;
            }
        } catch {}
    }

    /** @returns {Promise<void>} */
    async _runWanDhcpClient() {
        this._wanIp = 0;
        this._wanGw = 0;
        this._upstreamDns = 0;
        this._nat.clear();

        this._wanDhcpXid = (Math.random() * 0xFFFFFFFF) >>> 0;

        const chaddr16 = new Uint8Array(16);
        chaddr16.set(this._wanMac, 0);

        // DISCOVER
        const discover = new DHCPPacket({
            op: 1, htype: 1, hlen: 6, hops: 0, xid: this._wanDhcpXid,
            secs: 0, flags: 0x8000, ciaddr: IPNumberToUint8(0), yiaddr: IPNumberToUint8(0),
            siaddr: IPNumberToUint8(0), giaddr: IPNumberToUint8(0),
            chaddr: chaddr16, sname: new Uint8Array(64), file: new Uint8Array(128), options: [],
        });
        discover.setMessageType(DHCPPacket.MT_DISCOVER);
        this._dhcpSendWan(discover);

        // Wait for OFFER
        let offer = null;
        try {
            offer = await new Promise((resolve, reject) => {
                const tid = simTimer.schedule(() => reject(new Error("timeout")), SimTimer.DHCP_OFFER_WAIT_MS);
                this._wanDhcpCallback = (pkt) => {
                    if (pkt.getMessageType() === DHCPPacket.MT_OFFER) { simTimer.cancel(tid); resolve(pkt); }
                    else { simTimer.cancel(tid); reject(new Error("not offer")); }
                };
            });
        } catch { this._updateStatusPanel(); return; }

        const offeredIp = IPUInt8ToNumber(offer.yiaddr);
        const opt54 = offer.getOption(DHCPPacket.OPT_SERVER_ID);
        const serverIdNum = opt54?.length === 4 ? IPUInt8ToNumber(opt54) : 0;
        const opt51 = offer.getOption(DHCPPacket.OPT_LEASE_TIME);
        const opt3  = offer.getOption(DHCPPacket.OPT_ROUTER);
        const opt6  = offer.getOption(DHCPPacket.OPT_DNS);
        const opt1  = offer.getOption(DHCPPacket.OPT_SUBNET_MASK);

        // REQUEST
        const request = new DHCPPacket({
            op: 1, htype: 1, hlen: 6, hops: 0, xid: this._wanDhcpXid,
            secs: 0, flags: 0x8000, ciaddr: IPNumberToUint8(0), yiaddr: IPNumberToUint8(0),
            siaddr: IPNumberToUint8(serverIdNum), giaddr: IPNumberToUint8(0),
            chaddr: chaddr16, sname: new Uint8Array(64), file: new Uint8Array(128), options: [],
        });
        request.setMessageType(DHCPPacket.MT_REQUEST);
        request.setOption(DHCPPacket.OPT_REQUESTED_IP, IPNumberToUint8(offeredIp));
        request.setOption(DHCPPacket.OPT_SERVER_ID, IPNumberToUint8(serverIdNum));
        this._dhcpSendWan(request);

        // Wait for ACK
        let ack = null;
        try {
            ack = await new Promise((resolve, reject) => {
                const tid = simTimer.schedule(() => reject(new Error("timeout")), SimTimer.DHCP_ACK_WAIT_MS);
                this._wanDhcpCallback = (pkt) => {
                    const mt = pkt.getMessageType();
                    if (mt === DHCPPacket.MT_ACK) { simTimer.cancel(tid); resolve(pkt); }
                    else { simTimer.cancel(tid); reject(new Error("nak")); }
                };
            });
        } catch { this._updateStatusPanel(); return; }

        // Apply config
        this._wanIp = offeredIp;
        if (opt1?.length === 4) {
            const maskNum = IPUInt8ToNumber(opt1);
            let bits = 0; let m = maskNum;
            for (let i=0; i<32; i++) { if ((m & 0x80000000) >>> 0) { bits++; m = (m<<1)>>>0; } else break; }
            this._wanPrefix = bits;
        }
        if (opt3?.length >= 4) this._wanGw = IPUInt8ToNumber(opt3.slice(0,4));
        if (opt6?.length >= 4) this._upstreamDns = IPUInt8ToNumber(opt6.slice(0,4));
        this._nat.clear();
        this._applyWanConfig();
        this._updateStatusPanel();
    }

    /** @param {DHCPPacket} pkt */
    _dhcpSendWan(pkt) {
        const udp = new UDPPacket({ srcPort: 68, dstPort: 67, payload: pkt.pack() });
        const srcIp = numToIp(0);
        const dstIp = numToIp(0xFFFFFFFF);
        const ip = new IPv4Packet({ src: srcIp, dst: dstIp, protocol: 17, ttl: 64, payload: udp.pack({ srcIp, dstIp }) });
        const frame = new EthernetFrame({ dstMac: BCAST_MAC, srcMac: this._wanMac, etherType: 0x0800, payload: ip.pack() });
        this.wan0.send(frame);
    }

    // ── WAN IPv6 / DHCPv6-PD ─────────────────────────────────────────────

    /** @returns {Uint8Array} 16-byte WAN link-local (EUI-64 from _wanMac) */
    _wanLinkLocalBytes() {
        const m = this._wanMac;
        return new Uint8Array([0xfe,0x80,0,0,0,0,0,0, m[0]^0x02, m[1], m[2], 0xff, 0xfe, m[3], m[4], m[5]]);
    }

    /** @returns {Uint8Array} 16-byte LAN link-local (EUI-64 from _lanMac) */
    _lanLinkLocalBytes() {
        const m = this._lanMac;
        return new Uint8Array([0xfe,0x80,0,0,0,0,0,0, m[0]^0x02, m[1], m[2], 0xff, 0xfe, m[3], m[4], m[5]]);
    }

    /**
     * Handle incoming IPv6 frame on WAN: learn gateway, NDP, DHCPv6, inbound forwarding.
     * @param {IPv6Packet} ipv6
     * @param {EthernetFrame} frame
     */
    _handleWanIpv6(ipv6, frame) {
        const myLl = this._wanLinkLocalBytes();
        const dstB = ipv6.dst.toUInt8();

        const isMyLl    = dstB.every((b, i) => b === myLl[i]);
        const isSolNode = dstB[0] === 0xff && dstB[1] === 0x02 &&
            dstB[11] === 0x00 && dstB[12] === 0x01 && dstB[13] === 0xff &&
            dstB[14] === myLl[14] && dstB[15] === myLl[15];
        const isAllNodes = dstB[0] === 0xff && dstB[1] === 0x02 && dstB[15] === 0x01;
        const isForLan   = this._isInLanPrefix(dstB);

        if (!isMyLl && !isSolNode && !isAllNodes && !isForLan) return;

        if (ipv6.nextHeader === 58) {
            try {
                const icmp = ICMPv6Packet.fromBytes(ipv6.payload);
                if (icmp.type === 134) {
                    // RA: learn WAN default gateway from the router's link-local source address
                    const srcB = ipv6.src.toUInt8();
                    if (!this._wanGw6 && srcB[0] === 0xfe && srcB[1] === 0x80) {
                        this._wanGw6 = srcB.slice();
                    }
                } else if (icmp.type === 135) {
                    // NS for our WAN link-local → reply with NA
                    const target = icmp.ndpTarget;
                    if (target && target.toUInt8().every((b, i) => b === myLl[i])) {
                        const srcIp = IPAddress.fromUInt8(myLl);
                        const na = ICMPv6Packet.buildNA(srcIp, this._wanMac, true);
                        const naBytes = na.pack(srcIp, ipv6.src);
                        const rep6 = new IPv6Packet({ src: srcIp, dst: ipv6.src, nextHeader: 58, hopLimit: 255, payload: naBytes });
                        this.wan0.send(new EthernetFrame({ dstMac: frame.srcMac, srcMac: this._wanMac, etherType: 0x86DD, payload: rep6.pack() }));
                    }
                } else if (icmp.type === 136) {
                    // NA → populate WAN NDP cache
                    const targetB = icmp.ndpTarget?.toUInt8();
                    if (targetB) this._wanNdpCache.set(bytes6ToKey(targetB), frame.srcMac.slice());
                }
            } catch {}
        } else if (ipv6.nextHeader === 17) {
            try {
                const udp = UDPPacket.fromBytes(ipv6.payload);
                if (udp.srcPort === 547 && udp.dstPort === 546) {
                    this._handleWanDhcpv6PdResponse(udp.payload);
                }
            } catch {}
        }

        // Forward inbound packet destined for a LAN host
        if (isForLan) {
            void this._forwardToLanIpv6(ipv6);
        }
    }

    /** @param {Uint8Array} payload */
    _handleWanDhcpv6PdResponse(payload) {
        try {
            const dh = DHCPv6Packet.fromBytes(payload);
            const tx = this._wanDhcpv6TxId;
            if (dh.transactionId[0] !== tx[0] || dh.transactionId[1] !== tx[1] || dh.transactionId[2] !== tx[2]) return;
            if (this._wanDhcpv6PdCallback) {
                const cb = this._wanDhcpv6PdCallback;
                this._wanDhcpv6PdCallback = null;
                cb(dh);
            }
        } catch {}
    }

    /** @returns {Promise<void>} */
    async _runWanDhcpv6PdClient() {
        this._wanDhcpv6PdDelegated = null;
        this._updateStatusPanel();

        const txId = new Uint8Array(3);
        crypto.getRandomValues(txId);
        this._wanDhcpv6TxId = txId;

        const iaid = 1;
        const clientDUID = DHCPv6Packet.buildDUID_LL(this._wanMac);

        // SOLICIT with IA_PD
        const solicit = new DHCPv6Packet({ msgType: DHCPv6Packet.MT_SOLICIT, transactionId: txId });
        solicit.setOption(DHCPv6Packet.OPT_CLIENTID, clientDUID);
        solicit.setOption(DHCPv6Packet.OPT_IA_PD, DHCPv6Packet.buildIA_PD(iaid, 0, 0, new Uint8Array(0)));
        this._dhcpv6PdSendWan(solicit);

        // Wait for ADVERTISE
        let advertise = /** @type {DHCPv6Packet|null} */ (null);
        try {
            advertise = await new Promise((resolve, reject) => {
                const tid = simTimer.schedule(() => reject(new Error("timeout")), SimTimer.DHCP_OFFER_WAIT_MS);
                this._wanDhcpv6PdCallback = (pkt) => { simTimer.cancel(tid); resolve(pkt); };
            });
        } catch { this._updateStatusPanel(); return; }
        if (!advertise || advertise.msgType !== DHCPv6Packet.MT_ADVERTISE) { this._updateStatusPanel(); return; }

        // Parse IAPREFIX from ADVERTISE's IA_PD
        const iaPDAdv = advertise.getOption(DHCPv6Packet.OPT_IA_PD);
        if (!iaPDAdv || iaPDAdv.length < 12) { this._updateStatusPanel(); return; }
        const parsedIaPD = DHCPv6Packet.parseIA_PD(iaPDAdv);

        let iaPrefixData = /** @type {Uint8Array|null} */ (null);
        let off = 0;
        while (off + 4 <= parsedIaPD.iaOptions.length) {
            const code = (parsedIaPD.iaOptions[off] << 8) | parsedIaPD.iaOptions[off + 1];
            const len  = (parsedIaPD.iaOptions[off + 2] << 8) | parsedIaPD.iaOptions[off + 3];
            off += 4;
            if (code === DHCPv6Packet.OPT_IAPREFIX && len >= 25) { iaPrefixData = parsedIaPD.iaOptions.slice(off, off + len); break; }
            off += len;
        }
        if (!iaPrefixData) { this._updateStatusPanel(); return; }
        const prefixInfo = DHCPv6Packet.parseIAPrefix(iaPrefixData);
        const serverDUID = advertise.getOption(DHCPv6Packet.OPT_SERVERID);

        // REQUEST
        const request = new DHCPv6Packet({ msgType: DHCPv6Packet.MT_REQUEST, transactionId: txId });
        request.setOption(DHCPv6Packet.OPT_CLIENTID, clientDUID);
        if (serverDUID) request.setOption(DHCPv6Packet.OPT_SERVERID, serverDUID);
        const preferred = prefixInfo.preferred || 1800;
        const valid     = prefixInfo.valid     || 3600;
        const iaPrefixOpt = DHCPv6Packet.buildIAPrefix(preferred, valid, prefixInfo.prefixLength, prefixInfo.prefix16bytes);
        const iaPrefixEnc = DHCPv6Packet.encodeOption(DHCPv6Packet.OPT_IAPREFIX, iaPrefixOpt);
        request.setOption(DHCPv6Packet.OPT_IA_PD, DHCPv6Packet.buildIA_PD(iaid, (preferred / 2) >>> 0, (valid * 0.8) >>> 0, iaPrefixEnc));
        this._dhcpv6PdSendWan(request);

        // Wait for REPLY
        let reply = /** @type {DHCPv6Packet|null} */ (null);
        try {
            reply = await new Promise((resolve, reject) => {
                const tid = simTimer.schedule(() => reject(new Error("timeout")), SimTimer.DHCP_ACK_WAIT_MS);
                this._wanDhcpv6PdCallback = (pkt) => { simTimer.cancel(tid); resolve(pkt); };
            });
        } catch { this._updateStatusPanel(); return; }
        if (!reply || reply.msgType !== DHCPv6Packet.MT_REPLY) { this._updateStatusPanel(); return; }

        this._wanDhcpv6PdDelegated = { prefix16bytes: prefixInfo.prefix16bytes, prefixLen: prefixInfo.prefixLength };
        this._applyDelegatedPrefix(prefixInfo.prefix16bytes, prefixInfo.prefixLength);
        this._updateStatusPanel();

        // T1 aus dem REPLY-IA_PD lesen und Renewal planen
        const iaPDReply = reply.getOption(DHCPv6Packet.OPT_IA_PD);
        const t1Sec = (iaPDReply && iaPDReply.length >= 8)
            ? (((iaPDReply[4] << 24) | (iaPDReply[5] << 16) | (iaPDReply[6] << 8) | iaPDReply[7]) >>> 0)
            : (prefixInfo.preferred >>> 1) || 1800;
        const t1SimMs = Math.max(SimTimer.DHCP_OFFER_WAIT_MS * 2, t1Sec * 1000);
        simTimer.schedule(() => {
            if (this._wanIp6Enabled && this._wanDhcpv6PdDelegated) {
                void this._runWanDhcpv6PdClient();
            }
        }, t1SimMs);
    }

    /** Send RS (type 133) from WAN link-local to ff02::2 to solicit an RA from the upstream router. */
    _sendWanRouterSolicitation() {
        const wanLl       = IPAddress.fromUInt8(this._wanLinkLocalBytes());
        const allRouters  = IPAddress.fromString("ff02::2");
        if (!allRouters) return;
        const allRtrsMac  = new Uint8Array([0x33, 0x33, 0x00, 0x00, 0x00, 0x02]);
        const rs = ICMPv6Packet.buildRS(this._wanMac);
        const ipv6 = new IPv6Packet({ src: wanLl, dst: allRouters, nextHeader: 58, hopLimit: 255, payload: rs.pack(wanLl, allRouters) });
        this.wan0.send(new EthernetFrame({ dstMac: allRtrsMac, srcMac: this._wanMac, etherType: 0x86DD, payload: ipv6.pack() }));
    }

    /** Send a DHCPv6 packet from WAN link-local to ff02::1:2 (all DHCP agents/servers). */
    /** @param {DHCPv6Packet} pkt */
    _dhcpv6PdSendWan(pkt) {
        const wanLl   = IPAddress.fromUInt8(this._wanLinkLocalBytes());
        const allDhcp = IPAddress.fromString("ff02::1:2");
        if (!allDhcp) return;
        const dstMac  = new Uint8Array([0x33, 0x33, 0x00, 0x01, 0x00, 0x02]);

        const payload = pkt.pack();
        const udpLen  = 8 + payload.length;
        const udpBytes = new Uint8Array(udpLen);
        udpBytes[0] = 0x02; udpBytes[1] = 0x22; // srcPort 546
        udpBytes[2] = 0x02; udpBytes[3] = 0x23; // dstPort 547
        udpBytes[4] = (udpLen >> 8) & 0xff; udpBytes[5] = udpLen & 0xff;
        udpBytes.set(payload, 8);

        const ipv6  = new IPv6Packet({ src: wanLl, dst: allDhcp, nextHeader: 17, hopLimit: 1, payload: udpBytes });
        const frame = new EthernetFrame({ dstMac, srcMac: this._wanMac, etherType: 0x86DD, payload: ipv6.pack() });
        this.wan0.send(frame);
    }

    /**
     * Configure LAN IPv6 from delegated prefix: router IP = prefix::1, start sending RAs.
     * @param {Uint8Array} prefix16bytes
     * @param {number} prefixLen
     */
    _applyDelegatedPrefix(prefix16bytes, prefixLen) {
        const lanPrefix = new Uint8Array(prefix16bytes);
        for (let i = 8; i < 16; i++) lanPrefix[i] = 0;
        this._lanRaPrefix = lanPrefix;
        const routerIp6 = new Uint8Array(lanPrefix);
        routerIp6[15] = 1;
        this._lanIp6 = routerIp6;
        this._startRaTimer();
        this._sendRa();
    }

    _sendRa() {
        if (!this._lanRaPrefix) return;
        const llBytes  = this._lanLinkLocalBytes();
        const routerLl = IPAddress.fromUInt8(llBytes);
        const prefixIp = IPAddress.fromUInt8(this._lanRaPrefix);
        const allNodes = IPAddress.fromString("ff02::1");
        if (!allNodes) return;
        const dstMac   = new Uint8Array([0x33, 0x33, 0x00, 0x00, 0x00, 0x01]);

        const ra      = ICMPv6Packet.buildRA({ hopLimit: 64, routerLifetime: 1800, prefix: prefixIp, prefixLength: 64 });
        const raBytes = ra.pack(routerLl, allNodes);
        const ipv6    = new IPv6Packet({ src: routerLl, dst: allNodes, nextHeader: 58, hopLimit: 255, payload: raBytes });
        const frm     = new EthernetFrame({ dstMac, srcMac: this._lanMac, etherType: 0x86DD, payload: ipv6.pack() });
        for (const p of this._lanPorts()) p.send(frm);
    }

    _startRaTimer() {
        this._raTimer.start(() => this._sendRa(), 30_000);
    }

    _stopRaTimer() {
        this._raTimer.stop();
    }

    // ── DNS relay ─────────────────────────────────────────────────────────

    /**
     * @param {IPv4Packet} pkt
     * @param {UDPPacket} udp
     * @param {Uint8Array} srcMac
     */
    _handleDnsQuery(pkt, udp, srcMac) {
        if (!this._upstreamDns || !this._wanIp) return;

        let dns;
        try { dns = DNSPacket.fromBytes(udp.payload); } catch { return; }
        if ((dns.qr & 1) !== 0) return; // ignore responses

        const relayId = this._nextDnsRelayId & 0xffff;
        this._nextDnsRelayId = ((this._nextDnsRelayId + 1) & 0xffff) || 0x8000;

        this._dnsRelayTable.set(relayId, {
            clientIpNum: ipNum(pkt.src),
            clientPort: udp.srcPort,
            origId: dns.id,
            expiresAt: Date.now() + 5000,
        });

        // Build relay query with new ID
        const relayDns = new DNSPacket({ ...dns, id: relayId });
        void this._sendDnsToUpstream(relayDns.pack(), relayId);
    }

    /** @param {Uint8Array} dnsBytes @param {number} relayId */
    _sendDnsToUpstream(dnsBytes, relayId) {
        if (!this._wanIp || !this._upstreamDns) return;
        const srcIp = numToIp(this._wanIp);
        const dstIp = numToIp(this._upstreamDns);
        const udp = new UDPPacket({ srcPort: 5353, dstPort: 53, payload: dnsBytes });
        this._wanStack.send({ dst: dstIp, src: srcIp, protocol: 17, payload: udp.pack({ srcIp, dstIp }) });
    }

    /**
     * @param {IPv4Packet} pkt
     * @param {UDPPacket} udp
     */
    _handleDnsRelayResponse(pkt, udp) {
        let dns;
        try { dns = DNSPacket.fromBytes(udp.payload); } catch { return; }

        // Cleanup expired entries
        const now = Date.now();
        for (const [id, e] of this._dnsRelayTable) { if (e.expiresAt < now) this._dnsRelayTable.delete(id); }

        const pending = this._dnsRelayTable.get(dns.id);
        if (!pending) return;
        this._dnsRelayTable.delete(dns.id);

        // Rewrite ID back to original
        const respDns = new DNSPacket({ ...dns, id: pending.origId });
        void this._sendDnsToLanClient(pending.clientIpNum, pending.clientPort, respDns.pack());
    }

    /** @param {number} clientIpNum @param {number} clientPort @param {Uint8Array} dnsBytes */
    async _sendDnsToLanClient(clientIpNum, clientPort, dnsBytes) {
        const clientMac = await this._resolveArpLan(clientIpNum);
        if (!clientMac) return;

        const srcIp = numToIp(this._lanIp);
        const dstIp = numToIp(clientIpNum);
        const udp = new UDPPacket({ srcPort: 53, dstPort: clientPort, payload: dnsBytes });
        const ip = new IPv4Packet({ src: srcIp, dst: dstIp, protocol: 17, ttl: 64, payload: udp.pack({ srcIp, dstIp }) });
        const frame = new EthernetFrame({ dstMac: clientMac, srcMac: this._lanMac, etherType: 0x0800, payload: ip.pack() });
        this._sendToLanHost(macToBig(clientMac), frame);
    }

    // ── Serialization ─────────────────────────────────────────────────────

    toJSON() {
        return {
            ...super.toJSON(),
            kind: "HomeRouter",
            wanMode: this._wanMode,
            wanIp6Enabled: this._wanIp6Enabled,
            wanIp: ipToString(this._wanIp),
            wanPrefix: this._wanPrefix,
            wanGw: ipToString(this._wanGw),
            upstreamDns: ipToString(this._upstreamDns),
            lanIp: ipToString(this._lanIp),
            lanPrefix: this._lanPrefix,
            dhcpEnabled: this._dhcpEnabled,
            dhcpRangeStart: ipToString(this._dhcpRangeStart),
            dhcpRangeEnd: ipToString(this._dhcpRangeEnd),
            dhcpLeaseTime: this._dhcpLeaseTime,
            ssid: this._ssid,
            wanMac: macToStr(this._wanMac),
            lanMac: macToStr(this._lanMac),
            pdDelegated: this._wanDhcpv6PdDelegated ? {
                prefix: Array.from(this._wanDhcpv6PdDelegated.prefix16bytes),
                prefixLen: this._wanDhcpv6PdDelegated.prefixLen,
            } : null,
            portRules: this._portRules.map(r => ({
                proto: r.proto,
                wanPort: r.wanPort,
                lanIp: ipToString(r.lanIp),
                lanPort: r.lanPort,
            })),
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new HomeRouter(n.name ?? t("homerouter.title"));
        obj._applyBaseJSON(n);
        obj._wanMode = n.wanMode === "dhcp" ? "dhcp" : "static";
        // backward compat: old saves used wanMode="dhcpv6-pd"
        obj._wanIp6Enabled = !!n.wanIp6Enabled || n.wanMode === "dhcpv6-pd";
        obj._wanIp = strToNum(n.wanIp ?? "0.0.0.0");
        obj._wanPrefix = Number(n.wanPrefix ?? 24) | 0;
        obj._wanGw = strToNum(n.wanGw ?? "0.0.0.0");
        obj._upstreamDns = strToNum(n.upstreamDns ?? "0.0.0.0");
        obj._lanIp = strToNum(n.lanIp ?? "192.168.1.1");
        obj._lanPrefix = Number(n.lanPrefix ?? 24) | 0;
        obj._dhcpEnabled = !!n.dhcpEnabled;
        obj._dhcpRangeStart = strToNum(n.dhcpRangeStart ?? "192.168.1.100");
        obj._dhcpRangeEnd = strToNum(n.dhcpRangeEnd ?? "192.168.1.200");
        obj._dhcpLeaseTime = Number(n.dhcpLeaseTime ?? 3600);
        obj._ssid = String(n.ssid ?? "HomeNetwork");
        if (n.wanMac) try {
            obj._wanMac = strToMac(n.wanMac);
            // Restore MAC into the WAN NetworkInterface so ARP uses the correct MAC
            const wanIf = obj._wanStack.interfaces[0];
            if (wanIf) {
                wanIf.mac = new Uint8Array(obj._wanMac);
                wanIf.neighborCache = new Map();
            }
        } catch {}
        if (n.lanMac) try { obj._lanMac = strToMac(n.lanMac); } catch {}
        // pdDelegated wird nicht restoriert — DHCPv6-PD wird beim Start immer neu verhandelt
        if (Array.isArray(n.portRules)) {
            obj._portRules = n.portRules.map(/** @param {any} r */ r => ({
                proto:   Number(r.proto)   | 0,
                wanPort: Number(r.wanPort) | 0,
                lanIp:   strToNum(r.lanIp ?? "0.0.0.0"),
                lanPort: Number(r.lanPort) | 0,
            })).filter(/** @param {{wanPort:number,lanIp:number,lanPort:number}} r */ r => r.wanPort > 0 && r.lanIp !== 0 && r.lanPort > 0);
        }
        obj._applyWanConfig();
        obj._applyLanConfig();
        if (obj._wanMode === "dhcp") void obj._runWanDhcpClient();
        if (obj._wanIp6Enabled) { obj._sendWanRouterSolicitation(); void obj._runWanDhcpv6PdClient(); }
        return obj;
    }

    // ── Panel UI ──────────────────────────────────────────────────────────

    /** @param {HTMLElement} body */
    _mount(body) {
        this._stopPoll();
        body.innerHTML = "";
        this._statusEl = null;

        const host = UILib.div("router-ui");
        body.appendChild(host);

        const card = UILib.div("router-card");
        host.appendChild(card);

        const content = UILib.div("sim-panel-content panel");

        const { bar: tabBar, setActive: selectTab } = UILib.tabGroup([
            { id: "status", label: t("homerouter.tab.status") },
            { id: "wan",    label: t("homerouter.tab.wan")    },
            { id: "lan",    label: t("homerouter.tab.lan")    },
            { id: "dhcp",   label: t("homerouter.tab.dhcp")   },
            { id: "wifi",   label: t("homerouter.tab.wifi")   },
            { id: "nat",    label: t("homerouter.tab.nat")    },
            { id: "pf",     label: t("homerouter.tab.pf")     },
        ], (id) => {
            this._activeTab = id;
            UILib.clear(content);
            if (id === "status") this._buildStatusTab(content);
            else if (id === "wan")  this._buildWanTab(content);
            else if (id === "lan")  this._buildLanTab(content);
            else if (id === "dhcp") this._buildDhcpTab(content);
            else if (id === "wifi") this._buildWifiTab(content);
            else if (id === "nat")  this._buildNatTab(content);
            else if (id === "pf")   this._buildPortForwardTab(content);
        });
        card.appendChild(tabBar);
        card.appendChild(content);

        if (this._activeTab === "status") this._buildStatusTab(content);
        else if (this._activeTab === "wan")  this._buildWanTab(content);
        else if (this._activeTab === "lan")  this._buildLanTab(content);
        else if (this._activeTab === "dhcp") this._buildDhcpTab(content);
        else if (this._activeTab === "wifi") this._buildWifiTab(content);
        else if (this._activeTab === "nat")  this._buildNatTab(content);
        else if (this._activeTab === "pf")   this._buildPortForwardTab(content);
        selectTab(this._activeTab);
        this._startPoll();
    }

    /** @param {HTMLElement} host */
    _buildStatusTab(host) {
        const infoRow = (/** @type {string} */ label, /** @type {string} */ value) => UILib.div("cfg-info-row", [
            UILib.el("span", { text: label, className: "hr-info-label" }),
            UILib.el("span", { text: value, className: "cfg-info-value" }),
        ]);

        const wanLinked = this.wan0.isLinked();
        const wanChildren = [
            UILib.el("span", { text: "WAN", className: "hr-section-title" }),
            UILib.div("cfg-info-row", [
                UILib.el("span", { text: t("homerouter.wan.status"), className: "hr-info-label" }),
                UILib.el("span", {
                    text: wanLinked ? t("homerouter.wan.status.up") : t("homerouter.wan.status.down"),
                    className: `ui-tab-badge ${wanLinked ? "status-up" : "status-down"}`,
                }),
            ]),
            infoRow("IP", this._wanIp ? `${ipToString(this._wanIp)}/${this._wanPrefix}` : "–"),
            infoRow(t("homerouter.wan.gw"), this._wanGw ? ipToString(this._wanGw) : "–"),
            infoRow(t("homerouter.wan.dns"), this._upstreamDns ? ipToString(this._upstreamDns) : "–"),
        ];
        if (this._wanDhcpv6PdDelegated) {
            const pd = this._wanDhcpv6PdDelegated;
            wanChildren.push(infoRow(t("homerouter.wan.pd.delegated"), `${IPAddress.fromUInt8(pd.prefix16bytes)?.toString() ?? "?"}/${pd.prefixLen}`));
            if (this._lanIp6) wanChildren.push(infoRow("LAN IPv6", `${IPAddress.fromUInt8(this._lanIp6)?.toString() ?? "?"}/64`));
        }
        host.appendChild(UILib.el("div", { className: "cfg-section", children: wanChildren }));

        host.appendChild(UILib.el("div", { className: "cfg-section", children: [
            UILib.el("span", { text: "LAN", className: "hr-section-title" }),
            infoRow("IP", `${ipToString(this._lanIp)}/${this._lanPrefix}`),
            infoRow("MAC", macToStr(this._lanMac)),
        ]}));

        this._dhcpCleanup();
        host.appendChild(UILib.el("div", { className: "cfg-section", children: [
            UILib.el("span", { text: t("homerouter.tab.dhcp"), className: "hr-section-title" }),
            infoRow(t("homerouter.dhcp.leases"), String(this._dhcpLeases.size)),
        ]}));

        this._statusEl = host;
    }

    /** @param {HTMLElement} host */
    _buildWanTab(host) {
        const field = (/** @type {string} */ cls, /** @type {string} */ label, /** @type {HTMLElement} */ inp) => UILib.el("div", {
            className: ["cfg-field hr-field", cls].filter(Boolean).join(" "),
            children: [UILib.el("span", { text: label, className: "cfg-label" }), inp],
        });

        // ── IPv4 ─────────────────────────────────────────────────────────
        const modeSel = UILib.select([
            { value: "static", label: t("homerouter.wan.mode.static") },
            { value: "dhcp",   label: t("homerouter.wan.mode.dhcp") },
        ]);
        modeSel.value = this._wanMode;

        const ipIn   = UILib.input({ value: this._wanIp ? ipToString(this._wanIp) : "", placeholder: "192.168.0.1" });
        const maskIn = UILib.input({ value: String(this._wanPrefix), placeholder: "24" });
        const gwIn   = UILib.input({ value: this._wanGw ? ipToString(this._wanGw) : "", placeholder: "192.168.0.254" });
        const dnsIn  = UILib.input({ value: this._upstreamDns ? ipToString(this._upstreamDns) : "", placeholder: "1.1.1.1" });

        const staticSection = UILib.el("div", { className: "cfg-section", children: [
            UILib.div("cfg-fields", [
                field("", t("homerouter.wan.ip"), ipIn),
                field("hr-field-sm", t("homerouter.wan.mask"), maskIn),
            ]),
            UILib.div("cfg-fields", [field("hr-field-wide", t("homerouter.wan.gw"), gwIn)]),
            UILib.div("cfg-fields", [field("hr-field-wide", t("homerouter.wan.dns"), dnsIn)]),
        ]});

        const showStatic = (/** @type {boolean} */ show) => { staticSection.classList.toggle("hidden", !show); };
        showStatic(this._wanMode === "static");
        modeSel.addEventListener("change", () => showStatic(modeSel.value === "static"));

        host.appendChild(UILib.el("div", { className: "cfg-section", children: [
            UILib.el("span", { text: "IPv4", className: "hr-section-title" }),
            UILib.div("cfg-fields", [field("hr-field-wide", t("homerouter.wan.mode"), modeSel)]),
        ]}));
        host.appendChild(staticSection);

        // ── IPv6 ─────────────────────────────────────────────────────────
        const ip6Cb = UILib.input({ type: "checkbox" });
        ip6Cb.checked = this._wanIp6Enabled;

        const ip6Children = [
            UILib.el("span", { text: t("homerouter.wan.ipv6"), className: "hr-section-title" }),
            UILib.div("hr-checkbox-row", [ip6Cb, UILib.el("span", { text: t("homerouter.wan.ipv6.dhcpv6pd") })]),
        ];
        if (this._wanDhcpv6PdDelegated) {
            const pd = this._wanDhcpv6PdDelegated;
            const pdStr = `${IPAddress.fromUInt8(pd.prefix16bytes)?.toString() ?? "?"}/${pd.prefixLen}`;
            ip6Children.push(UILib.div("cfg-info-row", [
                UILib.el("span", { text: t("homerouter.wan.pd.delegated"), className: "hr-info-label" }),
                UILib.el("span", { text: pdStr, className: "cfg-info-value" }),
            ]));
        }
        host.appendChild(UILib.el("div", { className: "cfg-section", children: ip6Children }));

        const applyBtn = UILib.button(t("router.apply"));
        applyBtn.addEventListener("click", () => {
            // IPv4
            if (modeSel.value === "dhcp") {
                this._wanMode = "dhcp";
                this._wanIp = 0; this._wanGw = 0; this._upstreamDns = 0;
                this._nat.clear();
                this._applyWanConfig();
                void this._runWanDhcpClient();
            } else {
                const ip  = strToNum(ipIn.value);
                const pf  = parseInt(maskIn.value) | 0;
                const gw  = strToNum(gwIn.value);
                const dns = strToNum(dnsIn.value);
                if (!ip || pf < 1 || pf > 32) { SimDialog.alert(t("homerouter.wan.invalid")); return; }
                this._wanMode = "static";
                this._wanIp = ip; this._wanPrefix = pf; this._wanGw = gw; this._upstreamDns = dns;
                this._nat.clear();
                this._applyWanConfig();
            }
            // IPv6 — immer vollständig zurücksetzen, dann ggf. neu starten
            this._wanIp6Enabled = ip6Cb.checked;
            this._wanDhcpv6PdDelegated = null;
            this._lanIp6 = null; this._lanRaPrefix = null;
            this._stopRaTimer();
            this._wanGw6 = null;
            this._wanNdpCache.clear(); this._lanNdpCache.clear();
            if (this._wanIp6Enabled) { this._sendWanRouterSolicitation(); void this._runWanDhcpv6PdClient(); }
            this._mount(/** @type {HTMLElement} */ (this._panelBody));
        });
        host.appendChild(UILib.div("cfg-btn-row", [applyBtn]));
    }

    /** @param {HTMLElement} host */
    _buildLanTab(host) {
        const field = (/** @type {string} */ cls, /** @type {string} */ label, /** @type {HTMLElement} */ inp) => UILib.el("div", {
            className: ["cfg-field hr-field", cls].filter(Boolean).join(" "),
            children: [UILib.el("span", { text: label, className: "cfg-label" }), inp],
        });

        const ipIn   = UILib.input({ value: ipToString(this._lanIp), placeholder: "192.168.1.1" });
        const maskIn = UILib.input({ value: String(this._lanPrefix), placeholder: "24" });

        host.appendChild(UILib.el("div", { className: "cfg-section", children: [
            UILib.el("span", { text: "IPv4", className: "hr-section-title" }),
            UILib.div("cfg-fields", [
                field("", t("homerouter.lan.ip"), ipIn),
                field("hr-field-sm", t("homerouter.lan.mask"), maskIn),
            ]),
        ]}));

        const applyBtn = UILib.button(t("router.apply"));
        applyBtn.addEventListener("click", () => {
            const ip = strToNum(ipIn.value);
            const pf = parseInt(maskIn.value) | 0;
            if (!ip || pf < 1 || pf > 32) { SimDialog.alert(t("homerouter.lan.invalid")); return; }
            this._lanIp = ip; this._lanPrefix = pf;
            this._lanArpCache.clear(); this._lanMacTable.clear();
            this._applyLanConfig();
            this._mount(/** @type {HTMLElement} */ (this._panelBody));
        });
        host.appendChild(UILib.div("cfg-btn-row", [applyBtn]));

        // ── IPv6 (read-only, derived from DHCPv6-PD) ────────────────────
        const ip6Str = this._lanIp6
            ? `${IPAddress.fromUInt8(this._lanIp6)?.toString() ?? "?"}/64`
            : "–";
        const raActive = !!this._lanIp6;
        const raLabel  = raActive ? t("homerouter.lan.ipv6.ra.active") : t("homerouter.lan.ipv6.ra.inactive");
        host.appendChild(UILib.el("div", { className: "cfg-section", children: [
            UILib.el("span", { text: t("homerouter.lan.ipv6"), className: "hr-section-title" }),
            UILib.div("cfg-info-row", [
                UILib.el("span", { text: t("homerouter.lan.ipv6.addr"), className: "hr-info-label" }),
                UILib.el("span", { text: ip6Str, className: "cfg-info-value" }),
            ]),
            UILib.div("cfg-info-row", [
                UILib.el("span", { text: t("homerouter.lan.ipv6.ra"), className: "hr-info-label" }),
                UILib.el("span", {
                    text: raLabel,
                    className: `ui-tab-badge ${raActive ? "status-up" : "status-down"}`,
                }),
            ]),
        ]}));
    }

    /** @param {HTMLElement} host */
    _buildDhcpTab(host) {
        const field = (/** @type {string} */ cls, /** @type {string} */ label, /** @type {HTMLElement} */ inp) => UILib.el("div", {
            className: ["cfg-field hr-field", cls].filter(Boolean).join(" "),
            children: [UILib.el("span", { text: label, className: "cfg-label" }), inp],
        });

        const enableCb = UILib.input({ type: "checkbox" });
        enableCb.checked = this._dhcpEnabled;

        const rsIn    = UILib.input({ value: ipToString(this._dhcpRangeStart), placeholder: "192.168.1.100" });
        const reIn    = UILib.input({ value: ipToString(this._dhcpRangeEnd),   placeholder: "192.168.1.200" });
        const leaseIn = UILib.input({ value: String(this._dhcpLeaseTime),      placeholder: "3600" });

        host.appendChild(UILib.el("div", { className: "cfg-section", children: [
            UILib.el("span", { text: t("homerouter.tab.dhcp"), className: "hr-section-title" }),
            UILib.div("hr-checkbox-row", [enableCb, UILib.el("span", { text: t("homerouter.dhcp.enabled") })]),
            UILib.div("cfg-fields", [
                field("", t("homerouter.dhcp.range.start"), rsIn),
                field("", t("homerouter.dhcp.range.end"), reIn),
                field("hr-field-sm", t("homerouter.dhcp.lease"), leaseIn),
            ]),
        ]}));

        const applyBtn = UILib.button(t("router.apply"));
        applyBtn.addEventListener("click", () => {
            const rs = strToNum(rsIn.value);
            const re = strToNum(reIn.value);
            const lt = parseInt(leaseIn.value) || 3600;
            if (!rs || !re || rs > re) { SimDialog.alert(t("homerouter.dhcp.invalid")); return; }
            this._dhcpEnabled = enableCb.checked;
            this._dhcpRangeStart = rs; this._dhcpRangeEnd = re;
            this._dhcpLeaseTime = Math.max(60, Math.min(86400, lt));
            this._mount(/** @type {HTMLElement} */ (this._panelBody));
        });
        host.appendChild(UILib.div("cfg-btn-row", [applyBtn]));

        this._dhcpCleanup();
        if (this._dhcpLeases.size > 0) {
            const table = UILib.el("table", { className: "router-routes-table" });
            const tbody = UILib.el("tbody");
            for (const [key, lease] of this._dhcpLeases) {
                const mac = this._macKeyToStr(key);
                tbody.appendChild(UILib.el("tr", { children: [
                    UILib.el("td", { text: mac }),
                    UILib.el("td", { text: ipToString(lease.ipNum) }),
                ]}));
            }
            table.appendChild(tbody);
            host.appendChild(UILib.el("div", { className: "cfg-section", children: [
                UILib.el("span", { text: t("homerouter.dhcp.leases"), className: "hr-section-title" }),
                table,
            ]}));
        }
    }

    /** @param {HTMLElement} host */
    _buildWifiTab(host) {
        const field = (/** @type {string} */ cls, /** @type {string} */ label, /** @type {HTMLElement} */ inp) => UILib.el("div", {
            className: ["cfg-field hr-field", cls].filter(Boolean).join(" "),
            children: [UILib.el("span", { text: label, className: "cfg-label" }), inp],
        });

        const ssidIn = UILib.input({ value: this._ssid, placeholder: "HomeNetwork" });

        host.appendChild(UILib.el("div", { className: "cfg-section", children: [
            UILib.el("span", { text: "Wi-Fi", className: "hr-section-title" }),
            UILib.div("cfg-fields", [field("hr-field-wide", "SSID", ssidIn)]),
        ]}));

        const applyBtn = UILib.button(t("router.apply"));
        applyBtn.addEventListener("click", () => {
            const v = ssidIn.value.trim();
            if (v) this._ssid = v;
            this._mount(/** @type {HTMLElement} */ (this._panelBody));
        });
        host.appendChild(UILib.div("cfg-btn-row", [applyBtn]));
    }

    /** @param {HTMLElement} host */
    _buildPortForwardTab(host) {
        const field = (/** @type {string} */ cls, /** @type {string} */ label, /** @type {HTMLElement} */ inp) => UILib.el("div", {
            className: ["cfg-field hr-field", cls].filter(Boolean).join(" "),
            children: [UILib.el("span", { text: label, className: "cfg-label" }), inp],
        });

        // ── existing rules table ──
        const table = UILib.el("table", { className: "router-routes-table" });
        const thead = UILib.el("thead");
        thead.innerHTML = `<tr>
            <th>${t("homerouter.pf.col.proto")}</th>
            <th>${t("homerouter.pf.col.wanport")}</th>
            <th>${t("homerouter.pf.col.lanip")}</th>
            <th>${t("homerouter.pf.col.lanport")}</th>
            <th></th>
        </tr>`;
        table.appendChild(thead);

        const tbody = UILib.el("tbody");
        table.appendChild(tbody);

        const renderRows = () => {
            tbody.innerHTML = "";
            if (this._portRules.length === 0) {
                const tr = UILib.el("tr");
                const td = UILib.el("td", { text: t("homerouter.pf.empty") });
                td.setAttribute("colspan", "5");
                td.className = "router-muted-cell";
                tr.appendChild(td);
                tbody.appendChild(tr);
            } else {
                for (let i = 0; i < this._portRules.length; i++) {
                    const r = this._portRules[i];
                    const protoStr = r.proto === 6 ? "TCP" : r.proto === 17 ? "UDP" : "TCP+UDP";
                    const delBtn = UILib.button("✕", null, { className: "router-del-btn" });
                    const idx = i;
                    delBtn.addEventListener("click", () => {
                        this._portRules.splice(idx, 1);
                        renderRows();
                    });
                    tbody.appendChild(UILib.el("tr", { children: [
                        UILib.el("td", { text: protoStr }),
                        UILib.el("td", { text: String(r.wanPort) }),
                        UILib.el("td", { text: ipToString(r.lanIp) }),
                        UILib.el("td", { text: String(r.lanPort) }),
                        UILib.el("td", { children: [delBtn] }),
                    ]}));
                }
            }
        };
        renderRows();

        host.appendChild(UILib.el("div", { className: "cfg-section", children: [
            UILib.el("span", { text: t("homerouter.pf.title"), className: "hr-section-title" }),
            table,
        ]}));

        // ── add rule form ──
        const protoSel = /** @type {HTMLSelectElement} */ (UILib.el("select"));
        for (const [val, lbl] of [["0", "TCP+UDP"], ["6", "TCP"], ["17", "UDP"]]) {
            const o = UILib.el("option", { text: lbl, attrs: { value: val } });
            protoSel.appendChild(o);
        }
        protoSel.value = "6";

        const wanPortIn = UILib.input({ placeholder: "8080" });
        const lanIpIn   = UILib.input({ placeholder: "192.168.1.10" });
        const lanPortIn = UILib.input({ placeholder: "80" });

        const addBtn = UILib.button("+ Add");
        addBtn.addEventListener("click", () => {
            const wanPort = parseInt(wanPortIn.value) | 0;
            const lanIp   = strToNum(lanIpIn.value);
            const lanPort = parseInt(lanPortIn.value) | 0;
            const proto   = parseInt(protoSel.value) | 0;
            if (wanPort < 1 || wanPort > 65535 || !lanIp || lanPort < 1 || lanPort > 65535) {
                SimDialog.alert(t("homerouter.pf.invalid"));
                return;
            }
            this._portRules.push({ proto, wanPort, lanIp, lanPort });
            wanPortIn.value = ""; lanIpIn.value = ""; lanPortIn.value = "";
            renderRows();
        });

        host.appendChild(UILib.el("div", { className: "cfg-section", children: [
            UILib.div("cfg-fields", [
                field("hr-field-sm", t("homerouter.pf.col.proto"), protoSel),
                field("hr-field-sm", t("homerouter.pf.col.wanport"), wanPortIn),
                field("", t("homerouter.pf.col.lanip"), lanIpIn),
                field("hr-field-sm", t("homerouter.pf.col.lanport"), lanPortIn),
            ]),
            UILib.div("cfg-btn-row", [addBtn]),
        ]}));
    }

    /** @param {HTMLElement} host */
    _buildNatTab(host) {
        const wanStr = this._wanIp ? ipToString(this._wanIp) : "–";

        host.appendChild(UILib.el("div", { className: "cfg-section", children: [
            UILib.el("span", { text: t("homerouter.tab.nat"), className: "hr-section-title" }),
            UILib.div("cfg-info-row", [
                UILib.el("span", { text: t("homerouter.nat.wanip"), className: "hr-info-label" }),
                UILib.el("span", { text: wanStr, className: "cfg-info-value" }),
            ]),
        ]}));

        const entries = this._nat.getEntries();
        if (entries.length === 0) {
            host.appendChild(UILib.el("p", { text: t("homerouter.nat.empty"), className: "router-empty-p" }));
        } else {
            const table = UILib.el("table", { className: "router-routes-table" });
            const thead = UILib.el("thead");
            thead.innerHTML = `<tr>
                <th>${t("homerouter.nat.col.proto")}</th>
                <th>${t("homerouter.nat.col.lanip")}</th>
                <th>${t("homerouter.nat.col.lanport")}</th>
                <th>${t("homerouter.nat.col.natport")}</th>
            </tr>`;
            table.appendChild(thead);

            const tbody = UILib.el("tbody");
            for (const e of entries) {
                const lanIpStr = ipToString(e.lanIpNum);
                const portLabel = e.proto === "ICMP" ? t("homerouter.nat.icmpid") : "";
                tbody.appendChild(UILib.el("tr", { children: [
                    UILib.el("td", { text: e.proto }),
                    UILib.el("td", { text: lanIpStr }),
                    UILib.el("td", { text: String(e.lanPort) + (portLabel ? ` (${portLabel})` : "") }),
                    UILib.el("td", { text: String(e.natPort) }),
                ]}));
            }
            table.appendChild(tbody);
            host.appendChild(table);
        }

        this._natEl = host;
    }

    /** @param {string} key BigInt string from MACToNumber @returns {string} xx:xx:xx:xx:xx:xx */
    _macKeyToStr(key) {
        try {
            const n = BigInt(key);
            return Array.from({ length: 6 }, (_, i) => ((n >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0")).join(":");
        } catch { return key; }
    }

    _startPoll() {
        this._pollTimer.start(() => this._updateStatusPanel(), 2000);
    }

    _stopPoll() {
        this._pollTimer.stop();
    }

    _updateStatusPanel() {
        if (this._activeTab === "status" && this._statusEl && this._panelBody?.contains(this._statusEl)) {
            this._statusEl.innerHTML = "";
            this._buildStatusTab(this._statusEl);
        }
        if (this._activeTab === "nat" && this._natEl && this._panelBody?.contains(this._natEl)) {
            this._natEl.innerHTML = "";
            this._buildNatTab(this._natEl);
        }
    }

    destroy() {
        this._stopPoll();
        this._stopRaTimer();
        super.destroy();
    }
}
