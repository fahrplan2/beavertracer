//@ts-check

/**
 * DNS HTTPS/SVCB records (RFC 9460): wire format and presentation format,
 * checked against an RFC example and against Wireshark.
 */

import { describe, it, expect } from 'vitest';
import { encodeSvcb, decodeSvcb, formatSvcb, parseSvcParams } from '../../src/net/pdu/Svcb.js';
import { DNSPacket } from '../../src/net/pdu/DNSPacket.js';
import { dissectUdp } from '../support/wiregasm.js';

const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('hex');
const writeName = (/** @type {string} */ n) => DNSPacket._writeName(n);
const readName = (/** @type {Uint8Array} */ b, /** @type {number} */ o) => DNSPacket._readName(b, o);

describe('SVCB / HTTPS RDATA', () => {
  it('matches the RFC 9460 Appendix D.2 example "1 foo.example.com. port=53"', () => {
    const wire = encodeSvcb({ priority: 1, target: 'foo.example.com', params: { port: 53 } }, writeName);
    expect(hex(wire)).toBe('0001' + '03666f6f076578616d706c6503636f6d00' + '000300020035');
  });

  it('AliasMode "0 foo.example.com." has no parameters', () => {
    const wire = encodeSvcb({ priority: 0, target: 'foo.example.com', params: {} }, writeName);
    expect(hex(wire)).toBe('0000' + '03666f6f076578616d706c6503636f6d00');
    expect(() => encodeSvcb({ priority: 0, target: 'x.y', params: { port: 1 } }, writeName)).toThrow();
  });

  it('round-trips a real-world record (cloudflare.com)', () => {
    const d = {
      priority: 1, target: '.',
      params: { alpn: ['h3', 'h2'], ipv4hint: ['104.16.132.229', '104.16.133.229'], ipv6hint: ['2606:4700::6810:84e5', '2606:4700::6810:85e5'] },
    };
    const back = decodeSvcb(encodeSvcb(d, writeName), readName);
    expect(back).toEqual(d);
    expect(formatSvcb(back)).toBe('1 . alpn="h3,h2" ipv4hint=104.16.132.229,104.16.133.229 ipv6hint=2606:4700::6810:84e5,2606:4700::6810:85e5');
  });

  it('writes SvcParams in increasing key order, rejects bad order on input', () => {
    const wire = encodeSvcb({ priority: 1, target: '.', params: { port: 8443, alpn: ['h3'] } }, writeName);
    // alpn (1) before port (3)
    expect(hex(wire.subarray(3, 5))).toBe('0001');
    const swapped = Uint8Array.from([0, 1, 0, 0, 3, 0, 2, 0x20, 0xfb, 0, 1, 0, 3, 2, 0x68, 0x33]);
    expect(() => decodeSvcb(swapped, readName)).toThrow(/order/);
  });

  it('parses the server-side input syntax', () => {
    expect(parseSvcParams('alpn=h3,h2 port=443')).toEqual({ alpn: ['h3', 'h2'], port: 443 });
    expect(parseSvcParams('alpn="h3" no-default-alpn')).toEqual({ alpn: ['h3'], 'no-default-alpn': true });
    expect(parseSvcParams('')).toEqual({});
    expect(() => parseSvcParams('port=99999')).toThrow();
    expect(() => parseSvcParams('ipv4hint=2001:db8::1')).toThrow(/family/);
    expect(() => parseSvcParams('bogus=1')).toThrow(/unknown/);
    expect(() => parseSvcParams('port=1 port=2')).toThrow(/duplicate/);
  });

  it('DNSPacket carries HTTPS records in both directions', () => {
    const data = { priority: 1, target: '.', params: { alpn: ['h3', 'h2'], port: 443 } };
    const p = new DNSPacket({
      id: 7, qr: 1, aa: 1,
      questions: [{ name: 'www.beaver.lan', type: DNSPacket.TYPE_HTTPS, cls: 1 }],
      answers: [{ name: 'www.beaver.lan', type: DNSPacket.TYPE_HTTPS, cls: 1, ttl: 300, data }],
    });
    const back = DNSPacket.fromBytes(p.pack());
    expect(back.answers[0].data).toEqual(data);
  });

  it('Wireshark decodes our HTTPS answer without errors', async () => {
    const q = new DNSPacket({ id: 7, qr: 0, questions: [{ name: 'www.beaver.lan', type: DNSPacket.TYPE_HTTPS, cls: 1 }] });
    const r = new DNSPacket({
      id: 7, qr: 1, aa: 1,
      questions: [{ name: 'www.beaver.lan', type: DNSPacket.TYPE_HTTPS, cls: 1 }],
      answers: [{ name: 'www.beaver.lan', type: DNSPacket.TYPE_HTTPS, cls: 1, ttl: 300,
        data: { priority: 1, target: '.', params: { alpn: ['h3', 'h2'], port: 443, ipv4hint: ['10.0.0.1'] } } }],
    });
    const { frames } = await dissectUdp([{ dir: 'c2s', bytes: q.pack() }, { dir: 's2c', bytes: r.pack() }], { serverPort: 53 });
    const answer = frames[1].join('\n');
    expect(answer).toMatch(/Protocols in frame: raw:ip:udp:dns/);
    expect(answer).toMatch(/Type: HTTPS/);
    expect(answer).toMatch(/alpn/i);
    expect(answer).toMatch(/h3/);
    expect(answer).toMatch(/443/);
    expect(answer).toMatch(/10\.0\.0\.1/);
    expect(answer).not.toMatch(/Malformed|Expert Info \(Error/);
  }, 30_000);
});
