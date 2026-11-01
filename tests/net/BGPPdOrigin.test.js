//@ts-check

import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));
if (!globalThis.document) {
  // @ts-expect-error minimal stub
  globalThis.document = { createElement: () => ({ classList: { add() {} }, style: {}, appendChild() {}, addEventListener() {}, setAttribute() {} }) };
}
const { BGPDaemon } = await import('../../src/net/BGPDaemon.js');
const { Router } = await import('../../src/sim/Router.js');
const { IPAddress } = await import('../../src/net/models/IPAddress.js');

describe('BGP originates the DHCPv6-PD pool', () => {
  it('extra origins are announced next to connected networks (no duplicates)', () => {
    const d = new BGPDaemon(/** @type {any} */ ({ interfaces: [] }));
    const pool = { dst: IPAddress.fromString('2001:db8:100::'), prefLen: 48 };
    d.extraOrigins = () => [pool, pool];
    expect(d._connectedPrefixes().map(p => `${p.dst}/${p.prefLen}`)).toEqual(['2001:db8:100::/48']);
  });

  it('a router with PD enabled offers its pool as aggregate (pool address masked)', () => {
    const r = /** @type {any} */ ({ _pd6Enabled: true, _pd6Pool: IPAddress.fromString('2001:db8:100::1'), _pd6PoolLength: 48 });
    expect(Router.prototype._pd6Origins.call(r).map((/** @type {any} */ p) => `${p.dst}/${p.prefLen}`)).toEqual(['2001:db8:100::/48']);
    r._pd6Enabled = false;
    expect(Router.prototype._pd6Origins.call(r)).toEqual([]);
  });
});
