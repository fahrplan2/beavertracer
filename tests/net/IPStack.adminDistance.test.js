//@ts-check

/**
 * Tests for administrative-distance tiebreaking in IPStack._resolveOutgoing().
 *
 * Rule: longest-prefix match wins first; among routes with the *same*
 * prefix length, the route with the lower administrative distance wins.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { IPStack, Route, adminDistanceOf } from '../../src/net/IPStack.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

const ZERO = IPAddress.fromString('0.0.0.0');

describe('adminDistanceOf', () => {
    it('ranks sources in the expected Cisco/MikroTik order', () => {
        expect(adminDistanceOf('connected')).toBe(0);
        expect(adminDistanceOf('static')).toBeLessThan(adminDistanceOf('bgp-ext'));
        expect(adminDistanceOf('bgp-ext')).toBeLessThan(adminDistanceOf('ospf'));
        expect(adminDistanceOf('ospf')).toBeLessThan(adminDistanceOf('rip'));
        expect(adminDistanceOf('rip')).toBeLessThan(adminDistanceOf('bgp-int'));
    });

    it('falls back to a high distance for an unrecognized source', () => {
        expect(adminDistanceOf('made-up-protocol')).toBe(255);
    });
});

describe('_resolveOutgoing – administrative distance tiebreak', () => {
    it('prefers the lower-AD route when two routes match the same prefix length', () => {
        const stack = new IPStack(1, 'host');
        const dst = IPAddress.fromString('192.168.50.0');

        // Insert the worse (higher-AD) route first so a naive
        // "first match in the table wins" bug would fail this test.
        stack.addRoute(dst, 24, 0, ZERO, 'rip');
        stack.addRoute(dst, 24, 0, ZERO, 'static');

        const out = stack._resolveOutgoing(IPAddress.fromString('192.168.50.5'));
        expect(out?.route.source).toBe('static');
    });

    it('prefers connected over static for the same prefix', () => {
        const stack = new IPStack(1, 'host');
        const dst = IPAddress.fromString('10.0.0.0');

        stack.addRoute(dst, 8, 0, ZERO, 'static');

        const connected = new Route();
        connected.dst = dst;
        connected.prefixLength = 8;
        connected.interf = 0;
        connected.nexthop = ZERO;
        connected.source = 'connected';
        stack.routingTable.push(connected);

        const out = stack._resolveOutgoing(IPAddress.fromString('10.1.2.3'));
        expect(out?.route.source).toBe('connected');
    });

    it('still lets a longer prefix win even if its source has a worse administrative distance', () => {
        const stack = new IPStack(1, 'host');
        stack.addRoute(IPAddress.fromString('192.168.0.0'), 16, 0, ZERO, 'static');
        stack.addRoute(IPAddress.fromString('192.168.50.0'), 24, 0, ZERO, 'rip');

        const out = stack._resolveOutgoing(IPAddress.fromString('192.168.50.5'));
        expect(out?.route.source).toBe('rip'); // /24 beats /16 despite the worse AD
    });
});
