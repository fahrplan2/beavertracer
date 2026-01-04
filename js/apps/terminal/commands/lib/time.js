//@ts-check

/**
 * Sleep for given milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * High-resolution timestamp (like performance.now, fallback to Date.now)
 * @returns {number}
 */
export function nowMs() {
  return typeof performance !== "undefined"
    ? performance.now()
    : Date.now();
}
