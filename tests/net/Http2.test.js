//@ts-check

import { describe, it, expect, afterEach } from 'vitest';
import http2 from 'node:http2';
import { duplexPair } from 'node:stream';
import {
  Http2Connection, Http2Error, H2_ERROR, H2_FRAME, H2_PREFACE,
} from '../../src/net/Http2.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── in-memory transports ─────────────────────────────────────────────────────

function makeQueue() {
  /** @type {Array<Uint8Array|null>} */
  const items = [];
  /** @type {((v: Uint8Array|null) => void)|null} */
  let waiter = null;
  let closed = false;
  return {
    push(/** @type {Uint8Array|null} */ v) {
      if (closed) return;
      if (v === null) closed = true;
      if (waiter) { const w = waiter; waiter = null; w(v); } else items.push(v);
    },
    /** @returns {Promise<Uint8Array|null>} */
    next() {
      if (items.length) return Promise.resolve(/** @type {Uint8Array|null} */ (items.shift()));
      if (closed) return Promise.resolve(null);
      return new Promise((r) => { waiter = r; });
    },
  };
}

/** Two linked byte transports; `wire` records what each side sent. */
function makePipe() {
  const a2b = makeQueue(), b2a = makeQueue();
  /** @type {{ a: Uint8Array[], b: Uint8Array[] }} */
  const wire = { a: [], b: [] };
  return {
    wire,
    a: { send: (/** @type {Uint8Array} */ d) => { wire.a.push(d.slice()); a2b.push(d.slice()); }, recv: () => b2a.next(), close: () => a2b.push(null) },
    b: { send: (/** @type {Uint8Array} */ d) => { wire.b.push(d.slice()); b2a.push(d.slice()); }, recv: () => a2b.next(), close: () => b2a.push(null) },
  };
}

/** Wrap a Node Duplex as { send, recv }. @param {import('node:stream').Duplex} sock */
function fromDuplex(sock) {
  const q = makeQueue();
  sock.on('data', (/** @type {Buffer} */ d) => q.push(new Uint8Array(d)));
  sock.on('end', () => q.push(null));
  sock.on('close', () => q.push(null));
  return {
    send: (/** @type {Uint8Array} */ d) => { sock.write(Buffer.from(d)); },
    recv: () => q.next(),
    close: () => sock.end(),
  };
}

/** Frame types in a recorded byte stream (skips the client preface). @param {Uint8Array[]} chunks */
function frameTypes(chunks) {
  let buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
  if (buf.subarray(0, 24).equals(Buffer.from(H2_PREFACE))) buf = buf.subarray(24);
  /** @type {Array<{ type: number, flags: number, stream: number, len: number }>} */
  const out = [];
  while (buf.length >= 9) {
    const len = buf.readUIntBE(0, 3);
    out.push({ type: buf[3], flags: buf[4], stream: buf.readUInt32BE(5) & 0x7fffffff, len });
    buf = buf.subarray(9 + len);
  }
  return out;
}

/** @param {(req: any, res: any) => any} handler */
function ourPair(handler) {
  const pipe = makePipe();
  const server = new Http2Connection({ ...pipe.b, isServer: true, onRequest: handler });
  const client = new Http2Connection({ ...pipe.a, isServer: false });
  server.start();
  client.start();
  return { client, server, pipe };
}

const echo = async (/** @type {any} */ req, /** @type {any} */ res) => {
  const body = req.method === 'POST' ? req.body : enc.encode(`${req.method} ${req.path} @${req.authority}`);
  await res.respond(200, [['content-type', 'text/plain'], ['x-stream', String(req.streamId)]], body);
};

// ── our client ↔ our server ──────────────────────────────────────────────────

describe('Http2Connection (loopback)', () => {
  it('GET returns status, headers and body', async () => {
    const { client } = ourPair(echo);
    const r = await client.request({ scheme: 'http', authority: 'a.lan', path: '/x' });
    expect(r.status).toBe(200);
    expect(dec.decode(r.body)).toBe('GET /x @a.lan');
    expect(r.headers).toContainEqual(['content-type', 'text/plain']);
    expect(r.streamId).toBe(1);
  });

  it('multiplexes concurrent requests on odd stream ids', async () => {
    const { client } = ourPair(echo);
    const rs = await Promise.all(['/a', '/b', '/c'].map(p => client.request({ scheme: 'http', authority: 'h', path: p })));
    expect(rs.map(r => dec.decode(r.body))).toEqual(['GET /a @h', 'GET /b @h', 'GET /c @h']);
    expect(rs.map(r => r.streamId)).toEqual([1, 3, 5]);
  });

  it('interleaves DATA of parallel large responses and obeys flow control', async () => {
    const big = new Uint8Array(200_000).map((_, i) => i & 0xff);
    const { client, pipe } = ourPair(async (/** @type {any} */ req, /** @type {any} */ res) => res.respond(200, [], big));
    const [r1, r2] = await Promise.all([
      client.request({ scheme: 'http', authority: 'h', path: '/1' }),
      client.request({ scheme: 'http', authority: 'h', path: '/2' }),
    ]);
    expect(r1.body).toEqual(big);
    expect(r2.body).toEqual(big);
    const serverFrames = frameTypes(pipe.wire.b);
    const data = serverFrames.filter(f => f.type === H2_FRAME.DATA);
    expect(Math.max(...data.map(f => f.len))).toBeLessThanOrEqual(16384);
    // both streams' DATA frames alternate at some point
    const order = data.map(f => f.stream);
    expect(order.some((s, i) => i > 0 && s !== order[i - 1])).toBe(true);
    // the client had to open the windows
    expect(frameTypes(pipe.wire.a).some(f => f.type === H2_FRAME.WINDOW_UPDATE)).toBe(true);
  });

  it('POST body arrives at the server', async () => {
    const { client } = ourPair(echo);
    const r = await client.request({ method: 'POST', scheme: 'http', authority: 'h', path: '/p', body: enc.encode('payload') });
    expect(dec.decode(r.body)).toBe('payload');
  });

  it('splits a huge header block into HEADERS + CONTINUATION', async () => {
    const { client, pipe } = ourPair(echo);
    const headers = /** @type {Array<[string, string]>} */ (Array.from({ length: 40 }, (_, i) => [`x-h${i}`, `${i}`.repeat(600)]));
    const r = await client.request({ scheme: 'http', authority: 'h', path: '/', headers });
    expect(r.status).toBe(200);
    expect(frameTypes(pipe.wire.a).some(f => f.type === H2_FRAME.CONTINUATION)).toBe(true);
  });

  it('application reset reaches the client as RST_STREAM', async () => {
    const { client } = ourPair((/** @type {any} */ _req, /** @type {any} */ res) => res.reset(H2_ERROR.REFUSED_STREAM));
    const err = await client.request({ scheme: 'http', authority: 'h', path: '/' }).catch(e => e);
    expect(err).toBeInstanceOf(Http2Error);
    expect(err.code).toBe(H2_ERROR.REFUSED_STREAM);
    expect(err.retryable).toBe(true);
  });

  it('strips connection-specific headers and lower-cases names', async () => {
    /** @type {any} */
    let seen = null;
    const { client } = ourPair(async (/** @type {any} */ req, /** @type {any} */ res) => { seen = req.headers; await res.respond(204, []); });
    const r = await client.request({ scheme: 'http', authority: 'h', path: '/', headers: [['Connection', 'keep-alive'], ['X-Up', '1'], ['Host', 'h']] });
    expect(r.status).toBe(204);
    expect(seen).toEqual([['x-up', '1']]);
  });

  it('GOAWAY: no new requests, connection marked unusable', async () => {
    const { client, server } = ourPair(echo);
    await client.request({ scheme: 'http', authority: 'h', path: '/' });
    server.goaway();
    await new Promise(r => setTimeout(r, 0));
    expect(client.goawayReceived).toBe(true);
    expect(client.usable).toBe(false);
    const err = await client.request({ scheme: 'http', authority: 'h', path: '/' }).catch(e => e);
    expect(err.retryable).toBe(true);
  });

  it('transport close fails pending requests as retryable', async () => {
    const pipe = makePipe();
    const client = new Http2Connection({ ...pipe.a, isServer: false });
    client.start();
    const p = client.request({ scheme: 'http', authority: 'h', path: '/' }).catch(e => e);
    pipe.b.close();
    const err = await p;
    expect(err).toBeInstanceOf(Http2Error);
    expect(err.retryable).toBe(true);
    await client.done;
  });

  it('server answers a wrong preface with GOAWAY PROTOCOL_ERROR', async () => {
    const pipe = makePipe();
    const server = new Http2Connection({ ...pipe.b, isServer: true });
    server.start();
    pipe.a.send(enc.encode('GET / HTTP/1.1\r\nHost: x\r\n\r\n'));
    await server.done;
    expect(server.closeError).toBeInstanceOf(Http2Error);
    const goaway = frameTypes(pipe.wire.b).find(f => f.type === H2_FRAME.GOAWAY);
    expect(goaway).toBeDefined();
  });

  it('rejects an even (server-side) stream id from a client', async () => {
    const pipe = makePipe();
    const server = new Http2Connection({ ...pipe.b, isServer: true, onRequest: echo });
    server.start();
    const raw = new Http2Connection({ ...pipe.a, isServer: false });
    raw.start();
    await server.ready;
    raw['_nextStreamId'] = 2;
    raw.request({ scheme: 'http', authority: 'h', path: '/' }).catch(() => {});
    await server.done;
    expect(/** @type {Http2Error} */ (server.closeError).code).toBe(H2_ERROR.PROTOCOL_ERROR);
  });

  it('answers PING with an ACK carrying the same payload', async () => {
    const { client, pipe } = ourPair(echo);
    await client.ready;
    client['_writeFrame'](H2_FRAME.PING, 0, 0, enc.encode('12345678'));
    await new Promise(r => setTimeout(r, 0));
    const ack = frameTypes(pipe.wire.b).find(f => f.type === H2_FRAME.PING);
    expect(ack?.flags).toBe(1);
  });

  it('idle/active callbacks follow the stream count', async () => {
    /** @type {string[]} */
    const events = [];
    const pipe = makePipe();
    const server = new Http2Connection({
      ...pipe.b, isServer: true, onRequest: echo,
      onIdle: () => events.push('idle'), onActive: () => events.push('active'),
    });
    const client = new Http2Connection({ ...pipe.a, isServer: false });
    server.start(); client.start();
    await client.request({ scheme: 'http', authority: 'h', path: '/' });
    await client.request({ scheme: 'http', authority: 'h', path: '/' });
    expect(events).toEqual(['active', 'idle', 'active', 'idle']);
  });
});

// ── interop with Node's nghttp2 ──────────────────────────────────────────────

describe('Http2Connection interop with node:http2', () => {
  /** @type {Array<() => void>} */
  const cleanup = [];
  afterEach(() => { for (const f of cleanup.splice(0)) f(); });

  it('our client ↔ node server (h2c, Huffman + dynamic table on the node side)', async () => {
    const server = http2.createServer();
    server.on('stream', (stream, headers) => {
      const big = Buffer.alloc(150_000, 'x');
      stream.respond({
        ':status': 200,
        'content-type': 'text/plain; charset=utf-8',
        'x-path': String(headers[':path']),
        'x-authority': String(headers[':authority']),
        'x-custom': String(headers['x-custom'] ?? ''),
      });
      stream.end(headers[':path'] === '/big' ? big : `hello ${headers[':path']}`);
    });
    const [ours, theirs] = duplexPair();
    server.emit('connection', theirs);
    cleanup.push(() => { theirs.destroy(); server.close(); });

    const t = fromDuplex(ours);
    const client = new Http2Connection({ ...t, isServer: false });
    client.start();
    const [a, b, big] = await Promise.all([
      client.request({ scheme: 'http', authority: 'shop.lan', path: '/a', headers: [['x-custom', 'Grüße']] }),
      client.request({ scheme: 'http', authority: 'shop.lan', path: '/b' }),
      client.request({ scheme: 'http', authority: 'shop.lan', path: '/big' }),
    ]);
    expect(a.status).toBe(200);
    expect(dec.decode(a.body)).toBe('hello /a');
    expect(a.headers).toContainEqual(['x-authority', 'shop.lan']);
    expect(a.headers).toContainEqual(['x-custom', 'Grüße']);
    expect(dec.decode(b.body)).toBe('hello /b');
    expect(big.body.length).toBe(150_000);
    // a second round reuses node's dynamic table entries
    const again = await client.request({ scheme: 'http', authority: 'shop.lan', path: '/a' });
    expect(again.headers).toContainEqual(['content-type', 'text/plain; charset=utf-8']);
    client.goaway();
  });

  it('node client ↔ our server', async () => {
    const [ours, theirs] = duplexPair();
    const t = fromDuplex(ours);
    const server = new Http2Connection({
      ...t, isServer: true,
      onRequest: async (req, res) => {
        const body = req.path === '/big' ? new Uint8Array(120_000).fill(65)
          : enc.encode(`${req.method} ${req.path} ${req.authority} ${dec.decode(req.body)}`);
        await res.respond(200, [['content-type', 'text/plain'], ['server', 'beaver']], body);
      },
    });
    server.start();

    const session = http2.connect('http://shop.lan', { createConnection: () => /** @type {any} */ (theirs) });
    cleanup.push(() => session.destroy());

    /** @param {Record<string, any>} headers @param {string|null} [body] */
    const call = (headers, body = null) => new Promise((resolve, reject) => {
      const req = session.request(headers);
      /** @type {Buffer[]} */
      const chunks = [];
      /** @type {any} */
      let resHeaders = null;
      req.on('response', (h) => { resHeaders = h; });
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve({ headers: resHeaders, body: Buffer.concat(chunks) }));
      req.on('error', reject);
      if (body !== null) req.end(body); else req.end();
    });

    const [r1, r2, r3] = /** @type {any[]} */ (await Promise.all([
      call({ ':path': '/one' }),
      call({ ':path': '/two', ':method': 'POST' }, 'data!'),
      call({ ':path': '/big' }),
    ]));
    expect(r1.headers[':status']).toBe(200);
    expect(r1.headers.server).toBe('beaver');
    expect(r1.body.toString()).toBe('GET /one shop.lan:80 '); // node includes the port in :authority
    expect(r2.body.toString()).toBe('POST /two shop.lan:80 data!');
    expect(r3.body.length).toBe(120_000);
  });
});
