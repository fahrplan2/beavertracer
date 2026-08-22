//@ts-check

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClockApp } from '../../src/apps/ClockApp.js';
import { NTPServerApp } from '../../src/apps/NTPServerApp.js';
import { SystemClock } from '../../src/apps/lib/SystemClock.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { simTimer } from '../../src/lib/SimTimer.js';

// ── Minimal DOM stub — just enough for GenericProcess's constructor/run() ──────
// (Like the other app tests, UI construction (onMount) is not exercised here;
// element refs are stubbed directly and the app's logic methods are called.)

if (!globalThis.document) {
  const makeFakeEl = () => ({ classList: { add() {}, remove() {} }, style: {} });
  // @ts-ignore
  globalThis.document = { createElement: (_tag) => makeFakeEl() };
}

/** Advance the simulated timer, flushing microtasks after each tick. */
async function advanceTicks(n) {
  for (let i = 0; i < n; i++) {
    simTimer.tick();
    await Promise.resolve();
    await Promise.resolve();
  }
}

// ── Async single-item queue / virtual UDP network (same shape as NTPServerApp.test.js) ──

function makeQueue() {
  /** @type {any[]} */
  const pending = [];
  let closed = false;
  /** @type {((r: {done: boolean, value: any}) => void) | null} */
  let waiter = null;
  return {
    push(val) {
      if (waiter) { const r = waiter; waiter = null; r({ done: false, value: val }); }
      else pending.push(val);
    },
    close() {
      if (closed) return; closed = true;
      if (waiter) { const r = waiter; waiter = null; r({ done: true, value: null }); }
    },
    next() {
      if (pending.length) return Promise.resolve({ done: false, value: pending.shift() });
      if (closed)         return Promise.resolve({ done: true,  value: null });
      return new Promise(r => { waiter = r; });
    },
  };
}

function makeVirtualUDPNet() {
  let nextId = 0;
  /** @type {Map<number, ReturnType<typeof makeQueue>>} */
  const recvQueues = new Map();
  const outgoing = makeQueue();

  const net = {
    openUDPSocket(_ip, _port) {
      const id = ++nextId;
      recvQueues.set(id, makeQueue());
      return id;
    },
    closeUDPSocket(id) {
      recvQueues.get(id)?.close();
      recvQueues.delete(id);
    },
    async recvUDPSocket(id) {
      const q = recvQueues.get(id);
      if (!q) return null;
      const { done, value } = await q.next();
      return done ? null : value;
    },
    sendUDPSocket(_id, dstIp, dstPort, data) {
      outgoing.push({ dstIp, dstPort, data });
    },
  };

  function inject(sockId, src, srcPort, payload) {
    recvQueues.get(sockId)?.push({ src, srcPort, payload });
  }

  async function nextSent() {
    const { done, value } = await outgoing.next();
    return done ? null : value;
  }

  return { net, inject, nextSent };
}

// ── Mock OS ───────────────────────────────────────────────────────────────────

function makeFs() {
  /** @type {Record<string, string>} */
  const files = {};
  return {
    readFile(p) { if (!(p in files)) throw new Error('ENOENT: ' + p); return files[p]; },
    writeFile(p, c) { files[p] = c; },
  };
}

function makeOS(net) {
  return {
    net,
    fs: makeFs(),
    exit() {},
    dns: null,
    clock: new SystemClock(),
  };
}

/** @param {string} [value] */
function makeInputStub(value = '') {
  return { value, disabled: false };
}

function makeTextStub() {
  return { textContent: '' };
}

/** Wires up the element refs the app's logic methods read/write, bypassing onMount(). */
function stubElements(app) {
  app.bigTimeEl = makeTextStub();
  app.bigDateEl = makeTextStub();
  app.dateEl = makeInputStub();
  app.timeEl = makeInputStub();
  app.setMsgEl = makeTextStub();
  app.ntpHostEl = makeInputStub();
  app.ntpPortEl = makeInputStub();
  app.syncBtn = { disabled: false };
  app.ntpMsgEl = makeTextStub();
  app.mounted = true;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ClockApp', () => {
  /** @type {ReturnType<typeof makeVirtualUDPNet>} */
  let vnet;
  /** @type {ClockApp} */
  let app;

  beforeEach(() => {
    vnet = makeVirtualUDPNet();
    app = new ClockApp(makeOS(vnet.net));
    app.run();
    stubElements(app);
  });

  it('_refreshManualInputsFromClock() fills the date/time fields from the virtual clock', () => {
    const d = app.os.clock.now();
    app._refreshManualInputsFromClock();
    expect(app.dateEl.value).toBe(app._fmtDateInput(d));
    expect(app.timeEl.value).toBe(app._fmtTimeInput(d));
  });

  it('_applySetTime() steps the virtual clock to the entered date/time', () => {
    app.dateEl.value = '2020-01-01';
    app.timeEl.value = '08:30:00';
    app._applySetTime();

    const now = app.os.clock.now();
    expect(now.getFullYear()).toBe(2020);
    expect(now.getMonth()).toBe(0);
    expect(now.getDate()).toBe(1);
    expect(now.getHours()).toBe(8);
    expect(now.getMinutes()).toBe(30);
    expect(app.setMsgEl.textContent).not.toBe('');
  });

  it('_applySetTime() rejects an empty date without touching the clock', () => {
    const before = app.os.clock.offsetMs;
    app.dateEl.value = '';
    app.timeEl.value = '08:30:00';
    app._applySetTime();

    expect(app.os.clock.offsetMs).toBe(before);
    expect(app.setMsgEl.textContent).not.toBe('');
  });

  it('_resetToSystem() clears a configured offset', () => {
    app.os.clock.offsetMs = 123456;
    app._resetToSystem();
    expect(Math.abs(app.os.clock.offsetMs)).toBeLessThan(50);
  });

  it('_syncNtp() corrects the clock against a real NTPServerApp reply', async () => {
    const server = new NTPServerApp(makeOS(vnet.net));
    server._start();

    // Client clock starts 30s behind; server clock runs on real time.
    app.os.clock.offsetMs = -30000;

    app.ntpHostEl.value = '10.0.0.1';
    app.ntpPortEl.value = String(server.port);

    const syncPromise = app._syncNtp();

    // client -> server
    const toServer = await vnet.nextSent();
    vnet.inject(/** @type {number} */ (server.socketPort), IPAddress.fromString('10.0.0.2'), 12345, toServer.data);

    // server -> client. Socket ids are handed out in open order: the server's
    // (opened via server._start() above) got id 1, so the client's ephemeral
    // socket (opened inside _syncNtp()) is id 2.
    const toClient = await vnet.nextSent();
    vnet.inject(2, IPAddress.fromString('10.0.0.1'), server.port, toClient.data);

    await syncPromise;
    server._stop();

    expect(Math.abs(app.os.clock.offsetMs)).toBeLessThan(50);
    expect(app.syncing).toBe(false);
    expect(app.ntpMsgEl.textContent).not.toBe('');
  });

  it('_syncNtp() reports a timeout when nothing answers', async () => {
    app.ntpHostEl.value = '10.0.0.1';
    app.ntpPortEl.value = '123';

    const syncPromise = app._syncNtp();
    await Promise.resolve();
    await advanceTicks(90); // NTP_TIMEOUT_MS (400ms) / SIM_MS_PER_TICK (5ms) = 80 ticks
    await syncPromise;

    expect(app.syncing).toBe(false);
    expect(app.ntpMsgEl.textContent).not.toBe('');
  });

  it('_syncNtp() rejects an invalid port without opening a socket', async () => {
    app.ntpHostEl.value = '10.0.0.1';
    app.ntpPortEl.value = '99999';

    await app._syncNtp();

    expect(app.syncing).toBe(false);
    expect(app.ntpMsgEl.textContent).not.toBe('');
    // no request should have been sent
    const raced = await Promise.race([
      vnet.nextSent().then(() => 'sent'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 20)),
    ]);
    expect(raced).toBe('timeout');
  });

  it('_syncNtp() reports an unresolvable host when there is no DNS resolver', async () => {
    app.ntpHostEl.value = 'ntp.example.invalid';
    app.ntpPortEl.value = '123';

    await app._syncNtp();

    expect(app.syncing).toBe(false);
    expect(app.ntpMsgEl.textContent).not.toBe('');
  });
});
