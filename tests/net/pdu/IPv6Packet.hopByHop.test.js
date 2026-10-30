//@ts-check
import { describe, it, expect } from 'vitest';
import { IPv6Packet } from '../../../src/net/pdu/IPv6Packet.js';
import { IPAddress } from '../../../src/net/models/IPAddress.js';

const src = IPAddress.fromString('fe80::1');
const dst = IPAddress.fromString('ff02::16');

describe('IPv6Packet – Hop-by-Hop Options header (RFC 8200 §4.3)', () => {
    it('routerAlertOptions(0) is Router Alert MLD + PadN2 (RFC 2711)', () => {
        expect(Array.from(IPv6Packet.routerAlertOptions(0))).toEqual([0x05, 0x02, 0x00, 0x00, 0x01, 0x00]);
    });

    it('packs base header with Next Header 0, then HbH {upper NH, len 0, options}', () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const b = new IPv6Packet({ src, dst, nextHeader: 58, hopLimit: 1, payload,
            hopByHop: IPv6Packet.routerAlertOptions(0) }).pack();
        expect(b.length).toBe(40 + 8 + 4);
        expect((b[4] << 8) | b[5]).toBe(12);   // payload length includes HbH
        expect(b[6]).toBe(0);                  // Next Header = Hop-by-Hop
        expect(b[7]).toBe(1);
        expect(Array.from(b.slice(40, 48))).toEqual([58, 0, 0x05, 0x02, 0, 0, 0x01, 0x00]);
        expect(Array.from(b.slice(48))).toEqual([1, 2, 3, 4]);
    });

    it('fromBytes exposes the upper-layer next header and payload, keeping hopByHop', () => {
        const orig = new IPv6Packet({ src, dst, nextHeader: 58, payload: new Uint8Array([9, 8]),
            hopByHop: IPv6Packet.routerAlertOptions(0) });
        const p = IPv6Packet.fromBytes(orig.pack());
        expect(p.nextHeader).toBe(58);
        expect(Array.from(p.payload)).toEqual([9, 8]);
        expect(Array.from(/** @type {Uint8Array} */ (p.hopByHop))).toEqual([0x05, 0x02, 0, 0, 0x01, 0x00]);
        expect(Array.from(p.pack())).toEqual(Array.from(orig.pack())); // round trip
    });

    it('packets without HbH are unchanged (hopByHop null)', () => {
        const b = new IPv6Packet({ src, dst, nextHeader: 17, payload: new Uint8Array(3) }).pack();
        expect(b[6]).toBe(17);
        expect(b.length).toBe(43);
        expect(IPv6Packet.fromBytes(b).hopByHop).toBeNull();
    });

    it('rejects unpadded option bytes', () => {
        expect(() => new IPv6Packet({ hopByHop: new Uint8Array([0x05, 0x02, 0, 0]) })).toThrow();
    });

    it('rejects truncated HbH header', () => {
        const b = new Uint8Array(44);
        b[0] = 0x60; b[5] = 4; b[6] = 0;
        expect(() => IPv6Packet.fromBytes(b)).toThrow();
    });

    it('upperLayer() skips HbH or returns offset 40 without it', () => {
        const withHbh = new IPv6Packet({ src, dst, nextHeader: 58, payload: new Uint8Array(24),
            hopByHop: IPv6Packet.routerAlertOptions(0) }).pack();
        expect(IPv6Packet.upperLayer(withHbh)).toEqual({ offset: 48, nextHeader: 58 });
        const plain = new IPv6Packet({ src, dst, nextHeader: 58, payload: new Uint8Array(24) }).pack();
        expect(IPv6Packet.upperLayer(plain)).toEqual({ offset: 40, nextHeader: 58 });
        expect(IPv6Packet.upperLayer(new Uint8Array(10))).toBeNull();
    });
});
