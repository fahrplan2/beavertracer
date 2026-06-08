//@ts-check

/**
 * Tests for IPv4 fragmentation (_sendFragments), reassembly (_handleFragment),
 * and full ICMP echo roundtrip with fragmentation.
 *
 * Integration tests wire two IPStack instances directly at the NetworkInterface
 * sendFrame level (bypassing EthernetLink / SimControl), with neighbor caches
 * pre-populated to avoid ARP delays.
 */

import { describe, it, expect, vi } from 'vitest';

// Break the circular dependency:
//   EthernetPort → EthernetLink → sim/Link → SimControl → AccessPoint → WirelessPort → EthernetPort (undefined)
// Mocking SimControl.js prevents AccessPoint/WirelessPort from loading.
vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { IPStack } from '../../src/net/IPStack.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { simTimer } from '../../src/lib/SimTimer.js';

const IP_A = '10.0.0.1';
const IP_B = '10.0.0.2';
const MTU = 1500;
const HEADER_LEN = 20;
const MAX_FRAG_PAYLOAD = Math.floor((MTU - HEADER_LEN) / 8) * 8; // 1480

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Flush the microtask queue n times.
 * Each flush lets one level of async continuation run.
 * @param {number} [n]
 */
async function flush(n = 10) {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

/**
 * Create two IPStack instances wired together directly.
 *
 * - Neighbor caches are pre-populated so ARP resolution is immediate.
 * - Each interface's sendFrame is overridden to deliver IPv4 packets directly
 *   into the other stack's interface inQueue (no EthernetLink / SimControl).
 */
function makePair() {
    const a = new IPStack(1, 'A');
    const b = new IPStack(1, 'B');
    a.configureInterface(0, { ip: IP_A, prefixLength: 24 });
    b.configureInterface(0, { ip: IP_B, prefixLength: 24 });

    const itfA = a.interfaces[0];
    const itfB = b.interfaces[0];

    // Pre-populate so _resolveArp returns immediately (still async, but no sleep)
    itfA.neighborCache.set(IP_B, itfB.mac.slice());
    itfB.neighborCache.set(IP_A, itfA.mac.slice());

    // Direct wire: A → B
    itfA.sendFrame = (_dstMac, etherType, payload) => {
        if (etherType !== 0x0800) return;
        try {
            itfB.inQueue.push(IPv4Packet.fromBytes(payload));
            itfB.doUpdate();
        } catch { /* swallow parse errors in tests */ }
    };

    // Direct wire: B → A
    itfB.sendFrame = (_dstMac, etherType, payload) => {
        if (etherType !== 0x0800) return;
        try {
            itfA.inQueue.push(IPv4Packet.fromBytes(payload));
            itfA.doUpdate();
        } catch { /* swallow parse errors in tests */ }
    };

    return { a, b };
}

/**
 * Build fragments covering `data` with the given identification.
 * @param {Uint8Array} data
 * @param {number} id
 * @returns {IPv4Packet[]}
 */
function buildFragments(data, id) {
    const frags = [];
    let offset = 0;
    while (offset < data.length) {
        const chunk = data.slice(offset, offset + MAX_FRAG_PAYLOAD);
        const isLast = offset + MAX_FRAG_PAYLOAD >= data.length;
        frags.push(new IPv4Packet({
            src: IPAddress.fromString(IP_A),
            dst: IPAddress.fromString(IP_B),
            protocol: 1,
            identification: id,
            flags: isLast ? 0x00 : 0x01, // MF=1 on all but last
            fragmentOffset: Math.floor(offset / 8),
            payload: chunk,
        }));
        offset += MAX_FRAG_PAYLOAD;
    }
    return frags;
}

// ─── _sendFragments (unit) ────────────────────────────────────────────────────

describe('_sendFragments', () => {
    it('produces the correct number of fragments for a 10007-byte ICMP payload', () => {
        const stack = new IPStack(1, 'host');
        const ICMP_LEN = 9999 + 8; // ping -s 9999 produces 10007 ICMP bytes
        const packet = new IPv4Packet({
            dst: IPAddress.fromString(IP_B),
            src: IPAddress.fromString(IP_A),
            protocol: 1,
            payload: new Uint8Array(ICMP_LEN),
            identification: 0xABCD,
        });
        packet.pack(); // ensure ihl is set

        /** @type {IPv4Packet[]} */
        const sent = [];
        stack._sendFragments(packet, { sendFrame: (_m, _e, b) => sent.push(IPv4Packet.fromBytes(b)) }, new Uint8Array(6), MTU);

        expect(sent.length).toBe(7); // ceil(10007 / 1480) = 7
    });

    it('sets MF=1 on all fragments except the last', () => {
        const stack = new IPStack(1, 'host');
        const packet = new IPv4Packet({
            dst: IPAddress.fromString(IP_B),
            src: IPAddress.fromString(IP_A),
            protocol: 1,
            payload: new Uint8Array(9999 + 8),
            identification: 0xABCD,
        });
        packet.pack();

        /** @type {IPv4Packet[]} */
        const sent = [];
        stack._sendFragments(packet, { sendFrame: (_m, _e, b) => sent.push(IPv4Packet.fromBytes(b)) }, new Uint8Array(6), MTU);

        for (let i = 0; i < sent.length - 1; i++) {
            expect(sent[i].flags & 0x01).toBe(1); // MF set
        }
        expect(sent[sent.length - 1].flags & 0x01).toBe(0); // MF clear on last
    });

    it('assigns correct fragmentOffset (in 8-byte units) to each fragment', () => {
        const stack = new IPStack(1, 'host');
        const packet = new IPv4Packet({
            dst: IPAddress.fromString(IP_B),
            src: IPAddress.fromString(IP_A),
            protocol: 1,
            payload: new Uint8Array(9999 + 8),
            identification: 0xABCD,
        });
        packet.pack();

        /** @type {IPv4Packet[]} */
        const sent = [];
        stack._sendFragments(packet, { sendFrame: (_m, _e, b) => sent.push(IPv4Packet.fromBytes(b)) }, new Uint8Array(6), MTU);

        for (let i = 0; i < sent.length; i++) {
            expect(sent[i].fragmentOffset).toBe(Math.floor(i * MAX_FRAG_PAYLOAD / 8));
        }
    });

    it('all fragments carry the same identification', () => {
        const stack = new IPStack(1, 'host');
        const packet = new IPv4Packet({
            dst: IPAddress.fromString(IP_B),
            src: IPAddress.fromString(IP_A),
            protocol: 1,
            payload: new Uint8Array(3000),
            identification: 0x1234,
        });
        packet.pack();

        /** @type {IPv4Packet[]} */
        const sent = [];
        stack._sendFragments(packet, { sendFrame: (_m, _e, b) => sent.push(IPv4Packet.fromBytes(b)) }, new Uint8Array(6), MTU);

        for (const f of sent) {
            expect(f.identification).toBe(0x1234);
        }
    });

    it('total payload bytes across all fragments equals the original payload length', () => {
        const stack = new IPStack(1, 'host');
        const ICMP_LEN = 9999 + 8;
        const packet = new IPv4Packet({
            dst: IPAddress.fromString(IP_B),
            src: IPAddress.fromString(IP_A),
            protocol: 1,
            payload: new Uint8Array(ICMP_LEN),
            identification: 0xABCD,
        });
        packet.pack();

        /** @type {IPv4Packet[]} */
        const sent = [];
        stack._sendFragments(packet, { sendFrame: (_m, _e, b) => sent.push(IPv4Packet.fromBytes(b)) }, new Uint8Array(6), MTU);

        const totalBytes = sent.reduce((sum, f) => sum + f.payload.length, 0);
        expect(totalBytes).toBe(ICMP_LEN);
    });
});

// ─── _handleFragment (unit) ──────────────────────────────────────────────────

describe('_handleFragment', () => {
    it('returns null when only the first-of-many fragments has arrived', () => {
        const stack = new IPStack(1, 'host');
        const frag1 = new IPv4Packet({
            src: IPAddress.fromString(IP_A), dst: IPAddress.fromString(IP_B),
            protocol: 1, identification: 0x0001,
            flags: 0x01, fragmentOffset: 0,
            payload: new Uint8Array(MAX_FRAG_PAYLOAD),
        });
        expect(stack._handleFragment(frag1)).toBeNull();
    });

    it('returns null when last fragment arrives before an earlier one (gap)', () => {
        const stack = new IPStack(1, 'host');
        // Deliver last fragment first; totalLength is known but there is a gap at [0..1479]
        const frag2 = new IPv4Packet({
            src: IPAddress.fromString(IP_A), dst: IPAddress.fromString(IP_B),
            protocol: 1, identification: 0x0002,
            flags: 0x00, fragmentOffset: 185, // offset = 185 * 8 = 1480
            payload: new Uint8Array(520),
        });
        expect(stack._handleFragment(frag2)).toBeNull();
    });

    it('reassembles two fragments in order into the original payload', () => {
        const stack = new IPStack(1, 'host');
        const data = new Uint8Array(2000);
        for (let i = 0; i < data.length; i++) data[i] = i & 0xff;

        const [frag1, frag2] = buildFragments(data, 0x0003);

        expect(stack._handleFragment(frag1)).toBeNull();
        const result = stack._handleFragment(frag2);

        expect(result).not.toBeNull();
        expect(result?.payload.length).toBe(2000);
        expect(result?.payload).toEqual(data);
    });

    it('reassembles two fragments that arrive out of order', () => {
        const stack = new IPStack(1, 'host');
        const data = new Uint8Array(2000);
        const [frag1, frag2] = buildFragments(data, 0x0004);

        // frag2 (last) arrives first
        expect(stack._handleFragment(frag2)).toBeNull();
        const result = stack._handleFragment(frag1);

        expect(result).not.toBeNull();
        expect(result?.payload.length).toBe(2000);
    });

    it('reassembles 7 fragments covering 10007 bytes (ping -s 9999 scenario)', () => {
        const stack = new IPStack(1, 'host');
        const ICMP_LEN = 9999 + 8; // 10007
        const data = new Uint8Array(ICMP_LEN);
        for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff;

        const frags = buildFragments(data, 0x0005);
        expect(frags.length).toBe(7);

        for (let i = 0; i < 6; i++) {
            expect(stack._handleFragment(frags[i])).toBeNull();
        }

        const result = stack._handleFragment(frags[6]);
        expect(result).not.toBeNull();
        expect(result?.payload.length).toBe(ICMP_LEN);
        expect(result?.payload).toEqual(data);
    });

    it('does not mix up fragments from two concurrent datagrams', () => {
        const stack = new IPStack(1, 'host');
        const dataX = new Uint8Array(2000).fill(0xAA);
        const dataY = new Uint8Array(2000).fill(0xBB);

        const [x1, x2] = buildFragments(dataX, 0x0006);
        const [y1, y2] = buildFragments(dataY, 0x0007);

        // Interleave: x1, y1, x2, y2
        expect(stack._handleFragment(x1)).toBeNull();
        expect(stack._handleFragment(y1)).toBeNull();

        const rx = stack._handleFragment(x2);
        expect(rx?.payload).toEqual(dataX);

        const ry = stack._handleFragment(y2);
        expect(ry?.payload).toEqual(dataY);
    });
});

// ─── Targeted: B must not reply to a lone first fragment ─────────────────────

describe('ICMP echo reply gating', () => {
    it('B sends NO reply when it receives only the first fragment of an echo request', async () => {
        const { b } = makePair();
        const itfB = b.interfaces[0];

        const repliesSent = [];
        // Capture replies by intercepting itfB.sendFrame BEFORE makePair wires it
        // makePair already replaced sendFrame; wrap it to spy
        const wiredSend = itfB.sendFrame.bind(itfB);
        itfB.sendFrame = (dstMac, etherType, payload) => {
            if (etherType === 0x0800) {
                try { repliesSent.push(IPv4Packet.fromBytes(payload)); } catch {}
            }
            wiredSend(dstMac, etherType, payload);
        };

        // Build frag 1 of a 9999-byte echo request (MF=1, offset=0, 1480 ICMP bytes)
        const icmpFrag1 = new Uint8Array(1480); // raw ICMP bytes (type 8 at index 0)
        icmpFrag1[0] = 8; // type: echo request
        icmpFrag1[4] = 0; icmpFrag1[5] = 1; // identifier = 1
        icmpFrag1[6] = 0; icmpFrag1[7] = 1; // sequence = 1

        const frag1 = new IPv4Packet({
            src: IPAddress.fromString(IP_A),
            dst: IPAddress.fromString(IP_B),
            protocol: 1,
            identification: 0x1234,
            flags: 0x01,       // MF = 1 (more fragments)
            fragmentOffset: 0,
            payload: icmpFrag1,
        });

        // Inject directly into B's IP stack
        itfB.inQueue.push(frag1);
        itfB.doUpdate();
        await flush(10);

        // B must NOT send any ICMP reply — the request is incomplete (only 1 of 7 frags arrived)
        const icmpReplies = repliesSent.filter(p => p.protocol === 1);
        expect(icmpReplies.length).toBe(0);
    });
});

// ─── Full ICMP ping integration ───────────────────────────────────────────────

describe('ICMP ping integration (direct-wire)', () => {
    it('normal ping (56-byte payload) resolves with bytes = 64', async () => {
        const { a } = makePair();
        const payload = new Uint8Array(56);

        const pingPromise = a.icmpEcho(IPAddress.fromString(IP_B), {
            timeoutMs: 2000, identifier: 1, sequence: 1, payload,
        });

        // resolveNeighbor is cache-hit but still async: a few microtask flushes suffice
        await flush(20);

        const result = await pingPromise;
        // packet.payload = ICMP echo reply bytes = 8 (hdr) + 56 (data) = 64
        expect(result.bytes).toBe(56 + 8);
    });

    it('oversized ping (9999-byte payload) resolves with bytes = 10007 after fragmentation + reassembly', async () => {
        const { a } = makePair();
        const PAYLOAD_SIZE = 9999;
        const payload = new Uint8Array(PAYLOAD_SIZE);

        const pingPromise = a.icmpEcho(IPAddress.fromString(IP_B), {
            timeoutMs: 2000, identifier: 1, sequence: 1, payload,
        });

        // Two async hops (send frags + receive reply frags) + a few extra
        await flush(20);

        const result = await pingPromise;
        // Full ICMP echo reply: 8-byte ICMP header + 9999 bytes of data = 10007
        expect(result.bytes).toBe(PAYLOAD_SIZE + 8);
    });

    it('medium oversized ping (1500-byte payload) resolves with bytes = 1508', async () => {
        const { a } = makePair();
        const PAYLOAD_SIZE = 1500; // 1500+8+20 = 1528 bytes total → needs 2 fragments
        const payload = new Uint8Array(PAYLOAD_SIZE);

        const pingPromise = a.icmpEcho(IPAddress.fromString(IP_B), {
            timeoutMs: 2000, identifier: 1, sequence: 1, payload,
        });

        await flush(20);

        const result = await pingPromise;
        expect(result.bytes).toBe(PAYLOAD_SIZE + 8);
    });

    it('ping with DF flag on oversized packet times out', async () => {
        const { a } = makePair();
        const payload = new Uint8Array(9999);

        const outcome = a.icmpEcho(IPAddress.fromString(IP_B), {
            timeoutMs: 100, // 20 simulated ticks
            identifier: 1, sequence: 1, payload,
            flags: 0x02, // DF bit
        }).then(() => 'resolved').catch(e => e.message);

        // Process initial microtasks (DF packet dropped, no reply sent)
        await flush(10);

        // Advance timer past the 20-tick timeout
        for (let i = 0; i < 25; i++) {
            simTimer.tick();
            await Promise.resolve();
        }

        expect(await outcome).toBe('timeout');
    });
});
