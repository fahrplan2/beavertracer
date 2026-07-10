//@ts-check
import { describe, it, expect } from 'vitest';
// Importing SimControl.js before any sim/*.js class breaks a circular-import
// cycle (SimulatedObject.js <-> SimControl.js <-> Link.js) that otherwise throws
// "Class extends value undefined" when a sim/*.js module is the graph entry point.
import '../../src/SimControl.js';
import { Firewall, STATE_IDLE_TIMEOUT_MS } from '../../src/sim/Firewall.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { IPv6Packet } from '../../src/net/pdu/IPv6Packet.js';
import { TCPPacket } from '../../src/net/pdu/TCPPacket.js';
import { UDPPacket } from '../../src/net/pdu/UDPPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { simTimer, SimTimer } from '../../src/lib/SimTimer.js';

// SimulatedObject's constructor creates a `<div>` via document.createElement.
// This suite runs in the 'node' test environment (no real DOM), and Firewall's
// packet-processing logic never touches the DOM, so a minimal stub is enough.
globalThis.document = /** @type {any} */ ({
    createElement: () => ({
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild() {},
        remove() {},
        style: {},
    }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const SENTINEL = {};
const MAC_A = new Uint8Array([0, 1, 2, 3, 4, 0xaa]);
const MAC_B = new Uint8Array([0, 1, 2, 3, 4, 0xbb]);
const BCAST = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

const HOST_A = '10.0.0.1';
const HOST_B = '10.0.0.2';

let _ruleId = 1;
/** @param {object} [overrides] */
function rule(overrides = {}) {
    return {
        id: _ruleId++, enabled: true, direction: 'both', ipVersion: 'any',
        protocol: 'any', srcIp: '', srcPort: '', dstIp: '', dstPort: '', action: 'allow',
        ...overrides,
    };
}

/** Fakes both ports as "linked" (truthy linkref) without a real EthernetLink peer. */
function linkFw(fw) {
    fw._port0.link(/** @type {any} */ (SENTINEL));
    fw._port1.link(/** @type {any} */ (SENTINEL));
}

/**
 * @param {object} o
 * @param {number} o.protocol
 * @param {string} [o.srcIp] @param {string} [o.dstIp]
 * @param {number} [o.srcPort] @param {number} [o.dstPort]
 */
function ipv4Frame({ protocol, srcIp = HOST_A, dstIp = HOST_B, srcPort = 1234, dstPort = 80 }) {
    const src = IPAddress.fromString(srcIp);
    const dst = IPAddress.fromString(dstIp);
    let payload;
    if (protocol === 6) {
        payload = new TCPPacket({ srcPort, dstPort, seq: 1, flags: TCPPacket.FLAG_SYN }).pack({ srcIp: src, dstIp: dst });
    } else if (protocol === 17) {
        payload = new UDPPacket({ srcPort, dstPort, payload: new Uint8Array([1, 2, 3]) }).pack({ srcIp: src, dstIp: dst });
    } else {
        payload = new Uint8Array([8, 0, 0, 0]); // e.g. ICMP echo — Firewall never inspects this payload
    }
    const ip = new IPv4Packet({ src, dst, protocol, payload });
    return new EthernetFrame({ srcMac: MAC_A, dstMac: MAC_B, etherType: 0x0800, payload: ip.pack() });
}

/**
 * @param {object} o
 * @param {number} o.nextHeader
 * @param {string} [o.srcIp] @param {string} [o.dstIp]
 */
function ipv6Frame({ nextHeader, srcIp = 'fd00::1', dstIp = 'fd00::2' }) {
    const ip = new IPv6Packet({
        src: IPAddress.fromString(srcIp), dst: IPAddress.fromString(dstIp),
        nextHeader, payload: new Uint8Array([0, 0, 0, 0]),
    });
    return new EthernetFrame({ srcMac: MAC_A, dstMac: MAC_B, etherType: 0x86dd, payload: ip.pack() });
}

function arpFrame() {
    return new EthernetFrame({ srcMac: MAC_A, dstMac: BCAST, etherType: 0x0806, payload: new Uint8Array(28) });
}

/** Injects a frame into port A (index 0) and lets the firewall process it synchronously. */
function sendAtoB(fw, frame) { fw._port0.recieve(frame.pack()); }
/** Injects a frame into port B (index 1) — simulates the reply direction. */
function sendBtoA(fw, frame) { fw._port1.recieve(frame.pack()); }

/** @returns {EthernetFrame|null} */
function drain(port) {
    const raw = port.getNextOutgoingFrame();
    return raw ? EthernetFrame.fromBytes(raw) : null;
}

/** Advance the shared simTimer by the given number of simulated ms. */
function advance(simMs) {
    for (let i = 0; i < SimTimer.toTicks(simMs); i++) simTimer.tick();
}

// ── Stateless forwarding (default mode) ────────────────────────────────────────

describe('Firewall – stateless forwarding', () => {
    it('passes non-IP frames (e.g. ARP) through regardless of rules', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [rule({ action: 'deny' })]; // deny everything IP-related
        sendAtoB(fw, arpFrame());
        expect(drain(fw._port1)).not.toBeNull();
        expect(fw._stats.dropped).toBe(0);
    });

    it('falls back to the default policy when no rule matches', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [];
        fw.defaultPolicy = 'deny';
        sendAtoB(fw, ipv4Frame({ protocol: 6 }));
        expect(drain(fw._port1)).toBeNull();
        expect(fw._stats.dropped).toBe(1);

        fw.defaultPolicy = 'allow';
        sendAtoB(fw, ipv4Frame({ protocol: 6 }));
        expect(drain(fw._port1)).not.toBeNull();
        expect(fw._stats.passed).toBe(1);
    });

    it('evaluates rules in order — the first match wins', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [
            rule({ dstPort: '80', action: 'allow' }),
            rule({ dstPort: '80', action: 'deny' }), // never reached for port 80
        ];
        fw.defaultPolicy = 'deny';
        sendAtoB(fw, ipv4Frame({ protocol: 6, dstPort: 80 }));
        expect(drain(fw._port1)).not.toBeNull();
    });

    it('scopes a rule to a single direction', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [rule({ direction: 'AtoB', action: 'allow' })];
        fw.defaultPolicy = 'deny';

        sendAtoB(fw, ipv4Frame({ protocol: 17 }));
        expect(drain(fw._port1)).not.toBeNull();

        sendBtoA(fw, ipv4Frame({ protocol: 17, srcIp: HOST_B, dstIp: HOST_A }));
        expect(drain(fw._port0)).toBeNull();
        expect(fw._stats.dropped).toBe(1);
    });

    it('drops and logs packets that hit a deny rule', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [rule({ protocol: 'tcp', dstPort: '23', action: 'deny' })];
        sendAtoB(fw, ipv4Frame({ protocol: 6, dstPort: 23 }));
        expect(drain(fw._port1)).toBeNull();
        expect(fw._stats.dropped).toBe(1);
        expect(fw._fwLog.length).toBe(1);
        expect(fw._fwLog[0]).toContain('DROP');
    });

    it('matches IP version independently for IPv4 vs IPv6', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [rule({ ipVersion: 4, action: 'allow' })];
        fw.defaultPolicy = 'deny';

        sendAtoB(fw, ipv4Frame({ protocol: 17 }));
        expect(drain(fw._port1)).not.toBeNull();

        // nextHeader 58 = ICMPv6, so the dummy payload doesn't need a real transport header.
        sendAtoB(fw, ipv6Frame({ nextHeader: 58 }));
        expect(drain(fw._port1)).toBeNull();
        expect(fw._stats.dropped).toBe(1);
    });

    it('demonstrates why stateless mode needs an explicit return-path rule', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.rules = [rule({ direction: 'AtoB', protocol: 'tcp', dstPort: '80', action: 'allow' })];
        fw.defaultPolicy = 'deny';

        sendAtoB(fw, ipv4Frame({ protocol: 6, dstPort: 80 }));
        expect(drain(fw._port1)).not.toBeNull(); // request passes

        sendBtoA(fw, ipv4Frame({ protocol: 6, srcIp: HOST_B, dstIp: HOST_A, srcPort: 80, dstPort: 1234 }));
        expect(drain(fw._port0)).toBeNull(); // reply has no matching rule in stateless mode → dropped
    });
});

// ── Stateful mode ───────────────────────────────────────────────────────────────

describe('Firewall – stateful mode', () => {
    it('lets return traffic through via the state table without a matching rule', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.statefulMode = true;
        fw.rules = [rule({ direction: 'AtoB', protocol: 'tcp', dstPort: '80', action: 'allow' })];
        fw.defaultPolicy = 'deny';

        sendAtoB(fw, ipv4Frame({ protocol: 6, dstPort: 80 }));
        expect(drain(fw._port1)).not.toBeNull();
        expect(fw._stateTable.size).toBe(1);

        sendBtoA(fw, ipv4Frame({ protocol: 6, srcIp: HOST_B, dstIp: HOST_A, srcPort: 80, dstPort: 1234 }));
        expect(drain(fw._port0)).not.toBeNull(); // now passes via the state entry
        expect(fw._stats.dropped).toBe(0);
    });

    it('tracks UDP and ICMP the same way as TCP', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.statefulMode = true;
        fw.rules = [rule({ direction: 'AtoB', action: 'allow' })];
        fw.defaultPolicy = 'deny';

        sendAtoB(fw, ipv4Frame({ protocol: 17 }));
        expect(drain(fw._port1)).not.toBeNull();
        sendBtoA(fw, ipv4Frame({ protocol: 17, srcIp: HOST_B, dstIp: HOST_A, srcPort: 80, dstPort: 1234 }));
        expect(drain(fw._port0)).not.toBeNull();

        sendAtoB(fw, ipv4Frame({ protocol: 1 }));
        expect(drain(fw._port1)).not.toBeNull();
        sendBtoA(fw, ipv4Frame({ protocol: 1, srcIp: HOST_B, dstIp: HOST_A }));
        expect(drain(fw._port0)).not.toBeNull();
    });

    it('does not track protocols outside tcp/udp/icmp/icmpv6', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.statefulMode = true;
        fw.rules = [rule({ protocol: 'any', action: 'allow' })];

        sendAtoB(fw, ipv4Frame({ protocol: 47 })); // GRE
        expect(drain(fw._port1)).not.toBeNull();
        expect(fw._stateTable.size).toBe(0);
    });

    it('does not create a state entry for traffic that was denied', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.statefulMode = true;
        fw.rules = [rule({ action: 'deny' })];

        sendAtoB(fw, ipv4Frame({ protocol: 6 }));
        expect(drain(fw._port1)).toBeNull();
        expect(fw._stateTable.size).toBe(0);
    });

    it('does not consult the state table while stateful mode is off', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.statefulMode = true;
        fw.rules = [rule({ direction: 'AtoB', action: 'allow' })];
        fw.defaultPolicy = 'deny';

        sendAtoB(fw, ipv4Frame({ protocol: 6 }));
        expect(drain(fw._port1)).not.toBeNull();
        expect(fw._stateTable.size).toBe(1);

        fw.statefulMode = false; // switch to stateless mid-session
        sendBtoA(fw, ipv4Frame({ protocol: 6, srcIp: HOST_B, dstIp: HOST_A, srcPort: 80, dstPort: 1234 }));
        expect(drain(fw._port0)).toBeNull(); // no rule for BtoA, and state is no longer consulted
    });
});

// ── State expiration ────────────────────────────────────────────────────────────

describe('Firewall – state expiration', () => {
    it('expires an idle state entry after the timeout', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.statefulMode = true;
        fw.rules = [rule({ action: 'allow' })];

        sendAtoB(fw, ipv4Frame({ protocol: 6 }));
        drain(fw._port1);
        expect(fw._stateTable.size).toBe(1);

        advance(STATE_IDLE_TIMEOUT_MS + 10);
        expect(fw._stateTable.size).toBe(0);
    });

    it('refreshes the timeout on repeated activity instead of expiring early', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.statefulMode = true;
        fw.rules = [rule({ action: 'allow' })];

        sendAtoB(fw, ipv4Frame({ protocol: 6 }));
        drain(fw._port1);
        expect(fw._stateTable.size).toBe(1);

        // Advance close to (but under) the timeout, then touch the connection again.
        advance(STATE_IDLE_TIMEOUT_MS - SimTimer.SIM_MS_PER_TICK * 2);
        sendAtoB(fw, ipv4Frame({ protocol: 6 }));
        drain(fw._port1);
        expect(fw._stateTable.size).toBe(1); // still alive — refreshed by the second packet

        // Advance the same "close to timeout" window again: without the refresh this would have expired.
        advance(STATE_IDLE_TIMEOUT_MS - SimTimer.SIM_MS_PER_TICK * 2);
        expect(fw._stateTable.size).toBe(1);

        advance(STATE_IDLE_TIMEOUT_MS + 10);
        expect(fw._stateTable.size).toBe(0);
    });
});

// ── Clearing state ──────────────────────────────────────────────────────────────

describe('Firewall – _clearStateTable', () => {
    it('empties the table and cancels pending timers', () => {
        const fw = new Firewall();
        linkFw(fw);
        fw.statefulMode = true;
        fw.rules = [rule({ action: 'allow' })];

        sendAtoB(fw, ipv4Frame({ protocol: 6 }));
        drain(fw._port1);
        expect(fw._stateTable.size).toBe(1);

        fw._clearStateTable();
        expect(fw._stateTable.size).toBe(0);

        // The canceled timer must not resurrect an entry later.
        advance(STATE_IDLE_TIMEOUT_MS + 10);
        expect(fw._stateTable.size).toBe(0);
    });
});

// ── Persistence ──────────────────────────────────────────────────────────────────

describe('Firewall – persistence', () => {
    it('round-trips rules and statefulMode through toJSON/fromJSON', () => {
        const fw = new Firewall('My FW');
        fw.statefulMode = true;
        fw.defaultPolicy = 'deny';
        fw.rules = [rule({ protocol: 'tcp', dstPort: '443', action: 'allow' })];

        const json = fw.toJSON();
        expect(json.statefulMode).toBe(true);
        expect(json.defaultPolicy).toBe('deny');

        const restored = Firewall.fromJSON(json);
        expect(restored.statefulMode).toBe(true);
        expect(restored.defaultPolicy).toBe('deny');
        expect(restored.rules).toHaveLength(1);
        expect(restored.rules[0].dstPort).toBe('443');
    });

    it('defaults statefulMode to false for older saves that predate the feature', () => {
        const fw = new Firewall('Old FW');
        const json = fw.toJSON();
        // @ts-ignore simulate a save file from before statefulMode existed
        delete json.statefulMode;
        const restored = Firewall.fromJSON(json);
        expect(restored.statefulMode).toBe(false);
    });
});
