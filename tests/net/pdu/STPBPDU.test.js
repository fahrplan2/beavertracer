import { describe, it, expect } from 'vitest';
import { STPBPDU } from '../../../src/net/pdu/STPBPDU.js';

describe('STPBPDU pack', () => {
  it('TCN BPDU is 4 bytes', () => {
    expect(new STPBPDU({ bpduType: 0x80 }).pack().length).toBe(4);
  });

  it('Configuration BPDU is 35 bytes', () => {
    expect(new STPBPDU({ protocolVersion: 0, bpduType: 0x00 }).pack().length).toBe(35);
  });

  it('RST BPDU is 36 bytes with Version 1 Length = 0 (IEEE 802.1D-2004 §9.3.3)', () => {
    const out = new STPBPDU({ protocolVersion: 2, bpduType: 0x02, flags: 0x3c }).pack();
    expect(out.length).toBe(36);
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(0x02);
    expect(out[35]).toBe(0);
  });

  it('RST BPDU round-trips through fromBytes', () => {
    const out = new STPBPDU({ protocolVersion: 2, bpduType: 0x02, flags: 0x3c, portId: 0x8001 }).pack();
    const parsed = STPBPDU.fromBytes(out);
    expect(parsed.bpduType).toBe(0x02);
    expect(parsed.flags).toBe(0x3c);
    expect(parsed.portId).toBe(0x8001);
  });
});
