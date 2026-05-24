import { describe, it, expect } from 'vitest';
import { RIPDaemon } from '../../src/net/RIPDaemon.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { simTimer } from '../../src/lib/SimTimer.js';
import {
    RIPPacket, RIPEntry,
    RIP_CMD_RESPONSE, RIP_CMD_REQUEST,
    RIP_AFI_IP, RIP_INFINITY, RIP_PORT,
} from '../../src/net/pdu/RIPPacket.js';
import {
    RIPngPacket, RIPngEntry,
    RIPNG_CMD_RESPONSE, RIPNG_INFINITY,
} from '../../src/net/pdu/RIPngPacket.js';

// ── Mock Stack ─────────────────────────────────────────────────────────────────

/** @param {{ ip: string, prefix: number, name?: string }[]} ifaces */
function makeStack(ifaces = []) {
    const routes = [];
    const sent   = [];

    const stack = {
        interfaces: ifaces.map(({ ip, prefix, name }, i) => ({
            ip:          IPAddress.fromString(ip),
            prefixLength: prefix,
            name:        name ?? `eth${i}`,
            port:        { linkref: {} },
        })),
        _routes: routes,
        _sent:   sent,

        openUDPSocket:  () => RIP_PORT,
        closeUDPSocket: () => {},
        sendUDPSocket(_port, dst, dstPort, payload) {
            sent.push({ dst: dst.toString(), dstPort, payload: new Uint8Array(payload) });
        },
        recvUDPSocket: () => new Promise(() => {}),

        addRoute(dst, prefix, _ifIndex, nexthop, source) {
            routes.push({ dst: dst.toString(), prefix, nexthop: nexthop.toString(), source });
        },
        delRoute(dst, prefix) {
            const idx = routes.findIndex(r => r.dst === dst.toString() && r.prefix === prefix);
            if (idx >= 0) routes.splice(idx, 1);
        },
    };
    return stack;
}

function tick(n) { for (let i = 0; i < n; i++) simTimer.tick(); }

// Build a RIPv2 response message object suitable for passing to _handleMsg
function ripMsg(srcIp, entries) {
    return {
        src:     IPAddress.fromString(srcIp),
        srcPort: RIP_PORT,
        payload: new RIPPacket({ command: RIP_CMD_RESPONSE, entries }).pack(),
    };
}

// Build a RIPEntry for an IPv4 prefix
function ripEntry(ip4, mask4, metric) {
    return new RIPEntry({
        ip:      new Uint8Array(ip4),
        mask:    new Uint8Array(mask4),
        nexthop: new Uint8Array(4),
        metric,
    });
}

// ── RIPPacket – pack / fromBytes ──────────────────────────────────────────────

describe('RIPPacket – pack / fromBytes', () => {
    it('round-trips a single entry', () => {
        const entry  = ripEntry([10, 0, 0, 0], [255, 255, 255, 0], 3);
        const parsed = RIPPacket.fromBytes(new RIPPacket({ command: RIP_CMD_RESPONSE, entries: [entry] }).pack());
        expect(parsed.command).toBe(RIP_CMD_RESPONSE);
        expect(parsed.entries).toHaveLength(1);
        expect(parsed.entries[0].metric).toBe(3);
        expect(Array.from(parsed.entries[0].ip)).toEqual([10, 0, 0, 0]);
    });

    it('round-trips multiple entries preserving order', () => {
        const entries = [1, 2, 3].map(m => ripEntry([192, 168, m, 0], [255, 255, 255, 0], m));
        const parsed  = RIPPacket.fromBytes(new RIPPacket({ command: RIP_CMD_RESPONSE, entries }).pack());
        expect(parsed.entries).toHaveLength(3);
        expect(parsed.entries[2].metric).toBe(3);
    });

    it('throws on data shorter than 4 bytes', () => {
        expect(() => RIPPacket.fromBytes(new Uint8Array(3))).toThrow();
    });

    it('throws on wrong version', () => {
        const buf = new Uint8Array(24);
        buf[0] = RIP_CMD_RESPONSE;
        buf[1] = 1; // version 1 ≠ RIPv2
        expect(() => RIPPacket.fromBytes(buf)).toThrow(/version/i);
    });

    it('preserves AFI and tag fields', () => {
        const entry  = new RIPEntry({ afi: 2, tag: 0x1234, ip: new Uint8Array(4), mask: new Uint8Array(4), nexthop: new Uint8Array(4), metric: 1 });
        const parsed = RIPPacket.fromBytes(new RIPPacket({ command: RIP_CMD_RESPONSE, entries: [entry] }).pack());
        expect(parsed.entries[0].afi).toBe(2);
        expect(parsed.entries[0].tag).toBe(0x1234);
    });

    it('handles a packet with no entries (header only)', () => {
        const parsed = RIPPacket.fromBytes(new RIPPacket({ command: RIP_CMD_RESPONSE, entries: [] }).pack());
        expect(parsed.entries).toHaveLength(0);
    });
});

// ── RIPngPacket – pack / fromBytes ────────────────────────────────────────────

describe('RIPngPacket – pack / fromBytes', () => {
    it('round-trips a single entry', () => {
        const prefix = new Uint8Array(16);
        prefix[0] = 0x20; prefix[1] = 0x01; // 2001::
        const entry  = new RIPngEntry({ prefix, prefixLen: 64, metric: 2 });
        const parsed = RIPngPacket.fromBytes(new RIPngPacket({ command: RIPNG_CMD_RESPONSE, entries: [entry] }).pack());
        expect(parsed.command).toBe(RIPNG_CMD_RESPONSE);
        expect(parsed.entries[0].prefixLen).toBe(64);
        expect(parsed.entries[0].metric).toBe(2);
        expect(parsed.entries[0].prefix[0]).toBe(0x20);
    });

    it('throws on data shorter than 4 bytes', () => {
        expect(() => RIPngPacket.fromBytes(new Uint8Array(2))).toThrow();
    });

    it('isNexthop is true for metric 0xFF', () => {
        const e = new RIPngEntry({ prefix: new Uint8Array(16), prefixLen: 0, metric: 0xFF });
        expect(e.isNexthop).toBe(true);
    });

    it('isNexthop is false for normal metrics', () => {
        expect(new RIPngEntry({ prefix: new Uint8Array(16), prefixLen: 32, metric: 3 }).isNexthop).toBe(false);
        expect(new RIPngEntry({ prefix: new Uint8Array(16), prefixLen: 32, metric: RIPNG_INFINITY }).isNexthop).toBe(false);
    });

    it('preserves tag field', () => {
        const prefix = new Uint8Array(16);
        const entry  = new RIPngEntry({ prefix, tag: 0xABCD, prefixLen: 48, metric: 5 });
        const parsed = RIPngPacket.fromBytes(new RIPngPacket({ command: RIPNG_CMD_RESPONSE, entries: [entry] }).pack());
        expect(parsed.entries[0].tag).toBe(0xABCD);
    });
});

// ── RIPDaemon – lifecycle ─────────────────────────────────────────────────────

describe('RIPDaemon – lifecycle', () => {
    it('starts and marks _running', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        expect(daemon._running).toBe(true);
        daemon.stop();
    });

    it('stop clears _running and removes all learned routes from the stack', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        daemon._learnRoute('172.16.0.0/16', IPAddress.fromString('172.16.0.0'), 16, IPAddress.fromString('10.0.0.2'), 2, 0);
        expect(stack._routes).toHaveLength(1);
        daemon.stop();
        expect(daemon._running).toBe(false);
        expect(stack._routes).toHaveLength(0);
    });

    it('setEnabled(true) starts, setEnabled(false) stops', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.setEnabled(true);
        expect(daemon._running).toBe(true);
        daemon.setEnabled(false);
        expect(daemon._running).toBe(false);
    });

    it('start is idempotent', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        const port1 = daemon._socketPort;
        daemon.start();
        expect(daemon._socketPort).toBe(port1);
        daemon.stop();
    });

    it('uses address family name "RIPng" for af=6', () => {
        const stack  = makeStack([]);
        const daemon = new RIPDaemon(stack, 6);
        expect(daemon._name).toBe('RIPng');
    });
});

// ── RIPDaemon – protocol helpers ──────────────────────────────────────────────

describe('RIPDaemon – _directedBcast', () => {
    const daemon = new RIPDaemon(makeStack([]));

    it('/24 → .255 broadcast', () => {
        expect(daemon._directedBcast(IPAddress.fromString('10.0.0.1'), 24).toString()).toBe('10.0.0.255');
    });

    it('/16 → .255.255 broadcast', () => {
        expect(daemon._directedBcast(IPAddress.fromString('172.16.5.3'), 16).toString()).toBe('172.16.255.255');
    });

    it('/30 → .7 broadcast', () => {
        expect(daemon._directedBcast(IPAddress.fromString('192.168.1.4'), 30).toString()).toBe('192.168.1.7');
    });

    it('/8 → .255.255.255 broadcast', () => {
        expect(daemon._directedBcast(IPAddress.fromString('10.5.6.7'), 8).toString()).toBe('10.255.255.255');
    });
});

describe('RIPDaemon – _ifIndexForSrc4', () => {
    it('returns the index of the matching interface subnet', () => {
        const stack  = makeStack([
            { ip: '10.0.0.1',   prefix: 24 },
            { ip: '192.168.1.1', prefix: 24 },
        ]);
        const daemon = new RIPDaemon(stack);
        expect(daemon._ifIndexForSrc4(IPAddress.fromString('10.0.0.5'))).toBe(0);
        expect(daemon._ifIndexForSrc4(IPAddress.fromString('192.168.1.99'))).toBe(1);
    });

    it('returns -1 for an address on no known subnet', () => {
        const daemon = new RIPDaemon(makeStack([{ ip: '10.0.0.1', prefix: 24 }]));
        expect(daemon._ifIndexForSrc4(IPAddress.fromString('172.16.0.1'))).toBe(-1);
    });
});

describe('RIPDaemon – _isConnected4', () => {
    it('returns true for the interface own subnet', () => {
        const daemon = new RIPDaemon(makeStack([{ ip: '10.1.2.3', prefix: 24 }]));
        const net32  = (10 << 24 | 1 << 16 | 2 << 8 | 0) >>> 0;
        expect(daemon._isConnected4(net32, 24)).toBe(true);
    });

    it('returns false for a prefix not matching any interface', () => {
        const daemon = new RIPDaemon(makeStack([{ ip: '10.1.2.3', prefix: 24 }]));
        const net32  = (192 << 24 | 168 << 16 | 1 << 8 | 0) >>> 0;
        expect(daemon._isConnected4(net32, 24)).toBe(false);
    });

    it('returns false when prefix length mismatches even if address matches', () => {
        const daemon = new RIPDaemon(makeStack([{ ip: '10.0.0.1', prefix: 24 }]));
        const net32  = (10 << 24) >>> 0; // 10.0.0.0
        expect(daemon._isConnected4(net32, 8)).toBe(false); // interface is /24
    });
});

// ── RIPDaemon – route learning via _handleMsg ─────────────────────────────────

describe('RIPDaemon – _handleMsg (RIPv2)', () => {
    it('learns a new route and installs it in the routing stack', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        daemon._handleMsg(ripMsg('10.0.0.2', [ripEntry([192, 168, 0, 0], [255, 255, 255, 0], 2)]));
        // received metric 2, stored as 2+1=3
        expect(daemon._routes.has('192.168.0.0/24')).toBe(true);
        expect(daemon._routes.get('192.168.0.0/24').metric).toBe(3);
        expect(stack._routes.some(r => r.dst === '192.168.0.0')).toBe(true);
        daemon.stop();
    });

    it('increments metric by 1 on receipt', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        daemon._handleMsg(ripMsg('10.0.0.2', [ripEntry([1, 2, 3, 0], [255, 255, 255, 0], 7)]));
        expect(daemon._routes.get('1.2.3.0/24').metric).toBe(8);
        daemon.stop();
    });

    it('ignores entries with metric >= RIP_INFINITY (16)', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        daemon._handleMsg(ripMsg('10.0.0.2', [ripEntry([172, 16, 0, 0], [255, 255, 0, 0], RIP_INFINITY)]));
        expect(daemon._routes.size).toBe(0);
        daemon.stop();
    });

    it('ignores advertisements of own connected prefixes', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        // 10.0.0.0/24 is our own subnet — must not be learned
        daemon._handleMsg(ripMsg('10.0.0.2', [ripEntry([10, 0, 0, 0], [255, 255, 255, 0], 1)]));
        expect(daemon._routes.has('10.0.0.0/24')).toBe(false);
        daemon.stop();
    });

    it('ignores non-RESPONSE commands', () => {
        const stack   = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon  = new RIPDaemon(stack);
        daemon.start();
        const payload = new RIPPacket({ command: RIP_CMD_REQUEST, entries: [ripEntry([1, 2, 3, 0], [255, 255, 255, 0], 1)] }).pack();
        daemon._handleMsg({ src: IPAddress.fromString('10.0.0.2'), srcPort: RIP_PORT, payload });
        expect(daemon._routes.size).toBe(0);
        daemon.stop();
    });

    it('updates to a better metric when re-advertised', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        daemon._handleMsg(ripMsg('10.0.0.2', [ripEntry([192, 168, 0, 0], [255, 255, 255, 0], 5)]));
        expect(daemon._routes.get('192.168.0.0/24').metric).toBe(6);
        daemon._handleMsg(ripMsg('10.0.0.2', [ripEntry([192, 168, 0, 0], [255, 255, 255, 0], 2)]));
        expect(daemon._routes.get('192.168.0.0/24').metric).toBe(3);
        daemon.stop();
    });

    it('ignores a source IP not on any known subnet', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        // 172.16.0.2 is not on the 10.0.0.0/24 subnet
        daemon._handleMsg(ripMsg('172.16.0.2', [ripEntry([192, 168, 0, 0], [255, 255, 255, 0], 1)]));
        expect(daemon._routes.size).toBe(0);
        daemon.stop();
    });

    it('ignores entries with AFI ≠ RIP_AFI_IP (2)', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        const entry = new RIPEntry({ afi: 99, tag: 0, ip: new Uint8Array([1, 2, 3, 0]), mask: new Uint8Array([255, 255, 255, 0]), nexthop: new Uint8Array(4), metric: 1 });
        daemon._handleMsg({ src: IPAddress.fromString('10.0.0.2'), srcPort: RIP_PORT, payload: new RIPPacket({ command: RIP_CMD_RESPONSE, entries: [entry] }).pack() });
        expect(daemon._routes.size).toBe(0);
        daemon.stop();
    });
});

// ── RIPDaemon – _expireRoute ──────────────────────────────────────────────────

describe('RIPDaemon – _expireRoute', () => {
    it('marks route with infinity metric and removes it from routing stack', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        daemon._learnRoute('172.16.0.0/16', IPAddress.fromString('172.16.0.0'), 16, IPAddress.fromString('10.0.0.2'), 3, 0);
        expect(stack._routes.some(r => r.dst === '172.16.0.0')).toBe(true);
        daemon._expireRoute('172.16.0.0/16');
        expect(daemon._routes.get('172.16.0.0/16')?.metric).toBe(RIP_INFINITY);
        expect(stack._routes.some(r => r.dst === '172.16.0.0')).toBe(false);
        daemon.stop();
    });

    it('is a no-op for an already-expired route', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        daemon._learnRoute('172.16.0.0/16', IPAddress.fromString('172.16.0.0'), 16, IPAddress.fromString('10.0.0.2'), 3, 0);
        daemon._expireRoute('172.16.0.0/16');
        expect(() => daemon._expireRoute('172.16.0.0/16')).not.toThrow();
        daemon.stop();
    });

    it('deletes entry from _routes after DELETE_MS (40 ticks)', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        daemon._learnRoute('172.16.0.0/16', IPAddress.fromString('172.16.0.0'), 16, IPAddress.fromString('10.0.0.2'), 3, 0);
        daemon._expireRoute('172.16.0.0/16');
        expect(daemon._routes.has('172.16.0.0/16')).toBe(true); // still present (deletion pending)
        tick(20_000 / 5 + 1); // DELETE_MS = 20_000 ms, tick = 5 ms
        expect(daemon._routes.has('172.16.0.0/16')).toBe(false);
        daemon.stop();
    });
});

// ── RIPDaemon – _buildEntries (split-horizon) ─────────────────────────────────

describe('RIPDaemon – _buildEntries split-horizon', () => {
    it('excludes a route learned on the outgoing interface', () => {
        const stack  = makeStack([
            { ip: '10.0.0.1',    prefix: 24 },
            { ip: '192.168.1.1', prefix: 24 },
        ]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        // Route learned on ifIndex 0 — must not appear in entries for ifIndex 0
        daemon._learnRoute('172.16.0.0/16', IPAddress.fromString('172.16.0.0'), 16, IPAddress.fromString('10.0.0.2'), 3, 0);
        const entries = daemon._buildEntries(0);
        const has172  = entries.some(e => e.ip?.[0] === 172 && e.ip?.[1] === 16);
        expect(has172).toBe(false);
        daemon.stop();
    });

    it('includes a route learned on a different interface', () => {
        const stack  = makeStack([
            { ip: '10.0.0.1',    prefix: 24 },
            { ip: '192.168.1.1', prefix: 24 },
        ]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        // Route learned on ifIndex 1 — must appear in entries for ifIndex 0
        daemon._learnRoute('172.16.0.0/16', IPAddress.fromString('172.16.0.0'), 16, IPAddress.fromString('192.168.1.2'), 3, 1);
        const entries = daemon._buildEntries(0);
        const has172  = entries.some(e => e.ip?.[0] === 172 && e.ip?.[1] === 16);
        expect(has172).toBe(true);
        daemon.stop();
    });

    it('includes connected networks from other interfaces', () => {
        const stack  = makeStack([
            { ip: '10.0.0.1',    prefix: 24 },
            { ip: '192.168.1.1', prefix: 24 },
        ]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        // Entries for ifIndex 0 should advertise the 192.168.1.0/24 connected network
        const entries    = daemon._buildEntries(0);
        const has192     = entries.some(e => e.ip?.[0] === 192 && e.ip?.[1] === 168);
        expect(has192).toBe(true);
        daemon.stop();
    });

    it('does not include the outgoing interface own connected network', () => {
        const stack  = makeStack([
            { ip: '10.0.0.1',    prefix: 24 },
            { ip: '192.168.1.1', prefix: 24 },
        ]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        // Entries for ifIndex 0 must not include 10.0.0.0/24 (its own subnet)
        const entries = daemon._buildEntries(0);
        const has10   = entries.some(e => e.ip?.[0] === 10);
        expect(has10).toBe(false);
        daemon.stop();
    });

    it('excludes expired (infinity) routes', () => {
        const stack  = makeStack([
            { ip: '10.0.0.1',    prefix: 24 },
            { ip: '192.168.1.1', prefix: 24 },
        ]);
        const daemon = new RIPDaemon(stack);
        daemon.start();
        daemon._learnRoute('172.16.0.0/16', IPAddress.fromString('172.16.0.0'), 16, IPAddress.fromString('192.168.1.2'), 3, 1);
        daemon._expireRoute('172.16.0.0/16'); // metric → 16
        const entries = daemon._buildEntries(0);
        const has172  = entries.some(e => e.ip?.[0] === 172);
        expect(has172).toBe(false);
        daemon.stop();
    });
});

// ── RIPDaemon – passive interface ─────────────────────────────────────────────

describe('RIPDaemon – passive interface', () => {
    it('setPassive(true) adds to passiveInterfaces', () => {
        const daemon = new RIPDaemon(makeStack([]));
        daemon.setPassive('eth0', true);
        expect(daemon.passiveInterfaces.has('eth0')).toBe(true);
    });

    it('setPassive(false) removes from passiveInterfaces', () => {
        const daemon = new RIPDaemon(makeStack([]));
        daemon.setPassive('eth0', true);
        daemon.setPassive('eth0', false);
        expect(daemon.passiveInterfaces.has('eth0')).toBe(false);
    });
});

// ── RIPDaemon – persistence ───────────────────────────────────────────────────

describe('RIPDaemon – persistence', () => {
    it('toJSON / applyJSON round-trips passiveInterfaces', () => {
        const d1 = new RIPDaemon(makeStack([{ ip: '10.0.0.1', prefix: 24 }]));
        d1.setPassive('eth0', true);
        const json = d1.toJSON();

        const d2 = new RIPDaemon(makeStack([{ ip: '10.0.0.1', prefix: 24 }]));
        d2.applyJSON({ ...json, enabled: false });
        expect(d2.passiveInterfaces.has('eth0')).toBe(true);
        d1.stop();
        d2.stop();
    });

    it('applyJSON starts daemon when enabled is true', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new RIPDaemon(stack);
        daemon.applyJSON({ enabled: true, passive: [] });
        expect(daemon._running).toBe(true);
        daemon.stop();
    });

    it('applyJSON does not start when enabled is false', () => {
        const daemon = new RIPDaemon(makeStack([]));
        daemon.applyJSON({ enabled: false, passive: [] });
        expect(daemon._running).toBe(false);
    });

    it('toJSON preserves enabled flag', () => {
        const daemon = new RIPDaemon(makeStack([]));
        daemon.enabled = true;
        expect(daemon.toJSON().enabled).toBe(true);
    });
});
