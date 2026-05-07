//@ts-check

import { SimulatedObject } from "./SimulatedObject.js";
import { EthernetPort } from "../net/EthernetPort.js";
import { WirelessPort } from "../net/WirelessPort.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { ArpPacket } from "../net/pdu/ArpPacket.js";
import { IPv4Packet } from "../net/pdu/IPv4Packet.js";
import { ICMPPacket } from "../net/pdu/ICMPPacket.js";
import { UDPPacket } from "../net/pdu/UDPPacket.js";
import { DHCPPacket } from "../net/pdu/DHCPPacket.js";
import { DHCPv6Packet } from "../net/pdu/DHCPv6Packet.js";
import { IPv6Packet } from "../net/pdu/IPv6Packet.js";
import { ICMPv6Packet } from "../net/pdu/ICMPv6Packet.js";
import { DNSPacket } from "../net/pdu/DNSPacket.js";
import { IPAddress } from "../net/models/IPAddress.js";
import { NatEngine } from "../net/NatEngine.js";
import { simTimer, SimTimer } from "./SimTimer.js";
import { DOMBuilder } from "../lib/DomBuilder.js";
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
    /** @type {Map<number,Uint8Array>} ip→mac */
    _wanArpCache = new Map();

    // ── NAT ───────────────────────────────────────────────────────────────
    /** @type {NatEngine} */ _nat = new NatEngine();

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
    /** @type {number|null} */ _raTimer = null;

    // ── Panel ─────────────────────────────────────────────────────────────
    /** @type {HTMLElement|null} */ _panelBody = null;
    /** @type {number|null} */ _pollTimer = null;
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
        // WAN
        let f;
        while ((f = this.wan0.getNextIncomingFrame()) != null) {
            try { this._handleWanFrame(f); } catch {}
        }
        // LAN bridge
        for (const p of this._lanPorts()) {
            while ((f = /** @type {EthernetPort} */ (p).getNextIncomingFrame()) != null) {
                try { this._handleLanFrame(/** @type {EthernetPort} */ (p), f); } catch {}
            }
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
            if (spaNum) this._wanArpCache.set(spaNum, arp.sha.slice());

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
                // Regular inbound NAT (TCP/UDP response)
                const origSrc = this._nat.natInbound(pkt);
                if (origSrc) void this._forwardToLan(pkt, origSrc);
            } else if (proto === 6) {
                const origSrc = this._nat.natInbound(pkt);
                if (origSrc) void this._forwardToLan(pkt, origSrc);
            } else if (proto === 1) {
                // ICMP: could be echo reply (NAT'd) or error
                const origSrc = this._nat.natInbound(pkt);
                if (origSrc) void this._forwardToLan(pkt, origSrc);
            }
        }
    }

    // ── LAN frame processing ──────────────────────────────────────────────

    /**
     * @param {EthernetPort} srcPort
     * @param {EthernetFrame} frame
     */
    _handleLanFrame(srcPort, frame) {
        // L2 MAC learning
        this._lanMacTable.set(macToBig(frame.srcMac), srcPort);

        const forRouter = isEqualUint8(frame.dstMac, this._lanMac);
        const isBcast   = isEqualUint8(frame.dstMac, BCAST_MAC);

        if (forRouter || isBcast) {
            this._handleLanL3(frame, srcPort);
        }

        if (!forRouter) {
            if (isBcast) {
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
            }
            this._handleLanIpv4(pkt, frame.srcMac, srcPort);
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
            const proto = pkt.protocol;
            if (proto === 1) {
                this._handleIcmpForRouter(pkt, srcMac, srcPort);
            } else if (proto === 17) {
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
            // Route to WAN
            if (this._wanIp && pkt.ttl > 1) {
                void this._routeLanToWan(pkt);
            }
        }
    }

    // ── ICMP echo reply ───────────────────────────────────────────────────

    /**
     * @param {IPv4Packet} pkt
     * @param {Uint8Array} srcMac
     * @param {EthernetPort} srcPort
     */
    _handleIcmpForRouter(pkt, srcMac, srcPort) {
        try {
            const icmp = ICMPPacket.fromBytes(pkt.payload);
            if (icmp.type !== 8) return;

            const reply = new ICMPPacket({ type: 0, code: 0, identifier: icmp.identifier, sequence: icmp.sequence, payload: icmp.payload });
            const ip = new IPv4Packet({ src: numToIp(this._lanIp), dst: pkt.src, protocol: 1, ttl: 64, payload: reply.pack() });
            const frame = new EthernetFrame({ dstMac: srcMac, srcMac: this._lanMac, etherType: 0x0800, payload: ip.pack() });
            srcPort.send(frame);
        } catch {}
    }

    // ── Routing: LAN → WAN ────────────────────────────────────────────────

    /** @param {IPv4Packet} pkt */
    async _routeLanToWan(pkt) {
        if (!this._wanIp) return;
        pkt.ttl--;
        pkt.headerChecksum = 0;

        const ok = this._nat.natOutbound(this._wanIp, pkt);
        if (!ok) return;

        const dstNum = ipNum(pkt.dst);
        // If dst is in WAN subnet → direct, else use gateway
        const wanNet = (this._wanIp & prefixToNetmask(this._wanPrefix)) >>> 0;
        const dstNet = (dstNum & prefixToNetmask(this._wanPrefix)) >>> 0;
        const nextHop = (this._wanGw && wanNet !== dstNet) ? this._wanGw : dstNum;

        const mac = await this._resolveArpWan(nextHop);
        if (!mac) return;

        const frame = new EthernetFrame({ dstMac: mac, srcMac: this._wanMac, etherType: 0x0800, payload: pkt.pack() });
        this.wan0.send(frame);
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

    /** @param {number} ipNum @returns {Promise<Uint8Array|null>} */
    async _resolveArpWan(ipNum) {
        const cached = this._wanArpCache.get(ipNum);
        if (cached) return cached;

        this._sendArpRequest(ipNum, this._wanIp, this._wanMac, "wan");

        for (let i = 0; i < SimTimer.ARP_WAIT_RETRIES; i++) {
            await simTimer.sleep(SimTimer.ARP_RETRY_DELAY_MS);
            const m = this._wanArpCache.get(ipNum);
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

        // DISCOVER
        const discover = new DHCPPacket({
            op: 1, htype: 1, hlen: 6, hops: 0, xid: this._wanDhcpXid,
            secs: 0, flags: 0x8000, ciaddr: IPNumberToUint8(0), yiaddr: IPNumberToUint8(0),
            siaddr: IPNumberToUint8(0), giaddr: IPNumberToUint8(0),
            chaddr: this._wanMac, sname: new Uint8Array(64), file: new Uint8Array(128), options: [],
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
            chaddr: this._wanMac, sname: new Uint8Array(64), file: new Uint8Array(128), options: [],
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
        this._wanArpCache.clear();
        this._nat.clear();
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
     * Handle incoming IPv6 frame on WAN: NDP NS → reply with NA, DHCPv6 → PD callback.
     * @param {IPv6Packet} ipv6
     * @param {EthernetFrame} frame
     */
    _handleWanIpv6(ipv6, frame) {
        const myLl = this._wanLinkLocalBytes();
        const dstB = ipv6.dst.toUInt8();

        const isMyLl = dstB.every((b, i) => b === myLl[i]);
        const isSolNode = dstB[0] === 0xff && dstB[1] === 0x02 &&
            dstB[11] === 0x00 && dstB[12] === 0x01 && dstB[13] === 0xff &&
            dstB[14] === myLl[14] && dstB[15] === myLl[15];
        const isAllNodes = dstB[0] === 0xff && dstB[1] === 0x02 && dstB[15] === 0x01;

        if (!isMyLl && !isSolNode && !isAllNodes) return;

        if (ipv6.nextHeader === 58) {
            try {
                const icmp = ICMPv6Packet.fromBytes(ipv6.payload);
                if (icmp.type === 135) {
                    const target = icmp.ndpTarget;
                    if (target && target.toUInt8().every((b, i) => b === myLl[i])) {
                        const srcIp = IPAddress.fromUInt8(myLl);
                        const na = ICMPv6Packet.buildNA(srcIp, this._wanMac, true);
                        const naBytes = na.pack(srcIp, ipv6.src);
                        const rep6 = new IPv6Packet({ src: srcIp, dst: ipv6.src, nextHeader: 58, hopLimit: 255, payload: naBytes });
                        const repFrame = new EthernetFrame({ dstMac: frame.srcMac, srcMac: this._wanMac, etherType: 0x86DD, payload: rep6.pack() });
                        this.wan0.send(repFrame);
                    }
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
    }

    /** Send a DHCPv6 packet from WAN link-local to ff02::1:2 (all DHCP agents/servers). */
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
        this._stopRaTimer();
        this._raTimer = window.setInterval(() => this._sendRa(), 30_000);
    }

    _stopRaTimer() {
        if (this._raTimer != null) { clearInterval(this._raTimer); this._raTimer = null; }
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
    async _sendDnsToUpstream(dnsBytes, relayId) {
        const wanNet = (this._wanIp & prefixToNetmask(this._wanPrefix)) >>> 0;
        const dnsNet = (this._upstreamDns & prefixToNetmask(this._wanPrefix)) >>> 0;
        const nextHop = (this._wanGw && wanNet !== dnsNet) ? this._wanGw : this._upstreamDns;
        const mac = await this._resolveArpWan(nextHop);
        if (!mac) return;

        const srcIp = numToIp(this._wanIp);
        const dstIp = numToIp(this._upstreamDns);
        const udp = new UDPPacket({ srcPort: 5353, dstPort: 53, payload: dnsBytes });
        const ip = new IPv4Packet({ src: srcIp, dst: dstIp, protocol: 17, ttl: 64, payload: udp.pack({ srcIp, dstIp }) });
        const frame = new EthernetFrame({ dstMac: mac, srcMac: this._wanMac, etherType: 0x0800, payload: ip.pack() });
        this.wan0.send(frame);
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
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new HomeRouter(n.name ?? t("homerouter.title"));
        obj._applyBaseJSON(n);
        obj._wanMode = n.wanMode === "dhcp" ? "dhcp" : "static";
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
        if (n.wanMac) try { obj._wanMac = strToMac(n.wanMac); } catch {}
        if (n.lanMac) try { obj._lanMac = strToMac(n.lanMac); } catch {}
        if (n.pdDelegated?.prefix && Array.isArray(n.pdDelegated.prefix)) {
            const bytes = new Uint8Array(n.pdDelegated.prefix);
            if (bytes.length === 16) {
                obj._wanDhcpv6PdDelegated = { prefix16bytes: bytes, prefixLen: Number(n.pdDelegated.prefixLen) };
                obj._applyDelegatedPrefix(bytes, obj._wanDhcpv6PdDelegated.prefixLen);
            }
        }
        return obj;
    }

    // ── Panel UI ──────────────────────────────────────────────────────────

    /** @param {HTMLElement} body */
    _mount(body) {
        this._stopPoll();
        body.innerHTML = "";
        this._statusEl = null;

        const host = DOMBuilder.div("router-ui");
        host.style.display = "flex";
        host.style.flexDirection = "column";
        host.style.gap = "12px";
        body.appendChild(host);

        const card = DOMBuilder.div("router-card");
        host.appendChild(card);

        const content = DOMBuilder.div("");
        content.style.padding = "8px";

        const { bar: tabBar, setActive: selectTab } = DOMBuilder.tabGroup([
            { id: "status", label: t("homerouter.tab.status") },
            { id: "wan",    label: t("homerouter.tab.wan")    },
            { id: "lan",    label: t("homerouter.tab.lan")    },
            { id: "dhcp",   label: t("homerouter.tab.dhcp")   },
            { id: "wifi",   label: t("homerouter.tab.wifi")   },
            { id: "nat",    label: t("homerouter.tab.nat")    },
        ], (id) => {
            this._activeTab = id;
            DOMBuilder.clear(content);
            if (id === "status") this._buildStatusTab(content);
            else if (id === "wan")  this._buildWanTab(content);
            else if (id === "lan")  this._buildLanTab(content);
            else if (id === "dhcp") this._buildDhcpTab(content);
            else if (id === "wifi") this._buildWifiTab(content);
            else if (id === "nat")  this._buildNatTab(content);
        });
        card.appendChild(tabBar);
        card.appendChild(content);

        if (this._activeTab === "status") this._buildStatusTab(content);
        else if (this._activeTab === "wan")  this._buildWanTab(content);
        else if (this._activeTab === "lan")  this._buildLanTab(content);
        else if (this._activeTab === "dhcp") this._buildDhcpTab(content);
        else if (this._activeTab === "wifi") this._buildWifiTab(content);
        else if (this._activeTab === "nat")  this._buildNatTab(content);
        selectTab(this._activeTab);
        this._startPoll();
    }

    /** @param {HTMLElement} host */
    _buildStatusTab(host) {
        host.appendChild(DOMBuilder.h4(t("homerouter.tab.status")));
        /** @param {string} label @param {string} value */
        const mkRow = (label, value) => host.appendChild(DOMBuilder.div("router-name-row", [
            DOMBuilder.label(label),
            DOMBuilder.el("span", { text: value, style: { flex: "1", fontFamily: "monospace", fontSize: "0.9em" } }),
        ]));

        const wanLinked = this.wan0.isLinked();
        host.appendChild(DOMBuilder.h4("WAN"));
        host.appendChild(DOMBuilder.div("router-name-row", [
            DOMBuilder.label(t("homerouter.wan.status")),
            DOMBuilder.el("span", {
                text: wanLinked ? t("homerouter.wan.status.up") : t("homerouter.wan.status.down"),
                className: `ui-tab-badge ${wanLinked ? "status-up" : "status-down"}`,
            }),
        ]));
        mkRow("IP", this._wanIp ? `${ipToString(this._wanIp)}/${this._wanPrefix}` : "–");
        mkRow(t("homerouter.wan.gw"), this._wanGw ? ipToString(this._wanGw) : "–");
        mkRow(t("homerouter.wan.dns"), this._upstreamDns ? ipToString(this._upstreamDns) : "–");
        if (this._wanDhcpv6PdDelegated) {
            const pd = this._wanDhcpv6PdDelegated;
            mkRow(t("homerouter.wan.pd.delegated"), `${IPAddress.fromUInt8(pd.prefix16bytes)?.toString() ?? "?"}/${pd.prefixLen}`);
            if (this._lanIp6) mkRow("LAN IPv6", `${IPAddress.fromUInt8(this._lanIp6)?.toString() ?? "?"}/64`);
        }

        host.appendChild(DOMBuilder.h4("LAN"));
        mkRow("IP", `${ipToString(this._lanIp)}/${this._lanPrefix}`);
        mkRow("MAC", macToStr(this._lanMac));

        this._dhcpCleanup();
        host.appendChild(DOMBuilder.h4(t("homerouter.tab.dhcp")));
        mkRow(t("homerouter.dhcp.leases"), String(this._dhcpLeases.size));

        this._statusEl = host;
    }

    /** @param {HTMLElement} host */
    _buildWanTab(host) {
        host.appendChild(DOMBuilder.h4(t("homerouter.tab.wan")));
        const modeSel = DOMBuilder.select({
            options: [
                { value: "static",    label: t("homerouter.wan.mode.static") },
                { value: "dhcp",      label: t("homerouter.wan.mode.dhcp") },
                { value: "dhcpv6-pd", label: t("homerouter.wan.mode.dhcpv6pd") },
            ],
        });
        modeSel.value = this._wanMode;
        host.appendChild(DOMBuilder.div("router-name-row", [DOMBuilder.label(t("homerouter.wan.mode")), modeSel]));

        const ipIn   = DOMBuilder.input({ value: this._wanIp ? ipToString(this._wanIp) : "", placeholder: "192.168.0.1" });
        const maskIn = DOMBuilder.input({ value: String(this._wanPrefix), placeholder: "24" });
        const gwIn   = DOMBuilder.input({ value: this._wanGw ? ipToString(this._wanGw) : "", placeholder: "192.168.0.254" });
        const dnsIn  = DOMBuilder.input({ value: this._upstreamDns ? ipToString(this._upstreamDns) : "", placeholder: "1.1.1.1" });

        const staticSection = DOMBuilder.div("router-if-section", [
            DOMBuilder.div("router-if-section-header", [
                DOMBuilder.el("span", { text: t("homerouter.wan.mode.static"), className: "router-if-section-label" }),
            ]),
            DOMBuilder.div("router-name-row", [DOMBuilder.label(t("homerouter.wan.ip")),   ipIn]),
            DOMBuilder.div("router-name-row", [DOMBuilder.label(t("homerouter.wan.mask")), maskIn]),
            DOMBuilder.div("router-name-row", [DOMBuilder.label(t("homerouter.wan.gw")),   gwIn]),
            DOMBuilder.div("router-name-row", [DOMBuilder.label(t("homerouter.wan.dns")),  dnsIn]),
        ]);
        host.appendChild(staticSection);

        /** @param {boolean} show */
        const showStatic = (show) => { staticSection.style.display = show ? "" : "none"; };
        showStatic(this._wanMode === "static");
        modeSel.addEventListener("change", () => showStatic(modeSel.value === "static"));

        if (this._wanDhcpv6PdDelegated) {
            const pd = this._wanDhcpv6PdDelegated;
            const pdStr = `${IPAddress.fromUInt8(pd.prefix16bytes)?.toString() ?? "?"}/${pd.prefixLen}`;
            host.appendChild(DOMBuilder.div("router-name-row", [
                DOMBuilder.label(t("homerouter.wan.pd.delegated")),
                DOMBuilder.el("span", { text: pdStr, style: { fontFamily: "monospace", fontSize: "0.9em" } }),
            ]));
        }

        const applyBtn = DOMBuilder.button(t("router.apply"), { className: "router-if-save" });
        applyBtn.addEventListener("click", () => {
            if (modeSel.value === "dhcpv6-pd") {
                this._wanMode = "dhcpv6-pd";
                this._wanIp = 0; this._wanGw = 0; this._upstreamDns = 0;
                this._nat.clear();
                this._wanDhcpv6PdDelegated = null;
                void this._runWanDhcpv6PdClient();
            } else if (modeSel.value === "dhcp") {
                this._wanMode = "dhcp";
                this._wanIp = 0; this._wanGw = 0; this._upstreamDns = 0;
                this._nat.clear();
                void this._runWanDhcpClient();
            } else {
                const ip = strToNum(ipIn.value);
                const pf = parseInt(maskIn.value) | 0;
                const gw = strToNum(gwIn.value);
                const dns = strToNum(dnsIn.value);
                if (!ip || pf < 1 || pf > 32) { SimDialog.alert(t("homerouter.wan.invalid")); return; }
                this._wanMode = "static";
                this._wanIp = ip; this._wanPrefix = pf; this._wanGw = gw; this._upstreamDns = dns;
                this._wanArpCache.clear(); this._nat.clear();
            }
            this._mount(/** @type {HTMLElement} */ (this._panelBody));
        });
        host.appendChild(applyBtn);
    }

    /** @param {HTMLElement} host */
    _buildLanTab(host) {
        host.appendChild(DOMBuilder.h4(t("homerouter.tab.lan")));
        const ipIn   = DOMBuilder.input({ value: ipToString(this._lanIp), placeholder: "192.168.1.1" });
        const maskIn = DOMBuilder.input({ value: String(this._lanPrefix), placeholder: "24" });

        host.appendChild(DOMBuilder.div("router-if-section", [
            DOMBuilder.div("router-name-row", [DOMBuilder.label(t("homerouter.lan.ip")),   ipIn]),
            DOMBuilder.div("router-name-row", [DOMBuilder.label(t("homerouter.lan.mask")), maskIn]),
        ]));

        const applyBtn = DOMBuilder.button(t("router.apply"), { className: "router-if-save" });
        applyBtn.addEventListener("click", () => {
            const ip = strToNum(ipIn.value);
            const pf = parseInt(maskIn.value) | 0;
            if (!ip || pf < 1 || pf > 32) { SimDialog.alert(t("homerouter.lan.invalid")); return; }
            this._lanIp = ip; this._lanPrefix = pf;
            this._lanArpCache.clear(); this._lanMacTable.clear();
            this._mount(/** @type {HTMLElement} */ (this._panelBody));
        });
        host.appendChild(applyBtn);
    }

    /** @param {HTMLElement} host */
    _buildDhcpTab(host) {
        host.appendChild(DOMBuilder.h4(t("homerouter.tab.dhcp")));
        const enableCb = DOMBuilder.input({ type: "checkbox" });
        enableCb.checked = this._dhcpEnabled;
        host.appendChild(DOMBuilder.div("router-name-row", [enableCb, DOMBuilder.label(t("homerouter.dhcp.enabled"))]));

        const rsIn    = DOMBuilder.input({ value: ipToString(this._dhcpRangeStart), placeholder: "192.168.1.100" });
        const reIn    = DOMBuilder.input({ value: ipToString(this._dhcpRangeEnd),   placeholder: "192.168.1.200" });
        const leaseIn = DOMBuilder.input({ value: String(this._dhcpLeaseTime),      placeholder: "3600" });

        host.appendChild(DOMBuilder.div("router-if-section", [
            DOMBuilder.div("router-name-row", [DOMBuilder.label(t("homerouter.dhcp.range.start")), rsIn]),
            DOMBuilder.div("router-name-row", [DOMBuilder.label(t("homerouter.dhcp.range.end")),   reIn]),
            DOMBuilder.div("router-name-row", [DOMBuilder.label(t("homerouter.dhcp.lease")),       leaseIn]),
        ]));

        const applyBtn = DOMBuilder.button(t("router.apply"), { className: "router-if-save" });
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
        host.appendChild(applyBtn);

        this._dhcpCleanup();
        if (this._dhcpLeases.size > 0) {
            host.appendChild(DOMBuilder.h4(t("homerouter.dhcp.leases")));
            const table = DOMBuilder.el("table", { className: "router-routes-table" });
            const tbody = DOMBuilder.el("tbody");
            for (const [key, lease] of this._dhcpLeases) {
                const mac = this._macKeyToStr(key);
                tbody.appendChild(DOMBuilder.el("tr", { children: [
                    DOMBuilder.el("td", { text: mac, style: { fontFamily: "monospace" } }),
                    DOMBuilder.el("td", { text: ipToString(lease.ipNum), style: { fontFamily: "monospace" } }),
                ]}));
            }
            table.appendChild(tbody);
            host.appendChild(table);
        }
    }

    /** @param {HTMLElement} host */
    _buildWifiTab(host) {
        host.appendChild(DOMBuilder.h4(t("homerouter.tab.wifi")));
        const ssidIn = DOMBuilder.input({ value: this._ssid, placeholder: "HomeNetwork" });
        host.appendChild(DOMBuilder.div("router-if-section", [
            DOMBuilder.div("router-name-row", [DOMBuilder.label("SSID"), ssidIn]),
        ]));

        const applyBtn = DOMBuilder.button(t("router.apply"), { className: "router-if-save" });
        applyBtn.addEventListener("click", () => {
            const v = ssidIn.value.trim();
            if (v) this._ssid = v;
            this._mount(/** @type {HTMLElement} */ (this._panelBody));
        });
        host.appendChild(applyBtn);
    }

    /** @param {HTMLElement} host */
    _buildNatTab(host) {
        host.appendChild(DOMBuilder.h4(t("homerouter.tab.nat")));

        const wanStr = this._wanIp ? ipToString(this._wanIp) : "–";
        host.appendChild(DOMBuilder.div("router-name-row", [
            DOMBuilder.label(t("homerouter.nat.wanip")),
            DOMBuilder.el("span", { text: wanStr, style: { fontFamily: "monospace", fontSize: "0.9em" } }),
        ]));

        const entries = this._nat.getEntries();
        if (entries.length === 0) {
            const empty = DOMBuilder.el("p", { text: t("homerouter.nat.empty") });
            empty.style.color = "var(--muted)";
            empty.style.fontSize = "12px";
            empty.style.marginTop = "8px";
            host.appendChild(empty);
        } else {
            const table = DOMBuilder.el("table", { className: "router-routes-table" });
            const thead = DOMBuilder.el("thead");
            thead.innerHTML = `<tr>
                <th>${t("homerouter.nat.col.proto")}</th>
                <th>${t("homerouter.nat.col.lanip")}</th>
                <th>${t("homerouter.nat.col.lanport")}</th>
                <th>${t("homerouter.nat.col.natport")}</th>
            </tr>`;
            table.appendChild(thead);

            const tbody = DOMBuilder.el("tbody");
            for (const e of entries) {
                const lanIpStr = ipToString(e.lanIpNum);
                const portLabel = e.proto === "ICMP" ? t("homerouter.nat.icmpid") : "";
                const tr = DOMBuilder.el("tr", { children: [
                    DOMBuilder.el("td", { text: e.proto, style: { fontFamily: "monospace" } }),
                    DOMBuilder.el("td", { text: lanIpStr, style: { fontFamily: "monospace" } }),
                    DOMBuilder.el("td", { text: String(e.lanPort) + (portLabel ? ` (${portLabel})` : ""), style: { fontFamily: "monospace" } }),
                    DOMBuilder.el("td", { text: String(e.natPort), style: { fontFamily: "monospace" } }),
                ]});
                tbody.appendChild(tr);
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
        this._pollTimer = window.setInterval(() => this._updateStatusPanel(), 2000);
    }

    _stopPoll() {
        if (this._pollTimer != null) { clearInterval(this._pollTimer); this._pollTimer = null; }
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
