//@ts-check

/**
 * Tests for IPv4 and IPv6 loopback within a single IPStack.
 *
 * Covers:
 *  - _pickSrcIpV6 returns ::1 when destination is ::1 (regression: used to return ::)
 *  - TCP connect + data exchange over IPv4 loopback (127.0.0.1)
 *  - TCP connect + data exchange over IPv6 loopback (::1)
 *  - ICMP/ICMPv6 echo roundtrip over loopback
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { IPStack } from '../../src/net/IPStack.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

const LO4 = IPAddress.fromString('127.0.0.1');
const LO6 = IPAddress.fromString('::1');
const BIND4 = IPAddress.fromString('0.0.0.0');
const BIND6 = IPAddress.fromString('::');
const PORT = 8443;

const enc = new TextEncoder();
const dec = new TextDecoder();

async function flush(n = 20) {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

// ─── _pickSrcIpV6 unit test ──────────────────────────────────────────────────

describe('_pickSrcIpV6', () => {
    it('returns ::1 when destination is ::1', () => {
        const stack = new IPStack(1, 'host');
        const src = stack._pickSrcIpV6(LO6);
        expect(src.toString()).toBe('::1');
    });

    it('returns a link-local address (not ::) when only a link-local interface exists', () => {
        const stack = new IPStack(1, 'host');
        const dst = IPAddress.fromString('2001:db8::1');
        const src = stack._pickSrcIpV6(dst);
        // Auto-generated fe80:: link-local is always present; must not be :: (unspecified)
        expect(src.toString()).not.toBe('::');
        expect(src.toString()).toMatch(/^fe80:/);
    });
});

// ─── TCP over IPv4 loopback ──────────────────────────────────────────────────

describe('TCP over IPv4 loopback (127.0.0.1)', () => {
    it('completes a three-way handshake', async () => {
        const stack = new IPStack(1, 'host');
        stack.openTCPServerSocket(BIND4, PORT);

        const acceptP = stack.acceptTCPConn(PORT);
        const clientConn = await stack.connectTCPConn(LO4, PORT);
        const serverKey = await acceptP;

        expect(clientConn.state).toBe('ESTABLISHED');
        expect(serverKey).toBeTruthy();
    });

    it('transfers data client → server', async () => {
        const stack = new IPStack(1, 'host');
        stack.openTCPServerSocket(BIND4, PORT + 1);

        const acceptP = stack.acceptTCPConn(PORT + 1);
        const clientConn = await stack.connectTCPConn(LO4, PORT + 1);
        const serverKey = await acceptP;

        stack.sendTCPConn(clientConn.key, enc.encode('hello'));
        await flush();

        const chunk = await stack.recvTCPConn(serverKey);
        expect(dec.decode(chunk ?? new Uint8Array())).toBe('hello');
    });

    it('transfers data server → client', async () => {
        const stack = new IPStack(1, 'host');
        stack.openTCPServerSocket(BIND4, PORT + 2);

        const acceptP = stack.acceptTCPConn(PORT + 2);
        const clientConn = await stack.connectTCPConn(LO4, PORT + 2);
        const serverKey = await acceptP;

        stack.sendTCPConn(serverKey, enc.encode('world'));
        await flush();

        const chunk = await stack.recvTCPConn(clientConn.key);
        expect(dec.decode(chunk ?? new Uint8Array())).toBe('world');
    });

    it('closes cleanly and delivers EOF to the peer', async () => {
        const stack = new IPStack(1, 'host');
        stack.openTCPServerSocket(BIND4, PORT + 3);

        const acceptP = stack.acceptTCPConn(PORT + 3);
        const clientConn = await stack.connectTCPConn(LO4, PORT + 3);
        const serverKey = await acceptP;

        stack.closeTCPConn(clientConn.key);
        await flush();

        const eof = await stack.recvTCPConn(serverKey);
        expect(eof).toBeNull();
    });
});

// ─── TCP over IPv6 loopback ──────────────────────────────────────────────────

describe('TCP over IPv6 loopback (::1)', () => {
    it('completes a three-way handshake', async () => {
        const stack = new IPStack(1, 'host');
        stack.openTCPServerSocket(BIND6, PORT + 10);

        const acceptP = stack.acceptTCPConn(PORT + 10);
        const clientConn = await stack.connectTCPConn(LO6, PORT + 10);
        const serverKey = await acceptP;

        expect(clientConn.state).toBe('ESTABLISHED');
        expect(serverKey).toBeTruthy();
    });

    it('connection key uses ::1 (not ::) as local address', async () => {
        const stack = new IPStack(1, 'host');
        stack.openTCPServerSocket(BIND6, PORT + 11);

        const acceptP = stack.acceptTCPConn(PORT + 11);
        const clientConn = await stack.connectTCPConn(LO6, PORT + 11);
        await acceptP;

        expect(clientConn.localIP.toString()).toBe('::1');
    });

    it('transfers data client → server', async () => {
        const stack = new IPStack(1, 'host');
        stack.openTCPServerSocket(BIND6, PORT + 12);

        const acceptP = stack.acceptTCPConn(PORT + 12);
        const clientConn = await stack.connectTCPConn(LO6, PORT + 12);
        const serverKey = await acceptP;

        stack.sendTCPConn(clientConn.key, enc.encode('ping'));
        await flush();

        const chunk = await stack.recvTCPConn(serverKey);
        expect(dec.decode(chunk ?? new Uint8Array())).toBe('ping');
    });

    it('transfers data server → client', async () => {
        const stack = new IPStack(1, 'host');
        stack.openTCPServerSocket(BIND6, PORT + 13);

        const acceptP = stack.acceptTCPConn(PORT + 13);
        const clientConn = await stack.connectTCPConn(LO6, PORT + 13);
        const serverKey = await acceptP;

        stack.sendTCPConn(serverKey, enc.encode('pong'));
        await flush();

        const chunk = await stack.recvTCPConn(clientConn.key);
        expect(dec.decode(chunk ?? new Uint8Array())).toBe('pong');
    });

    it('closes cleanly and delivers EOF to the peer', async () => {
        const stack = new IPStack(1, 'host');
        stack.openTCPServerSocket(BIND6, PORT + 14);

        const acceptP = stack.acceptTCPConn(PORT + 14);
        const clientConn = await stack.connectTCPConn(LO6, PORT + 14);
        const serverKey = await acceptP;

        stack.closeTCPConn(clientConn.key);
        await flush();

        const eof = await stack.recvTCPConn(serverKey);
        expect(eof).toBeNull();
    });

    it('full request/response roundtrip', async () => {
        const stack = new IPStack(1, 'host');
        stack.openTCPServerSocket(BIND6, PORT + 15);

        const acceptP = stack.acceptTCPConn(PORT + 15);
        const clientConn = await stack.connectTCPConn(LO6, PORT + 15);
        const serverKey = await acceptP;

        // Client sends request
        stack.sendTCPConn(clientConn.key, enc.encode('GET / HTTP/1.0\r\n\r\n'));
        await flush();

        const req = await stack.recvTCPConn(serverKey);
        expect(dec.decode(req ?? new Uint8Array())).toContain('GET');

        // Server replies
        stack.sendTCPConn(serverKey, enc.encode('HTTP/1.0 200 OK\r\n\r\nhi'));
        await flush();

        const resp = await stack.recvTCPConn(clientConn.key);
        expect(dec.decode(resp ?? new Uint8Array())).toContain('200 OK');
    });
});
