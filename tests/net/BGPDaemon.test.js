import { describe, it, expect } from 'vitest';
import { BGPDaemon } from '../../src/net/BGPDaemon.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import {
    buildOpen, buildKeepalive, buildNotification, buildUpdate,
    parseMessage, parseOpen, parseUpdate,
    BGP_MSG_OPEN, BGP_MSG_KEEPALIVE, BGP_MSG_NOTIFICATION, BGP_MSG_UPDATE,
    ERR_CEASE,
} from '../../src/net/pdu/BGPPacket.js';

// ── Mock Stack ─────────────────────────────────────────────────────────────────

/** @param {{ ip: string, prefix: number }[]} ifaces */
function makeStack(ifaces = []) {
    const routes = [];
    return {
        interfaces: ifaces.map(({ ip, prefix }) => ({
            ip: IPAddress.fromString(ip),
            prefixLength: prefix,
            port: { linkref: {} },
        })),
        _routes: routes,
        openTCPServerSocket: () => 1,
        closeTCPServerSocket: () => {},
        acceptTCPConn: () => new Promise(() => {}),
        connectTCPConn: () => new Promise(() => {}),
        sendTCPConn: () => {},
        recvTCPConn: () => new Promise(() => {}),
        closeTCPConn: () => {},
        getTCPConnInfo: () => null,
        addRoute(dst, prefix, ifIndex, nexthop, source) {
            routes.push({ dst: dst.toString(), prefix, nexthop: nexthop.toString(), source });
        },
        delRoute(dst, prefix) {
            const idx = routes.findIndex(r => r.dst === dst.toString() && r.prefix === prefix);
            if (idx >= 0) routes.splice(idx, 1);
        },
    };
}

// ── BGPPacket – parseMessage ──────────────────────────────────────────────────

describe('BGPPacket – parseMessage', () => {
    it('returns null for input shorter than 19 bytes', () => {
        expect(parseMessage(new Uint8Array(10))).toBeNull();
    });

    it('returns null when marker is not all-0xff', () => {
        const msg = buildKeepalive();
        msg[5] = 0x00;
        expect(parseMessage(msg)).toBeNull();
    });

    it('returns null when declared length does not match actual length', () => {
        const ka = buildKeepalive();
        expect(parseMessage(ka.slice(0, 18))).toBeNull();
    });
});

// ── BGPPacket – OPEN ──────────────────────────────────────────────────────────

describe('BGPPacket – OPEN', () => {
    it('buildOpen / parseOpen round-trips AS, holdTime, routerId', () => {
        const rid = IPAddress.fromString('10.0.0.1');
        const msg = buildOpen(65001, 90, rid);
        const parsed = parseMessage(msg);
        expect(parsed?.type).toBe(BGP_MSG_OPEN);
        const od = parseOpen(parsed?.body ?? new Uint8Array());
        expect(od.myAS).toBe(65001);
        expect(od.holdTime).toBe(90);
        expect(od.bgpId.toString()).toBe('10.0.0.1');
    });

    it('parseOpen throws on body shorter than 10 bytes', () => {
        expect(() => parseOpen(new Uint8Array(5))).toThrow();
    });
});

// ── BGPPacket – KEEPALIVE ─────────────────────────────────────────────────────

describe('BGPPacket – KEEPALIVE', () => {
    it('produces a valid 19-byte message of type 4 with empty body', () => {
        const msg = buildKeepalive();
        expect(msg.length).toBe(19);
        const parsed = parseMessage(msg);
        expect(parsed?.type).toBe(BGP_MSG_KEEPALIVE);
        expect(parsed?.body.length).toBe(0);
    });
});

// ── BGPPacket – NOTIFICATION ──────────────────────────────────────────────────

describe('BGPPacket – NOTIFICATION', () => {
    it('encodes code and subcode correctly', () => {
        const msg = buildNotification(ERR_CEASE, 3);
        const parsed = parseMessage(msg);
        expect(parsed?.type).toBe(BGP_MSG_NOTIFICATION);
        expect(parsed?.body[0]).toBe(ERR_CEASE);
        expect(parsed?.body[1]).toBe(3);
    });
});

// ── BGPPacket – UPDATE ────────────────────────────────────────────────────────

describe('BGPPacket – UPDATE', () => {
    it('round-trips NLRI, AS_PATH, NEXT_HOP, MED', () => {
        const msg = buildUpdate({
            withdrawn: [],
            nextHop: IPAddress.fromString('192.168.1.1'),
            asPath: [65001, 65002],
            localPref: 100,
            med: 50,
            nlri: [
                { dst: IPAddress.fromString('10.0.0.0'),   prefLen: 8  },
                { dst: IPAddress.fromString('172.16.0.0'), prefLen: 12 },
            ],
        });
        const parsed = parseMessage(msg);
        expect(parsed?.type).toBe(BGP_MSG_UPDATE);
        const u = parseUpdate(parsed?.body ?? new Uint8Array());
        expect(u.nlri).toHaveLength(2);
        expect(u.nlri[0].dst.toString()).toBe('10.0.0.0');
        expect(u.nlri[0].prefLen).toBe(8);
        expect(u.nlri[1].dst.toString()).toBe('172.16.0.0');
        expect(u.nlri[1].prefLen).toBe(12);
        expect(u.attrs.asPath).toEqual([65001, 65002]);
        expect(u.attrs.nextHop?.toString()).toBe('192.168.1.1');
        expect(u.attrs.med).toBe(50);
    });

    it('round-trips withdrawn prefixes with no NLRI', () => {
        const msg = buildUpdate({
            withdrawn: [{ dst: IPAddress.fromString('10.1.0.0'), prefLen: 16 }],
            nextHop: IPAddress.fromString('0.0.0.0'),
            asPath: [],
            localPref: 0,
            med: 0,
            nlri: [],
        });
        const u = parseUpdate(parseMessage(msg)?.body ?? new Uint8Array());
        expect(u.withdrawn).toHaveLength(1);
        expect(u.withdrawn[0].dst.toString()).toBe('10.1.0.0');
        expect(u.withdrawn[0].prefLen).toBe(16);
        expect(u.nlri).toHaveLength(0);
    });

    it('round-trips a /32 prefix', () => {
        const msg = buildUpdate({
            withdrawn: [],
            nextHop: IPAddress.fromString('1.2.3.4'),
            asPath: [100],
            localPref: 100,
            med: 0,
            nlri: [{ dst: IPAddress.fromString('5.6.7.8'), prefLen: 32 }],
        });
        const u = parseUpdate(parseMessage(msg)?.body ?? new Uint8Array());
        expect(u.nlri[0].prefLen).toBe(32);
        expect(u.nlri[0].dst.toString()).toBe('5.6.7.8');
    });

    it('round-trips a default route /0', () => {
        const msg = buildUpdate({
            withdrawn: [],
            nextHop: IPAddress.fromString('10.0.0.1'),
            asPath: [65000],
            localPref: 100,
            med: 0,
            nlri: [{ dst: IPAddress.fromString('0.0.0.0'), prefLen: 0 }],
        });
        const u = parseUpdate(parseMessage(msg)?.body ?? new Uint8Array());
        expect(u.nlri[0].prefLen).toBe(0);
    });

    it('handles an empty AS_PATH', () => {
        const msg = buildUpdate({
            withdrawn: [],
            nextHop: IPAddress.fromString('10.0.0.1'),
            asPath: [],
            localPref: 100,
            med: 0,
            nlri: [{ dst: IPAddress.fromString('1.0.0.0'), prefLen: 8 }],
        });
        const u = parseUpdate(parseMessage(msg)?.body ?? new Uint8Array());
        expect(u.attrs.asPath).toEqual([]);
    });
});

// ── BGPDaemon – lifecycle ─────────────────────────────────────────────────────

describe('BGPDaemon – lifecycle', () => {
    it('does not start without a local AS', () => {
        const stack = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        daemon.start();
        expect(daemon._running).toBe(false);
        expect(daemon.log.some(l => l.includes('AS'))).toBe(true);
    });

    it('starts successfully with a local AS', () => {
        const stack = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        daemon.localAS = 65001;
        daemon.start();
        expect(daemon._running).toBe(true);
        daemon.stop();
    });

    it('stop clears learned routes and adjRibIn', () => {
        const stack = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        daemon.localAS = 65001;
        daemon.start();
        const dst = IPAddress.fromString('192.168.0.0');
        const nh  = IPAddress.fromString('10.0.0.2');
        const entry = { dst, prefLen: 24, nexthop: nh, asPath: [65002], localPref: 100, med: 0, fromPeer: '10.0.0.2', ifIndex: 0 };
        daemon._adjRibIn.set('192.168.0.0/24|10.0.0.2', entry);
        daemon._learned.set('192.168.0.0/24', entry);
        daemon.stop();
        expect(daemon._running).toBe(false);
        expect(daemon._learned.size).toBe(0);
        expect(daemon._adjRibIn.size).toBe(0);
    });

    it('setEnabled toggles start and stop', () => {
        const stack = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        daemon.localAS = 65001;
        daemon.setEnabled(true);
        expect(daemon._running).toBe(true);
        daemon.setEnabled(false);
        expect(daemon._running).toBe(false);
    });
});

// ── BGPDaemon – peer management ───────────────────────────────────────────────

describe('BGPDaemon – peer management', () => {
    it('addPeer stores peer config', () => {
        const daemon = new BGPDaemon(makeStack([{ ip: '10.0.0.1', prefix: 24 }]));
        daemon.addPeer({ ip: '10.0.0.2', remoteAS: 65002, description: 'test' });
        expect(daemon.peers).toHaveLength(1);
        expect(daemon.peers[0].remoteAS).toBe(65002);
    });

    it('addPeer is idempotent for the same IP', () => {
        const daemon = new BGPDaemon(makeStack([]));
        daemon.addPeer({ ip: '10.0.0.2', remoteAS: 65002 });
        daemon.addPeer({ ip: '10.0.0.2', remoteAS: 65002 });
        expect(daemon.peers).toHaveLength(1);
    });

    it('removePeer removes config and withdraws its routes', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        daemon.localAS = 65001;
        daemon.addPeer({ ip: '10.0.0.2', remoteAS: 65002 });
        const dst = IPAddress.fromString('192.168.0.0');
        const nh  = IPAddress.fromString('10.0.0.2');
        const entry = { dst, prefLen: 24, nexthop: nh, asPath: [65002], localPref: 100, med: 0, fromPeer: '10.0.0.2', ifIndex: 0 };
        daemon._adjRibIn.set('192.168.0.0/24|10.0.0.2', entry);
        daemon._learned.set('192.168.0.0/24', entry);
        daemon.removePeer('10.0.0.2');
        expect(daemon.peers).toHaveLength(0);
        expect(daemon._learned.has('192.168.0.0/24')).toBe(false);
    });
});

// ── BGPDaemon – _connectedPrefixes ────────────────────────────────────────────

describe('BGPDaemon – _connectedPrefixes', () => {
    it('returns network address for each non-loopback IPv4 interface', () => {
        const stack  = makeStack([
            { ip: '10.0.0.1',    prefix: 24 },
            { ip: '192.168.5.10', prefix: 28 },
        ]);
        const daemon = new BGPDaemon(stack);
        const keys   = daemon._connectedPrefixes().map(p => `${p.dst}/${p.prefLen}`);
        expect(keys).toContain('10.0.0.0/24');
        expect(keys).toContain('192.168.5.0/28');
    });

    it('excludes 0.0.0.0 addresses', () => {
        const daemon = new BGPDaemon(makeStack([{ ip: '0.0.0.0', prefix: 0 }]));
        expect(daemon._connectedPrefixes()).toHaveLength(0);
    });

    it('excludes loopback', () => {
        const daemon = new BGPDaemon(makeStack([{ ip: '127.0.0.1', prefix: 8 }]));
        expect(daemon._connectedPrefixes()).toHaveLength(0);
    });
});

// ── BGPDaemon – _bestForPrefix ────────────────────────────────────────────────

describe('BGPDaemon – _bestForPrefix', () => {
    it('picks the entry with the shortest AS_PATH', () => {
        const daemon = new BGPDaemon(makeStack([]));
        const dst  = IPAddress.fromString('192.168.0.0');
        const nh1  = IPAddress.fromString('10.0.0.2');
        const nh2  = IPAddress.fromString('10.0.0.3');
        daemon._adjRibIn.set('192.168.0.0/24|10.0.0.2', { dst, prefLen: 24, nexthop: nh1, asPath: [65002, 65003, 65004], localPref: 100, med: 0, fromPeer: '10.0.0.2', ifIndex: 0 });
        daemon._adjRibIn.set('192.168.0.0/24|10.0.0.3', { dst, prefLen: 24, nexthop: nh2, asPath: [65003], localPref: 100, med: 0, fromPeer: '10.0.0.3', ifIndex: 0 });
        expect(daemon._bestForPrefix('192.168.0.0/24')?.fromPeer).toBe('10.0.0.3');
    });

    it('returns null when no routes exist for the prefix', () => {
        expect(new BGPDaemon(makeStack([])).  _bestForPrefix('10.0.0.0/8')).toBeNull();
    });
});

// ── BGPDaemon – _learnPrefixes ────────────────────────────────────────────────

describe('BGPDaemon – _learnPrefixes', () => {
    it('installs the route and stores entry in adjRibIn', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        const dst    = IPAddress.fromString('172.16.0.0');
        const nh     = IPAddress.fromString('10.0.0.2');
        daemon._learnPrefixes([{ dst, prefLen: 16 }], { asPath: [65002], nextHop: nh, localPref: 100, med: 0 }, '10.0.0.2', 0);
        expect(stack._routes.some(r => r.dst === '172.16.0.0' && r.prefix === 16)).toBe(true);
        expect(daemon._adjRibIn.has('172.16.0.0/16|10.0.0.2')).toBe(true);
    });

    it('stores multiple prefixes in a single call', () => {
        const daemon = new BGPDaemon(makeStack([{ ip: '10.0.0.1', prefix: 24 }]));
        const nh     = IPAddress.fromString('10.0.0.2');
        daemon._learnPrefixes(
            [{ dst: IPAddress.fromString('1.0.0.0'), prefLen: 8 },
             { dst: IPAddress.fromString('2.0.0.0'), prefLen: 8 }],
            { asPath: [65002], nextHop: nh, localPref: 100, med: 0 }, '10.0.0.2', 0
        );
        expect(daemon._learned.size).toBe(2);
    });
});

// ── BGPDaemon – _withdrawPrefixes ─────────────────────────────────────────────

describe('BGPDaemon – _withdrawPrefixes', () => {
    it('removes the prefix from learned and adjRibIn', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        const dst    = IPAddress.fromString('172.16.0.0');
        const nh     = IPAddress.fromString('10.0.0.2');
        daemon._learnPrefixes([{ dst, prefLen: 16 }], { asPath: [65002], nextHop: nh, localPref: 100, med: 0 }, '10.0.0.2', 0);
        daemon._withdrawPrefixes([{ dst, prefLen: 16 }], '10.0.0.2');
        expect(daemon._learned.has('172.16.0.0/16')).toBe(false);
        expect(daemon._adjRibIn.has('172.16.0.0/16|10.0.0.2')).toBe(false);
    });

    it('is a no-op for a prefix not in adjRibIn', () => {
        const daemon = new BGPDaemon(makeStack([]));
        expect(() => daemon._withdrawPrefixes([{ dst: IPAddress.fromString('1.0.0.0'), prefLen: 8 }], '10.0.0.2')).not.toThrow();
    });
});

// ── BGPDaemon – _withdrawFromPeer ─────────────────────────────────────────────

describe('BGPDaemon – _withdrawFromPeer', () => {
    it('removes all routes from the specified peer', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        const nh     = IPAddress.fromString('10.0.0.2');
        daemon._learnPrefixes(
            [{ dst: IPAddress.fromString('192.168.0.0'), prefLen: 24 },
             { dst: IPAddress.fromString('10.5.0.0'),    prefLen: 16 }],
            { asPath: [65002], nextHop: nh, localPref: 100, med: 0 }, '10.0.0.2', 0
        );
        expect(daemon._learned.size).toBe(2);
        daemon._withdrawFromPeer('10.0.0.2');
        expect(daemon._learned.size).toBe(0);
        expect(daemon._adjRibIn.size).toBe(0);
    });
});

// ── BGPDaemon – failover ──────────────────────────────────────────────────────

describe('BGPDaemon – failover via _withdrawFromPeer', () => {
    it('switches to backup path when primary peer is withdrawn', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        const dst    = IPAddress.fromString('192.168.0.0');
        const nh1    = IPAddress.fromString('10.0.0.2');
        const nh2    = IPAddress.fromString('10.0.0.3');
        // Primary: shorter AS path (preferred)
        daemon._learnPrefixes([{ dst, prefLen: 24 }], { asPath: [65002], nextHop: nh1, localPref: 100, med: 0 }, '10.0.0.2', 0);
        // Backup: longer AS path
        daemon._learnPrefixes([{ dst, prefLen: 24 }], { asPath: [65003, 65002], nextHop: nh2, localPref: 100, med: 0 }, '10.0.0.3', 0);
        expect(daemon._learned.get('192.168.0.0/24')?.fromPeer).toBe('10.0.0.2');

        daemon._withdrawFromPeer('10.0.0.2');
        expect(daemon._learned.has('192.168.0.0/24')).toBe(true);
        expect(daemon._learned.get('192.168.0.0/24')?.fromPeer).toBe('10.0.0.3');
    });

    it('removes route entirely when last peer is withdrawn', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        const dst    = IPAddress.fromString('192.168.0.0');
        daemon._learnPrefixes([{ dst, prefLen: 24 }], { asPath: [65002], nextHop: IPAddress.fromString('10.0.0.2'), localPref: 100, med: 0 }, '10.0.0.2', 0);
        daemon._withdrawFromPeer('10.0.0.2');
        expect(daemon._learned.has('192.168.0.0/24')).toBe(false);
    });
});

// ── BGPDaemon – AS-path loop detection ───────────────────────────────────────

describe('BGPDaemon – AS-path loop detection', () => {
    it('ignores UPDATE containing own AS in AS_PATH', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        daemon.localAS = 65001;
        daemon.start();
        daemon.addPeer({ ip: '10.0.0.2', remoteAS: 65002 });

        const session = daemon.getSession('10.0.0.2');
        if (!session) throw new Error('no session');
        session._localIP = IPAddress.fromString('10.0.0.1');

        // AS_PATH [65002, 65001] — contains our own AS
        const body = buildUpdate({
            withdrawn: [],
            nextHop: IPAddress.fromString('10.0.0.2'),
            asPath: [65002, 65001],
            localPref: 100,
            med: 0,
            nlri: [{ dst: IPAddress.fromString('172.16.0.0'), prefLen: 16 }],
        });
        session._handleUpdate(parseMessage(body)?.body ?? new Uint8Array());
        expect(daemon._learned.has('172.16.0.0/16')).toBe(false);
        daemon.stop();
    });
});

// ── BGPDaemon – _routerIdIP ───────────────────────────────────────────────────

describe('BGPDaemon – _routerIdIP', () => {
    it('uses configured routerId when set', () => {
        const daemon = new BGPDaemon(makeStack([{ ip: '10.0.0.1', prefix: 24 }]));
        daemon.routerId = '9.9.9.9';
        expect(daemon._routerIdIP().toString()).toBe('9.9.9.9');
    });

    it('falls back to interface address when routerId is empty', () => {
        const daemon = new BGPDaemon(makeStack([{ ip: '10.0.0.5', prefix: 24 }]));
        expect(daemon._routerIdIP().toString()).toBe('10.0.0.5');
    });

    it('returns 0.0.0.1 when no suitable interface exists', () => {
        const daemon = new BGPDaemon(makeStack([]));
        expect(daemon._routerIdIP().toString()).toBe('0.0.0.1');
    });
});

// ── BGPDaemon – persistence ───────────────────────────────────────────────────

describe('BGPDaemon – persistence', () => {
    it('toJSON / applyJSON round-trips localAS, routerId, peers', () => {
        const d1 = new BGPDaemon(makeStack([{ ip: '10.0.0.1', prefix: 24 }]));
        d1.localAS  = 65001;
        d1.routerId = '1.2.3.4';
        d1.addPeer({ ip: '10.0.0.2', remoteAS: 65002, description: 'peer1' });
        const json = d1.toJSON();

        const d2 = new BGPDaemon(makeStack([{ ip: '10.0.0.1', prefix: 24 }]));
        d2.applyJSON({ ...json, enabled: false });
        expect(d2.localAS).toBe(65001);
        expect(d2.routerId).toBe('1.2.3.4');
        expect(d2.peers[0].ip).toBe('10.0.0.2');
        expect(d2.peers[0].remoteAS).toBe(65002);
        d1.stop();
        d2.stop();
    });

    it('applyJSON starts daemon when enabled is true', () => {
        const stack  = makeStack([{ ip: '10.0.0.1', prefix: 24 }]);
        const daemon = new BGPDaemon(stack);
        daemon.applyJSON({ enabled: true, localAS: 65001, routerId: '', peers: [] });
        expect(daemon._running).toBe(true);
        daemon.stop();
    });

    it('applyJSON does not start when enabled is false', () => {
        const daemon = new BGPDaemon(makeStack([]));
        daemon.applyJSON({ enabled: false, localAS: 65001, routerId: '', peers: [] });
        expect(daemon._running).toBe(false);
    });
});
