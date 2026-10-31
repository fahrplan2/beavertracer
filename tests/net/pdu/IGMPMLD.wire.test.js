//@ts-check
/**
 * Wire format of IGMPv2 (RFC 2236) and MLDv1 (RFC 2710) messages sent by IPStack,
 * plus receive path (Query → Report) and switch snooping with these real frames.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { IPStack } from '../../../src/net/IPStack.js';
import { IPAddress } from '../../../src/net/models/IPAddress.js';
import { IPv4Packet } from '../../../src/net/pdu/IPv4Packet.js';
import { IPv6Packet } from '../../../src/net/pdu/IPv6Packet.js';
import { EthernetFrame } from '../../../src/net/pdu/EthernetFrame.js';
import { SwitchBackplane } from '../../../src/net/SwitchBackplane.js';
import { onesComplementChecksum, computeIPv6PseudoChecksum } from '../../../src/net/util/checksumUtils.js';

/** @returns {{ s: IPStack, sent: {dstMac:Uint8Array, etherType:number, payload:Uint8Array}[] }} */
function makeStack() {
    const s = new IPStack(1, 'H');
    s.configureInterface(0, { ip: '10.0.0.5', prefixLength: 24 });
    s.interfaces[0].ip6LL = IPAddress.fromString('fe80::5');
    /** @type {{dstMac:Uint8Array, etherType:number, payload:Uint8Array}[]} */
    const sent = [];
    s.interfaces[0].sendFrame = (dstMac, etherType, payload) => { sent.push({ dstMac, etherType, payload }); };
    return { s, sent };
}

describe('IGMPv2 wire format (RFC 2236 §2, RFC 2113)', () => {
    it('Membership Report: IHL 6, Router Alert, TTL 1, valid checksums', () => {
        const { s, sent } = makeStack();
        s.sendIGMP(IPAddress.fromString('239.1.2.3'), 0x16);
        expect(sent.length).toBe(1);
        const { dstMac, etherType, payload: ip } = sent[0];
        expect(etherType).toBe(0x0800);
        expect(Array.from(dstMac)).toEqual([0x01, 0x00, 0x5e, 0x01, 0x02, 0x03]);
        expect(ip.length).toBe(32);
        expect(ip[0]).toBe(0x46);
        expect((ip[2] << 8) | ip[3]).toBe(32);
        expect(ip[8]).toBe(1);
        expect(ip[9]).toBe(2);
        expect(Array.from(ip.slice(16, 20))).toEqual([239, 1, 2, 3]);
        expect(Array.from(ip.slice(20, 24))).toEqual([0x94, 0x04, 0x00, 0x00]);
        expect(onesComplementChecksum([ip.slice(0, 24)])).toBe(0);
        const igmp = ip.slice(24);
        // 0x1600 + 0xef01 + 0x0203 = 0x10704 → 0x0705 → ~ = 0xf8fa
        expect(Array.from(igmp)).toEqual([0x16, 0x00, 0xf8, 0xfa, 239, 1, 2, 3]);
        expect(onesComplementChecksum([igmp])).toBe(0);
    });

    it('Leave Group goes to 224.0.0.2 with valid checksum', () => {
        const { s, sent } = makeStack();
        s.sendIGMP(IPAddress.fromString('239.1.2.3'), 0x17);
        const ip = sent[0].payload;
        expect(Array.from(ip.slice(16, 20))).toEqual([224, 0, 0, 2]);
        expect(ip[24]).toBe(0x17);
        expect(onesComplementChecksum([ip.slice(24, 32)])).toBe(0);
    });

    it('General Query from the switch querier triggers a re-report', () => {
        const { s, sent } = makeStack();
        s.sendIGMP(IPAddress.fromString('239.1.2.3'), 0x16);
        sent.length = 0;
        const query = new SwitchBackplane(2)['_buildIGMPQueryFrame']();
        s.accept(IPv4Packet.fromBytes(query.payload), 0);
        expect(sent.length).toBe(1);
        expect(sent[0].payload[24]).toBe(0x16);
    });

    it('switch snooping learns the group from a report with IPv4 options', () => {
        const { s, sent } = makeStack();
        s.sendIGMP(IPAddress.fromString('239.1.2.3'), 0x16);
        const bp = new SwitchBackplane(2);
        bp.enableIGMPSnooping();
        const f = new EthernetFrame({ srcMac: new Uint8Array([2, 0, 0, 0, 0, 5]), dstMac: sent[0].dstMac,
            etherType: 0x0800, payload: sent[0].payload });
        expect(bp._processIGMP(1, f)).toBe(0x16);
        const entry = [...bp.mcastTable.values()][0];
        expect(entry.ip).toBe('239.1.2.3');
        expect(entry.ports.has(1)).toBe(true);
        bp.disableIGMPSnooping();
    });
});

describe('MLDv1 wire format (RFC 2710 §3, RFC 2711, RFC 8200 §8.1)', () => {
    it('Report: HbH Router Alert, hop limit 1, link-local src, valid ICMPv6 checksum', () => {
        const { s, sent } = makeStack();
        s.sendMLD(IPAddress.fromString('ff15::1234'), 0x83);
        expect(sent.length).toBe(1);
        const { dstMac, etherType, payload: b } = sent[0];
        expect(etherType).toBe(0x86DD);
        expect(Array.from(dstMac)).toEqual([0x33, 0x33, 0, 0, 0x12, 0x34]);
        expect(b.length).toBe(40 + 8 + 24);
        expect((b[4] << 8) | b[5]).toBe(32);
        expect(b[6]).toBe(0);
        expect(b[7]).toBe(1);
        expect(IPAddress.fromUInt8(b.slice(8, 24)).toString()).toBe(IPAddress.fromString('fe80::5').toString());
        expect(Array.from(b.slice(40, 48))).toEqual([58, 0, 0x05, 0x02, 0x00, 0x00, 0x01, 0x00]);
        const mld = b.slice(48);
        expect(mld[0]).toBe(0x83);
        expect(mld[1]).toBe(0);
        expect((mld[2] << 8) | mld[3]).not.toBe(0);
        // pseudo-header: upper-layer length 24, next header 58 (HbH excluded)
        expect(computeIPv6PseudoChecksum(mld, b.slice(8, 24), b.slice(24, 40), 58)).toBe(0);
        expect(Array.from(mld.slice(8, 24))).toEqual(Array.from(IPAddress.fromString('ff15::1234').toUInt8()));
    });

    it('Done goes to ff02::2', () => {
        const { s, sent } = makeStack();
        s.sendMLD(IPAddress.fromString('ff15::1234'), 0x84);
        const b = sent[0].payload;
        expect(IPAddress.fromUInt8(b.slice(24, 40)).toString()).toBe(IPAddress.fromString('ff02::2').toString());
        expect(b[48]).toBe(0x84);
        expect(computeIPv6PseudoChecksum(b.slice(48), b.slice(8, 24), b.slice(24, 40), 58)).toBe(0);
    });

    it('General Query (with HbH) from the switch querier triggers a re-report', () => {
        const { s, sent } = makeStack();
        s.sendMLD(IPAddress.fromString('ff15::1234'), 0x83);
        sent.length = 0;
        const query = new SwitchBackplane(2)['_buildMLDQueryFrame']();
        const pkt = IPv6Packet.fromBytes(query.payload);
        expect(pkt.nextHeader).toBe(58);
        s.acceptV6(pkt, 0);
        expect(sent.length).toBe(1);
        expect(sent[0].payload[48]).toBe(0x83);
    });

    it('switch snooping learns the group from a report with Hop-by-Hop header', () => {
        const { s, sent } = makeStack();
        s.sendMLD(IPAddress.fromString('ff15::1234'), 0x83);
        const bp = new SwitchBackplane(2);
        bp.enableIGMPSnooping();
        const f = new EthernetFrame({ srcMac: new Uint8Array([2, 0, 0, 0, 0, 5]), dstMac: sent[0].dstMac,
            etherType: 0x86DD, payload: sent[0].payload });
        expect(bp._processMLD(1, f)).toBe(0x83);
        const entry = [...bp.mcastTable.values()][0];
        expect(entry.ip).toBe(IPAddress.fromString('ff15::1234').toString());
        expect(entry.ports.has(1)).toBe(true);
        bp.disableIGMPSnooping();
    });
});
