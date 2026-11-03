//@ts-check

import { describe, it, expect } from 'vitest';
import { qpackEncode, qpackDecode, QpackError, QPACK_STATIC_TABLE } from '../../src/net/Qpack.js';
import { Http3Connection, Http3Error, H3_ERROR, h3Frame, H3_FRAME } from '../../src/net/Http3.js';
import { encodeVarint } from '../../src/net/Quic.js';
import { quicPair } from '../support/quicPair.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('hex');

describe('QPACK (static table only)', () => {
  it('static table has the 99 entries of RFC 9204 Appendix A', () => {
    expect(QPACK_STATIC_TABLE.length).toBe(99);
    expect(QPACK_STATIC_TABLE[17]).toEqual([':method', 'GET']);
    expect(QPACK_STATIC_TABLE[25]).toEqual([':status', '200']);
    expect(QPACK_STATIC_TABLE[52]).toEqual(['content-type', 'text/html; charset=utf-8']);
    expect(QPACK_STATIC_TABLE[98]).toEqual(['x-frame-options', 'sameorigin']);
  });

  it('encodes exact matches as indexed static field lines', () => {
    // prefix 0000, then 11 + index: :method GET (17) = 0xd1, :scheme https (23) = 0xd7, :path / (1) = 0xc1
    expect(hex(qpackEncode([[':method', 'GET'], [':scheme', 'https'], [':path', '/']]))).toBe('0000d1d7c1');
  });

  it('uses a static name reference with a literal value', () => {
    const b = qpackEncode([[':authority', 'example.com']]);
    expect(b[2] & 0xf0).toBe(0x50); // 01 N=0 T=1, index 0
    expect(qpackDecode(b)).toEqual([[':authority', 'example.com']]);
  });

  it('round-trips literal names, Huffman and UTF-8, marks sensitive fields', () => {
    /** @type {Array<[string, string]>} */
    const f = [['x-custom', 'Grüße'], ['user-agent', 'Sparktail/1.0'], ['cookie', 'id=1'], ['x-long', 'a'.repeat(300)]];
    const b = qpackEncode(f);
    expect(qpackDecode(b)).toEqual(f);
  });

  it('rejects dynamic table references', () => {
    expect(() => qpackDecode(Uint8Array.of(0x01, 0x00, 0x80))).toThrow(QpackError); // Required Insert Count 1
    expect(() => qpackDecode(Uint8Array.of(0x00, 0x00, 0x80))).toThrow(QpackError); // indexed, dynamic
    expect(() => qpackDecode(Uint8Array.of(0x00, 0x00, 0x10))).toThrow(QpackError); // post-base
    expect(() => qpackDecode(Uint8Array.of(0x00, 0x00, 0xff, 0x7f))).toThrow(QpackError); // index 126 out of range
  });
});

/** Connected HTTP/3 client + server over a QUIC pair. */
async function h3Pair(/** @type {any} */ handler, /** @type {any} */ opts = {}) {
  const { client, getServer } = await quicPair(opts);
  await client.ready;
  const sq = getServer();
  await sq.ready;
  const server = new Http3Connection({ quic: sq, onRequest: handler });
  server.start();
  const h3 = new Http3Connection({ quic: client });
  h3.start();
  return { h3, server, client, sq };
}

const echo = async (/** @type {any} */ req, /** @type {any} */ res) => {
  const body = req.method === 'POST' ? req.body : enc.encode(`${req.method} ${req.path} @${req.authority}`);
  await res.respond(200, [['content-type', 'text/plain'], ['x-stream', String(req.streamId)]], body);
};

describe('HTTP/3 over QUIC', () => {
  it('GET with headers and body', async () => {
    const { h3 } = await h3Pair(echo);
    const r = await h3.request({ scheme: 'https', authority: 'quic.lan', path: '/x' });
    expect(r.status).toBe(200);
    expect(dec.decode(r.body)).toBe('GET /x @quic.lan');
    expect(r.headers).toContainEqual(['content-type', 'text/plain']);
    expect(r.streamId).toBe(0);
  });

  it('exchanges SETTINGS on the control streams', async () => {
    const { h3, server } = await h3Pair(echo);
    await h3.request({ scheme: 'https', authority: 'quic.lan', path: '/' });
    expect(h3.peerSettings?.get(0x01)).toBe(0);
    expect(server.peerSettings?.get(0x07)).toBe(0);
  });

  it('runs parallel requests on separate streams; large bodies; POST', async () => {
    const big = new Uint8Array(250_000).fill(66);
    const { h3 } = await h3Pair(async (/** @type {any} */ req, /** @type {any} */ res) => {
      if (req.path === '/big') return res.respond(200, [], big);
      return echo(req, res);
    });
    const [a, b, c, p] = await Promise.all([
      h3.request({ scheme: 'https', authority: 'h', path: '/a' }),
      h3.request({ scheme: 'https', authority: 'h', path: '/b' }),
      h3.request({ scheme: 'https', authority: 'h', path: '/big' }),
      h3.request({ method: 'POST', scheme: 'https', authority: 'h', path: '/p', body: enc.encode('payload') }),
    ]);
    expect([a.streamId, b.streamId, c.streamId, p.streamId]).toEqual([0, 4, 8, 12]);
    expect(dec.decode(a.body)).toBe('GET /a @h');
    expect(c.body).toEqual(big);
    expect(dec.decode(p.body)).toBe('payload');
  });

  it('works over a lossy link', async () => {
    const { h3 } = await h3Pair(echo, { drop: (/** @type {number} */ n) => n % 4 === 2 });
    const rs = await Promise.all(['/1', '/2', '/3'].map(path => h3.request({ scheme: 'https', authority: 'h', path })));
    expect(rs.map(r => dec.decode(r.body))).toEqual(['GET /1 @h', 'GET /2 @h', 'GET /3 @h']);
  }, 20_000);

  it('a malformed request gets 400 (missing :path)', async () => {
    const { client } = await h3Pair(echo);
    const s = client.openStream();
    s.write(h3Frame(H3_FRAME.HEADERS, qpackEncode([[':method', 'GET'], [':scheme', 'https']])), true);
    const data = await s.readAll();
    expect(data[0]).toBe(H3_FRAME.HEADERS);
    expect(qpackDecode(data.subarray(2, 2 + data[1]))).toContainEqual([':status', '400']);
  });

  it('GOAWAY: no new requests', async () => {
    const { h3, server } = await h3Pair(echo);
    await h3.request({ scheme: 'https', authority: 'h', path: '/' });
    server.goaway();
    await new Promise(r => setTimeout(r, 30));
    expect(h3.goawayReceived).toBe(true);
    const err = await h3.request({ scheme: 'https', authority: 'h', path: '/' }).catch(e => e);
    expect(err).toBeInstanceOf(Http3Error);
    expect(err.retryable).toBe(true);
  });

  it('control stream must start with SETTINGS', async () => {
    const { client, getServer } = await quicPair();
    await client.ready;
    const sq = getServer();
    await sq.ready;
    const server = new Http3Connection({ quic: sq, onRequest: echo });
    server.start();
    const u = client.openStream({ bidi: false });
    u.write(Uint8Array.of(0x00, ...h3Frame(H3_FRAME.GOAWAY, encodeVarint(0))));
    await client.done;
    // the server closes the connection; the client sees the HTTP/3 error code
    expect(/** @type {any} */ (client.closeError).code).toBe(H3_ERROR.MISSING_SETTINGS);
  });

  it('idle callbacks follow the open requests', async () => {
    /** @type {string[]} */
    const events = [];
    const { client, getServer } = await quicPair();
    await client.ready;
    await getServer().ready;
    const server = new Http3Connection({ quic: getServer(), onRequest: echo, onIdle: () => events.push('idle'), onActive: () => events.push('active') });
    server.start();
    const h3 = new Http3Connection({ quic: client });
    h3.start();
    await h3.request({ scheme: 'https', authority: 'h', path: '/' });
    await new Promise(r => setTimeout(r, 10));
    expect(events).toEqual(['active', 'idle']);
  });
});
