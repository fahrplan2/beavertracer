import { describe, it, expect, vi, afterEach } from 'vitest';
import { SystemClock } from '../../../src/apps/lib/SystemClock.js';

afterEach(() => vi.useRealTimers());

describe('SystemClock', () => {
  it('tracks real wall-clock time when never touched', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const clock = new SystemClock();
    expect(clock.nowMs()).toBe(Date.now());
  });

  it('setTime() steps the clock to an absolute point in time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const clock = new SystemClock();
    clock.setTime(Date.UTC(2020, 0, 1));
    expect(clock.nowMs()).toBe(Date.UTC(2020, 0, 1));
  });

  it('keeps a stepped offset stable as real time advances', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const clock = new SystemClock();
    clock.setTime(Date.UTC(2020, 0, 1));

    vi.advanceTimersByTime(10_000);
    expect(clock.nowMs()).toBe(Date.UTC(2020, 0, 1) + 10_000);
  });

  it('adjust() nudges the clock by a relative delta', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const clock = new SystemClock();
    const before = clock.nowMs();
    clock.adjust(5000);
    expect(clock.nowMs() - before).toBe(5000);
  });

  it('now() returns a Date matching nowMs()', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const clock = new SystemClock();
    clock.adjust(1234);
    expect(clock.now().getTime()).toBe(clock.nowMs());
  });
});
