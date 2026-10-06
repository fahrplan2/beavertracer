//@ts-check

/**
 * Ctrl+C during ping: an aborted icmpEcho must reject right away and leave
 * nothing pending, so a late ARP failure/timeout can't fire into the terminal.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/SimControl.js', () => ({ SimControl: class SimControl {} }));

import { IPStack } from '../../src/net/IPStack.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

describe('IPStack.icmpEcho abort', () => {
    it('rejects with AbortError and clears the pending echo when the signal aborts', async () => {
        const s = new IPStack(1, 'A');
        s.configureInterface(0, { ip: '10.0.0.1', prefixLength: 24 });
        s.interfaces[0].sendFrame = () => {}; // ARP request goes nowhere

        const ac = new AbortController();
        const p = s.icmpEcho(IPAddress.fromString('10.0.0.99'), { timeoutMs: 60_000, signal: ac.signal });
        expect(s._pendingEcho.size).toBe(1);

        ac.abort();
        await expect(p).rejects.toMatchObject({ name: 'AbortError' });
        expect(s._pendingEcho.size).toBe(0);
    });

    it('rejects immediately if the signal is already aborted', async () => {
        const s = new IPStack(1, 'A');
        s.configureInterface(0, { ip: '10.0.0.1', prefixLength: 24 });
        s.interfaces[0].sendFrame = () => {};

        const ac = new AbortController();
        ac.abort();
        await expect(s.icmpEcho(IPAddress.fromString('10.0.0.99'), { signal: ac.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(s._pendingEcho.size).toBe(0);
    });
});
