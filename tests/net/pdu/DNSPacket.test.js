import { describe, it, expect } from 'vitest';
import { DNSPacket } from '../../../src/net/pdu/DNSPacket.js';

describe('DNSPacket constructor defaults', () => {
  it('defaults to qr=0 and empty record arrays', () => {
    const pkt = new DNSPacket({ rd: 0 });
    expect(pkt.qr).toBe(0);
    expect(pkt.questions).toEqual([]);
    expect(pkt.answers).toEqual([]);
    expect(pkt.authorities).toEqual([]);
    expect(pkt.additionals).toEqual([]);
  });

  it('rd defaults to 1 when not specified', () => {
    expect(new DNSPacket().rd).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Header serialization
// ─────────────────────────────────────────────────────────────────────────────

describe('DNSPacket.pack() — header', () => {
  it('produces exactly 12 bytes for an empty message', () => {
    expect(new DNSPacket({ rd: 0 }).pack().length).toBe(12);
  });

  it('writes id into bytes 0-1', () => {
    const bytes = new DNSPacket({ id: 0x1234, rd: 0 }).pack();
    expect((bytes[0] << 8) | bytes[1]).toBe(0x1234);
  });

  it('encodes QR=1 (response) in high bit of byte 2', () => {
    const bytes = new DNSPacket({ qr: 1, rd: 0 }).pack();
    expect((bytes[2] >> 7) & 0x01).toBe(1);
  });

  it('encodes RD flag in byte 2 bit 0', () => {
    const withRd = new DNSPacket({ rd: 1 }).pack();
    const withoutRd = new DNSPacket({ rd: 0 }).pack();
    expect(withRd[2] & 0x01).toBe(1);
    expect(withoutRd[2] & 0x01).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Question encoding
// ─────────────────────────────────────────────────────────────────────────────

describe('DNSPacket.pack() — question encoding', () => {
  it('encodes "example.com" as length-prefixed labels with null terminator', () => {
    const pkt = new DNSPacket({
      questions: [{ name: 'example.com', type: 1, cls: 1 }],
    });
    const bytes = pkt.pack();
    // After 12-byte header: \x07 e x a m p l e \x03 c o m \x00 type cls
    expect(bytes[12]).toBe(7);
    expect(String.fromCharCode(...bytes.slice(13, 20))).toBe('example');
    expect(bytes[20]).toBe(3);
    expect(String.fromCharCode(...bytes.slice(21, 24))).toBe('com');
    expect(bytes[24]).toBe(0); // root label
  });

  it('sets qdcount to 1 in bytes 4-5', () => {
    const pkt = new DNSPacket({ questions: [{ name: 'a.b', type: 1, cls: 1 }] });
    const bytes = pkt.pack();
    expect((bytes[4] << 8) | bytes[5]).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: query
// ─────────────────────────────────────────────────────────────────────────────

describe('round-trip: DNS query', () => {
  it('preserves id, rd, and questions[0].name through pack→fromBytes', () => {
    const original = new DNSPacket({
      id: 0xbeef,
      rd: 1,
      questions: [{ name: 'example.com', type: DNSPacket.TYPE_A, cls: DNSPacket.CLASS_IN }],
    });
    const parsed = DNSPacket.fromBytes(original.pack());
    expect(parsed.id).toBe(0xbeef);
    expect(parsed.rd).toBe(1);
    expect(parsed.questions.length).toBe(1);
    expect(parsed.questions[0].name).toBe('example.com');
    expect(parsed.questions[0].type).toBe(DNSPacket.TYPE_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: A record
// ─────────────────────────────────────────────────────────────────────────────

describe('round-trip: A record', () => {
  it('preserves 4-byte IPv4 RDATA through pack→fromBytes', () => {
    const rdata = new Uint8Array([192, 168, 1, 1]);
    const original = new DNSPacket({
      qr: 1,
      answers: [{ name: 'example.com', type: DNSPacket.TYPE_A, cls: DNSPacket.CLASS_IN, ttl: 300, data: rdata }],
    });
    const parsed = DNSPacket.fromBytes(original.pack());
    expect(parsed.answers.length).toBe(1);
    expect(Array.from(parsed.answers[0].data)).toEqual([192, 168, 1, 1]);
  });

  it('preserves TTL in the answer record', () => {
    const original = new DNSPacket({
      qr: 1,
      answers: [{ name: 'x.com', type: DNSPacket.TYPE_A, cls: DNSPacket.CLASS_IN, ttl: 3600, data: new Uint8Array(4) }],
    });
    const parsed = DNSPacket.fromBytes(original.pack());
    expect(parsed.answers[0].ttl).toBe(3600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: CNAME record
// ─────────────────────────────────────────────────────────────────────────────

describe('round-trip: CNAME record', () => {
  it('preserves CNAME target string through pack→fromBytes', () => {
    const original = new DNSPacket({
      qr: 1,
      answers: [{
        name: 'www.example.com',
        type: DNSPacket.TYPE_CNAME,
        cls: DNSPacket.CLASS_IN,
        ttl: 60,
        data: 'example.com',
      }],
    });
    const parsed = DNSPacket.fromBytes(original.pack());
    expect(parsed.answers[0].data).toBe('example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: AAAA record
// ─────────────────────────────────────────────────────────────────────────────

describe('round-trip: AAAA record', () => {
  it('preserves 16-byte IPv6 RDATA through pack→fromBytes', () => {
    const rdata = new Uint8Array(16).fill(0xab);
    const original = new DNSPacket({
      qr: 1,
      answers: [{ name: 'v6.example.com', type: DNSPacket.TYPE_AAAA, cls: DNSPacket.CLASS_IN, ttl: 600, data: rdata }],
    });
    const parsed = DNSPacket.fromBytes(original.pack());
    expect(parsed.answers[0].data.length).toBe(16);
    expect(Array.from(parsed.answers[0].data)).toEqual(Array.from(rdata));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Name compression (pointer following)
// ─────────────────────────────────────────────────────────────────────────────

describe('fromBytes() — name compression', () => {
  it('follows a 0xC0 pointer to resolve the compressed answer name', () => {
    // Build a query so we have a well-formed "example.com" name at offset 12.
    const query = new DNSPacket({
      id: 1, rd: 0,
      questions: [{ name: 'example.com', type: DNSPacket.TYPE_A, cls: DNSPacket.CLASS_IN }],
    });
    // query bytes: 12-byte header + 13-byte name + 4-byte type/class = 29 bytes total
    const qBytes = Array.from(query.pack());

    // Patch the header to make it a response with one answer.
    qBytes[2] |= 0x80; // QR=1
    qBytes[7] = 1;     // ancount = 1

    // Append an answer RR whose name is a pointer to offset 12 (the question name).
    const answer = [
      0xC0, 0x0C,                   // pointer → offset 12 = "example.com"
      0x00, 0x01,                   // type A
      0x00, 0x01,                   // class IN
      0x00, 0x00, 0x01, 0x2C,       // ttl 300
      0x00, 0x04,                   // rdlength 4
      0x0A, 0x00, 0x00, 0x01,       // 10.0.0.1
    ];

    const parsed = DNSPacket.fromBytes(new Uint8Array([...qBytes, ...answer]));
    expect(parsed.answers.length).toBe(1);
    expect(parsed.answers[0].name).toBe('example.com');
    expect(parsed.answers[0].type).toBe(DNSPacket.TYPE_A);
    expect(Array.from(parsed.answers[0].data)).toEqual([0x0A, 0x00, 0x00, 0x01]);
  });
});
