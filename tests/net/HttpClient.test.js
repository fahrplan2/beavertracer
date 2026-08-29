//@ts-check

import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  parseHttpUrl,
  httpRequest,
  HttpError,
} from '../../src/net/HttpClient.js';

const te = new TextEncoder();
const td = new TextDecoder();

/** Build a raw HTTP response as bytes. `lines` are the status + header lines. */
function resp(lines, body = '') {
  return te.encode(lines.join('\r\n') + '\r\n\r\n' + body);
}

/**
 * A one-shot transport that replays `chunks` (Uint8Array | Uint8Array[]) from
 * recv() and records everything written to send().
 */
function fakeTransport(chunks) {
  const queue = Array.isArray(chunks) ? chunks.slice() : [chunks];
  let i = 0;
  const sent = [];
  return {
    transport: {
      send: (b) => { sent.push(b); },
      recv: async () => (i < queue.length ? queue[i++] : null),
    },
    sentText: () => sent.map((b) => td.decode(b)).join(''),
  };
}

describe('parseHttpUrl', () => {
  it('splits scheme / host / port / path', () => {
    expect(parseHttpUrl('http://example.com/foo')).toEqual({
      ok: true, scheme: 'http', host: 'example.com', port: 80, path: '/foo',
    });
    expect(parseHttpUrl('https://example.com')).toEqual({
      ok: true, scheme: 'https', host: 'example.com', port: 443, path: '/',
    });
    expect(parseHttpUrl('http://10.0.0.1:8080/a/b')).toEqual({
      ok: true, scheme: 'http', host: '10.0.0.1', port: 8080, path: '/a/b',
    });
  });

  it('handles bracketed IPv6 with an optional port', () => {
    expect(parseHttpUrl('http://[2001:db8::1]:8080/x')).toEqual({
      ok: true, scheme: 'http', host: '2001:db8::1', port: 8080, path: '/x',
    });
  });

  it('rejects a missing scheme or empty host', () => {
    expect(parseHttpUrl('example.com').ok).toBe(false);
    expect(parseHttpUrl('http:///path').ok).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('adds http:// to a bare host but leaves an explicit scheme alone', () => {
    expect(normalizeUrl('example.com/x')).toBe('http://example.com/x');
    expect(normalizeUrl('http://a')).toBe('http://a');
    expect(normalizeUrl('https://a')).toBe('https://a'); // never upgraded, never downgraded
  });

  it('brackets a bare IPv6 literal', () => {
    expect(normalizeUrl('2001:db8::1')).toBe('http://[2001:db8::1]');
    expect(normalizeUrl('2001:db8::1/p')).toBe('http://[2001:db8::1]/p');
  });
});

describe('httpRequest', () => {
  it('sends a well-formed request line and parses a Content-Length body', async () => {
    const f = fakeTransport(resp(
      ['HTTP/1.1 200 OK', 'Content-Type: text/plain', 'Content-Length: 5'],
      'hello',
    ));
    const res = await httpRequest({
      transport: f.transport, method: 'GET', hostHeader: 'h', path: '/p', userAgent: 'x/1',
    });

    expect(f.sentText()).toBe(
      'GET /p HTTP/1.1\r\nHost: h\r\nUser-Agent: x/1\r\nAccept: */*\r\nConnection: close\r\n\r\n',
    );
    expect(res.statusCode).toBe(200);
    expect(res.reason).toBe('OK');
    expect(res.headers['content-type']).toBe('text/plain');
    expect(td.decode(res.body)).toBe('hello');
    expect(res.truncated).toBe(false);
  });

  it('decodes a chunked body (incl. trailing zero-chunk)', async () => {
    const f = fakeTransport(resp(
      ['HTTP/1.1 200 OK', 'Transfer-Encoding: chunked'],
      '5\r\nhello\r\n7\r\n, world\r\n0\r\n\r\n',
    ));
    const res = await httpRequest({ transport: f.transport, method: 'GET', hostHeader: 'h', path: '/' });
    expect(td.decode(res.body)).toBe('hello, world');
  });

  it('does not read a body for HEAD even when Content-Length is present', async () => {
    const f = fakeTransport(resp(
      ['HTTP/1.1 200 OK', 'Content-Length: 99'], // body deliberately absent
    ));
    const res = await httpRequest({ transport: f.transport, method: 'HEAD', hostHeader: 'h', path: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it('reassembles a response delivered across several recv() chunks', async () => {
    const full = resp(['HTTP/1.1 404 Not Found', 'Content-Length: 3'], 'nope');
    const res = await httpRequest({
      transport: fakeTransport([full.slice(0, 12), full.slice(12, 30), full.slice(30)]).transport,
      method: 'GET', hostHeader: 'h', path: '/missing',
    });
    expect(res.statusCode).toBe(404);
    expect(td.decode(res.body)).toBe('nop'); // Content-Length: 3
  });

  it('flags a body cut short by an early close as truncated', async () => {
    const f = fakeTransport(resp(
      ['HTTP/1.1 200 OK', 'Content-Length: 100'],
      'partial', // only 7 of 100 bytes, then EOF
    ));
    const res = await httpRequest({ transport: f.transport, method: 'GET', hostHeader: 'h', path: '/' });
    expect(res.truncated).toBe(true);
    expect(td.decode(res.body)).toBe('partial');
  });

  it('reads to connection close when no length is framed', async () => {
    const f = fakeTransport(resp(
      ['HTTP/1.1 200 OK', 'Content-Type: text/plain'],
      'streamed to EOF',
    ));
    const res = await httpRequest({ transport: f.transport, method: 'GET', hostHeader: 'h', path: '/' });
    expect(td.decode(res.body)).toBe('streamed to EOF');
    expect(res.truncated).toBe(false);
  });

  it('raises HttpError("send") when the transport write throws', async () => {
    const transport = {
      send: () => { throw new Error('pipe broken'); },
      recv: async () => null,
    };
    await expect(httpRequest({ transport, method: 'GET', hostHeader: 'h', path: '/' }))
      .rejects.toMatchObject({ name: 'HttpError', kind: 'send' });
  });

  it('emits request lines through onRequestLine, blank line last', async () => {
    const f = fakeTransport(resp(['HTTP/1.1 200 OK', 'Content-Length: 0']));
    const lines = [];
    await httpRequest({
      transport: f.transport, method: 'GET', hostHeader: 'h', path: '/',
      onRequestLine: (l) => lines.push(l),
    });
    expect(lines[0]).toBe('GET / HTTP/1.1');
    expect(lines.at(-1)).toBe('');
    expect(lines).toContain('Connection: close');
  });

  it('adds Content-Type + Content-Length for a request body', async () => {
    const f = fakeTransport(resp(['HTTP/1.1 200 OK', 'Content-Length: 0']));
    await httpRequest({
      transport: f.transport, method: 'POST', hostHeader: 'h', path: '/submit',
      body: te.encode('a=1&b=2'), contentType: 'application/x-www-form-urlencoded',
    });
    const sent = f.sentText();
    expect(sent).toContain('POST /submit HTTP/1.1');
    expect(sent).toContain('Content-Type: application/x-www-form-urlencoded');
    expect(sent).toContain('Content-Length: 7');
    expect(sent.endsWith('\r\n\r\na=1&b=2')).toBe(true);
  });
});
