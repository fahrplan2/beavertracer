//@ts-check

/**
 * Layer-3 RFC compliance regressions:
 *  - RFC 4861 §7.2.4 / RFC 4862 §5.4.3: DAD probe handling (NA to ff02::1, S=0, O=1, TLLA;
 *    only an NS from :: is a DAD conflict)
 *  - RFC 4861 §4.4: NA R flag for routers
 *  - RFC 1122 §3.2.2.6 / RFC 4443 §4.2: echo reply to a multicast request uses a unicast source
 *  - RFC 8200 §5 / RFC 4443 §3.2: Packet Too Big instead of oversized forwarding
 *  - RFC 4291 §2.5.6 / RFC 4443 §3.1: link-local scope on the forwarding path
 *  - RFC 4443 §2.4(e): multicast exception checks the original destination
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { IPStack } from '../../src/net/IPStack.js';
import { NetworkInterface } from '../../src/net/NetworkInterface.js';
import { IPv6Packet } from '../../src/net/pdu/IPv6Packet.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { ICMPv6Packet } from '../../src/net/pdu/ICMPv6Packet.js';
import { ICMPPacket } from '../../src/net/pdu/ICMPPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

const ip = (/** @type {string} */ s) => IPAddress.fromString(s);
const hexMac = (/** @type {Uint8Array} */ m) => Array.from(m).map(b => b.toString(16).padStart(2, '0')).join(':');

async function flush(n = 30) {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

/** NS packet (src/dst/target), optionally with SLLA. */
function mkNS(src, dst, target, slla = null) {
    const ns = ICMPv6Packet.buildNS(ip(target), slla);
    return new IPv6Packet({ src: ip(src), dst: ip(dst), nextHeader: 58, hopLimit: 255, payload: ns.pack(ip(src), ip(dst)) });
}

/** Capture frames sent by a NetworkInterface's port. */
function capturePort(itf) {
    /** @type {any[]} */
    const frames = [];
    vi.spyOn(itf.port, 'send').mockImplementation((/** @type {any} */ f) => { frames.push(f); });
    return frames;
}

/** Capture sendFrame() calls as parsed IPv6 packets. */
function captureV6(itf) {
    /** @type {IPv6Packet[]} */
    const pkts = [];
    vi.spyOn(itf, 'sendFrame').mockImplementation((/** @type {any} */ _mac, /** @type {number} */ et, /** @type {Uint8Array} */ bytes) => {
        if (et === 0x86DD) pkts.push(IPv6Packet.fromBytes(bytes));
    });
    return pkts;
}

describe('NDP: DAD probe handling (RFC 4861 §7.2.4)', () => {
    it('answers a DAD probe for an own address with NA to ff02::1, S=0, O=1, TLLA', () => {
        const itf = new NetworkInterface({ name: 'eth0' });
        itf.ip6 = ip('2001:db8::5');
        const frames = capturePort(itf);

        itf._handleIPv6(mkNS('::', 'ff02::1:ff00:5', '2001:db8::5'));

        expect(frames).toHaveLength(1);
        const f = frames[0];
        expect(hexMac(f.dstMac)).toBe('33:33:00:00:00:01');
        const v6 = IPv6Packet.fromBytes(f.payload);
        expect(v6.dst.toString()).toBe(ip('ff02::1').toString());
        expect(v6.hopLimit).toBe(255);
        const na = ICMPv6Packet.fromBytes(v6.payload);
        expect(na.type).toBe(136);
        expect(na.ndpSolicited).toBe(false);
        expect(na.ndpOverride).toBe(true);
        expect(na.ndpRouter).toBe(false);
        expect(na.ndpTarget?.toString()).toBe(ip('2001:db8::5').toString());
        expect(hexMac(/** @type {Uint8Array} */ (na.getLinkLayerAddress()))).toBe(hexMac(itf.mac));
        // probe from :: must not create a neighbor cache entry for ::
        expect(itf.neighborCache.has(ip('::').toString())).toBe(false);
    });

    it('answers a normal NS unicast with S=1 and sets R=1 when the node is a router', () => {
        const itf = new NetworkInterface({ name: 'eth0' });
        itf.ip6 = ip('2001:db8::5');
        itf.isRouter = true;
        const frames = capturePort(itf);
        const peerMac = new Uint8Array([2, 0, 0, 0, 0, 9]);

        itf._handleIPv6(mkNS('2001:db8::9', 'ff02::1:ff00:5', '2001:db8::5', peerMac));

        expect(frames).toHaveLength(1);
        expect(hexMac(frames[0].dstMac)).toBe(hexMac(peerMac));
        const v6 = IPv6Packet.fromBytes(frames[0].payload);
        expect(v6.dst.toString()).toBe(ip('2001:db8::9').toString());
        const na = ICMPv6Packet.fromBytes(v6.payload);
        expect(na.ndpSolicited).toBe(true);
        expect(na.ndpRouter).toBe(true);
    });

    it('IPStack.forwarding propagates to the interfaces (R flag)', () => {
        const stack = new IPStack(2, 'R');
        expect(stack.interfaces[0].isRouter).toBe(false);
        stack.forwarding = true;
        expect(stack.interfaces.every(i => i.isRouter)).toBe(true);
        stack.addNewInterface();
        expect(stack.interfaces[2].isRouter).toBe(true);
    });
});

describe('DAD conflict detection (RFC 4862 §5.4.3)', () => {
    it('an NS with a unicast source for a tentative address is not a conflict and is not answered', () => {
        const itf = new NetworkInterface({ name: 'eth0' });
        const frames = capturePort(itf);
        const key = ip('2001:db8::7').toString();
        itf._dadPending.add(key);

        itf._handleIPv6(mkNS('2001:db8::9', 'ff02::1:ff00:7', '2001:db8::7', new Uint8Array([2, 0, 0, 0, 0, 9])));

        expect(itf._dadConflicts.has(key)).toBe(false);
        expect(frames).toHaveLength(0);
    });

    it('an NS from :: (foreign DAD probe) for a tentative address is a conflict', () => {
        const itf = new NetworkInterface({ name: 'eth0' });
        const frames = capturePort(itf);
        const key = ip('2001:db8::7').toString();
        itf._dadPending.add(key);

        itf._handleIPv6(mkNS('::', 'ff02::1:ff00:7', '2001:db8::7'));

        expect(itf._dadConflicts.has(key)).toBe(true);
        expect(frames).toHaveLength(0);
    });
});

describe('ICMPv6Packet.buildNA flags', () => {
    it('sets R/S/O as requested', () => {
        const mac = new Uint8Array([2, 0, 0, 0, 0, 1]);
        expect(ICMPv6Packet.buildNA(ip('fe80::1'), mac, true, { router: true }).ndpFlags >>> 0).toBe(0xE0000000);
        expect(ICMPv6Packet.buildNA(ip('fe80::1'), mac, false).ndpFlags >>> 0).toBe(0x20000000);
        expect(ICMPv6Packet.buildNA(ip('fe80::1'), mac, false, { override: false }).ndpFlags >>> 0).toBe(0);
    });
});

describe('Echo replies to multicast requests use a unicast source', () => {
    it('ICMPv6 echo to ff02::1 → reply from the link-local address of the receiving interface', async () => {
        const stack = new IPStack(1, 'H');
        const itf = stack.interfaces[0];
        itf.ip6 = ip('2001:db8::5');
        itf.neighborCache.set(ip('fe80::99').toString(), new Uint8Array([2, 0, 0, 0, 0, 0x99]));
        const out = captureV6(itf);

        const req = ICMPv6Packet.buildEchoRequest(1, 2, new Uint8Array(8));
        const pkt = new IPv6Packet({ src: ip('fe80::99'), dst: ip('ff02::1'), nextHeader: 58, hopLimit: 64, payload: req.pack(ip('fe80::99'), ip('ff02::1')) });
        await stack.routeV6(pkt, false, 0);
        await flush();

        expect(out).toHaveLength(1);
        expect(out[0].src.toString()).toBe(itf.ip6LL?.toString());
        expect(out[0].dst.toString()).toBe(ip('fe80::99').toString());
        expect(ICMPv6Packet.fromBytes(out[0].payload).type).toBe(129);
    });

    it('ICMPv4 echo to 224.0.0.1 → reply from the receiving interface address', async () => {
        const stack = new IPStack(1, 'H');
        stack.configureInterface(0, { ip: '10.0.0.5', prefixLength: 24 });
        const spy = vi.spyOn(stack, 'send').mockImplementation(async () => {});

        const icmp = new ICMPPacket({ type: 8, code: 0, identifier: 1, sequence: 1, payload: new Uint8Array(4) }).pack();
        const pkt = new IPv4Packet({ src: ip('10.0.0.9'), dst: ip('224.0.0.1'), protocol: 1, ttl: 1, payload: icmp });
        stack.accept(pkt, 0);

        expect(spy).toHaveBeenCalledTimes(1);
        const opts = /** @type {any} */ (spy.mock.calls[0][0]);
        expect(opts.src?.toString()).toBe('10.0.0.5');
    });
});

/** Router with eth0 (2001:db8:1::1/64) and eth1 (2001:db8:2::1/64). */
function mkRouter() {
    const stack = new IPStack(2, 'R');
    ['2001:db8:1::1', '2001:db8:2::1'].forEach((a, i) => {
        stack.interfaces[i].ip6 = ip(a);
        stack.interfaces[i].prefixLength6 = 64;
    });
    stack._updateAutoRoutes();
    stack.forwarding = true;
    stack.interfaces[0].neighborCache.set(ip('2001:db8:1::10').toString(), new Uint8Array([2, 0, 0, 0, 1, 0x10]));
    stack.interfaces[1].neighborCache.set(ip('2001:db8:2::10').toString(), new Uint8Array([2, 0, 0, 0, 2, 0x10]));
    return stack;
}

describe('IPv6 forwarding: Packet Too Big (RFC 8200 §5, RFC 4443 §3.2)', () => {
    it('does not forward an oversized packet and sends PTB with the egress MTU', async () => {
        const stack = mkRouter();
        stack.interfaces[1].mtuOverride = 1280;
        const out0 = captureV6(stack.interfaces[0]);
        const out1 = captureV6(stack.interfaces[1]);

        const pkt = new IPv6Packet({ src: ip('2001:db8:1::10'), dst: ip('2001:db8:2::10'), nextHeader: 59, hopLimit: 64, payload: new Uint8Array(1400) });
        await stack.routeV6(pkt, false, 0);
        await flush();

        expect(out1).toHaveLength(0);
        expect(out0).toHaveLength(1);
        const err = out0[0];
        expect(err.src.toString()).toBe(ip('2001:db8:1::1').toString());
        expect(err.dst.toString()).toBe(ip('2001:db8:1::10').toString());
        expect(err.pack().length).toBe(1280);
        const icmp = ICMPv6Packet.fromBytes(err.payload);
        expect(icmp.type).toBe(2);
        expect(icmp.code).toBe(0);
        const mtu = (icmp.body[0] << 24) | (icmp.body[1] << 16) | (icmp.body[2] << 8) | icmp.body[3];
        expect(mtu).toBe(1280);
    });

    it('forwards a packet that fits', async () => {
        const stack = mkRouter();
        stack.interfaces[1].mtuOverride = 1280;
        const out1 = captureV6(stack.interfaces[1]);
        const pkt = new IPv6Packet({ src: ip('2001:db8:1::10'), dst: ip('2001:db8:2::10'), nextHeader: 59, hopLimit: 64, payload: new Uint8Array(1240) });
        await stack.routeV6(pkt, false, 0);
        await flush();
        expect(out1).toHaveLength(1);
        expect(out1[0].hopLimit).toBe(63);
    });
});

describe('IPv6 forwarding: link-local scope', () => {
    it('does not forward a packet with a link-local destination back onto the link', async () => {
        const stack = mkRouter();
        stack.interfaces[0].neighborCache.set(ip('fe80::2').toString(), new Uint8Array([2, 0, 0, 0, 0, 2]));
        const out0 = captureV6(stack.interfaces[0]);
        const out1 = captureV6(stack.interfaces[1]);
        const pkt = new IPv6Packet({ src: ip('fe80::1'), dst: ip('fe80::2'), nextHeader: 59, hopLimit: 64 });
        await stack.routeV6(pkt, false, 0);
        await flush();
        expect(out0).toHaveLength(0);
        expect(out1).toHaveLength(0);
    });

    it('link-local source to another link → Destination Unreachable code 2 via the ingress link', async () => {
        const stack = mkRouter();
        stack.interfaces[0].neighborCache.set(ip('fe80::1').toString(), new Uint8Array([2, 0, 0, 0, 0, 1]));
        const out0 = captureV6(stack.interfaces[0]);
        const out1 = captureV6(stack.interfaces[1]);
        const pkt = new IPv6Packet({ src: ip('fe80::1'), dst: ip('2001:db8:2::10'), nextHeader: 59, hopLimit: 64 });
        await stack.routeV6(pkt, false, 0);
        await flush();
        expect(out1).toHaveLength(0);
        expect(out0).toHaveLength(1);
        expect(out0[0].src.toString()).toBe(stack.interfaces[0].ip6LL?.toString());
        const icmp = ICMPv6Packet.fromBytes(out0[0].payload);
        expect(icmp.type).toBe(1);
        expect(icmp.code).toBe(2);
    });
});

describe('_sendICMPv6Error: RFC 4443 §2.4(e) multicast exception', () => {
    it('suppresses errors for packets sent to a multicast destination, except Packet Too Big', () => {
        const stack = mkRouter();
        const spy = vi.spyOn(stack, 'routeV6').mockImplementation(async () => {});
        const orig = new IPv6Packet({ src: ip('2001:db8:1::10'), dst: ip('ff0e::1234'), nextHeader: 17, hopLimit: 64, payload: new Uint8Array(8) });

        stack._sendICMPv6Error(orig, 1, 0);
        stack._sendICMPv6Error(orig, 3, 0);
        expect(spy).not.toHaveBeenCalled();

        stack._sendICMPv6Error(orig, 2, 0, 1280);
        stack._sendICMPv6Error(orig, 4, 2, 40);
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('never sends an error to a multicast source', () => {
        const stack = mkRouter();
        const spy = vi.spyOn(stack, 'routeV6').mockImplementation(async () => {});
        const orig = new IPv6Packet({ src: ip('ff02::1'), dst: ip('2001:db8:2::10'), nextHeader: 17, hopLimit: 64, payload: new Uint8Array(8) });
        stack._sendICMPv6Error(orig, 2, 0, 1280);
        expect(spy).not.toHaveBeenCalled();
    });
});
