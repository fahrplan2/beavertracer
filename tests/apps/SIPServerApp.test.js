import { describe, it, expect } from 'vitest';
import { SIPServerApp } from '../../src/apps/SIPServerApp.js';

/**
 * The SIPServerApp UI needs a DOM; vitest runs in node here. The registrar /
 * proxy behaviour it drives is covered by tests/net/SipRegistrarProxy.test.js —
 * this only guards that the module resolves and exposes the expected surface.
 */
describe('SIPServerApp module', () => {
  it('exports a class with start/stop lifecycle', () => {
    expect(typeof SIPServerApp).toBe('function');
    expect(SIPServerApp.prototype.run).toBeTypeOf('function');
    expect(SIPServerApp.prototype._start).toBeTypeOf('function');
    expect(SIPServerApp.prototype._stop).toBeTypeOf('function');
    expect(SIPServerApp.prototype._recvLoop).toBeTypeOf('function');
  });
});
