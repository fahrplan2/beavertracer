//@ts-check

/**
 * beavertracer-signal — room handshake (offer/answer), long poll, limits and
 * TURN credentials, exercised over real HTTP on an ephemeral port.
 */
import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { createSignalServer } from '../../server/signal/server.mjs';

/** @type {ReturnType<typeof createSignalServer>[]} */
const running = [];

afterEach(async () => {
    await Promise.all(running.splice(0).map((s) => new Promise((r) => s.close(() => r(undefined)))));
});

/** @param {Parameters<typeof createSignalServer>[0]} [opts] */
async function start(opts) {
    const s = createSignalServer(opts);
    running.push(s);
    await new Promise((r) => s.server.listen(0, '127.0.0.1', () => r(undefined)));
    const addr = /** @type {import('node:net').AddressInfo} */ (s.server.address());
    const base = `http://127.0.0.1:${addr.port}`;
    /**
     * @param {string} method @param {string} path
     * @param {{ body?: any, token?: string, ip?: string }} [o]
     */
    async function req(method, path, o = {}) {
        /** @type {Record<string, string>} */
        const headers = {};
        if (o.body !== undefined) headers['Content-Type'] = 'application/json';
        if (o.token) headers['X-Room-Token'] = o.token;
        if (o.ip) headers['X-Real-IP'] = o.ip;
        const res = await fetch(base + path, {
            method,
            headers,
            body: o.body === undefined ? undefined : typeof o.body === 'string' ? o.body : JSON.stringify(o.body),
        });
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : null };
    }
    return { ...s, req };
}

const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=ice-ufrag:abcd\r\n';
const ANSWER = 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\na=ice-ufrag:wxyz\r\n';

describe('signal server', () => {
    it('passes offer and answer between host and guest, then forgets the room', async () => {
        const { req, rooms } = await start();
        const created = await req('POST', '/rooms', { body: { offer: OFFER } });
        expect(created.status).toBe(201);
        expect(created.json.code).toMatch(/^\d{6}$/);

        const joined = await req('POST', `/rooms/${created.json.code}/join`);
        expect(joined.status).toBe(200);
        expect(joined.json.offer).toBe(OFFER);

        const answered = await req('POST', `/rooms/${created.json.code}/answer`, { body: { answer: ANSWER }, token: joined.json.token });
        expect(answered.status).toBe(204);

        const got = await req('GET', `/rooms/${created.json.code}/answer`, { token: created.json.token });
        expect(got.status).toBe(200);
        expect(got.json.answer).toBe(ANSWER);
        expect(rooms.size).toBe(0);
    });

    it('accepts the /signal prefix the same way', async () => {
        const { req } = await start();
        const created = await req('POST', '/signal/rooms', { body: { offer: OFFER } });
        expect(created.status).toBe(201);
        expect((await req('POST', `/signal/rooms/${created.json.code}/join`)).status).toBe(200);
        expect((await req('GET', '/signal/health')).json.ok).toBe(true);
    });

    it('long poll returns as soon as the answer arrives', async () => {
        const { req } = await start();
        const { json: host } = await req('POST', '/rooms', { body: { offer: OFFER } });
        const poll = req('GET', `/rooms/${host.code}/answer`, { token: host.token });
        const { json: guest } = await req('POST', `/rooms/${host.code}/join`);
        await req('POST', `/rooms/${host.code}/answer`, { body: { answer: ANSWER }, token: guest.token });
        const got = await poll;
        expect(got.status).toBe(200);
        expect(got.json.answer).toBe(ANSWER);
    });

    it('long poll times out with 204 when nobody answers', async () => {
        const { req } = await start({ pollMs: 30 });
        const { json: host } = await req('POST', '/rooms', { body: { offer: OFFER } });
        expect((await req('GET', `/rooms/${host.code}/answer`, { token: host.token })).status).toBe(204);
    });

    it('lets only one guest join and checks tokens', async () => {
        const { req } = await start();
        const { json: host } = await req('POST', '/rooms', { body: { offer: OFFER } });
        const { json: guest } = await req('POST', `/rooms/${host.code}/join`);
        expect((await req('POST', `/rooms/${host.code}/join`)).status).toBe(409);
        // host token can't post the answer, guest token can't read it
        expect((await req('POST', `/rooms/${host.code}/answer`, { body: { answer: ANSWER }, token: host.token })).status).toBe(403);
        expect((await req('GET', `/rooms/${host.code}/answer`, { token: guest.token })).status).toBe(403);
        expect((await req('DELETE', `/rooms/${host.code}`, { token: guest.token })).status).toBe(403);
        expect((await req('DELETE', `/rooms/${host.code}`, { token: host.token })).status).toBe(204);
        expect((await req('POST', `/rooms/${host.code}/join`)).status).toBe(404);
    });

    it('rejects oversized, non-ASCII and malformed payloads', async () => {
        const { req } = await start();
        expect((await req('POST', '/rooms', { body: { offer: 'x'.repeat(6001) } })).status).toBe(400);
        expect((await req('POST', '/rooms', { body: { offer: 'x'.repeat(8000) } })).status).toBe(413);
        expect((await req('POST', '/rooms', { body: { offer: '<b>ä</b>' } })).status).toBe(400);
        expect((await req('POST', '/rooms', { body: { offer: 42 } })).status).toBe(400);
        expect((await req('POST', '/rooms', { body: '{nope' })).status).toBe(400);
    });

    it('expires rooms after their TTL', async () => {
        let now = 1_000_000;
        const { req, sweep, rooms } = await start({ now: () => now, roomTtlMs: 1000 });
        const { json: host } = await req('POST', '/rooms', { body: { offer: OFFER } });
        now += 1001;
        expect((await req('POST', `/rooms/${host.code}/join`)).status).toBe(404);
        await req('POST', '/rooms', { body: { offer: OFFER } });
        now += 1001;
        sweep();
        expect(rooms.size).toBe(0);
    });

    it('rate-limits per client IP and wrong room codes separately', async () => {
        const { req } = await start({ requestsPerMinute: 3, joinMissesPerMinute: 2 });
        for (let i = 0; i < 3; i++) expect((await req('GET', '/ice', { ip: '10.0.0.1' })).status).toBe(200);
        expect((await req('GET', '/ice', { ip: '10.0.0.1' })).status).toBe(429);
        expect((await req('GET', '/ice', { ip: '10.0.0.2' })).status).toBe(200);

        expect((await req('POST', '/rooms/123456/join', { ip: '10.0.0.3' })).status).toBe(404);
        expect((await req('POST', '/rooms/123456/join', { ip: '10.0.0.3' })).status).toBe(404);
        expect((await req('POST', '/rooms/123456/join', { ip: '10.0.0.3' })).status).toBe(429);
    });

    it('hands out STUN and short-lived TURN credentials coturn accepts', async () => {
        const now = 1_700_000_000_000;
        const { req } = await start({
            now: () => now,
            stunUrls: ['stun:example.org:3478'],
            turnUrls: ['turn:example.org:3478'],
            turnSecret: 's3cret',
            turnTtlSec: 600,
        });
        const { json } = await req('GET', '/ice');
        expect(json.iceServers[0]).toEqual({ urls: ['stun:example.org:3478'] });
        const turn = json.iceServers[1];
        expect(turn.username).toBe(`${now / 1000 + 600}:bt`);
        expect(turn.credential).toBe(crypto.createHmac('sha1', 's3cret').update(turn.username).digest('base64'));
    });

    it('counts anonymous connection reports', async () => {
        const { req } = await start();
        await req('POST', '/report', { body: { result: 'failed' } });
        await req('POST', '/report', { body: { result: 'connected' } });
        await req('POST', '/report', { body: { result: 'bogus' } });
        expect((await req('GET', '/health')).json.reports).toEqual({ connected: 1, failed: 1 });
    });
});
