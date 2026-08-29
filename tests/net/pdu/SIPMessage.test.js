import { describe, it, expect } from 'vitest';
import { SIPMessage } from '../../../src/net/pdu/SIPMessage.js';

const CRLF = '\r\n';

const INVITE = [
  'INVITE sip:bob@example.com SIP/2.0',
  'Via: SIP/2.0/UDP 10.0.0.1:5060;branch=z9hG4bK776asdhds',
  'Max-Forwards: 70',
  'To: Bob <sip:bob@example.com>',
  'From: Alice <sip:alice@example.com>;tag=1928301774',
  'Call-ID: a84b4c76e66710@10.0.0.1',
  'CSeq: 314159 INVITE',
  'Contact: <sip:alice@10.0.0.1>',
  'Content-Type: application/sdp',
  'Content-Length: 4',
  '',
  'v=0\r\n',
].join(CRLF);

describe('SIPMessage.parse — requests', () => {
  it('parses the request line', () => {
    const m = SIPMessage.parse(INVITE);
    expect(m.kind).toBe('request');
    expect(m.method).toBe('INVITE');
    expect(m.requestUri).toBe('sip:bob@example.com');
    expect(m.version).toBe('SIP/2.0');
  });

  it('exposes headers case-insensitively', () => {
    const m = SIPMessage.parse(INVITE);
    expect(m.getHeader('call-id')).toBe('a84b4c76e66710@10.0.0.1');
    expect(m.getHeader('CSEQ')).toBe('314159 INVITE');
  });

  it('honours Content-Length when slicing the body', () => {
    const m = SIPMessage.parse(INVITE);
    expect(m.bodyText).toBe('v=0\r'); // 4 bytes: v, =, 0, \r
  });

  it('parses CSeq and From/To tags via helpers', () => {
    const m = SIPMessage.parse(INVITE);
    expect(m.cseq).toEqual({ seq: 314159, method: 'INVITE' });
    expect(SIPMessage.tagOf(m.getHeader('From'))).toBe('1928301774');
    expect(SIPMessage.tagOf(m.getHeader('To'))).toBe(null);
    expect(m.topViaBranch).toBe('z9hG4bK776asdhds');
    expect(SIPMessage.uriOf(m.getHeader('To'))).toBe('sip:bob@example.com');
  });
});

describe('SIPMessage.parse — responses & multi-value headers', () => {
  it('parses a status line', () => {
    const m = SIPMessage.parse('SIP/2.0 200 OK' + CRLF + 'CSeq: 1 INVITE' + CRLF + CRLF);
    expect(m.kind).toBe('response');
    expect(m.statusCode).toBe(200);
    expect(m.reasonPhrase).toBe('OK');
  });

  it('keeps one entry per Via occurrence, in order', () => {
    const raw = [
      'SIP/2.0 200 OK',
      'Via: SIP/2.0/UDP proxy.example.com;branch=z9hG4bKaaa',
      'Via: SIP/2.0/UDP 10.0.0.1:5060;branch=z9hG4bKbbb',
      'CSeq: 1 INVITE',
      '', '',
    ].join(CRLF);
    const m = SIPMessage.parse(raw);
    expect(m.getHeaders('Via')).toEqual([
      'SIP/2.0/UDP proxy.example.com;branch=z9hG4bKaaa',
      'SIP/2.0/UDP 10.0.0.1:5060;branch=z9hG4bKbbb',
    ]);
  });

  it('splits a comma-separated Via list into separate entries', () => {
    const raw = [
      'SIP/2.0 200 OK',
      'Via: SIP/2.0/UDP proxy.example.com;branch=z9hG4bKaaa, SIP/2.0/UDP 10.0.0.1:5060;branch=z9hG4bKbbb',
      '', '',
    ].join(CRLF);
    const m = SIPMessage.parse(raw);
    expect(m.getHeaders('Via').length).toBe(2);
    expect(m.getHeaders('Via')[1]).toContain('z9hG4bKbbb');
  });

  it('expands compact header forms', () => {
    const raw = ['SIP/2.0 180 Ringing', 'i: xyz@host', 't: <sip:b@h>', 'v: SIP/2.0/UDP h;branch=x', '', ''].join(CRLF);
    const m = SIPMessage.parse(raw);
    expect(m.getHeader('Call-ID')).toBe('xyz@host');
    expect(m.getHeader('To')).toBe('<sip:b@h>');
    expect(m.getHeader('Via')).toBe('SIP/2.0/UDP h;branch=x');
  });

  it('unfolds continuation lines', () => {
    const raw = ['SIP/2.0 200 OK', 'Subject: hello', ' world', 'CSeq: 1 INVITE', '', ''].join(CRLF);
    const m = SIPMessage.parse(raw);
    expect(m.getHeader('Subject')).toBe('hello world');
  });
});

describe('SIPMessage serialize', () => {
  it('round-trips a request through pack()/parse()', () => {
    const m = SIPMessage.parse(INVITE);
    const again = SIPMessage.parse(m.pack());
    expect(again.method).toBe('INVITE');
    expect(again.getHeader('Call-ID')).toBe(m.getHeader('Call-ID'));
    expect(again.getHeaders('Via')).toEqual(m.getHeaders('Via'));
    expect([...again.body]).toEqual([...m.body]);
  });

  it('rewrites Content-Length to match the body on pack()', () => {
    const m = SIPMessage.request('MESSAGE', 'sip:b@h', [['Call-ID', 'x']], 'hello world');
    const text = m.toString();
    expect(text).toContain('Content-Length: 11');
    expect(text.endsWith('hello world')).toBe(true);
  });

  it('emits CRLF line endings and a blank line before the body', () => {
    const m = SIPMessage.response(486, 'Busy Here', [['Call-ID', 'x'], ['CSeq', '1 INVITE']]);
    const text = m.toString();
    expect(text.startsWith('SIP/2.0 486 Busy Here\r\n')).toBe(true);
    expect(text.endsWith('\r\n\r\n')).toBe(true);
  });

  it('prependHeader puts a new Via on top', () => {
    const m = SIPMessage.parse(INVITE);
    m.prependHeader('Via', 'SIP/2.0/UDP proxy:5060;branch=z9hG4bKnew');
    expect(m.getHeaders('Via')[0]).toContain('z9hG4bKnew');
    expect(m.topViaBranch).toBe('z9hG4bKnew');
  });
});
