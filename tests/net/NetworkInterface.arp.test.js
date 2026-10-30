//@ts-check
// RFC 826 merge step / RFC 5227 §3 gratuitous ARP
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { NetworkInterface } from '../../src/net/NetworkInterface.js';
import { ArpPacket } from '../../src/net/pdu/ArpPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

const ip4 = (/** @type {string} */ s) => IPAddress.fromString(s).toUInt8();
const OLD_MAC = new Uint8Array([2, 0, 0, 0, 0, 1]);
const NEW_MAC = new Uint8Array([0, 0, 0x5e, 0, 1, 1]);

function host() {
    const itf = new NetworkInterface({ name: 'eth0' });
    itf.configure({ ip: IPAddress.fromString('10.0.0.10'), prefixLength: 24 });
    itf.neighborCache.set('10.0.0.1', OLD_MAC);
    return itf;
}

/** Gratuitous ARP request: SPA == TPA == announced address. */
const garp = (/** @type {number} */ oper, /** @type {Uint8Array} */ sha, /** @type {string} */ addr) =>
    new ArpPacket({ oper, sha, spa: ip4(addr), tha: new Uint8Array(6), tpa: ip4(addr) });

describe('NetworkInterface ARP merge (RFC 826)', () => {
    it('a gratuitous ARP request updates an existing cache entry', () => {
        const itf = host();
        itf._handleARP(garp(1, NEW_MAC, '10.0.0.1'));
        expect(Array.from(itf.neighborCache.get('10.0.0.1'))).toEqual(Array.from(NEW_MAC));
    });

    it('a request for someone else also refreshes the sender entry', () => {
        const itf = host();
        itf._handleARP(new ArpPacket({ oper: 1, sha: NEW_MAC, spa: ip4('10.0.0.1'), tha: new Uint8Array(6), tpa: ip4('10.0.0.77') }));
        expect(Array.from(itf.neighborCache.get('10.0.0.1'))).toEqual(Array.from(NEW_MAC));
    });

    it('does not create entries for unknown senders unless we are the target', () => {
        const itf = host();
        itf._handleARP(garp(1, NEW_MAC, '10.0.0.99'));
        expect(itf.neighborCache.has('10.0.0.99')).toBe(false);
    });

    it('ignores ARP probes (sender 0.0.0.0)', () => {
        const itf = host();
        itf._handleARP(new ArpPacket({ oper: 1, sha: NEW_MAC, spa: ip4('0.0.0.0'), tha: new Uint8Array(6), tpa: ip4('10.0.0.1') }));
        expect(itf.neighborCache.has('0.0.0.0')).toBe(false);
        expect(Array.from(itf.neighborCache.get('10.0.0.1'))).toEqual(Array.from(OLD_MAC));
    });
});
