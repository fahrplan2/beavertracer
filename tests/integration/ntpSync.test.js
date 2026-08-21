//@ts-check

/**
 * Regression test for the `ntpdate` receive-timeout logic (net/ntpdate.js).
 *
 * Bug this guards against: recvWithTimeout() used to call net.recvUDPSocket(sock)
 * again on every poll tick while racing it against a short per-tick sleep.
 * UdpEngine resolves waiters FIFO (see UdpEngine.js recv()/handle()), so
 * re-issuing the recv() call every tick abandoned still-pending waiters —
 * the eventual reply only ever resolved the *oldest* (already-abandoned)
 * waiter, never the current one. That was invisible on a zero-delay link
 * (loopback), where the very first recv() call already wins the race, but
 * broke on any topology with real propagation delay between client and
 * server — exactly what this test models.
 *
 * Topology: clientStack (10.0.0.2/24) ─── delayed wire (~3 ticks) ─── serverStack (10.0.0.1/24)
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { IPStack } from '../../src/net/IPStack.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';
import { IPv4Packet } from '../../src/net/pdu/IPv4Packet.js';
import { NTPServerApp } from '../../src/apps/NTPServerApp.js';
import { SystemClock } from '../../src/apps/lib/SystemClock.js';
import { ntpdate } from '../../src/apps/terminal/commands/net/ntpdate.js';
import { simTimer, SimTimer } from '../../src/lib/SimTimer.js';

// ── Minimal DOM stub (LoggedProcess / GenericProcess access document) ─────────

if (!globalThis.document) {
  const makeFakeEl = () => {
    const el = {
      classList: { add() {}, remove() {} },
      style: {},
      disabled: false,
      value: '',
      textContent: '',
      childElementCount: 0,
      get scrollTop() { return 0; },
      set scrollTop(_v) {},
      get scrollHeight() { return 0; },
      replaceChildren() {},
      appendChild() { return el; },
      removeChild() { return el; },
      addEventListener() {},
      setAttribute() {},
    };
    return el;
  };
  // @ts-ignore
  globalThis.document = {
    createElement: (_tag) => makeFakeEl(),
    createTextNode: (_t) => ({}),
    createDocumentFragment: () => ({ appendChild() {} }),
  };
}

/** Drain the microtask queue n times. */
async function flush(n = 20) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/** Advance the simulation clock by n ticks, flushing microtasks after each. */
async function advanceTicks(n) {
  for (let i = 0; i < n; i++) {
    simTimer.tick();
    await Promise.resolve();
  }
}

const SERVER_IP = '10.0.0.1';
const CLIENT_IP = '10.0.0.2';

/**
 * Two IPStacks joined by a link that delays frame delivery by a few
 * simulation ticks — unlike a synchronous direct wire, this reproduces the
 * propagation delay a real two-device topology has.
 * @param {number} delayTicks
 */
function makeDelayedNetworkPair(delayTicks) {
  const serverStack = new IPStack(1, 'server');
  const clientStack = new IPStack(1, 'client');

  serverStack.configureInterface(0, { ip: SERVER_IP, prefixLength: 24 });
  clientStack.configureInterface(0, { ip: CLIENT_IP, prefixLength: 24 });

  const itfS = serverStack.interfaces[0];
  const itfC = clientStack.interfaces[0];

  itfS.neighborCache.set(CLIENT_IP, itfC.mac.slice());
  itfC.neighborCache.set(SERVER_IP, itfS.mac.slice());

  const delayMs = delayTicks * SimTimer.SIM_MS_PER_TICK;

  itfS.sendFrame = (_mac, etherType, payload) => {
    if (etherType !== 0x0800) return;
    simTimer.schedule(() => {
      try { itfC.inQueue.push(IPv4Packet.fromBytes(payload)); itfC.doUpdate(); } catch (_) {}
    }, delayMs);
  };
  itfC.sendFrame = (_mac, etherType, payload) => {
    if (etherType !== 0x0800) return;
    simTimer.schedule(() => {
      try { itfS.inQueue.push(IPv4Packet.fromBytes(payload)); itfS.doUpdate(); } catch (_) {}
    }, delayMs);
  };

  return { serverStack, clientStack };
}

describe('ntpdate across a real (delayed) link', () => {
  it('receives the server reply and reports a numeric offset/delay', async () => {
    const { serverStack, clientStack } = makeDelayedNetworkPair(3);

    const serverOS = { net: serverStack, fs: { readFile() { throw new Error('no fs'); }, writeFile() {} }, exit() {}, dns: null, clock: new SystemClock() };
    const ntpServer = new NTPServerApp(serverOS);
    ntpServer._start();
    await flush(5);

    /** @type {string[]} */
    const lines = [];
    const clientOS = { net: clientStack, dns: null, clock: new SystemClock() };
    const ctx = {
      os: clientOS,
      signal: new AbortController().signal,
      println: (/** @type {string} */ s) => lines.push(s),
    };

    const resultPromise = ntpdate.run(/** @type {any} */ (ctx), [SERVER_IP]);

    await flush(5);
    await advanceTicks(60); // well past the 3-tick link delay in both directions

    await resultPromise;
    ntpServer._stop();

    // Locale dictionaries aren't loaded in this test environment, so t() falls
    // back to printing the raw "[[key]]" placeholder — which is actually
    // convenient here: it lets us assert on *which* code path ran without
    // depending on any particular translated string.
    const output = lines.join('\n');
    expect(output).not.toContain('[[app.terminal.commands.ntpdate.out.timeout]]');
    expect(output).toContain('[[app.terminal.commands.ntpdate.out.server]]');
    expect(output).toContain('[[app.terminal.commands.ntpdate.out.timestamps]]');
    expect(output).toContain('[[app.terminal.commands.ntpdate.out.result]]');
    expect(output).toContain('[[app.terminal.commands.ntpdate.out.stepped]]');
  });
});
