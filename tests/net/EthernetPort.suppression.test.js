//@ts-check
import { describe, it, expect, afterEach } from 'vitest';
// Importing SimControl.js before any sim/*.js or net/*.js class breaks a
// circular-import cycle (SimulatedObject.js <-> SimControl.js <-> Link.js
// <-> EthernetPort.js -> WirelessPort.js) that otherwise throws — same
// workaround as tests/sim/Firewall.test.js.
import '../../src/SimControl.js';
import { EthernetPort } from '../../src/net/EthernetPort.js';
import { EthernetFrame } from '../../src/net/pdu/EthernetFrame.js';
import { setTrafficSuppressed } from '../../src/lib/CheckState.js';

/** @param {number[]} bytes */
const mac = (bytes) => new Uint8Array(bytes);
const SRC = mac([2, 0, 0, 0, 0, 1]);
const DST = mac([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

function frame() {
    return new EthernetFrame({ srcMac: SRC, dstMac: DST, etherType: 0x0800, payload: new Uint8Array(4) });
}

describe('EthernetPort + CheckState suppression', () => {
    afterEach(() => setTrafficSuppressed(false));

    it('send()/recieve() log frames normally when not suppressed', () => {
        const port = new EthernetPort('eth0');
        port.send(frame());
        port.recieve(frame().pack());
        expect(port.loggedFrames.length).toBe(2);
    });

    it('send()/recieve() still deliver the frame but skip logging while suppressed', () => {
        const port = new EthernetPort('eth0');
        setTrafficSuppressed(true);

        port.send(frame());
        port.recieve(frame().pack());

        expect(port.loggedFrames.length).toBe(0);
        // Delivery itself is unaffected — the check's traffic still happens.
        expect(port.outBuffer.length).toBe(1);
        expect(port.inBuffer.length).toBe(1);
    });

    it('resumes logging once suppression is turned back off', () => {
        const port = new EthernetPort('eth0');
        setTrafficSuppressed(true);
        port.send(frame());
        setTrafficSuppressed(false);
        port.send(frame());

        expect(port.loggedFrames.length).toBe(1);
    });
});
