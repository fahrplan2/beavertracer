//@ts-check

/**
 * RemoteBridge — two bridges joined through the real signaling server
 * (server/signal/server.mjs) and an in-memory stand-in for RTCPeerConnection:
 * room handshake, frame forwarding both ways, speed/pause sync, error paths.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
// See Firewall.test.js — breaks the SimulatedObject <-> SimControl import cycle.
import '../../src/SimControl.js';
import { RemoteBridge } from '../../src/sim/RemoteBridge.js';
import { RemoteSession } from '../../src/lib/RemoteSession.js';
import { SignalClient } from '../../src/lib/SignalClient.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';
import { createSignalServer } from '../../server/signal/server.mjs';

globalThis.document = /** @type {any} */ ({
    createElement: () => ({
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild() {},
        remove() {},
        style: {},
    }),
});

// ── In-memory WebRTC ──────────────────────────────────────────────────────────

/** @type {Map<string, FakePC>} */
const offers = new Map();
let nextId = 1;

class FakeChannel {
    /** @param {FakePC} pc @param {string} label */
    constructor(pc, label) {
        this.pc = pc;
        this.label = label;
        this.readyState = 'connecting';
        this.bufferedAmount = 0;
        this.binaryType = 'blob';
        /** @type {any} */ this.onopen = null;
        /** @type {any} */ this.onclose = null;
        /** @type {any} */ this.onmessage = null;
    }
    /** @param {any} data */
    send(data) {
        const peer = this.pc.peer?.channels.get(this.label);
        const payload = data instanceof Uint8Array ? data.slice().buffer : data;
        queueMicrotask(() => peer?.onmessage?.({ data: payload }));
    }
    close() {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        this.onclose?.();
    }
    _open() {
        this.readyState = 'open';
        this.onopen?.();
    }
}

class FakePC {
    /** @param {any} config */
    constructor(config) {
        this.config = config;
        this.id = nextId++;
        /** @type {Map<string, FakeChannel>} */
        this.channels = new Map();
        /** @type {FakePC|null} */
        this.peer = null;
        /** @type {any} */ this.localDescription = null;
        this.iceGatheringState = 'complete';
        this.connectionState = 'new';
        /** @type {any} */ this.onconnectionstatechange = null;
    }
    /** @param {string} label */
    createDataChannel(label) {
        const ch = new FakeChannel(this, label);
        this.channels.set(label, ch);
        return ch;
    }
    async createOffer() { return { type: 'offer', sdp: `v=0\r\na=fake-offer:${this.id}\r\n` }; }
    async createAnswer() { return { type: 'answer', sdp: `v=0\r\na=fake-answer:${this.id}\r\n` }; }
    /** @param {any} d */
    async setLocalDescription(d) {
        this.localDescription = d;
        if (d.type === 'offer') offers.set(d.sdp, this);
    }
    /** @param {any} d */
    async setRemoteDescription(d) {
        if (d.type === 'offer') {
            this.peer = offers.get(d.sdp) ?? null;
        } else if (FakePC.blockIce) {
            this._setConn('failed');
        } else {
            // host got the answer → link both sides and open all channels
            const guestId = Number(/fake-answer:(\d+)/.exec(d.sdp)?.[1]);
            const guest = FakePC.all.get(guestId);
            if (!guest) throw new Error('unknown answer');
            this.peer = guest;
            guest.peer = this;
            queueMicrotask(() => {
                for (const pc of [this, guest]) {
                    pc._setConn('connected');
                    for (const ch of pc.channels.values()) ch._open();
                }
            });
        }
    }
    /** @param {string} s */
    _setConn(s) { this.connectionState = s; this.onconnectionstatechange?.(); }
    addEventListener() {}
    removeEventListener() {}
    close() {
        for (const ch of this.channels.values()) ch.close();
    }
    static blockIce = false;
    /** @type {Map<number, FakePC>} */
    static all = new Map();
}
const RTC = /** @type {any} */ (class extends FakePC {
    /** @param {any} c */
    constructor(c) { super(c); FakePC.all.set(this.id, this); }
});

// ── Harness ───────────────────────────────────────────────────────────────────

/** @type {Array<() => void>} */
const cleanups = [];
afterEach(async () => {
    FakePC.blockIce = false;
    for (const c of cleanups.splice(0)) await c();
    vi.restoreAllMocks();
});

async function startSignal() {
    const s = createSignalServer({ stunUrls: ['stun:example.org:3478'] });
    await new Promise((r) => s.server.listen(0, '127.0.0.1', () => r(undefined)));
    cleanups.push(() => new Promise((r) => s.close(() => r(undefined))));
    const addr = /** @type {import('node:net').AddressInfo} */ (s.server.address());
    return `http://127.0.0.1:${addr.port}`;
}

/** Minimal SimControl stand-in: just what the speed/pause sync touches. */
function fakeSimControl(tick = 400) {
    const sc = {
        mode: 'run',
        isPaused: false,
        pause() { sc.isPaused = true; },
        /** @param {number} ms */
        setTick(ms) { /** @type {any} */ (sc.constructor).tick = ms; sc.isPaused = false; },
    };
    // RemoteBridge reads the speed from simcontrol.constructor.tick (SimControl.tick is static)
    Object.defineProperty(sc, 'constructor', { value: { tick }, enumerable: false });
    return /** @type {any} */ (sc);
}

/** @param {string} base @param {any} [sc] */
function bridge(base, sc = fakeSimControl()) {
    const b = new RemoteBridge();
    b.simcontrol = sc;
    // Replace _start's session factory with one wired to the test server + fake RTC.
    b._start = function (how, code = '') {
        this.session?.close();
        const session = new RemoteSession({
            signal: new SignalClient(base),
            RTC,
            onFrame: (x) => this._onRemoteFrame(x),
            onControl: (m) => this._onControl(m),
            onState: (s) => this._onSessionState(s),
        });
        this.session = session;
        if (how === 'host') session.host();
        else session.join(code);
    };
    cleanups.push(() => b.destroy());
    return b;
}

/** @param {() => boolean} cond */
async function until(cond, ms = 2000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 5));
    }
}

/** @param {RemoteBridge} a @param {RemoteBridge} b */
async function connect(a, b) {
    a._start('host');
    await until(() => a.session?.state === 'waiting');
    b._start('join', /** @type {string} */ (a.session?.code));
    await until(() => !!a.session?.connected && !!b.session?.connected);
}

function frame(n = 1) {
    return new EthernetFrame({
        dstMac: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        srcMac: new Uint8Array([0xaa, 0, 0, 0, 0, n]),
        etherType: 0x0800,
        payload: new Uint8Array(46).fill(n),
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RemoteBridge', () => {
    it('connects two bridges via room code and forwards frames both ways', async () => {
        const base = await startSignal();
        const a = bridge(base);
        const b = bridge(base);
        await connect(a, b);

        // a frame arriving on A's eth0 (from its local network) …
        a.port.recieve(frame(1).pack());
        // … leaves B's eth0 towards B's local network
        await until(() => b.port.outBuffer.length === 1);
        expect(b.port.getNextOutgoingFrame()).toEqual(frame(1).pack());

        b.port.recieve(frame(2).pack());
        await until(() => a.port.outBuffer.length === 1);
        expect(a.port.getNextOutgoingFrame()).toEqual(frame(2).pack());
    });

    it('drops frames while not connected and ignores garbage from the peer', async () => {
        const a = bridge('http://unused');
        a.port.recieve(frame(1).pack()); // no session — just gone
        expect(a.port.inBuffer.length).toBe(0);

        a._onRemoteFrame(new Uint8Array(5));
        a._onRemoteFrame(new Uint8Array(4000));
        expect(a.port.outBuffer.length).toBe(0);
    });

    it("takes over the host's speed and pause on connect, then syncs both ways", async () => {
        const base = await startSignal();
        const scA = fakeSimControl(100);
        const scB = fakeSimControl(400);
        const a = bridge(base, scA);
        const b = bridge(base, scB);
        await connect(a, b);

        await until(() => scB.constructor.tick === 100);

        scB.pause();
        b._pushSync();
        await until(() => scA.isPaused);

        scA.setTick(1600);
        a._pushSync();
        await until(() => !scB.isPaused && scB.constructor.tick === 1600);
        // B applied it — it must not bounce the same state back
        const send = vi.spyOn(/** @type {RemoteSession} */ (b.session), 'sendControl');
        b._pushSync();
        expect(send).not.toHaveBeenCalled();
    });

    it('reports a wrong room code', async () => {
        const base = await startSignal();
        const b = bridge(base);
        b._start('join', '000000');
        await until(() => b.session?.state === 'failed');
        expect(b.session?.error).toBe('unknown_room');
    });

    it('fails with ice_failed when no path between the peers exists', async () => {
        const base = await startSignal();
        FakePC.blockIce = true;
        const a = bridge(base);
        const b = bridge(base);
        a._start('host');
        await until(() => a.session?.state === 'waiting');
        b._start('join', /** @type {string} */ (a.session?.code));
        await until(() => a.session?.state === 'failed');
        expect(a.session?.error).toBe('ice_failed');
    });

    it('cancelling while waiting removes the room on the server', async () => {
        const base = await startSignal();
        const a = bridge(base);
        a._start('host');
        await until(() => a.session?.state === 'waiting');
        const code = /** @type {string} */ (a.session?.code);
        a._stop();
        // the DELETE runs in the background — wait until the server has dropped the room
        for (let i = 0; i < 100 && (await (await fetch(`${base}/health`)).json()).rooms > 0; i++) {
            await new Promise((r) => setTimeout(r, 5));
        }
        const b = bridge(base);
        b._start('join', code);
        await until(() => b.session?.state === 'failed');
        expect(b.session?.error).toBe('unknown_room');
    });

    it('closing one side closes the other', async () => {
        const base = await startSignal();
        const a = bridge(base);
        const b = bridge(base);
        await connect(a, b);
        // simulate the channel going away on B's side when A disconnects
        const bSession = /** @type {RemoteSession} */ (b.session);
        a._stop();
        for (const ch of /** @type {any} */ (bSession)._pc.channels.values()) ch.close();
        expect(bSession.state).toBe('closed');
    });

    it('saves without connection state and loads back', () => {
        const a = bridge('http://unused');
        const json = a.toJSON();
        expect(json.kind).toBe('RemoteBridge');
        const b = RemoteBridge.fromJSON(json);
        cleanups.push(() => b.destroy());
        expect(b.session).toBeNull();
        expect(b.getPortByKey('eth0')).toBe(b.port);
    });
});
