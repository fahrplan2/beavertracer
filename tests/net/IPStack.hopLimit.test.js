//@ts-check

/**
 * Regression tests for Hop Limit / TTL=0 handling on the forwarding path.
 * A packet that already arrives with Hop Limit (IPv6) or TTL (IPv4) at 0
 * must be dropped with an ICMP(v6) error, never decremented into a wraparound
 * (255 for IPv6, -1/255 for IPv4) that would let it keep being forwarded.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { IPStack } from '../../src/net/IPStack.js';
import { IPv6Packet } from '../../src/net/pdu/IPv6Packet.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

describe('IPStack.routeV6 – Hop Limit handling', () => {
    it('drops a forwarded packet arriving with Hop Limit 0 (link-local branch) instead of wrapping to 255', async () => {
        const stack = new IPStack(1, 'R');
        stack.configureInterface(0, { ip: '10.0.0.1', prefixLength: 24 });
        stack.forwarding = true;

        const spy = vi.spyOn(stack, '_sendICMPv6Error').mockImplementation(() => {});
        const sendFrameSpy = vi.spyOn(stack.interfaces[0], 'sendFrame');

        const packet = new IPv6Packet({
            src: IPAddress.fromString('fe80::1'),
            dst: IPAddress.fromString('fe80::2'),
            hopLimit: 0,
            nextHeader: 59,
        });

        await stack.routeV6(packet, false, 0);

        expect(spy).toHaveBeenCalledWith(packet, 3, 0);
        expect(sendFrameSpy).not.toHaveBeenCalled();
        expect(packet.hopLimit).toBe(0); // must not wrap to 255
    });

    it('drops a forwarded packet arriving with Hop Limit 1 after decrementing to 0', async () => {
        const stack = new IPStack(1, 'R');
        stack.configureInterface(0, { ip: '10.0.0.1', prefixLength: 24 });
        stack.forwarding = true;

        const spy = vi.spyOn(stack, '_sendICMPv6Error').mockImplementation(() => {});
        const sendFrameSpy = vi.spyOn(stack.interfaces[0], 'sendFrame');

        const packet = new IPv6Packet({
            src: IPAddress.fromString('fe80::1'),
            dst: IPAddress.fromString('fe80::2'),
            hopLimit: 1,
            nextHeader: 59,
        });

        await stack.routeV6(packet, false, 0);

        expect(spy).toHaveBeenCalledWith(packet, 3, 0);
        expect(sendFrameSpy).not.toHaveBeenCalled();
    });
});

describe('IPStack.route – TTL handling', () => {
    it('drops a forwarded packet arriving with TTL 0 instead of crashing on pack()', async () => {
        const stack = new IPStack(2, 'R');
        stack.configureInterface(0, { ip: '10.0.0.1', prefixLength: 24 });
        stack.configureInterface(1, { ip: '10.0.1.1', prefixLength: 24 });
        stack.forwarding = true;

        const spy = vi.spyOn(stack, '_sendICMPError').mockImplementation(() => {});
        const sendFrameSpy0 = vi.spyOn(stack.interfaces[0], 'sendFrame');
        const sendFrameSpy1 = vi.spyOn(stack.interfaces[1], 'sendFrame');

        const packet = new IPv4Packet({
            src: IPAddress.fromString('10.0.0.50'),
            dst: IPAddress.fromString('10.0.1.50'),
            protocol: 17,
            ttl: 0,
            payload: new Uint8Array(4),
        });

        await expect(stack.route(packet, false, 0)).resolves.not.toThrow();

        expect(spy).toHaveBeenCalledWith(packet, 11, 0);
        expect(sendFrameSpy0).not.toHaveBeenCalled();
        expect(sendFrameSpy1).not.toHaveBeenCalled();
        expect(packet.ttl).toBe(0); // must not go negative
    });
});
