//@ts-check

/**
 * Per-host virtual "system clock".
 *
 * BeaverTracer cannot and should not touch the real OS clock of the machine
 * running the browser — so every simulated host gets its own fictional clock
 * instead, exactly like it already gets a fictional IP/MAC/routing table.
 *
 * By default the offset is 0, so `now()` tracks real wall-clock time and
 * nothing changes for lessons that never touch NTP. `date -s` (or any other
 * caller of `setTime`) can deliberately knock the offset off — e.g. to
 * simulate a fresh boot with a dead CMOS battery — and `ntpdate` then
 * corrects it, which is the entire point: the fix is demonstrable without
 * ever touching `Date.now()` itself.
 */
export class SystemClock {

  /** @type {number} simulated-minus-real offset, in milliseconds */
  offsetMs = 0;

  /** Current virtual time. */
  now() {
    return new Date(Date.now() + this.offsetMs);
  }

  /** Current virtual time as epoch milliseconds. */
  nowMs() {
    return Date.now() + this.offsetMs;
  }

  /**
   * Set the virtual clock to an absolute point in time (a "step", like
   * `date -s` or old-school one-shot `ntpdate`).
   * @param {number} targetMs epoch milliseconds the virtual clock should read *now*
   */
  setTime(targetMs) {
    this.offsetMs = targetMs - Date.now();
  }

  /**
   * Nudge the virtual clock by a delta (positive = jump forward).
   * @param {number} deltaMs
   */
  adjust(deltaMs) {
    this.offsetMs += deltaMs;
  }
}
