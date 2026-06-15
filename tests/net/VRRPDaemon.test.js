//@ts-check
import { describe, it, expect, afterEach } from 'vitest';
import { VRRPDaemon } from '../../src/net/VRRPDaemon.js';
import { VRRPPacket } from '../../src/net/pdu/VRRPPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { simTimer, SimTimer } from '../../src/lib/SimTimer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @param {{ ip: string, name?: string }[]} ifaces */
function makeStack(ifaces) {
    const sent = [];
    const arpFrames = [];
    const protoHandlers = new Map();

    const stack = {
        interfaces: ifaces.map(({ ip, name }, i) => ({
            ip: IPAddress.fromString(ip),
            prefixLength: 24,
            name: name ?? `eth${i}`,
            port: {
                send: (frame) => arpFrames.push(frame),
                linkref: {},
            },
            virtualIPs: new Map(),
            neighborCache: new Map(),
        })),
        _sent: sent,
        _arpFrames: arpFrames,
        _protoHandlers: protoHandlers,
        registerProtoHandler:   (proto, fn) => protoHandlers.set(proto, fn),
        unregisterProtoHandler: (proto)     => protoHandlers.delete(proto),
        sendOnInterface: async (ifIndex, dst, proto, payload) => {
            sent.push({ ifIndex, dst: dst.toString(), proto, payload: new Uint8Array(payload) });
        },
    };
    return stack;
}

/** Advance simulation by n ticks. */
function tick(n) {
    for (let i = 0; i < n; i++) simTimer.tick();
}

/**
 * Compute ticks needed to exceed the VRRP master-down interval.
 * @param {number} priority
 * @param {number} advIntervalMs
 */
function masterDownTicks(priority, advIntervalMs) {
    const skew = ((256 - priority) / 256) * advIntervalMs;
    const ms = 3 * advIntervalMs + skew;
    return SimTimer.toTicks(ms) + 2; // +2 ticks margin
}

/**
 * Deliver the last sent VRRP packet from stackA's ifIndex to stackB's handler.
 * @param {ReturnType<typeof makeStack>} from
 * @param {number} fromIfIdx
 * @param {ReturnType<typeof makeStack>} to
 * @param {number} toIfIdx
 */
function deliver(from, fromIfIdx, to, toIfIdx) {
    const last = from._sent.findLast?.(p => p.proto === 112) ?? [...from._sent].reverse().find(p => p.proto === 112);
    if (!last) return;
    const handler = to._protoHandlers.get(112);
    if (!handler) return;
    handler(
        { src: from.interfaces[fromIfIdx].ip, payload: last.payload },
        toIfIdx,
    );
}

const daemons = [];
afterEach(() => {
    for (const d of daemons) d.stop();
    daemons.length = 0;
});

function daemon(stack) {
    const d = new VRRPDaemon(stack);
    daemons.push(d);
    return d;
}

// ── VRRPPacket ────────────────────────────────────────────────────────────────

describe('VRRPPacket – pack / fromBytes', () => {
    it('round-trips version, VRID, priority, advInterval', () => {
        const vip = IPAddress.fromString('192.168.1.254');
        const pkt = new VRRPPacket({ vrid: 5, priority: 150, advInterval: 1, virtualIPs: [vip] });
        const parsed = VRRPPacket.fromBytes(pkt.pack());
        expect(parsed).not.toBeNull();
        expect(parsed.vrid).toBe(5);
        expect(parsed.priority).toBe(150);
        expect(parsed.advInterval).toBe(1);
        expect(parsed.virtualIPs).toHaveLength(1);
        expect(parsed.virtualIPs[0].toString()).toBe('192.168.1.254');
    });

    it('pack produces correct byte length (1 VIP)', () => {
        const pkt = new VRRPPacket({ vrid: 1, priority: 100, advInterval: 1, virtualIPs: [IPAddress.fromString('10.0.0.1')] });
        // 8 header + 4 VIP + 8 auth-pad = 20
        expect(pkt.pack().length).toBe(20);
    });

    it('fromBytes returns null for truncated data', () => {
        expect(VRRPPacket.fromBytes(new Uint8Array(4))).toBeNull();
    });

    it('fromBytes returns null for wrong version', () => {
        const pkt = new VRRPPacket({ vrid: 1, priority: 100, advInterval: 1, virtualIPs: [IPAddress.fromString('10.0.0.1')] });
        const bytes = pkt.pack();
        bytes[0] = (3 << 4) | 1; // version 3
        expect(VRRPPacket.fromBytes(bytes)).toBeNull();
    });

    it('round-trips two virtual IPs', () => {
        const vips = ['10.0.0.1', '10.0.0.2'].map(IPAddress.fromString.bind(IPAddress));
        const pkt = new VRRPPacket({ vrid: 2, priority: 100, advInterval: 1, virtualIPs: vips });
        const parsed = VRRPPacket.fromBytes(pkt.pack());
        expect(parsed.virtualIPs).toHaveLength(2);
        expect(parsed.virtualIPs[1].toString()).toBe('10.0.0.2');
    });
});

// ── VRRPDaemon – solo router ──────────────────────────────────────────────────

describe('VRRPDaemon – solo router', () => {
    it('starts in INITIALIZE state', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        d.start();
        expect(d.groups[0].state).toBe('initialize');
    });

    it('transitions INITIALIZE → MASTER after master-down interval (no other router)', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        d.start();

        tick(masterDownTicks(100, 100));

        expect(d.groups[0].state).toBe('master');
    });

    it('sets virtualIP in interface.neighborCache when becoming MASTER', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        d.start();

        tick(masterDownTicks(100, 100));

        expect(stack.interfaces[0].neighborCache.has('10.0.0.254')).toBe(true);
        expect(stack.interfaces[0].virtualIPs.has('10.0.0.254')).toBe(true);
    });

    it('virtual MAC for VRID 1 is 00:00:5e:00:01:01', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        d.start();
        tick(masterDownTicks(100, 100));

        const vmac = stack.interfaces[0].neighborCache.get('10.0.0.254');
        expect(Array.from(vmac)).toEqual([0x00, 0x00, 0x5e, 0x00, 0x01, 0x01]);
    });

    it('MASTER sends periodic advertisements', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        d.start();

        tick(masterDownTicks(100, 100));
        const sentBefore = stack._sent.length;

        // advance one more adv interval
        tick(SimTimer.toTicks(100) + 2);

        expect(stack._sent.length).toBeGreaterThan(sentBefore);
        const lastSent = stack._sent.at(-1);
        expect(lastSent.proto).toBe(112);
        expect(lastSent.dst).toBe('224.0.0.18');
    });

    it('sends gratuitous ARP on becoming MASTER', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        d.start();

        tick(masterDownTicks(100, 100));

        expect(stack._arpFrames.length).toBeGreaterThan(0);
    });

    it('stop() clears virtualIP from neighborCache', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        d.start();
        tick(masterDownTicks(100, 100));
        expect(stack.interfaces[0].virtualIPs.has('10.0.0.254')).toBe(true);

        d.stop();
        expect(stack.interfaces[0].virtualIPs.has('10.0.0.254')).toBe(false);
        expect(stack.interfaces[0].neighborCache.has('10.0.0.254')).toBe(false);
    });

    it('removeGroup() clears virtualIP from neighborCache', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        d.start();
        tick(masterDownTicks(100, 100));

        d.removeGroup(0, 1);
        expect(stack.interfaces[0].virtualIPs.has('10.0.0.254')).toBe(false);
        expect(d.groups).toHaveLength(0);
    });
});

// ── VRRPDaemon – two routers ──────────────────────────────────────────────────

describe('VRRPDaemon – two routers', () => {
    it('higher-priority router becomes MASTER, lower becomes BACKUP', () => {
        const stackA = makeStack([{ ip: '10.0.0.1', name: 'eth0' }]); // prio 150
        const stackB = makeStack([{ ip: '10.0.0.2', name: 'eth0' }]); // prio 100

        const dA = daemon(stackA);
        const dB = daemon(stackB);

        dA.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 150, advIntervalMs: 100 });
        dB.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });

        dA.start();
        dB.start();

        // Advance until A becomes MASTER
        tick(masterDownTicks(150, 100));

        // Deliver A's advertisement to B (B sees a higher-priority master → stays BACKUP)
        deliver(stackA, 0, stackB, 0);

        // A should be MASTER, B should be BACKUP
        expect(dA.groups[0].state).toBe('master');
        expect(dB.groups[0].state).toBe('backup');
    });

    it('BACKUP does not hold virtualIP in neighborCache', () => {
        const stackA = makeStack([{ ip: '10.0.0.1' }]);
        const stackB = makeStack([{ ip: '10.0.0.2' }]);

        const dA = daemon(stackA);
        const dB = daemon(stackB);

        dA.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 150, advIntervalMs: 100 });
        dB.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });

        dA.start();
        dB.start();

        tick(masterDownTicks(150, 100));
        deliver(stackA, 0, stackB, 0);

        expect(stackB.interfaces[0].virtualIPs.has('10.0.0.254')).toBe(false);
    });

    it('BACKUP becomes MASTER when MASTER stops advertising (master-down expires)', () => {
        const stackA = makeStack([{ ip: '10.0.0.1' }]); // prio 150 → MASTER
        const stackB = makeStack([{ ip: '10.0.0.2' }]); // prio 100 → BACKUP

        const dA = daemon(stackA);
        const dB = daemon(stackB);

        dA.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 150, advIntervalMs: 100 });
        dB.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });

        dA.start();
        dB.start();

        tick(masterDownTicks(150, 100));
        deliver(stackA, 0, stackB, 0); // B goes BACKUP, resets master-down timer

        expect(dB.groups[0].state).toBe('backup');

        // A "disappears" — stop sending advertisements, just advance time
        dA.stop(); // stop sending
        tick(masterDownTicks(100, 100)); // B's master-down timer expires

        expect(dB.groups[0].state).toBe('master');
        expect(stackB.interfaces[0].virtualIPs.has('10.0.0.254')).toBe(true);
    });

    it('MASTER steps down when it receives advertisement with higher priority', () => {
        const stackA = makeStack([{ ip: '10.0.0.1' }]); // starts as master (prio 100)
        const stackB = makeStack([{ ip: '10.0.0.2' }]); // higher prio (200) appears later

        const dA = daemon(stackA);
        dA.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        dA.start();

        tick(masterDownTicks(100, 100)); // A becomes MASTER
        expect(dA.groups[0].state).toBe('master');

        // Simulate B's advertisement arriving at A with higher priority
        const highPrioAdv = new VRRPPacket({ vrid: 1, priority: 200, advInterval: 1, virtualIPs: [IPAddress.fromString('10.0.0.254')] });
        const handler = stackA._protoHandlers.get(112);
        handler({ src: IPAddress.fromString('10.0.0.2'), payload: highPrioAdv.pack() }, 0);

        expect(dA.groups[0].state).toBe('backup');
        expect(stackA.interfaces[0].virtualIPs.has('10.0.0.254')).toBe(false);
    });

    it('BACKUP with preempt=true takes over from lower-priority MASTER', () => {
        const stackA = makeStack([{ ip: '10.0.0.1' }]); // low prio → MASTER first
        const stackB = makeStack([{ ip: '10.0.0.2' }]); // high prio, preempt=true

        const dA = daemon(stackA);
        dA.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        dA.start();

        tick(masterDownTicks(100, 100)); // A becomes MASTER
        expect(dA.groups[0].state).toBe('master');

        // B starts later with higher priority
        const dB = daemon(stackB);
        dB.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 200, advIntervalMs: 100, preempt: true });
        dB.start();

        // First delivery: INITIALIZE → BACKUP (B sees there is a master)
        deliver(stackA, 0, stackB, 0);
        expect(dB.groups[0].state).toBe('backup');

        // Second delivery: BACKUP sees lower-prio master → preempts immediately
        deliver(stackA, 0, stackB, 0);

        expect(dB.groups[0].state).toBe('master');
    });

    it('BACKUP with preempt=false does NOT take over from lower-priority MASTER', () => {
        const stackA = makeStack([{ ip: '10.0.0.1' }]);
        const stackB = makeStack([{ ip: '10.0.0.2' }]);

        const dA = daemon(stackA);
        dA.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        dA.start();

        tick(masterDownTicks(100, 100));

        const dB = daemon(stackB);
        dB.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 200, advIntervalMs: 100, preempt: false });
        dB.start();

        deliver(stackA, 0, stackB, 0);

        expect(dB.groups[0].state).toBe('backup'); // stays BACKUP despite higher prio
    });
});

// ── VRRPDaemon – serialization ────────────────────────────────────────────────

describe('VRRPDaemon – toJSON / applyJSON', () => {
    it('round-trips group config', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 3, virtualIP: '192.168.1.1', priority: 120, advIntervalMs: 500, preempt: false });

        const json = d.toJSON();
        expect(json.groups).toHaveLength(1);

        const stack2 = makeStack([{ ip: '10.0.0.1' }]);
        const d2 = daemon(stack2);
        d2.applyJSON(json);

        expect(d2.groups).toHaveLength(1);
        expect(d2.groups[0].vrid).toBe(3);
        expect(d2.groups[0].virtualIP.toString()).toBe('192.168.1.1');
        expect(d2.groups[0].priority).toBe(120);
        expect(d2.groups[0].preempt).toBe(false);
    });

    it('applyJSON with missing/null groups does not throw', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        expect(() => d.applyJSON(null)).not.toThrow();
        expect(() => d.applyJSON({})).not.toThrow();
    });

    it('applyJSON skips invalid group entries', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.applyJSON({ groups: [{ ifIndex: 0, vrid: 1, virtualIP: 'not-an-ip' }] });
        expect(d.groups).toHaveLength(0);
    });

    it('addGroup ignores duplicates (same ifIndex + vrid)', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254' });
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254' });
        expect(d.groups).toHaveLength(1);
    });
});

// ── VRRPDaemon – logging ──────────────────────────────────────────────────────

describe('VRRPDaemon – logging', () => {
    it('logs state transitions', () => {
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        d.start();

        tick(masterDownTicks(100, 100));

        expect(d.log.some(l => l.includes('MASTER'))).toBe(true);
    });

    it('calls onLogUpdate when log grows', () => {
        let calls = 0;
        const stack = makeStack([{ ip: '10.0.0.1' }]);
        const d = daemon(stack);
        d.onLogUpdate = () => calls++;
        d.addGroup({ ifIndex: 0, vrid: 1, virtualIP: '10.0.0.254', priority: 100, advIntervalMs: 100 });
        d.start();

        tick(masterDownTicks(100, 100));

        expect(calls).toBeGreaterThan(0);
    });
});
