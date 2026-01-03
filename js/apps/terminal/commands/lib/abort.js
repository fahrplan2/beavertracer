//@ts-check

/**
 * @param {number} ms
 * @param {AbortSignal} signal
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
