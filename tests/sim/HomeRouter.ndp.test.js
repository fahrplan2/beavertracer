//@ts-check

/**
 * HomeRouter LAN NDP: DAD probe answered per RFC 4861 §7.2.4 (NA to ff02::1, S=0, R=1).
 *
 * Topology:
 *   LAN host (192.168.1.50) ── eth1 ── [HomeRouter] ── wan0 ── WAN host (203.0.113.50)
 *
 * Frames are injected directly at the EthernetPort level (recieve()/getNextOutgoingFrame()),
 * bypassing EthernetLink/SimControl — same approach as the SwitchBackplane and
 * IPStack.fragmentation integration tests. HomeRouter's ports auto-drive update()
 * via the Observable.doUpdate() → subscriber.update() hook on every recieve()/send(),
 * so only the async LAN→WAN / WAN→LAN forwarding hops need an explicit microtask flush.
 */

import { describe, it, expect, vi } from 'vitest';

// SimControl pulls in browser UI code — mock to break the circular dependency
// (EthernetPort → EthernetLink → sim/Link → SimControl → AccessPoint → WirelessPort).
vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

// ── Minimal DOM stub (HomeRouter extends SimulatedObject, which touches document in its ctor) ──
if (!globalThis.document) {
    const makeFakeEl = () => {
        const el = {
            classList: { add() {}, remove() {} },
            style: {},
            disabled: false,
            value: '',
            checked: false,
            textContent: '',
            childElementCount: 0,
            get scrollTop() { return 0; },
            set scrollTop(_v) {},
            get scrollHeight() { return 0; },
            replaceChildren() {},
            appendChild() { return el; },
            removeChild() { return el; },
            addEventListener() {},
            setAttribute() {},
            querySelectorAll() { return []; },
        };
        return el;
    };
    // @ts-ignore
    globalThis.document = {
        createElement: (_tag) => makeFakeEl(),
        createTextNode: (_t) => ({}),
        createDocumentFragment: () => ({ appendChild() {} }),
    };
}

import { HomeRouter } from '../../src/sim/HomeRouter.js';
import { IPv6Packet } from '../../src/net/pdu/IPv6Packet.js';
import { ICMPv6Packet } from '../../src/net/pdu/ICMPv6Packet.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

const hexMac = (/** @type {Uint8Array} */ m) => Array.from(m).map(b => b.toString(16).padStart(2, '0')).join(':');

describe('HomeRouter LAN NDP', () => {
    it('answers a DAD probe for its LAN link-local address to all-nodes with S=0, R=1', () => {
        const router = new HomeRouter('R1');
        const ll = IPAddress.fromUInt8(router._lanLinkLocalBytes());
        const unspec = IPAddress.fromString('::');
        const llB = ll.toUInt8();
        const sn = IPAddress.fromUInt8(new Uint8Array([0xff, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xff, llB[13], llB[14], llB[15]]));
        const ns = ICMPv6Packet.buildNS(ll);
        const pkt = new IPv6Packet({ src: unspec, dst: sn, nextHeader: 58, hopLimit: 255, payload: ns.pack(unspec, sn) });

        /** @type {any[]} */
        const sent = [];
        const port = { send: (/** @type {any} */ f) => sent.push(f) };
        router._handleLanIpv6(pkt, new Uint8Array([0xaa, 0, 0, 0, 0, 1]), /** @type {any} */ (port));

        expect(sent).toHaveLength(1);
        expect(hexMac(sent[0].dstMac)).toBe('33:33:00:00:00:01');
        const v6 = IPv6Packet.fromBytes(sent[0].payload);
        expect(v6.dst.toString()).toBe(IPAddress.fromString('ff02::1').toString());
        const na = ICMPv6Packet.fromBytes(v6.payload);
        expect(na.type).toBe(136);
        expect(na.ndpSolicited).toBe(false);
        expect(na.ndpOverride).toBe(true);
        expect(na.ndpRouter).toBe(true);
        expect(na.ndpTarget?.toString()).toBe(ll.toString());
    });

    it('answers a DAD probe on WAN, sent to the real solicited-node address, to all-nodes with S=0', () => {
        const router = new HomeRouter('R1');
        const ll = IPAddress.fromUInt8(router._wanLinkLocalBytes());
        const unspec = IPAddress.fromString('::');
        const llB = ll.toUInt8();
        // ff02::1:ffXX:XXXX — RFC 4291 §2.7.1
        const sn = IPAddress.fromUInt8(new Uint8Array([0xff, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xff, llB[13], llB[14], llB[15]]));
        const ns = ICMPv6Packet.buildNS(ll);
        const pkt = new IPv6Packet({ src: unspec, dst: sn, nextHeader: 58, hopLimit: 255, payload: ns.pack(unspec, sn) });

        /** @type {any[]} */
        const sent = [];
        router.wan0.send = (/** @type {any} */ f) => { sent.push(f); };
        router._handleWanIpv6(pkt, /** @type {any} */ ({ srcMac: new Uint8Array([0xaa, 0, 0, 0, 0, 2]) }));

        expect(sent).toHaveLength(1);
        expect(hexMac(sent[0].dstMac)).toBe('33:33:00:00:00:01');
        const v6 = IPv6Packet.fromBytes(sent[0].payload);
        expect(v6.dst.toString()).toBe(IPAddress.fromString('ff02::1').toString());
        const na = ICMPv6Packet.fromBytes(v6.payload);
        expect(na.type).toBe(136);
        expect(na.ndpSolicited).toBe(false);
        expect(na.ndpTarget?.toString()).toBe(ll.toString());
    });
});
