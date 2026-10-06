//@ts-check

import { describe, it, expect } from 'vitest';
import { abortable } from '../../../../src/apps/terminal/commands/lib/abort.js';
import { ping } from '../../../../src/apps/terminal/commands/net/ping.js';

/** @template T */
function deferred() {
  /** @type {(v: T) => void} */ let resolve = () => {};
  /** @type {(e: any) => void} */ let reject = () => {};
  const promise = /** @type {Promise<T>} */ (new Promise((res, rej) => { resolve = res; reject = rej; }));
  return { promise, resolve, reject };
}

describe('abortable', () => {
  it('passes the value through when not aborted', async () => {
    const ac = new AbortController();
    await expect(abortable(Promise.resolve(42), ac.signal)).resolves.toBe(42);
  });

  it('passes a rejection through when not aborted', async () => {
    const ac = new AbortController();
    await expect(abortable(Promise.reject(new Error('x')), ac.signal)).rejects.toThrow('x');
  });

  it('rejects with AbortError as soon as the signal aborts', async () => {
    const ac = new AbortController();
    const d = deferred();
    const p = abortable(d.promise, ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('hands a value that arrives after the abort to onLate', async () => {
    const ac = new AbortController();
    const d = deferred();
    const late = [];
    const p = abortable(d.promise, ac.signal, (v) => late.push(v));
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    d.resolve('conn');
    await Promise.resolve(); await Promise.resolve();
    expect(late).toEqual(['conn']);
  });

  it('rejects immediately on an already aborted signal and still cleans up late values', async () => {
    const ac = new AbortController();
    ac.abort();
    const late = [];
    await expect(abortable(Promise.resolve('conn'), ac.signal, (v) => late.push(v)))
      .rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(late).toEqual(['conn']);
  });
});

describe('ping Ctrl+C during DNS resolution', () => {
  it('aborts right away and prints nothing when the answer comes later', async () => {
    const ac = new AbortController();
    const dns = deferred();
    const out = [];
    const ctx = /** @type {any} */ ({
      signal: ac.signal,
      println: (/** @type {string} */ l) => out.push(l),
      os: {
        net: { icmpEcho: () => { throw new Error('must not ping'); } },
        dns: { resolveIP: () => dns.promise },
      },
    });

    const run = ping.run(ctx, ['www.example.com']);
    ac.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });

    dns.reject(new Error('timeout'));
    await Promise.resolve(); await Promise.resolve();
    expect(out).toEqual([]);
  });
});
