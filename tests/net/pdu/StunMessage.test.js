//@ts-check

import { describe, it, expect } from 'vitest';
import { StunMessage } from '../../../src/net/pdu/StunMessage.js';

describe('StunMessage — Binding Request', () => {
  it('packs a well-formed 20-byte header with the magic cookie', () => {
    const req = StunMessage.bindingRequest();
    const bytes = req.pack();
    expect(bytes.length).toBe(20);
    expect((bytes[0] << 8) | bytes[1]).toBe(StunMessage.TYPE_BINDING_REQUEST);
    expect(((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0).toBe(0x2112A442);
  });

  it('round-trips type and transaction ID through fromBytes', () => {
    const req = StunMessage.bindingRequest();
    const parsed = StunMessage.fromBytes(req.pack());
    expect(parsed.type).toBe(StunMessage.TYPE_BINDING_REQUEST);
    expect(parsed.transactionId).toEqual(req.transactionId);
  });

  it('generates a fresh random transaction ID per instance', () => {
    const a = StunMessage.bindingRequest();
    const b = StunMessage.bindingRequest();
    expect(a.transactionId).not.toEqual(b.transactionId);
  });

  it('rejects bytes without the STUN magic cookie', () => {
    const bogus = new Uint8Array(20); // all zero — cookie mismatch
    expect(() => StunMessage.fromBytes(bogus)).toThrow(/magic cookie/);
  });

  it('rejects bytes shorter than a STUN header', () => {
    expect(() => StunMessage.fromBytes(new Uint8Array(10))).toThrow();
  });
});

describe('StunMessage — Binding Success (XOR-MAPPED-ADDRESS)', () => {
  it('encodes and decodes the observed IPv4 address and port', () => {
    const req = StunMessage.bindingRequest();
    const resp = StunMessage.bindingSuccess(req.transactionId, '203.0.113.42', 54321);

    const parsed = StunMessage.fromBytes(resp.pack());
    expect(parsed.isSuccess).toBe(true);
    expect(parsed.transactionId).toEqual(req.transactionId);
    expect(parsed.xorMappedAddress).toEqual({ ip: '203.0.113.42', port: 54321 });
  });

  it('XORs the address on the wire — it is not the plain bytes', () => {
    const resp = StunMessage.bindingSuccess(StunMessage.bindingRequest().transactionId, '10.0.0.1', 5060);
    const bytes = resp.pack();
    // XOR-MAPPED-ADDRESS attribute value starts at byte 24 (20 header + 4 attr header);
    // its address bytes (offset 4..8 within the value) must differ from the plain IP octets.
    const addrBytes = bytes.slice(28, 32);
    expect(Array.from(addrBytes)).not.toEqual([10, 0, 0, 1]);
  });

  it('replies with different transaction IDs producing the same decoded address', () => {
    const respA = StunMessage.bindingSuccess(new Uint8Array(12).fill(1), '198.51.100.7', 1024);
    const respB = StunMessage.bindingSuccess(new Uint8Array(12).fill(2), '198.51.100.7', 1024);
    expect(StunMessage.fromBytes(respA.pack()).xorMappedAddress).toEqual(StunMessage.fromBytes(respB.pack()).xorMappedAddress);
  });
});

describe('StunMessage — Binding Error', () => {
  it('encodes and decodes an ERROR-CODE attribute', () => {
    const req = StunMessage.bindingRequest();
    const err = StunMessage.bindingError(req.transactionId, 400, 'Bad Request');
    const parsed = StunMessage.fromBytes(err.pack());

    expect(parsed.isError).toBe(true);
    expect(parsed.errorCode).toEqual({ code: 400, reason: 'Bad Request' });
  });
});

describe('StunMessage — attribute padding', () => {
  it('pads odd-length attribute values to a 4-byte boundary on the wire', () => {
    const msg = new StunMessage({ type: StunMessage.TYPE_BINDING_ERROR, transactionId: new Uint8Array(12) });
    msg.attributes.push({ type: 0x8022 /* SOFTWARE */, value: new Uint8Array([0x41, 0x42, 0x43]) }); // 3 bytes → 1 pad byte
    const bytes = msg.pack();
    expect(bytes.length).toBe(20 + 4 + 4); // header + attr-header + padded-to-4 value

    const parsed = StunMessage.fromBytes(bytes);
    expect(parsed.attributes).toHaveLength(1);
    expect(parsed.attributes[0].value).toEqual(new Uint8Array([0x41, 0x42, 0x43]));
  });
});
