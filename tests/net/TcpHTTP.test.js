//@ts-check

/**
 * Integration tests for the TCP engine using a minimal HTTP-over-loopback setup.
 *
 * These tests operate at the same API level that real apps use:
 * openServer / accept / connect / send / recv / close.
 * No UI, OS or VirtualFileSystem dependencies are needed.
 *
 * The synchronous loopback delivers packets immediately during each send/handle
 * call. Async/await scheduling then interleaves the client and server coroutines
 * in a natural request/response order.
 */

import { describe, it, expect } from 'vitest';
import { TcpEngine } from '../../src/net/TcpEngine.js';
import { TCPPacket } from '../../src/net/pdu/TCPPacket.js';
import { IPAddress } from '../../src/net/models/IPAddress.js';

const CLIENT_IP = IPAddress.fromString('10.0.0.1');
const SERVER_IP = IPAddress.fromString('10.0.0.2');
const BIND_ALL  = IPAddress.fromString('0.0.0.0');
const HTTP_PORT = 80;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ─────────────────────────────────────────────────────────────────────────────
// Loopback infrastructure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async loopback: packets are delivered via microtasks (Promise.resolve().then())
 * rather than synchronously during the send call. This ensures that conn.myacc
 * is always updated before incoming ACKs are processed, which allows _onAck to
 * fire correctly and cwnd to grow via Slow Start — enabling multi-segment transfers.
 *
 * @returns {{ client: TcpEngine, server: TcpEngine, log: {from:'client'|'server', tcp:TCPPacket}[] }}
 */
function makeLoopback() {
  /** @type {{from:'client'|'server', tcp:TCPPacket}[]} */
  const log = [];

  const client = new TcpEngine({
    ipSend: ({ dst, src, payload }) => {
      log.push({ from: 'client', tcp: TCPPacket.fromBytes(payload) });
      Promise.resolve().then(() => server.handle({ src, dst, payload }));
    },
    resolveSrcIp: () => CLIENT_IP,
  });

  const server = new TcpEngine({
    ipSend: ({ dst, src, payload }) => {
      log.push({ from: 'server', tcp: TCPPacket.fromBytes(payload) });
      Promise.resolve().then(() => client.handle({ src, dst, payload }));
    },
    resolveSrcIp: () => SERVER_IP,
  });

  return { client, server, log };
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Receive all data until EOF and return as one concatenated Uint8Array. */
async function recvAll(engine, key) {
  const parts = [];
  while (true) {
    const chunk = await engine.recv(key);
    if (!chunk) break;
    parts.push(chunk);
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** Receive chunks until the accumulated bytes contain `marker`. */
async function recvUntil(engine, key, marker) {
  const parts = [];
  while (true) {
    const chunk = await engine.recv(key);
    if (!chunk) break;
    parts.push(chunk);
    const total = parts.reduce((s, p) => s + p.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { buf.set(p, off); off += p.length; }
    if (dec.decode(buf).includes(marker)) return buf;
  }
  // EOF before marker
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  return buf;
}

/**
 * Parse an HTTP response.
 * @param {Uint8Array} bytes
 * @returns {{ status: number, headers: Record<string,string>, body: string }}
 */
function parseResponse(bytes) {
  const text = dec.decode(bytes);
  const sep = text.indexOf('\r\n\r\n');
  const headerBlock = text.slice(0, sep);
  const body = text.slice(sep + 4);
  const lines = headerBlock.split('\r\n');
  const status = parseInt(lines[0].split(' ')[1]);
  /** @type {Record<string,string>} */
  const headers = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status, headers, body };
}

/**
 * Parse an HTTP request (headers only).
 * @param {Uint8Array} bytes
 * @returns {{ method: string, path: string, headers: Record<string,string> }}
 */
function parseRequest(bytes) {
  const text = dec.decode(bytes);
  const sep = text.indexOf('\r\n\r\n');
  const lines = text.slice(0, sep).split('\r\n');
  const [method, path] = lines[0].split(' ');
  /** @type {Record<string,string>} */
  const headers = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { method, path, headers };
}

/**
 * Serve a single HTTP connection.
 * Reads until end-of-headers, calls handler, sends response, closes.
 * @param {TcpEngine} engine
 * @param {(req: {method:string, path:string, headers:Record<string,string>}) => {status?:number, body:string}} handler
 */
async function serveOne(engine, handler) {
  const key = await engine.accept(HTTP_PORT);
  if (!key) return;

  const reqBytes = await recvUntil(engine, key, '\r\n\r\n');
  const req = parseRequest(reqBytes);

  const { status = 200, body } = handler(req);
  const statusText = status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Error';
  const bodyBytes = enc.encode(body);
  const responseHeader = `HTTP/1.1 ${status} ${statusText}\r\nContent-Length: ${bodyBytes.length}\r\nConnection: close\r\n\r\n`;

  const response = new Uint8Array(enc.encode(responseHeader).length + bodyBytes.length);
  response.set(enc.encode(responseHeader));
  response.set(bodyBytes, enc.encode(responseHeader).length);

  engine.send(key, response);
  engine.close(key);
}

/**
 * Perform a GET request and return the parsed response.
 * @param {TcpEngine} engine
 * @param {string} path
 */
async function get(engine, path) {
  const conn = await engine.connect(SERVER_IP, HTTP_PORT);
  engine.send(conn.key, enc.encode(`GET ${path} HTTP/1.1\r\nHost: server\r\nConnection: close\r\n\r\n`));
  const bytes = await recvAll(engine, conn.key);
  engine.close(conn.key);
  return parseResponse(bytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('HTTP over TCP loopback', () => {
  it('GET / returns 200 with the correct body', async () => {
    const { client, server } = makeLoopback();
    server.openServer(BIND_ALL, HTTP_PORT);

    const [, response] = await Promise.all([
      serveOne(server, () => ({ body: 'Hello, World!' })),
      get(client, '/'),
    ]);

    expect(response.status).toBe(200);
    expect(response.body).toBe('Hello, World!');
  });

  it('server routes requests by path', async () => {
    const { client, server } = makeLoopback();
    server.openServer(BIND_ALL, HTTP_PORT);

    const routes = {
      '/foo': 'response for foo',
      '/bar': 'response for bar',
    };

    // Two concurrent connections — avoids sequential teardown ordering issues
    // with the async loopback while still verifying independent path routing.
    const results = await Promise.all(
      Object.entries(routes).map(([path]) =>
        Promise.all([
          serveOne(server, req => ({ body: routes[req.path] ?? 'not found' })),
          get(client, path),
        ])
      )
    );

    for (const [i, [path]] of Object.entries(routes).entries()) {
      expect(results[i][1].body).toBe(routes[path]);
    }
  });

  it('404 response is delivered intact', async () => {
    const { client, server } = makeLoopback();
    server.openServer(BIND_ALL, HTTP_PORT);

    const [, response] = await Promise.all([
      serveOne(server, req => ({
        status: req.path === '/' ? 200 : 404,
        body: req.path === '/' ? 'ok' : 'Not Found',
      })),
      get(client, '/missing'),
    ]);

    expect(response.status).toBe(404);
    expect(response.body).toBe('Not Found');
  });

  it('large response body (> MSS) is reassembled correctly at the client', async () => {
    const { client, server, log } = makeLoopback();
    server.openServer(BIND_ALL, HTTP_PORT);

    // 3 KB body — forces at least 6 TCP segments at MSS=512
    const body = 'A'.repeat(3072);

    const [, response] = await Promise.all([
      serveOne(server, () => ({ body })),
      get(client, '/large'),
    ]);

    expect(response.status).toBe(200);
    expect(response.body).toBe(body);
    expect(response.body.length).toBe(3072);

    // Verify that the transfer actually required multiple segments
    const dataSegs = log.filter(e => e.from === 'server' && e.tcp.payload.length > 0);
    expect(dataSegs.length).toBeGreaterThan(1);
    dataSegs.forEach(seg => expect(seg.tcp.payload.length).toBeLessThanOrEqual(512));
  });

  it('Content-Length header matches the actual body length', async () => {
    const { client, server } = makeLoopback();
    server.openServer(BIND_ALL, HTTP_PORT);

    const body = 'x'.repeat(1000);

    const [, response] = await Promise.all([
      serveOne(server, () => ({ body })),
      get(client, '/'),
    ]);

    expect(parseInt(response.headers['content-length'])).toBe(body.length);
    expect(response.body.length).toBe(body.length);
  });

  it('multiple concurrent connections each complete independently', async () => {
    const { client, server } = makeLoopback();
    server.openServer(BIND_ALL, HTTP_PORT);

    // Three connections in parallel — each serveOne and get pair runs concurrently.
    // acceptWaiters are registered before the SYNs arrive, so ordering is deterministic.
    const results = await Promise.all(
      [1, 2, 3].map(i =>
        Promise.all([
          serveOne(server, req => ({ body: `response ${req.path}` })),
          get(client, `/${i}`),
        ])
      )
    );

    // Each connection should have received its own response.
    for (const [, response] of results) {
      expect(response.status).toBe(200);
      expect(response.body).toMatch(/^response \/\d+$/);
    }
    // All three paths were served.
    const bodies = results.map(([, r]) => r.body).sort();
    expect(bodies).toEqual(['response /1', 'response /2', 'response /3']);
  });
});
