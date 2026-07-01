//@ts-check
import { describe, it, expect } from 'vitest';
import { NatEngine } from '../../src/net/NatEngine.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { UDPPacket } from '../../src/net/pdu/UDPPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

const LAN_IP = '192.168.1.10';
const WAN_IP = '203.0.113.5';
const REMOTE_IP = '198.51.100.7';

/** @param {number} srcPort */
function makeUdpPacket(srcPort) {
    const udp = new UDPPacket({ srcPort, dstPort: 53, payload: new Uint8Array([1, 2, 3]) });
    const src = IPAddress.fromString(LAN_IP);
    const dst = IPAddress.fromString(REMOTE_IP);
    return new IPv4Packet({
        src, dst, protocol: 17,
        payload: udp.pack({ srcIp: src, dstIp: dst }),
    });
}

function wanIpNum() {
    return /** @type {number} */ (IPAddress.fromString(WAN_IP).getNumber());
}

describe('NatEngine – _allocPort', () => {
    it('allocates ports from the configured pool without collisions', () => {
        const nat = new NatEngine();
        const a = nat._allocPort(17);
        const b = nat._allocPort(17);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a).not.toBe(b);
        expect(a).toBeGreaterThanOrEqual(10000);
        expect(a).toBeLessThanOrEqual(60000);
    });

    it('returns null instead of looping forever when the port pool is exhausted', () => {
        const nat = new NatEngine();
        // Fill every port in the pool for this proto.
        for (let p = 10000; p <= 60000; p++) {
            nat._in.set(`${p}:17`, { srcIpNum: 0, srcPort: 0 });
        }
        const result = nat._allocPort(17);
        expect(result).toBeNull();
    });
});

describe('NatEngine – natOutbound', () => {
    it('rewrites source IP/port and creates a session mapping', () => {
        const nat = new NatEngine();
        const pkt = makeUdpPacket(4000);
        const ok = nat.natOutbound(wanIpNum(), pkt);
        expect(ok).toBe(true);
        expect(pkt.src.toString()).toBe(WAN_IP);

        const u = UDPPacket.fromBytes(pkt.payload);
        expect(u.srcPort).not.toBe(4000);
        expect(nat._in.has(`${u.srcPort}:17`)).toBe(true);
    });

    it('drops the packet instead of hanging when no NAT port is available', () => {
        const nat = new NatEngine();
        for (let p = 10000; p <= 60000; p++) {
            nat._in.set(`${p}:17`, { srcIpNum: 0, srcPort: 0 });
        }
        const pkt = makeUdpPacket(4001);
        const ok = nat.natOutbound(wanIpNum(), pkt);
        expect(ok).toBe(false);
    });
});
