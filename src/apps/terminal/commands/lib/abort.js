//@ts-check

/**
 * @param {number} ms
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
export function sleepAbortable(ms, signal) {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Race `promise` against Ctrl+C: on abort, reject with AbortError right away
 * instead of waiting for e.g. a DNS query or TCP connect that hangs on ARP.
 * If the promise still resolves after the abort, its value goes to `onLate`
 * so the caller can release it (close a connection nobody will use).
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal} signal
 * @param {(value: T) => void} [onLate]
 * @returns {Promise<T>}
 */
export function abortable(promise, signal, onLate) {
  const late = (/** @type {T} */ v) => { try { onLate?.(v); } catch { /* ignore */ } };

  if (signal.aborted) {
    promise.then(late, () => {});
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        if (aborted) late(v); else resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
